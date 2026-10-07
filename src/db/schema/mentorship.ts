import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { questionBank } from "./assessments.js";
import { primaryId, timestamps, tz } from "./columns.js";
import { contentItems, subjects, topics } from "./curriculum.js";
import {
  attendanceStatusEnum,
  doubtStatusEnum,
  goalStatusEnum,
  sessionStatusEnum,
} from "./enums.js";
import { batches, timetableSlots } from "./organisations.js";
import { users } from "./users.js";

export type ActionItem = { title: string; done?: boolean; dueDate?: string };

export const mentorAssignments = pgTable(
  "mentor_assignments",
  {
    id: primaryId(),
    mentorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    assignedAt: tz().notNull().defaultNow(),
    unassignedAt: tz(),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("mentor_assignments_active_unique")
      .on(t.mentorId, t.studentId)
      .where(sql`${t.isActive} = true`),
    index("mentor_assignments_student_idx").on(t.studentId),
  ],
);

export const mentorSessions = pgTable(
  "mentor_sessions",
  {
    id: primaryId(),
    mentorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    scheduledAt: tz().notNull(),
    durationMinutes: smallint().notNull().default(30),
    meetingLink: text(),
    status: sessionStatusEnum().notNull().default("scheduled"),
    conductedAt: tz(),
    notesHtml: text(),
    actionItemsJson: jsonb().$type<ActionItem[]>(),
    studentRating: smallint(),
    ...timestamps(),
  },
  (t) => [
    index("mentor_sessions_mentor_idx").on(t.mentorId),
    index("mentor_sessions_student_idx").on(t.studentId),
    check(
      "mentor_sessions_rating_check",
      sql`${t.studentRating} is null or ${t.studentRating} between 1 and 5`,
    ),
  ],
);

export const studentGoals = pgTable(
  "student_goals",
  {
    id: primaryId(),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    mentorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: varchar({ length: 255 }).notNull(),
    description: text(),
    dueDate: date({ mode: "string" }).notNull(),
    status: goalStatusEnum().notNull().default("open"),
    closedAt: tz(),
    ...timestamps(),
  },
  (t) => [index("student_goals_student_idx").on(t.studentId)],
);

export const doubts = pgTable(
  "doubts",
  {
    id: primaryId(),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    subjectId: uuid()
      .notNull()
      .references(() => subjects.id, { onDelete: "restrict" }),
    topicId: uuid().references(() => topics.id, { onDelete: "restrict" }),
    contentItemId: uuid().references(() => contentItems.id, { onDelete: "restrict" }),
    questionId: uuid().references(() => questionBank.id, { onDelete: "restrict" }),
    title: varchar({ length: 255 }).notNull(),
    bodyHtml: text().notNull(),
    mediaUrls: text().array(),
    status: doubtStatusEnum().notNull().default("open"),
    assignedTo: uuid().references(() => users.id, { onDelete: "restrict" }),
    assignedAt: tz(),
    resolvedAt: tz(),
    upvotes: integer().notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index("doubts_student_idx").on(t.studentId),
    index("doubts_status_idx").on(t.status),
    index("doubts_assigned_to_idx").on(t.assignedTo),
  ],
);

export const doubtReplies = pgTable(
  "doubt_replies",
  {
    id: primaryId(),
    doubtId: uuid()
      .notNull()
      .references(() => doubts.id, { onDelete: "cascade" }),
    authorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    bodyHtml: text().notNull(),
    mediaUrls: text().array(),
    isAcceptedAnswer: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [index("doubt_replies_doubt_idx").on(t.doubtId)],
);

export const attendance = pgTable(
  "attendance",
  {
    id: primaryId(),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    batchId: uuid()
      .notNull()
      .references(() => batches.id, { onDelete: "restrict" }),
    timetableSlotId: uuid()
      .notNull()
      .references(() => timetableSlots.id, { onDelete: "restrict" }),
    date: date({ mode: "string" }).notNull(),
    status: attendanceStatusEnum().notNull(),
    markedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    markedAt: tz().notNull().defaultNow(),
    note: varchar({ length: 255 }),
    ...timestamps(),
  },
  (t) => [
    unique("attendance_student_slot_date_unique").on(t.studentId, t.timetableSlotId, t.date),
    index("attendance_batch_date_idx").on(t.batchId, t.date),
  ],
);

export type MentorAssignment = typeof mentorAssignments.$inferSelect;
export type MentorSession = typeof mentorSessions.$inferSelect;
export type StudentGoal = typeof studentGoals.$inferSelect;
export type Doubt = typeof doubts.$inferSelect;
export type DoubtReply = typeof doubtReplies.$inferSelect;
export type Attendance = typeof attendance.$inferSelect;
