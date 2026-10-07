import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  max,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  batchStudents,
  db,
  type DbOrTx,
  programs,
  questionBank,
  subjects,
  type Test,
  testAttempts,
  testQuestions,
  tests,
  type TestStatus,
} from "../../db/index.js";
import {
  assertBatchAccess,
  getAccessibleBatchIds,
  getFacultyBatchIds,
  getStudentBatchIds,
  isStaff,
  isSuperAdmin,
} from "../../lib/access.js";
import { toNumber } from "../../lib/dates.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/http-error.js";
import { offsetOf, paginate } from "../../lib/pagination.js";
import type { AuthUser } from "../../middleware/auth.js";
import { getStudentProgramIds } from "../curriculum/curriculum.service.js";
import { notify } from "../notifications/notifications.service.js";
import { rethrowUniqueAsConflict } from "../users/users.service.js";
import type { TestQuestionInput } from "./assessments.schemas.js";
import { getQuestionsWithOptions } from "./questions.service.js";

/**
 * A scheduled test opens automatically at `scheduled_at` and closes at `ends_at`,
 * so no cron job is needed to flip statuses.
 */
export function effectiveStatus(test: Pick<Test, "status" | "scheduledAt" | "endsAt">, now = new Date()): TestStatus {
  if (test.status === "scheduled" && test.scheduledAt && test.scheduledAt <= now) {
    return test.endsAt && test.endsAt <= now ? "completed" : "live";
  }
  if (test.status === "live" && test.endsAt && test.endsAt <= now) return "completed";
  return test.status;
}

export async function getTestOrThrow(id: string) {
  const [test] = await db.select().from(tests).where(eq(tests.id, id));
  if (!test) throw notFound("Test");
  return test;
}

export async function testTotals(testIds: string[]) {
  const totals = new Map<string, { questionCount: number; totalMarks: number; subjects: string[] }>();
  if (!testIds.length) return totals;
  const rows = await db
    .select({
      testId: testQuestions.testId,
      questionCount: count(),
      totalMarks: sql<string>`coalesce(sum(${testQuestions.marksCorrect}), 0)`,
      subjects: sql<string[]>`array_agg(distinct ${subjects.name})`,
    })
    .from(testQuestions)
    .innerJoin(questionBank, eq(questionBank.id, testQuestions.questionId))
    .innerJoin(subjects, eq(subjects.id, questionBank.subjectId))
    .where(inArray(testQuestions.testId, testIds))
    .groupBy(testQuestions.testId);
  for (const row of rows) {
    totals.set(row.testId, {
      questionCount: row.questionCount,
      totalMarks: toNumber(row.totalMarks) ?? 0,
      subjects: row.subjects ?? [],
    });
  }
  return totals;
}

export async function assertCanManageTest(user: AuthUser, test: Test) {
  if (isSuperAdmin(user) || test.createdBy === user.id) return;
  if (test.batchId) {
    if (user.role === "centre_admin") {
      await assertBatchAccess(user, test.batchId, true);
      return;
    }
    if ((user.role === "teacher" || user.role === "mentor") && (await getFacultyBatchIds(user.id)).includes(test.batchId)) {
      return;
    }
  } else if (user.role === "centre_admin") {
    return;
  }
  throw forbidden("You cannot manage this test");
}

const HIDDEN_FROM_STUDENTS: TestStatus[] = ["draft", "archived"];

export async function assertCanViewTest(user: AuthUser, test: Test) {
  if (isStaff(user)) {
    if (!test.batchId || isSuperAdmin(user) || test.createdBy === user.id) return;
    const accessible = await getAccessibleBatchIds(user);
    if (accessible === null || accessible.includes(test.batchId)) return;
    throw forbidden("You do not have access to this test");
  }
  if (user.role === "student" && !HIDDEN_FROM_STUDENTS.includes(test.status)) {
    if (test.batchId) {
      if ((await getStudentBatchIds(user.id)).includes(test.batchId)) return;
    } else if ((await getStudentProgramIds(user.id)).includes(test.programId)) {
      return;
    }
  }
  throw forbidden("You do not have access to this test");
}

type ListQuery = {
  page: number;
  limit: number;
  batchId?: string;
  programId?: string;
  status?: TestStatus | "upcoming";
  type?: Test["type"];
  search?: string;
  mine?: boolean;
};

export async function listTests(user: AuthUser, query: ListQuery) {
  const conditions: SQL[] = [];

  if (user.role === "student") {
    const [batchIds, programIds] = await Promise.all([
      getStudentBatchIds(user.id),
      getStudentProgramIds(user.id),
    ]);
    const visibility: SQL[] = [];
    if (batchIds.length) visibility.push(inArray(tests.batchId, batchIds));
    if (programIds.length) visibility.push(and(isNull(tests.batchId), inArray(tests.programId, programIds))!);
    if (!visibility.length) return paginate([], 0, query.page, query.limit);
    conditions.push(or(...visibility)!, notInArray(tests.status, HIDDEN_FROM_STUDENTS));
  } else if (!isSuperAdmin(user)) {
    const accessible = (await getAccessibleBatchIds(user)) ?? [];
    const visibility: SQL[] = [isNull(tests.batchId), eq(tests.createdBy, user.id)];
    if (accessible.length) visibility.push(inArray(tests.batchId, accessible));
    conditions.push(or(...visibility)!);
  }

  if (query.batchId) conditions.push(eq(tests.batchId, query.batchId));
  if (query.programId) conditions.push(eq(tests.programId, query.programId));
  if (query.type) conditions.push(eq(tests.type, query.type));
  if (query.search) conditions.push(ilike(tests.name, `%${query.search}%`));
  if (query.mine && isStaff(user)) conditions.push(eq(tests.createdBy, user.id));
  if (query.status === "upcoming") {
    conditions.push(eq(tests.status, "scheduled"), gt(tests.scheduledAt, new Date()));
  } else if (query.status) {
    conditions.push(eq(tests.status, query.status));
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, [total]] = await Promise.all([
    db
      .select({ test: tests, programName: programs.name, examType: programs.examType })
      .from(tests)
      .innerJoin(programs, eq(programs.id, tests.programId))
      .where(where)
      .orderBy(desc(sql`coalesce(${tests.scheduledAt}, ${tests.createdAt})`))
      .limit(query.limit)
      .offset(offsetOf(query.page, query.limit)),
    db.select({ value: count() }).from(tests).where(where),
  ]);

  const ids = rows.map((r) => r.test.id);
  const totals = await testTotals(ids);
  const myAttempts = user.role === "student" ? await latestAttempts(user.id, ids) : new Map();

  return paginate(
    rows.map(({ test, programName, examType }) => ({
      ...test,
      programName,
      examType,
      effectiveStatus: effectiveStatus(test),
      ...(totals.get(test.id) ?? { questionCount: 0, totalMarks: 0, subjects: [] }),
      ...(user.role === "student" ? { myAttempt: myAttempts.get(test.id) ?? null } : {}),
    })),
    total?.value ?? 0,
    query.page,
    query.limit,
  );
}

async function latestAttempts(studentId: string, testIds: string[]) {
  const map = new Map<string, Record<string, unknown>>();
  if (!testIds.length) return map;
  const rows = await db
    .select()
    .from(testAttempts)
    .where(and(eq(testAttempts.studentId, studentId), inArray(testAttempts.testId, testIds)))
    .orderBy(asc(testAttempts.attemptNumber));
  for (const a of rows) {
    map.set(a.testId, {
      attemptId: a.id,
      attemptNumber: a.attemptNumber,
      inProgress: !a.submittedAt,
      score: toNumber(a.score),
      maxScore: toNumber(a.maxScore),
      rank: a.rankInBatch,
      percentile: toNumber(a.percentile),
      submittedAt: a.submittedAt,
    });
  }
  return map;
}

export async function getTestSummary(user: AuthUser, test: Test) {
  const totals = (await testTotals([test.id])).get(test.id) ?? { questionCount: 0, totalMarks: 0, subjects: [] };
  const base = { ...test, effectiveStatus: effectiveStatus(test), ...totals };
  if (user.role !== "student") return base;
  const attempts = await db
    .select()
    .from(testAttempts)
    .where(and(eq(testAttempts.testId, test.id), eq(testAttempts.studentId, user.id)))
    .orderBy(asc(testAttempts.attemptNumber));
  return {
    ...base,
    myAttempts: attempts.map((a) => ({
      id: a.id,
      attemptNumber: a.attemptNumber,
      startedAt: a.startedAt,
      submittedAt: a.submittedAt,
      score: toNumber(a.score),
      maxScore: toNumber(a.maxScore),
      rank: a.rankInBatch,
      percentile: toNumber(a.percentile),
    })),
    attemptsRemaining: Math.max(0, test.maxAttempts - attempts.length),
  };
}

async function assertQuestionsFitProgram(questionIds: string[], programId: string) {
  if (!questionIds.length) return [];
  const questions = await getQuestionsWithOptions(questionIds);
  if (questions.length !== new Set(questionIds).size || questions.some((q) => q.deletedAt)) {
    throw badRequest("One or more questionIds do not exist");
  }
  const programSubjects = new Set(
    (await db.select({ id: subjects.id }).from(subjects).where(eq(subjects.programId, programId))).map((s) => s.id),
  );
  if (questions.some((q) => !programSubjects.has(q.subjectId))) {
    throw badRequest("All questions must belong to subjects of the test's program");
  }
  return questions;
}

export async function addQuestions(test: Test, items: TestQuestionInput[], tx: DbOrTx = db) {
  const questions = await assertQuestionsFitProgram(
    items.map((i) => i.questionId),
    test.programId,
  );
  const byId = new Map(questions.map((q) => [q.id, q]));
  const [current] = await tx
    .select({ value: max(testQuestions.sequenceOrder) })
    .from(testQuestions)
    .where(eq(testQuestions.testId, test.id));
  let nextOrder = (current?.value ?? -1) + 1;
  const sections = test.markingSchemeJson.sections;

  const values = items.map((item) => {
    const question = byId.get(item.questionId)!;
    const section =
      sections.find((s) => s.name === item.sectionName) ?? sections.find((s) => s.questionType === question.type);
    return {
      testId: test.id,
      questionId: item.questionId,
      sectionName: item.sectionName,
      sequenceOrder: item.sequenceOrder ?? nextOrder++,
      marksCorrect: item.marksCorrect ?? (section ? section.correct.toFixed(1) : question.marksDefault),
      marksIncorrect: item.marksIncorrect ?? (section ? section.incorrect.toFixed(1) : question.negativeMarksDefault),
      marksUnattempted: item.marksUnattempted ?? (section ? section.unattempted.toFixed(1) : "0"),
    };
  });

  try {
    return await tx.insert(testQuestions).values(values).returning();
  } catch (err) {
    rethrowUniqueAsConflict(err, "A question appears in this test more than once");
  }
}

export async function assertTestEditable(test: Test) {
  if (test.status !== "draft" && test.status !== "scheduled") {
    throw conflict(`A ${test.status} test can no longer be edited`);
  }
  if (effectiveStatus(test) !== test.status) throw conflict("The test has already started");
  const [attempt] = await db
    .select({ id: testAttempts.id })
    .from(testAttempts)
    .where(eq(testAttempts.testId, test.id))
    .limit(1);
  if (attempt) throw conflict("The test already has attempts and can no longer be edited");
}

export async function listTestQuestions(testId: string) {
  const rows = await db
    .select()
    .from(testQuestions)
    .where(eq(testQuestions.testId, testId))
    .orderBy(asc(testQuestions.sequenceOrder));
  const questions = await getQuestionsWithOptions(rows.map((r) => r.questionId));
  const byId = new Map(questions.map((q) => [q.id, q]));
  return rows.map((r) => ({ ...r, question: byId.get(r.questionId)! }));
}

const TRANSITIONS: Record<TestStatus, TestStatus[]> = {
  draft: ["scheduled", "live", "archived"],
  scheduled: ["draft", "live", "archived"],
  live: ["completed"],
  completed: ["archived"],
  archived: [],
};

export async function changeStatus(test: Test, status: TestStatus) {
  const current = effectiveStatus(test);
  if (!TRANSITIONS[current].includes(status)) {
    throw badRequest(`Cannot move a ${current} test to ${status}`);
  }

  if (status === "scheduled" || status === "live") {
    const rows = await db
      .select({ isApproved: questionBank.isApproved, deletedAt: questionBank.deletedAt })
      .from(testQuestions)
      .innerJoin(questionBank, eq(questionBank.id, testQuestions.questionId))
      .where(eq(testQuestions.testId, test.id));
    if (!rows.length) throw badRequest("Add at least one question before publishing");
    const unapproved = rows.filter((r) => !r.isApproved || r.deletedAt).length;
    if (unapproved) throw badRequest(`${unapproved} question(s) are unapproved or deleted`);
    if (status === "scheduled" && (!test.scheduledAt || test.scheduledAt <= new Date())) {
      throw badRequest("Set a future scheduledAt before scheduling");
    }
  }

  const patch: Partial<Test> = { status };
  if (status === "live" && !test.scheduledAt) patch.scheduledAt = new Date();
  if (status === "completed" && (!test.endsAt || test.endsAt > new Date())) patch.endsAt = new Date();

  const [updated] = await db.update(tests).set(patch).where(eq(tests.id, test.id)).returning();

  if ((status === "scheduled" || status === "live") && test.batchId) {
    const students = await db
      .select({ id: batchStudents.studentId })
      .from(batchStudents)
      .where(and(eq(batchStudents.batchId, test.batchId), eq(batchStudents.status, "active")));
    await notify({
      userIds: students.map((s) => s.id),
      type: "test_reminder",
      title: status === "live" ? `${test.name} is live` : `${test.name} has been scheduled`,
      body:
        status === "live"
          ? `You can start the test now. Duration: ${test.durationMinutes} minutes.`
          : `Starts ${test.scheduledAt?.toISOString()}. Duration: ${test.durationMinutes} minutes.`,
      data: { entity_type: "test", entity_id: test.id },
    });
  }
  return updated;
}

export async function removeQuestion(testId: string, questionId: string) {
  const [row] = await db
    .delete(testQuestions)
    .where(and(eq(testQuestions.testId, testId), eq(testQuestions.questionId, questionId)))
    .returning({ id: testQuestions.id });
  if (!row) throw notFound("Test question");
}

export function canSeeSolutions(test: Test, submitted: boolean) {
  if (!submitted) return false;
  switch (test.showSolutionAfter) {
    case "after_submit":
      return true;
    case "after_end_time":
      return effectiveStatus(test) === "completed" || effectiveStatus(test) === "archived";
    case "never":
      return false;
  }
}
