import { and, count, desc, eq, gte, inArray, isNull, lte, or, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  batches,
  db,
  feePayments,
  feeStatusEnum,
  feeStructures,
  paymentModeEnum,
  programs,
  scholarships,
  scholarshipTypeEnum,
  studentFees,
  userProfiles,
} from "../../db/index.js";
import {
  ADMIN_ROLES,
  assertCanViewStudent,
  getAccessibleBatchIds,
  getParentChildIds,
  getUserOrgIds,
  isAdmin,
  isSuperAdmin,
} from "../../lib/access.js";
import { ApiModule } from "../../lib/api-module.js";
import { fullName, todayIso } from "../../lib/dates.js";
import { badRequest, forbidden, notFound } from "../../lib/http-error.js";
import { offsetOf, paginate } from "../../lib/pagination.js";
import { booleanish, idParams, isoDate, isoDateTime, money, paginationQuery } from "../../lib/validation.js";
import type { AuthUser } from "../../middleware/auth.js";
import { assertUserRole } from "../users/users.service.js";
import {
  assertFeeAccess,
  assertInstallmentsMatch,
  assertStructureAccess,
  assignFee,
  getStructureOrThrow,
  getStudentFeeOrThrow,
  listPayments,
  markOverdueFees,
  recordPayment,
  updateFee,
} from "./financial.service.js";

const nonEmpty = { message: "Provide at least one field" };

/** Student ids a caller may see fee data for, or `null` when scoped by batch instead. */
async function feeStudentScope(user: AuthUser): Promise<string[] | null> {
  if (user.role === "student") return [user.id];
  if (user.role === "parent") return getParentChildIds(user.id);
  if (isAdmin(user)) return null;
  throw forbidden();
}

// ---------------------------------------------------------------- Fee structures

export const feeStructuresModule = new ApiModule("Fee Structures", "/fee-structures");

const installments = z
  .array(z.object({ due_date: isoDate, amount: z.number().positive() }))
  .max(24)
  .nullable()
  .optional();

const structureFields = {
  programId: z.uuid(),
  orgId: z.uuid().nullable().optional(),
  name: z.string().trim().min(3).max(100),
  totalAmount: money,
  currency: z.string().length(3).toUpperCase().default("INR"),
  installmentPlanJson: installments,
  validFrom: isoDate,
  validTo: isoDate.nullable().optional(),
  isActive: z.boolean().optional(),
};

feeStructuresModule
  .get(
    "/",
    {
      summary: "List fee structures",
      roles: ADMIN_ROLES,
      query: z.object({
        programId: z.uuid().optional(),
        orgId: z.uuid().optional(),
        isActive: booleanish.optional(),
      }),
    },
    async ({ user, query }) => {
      const conditions: SQL[] = [];
      if (!isSuperAdmin(user)) {
        const orgIds = await getUserOrgIds(user.id);
        conditions.push(or(isNull(feeStructures.orgId), orgIds.length ? inArray(feeStructures.orgId, orgIds) : undefined)!);
      }
      if (query.programId) conditions.push(eq(feeStructures.programId, query.programId));
      if (query.orgId) conditions.push(eq(feeStructures.orgId, query.orgId));
      if (query.isActive !== undefined) conditions.push(eq(feeStructures.isActive, query.isActive));
      return db
        .select({ structure: feeStructures, programName: programs.name })
        .from(feeStructures)
        .innerJoin(programs, eq(programs.id, feeStructures.programId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(feeStructures.validFrom))
        .then((rows) => rows.map((r) => ({ ...r.structure, programName: r.programName })));
    },
  )
  .post(
    "/",
    {
      summary: "Create a fee structure",
      description: "`orgId: null` makes it a platform default (super admin only). Installments must add up to `totalAmount`.",
      roles: ADMIN_ROLES,
      body: z.object(structureFields),
      status: 201,
    },
    async ({ user, body }) => {
      if (!isSuperAdmin(user)) {
        if (!body.orgId) throw forbidden("Centre admins must set orgId");
        if (!(await getUserOrgIds(user.id)).includes(body.orgId)) throw forbidden();
      }
      assertInstallmentsMatch(body.totalAmount, body.installmentPlanJson);
      if (body.validTo && body.validTo < body.validFrom) throw badRequest("validTo must be after validFrom");
      const [structure] = await db.insert(feeStructures).values(body).returning();
      return structure;
    },
  )
  .get(
    "/:id",
    { summary: "Get a fee structure", roles: ADMIN_ROLES, params: idParams },
    async ({ user, params }) => {
      const structure = await getStructureOrThrow(params.id);
      await assertStructureAccess(user, structure, false);
      return structure;
    },
  )
  .patch(
    "/:id",
    {
      summary: "Update a fee structure",
      description: "Existing student fees keep the amounts they were assigned with.",
      roles: ADMIN_ROLES,
      params: idParams,
      body: z
        .object(structureFields)
        .omit({ programId: true, orgId: true })
        .partial()
        .refine((v) => Object.keys(v).length > 0, nonEmpty),
    },
    async ({ user, params, body }) => {
      const structure = await getStructureOrThrow(params.id);
      await assertStructureAccess(user, structure, true);
      assertInstallmentsMatch(
        body.totalAmount ?? structure.totalAmount,
        body.installmentPlanJson !== undefined ? body.installmentPlanJson : structure.installmentPlanJson,
      );
      const [updated] = await db.update(feeStructures).set(body).where(eq(feeStructures.id, params.id)).returning();
      return updated;
    },
  )
  .delete(
    "/:id",
    { summary: "Deactivate a fee structure", roles: ADMIN_ROLES, params: idParams },
    async ({ user, params }) => {
      const structure = await getStructureOrThrow(params.id);
      await assertStructureAccess(user, structure, true);
      await db.update(feeStructures).set({ isActive: false }).where(eq(feeStructures.id, params.id));
    },
  );

// ---------------------------------------------------------------- Student fees

export const studentFeesModule = new ApiModule("Student Fees", "/student-fees");

studentFeesModule
  .get(
    "/",
    {
      summary: "List student fees",
      description: "Students see their own, parents their children's, admins the batches they manage.",
      query: paginationQuery.extend({
        studentId: z.uuid().optional(),
        batchId: z.uuid().optional(),
        status: z.enum(feeStatusEnum.enumValues).optional(),
        dueBefore: isoDate.optional(),
      }),
    },
    async ({ user, query }) => {
      const conditions: SQL[] = [];
      const students = await feeStudentScope(user);
      if (students) {
        if (!students.length) return paginate([], 0, query.page, query.limit);
        conditions.push(inArray(studentFees.studentId, students));
      } else {
        const batchIds = await getAccessibleBatchIds(user);
        if (batchIds) {
          if (!batchIds.length) return paginate([], 0, query.page, query.limit);
          conditions.push(inArray(studentFees.batchId, batchIds));
        }
      }
      if (query.studentId) conditions.push(eq(studentFees.studentId, query.studentId));
      if (query.batchId) conditions.push(eq(studentFees.batchId, query.batchId));
      if (query.status) conditions.push(eq(studentFees.status, query.status));
      if (query.dueBefore) conditions.push(lte(studentFees.nextDueDate, query.dueBefore));
      const where = conditions.length ? and(...conditions) : undefined;

      const [rows, [total]] = await Promise.all([
        db
          .select({
            fee: studentFees,
            structureName: feeStructures.name,
            currency: feeStructures.currency,
            batchName: batches.name,
            firstName: userProfiles.firstName,
            lastName: userProfiles.lastName,
          })
          .from(studentFees)
          .innerJoin(feeStructures, eq(feeStructures.id, studentFees.feeStructureId))
          .innerJoin(batches, eq(batches.id, studentFees.batchId))
          .leftJoin(userProfiles, eq(userProfiles.userId, studentFees.studentId))
          .where(where)
          .orderBy(desc(studentFees.createdAt))
          .limit(query.limit)
          .offset(offsetOf(query.page, query.limit)),
        db.select({ value: count() }).from(studentFees).where(where),
      ]);

      return paginate(
        rows.map((r) => ({
          ...r.fee,
          outstanding: (Number(r.fee.netAmount) - Number(r.fee.amountPaid)).toFixed(2),
          structureName: r.structureName,
          currency: r.currency,
          batchName: r.batchName,
          studentName: fullName(r.firstName, r.lastName),
        })),
        total?.value ?? 0,
        query.page,
        query.limit,
      );
    },
  )
  .post(
    "/",
    {
      summary: "Assign a fee to a student",
      description:
        "Base amount comes from the fee structure. Without `discountAmount`, the best active scholarship is applied (set `applyScholarship: false` to skip). The first due date comes from the installment plan.",
      roles: ADMIN_ROLES,
      body: z.object({
        studentId: z.uuid(),
        batchId: z.uuid(),
        feeStructureId: z.uuid(),
        discountAmount: money.optional(),
        applyScholarship: z.boolean().default(true),
        nextDueDate: isoDate.nullable().optional(),
      }),
      status: 201,
    },
    async ({ user, body }) => {
      const batchIds = await getAccessibleBatchIds(user);
      if (batchIds && !batchIds.includes(body.batchId)) throw forbidden("You do not manage this batch");
      return assignFee(user, body);
    },
  )
  .post(
    "/mark-overdue",
    {
      summary: "Run the overdue-fee job",
      description: "Marks unpaid fees past their due date as overdue and notifies students and parents. Normally run daily by a scheduler.",
      roles: ADMIN_ROLES,
    },
    async ({ user }) => markOverdueFees(await getAccessibleBatchIds(user)),
  )
  .get(
    "/:id",
    { summary: "Get a student fee with payments", params: idParams },
    async ({ user, params }) => {
      const fee = await getStudentFeeOrThrow(params.id);
      await assertFeeAccess(user, fee);
      const [structure, payments] = await Promise.all([
        getStructureOrThrow(fee.feeStructureId),
        listPayments([fee.id]),
      ]);
      return {
        ...fee,
        outstanding: (Number(fee.netAmount) - Number(fee.amountPaid)).toFixed(2),
        structure,
        payments,
      };
    },
  )
  .patch(
    "/:id",
    {
      summary: "Adjust discount, due date or waive",
      roles: ADMIN_ROLES,
      params: idParams,
      body: z
        .object({ discountAmount: money, nextDueDate: isoDate.nullable(), waive: z.boolean() })
        .partial()
        .refine((v) => Object.keys(v).length > 0, nonEmpty),
    },
    async ({ user, params, body }) => {
      const fee = await getStudentFeeOrThrow(params.id);
      await assertFeeAccess(user, fee, true);
      return updateFee(fee, body);
    },
  )
  .post(
    "/:id/payments",
    {
      summary: "Record a payment",
      description: "Generates a unique receipt number, updates the running total, status and next due date. Overpayment is rejected.",
      roles: ADMIN_ROLES,
      params: idParams,
      body: z.object({
        amount: money,
        paymentMode: z.enum(paymentModeEnum.enumValues),
        transactionRef: z.string().trim().max(100).nullable().optional(),
        paidAt: isoDateTime.optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
      }),
      status: 201,
    },
    async ({ user, params, body }) => {
      const fee = await getStudentFeeOrThrow(params.id);
      await assertFeeAccess(user, fee, true);
      return recordPayment(user, fee.id, body);
    },
  );

// ---------------------------------------------------------------- Payments

export const feePaymentsModule = new ApiModule("Fee Payments", "/fee-payments");

feePaymentsModule
  .get(
    "/",
    {
      summary: "List payments",
      query: paginationQuery.extend({
        studentFeeId: z.uuid().optional(),
        studentId: z.uuid().optional(),
        from: isoDateTime.optional(),
        to: isoDateTime.optional(),
        paymentMode: z.enum(paymentModeEnum.enumValues).optional(),
      }),
    },
    async ({ user, query }) => {
      const conditions: SQL[] = [];
      const students = await feeStudentScope(user);
      if (students) {
        if (!students.length) return paginate([], 0, query.page, query.limit);
        conditions.push(inArray(studentFees.studentId, students));
      } else {
        const batchIds = await getAccessibleBatchIds(user);
        if (batchIds) {
          if (!batchIds.length) return paginate([], 0, query.page, query.limit);
          conditions.push(inArray(studentFees.batchId, batchIds));
        }
      }
      if (query.studentFeeId) conditions.push(eq(feePayments.studentFeeId, query.studentFeeId));
      if (query.studentId) conditions.push(eq(studentFees.studentId, query.studentId));
      if (query.from) conditions.push(gte(feePayments.paidAt, query.from));
      if (query.to) conditions.push(lte(feePayments.paidAt, query.to));
      if (query.paymentMode) conditions.push(eq(feePayments.paymentMode, query.paymentMode));
      const where = conditions.length ? and(...conditions) : undefined;

      const [rows, [total]] = await Promise.all([
        db
          .select({ payment: feePayments, studentId: studentFees.studentId, firstName: userProfiles.firstName, lastName: userProfiles.lastName })
          .from(feePayments)
          .innerJoin(studentFees, eq(studentFees.id, feePayments.studentFeeId))
          .leftJoin(userProfiles, eq(userProfiles.userId, studentFees.studentId))
          .where(where)
          .orderBy(desc(feePayments.paidAt))
          .limit(query.limit)
          .offset(offsetOf(query.page, query.limit)),
        db
          .select({ value: count() })
          .from(feePayments)
          .innerJoin(studentFees, eq(studentFees.id, feePayments.studentFeeId))
          .where(where),
      ]);
      return paginate(
        rows.map((r) => ({ ...r.payment, studentId: r.studentId, studentName: fullName(r.firstName, r.lastName) })),
        total?.value ?? 0,
        query.page,
        query.limit,
      );
    },
  )
  .get(
    "/:id",
    { summary: "Get a payment receipt", params: idParams },
    async ({ user, params }) => {
      const [payment] = await db.select().from(feePayments).where(eq(feePayments.id, params.id));
      if (!payment) throw notFound("Payment");
      const fee = await getStudentFeeOrThrow(payment.studentFeeId);
      await assertFeeAccess(user, fee);
      return { ...payment, studentFee: fee };
    },
  );

// ---------------------------------------------------------------- Scholarships

export const scholarshipsModule = new ApiModule("Scholarships", "/scholarships");

const scholarshipFields = {
  studentId: z.uuid(),
  type: z.enum(scholarshipTypeEnum.enumValues),
  percentageWaiver: z.coerce.number().min(0).max(100).transform((v) => v.toFixed(2)),
  fixedWaiverAmount: money.nullable().optional(),
  validTill: isoDate.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
};

scholarshipsModule
  .get(
    "/",
    {
      summary: "List scholarships",
      query: z.object({
        studentId: z.uuid().optional(),
        type: z.enum(scholarshipTypeEnum.enumValues).optional(),
        activeOnly: booleanish.optional(),
      }),
    },
    async ({ user, query }) => {
      const conditions: SQL[] = [];
      const students = await feeStudentScope(user);
      if (students) {
        if (!students.length) return [];
        conditions.push(inArray(scholarships.studentId, students));
      }
      if (query.studentId) conditions.push(eq(scholarships.studentId, query.studentId));
      if (query.type) conditions.push(eq(scholarships.type, query.type));
      if (query.activeOnly) conditions.push(or(isNull(scholarships.validTill), gte(scholarships.validTill, todayIso()))!);
      const rows = await db
        .select({ scholarship: scholarships, firstName: userProfiles.firstName, lastName: userProfiles.lastName })
        .from(scholarships)
        .leftJoin(userProfiles, eq(userProfiles.userId, scholarships.studentId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(scholarships.awardedAt));
      return rows.map((r) => ({ ...r.scholarship, studentName: fullName(r.firstName, r.lastName) }));
    },
  )
  .post(
    "/",
    {
      summary: "Award a scholarship",
      description: "Applied automatically to fees assigned afterwards. Use `fixedWaiverAmount` for a flat discount instead of a percentage.",
      roles: ADMIN_ROLES,
      body: z.object(scholarshipFields),
      status: 201,
    },
    async ({ user, body }) => {
      await assertUserRole(body.studentId, ["student"], "studentId");
      await assertCanViewStudent(user, body.studentId);
      const [scholarship] = await db
        .insert(scholarships)
        .values({ ...body, awardedBy: user.id, awardedAt: new Date() })
        .returning();
      return scholarship;
    },
  )
  .patch(
    "/:id",
    {
      summary: "Update a scholarship",
      description: "To end a scholarship, set `validTill`. Records are never deleted.",
      roles: ADMIN_ROLES,
      params: idParams,
      body: z
        .object(scholarshipFields)
        .omit({ studentId: true })
        .partial()
        .refine((v) => Object.keys(v).length > 0, nonEmpty),
    },
    async ({ user, params, body }) => {
      const [existing] = await db.select().from(scholarships).where(eq(scholarships.id, params.id));
      if (!existing) throw notFound("Scholarship");
      await assertCanViewStudent(user, existing.studentId);
      const [updated] = await db.update(scholarships).set(body).where(eq(scholarships.id, params.id)).returning();
      return updated;
    },
  );
