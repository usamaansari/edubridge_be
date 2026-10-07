import {
  boolean,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { primaryId, timestamps, tz } from "./columns.js";
import { chapters, programs, subjects, topics } from "./curriculum.js";
import {
  difficultyEnum,
  questionTypeEnum,
  responseStatusEnum,
  solutionVisibilityEnum,
  testStatusEnum,
  testTypeEnum,
} from "./enums.js";
import { batches } from "./organisations.js";
import { users } from "./users.js";

export type MarkingSchemeSection = {
  name: string;
  questionType: string;
  correct: number;
  incorrect: number;
  unattempted: number;
};

export type MarkingScheme = { sections: MarkingSchemeSection[] };

/** `{ selected: ['A','C'] }` for option questions, `{ value: 42 }` for integer, `{ text }` for subjective. */
export type ResponsePayload = {
  selected?: string[];
  value?: number;
  text?: string;
};

export const questionBank = pgTable(
  "question_bank",
  {
    id: primaryId(),
    subjectId: uuid()
      .notNull()
      .references(() => subjects.id, { onDelete: "restrict" }),
    chapterId: uuid().references(() => chapters.id, { onDelete: "restrict" }),
    topicId: uuid().references(() => topics.id, { onDelete: "restrict" }),
    type: questionTypeEnum().notNull(),
    difficulty: difficultyEnum().notNull(),
    contentHtml: text().notNull(),
    solutionHtml: text(),
    hintHtml: text(),
    marksDefault: numeric({ precision: 4, scale: 1 }).notNull().default("4"),
    negativeMarksDefault: numeric({ precision: 4, scale: 1 }).notNull().default("-1"),
    source: varchar({ length: 100 }),
    yearOfAppearance: smallint(),
    tags: text().array(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedBy: uuid().references(() => users.id, { onDelete: "restrict" }),
    isApproved: boolean().notNull().default(false),
    deletedAt: tz(),
    ...timestamps(),
  },
  (t) => [
    index("question_bank_subject_idx").on(t.subjectId),
    index("question_bank_topic_idx").on(t.topicId),
  ],
);

export const questionOptions = pgTable(
  "question_options",
  {
    id: primaryId(),
    questionId: uuid()
      .notNull()
      .references(() => questionBank.id, { onDelete: "cascade" }),
    optionText: text().notNull(),
    isCorrect: boolean().notNull().default(false),
    sequenceOrder: smallint().notNull(),
    explanationHtml: text(),
    ...timestamps(),
  },
  (t) => [index("question_options_question_idx").on(t.questionId)],
);

export const tests = pgTable(
  "tests",
  {
    id: primaryId(),
    name: varchar({ length: 255 }).notNull(),
    type: testTypeEnum().notNull(),
    batchId: uuid().references(() => batches.id, { onDelete: "restrict" }),
    programId: uuid()
      .notNull()
      .references(() => programs.id, { onDelete: "restrict" }),
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    instructionsHtml: text(),
    durationMinutes: smallint().notNull(),
    markingSchemeJson: jsonb().$type<MarkingScheme>().notNull(),
    shuffleQuestions: boolean().notNull().default(true),
    shuffleOptions: boolean().notNull().default(true),
    showSolutionAfter: solutionVisibilityEnum().notNull().default("after_submit"),
    scheduledAt: tz(),
    endsAt: tz(),
    maxAttempts: smallint().notNull().default(1),
    isProctored: boolean().notNull().default(false),
    status: testStatusEnum().notNull().default("draft"),
    ...timestamps(),
  },
  (t) => [index("tests_batch_idx").on(t.batchId), index("tests_status_idx").on(t.status)],
);

export const testQuestions = pgTable(
  "test_questions",
  {
    id: primaryId(),
    testId: uuid()
      .notNull()
      .references(() => tests.id, { onDelete: "cascade" }),
    questionId: uuid()
      .notNull()
      .references(() => questionBank.id, { onDelete: "restrict" }),
    sectionName: varchar({ length: 100 }).notNull(),
    sequenceOrder: smallint().notNull(),
    marksCorrect: numeric({ precision: 4, scale: 1 }).notNull(),
    marksIncorrect: numeric({ precision: 4, scale: 1 }).notNull(),
    marksUnattempted: numeric({ precision: 4, scale: 1 }).notNull().default("0"),
    ...timestamps(),
  },
  (t) => [unique("test_questions_test_question_unique").on(t.testId, t.questionId)],
);

export const testAttempts = pgTable(
  "test_attempts",
  {
    id: primaryId(),
    testId: uuid()
      .notNull()
      .references(() => tests.id, { onDelete: "restrict" }),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    attemptNumber: smallint().notNull().default(1),
    startedAt: tz().notNull().defaultNow(),
    submittedAt: tz(),
    autoSubmitted: boolean().notNull().default(false),
    score: numeric({ precision: 7, scale: 2 }),
    maxScore: numeric({ precision: 7, scale: 2 }),
    percentile: numeric({ precision: 5, scale: 2 }),
    rankInBatch: integer(),
    timeTakenSec: integer(),
    tabSwitchCount: smallint().notNull().default(0),
    ipAddress: inet(),
    ...timestamps(),
  },
  (t) => [
    unique("test_attempts_test_student_attempt_unique").on(t.testId, t.studentId, t.attemptNumber),
    index("test_attempts_student_idx").on(t.studentId),
  ],
);

export const testResponses = pgTable(
  "test_responses",
  {
    id: primaryId(),
    attemptId: uuid()
      .notNull()
      .references(() => testAttempts.id, { onDelete: "cascade" }),
    questionId: uuid()
      .notNull()
      .references(() => questionBank.id, { onDelete: "restrict" }),
    responseJson: jsonb().$type<ResponsePayload>(),
    status: responseStatusEnum().notNull().default("not_visited"),
    isCorrect: boolean(),
    marksAwarded: numeric({ precision: 4, scale: 1 }),
    timeSpentSec: smallint().notNull().default(0),
    ...timestamps(),
  },
  (t) => [unique("test_responses_attempt_question_unique").on(t.attemptId, t.questionId)],
);

export type Question = typeof questionBank.$inferSelect;
export type QuestionOption = typeof questionOptions.$inferSelect;
export type Test = typeof tests.$inferSelect;
export type NewTest = typeof tests.$inferInsert;
export type TestQuestion = typeof testQuestions.$inferSelect;
export type TestAttempt = typeof testAttempts.$inferSelect;
export type TestResponse = typeof testResponses.$inferSelect;
