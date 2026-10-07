import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, programs, tests } from "../../db/index.js";
import {
  AUTHOR_ROLES,
  assertBatchAccess,
  assertCanViewStudent,
  isAdmin,
  STAFF_ROLES,
} from "../../lib/access.js";
import { ApiModule } from "../../lib/api-module.js";
import { badRequest, forbidden, notFound } from "../../lib/http-error.js";
import { booleanish, idParams } from "../../lib/validation.js";
import {
  addTestQuestionsBody,
  createTestBody,
  listTestsQuery,
  startAttemptBody,
  testQuestionParams,
  testStatusBody,
  updateTestBody,
} from "./assessments.schemas.js";
import {
  buildResult,
  getLatestSubmittedAttempt,
  getPaper,
  listTestAttempts,
  pendingGrading,
  saveAnswerMap,
  startAttempt,
  submitAttempt,
} from "./attempts.service.js";
import {
  addQuestions,
  assertCanManageTest,
  assertCanViewTest,
  assertTestEditable,
  changeStatus,
  getTestOrThrow,
  getTestSummary,
  listTestQuestions,
  listTests,
  removeQuestion,
} from "./tests.service.js";

export const testsModule = new ApiModule("Tests", "/tests");

testsModule
  .get(
    "/",
    {
      summary: "List tests",
      description:
        "Students see tests for their batches and open practice tests of their programs, each with `myAttempt`. `status=upcoming` returns scheduled tests that have not started.",
      query: listTestsQuery,
    },
    ({ user, query }) => listTests(user, query),
  )
  .post(
    "/",
    {
      summary: "Create a test",
      description:
        "Optionally include `questions`. Marks default to the marking-scheme section (matched by name, then question type), then to the question's defaults.",
      roles: AUTHOR_ROLES,
      body: createTestBody,
      status: 201,
    },
    async ({ user, body }) => {
      const [program] = await db.select({ id: programs.id }).from(programs).where(eq(programs.id, body.programId));
      if (!program) throw badRequest("programId does not exist");
      if (body.batchId) {
        const batch = await assertBatchAccess(user, body.batchId, isAdmin(user));
        if (batch.programId !== body.programId) throw badRequest("The batch belongs to a different program");
      } else if (!isAdmin(user)) {
        throw forbidden("Only admins can create open practice tests without a batch");
      }

      const { questions, ...values } = body;
      return db.transaction(async (tx) => {
        const [test] = await tx.insert(tests).values({ ...values, createdBy: user.id }).returning();
        if (questions.length) await addQuestions(test!, questions, tx);
        return test;
      });
    },
  )
  .get(
    "/:id",
    {
      summary: "Get a test",
      description: "Returns metadata and totals. Students also get their attempts and remaining attempts. Questions are only served through an attempt.",
      params: idParams,
    },
    async ({ user, params }) => {
      const test = await getTestOrThrow(params.id);
      await assertCanViewTest(user, test);
      return getTestSummary(user, test);
    },
  )
  .patch(
    "/:id",
    {
      summary: "Update a test",
      description: "Only draft or scheduled tests without attempts can be edited.",
      roles: AUTHOR_ROLES,
      params: idParams,
      body: updateTestBody,
    },
    async ({ user, params, body }) => {
      const test = await getTestOrThrow(params.id);
      await assertCanManageTest(user, test);
      await assertTestEditable(test);
      const scheduledAt = body.scheduledAt !== undefined ? body.scheduledAt : test.scheduledAt;
      const endsAt = body.endsAt !== undefined ? body.endsAt : test.endsAt;
      if (scheduledAt && endsAt && endsAt <= scheduledAt) throw badRequest("endsAt must be after scheduledAt");
      if (body.batchId) {
        const batch = await assertBatchAccess(user, body.batchId, isAdmin(user));
        if (batch.programId !== test.programId) throw badRequest("The batch belongs to a different program");
      }
      const [updated] = await db.update(tests).set(body).where(eq(tests.id, params.id)).returning();
      return updated;
    },
  )
  .patch(
    "/:id/status",
    {
      summary: "Change test status",
      description:
        "draft → scheduled/live → completed → archived. Publishing requires at least one question and that every question is approved. Batch students are notified.",
      roles: AUTHOR_ROLES,
      params: idParams,
      body: testStatusBody,
    },
    async ({ user, params, body }) => {
      const test = await getTestOrThrow(params.id);
      await assertCanManageTest(user, test);
      return changeStatus(test, body.status);
    },
  )
  .delete(
    "/:id",
    { summary: "Archive a test", roles: AUTHOR_ROLES, params: idParams },
    async ({ user, params }) => {
      const test = await getTestOrThrow(params.id);
      await assertCanManageTest(user, test);
      await db.update(tests).set({ status: "archived" }).where(eq(tests.id, params.id));
    },
  )
  .get(
    "/:id/questions",
    { summary: "List test questions with answers", roles: STAFF_ROLES, params: idParams },
    async ({ user, params }) => {
      const test = await getTestOrThrow(params.id);
      await assertCanViewTest(user, test);
      return listTestQuestions(test.id);
    },
  )
  .post(
    "/:id/questions",
    { summary: "Add questions to a test", roles: AUTHOR_ROLES, params: idParams, body: addTestQuestionsBody, status: 201 },
    async ({ user, params, body }) => {
      const test = await getTestOrThrow(params.id);
      await assertCanManageTest(user, test);
      await assertTestEditable(test);
      return addQuestions(test, body.questions);
    },
  )
  .delete(
    "/:id/questions/:questionId",
    { summary: "Remove a question from a test", roles: AUTHOR_ROLES, params: testQuestionParams },
    async ({ user, params }) => {
      const test = await getTestOrThrow(params.id);
      await assertCanManageTest(user, test);
      await assertTestEditable(test);
      await removeQuestion(test.id, params.questionId);
    },
  )
  .post(
    "/:id/attempts",
    {
      summary: "Start (or resume) an attempt",
      description:
        "Returns the question paper for the open attempt. If the body contains `answers` (`{ [questionId]: ['A','C'] }` or `['42']` for integer questions), the attempt is saved and submitted at once and the result is returned — this matches the frontend's `testsApi.submit`.",
      roles: ["student"],
      params: idParams,
      body: startAttemptBody,
      status: 201,
    },
    async ({ req, user, params, body }) => {
      const test = await getTestOrThrow(params.id);
      const attempt = await startAttempt(user, test, req.ip);
      if (!body.answers) return getPaper(attempt, test);

      await saveAnswerMap(attempt, test, body.answers);
      const submitted = await submitAttempt(attempt.id, { timeTakenSec: body.timeTakenSec });
      return buildResult(submitted, test, user);
    },
  )
  .get(
    "/:id/result",
    {
      summary: "Get a result",
      description:
        "Latest submitted attempt of the caller (students) or of `studentId` (staff/parents). Solutions are included according to the test's `show_solution_after`.",
      params: idParams,
      query: z.object({ studentId: z.uuid().optional() }),
    },
    async ({ user, params, query }) => {
      const test = await getTestOrThrow(params.id);
      const studentId = user.role === "student" ? user.id : query.studentId;
      if (!studentId) throw badRequest("studentId is required");
      if (studentId !== user.id) await assertCanViewStudent(user, studentId);
      else await assertCanViewTest(user, test);
      const attempt = await getLatestSubmittedAttempt(test.id, studentId);
      if (!attempt) throw notFound("Submitted attempt");
      return buildResult(attempt, test, user);
    },
  )
  .get(
    "/:id/attempts",
    {
      summary: "Leaderboard / all attempts",
      roles: STAFF_ROLES,
      params: idParams,
      query: z.object({ includeInProgress: booleanish.optional() }),
    },
    async ({ user, params, query }) => {
      const test = await getTestOrThrow(params.id);
      await assertCanViewTest(user, test);
      return listTestAttempts(test.id, query.includeInProgress ?? false);
    },
  )
  .get(
    "/:id/pending-grading",
    { summary: "Subjective answers awaiting grading", roles: AUTHOR_ROLES, params: idParams },
    async ({ user, params }) => {
      const test = await getTestOrThrow(params.id);
      await assertCanManageTest(user, test);
      return pendingGrading(test.id);
    },
  );
