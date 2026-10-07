import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryId, timestamps, tz } from "./columns.js";
import { topics } from "./curriculum.js";
import { users } from "./users.js";

export const studentAnalyticsSnapshots = pgTable(
  "student_analytics_snapshots",
  {
    id: primaryId(),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    snapshotDate: date({ mode: "string" }).notNull(),
    overallScorePct: numeric({ precision: 5, scale: 2 }),
    subjectScoresJson: jsonb().$type<Record<string, number>>(),
    weakTopicsJson: jsonb().$type<string[]>(),
    strongTopicsJson: jsonb().$type<string[]>(),
    predictedRank: integer(),
    studyHoursToday: numeric({ precision: 4, scale: 2 }),
    studyHoursWeek: numeric({ precision: 5, scale: 2 }),
    dppCompletionPct: numeric({ precision: 5, scale: 2 }),
    streakDays: smallint().notNull().default(0),
    isAtRisk: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [unique("student_analytics_snapshots_student_date_unique").on(t.studentId, t.snapshotDate)],
);

export const topicPerformance = pgTable(
  "topic_performance",
  {
    id: primaryId(),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    topicId: uuid()
      .notNull()
      .references(() => topics.id, { onDelete: "restrict" }),
    totalQuestionsAttempted: integer().notNull().default(0),
    correctCount: integer().notNull().default(0),
    accuracyPct: numeric({ precision: 5, scale: 2 }),
    avgTimePerQSec: numeric({ precision: 6, scale: 2 }),
    lastAttemptedAt: tz(),
    ...timestamps(),
  },
  (t) => [unique("topic_performance_student_topic_unique").on(t.studentId, t.topicId)],
);

export type StudentAnalyticsSnapshot = typeof studentAnalyticsSnapshots.$inferSelect;
export type TopicPerformance = typeof topicPerformance.$inferSelect;
