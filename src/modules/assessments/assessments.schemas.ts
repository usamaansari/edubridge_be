import { z } from "zod";

import {
  difficultyEnum,
  questionTypeEnum,
  responseStatusEnum,
  solutionVisibilityEnum,
  testStatusEnum,
  testTypeEnum,
} from "../../db/index.js";
import { booleanish, isoDateTime, marks, paginationQuery } from "../../lib/validation.js";

// ---------------------------------------------------------------- Questions

export const optionSchema = z.object({
  optionText: z.string().trim().min(1),
  isCorrect: z.boolean().default(false),
  explanationHtml: z.string().trim().nullable().optional(),
});

export type OptionInput = z.output<typeof optionSchema>;

const questionFields = {
  subjectId: z.uuid(),
  chapterId: z.uuid().nullable().optional(),
  topicId: z.uuid().nullable().optional(),
  type: z.enum(questionTypeEnum.enumValues),
  difficulty: z.enum(difficultyEnum.enumValues),
  contentHtml: z.string().trim().min(1),
  solutionHtml: z.string().trim().nullable().optional(),
  hintHtml: z.string().trim().nullable().optional(),
  marksDefault: marks.optional(),
  negativeMarksDefault: marks.optional(),
  source: z.string().trim().max(100).nullable().optional(),
  yearOfAppearance: z.coerce.number().int().min(1950).max(2100).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).nullable().optional(),
  options: z.array(optionSchema).max(10),
};

export const createQuestionBody = z.object({ ...questionFields, options: questionFields.options.default([]) });

export const updateQuestionBody = z
  .object(questionFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field" });

export const listQuestionsQuery = paginationQuery.extend({
  subjectId: z.uuid().optional(),
  chapterId: z.uuid().optional(),
  topicId: z.uuid().optional(),
  type: z.enum(questionTypeEnum.enumValues).optional(),
  difficulty: z.enum(difficultyEnum.enumValues).optional(),
  isApproved: booleanish.optional(),
  source: z.string().trim().max(100).optional(),
  tag: z.string().trim().max(50).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  mine: booleanish.optional(),
});

// ---------------------------------------------------------------- Tests

export const markingSchemeSchema = z.object({
  sections: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        questionType: z.string().trim().min(1),
        correct: z.number(),
        incorrect: z.number(),
        unattempted: z.number().default(0),
      }),
    )
    .min(1),
});

export const testQuestionInput = z.object({
  questionId: z.uuid(),
  sectionName: z.string().trim().min(1).max(100),
  sequenceOrder: z.coerce.number().int().min(0).max(32767).optional(),
  marksCorrect: marks.optional(),
  marksIncorrect: marks.optional(),
  marksUnattempted: marks.optional(),
});

export type TestQuestionInput = z.output<typeof testQuestionInput>;

const testFields = {
  name: z.string().trim().min(3).max(255),
  type: z.enum(testTypeEnum.enumValues),
  batchId: z.uuid().nullable().optional(),
  programId: z.uuid(),
  instructionsHtml: z.string().trim().nullable().optional(),
  durationMinutes: z.coerce.number().int().min(5).max(600),
  markingSchemeJson: markingSchemeSchema,
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  showSolutionAfter: z.enum(solutionVisibilityEnum.enumValues).optional(),
  scheduledAt: isoDateTime.nullable().optional(),
  endsAt: isoDateTime.nullable().optional(),
  maxAttempts: z.coerce.number().int().min(1).max(20).optional(),
  isProctored: z.boolean().optional(),
};

export const createTestBody = z
  .object({ ...testFields, questions: z.array(testQuestionInput).max(300).default([]) })
  .refine((t) => !t.scheduledAt || !t.endsAt || t.endsAt > t.scheduledAt, {
    message: "endsAt must be after scheduledAt",
    path: ["endsAt"],
  });

export const updateTestBody = z
  .object(testFields)
  .omit({ programId: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field" });

export const testStatusBody = z.object({ status: z.enum(testStatusEnum.enumValues) });

export const listTestsQuery = paginationQuery.extend({
  batchId: z.uuid().optional(),
  programId: z.uuid().optional(),
  status: z.enum([...testStatusEnum.enumValues, "upcoming"]).optional(),
  type: z.enum(testTypeEnum.enumValues).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  mine: booleanish.optional(),
});

export const addTestQuestionsBody = z.object({
  questions: z.array(testQuestionInput).min(1).max(300),
});

export const testQuestionParams = z.object({ id: z.uuid(), questionId: z.uuid() });

// ---------------------------------------------------------------- Attempts

export const responsePayloadSchema = z
  .object({
    selected: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]$/)).max(10).optional(),
    value: z.number().finite().optional(),
    text: z.string().max(20_000).optional(),
  })
  .nullable();

export const saveResponsesBody = z.object({
  responses: z
    .array(
      z.object({
        questionId: z.uuid(),
        response: responsePayloadSchema.optional(),
        status: z.enum(responseStatusEnum.enumValues).optional(),
        timeSpentSec: z.coerce.number().int().min(0).max(32767).optional(),
      }),
    )
    .min(1)
    .max(300),
});

export type SaveResponsesInput = z.output<typeof saveResponsesBody>["responses"];

/** Matches the frontend's `TestAttemptPayload`; when `answers` is present the attempt is submitted at once. */
export const startAttemptBody = z.object({
  answers: z.record(z.uuid(), z.array(z.string())).optional(),
  timeTakenSec: z.coerce.number().int().min(0).optional(),
});

export const submitAttemptBody = z.object({
  tabSwitchCount: z.coerce.number().int().min(0).max(32767).optional(),
});

export const gradeParams = z.object({ id: z.uuid(), questionId: z.uuid() });

export const gradeBody = z.object({
  marksAwarded: z.coerce.number().min(-999.9).max(999.9),
  isCorrect: z.boolean().nullable().optional(),
});
