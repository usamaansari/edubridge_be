import { eq, sql } from "drizzle-orm";

import { db, testAttempts } from "../../db/index.js";
import { AUTHOR_ROLES } from "../../lib/access.js";
import { ApiModule } from "../../lib/api-module.js";
import { conflict, forbidden } from "../../lib/http-error.js";
import { idParams } from "../../lib/validation.js";
import { gradeBody, gradeParams, saveResponsesBody, submitAttemptBody } from "./assessments.schemas.js";
import {
  assertCanReadAttempt,
  buildResult,
  getAttemptContext,
  getPaper,
  gradeResponse,
  saveResponses,
  submitAttempt,
} from "./attempts.service.js";
import { assertCanManageTest } from "./tests.service.js";

export const attemptsModule = new ApiModule("Test Attempts", "/attempts");

attemptsModule
  .get(
    "/:id",
    {
      summary: "Get an attempt",
      description: "In-progress attempts return the question paper; submitted attempts return the result.",
      params: idParams,
    },
    async ({ user, params }) => {
      const { attempt, test } = await getAttemptContext(params.id);
      await assertCanReadAttempt(user, attempt, test);
      if (!attempt.submittedAt) {
        if (attempt.studentId !== user.id) return { attempt };
        return getPaper(attempt, test);
      }
      return buildResult(attempt, test, user);
    },
  )
  .put(
    "/:id/responses",
    {
      summary: "Save answers",
      description:
        "Upserts responses: `{ selected: ['A'] }`, `{ value: 42 }` or `{ text }`. `response: null` clears an answer. Saves after the deadline auto-submit the attempt.",
      roles: ["student"],
      params: idParams,
      body: saveResponsesBody,
    },
    async ({ user, params, body }) => {
      const { attempt, test } = await getAttemptContext(params.id);
      if (attempt.studentId !== user.id) throw forbidden();
      return saveResponses(attempt, test, body.responses);
    },
  )
  .post(
    "/:id/tab-switch",
    { summary: "Record a tab switch (proctoring)", roles: ["student"], params: idParams },
    async ({ user, params }) => {
      const { attempt } = await getAttemptContext(params.id);
      if (attempt.studentId !== user.id) throw forbidden();
      if (attempt.submittedAt) throw conflict("This attempt has already been submitted");
      const [updated] = await db
        .update(testAttempts)
        .set({ tabSwitchCount: sql`${testAttempts.tabSwitchCount} + 1` })
        .where(eq(testAttempts.id, attempt.id))
        .returning({ tabSwitchCount: testAttempts.tabSwitchCount });
      return updated;
    },
  )
  .post(
    "/:id/submit",
    {
      summary: "Submit an attempt",
      description: "Scores the attempt, recomputes ranks and percentiles, updates topic performance and notifies the student. Idempotent.",
      roles: ["student"],
      params: idParams,
      body: submitAttemptBody,
    },
    async ({ user, params, body }) => {
      const { attempt, test } = await getAttemptContext(params.id);
      if (attempt.studentId !== user.id) throw forbidden();
      const submitted = await submitAttempt(attempt.id, { tabSwitchCount: body.tabSwitchCount });
      return buildResult(submitted, test, user);
    },
  )
  .patch(
    "/:id/responses/:questionId/grade",
    {
      summary: "Grade a subjective answer",
      description: "Updates the response, the attempt score and the test's rankings.",
      roles: AUTHOR_ROLES,
      params: gradeParams,
      body: gradeBody,
    },
    async ({ user, params, body }) => {
      const { attempt, test } = await getAttemptContext(params.id);
      await assertCanManageTest(user, test);
      return gradeResponse(attempt, params.questionId, body);
    },
  );
