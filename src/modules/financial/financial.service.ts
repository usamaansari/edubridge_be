import { and, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";

import {
  batchStudents,
  db,
  type FeeStatus,
  type FeeStructure,
  feePayments,
  feeStructures,
  type Installment,
  type StudentFee,
  scholarships,
  studentFees,
} from "../../db/index.js";
import {
  getAccessibleBatchIds,
  getBatchOrThrow,
  getParentChildIds,
  getUserOrgIds,
  isSuperAdmin,
} from "../../lib/access.js";
import { generateReceiptNo } from "../../lib/crypto.js";
import { todayIso } from "../../lib/dates.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/http-error.js";
import { getPgError, PG_UNIQUE_VIOLATION } from "../../lib/pg-error.js";
import type { AuthUser } from "../../middleware/auth.js";
import { getParentIds, notify } from "../notifications/notifications.service.js";

export const toCents = (value: string | number) => Math.round(Number(value) * 100);
export const fromCents = (cents: number) => (cents / 100).toFixed(2);

export function assertInstallmentsMatch(total: string, plan: Installment[] | null | undefined) {
  if (!plan?.length) return;
  const sum = plan.reduce((acc, i) => acc + toCents(i.amount), 0);
  if (sum !== toCents(total)) throw badRequest("Installment amounts must add up to totalAmount");
}

/** Next unpaid installment's due date, scaling the plan to the student's net amount. */
export function nextDueDate(structure: FeeStructure, netCents: number, paidCents: number): string | null {
  const plan = [...(structure.installmentPlanJson ?? [])].sort((a, b) => a.due_date.localeCompare(b.due_date));
  if (!plan.length || paidCents >= netCents) return null;
  const totalCents = toCents(structure.totalAmount) || 1;
  let cumulative = 0;
  for (const installment of plan) {
    cumulative += Math.round((toCents(installment.amount) * netCents) / totalCents);
    if (cumulative > paidCents) return installment.due_date;
  }
  return plan.at(-1)?.due_date ?? null;
}

export function deriveStatus(netCents: number, paidCents: number, dueDate: string | null, current?: FeeStatus): FeeStatus {
  if (current === "waived") return "waived";
  if (paidCents >= netCents) return "paid";
  if (dueDate && dueDate < todayIso()) return "overdue";
  return paidCents > 0 ? "partial" : "pending";
}

export async function getStructureOrThrow(id: string) {
  const [structure] = await db.select().from(feeStructures).where(eq(feeStructures.id, id));
  if (!structure) throw notFound("Fee structure");
  return structure;
}

/** super_admin: any; centre_admin: platform defaults (read-only) and their orgs' structures. */
export async function assertStructureAccess(user: AuthUser, structure: FeeStructure, manage: boolean) {
  if (isSuperAdmin(user)) return;
  if (!structure.orgId) {
    if (manage) throw forbidden("Only super admins can change platform-default fee structures");
    return;
  }
  if (!(await getUserOrgIds(user.id)).includes(structure.orgId)) throw forbidden();
}

/** Largest single active waiver, capped at the base amount. */
export async function scholarshipDiscountCents(studentId: string, baseCents: number) {
  const rows = await db
    .select()
    .from(scholarships)
    .where(
      and(
        eq(scholarships.studentId, studentId),
        or(isNull(scholarships.validTill), gte(scholarships.validTill, todayIso())),
      ),
    );
  const best = rows.reduce((acc, s) => {
    const waiver = s.fixedWaiverAmount
      ? toCents(s.fixedWaiverAmount)
      : Math.round((baseCents * Number(s.percentageWaiver)) / 100);
    return Math.max(acc, waiver);
  }, 0);
  return Math.min(best, baseCents);
}

export async function getStudentFeeOrThrow(id: string) {
  const [fee] = await db.select().from(studentFees).where(eq(studentFees.id, id));
  if (!fee) throw notFound("Student fee");
  return fee;
}

/** Students see their own fees, parents their children's, admins the fees of batches they manage. */
export async function assertFeeAccess(user: AuthUser, fee: StudentFee, manage = false) {
  if (!manage) {
    if (fee.studentId === user.id) return;
    if (user.role === "parent" && (await getParentChildIds(user.id)).includes(fee.studentId)) return;
  }
  if (user.role === "super_admin" || user.role === "centre_admin") {
    const accessible = await getAccessibleBatchIds(user);
    if (accessible === null || accessible.includes(fee.batchId)) return;
  }
  throw forbidden();
}

export async function assignFee(
  user: AuthUser,
  input: {
    studentId: string;
    batchId: string;
    feeStructureId: string;
    discountAmount?: string;
    applyScholarship: boolean;
    nextDueDate?: string | null;
  },
) {
  const batch = await getBatchOrThrow(input.batchId);
  const structure = await getStructureOrThrow(input.feeStructureId);
  await assertStructureAccess(user, structure, false);
  if (!structure.isActive) throw badRequest("The fee structure is not active");
  if (structure.programId !== batch.programId) throw badRequest("The fee structure is for a different program");
  if (structure.orgId && structure.orgId !== batch.orgId) throw badRequest("The fee structure belongs to another organisation");

  const [enrollment] = await db
    .select({ id: batchStudents.id })
    .from(batchStudents)
    .where(and(eq(batchStudents.batchId, batch.id), eq(batchStudents.studentId, input.studentId)));
  if (!enrollment) throw badRequest("The student is not enrolled in this batch");

  const [existing] = await db
    .select({ id: studentFees.id })
    .from(studentFees)
    .where(
      and(
        eq(studentFees.studentId, input.studentId),
        eq(studentFees.batchId, batch.id),
        eq(studentFees.feeStructureId, structure.id),
      ),
    );
  if (existing) throw conflict("This fee has already been assigned to the student");

  const baseCents = toCents(structure.totalAmount);
  const discountCents =
    input.discountAmount !== undefined
      ? toCents(input.discountAmount)
      : input.applyScholarship
        ? await scholarshipDiscountCents(input.studentId, baseCents)
        : 0;
  if (discountCents > baseCents) throw badRequest("discountAmount cannot exceed the fee amount");
  const netCents = baseCents - discountCents;
  const dueDate = input.nextDueDate !== undefined ? input.nextDueDate : nextDueDate(structure, netCents, 0);

  const [fee] = await db
    .insert(studentFees)
    .values({
      studentId: input.studentId,
      batchId: batch.id,
      feeStructureId: structure.id,
      baseAmount: fromCents(baseCents),
      discountAmount: fromCents(discountCents),
      netAmount: fromCents(netCents),
      status: deriveStatus(netCents, 0, dueDate),
      nextDueDate: dueDate,
    })
    .returning();
  return fee;
}

export async function updateFee(
  fee: StudentFee,
  patch: { discountAmount?: string; nextDueDate?: string | null; waive?: boolean },
) {
  const baseCents = toCents(fee.baseAmount);
  const discountCents = patch.discountAmount !== undefined ? toCents(patch.discountAmount) : toCents(fee.discountAmount);
  if (discountCents > baseCents) throw badRequest("discountAmount cannot exceed the base amount");
  const netCents = baseCents - discountCents;
  const paidCents = toCents(fee.amountPaid);
  if (paidCents > netCents) throw badRequest("The discount would make the amount already paid exceed the net amount");

  const dueDate = patch.nextDueDate !== undefined ? patch.nextDueDate : fee.nextDueDate;
  const status = patch.waive ? "waived" : deriveStatus(netCents, paidCents, dueDate, patch.waive === false ? undefined : fee.status);

  const [updated] = await db
    .update(studentFees)
    .set({ discountAmount: fromCents(discountCents), netAmount: fromCents(netCents), nextDueDate: dueDate, status })
    .where(eq(studentFees.id, fee.id))
    .returning();
  return updated;
}

export async function recordPayment(
  user: AuthUser,
  feeId: string,
  input: { amount: string; paymentMode: (typeof feePayments.$inferInsert)["paymentMode"]; transactionRef?: string | null; paidAt?: Date; notes?: string | null },
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [fee] = await tx.select().from(studentFees).where(eq(studentFees.id, feeId)).for("update");
        if (!fee) throw notFound("Student fee");
        if (fee.status === "waived") throw conflict("This fee has been waived");

        const amountCents = toCents(input.amount);
        const netCents = toCents(fee.netAmount);
        const paidCents = toCents(fee.amountPaid);
        if (amountCents <= 0) throw badRequest("amount must be greater than zero");
        if (paidCents + amountCents > netCents) {
          throw badRequest(`amount exceeds the outstanding balance of ${fromCents(netCents - paidCents)}`);
        }

        const paidAt = input.paidAt ?? new Date();
        const [payment] = await tx
          .insert(feePayments)
          .values({
            studentFeeId: fee.id,
            amount: fromCents(amountCents),
            paymentMode: input.paymentMode,
            transactionRef: input.transactionRef ?? null,
            receiptNo: generateReceiptNo(paidAt),
            paidAt,
            recordedBy: user.id,
            notes: input.notes ?? null,
          })
          .returning();

        const [structure] = await tx.select().from(feeStructures).where(eq(feeStructures.id, fee.feeStructureId));
        const newPaid = paidCents + amountCents;
        const dueDate = structure ? nextDueDate(structure, netCents, newPaid) : fee.nextDueDate;
        const [updatedFee] = await tx
          .update(studentFees)
          .set({ amountPaid: fromCents(newPaid), nextDueDate: dueDate, status: deriveStatus(netCents, newPaid, dueDate) })
          .where(eq(studentFees.id, fee.id))
          .returning();
        return { payment, studentFee: updatedFee };
      });
    } catch (err) {
      const pg = getPgError(err);
      if (pg?.code === PG_UNIQUE_VIOLATION && pg.constraint?.includes("receipt_no")) continue;
      throw err;
    }
  }
  throw new Error("Could not allocate a unique receipt number");
}

/** Daily job: flags unpaid fees past their due date and reminds students and parents. */
export async function markOverdueFees(batchIds: string[] | null) {
  const conditions = [
    inArray(studentFees.status, ["pending", "partial"] as FeeStatus[]),
    lt(studentFees.nextDueDate, todayIso()),
  ];
  if (batchIds) {
    if (!batchIds.length) return { updated: 0 };
    conditions.push(inArray(studentFees.batchId, batchIds));
  }
  const updated = await db
    .update(studentFees)
    .set({ status: "overdue" })
    .where(and(...conditions))
    .returning();

  for (const fee of updated) {
    const outstanding = fromCents(toCents(fee.netAmount) - toCents(fee.amountPaid));
    await notify({
      userIds: [fee.studentId, ...(await getParentIds(fee.studentId))],
      type: "fee_due",
      title: "Fee payment overdue",
      body: `A fee instalment was due on ${fee.nextDueDate}. Outstanding balance: ₹${outstanding}.`,
      data: { entity_type: "student_fee", entity_id: fee.id },
      channels: ["push", "email", "sms"],
    });
  }
  return { updated: updated.length };
}

export async function listPayments(feeIds: string[]) {
  if (!feeIds.length) return [];
  return db
    .select()
    .from(feePayments)
    .where(inArray(feePayments.studentFeeId, feeIds))
    .orderBy(desc(feePayments.paidAt));
}
