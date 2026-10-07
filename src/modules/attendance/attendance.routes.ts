import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  attendance,
  attendanceStatusEnum,
  batchFaculty,
  batchStudents,
  db,
  subjects,
  timetableSlots,
  userProfiles,
} from "../../db/index.js";
import {
  assertBatchAccess,
  assertCanViewStudent,
  isAdmin,
  isOrgStaff,
  STAFF_ROLES,
} from "../../lib/access.js";
import { ApiModule } from "../../lib/api-module.js";
import { fullName, round } from "../../lib/dates.js";
import { badRequest, forbidden, notFound } from "../../lib/http-error.js";
import { idParams, isoDate } from "../../lib/validation.js";
import type { AuthUser } from "../../middleware/auth.js";
import { getParentIds, notify } from "../notifications/notifications.service.js";

export const attendanceModule = new ApiModule("Attendance", "/attendance");

const bulkBody = z.object({
  batchId: z.uuid(),
  timetableSlotId: z.uuid(),
  date: isoDate,
  records: z
    .array(
      z.object({
        studentId: z.uuid(),
        status: z.enum(attendanceStatusEnum.enumValues),
        note: z.string().trim().max(255).nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
  notifyParentsOfAbsence: z.boolean().default(true),
});

const listQuery = z
  .object({
    batchId: z.uuid().optional(),
    studentId: z.uuid().optional(),
    timetableSlotId: z.uuid().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((q) => q.batchId || q.studentId, { message: "Provide batchId or studentId" });

/** Faculty can mark attendance for slots they teach or batches they are assigned to. */
async function assertCanMark(user: AuthUser, batchId: string, facultyId: string) {
  if (isAdmin(user)) {
    await assertBatchAccess(user, batchId, true);
    return;
  }
  if (facultyId === user.id) return;
  const [assignment] = await db
    .select({ id: batchFaculty.id })
    .from(batchFaculty)
    .where(and(eq(batchFaculty.batchId, batchId), eq(batchFaculty.userId, user.id)))
    .limit(1);
  if (!assignment) throw forbidden("You are not assigned to this batch");
}

async function scopeConditions(user: AuthUser, query: { batchId?: string; studentId?: string }) {
  const conditions: SQL[] = [];
  if (query.studentId) {
    await assertCanViewStudent(user, query.studentId);
    conditions.push(eq(attendance.studentId, query.studentId));
  }
  if (query.batchId) {
    if (user.role === "student" || user.role === "parent") {
      if (!query.studentId) throw badRequest("studentId is required");
    } else {
      await assertBatchAccess(user, query.batchId);
    }
    conditions.push(eq(attendance.batchId, query.batchId));
  }
  return conditions;
}

attendanceModule
  .post(
    "/bulk",
    {
      summary: "Mark attendance for a class",
      description:
        "Upserts one record per student for the slot and date. Absent students' parents get a notification unless `notifyParentsOfAbsence` is false.",
      roles: STAFF_ROLES,
      body: bulkBody,
    },
    async ({ user, body }) => {
      const [slot] = await db
        .select()
        .from(timetableSlots)
        .where(and(eq(timetableSlots.id, body.timetableSlotId), eq(timetableSlots.batchId, body.batchId)));
      if (!slot) throw badRequest("The timetable slot does not belong to this batch");
      if (isOrgStaff(user) && !isAdmin(user)) throw forbidden();
      await assertCanMark(user, body.batchId, slot.facultyId);

      const weekday = new Date(`${body.date}T00:00:00Z`).getUTCDay();
      if (weekday !== slot.dayOfWeek) throw badRequest("The date does not fall on the slot's day of week");
      if (body.date < slot.effectiveFrom || (slot.effectiveUntil && body.date > slot.effectiveUntil)) {
        throw badRequest("The slot is not in effect on that date");
      }

      const studentIds = body.records.map((r) => r.studentId);
      const enrolled = new Set(
        (
          await db
            .select({ id: batchStudents.studentId })
            .from(batchStudents)
            .where(and(eq(batchStudents.batchId, body.batchId), inArray(batchStudents.studentId, studentIds)))
        ).map((r) => r.id),
      );
      const strangers = studentIds.filter((id) => !enrolled.has(id));
      if (strangers.length) throw badRequest(`Not enrolled in this batch: ${strangers.join(", ")}`);

      const now = new Date();
      const rows = await db
        .insert(attendance)
        .values(
          body.records.map((r) => ({
            studentId: r.studentId,
            batchId: body.batchId,
            timetableSlotId: body.timetableSlotId,
            date: body.date,
            status: r.status,
            note: r.note ?? null,
            markedBy: user.id,
            markedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [attendance.studentId, attendance.timetableSlotId, attendance.date],
          set: {
            status: sql`excluded.status`,
            note: sql`excluded.note`,
            markedBy: user.id,
            markedAt: now,
          },
        })
        .returning();

      if (body.notifyParentsOfAbsence) {
        const [subject] = await db.select({ name: subjects.name }).from(subjects).where(eq(subjects.id, slot.subjectId));
        for (const record of body.records.filter((r) => r.status === "absent")) {
          const parents = await getParentIds(record.studentId);
          await notify({
            userIds: parents,
            type: "announcement",
            title: "Absence recorded",
            body: `Your child was marked absent for ${subject?.name ?? "class"} on ${body.date}.`,
            data: { entity_type: "attendance", student_id: record.studentId, date: body.date },
          });
        }
      }
      return { marked: rows.length, records: rows };
    },
  )
  .get(
    "/",
    { summary: "List attendance records", query: listQuery },
    async ({ user, query }) => {
      const conditions = await scopeConditions(user, query);
      if (query.timetableSlotId) conditions.push(eq(attendance.timetableSlotId, query.timetableSlotId));
      if (query.from) conditions.push(gte(attendance.date, query.from));
      if (query.to) conditions.push(lte(attendance.date, query.to));
      const rows = await db
        .select({
          record: attendance,
          subjectName: subjects.name,
          startTime: timetableSlots.startTime,
          firstName: userProfiles.firstName,
          lastName: userProfiles.lastName,
        })
        .from(attendance)
        .innerJoin(timetableSlots, eq(timetableSlots.id, attendance.timetableSlotId))
        .innerJoin(subjects, eq(subjects.id, timetableSlots.subjectId))
        .leftJoin(userProfiles, eq(userProfiles.userId, attendance.studentId))
        .where(and(...conditions))
        .orderBy(desc(attendance.date), asc(timetableSlots.startTime));
      return rows.map((r) => ({
        ...r.record,
        subjectName: r.subjectName,
        startTime: r.startTime,
        studentName: fullName(r.firstName, r.lastName),
      }));
    },
  )
  .get(
    "/summary",
    {
      summary: "Attendance summary",
      description: "Counts by status and the attendance percentage (present + late over all marked classes).",
      query: listQuery,
    },
    async ({ user, query }) => {
      const conditions = await scopeConditions(user, query);
      if (query.from) conditions.push(gte(attendance.date, query.from));
      if (query.to) conditions.push(lte(attendance.date, query.to));
      const rows = await db
        .select({ studentId: attendance.studentId, status: attendance.status })
        .from(attendance)
        .where(and(...conditions));
      return summarize(rows);
    },
  )
  .patch(
    "/:id",
    {
      summary: "Correct an attendance record",
      roles: STAFF_ROLES,
      params: idParams,
      body: z
        .object({ status: z.enum(attendanceStatusEnum.enumValues), note: z.string().trim().max(255).nullable() })
        .partial()
        .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field" }),
    },
    async ({ user, params, body }) => {
      const [record] = await db.select().from(attendance).where(eq(attendance.id, params.id));
      if (!record) throw notFound("Attendance record");
      const [slot] = await db.select().from(timetableSlots).where(eq(timetableSlots.id, record.timetableSlotId));
      await assertCanMark(user, record.batchId, slot!.facultyId);
      const [updated] = await db
        .update(attendance)
        .set({ ...body, markedBy: user.id, markedAt: new Date() })
        .where(eq(attendance.id, params.id))
        .returning();
      return updated;
    },
  );

export function summarize(rows: { status: string }[]) {
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const r of rows) counts[r.status as keyof typeof counts] += 1;
  const total = rows.length;
  const attended = counts.present + counts.late;
  return { total, ...counts, attendancePct: total ? round((attended / total) * 100, 1) : null };
}
