import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { primaryId, timestamps, tz } from "./columns.js";
import { contentTypeEnum, difficultyEnum, examTypeEnum } from "./enums.js";
import { users } from "./users.js";

export const programs = pgTable("programs", {
  id: primaryId(),
  name: varchar({ length: 150 }).notNull(),
  slug: varchar({ length: 150 }).notNull().unique(),
  examType: examTypeEnum().notNull(),
  targetClass: smallint().array().notNull(),
  description: text(),
  durationMonths: smallint().notNull(),
  isActive: boolean().notNull().default(true),
  thumbnailUrl: text(),
  ...timestamps(),
});

export const subjects = pgTable(
  "subjects",
  {
    id: primaryId(),
    programId: uuid()
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    name: varchar({ length: 100 }).notNull(),
    code: varchar({ length: 20 }).notNull(),
    sequenceOrder: smallint().notNull(),
    iconUrl: text(),
    ...timestamps(),
  },
  (t) => [unique("subjects_program_code_unique").on(t.programId, t.code)],
);

export const chapters = pgTable(
  "chapters",
  {
    id: primaryId(),
    subjectId: uuid()
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    name: varchar({ length: 200 }).notNull(),
    sequenceOrder: smallint().notNull(),
    ncertRef: varchar({ length: 50 }),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [index("chapters_subject_idx").on(t.subjectId)],
);

export const topics = pgTable(
  "topics",
  {
    id: primaryId(),
    chapterId: uuid()
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    name: varchar({ length: 200 }).notNull(),
    sequenceOrder: smallint().notNull(),
    difficultyTag: difficultyEnum().notNull().default("medium"),
    estimatedMinutes: smallint(),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [index("topics_chapter_idx").on(t.chapterId)],
);

export const contentItems = pgTable(
  "content_items",
  {
    id: primaryId(),
    topicId: uuid()
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    type: contentTypeEnum().notNull(),
    title: varchar({ length: 255 }).notNull(),
    description: text(),
    url: text(),
    muxAssetId: varchar({ length: 100 }),
    muxPlaybackId: varchar({ length: 100 }),
    durationSec: integer(),
    fileSizeBytes: bigint({ mode: "number" }),
    sequenceOrder: smallint().notNull(),
    isPublished: boolean().notNull().default(false),
    releasedAt: tz(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    deletedAt: tz(),
    ...timestamps(),
  },
  (t) => [index("content_items_topic_idx").on(t.topicId)],
);

export const studentContentProgress = pgTable(
  "student_content_progress",
  {
    id: primaryId(),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentItemId: uuid()
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    watchedPct: smallint().notNull().default(0),
    completed: boolean().notNull().default(false),
    bookmarked: boolean().notNull().default(false),
    lastPositionSec: integer(),
    lastAccessedAt: tz().notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [unique("student_content_progress_unique").on(t.studentId, t.contentItemId)],
);

export type Program = typeof programs.$inferSelect;
export type Subject = typeof subjects.$inferSelect;
export type Chapter = typeof chapters.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type ContentItem = typeof contentItems.$inferSelect;
export type NewContentItem = typeof contentItems.$inferInsert;
export type StudentContentProgress = typeof studentContentProgress.$inferSelect;
