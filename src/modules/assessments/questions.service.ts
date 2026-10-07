import {
  and,
  arrayContains,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  type SQL,
} from "drizzle-orm";

import {
  chapters,
  db,
  type Question,
  questionBank,
  questionOptions,
  type QuestionType,
  topics,
} from "../../db/index.js";
import { isAdmin } from "../../lib/access.js";
import { badRequest, forbidden, notFound } from "../../lib/http-error.js";
import { offsetOf, paginate } from "../../lib/pagination.js";
import type { AuthUser } from "../../middleware/auth.js";
import type { OptionInput } from "./assessments.schemas.js";

export const SINGLE_ANSWER_TYPES: readonly QuestionType[] = ["mcq_single", "assertion_reason"];
export const MULTI_ANSWER_TYPES: readonly QuestionType[] = ["mcq_multi", "matrix_match"];

/**
 * Option rules per type. Integer questions store their answer as a single option whose
 * `optionText` is the number and `isCorrect = true`.
 */
export function validateOptions(type: QuestionType, options: OptionInput[]) {
  const correct = options.filter((o) => o.isCorrect).length;
  if (SINGLE_ANSWER_TYPES.includes(type)) {
    if (options.length < 2 || correct !== 1) {
      throw badRequest(`${type} questions need at least 2 options and exactly 1 correct option`);
    }
  } else if (MULTI_ANSWER_TYPES.includes(type)) {
    if (options.length < 2 || correct < 1) {
      throw badRequest(`${type} questions need at least 2 options and at least 1 correct option`);
    }
  } else if (type === "integer") {
    const [answer] = options;
    if (options.length !== 1 || !answer?.isCorrect || !Number.isFinite(Number(answer.optionText))) {
      throw badRequest("integer questions need exactly 1 option holding the numeric answer, marked correct");
    }
  } else if (type === "subjective" && options.length) {
    throw badRequest("subjective questions cannot have options");
  }
}

async function assertHierarchy(subjectId: string, chapterId?: string | null, topicId?: string | null) {
  if (chapterId) {
    const [chapter] = await db
      .select({ subjectId: chapters.subjectId })
      .from(chapters)
      .where(eq(chapters.id, chapterId));
    if (!chapter || chapter.subjectId !== subjectId) throw badRequest("chapterId does not belong to subjectId");
  }
  if (topicId) {
    const [topic] = await db
      .select({ chapterId: topics.chapterId, subjectId: chapters.subjectId })
      .from(topics)
      .innerJoin(chapters, eq(chapters.id, topics.chapterId))
      .where(eq(topics.id, topicId));
    if (!topic || topic.subjectId !== subjectId || (chapterId && topic.chapterId !== chapterId)) {
      throw badRequest("topicId does not belong to the given chapter/subject");
    }
  }
}

export async function getQuestionsWithOptions(questionIds: string[]) {
  if (!questionIds.length) return [];
  const [questions, options] = await Promise.all([
    db.select().from(questionBank).where(inArray(questionBank.id, questionIds)),
    db
      .select()
      .from(questionOptions)
      .where(inArray(questionOptions.questionId, questionIds))
      .orderBy(asc(questionOptions.sequenceOrder)),
  ]);
  return questions.map((q) => ({ ...q, options: options.filter((o) => o.questionId === q.id) }));
}

export async function getQuestionOrThrow(id: string) {
  const [question] = await getQuestionsWithOptions([id]);
  if (!question || question.deletedAt) throw notFound("Question");
  return question;
}

export async function listQuestions(
  user: AuthUser,
  query: {
    page: number;
    limit: number;
    subjectId?: string;
    chapterId?: string;
    topicId?: string;
    type?: QuestionType;
    difficulty?: Question["difficulty"];
    isApproved?: boolean;
    source?: string;
    tag?: string;
    search?: string;
    mine?: boolean;
  },
) {
  const conditions: SQL[] = [isNull(questionBank.deletedAt)];
  if (query.subjectId) conditions.push(eq(questionBank.subjectId, query.subjectId));
  if (query.chapterId) conditions.push(eq(questionBank.chapterId, query.chapterId));
  if (query.topicId) conditions.push(eq(questionBank.topicId, query.topicId));
  if (query.type) conditions.push(eq(questionBank.type, query.type));
  if (query.difficulty) conditions.push(eq(questionBank.difficulty, query.difficulty));
  if (query.isApproved !== undefined) conditions.push(eq(questionBank.isApproved, query.isApproved));
  if (query.source) conditions.push(ilike(questionBank.source, `%${query.source}%`));
  if (query.tag) conditions.push(arrayContains(questionBank.tags, [query.tag]));
  if (query.search) conditions.push(ilike(questionBank.contentHtml, `%${query.search}%`));
  if (query.mine) conditions.push(eq(questionBank.createdBy, user.id));
  const where = and(...conditions);

  const [rows, [total]] = await Promise.all([
    db
      .select({ id: questionBank.id })
      .from(questionBank)
      .where(where)
      .orderBy(desc(questionBank.createdAt))
      .limit(query.limit)
      .offset(offsetOf(query.page, query.limit)),
    db.select({ value: count() }).from(questionBank).where(where),
  ]);

  const ids = rows.map((r) => r.id);
  const full = await getQuestionsWithOptions(ids);
  const byId = new Map(full.map((q) => [q.id, q]));
  return paginate(
    ids.map((id) => byId.get(id)!),
    total?.value ?? 0,
    query.page,
    query.limit,
  );
}

type QuestionInput = {
  subjectId: string;
  chapterId?: string | null;
  topicId?: string | null;
  type: QuestionType;
  difficulty: Question["difficulty"];
  contentHtml: string;
  solutionHtml?: string | null;
  hintHtml?: string | null;
  marksDefault?: string;
  negativeMarksDefault?: string;
  source?: string | null;
  yearOfAppearance?: number | null;
  tags?: string[] | null;
  options: OptionInput[];
};

export async function createQuestion(user: AuthUser, input: QuestionInput) {
  validateOptions(input.type, input.options);
  await assertHierarchy(input.subjectId, input.chapterId, input.topicId);
  const { options, ...question } = input;

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(questionBank)
      .values({
        ...question,
        createdBy: user.id,
        isApproved: isAdmin(user),
        approvedBy: isAdmin(user) ? user.id : null,
      })
      .returning({ id: questionBank.id });
    if (!row) throw new Error("Failed to create question");
    if (options.length) {
      await tx
        .insert(questionOptions)
        .values(options.map((o, i) => ({ ...o, questionId: row.id, sequenceOrder: i })));
    }
    return row.id;
  });
  return getQuestionOrThrow(id);
}

/** Editing an approved question sends it back through approval unless an admin edits it. */
export async function updateQuestion(user: AuthUser, id: string, input: Partial<QuestionInput>) {
  const existing = await getQuestionOrThrow(id);
  if (existing.createdBy !== user.id && !isAdmin(user)) {
    throw forbidden("Only the author or an admin can edit this question");
  }

  const type = input.type ?? existing.type;
  const options =
    input.options ??
    existing.options.map((o) => ({ optionText: o.optionText, isCorrect: o.isCorrect, explanationHtml: o.explanationHtml }));
  if (input.type || input.options) validateOptions(type, options);
  if (input.subjectId || input.chapterId !== undefined || input.topicId !== undefined) {
    await assertHierarchy(
      input.subjectId ?? existing.subjectId,
      input.chapterId !== undefined ? input.chapterId : existing.chapterId,
      input.topicId !== undefined ? input.topicId : existing.topicId,
    );
  }

  const { options: newOptions, ...patch } = input;
  await db.transaction(async (tx) => {
    await tx
      .update(questionBank)
      .set({
        ...patch,
        isApproved: isAdmin(user) ? existing.isApproved : false,
        approvedBy: isAdmin(user) ? existing.approvedBy : null,
      })
      .where(eq(questionBank.id, id));
    if (newOptions) {
      await tx.delete(questionOptions).where(eq(questionOptions.questionId, id));
      if (newOptions.length) {
        await tx
          .insert(questionOptions)
          .values(newOptions.map((o, i) => ({ ...o, questionId: id, sequenceOrder: i })));
      }
    }
  });
  return getQuestionOrThrow(id);
}

export async function setApproval(user: AuthUser, id: string, approved: boolean) {
  await getQuestionOrThrow(id);
  await db
    .update(questionBank)
    .set({ isApproved: approved, approvedBy: approved ? user.id : null })
    .where(eq(questionBank.id, id));
  return getQuestionOrThrow(id);
}

export async function softDeleteQuestion(user: AuthUser, id: string) {
  const existing = await getQuestionOrThrow(id);
  if (existing.createdBy !== user.id && !isAdmin(user)) {
    throw forbidden("Only the author or an admin can delete this question");
  }
  await db.update(questionBank).set({ deletedAt: new Date() }).where(eq(questionBank.id, id));
}
