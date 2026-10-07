import { z } from "zod";

import { batchModeEnum, batchStatusEnum, enrollmentStatusEnum } from "../../db/index.js";
import { isoDate, paginationQuery, timeOfDay } from "../../lib/validation.js";

export const batchBody = z
  .object({
    orgId: z.uuid(),
    programId: z.uuid(),
    name: z.string().trim().min(3).max(100),
    mode: z.enum(batchModeEnum.enumValues),
    capacity: z.coerce.number().int().min(1).max(500).default(60),
    startDate: isoDate,
    endDate: isoDate,
    academicYear: z.string().regex(/^\d{4}-\d{2}$/, "Use the format 2025-26"),
    classLevel: z.coerce.number().int().min(9).max(12),
    status: z.enum(batchStatusEnum.enumValues).optional(),
  })
  .refine((b) => b.endDate >= b.startDate, { message: "endDate must be on or after startDate", path: ["endDate"] });

export const updateBatchBody = z
  .object({
    name: z.string().trim().min(3).max(100),
    mode: z.enum(batchModeEnum.enumValues),
    capacity: z.coerce.number().int().min(1).max(500),
    startDate: isoDate,
    endDate: isoDate,
    academicYear: z.string().regex(/^\d{4}-\d{2}$/),
    classLevel: z.coerce.number().int().min(9).max(12),
    status: z.enum(batchStatusEnum.enumValues),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field" });

export const listBatchesQuery = paginationQuery.extend({
  orgId: z.uuid().optional(),
  programId: z.uuid().optional(),
  status: z.enum(batchStatusEnum.enumValues).optional(),
  mode: z.enum(batchModeEnum.enumValues).optional(),
  academicYear: z.string().optional(),
  classLevel: z.coerce.number().int().min(9).max(12).optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

export const studentParams = z.object({ id: z.uuid(), studentId: z.uuid() });
export const facultyParams = z.object({ id: z.uuid(), assignmentId: z.uuid() });
export const slotParams = z.object({ id: z.uuid(), slotId: z.uuid() });

export const enrollBody = z.object({ studentId: z.uuid() });

export const enrollmentStatusBody = z.object({
  status: z.enum(enrollmentStatusEnum.enumValues).exclude(["transferred"]),
});

export const transferBody = z.object({ toBatchId: z.uuid() });

export const listStudentsQuery = z.object({
  status: z.enum(enrollmentStatusEnum.enumValues).optional(),
});

export const facultyBody = z.object({
  userId: z.uuid(),
  subjectId: z.uuid().nullable().optional(),
  role: z.enum(["teacher", "mentor", "co_teacher"]),
});

const slotFields = {
  subjectId: z.uuid(),
  facultyId: z.uuid(),
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  startTime: timeOfDay,
  endTime: timeOfDay,
  roomOrLink: z.string().trim().max(255).nullable().optional(),
  effectiveFrom: isoDate,
  effectiveUntil: isoDate.nullable().optional(),
};

export const slotBody = z
  .object(slotFields)
  .refine((s) => s.endTime > s.startTime, { message: "endTime must be after startTime", path: ["endTime"] });

export const updateSlotBody = z
  .object({ ...slotFields, isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field" });
