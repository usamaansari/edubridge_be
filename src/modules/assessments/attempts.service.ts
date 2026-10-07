import { and, asc, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import {
  db,
  type ResponsePayload,
  type Test,
  type TestAttempt,
  testAttempts,
  testQuestions,
  testResponses,
  tests,
  topicPerformance,
  userProfiles,
  users,
} from "../../db/index.js";
import { canViewStudent, isStaff } from "../../lib/access.js";
import { seededShuffle } from "../../lib/crypto.js";
import { fullName, round, toNumber } from "../../lib/dates.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/http-error.js";
import { getPgError, PG_UNIQUE_VIOLATION } from "../../lib/pg-error.js";
import type { AuthUser } from "../../middleware/auth.js";
import { notify } from "../notifications/notifications.service.js";
import type { SaveResponsesInput } from "./assessments.schemas.js";
import { getQuestionsWithOptions } from "./questions.service.js";
import { evaluateResponse, isAnswered, optionKey, payloadFromAnswer } from "./scoring.js";
import {
  assertCanManageTest,
  assertCanViewTest,
  canSeeSolutions,
  effectiveStatus,
  getTestOrThrow,
} from "./tests.service.js";

/** Saves arriving slightly after the deadline (network latency) are still accepted. */
const SUBMIT_GRACE_SEC = 60;

export function deadlineOf(attempt: Pick<TestAttempt, "startedAt">, test: Pick<Test, "durationMinutes" | "endsAt">) {
  const byDuration = new Date(attempt.startedAt.getTime() + test.durationMinutes * 60_000);
  return test.endsAt && test.endsAt < byDuration ? test.endsAt : byDuration;
}

const isExpired = (attempt: TestAttempt, test: Test, graceSec = 0) =>
  Date.now() > deadlineOf(attempt, test).getTime() + graceSec * 1000;

export async function getAttemptOrThrow(id: string) {
  const [attempt] = await db.select().from(testAttempts).where(eq(testAttempts.id, id));
  if (!attempt) throw notFound("Attempt");
  return attempt;
}

/** Owners can always read their attempt; staff need to manage the test or see the student. */
export async function assertCanReadAttempt(user: AuthUser, attempt: TestAttempt, test: Test) {
  if (attempt.studentId === user.id) return;
  if (isStaff(user)) {
    try {
      await assertCanManageTest(user, test);
      return;
    } catch {
      if (await canViewStudent(user, attempt.studentId)) return;
    }
  } else if (user.role === "parent" && (await canViewStudent(user, attempt.studentId))) {
    return;
  }
  throw forbidden("You do not have access to this attempt");
}

export async function startAttempt(user: AuthUser, test: Test, ipAddress: string | undefined) {
  await assertCanViewTest(user, test);
  if (effectiveStatus(test) !== "live") throw badRequest("This test is not open for attempts right now");

  const attempts = await db
    .select()
    .from(testAttempts)
    .where(and(eq(testAttempts.testId, test.id), eq(testAttempts.studentId, user.id)))
    .orderBy(asc(testAttempts.attemptNumber));

  const open = attempts.find((a) => !a.submittedAt);
  if (open) {
    if (!isExpired(open, test)) return open;
    await submitAttempt(open.id, { auto: true });
  }

  if (attempts.length >= test.maxAttempts) {
    throw conflict(`You have used all ${test.maxAttempts} attempt(s) for this test`);
  }

  try {
    const [attempt] = await db
      .insert(testAttempts)
      .values({
        testId: test.id,
        studentId: user.id,
        attemptNumber: attempts.length + 1,
        ipAddress: ipAddress?.replace(/^::ffff:/, "") ?? null,
      })
      .returning();
    return attempt!;
  } catch (err) {
    if (getPgError(err)?.code === PG_UNIQUE_VIOLATION) throw conflict("An attempt was started concurrently");
    throw err;
  }
}

/** The question paper without answers, in a stable per-attempt shuffled order. */
export async function getPaper(attempt: TestAttempt, test: Test) {
  const rows = await db
    .select()
    .from(testQuestions)
    .where(eq(testQuestions.testId, test.id))
    .orderBy(asc(testQuestions.sequenceOrder));
  const questions = new Map((await getQuestionsWithOptions(rows.map((r) => r.questionId))).map((q) => [q.id, q]));
  const responses = new Map(
    (await db.select().from(testResponses).where(eq(testResponses.attemptId, attempt.id))).map((r) => [
      r.questionId,
      r,
    ]),
  );

  const ordered = test.shuffleQuestions ? seededShuffle(rows, attempt.id) : rows;
  const paper = ordered.map((row, index) => {
    const q = questions.get(row.questionId)!;
    const options = q.options.map((o) => ({ key: optionKey(o.sequenceOrder), text: o.optionText }));
    const response = responses.get(q.id);
    return {
      number: index + 1,
      questionId: q.id,
      sectionName: row.sectionName,
      type: q.type,
      contentHtml: q.contentHtml,
      hintHtml: q.hintHtml,
      marksCorrect: toNumber(row.marksCorrect),
      marksIncorrect: toNumber(row.marksIncorrect),
      marksUnattempted: toNumber(row.marksUnattempted),
      options:
        q.type === "integer" || q.type === "subjective"
          ? []
          : test.shuffleOptions
            ? seededShuffle(options, `${attempt.id}:${q.id}`)
            : options,
      response: response?.responseJson ?? null,
      status: response?.status ?? "not_visited",
      timeSpentSec: response?.timeSpentSec ?? 0,
    };
  });

  const deadline = deadlineOf(attempt, test);
  return {
    attempt,
    test: {
      id: test.id,
      name: test.name,
      instructionsHtml: test.instructionsHtml,
      durationMinutes: test.durationMinutes,
      isProctored: test.isProctored,
      markingScheme: test.markingSchemeJson,
    },
    deadline,
    remainingSec: Math.max(0, Math.floor((deadline.getTime() - Date.now()) / 1000)),
    sections: [...new Set(paper.map((p) => p.sectionName))],
    questions: paper,
  };
}

export async function saveResponses(attempt: TestAttempt, test: Test, responses: SaveResponsesInput) {
  if (attempt.submittedAt) throw conflict("This attempt has already been submitted");
  if (isExpired(attempt, test, SUBMIT_GRACE_SEC)) {
    await submitAttempt(attempt.id, { auto: true });
    throw conflict("Time is up; your attempt has been submitted automatically");
  }

  const testQuestionRows = await db
    .select({ questionId: testQuestions.questionId })
    .from(testQuestions)
    .where(eq(testQuestions.testId, test.id));
  const allowed = new Set(testQuestionRows.map((r) => r.questionId));
  const invalid = responses.filter((r) => !allowed.has(r.questionId));
  if (invalid.length) throw badRequest(`Question(s) not in this test: ${invalid.map((r) => r.questionId).join(", ")}`);

  await db.transaction(async (tx) => {
    for (const r of responses) {
      const status = r.status ?? (r.response ? "answered" : "visited");
      const patch: Partial<typeof testResponses.$inferInsert> = { status };
      if (r.response !== undefined) patch.responseJson = r.response;
      if (r.timeSpentSec !== undefined) patch.timeSpentSec = r.timeSpentSec;
      await tx
        .insert(testResponses)
        .values({ attemptId: attempt.id, questionId: r.questionId, ...patch })
        .onConflictDoUpdate({ target: [testResponses.attemptId, testResponses.questionId], set: patch });
    }
  });
  return { saved: responses.length, remainingSec: Math.max(0, Math.floor((deadlineOf(attempt, test).getTime() - Date.now()) / 1000)) };
}

/** Saves the frontend's `answers` map (option keys or a numeric value per question). */
export async function saveAnswerMap(attempt: TestAttempt, test: Test, answers: Record<string, string[]>) {
  const questions = await getQuestionsWithOptions(Object.keys(answers));
  const types = new Map(questions.map((q) => [q.id, q.type]));
  const responses: SaveResponsesInput = Object.entries(answers)
    .filter(([questionId]) => types.has(questionId))
    .map(([questionId, answer]) => ({
      questionId,
      response: payloadFromAnswer(types.get(questionId)!, answer),
    }));
  if (responses.length) await saveResponses(attempt, test, responses);
}

export async function submitAttempt(
  attemptId: string,
  options: { auto?: boolean; tabSwitchCount?: number; timeTakenSec?: number } = {},
) {
  const result = await db.transaction(async (tx) => {
    const [attempt] = await tx.select().from(testAttempts).where(eq(testAttempts.id, attemptId)).for("update");
    if (!attempt) throw notFound("Attempt");
    if (attempt.submittedAt) return { attempt, newlySubmitted: false };

    const [test] = await tx.select().from(tests).where(eq(tests.id, attempt.testId));
    if (!test) throw notFound("Test");

    const rows = await tx.select().from(testQuestions).where(eq(testQuestions.testId, attempt.testId));
    const questions = new Map((await getQuestionsWithOptions(rows.map((r) => r.questionId))).map((q) => [q.id, q]));
    const responses = new Map(
      (await tx.select().from(testResponses).where(eq(testResponses.attemptId, attemptId))).map((r) => [r.questionId, r]),
    );

    let score = 0;
    let maxScore = 0;
    for (const row of rows) {
      const question = questions.get(row.questionId)!;
      const response = responses.get(row.questionId);
      const marks = {
        correct: toNumber(row.marksCorrect) ?? 0,
        incorrect: toNumber(row.marksIncorrect) ?? 0,
        unattempted: toNumber(row.marksUnattempted) ?? 0,
      };
      const evaluation = evaluateResponse(question, marks, response?.responseJson);
      maxScore += marks.correct;
      score += evaluation.marks ?? 0;

      const values = {
        isCorrect: evaluation.isCorrect,
        marksAwarded: evaluation.marks === null ? null : evaluation.marks.toFixed(1),
      };
      if (response) {
        await tx.update(testResponses).set(values).where(eq(testResponses.id, response.id));
      } else {
        await tx.insert(testResponses).values({ attemptId, questionId: row.questionId, status: "not_visited", ...values });
      }
    }

    const elapsedSec = Math.floor((Date.now() - attempt.startedAt.getTime()) / 1000);
    const [updated] = await tx
      .update(testAttempts)
      .set({
        submittedAt: new Date(),
        autoSubmitted: options.auto ?? false,
        score: score.toFixed(2),
        maxScore: maxScore.toFixed(2),
        timeTakenSec: Math.min(options.timeTakenSec ?? elapsedSec, test.durationMinutes * 60),
        ...(options.tabSwitchCount !== undefined ? { tabSwitchCount: options.tabSwitchCount } : {}),
      })
      .where(eq(testAttempts.id, attemptId))
      .returning();
    return { attempt: updated!, newlySubmitted: true, test };
  });

  if (result.newlySubmitted && result.test) {
    await recomputeRankings(result.attempt.testId);
    await updateTopicPerformance(result.attempt);
    await notify({
      userIds: [result.attempt.studentId],
      type: "result_ready",
      title: `Result ready: ${result.test.name}`,
      body: `You scored ${toNumber(result.attempt.score)} / ${toNumber(result.attempt.maxScore)}.`,
      data: { entity_type: "test_attempt", entity_id: result.attempt.id, test_id: result.test.id },
    });
  }
  return getAttemptOrThrow(attemptId);
}

/**
 * Ranks every submitted attempt of the test (the cohort is the batch for batch tests).
 * Percentile = share of attempts scoring at or below this one.
 */
export async function recomputeRankings(testId: string) {
  await db.execute(sql`
    with ranked as (
      select id,
             rank() over (order by score desc) as rnk,
             round((cume_dist() over (order by score asc) * 100)::numeric, 2) as pct
      from ${testAttempts}
      where ${testAttempts.testId} = ${testId} and ${testAttempts.submittedAt} is not null
    )
    update ${testAttempts} as t
       set rank_in_batch = ranked.rnk, percentile = ranked.pct
      from ranked
     where t.id = ranked.id
  `);
}

async function updateTopicPerformance(attempt: TestAttempt) {
  const rows = await db
    .select({
      questionId: testResponses.questionId,
      isCorrect: testResponses.isCorrect,
      timeSpentSec: testResponses.timeSpentSec,
    })
    .from(testResponses)
    .where(and(eq(testResponses.attemptId, attempt.id), isNotNull(testResponses.isCorrect)));
  if (!rows.length) return;

  const questions = await getQuestionsWithOptions(rows.map((r) => r.questionId));
  const topicOf = new Map(questions.map((q) => [q.id, q.topicId]));
  const perTopic = new Map<string, { attempted: number; correct: number; time: number }>();
  for (const r of rows) {
    const topicId = topicOf.get(r.questionId);
    if (!topicId) continue;
    const agg = perTopic.get(topicId) ?? { attempted: 0, correct: 0, time: 0 };
    agg.attempted += 1;
    agg.correct += r.isCorrect ? 1 : 0;
    agg.time += r.timeSpentSec;
    perTopic.set(topicId, agg);
  }
  if (!perTopic.size) return;

  const now = new Date();
  await db
    .insert(topicPerformance)
    .values(
      [...perTopic].map(([topicId, agg]) => ({
        studentId: attempt.studentId,
        topicId,
        totalQuestionsAttempted: agg.attempted,
        correctCount: agg.correct,
        accuracyPct: round((agg.correct / agg.attempted) * 100).toFixed(2),
        avgTimePerQSec: round(agg.time / agg.attempted).toFixed(2),
        lastAttemptedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [topicPerformance.studentId, topicPerformance.topicId],
      set: {
        totalQuestionsAttempted: sql`${topicPerformance.totalQuestionsAttempted} + excluded.total_questions_attempted`,
        correctCount: sql`${topicPerformance.correctCount} + excluded.correct_count`,
        accuracyPct: sql`round((${topicPerformance.correctCount} + excluded.correct_count) * 100.0 / nullif(${topicPerformance.totalQuestionsAttempted} + excluded.total_questions_attempted, 0), 2)`,
        avgTimePerQSec: sql`round((coalesce(${topicPerformance.avgTimePerQSec}, 0) * ${topicPerformance.totalQuestionsAttempted} + excluded.avg_time_per_q_sec * excluded.total_questions_attempted) / nullif(${topicPerformance.totalQuestionsAttempted} + excluded.total_questions_attempted, 0), 2)`,
        lastAttemptedAt: sql`excluded.last_attempted_at`,
      },
    });
}

export async function gradeResponse(
  attempt: TestAttempt,
  questionId: string,
  input: { marksAwarded: number; isCorrect?: boolean | null },
) {
  if (!attempt.submittedAt) throw conflict("Only submitted attempts can be graded");
  const [row] = await db
    .select({ marksCorrect: testQuestions.marksCorrect, marksIncorrect: testQuestions.marksIncorrect })
    .from(testQuestions)
    .where(and(eq(testQuestions.testId, attempt.testId), eq(testQuestions.questionId, questionId)));
  if (!row) throw notFound("Test question");
  const maxMarks = toNumber(row.marksCorrect) ?? 0;
  const minMarks = Math.min(0, toNumber(row.marksIncorrect) ?? 0);
  if (input.marksAwarded > maxMarks || input.marksAwarded < minMarks) {
    throw badRequest(`marksAwarded must be between ${minMarks} and ${maxMarks}`);
  }

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(testResponses)
      .set({
        marksAwarded: input.marksAwarded.toFixed(1),
        isCorrect: input.isCorrect ?? input.marksAwarded >= maxMarks,
      })
      .where(and(eq(testResponses.attemptId, attempt.id), eq(testResponses.questionId, questionId)))
      .returning({ id: testResponses.id });
    if (!updated) throw notFound("Response");
    await tx
      .update(testAttempts)
      .set({
        score: sql`(select coalesce(sum(${testResponses.marksAwarded}), 0) from ${testResponses} where ${testResponses.attemptId} = ${attempt.id})`,
      })
      .where(eq(testAttempts.id, attempt.id));
  });
  await recomputeRankings(attempt.testId);
  return getAttemptOrThrow(attempt.id);
}

export async function buildResult(attempt: TestAttempt, test: Test, viewer: AuthUser) {
  const rows = await db
    .select()
    .from(testQuestions)
    .where(eq(testQuestions.testId, test.id))
    .orderBy(asc(testQuestions.sequenceOrder));
  const questions = new Map((await getQuestionsWithOptions(rows.map((r) => r.questionId))).map((q) => [q.id, q]));
  const responses = new Map(
    (await db.select().from(testResponses).where(eq(testResponses.attemptId, attempt.id))).map((r) => [r.questionId, r]),
  );
  const [cohort] = await db
    .select({ value: count() })
    .from(testAttempts)
    .where(and(eq(testAttempts.testId, test.id), isNotNull(testAttempts.submittedAt)));

  const sections = new Map<
    string,
    { name: string; score: number; maxScore: number; correct: number; incorrect: number; unattempted: number; pendingReview: number }
  >();
  for (const row of rows) {
    const response = responses.get(row.questionId);
    const question = questions.get(row.questionId)!;
    const s = sections.get(row.sectionName) ?? {
      name: row.sectionName,
      score: 0,
      maxScore: 0,
      correct: 0,
      incorrect: 0,
      unattempted: 0,
      pendingReview: 0,
    };
    s.maxScore += toNumber(row.marksCorrect) ?? 0;
    s.score += toNumber(response?.marksAwarded) ?? 0;
    const answered = isAnswered(question.type, response?.responseJson);
    if (!answered) s.unattempted += 1;
    else if (response?.isCorrect === true) s.correct += 1;
    else if (response?.isCorrect === false) s.incorrect += 1;
    else s.pendingReview += 1;
    sections.set(row.sectionName, s);
  }

  const solutionsVisible = isStaff(viewer) || canSeeSolutions(test, Boolean(attempt.submittedAt));
  return {
    testId: test.id,
    testName: test.name,
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    score: toNumber(attempt.score) ?? 0,
    totalMarks: toNumber(attempt.maxScore) ?? 0,
    rank: attempt.rankInBatch,
    percentile: toNumber(attempt.percentile),
    totalCandidates: cohort?.value ?? 0,
    timeTakenSec: attempt.timeTakenSec,
    submittedAt: attempt.submittedAt,
    autoSubmitted: attempt.autoSubmitted,
    sections: [...sections.values()].map((s) => ({ ...s, score: round(s.score) })),
    solutionsVisible,
    questions: solutionsVisible
      ? rows.map((row) => {
          const q = questions.get(row.questionId)!;
          const response = responses.get(row.questionId);
          return {
            questionId: q.id,
            sectionName: row.sectionName,
            type: q.type,
            contentHtml: q.contentHtml,
            solutionHtml: q.solutionHtml,
            options: q.options.map((o) => ({
              key: optionKey(o.sequenceOrder),
              text: o.optionText,
              isCorrect: o.isCorrect,
              explanationHtml: o.explanationHtml,
            })),
            response: (response?.responseJson ?? null) as ResponsePayload | null,
            isCorrect: response?.isCorrect ?? null,
            marksAwarded: toNumber(response?.marksAwarded),
            timeSpentSec: response?.timeSpentSec ?? 0,
          };
        })
      : undefined,
  };
}

export async function getLatestSubmittedAttempt(testId: string, studentId: string) {
  const [attempt] = await db
    .select()
    .from(testAttempts)
    .where(
      and(eq(testAttempts.testId, testId), eq(testAttempts.studentId, studentId), isNotNull(testAttempts.submittedAt)),
    )
    .orderBy(desc(testAttempts.attemptNumber))
    .limit(1);
  return attempt;
}

export async function listTestAttempts(testId: string, includeInProgress: boolean) {
  const rows = await db
    .select({
      attempt: testAttempts,
      email: users.email,
      firstName: userProfiles.firstName,
      lastName: userProfiles.lastName,
    })
    .from(testAttempts)
    .innerJoin(users, eq(users.id, testAttempts.studentId))
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(and(eq(testAttempts.testId, testId), includeInProgress ? undefined : isNotNull(testAttempts.submittedAt)))
    .orderBy(asc(sql`${testAttempts.rankInBatch} nulls last`), desc(testAttempts.startedAt));
  return rows.map(({ attempt, firstName, lastName, email }) => ({
    ...attempt,
    score: toNumber(attempt.score),
    maxScore: toNumber(attempt.maxScore),
    percentile: toNumber(attempt.percentile),
    studentName: fullName(firstName, lastName),
    studentEmail: email,
  }));
}

export async function pendingGrading(testId: string) {
  return db
    .select({
      attemptId: testResponses.attemptId,
      questionId: testResponses.questionId,
      response: testResponses.responseJson,
    })
    .from(testResponses)
    .innerJoin(testAttempts, eq(testAttempts.id, testResponses.attemptId))
    .where(
      and(
        eq(testAttempts.testId, testId),
        isNotNull(testAttempts.submittedAt),
        isNull(testResponses.marksAwarded),
        isNull(testResponses.isCorrect),
        sql`${testResponses.responseJson} ->> 'text' is not null`,
      ),
    );
}

export async function getAttemptContext(attemptId: string) {
  const attempt = await getAttemptOrThrow(attemptId);
  const test = await getTestOrThrow(attempt.testId);
  return { attempt, test };
}
