import {
  boolean,
  char,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { primaryId, timestamps, tz } from "./columns.js";
import { programs } from "./curriculum.js";
import { feeStatusEnum, paymentModeEnum, scholarshipTypeEnum } from "./enums.js";
import { batches, organisations } from "./organisations.js";
import { users } from "./users.js";

export type Installment = { due_date: string; amount: number };

export const feeStructures = pgTable("fee_structures", {
  id: primaryId(),
  programId: uuid()
    .notNull()
    .references(() => programs.id, { onDelete: "restrict" }),
  orgId: uuid().references(() => organisations.id, { onDelete: "restrict" }),
  name: varchar({ length: 100 }).notNull(),
  totalAmount: numeric({ precision: 10, scale: 2 }).notNull(),
  currency: char({ length: 3 }).notNull().default("INR"),
  installmentPlanJson: jsonb().$type<Installment[]>(),
  validFrom: date({ mode: "string" }).notNull(),
  validTo: date({ mode: "string" }),
  isActive: boolean().notNull().default(true),
  ...timestamps(),
});

export const studentFees = pgTable(
  "student_fees",
  {
    id: primaryId(),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    batchId: uuid()
      .notNull()
      .references(() => batches.id, { onDelete: "restrict" }),
    feeStructureId: uuid()
      .notNull()
      .references(() => feeStructures.id, { onDelete: "restrict" }),
    baseAmount: numeric({ precision: 10, scale: 2 }).notNull(),
    discountAmount: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    netAmount: numeric({ precision: 10, scale: 2 }).notNull(),
    amountPaid: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    status: feeStatusEnum().notNull().default("pending"),
    nextDueDate: date({ mode: "string" }),
    ...timestamps(),
  },
  (t) => [
    index("student_fees_student_idx").on(t.studentId),
    index("student_fees_status_idx").on(t.status),
  ],
);

export const feePayments = pgTable(
  "fee_payments",
  {
    id: primaryId(),
    studentFeeId: uuid()
      .notNull()
      .references(() => studentFees.id, { onDelete: "restrict" }),
    amount: numeric({ precision: 10, scale: 2 }).notNull(),
    paymentMode: paymentModeEnum().notNull(),
    transactionRef: varchar({ length: 100 }),
    receiptNo: varchar({ length: 50 }).notNull().unique(),
    paidAt: tz().notNull(),
    recordedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    notes: text(),
    ...timestamps(),
  },
  (t) => [index("fee_payments_student_fee_idx").on(t.studentFeeId)],
);

export const scholarships = pgTable(
  "scholarships",
  {
    id: primaryId(),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: scholarshipTypeEnum().notNull(),
    percentageWaiver: numeric({ precision: 5, scale: 2 }).notNull(),
    fixedWaiverAmount: numeric({ precision: 10, scale: 2 }),
    awardedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    awardedAt: tz().notNull().defaultNow(),
    validTill: date({ mode: "string" }),
    notes: text(),
    ...timestamps(),
  },
  (t) => [index("scholarships_student_idx").on(t.studentId)],
);

export type FeeStructure = typeof feeStructures.$inferSelect;
export type StudentFee = typeof studentFees.$inferSelect;
export type FeePayment = typeof feePayments.$inferSelect;
export type Scholarship = typeof scholarships.$inferSelect;
