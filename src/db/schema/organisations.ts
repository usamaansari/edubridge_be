import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  time,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { primaryId, timestamps, tz } from "./columns.js";
import { programs, subjects } from "./curriculum.js";
import {
  batchModeEnum,
  batchStatusEnum,
  enrollmentStatusEnum,
  orgStatusEnum,
  orgTypeEnum,
} from "./enums.js";
import { type Address, users } from "./users.js";

export const organisations = pgTable("organisations", {
  id: primaryId(),
  name: varchar({ length: 255 }).notNull(),
  type: orgTypeEnum().notNull(),
  code: varchar({ length: 20 }).notNull().unique(),
  addressJson: jsonb().$type<Address>().notNull(),
  contactEmail: varchar({ length: 255 }).notNull(),
  contactPhone: varchar({ length: 15 }).notNull(),
  principalName: varchar({ length: 100 }),
  affiliationBoard: varchar({ length: 50 }),
  partnershipStart: date({ mode: "string" }),
  logoUrl: text(),
  status: orgStatusEnum().notNull().default("pending"),
  metadataJson: jsonb().$type<Record<string, unknown>>(),
  deletedAt: tz(),
  ...timestamps(),
});

export const orgUsers = pgTable(
  "org_users",
  {
    id: primaryId(),
    orgId: uuid()
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleInOrg: varchar({ length: 50 }).notNull(),
    isPrimaryOrg: boolean().notNull().default(true),
    joinedAt: tz().notNull().defaultNow(),
    leftAt: tz(),
    ...timestamps(),
  },
  (t) => [
    unique("org_users_org_user_unique").on(t.orgId, t.userId),
    index("org_users_user_idx").on(t.userId),
  ],
);

export const batches = pgTable(
  "batches",
  {
    id: primaryId(),
    orgId: uuid()
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    programId: uuid()
      .notNull()
      .references(() => programs.id, { onDelete: "restrict" }),
    name: varchar({ length: 100 }).notNull(),
    mode: batchModeEnum().notNull(),
    capacity: smallint().notNull().default(60),
    startDate: date({ mode: "string" }).notNull(),
    endDate: date({ mode: "string" }).notNull(),
    academicYear: varchar({ length: 10 }).notNull(),
    classLevel: smallint().notNull(),
    status: batchStatusEnum().notNull().default("upcoming"),
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    index("batches_org_idx").on(t.orgId),
    index("batches_program_idx").on(t.programId),
    check("batches_class_level_check", sql`${t.classLevel} between 9 and 12`),
    check("batches_dates_check", sql`${t.endDate} >= ${t.startDate}`),
  ],
);

export const batchStudents = pgTable(
  "batch_students",
  {
    id: primaryId(),
    batchId: uuid()
      .notNull()
      .references(() => batches.id, { onDelete: "restrict" }),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    enrolledAt: tz().notNull().defaultNow(),
    enrollmentNo: varchar({ length: 30 }).notNull().unique(),
    status: enrollmentStatusEnum().notNull().default("active"),
    transferredFromBatchId: uuid().references(() => batches.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    unique("batch_students_batch_student_unique").on(t.batchId, t.studentId),
    index("batch_students_student_idx").on(t.studentId),
  ],
);

export const batchFaculty = pgTable(
  "batch_faculty",
  {
    id: primaryId(),
    batchId: uuid()
      .notNull()
      .references(() => batches.id, { onDelete: "restrict" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    subjectId: uuid().references(() => subjects.id, { onDelete: "restrict" }),
    role: varchar({ length: 20 }).notNull(),
    assignedAt: tz().notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    index("batch_faculty_batch_idx").on(t.batchId),
    index("batch_faculty_user_idx").on(t.userId),
  ],
);

export const timetableSlots = pgTable(
  "timetable_slots",
  {
    id: primaryId(),
    batchId: uuid()
      .notNull()
      .references(() => batches.id, { onDelete: "restrict" }),
    subjectId: uuid()
      .notNull()
      .references(() => subjects.id, { onDelete: "restrict" }),
    facultyId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    dayOfWeek: smallint().notNull(),
    startTime: time().notNull(),
    endTime: time().notNull(),
    roomOrLink: varchar({ length: 255 }),
    effectiveFrom: date({ mode: "string" }).notNull(),
    effectiveUntil: date({ mode: "string" }),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("timetable_slots_batch_idx").on(t.batchId),
    index("timetable_slots_faculty_idx").on(t.facultyId),
    check("timetable_slots_day_check", sql`${t.dayOfWeek} between 0 and 6`),
    check("timetable_slots_time_check", sql`${t.endTime} > ${t.startTime}`),
  ],
);

export type Organisation = typeof organisations.$inferSelect;
export type OrgUser = typeof orgUsers.$inferSelect;
export type Batch = typeof batches.$inferSelect;
export type BatchStudent = typeof batchStudents.$inferSelect;
export type BatchFaculty = typeof batchFaculty.$inferSelect;
export type TimetableSlot = typeof timetableSlots.$inferSelect;
