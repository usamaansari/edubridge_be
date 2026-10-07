import { eq } from "drizzle-orm";
import { z } from "zod";

import { batches, db } from "../../db/index.js";
import {
  ADMIN_ROLES,
  assertBatchAccess,
  assertOrgAccess,
  getBatchOrThrow,
  STAFF_ROLES,
} from "../../lib/access.js";
import { ApiModule } from "../../lib/api-module.js";
import { badRequest } from "../../lib/http-error.js";
import { booleanish, idParams } from "../../lib/validation.js";
import {
  batchBody,
  enrollBody,
  enrollmentStatusBody,
  facultyBody,
  facultyParams,
  listBatchesQuery,
  listStudentsQuery,
  slotBody,
  slotParams,
  studentParams,
  transferBody,
  updateBatchBody,
  updateSlotBody,
} from "./batches.schemas.js";
import {
  assertProgramForClass,
  assignFaculty,
  createSlot,
  enrollStudent,
  getBatchDetail,
  getMySchedule,
  listBatches,
  listFaculty,
  listStudents,
  listTimetable,
  removeFaculty,
  setEnrollmentStatus,
  transferStudent,
  updateSlot,
} from "./batches.service.js";

export const batchesModule = new ApiModule("Batches", "/batches");

batchesModule
  .get(
    "/my-schedule",
    {
      summary: "My weekly timetable",
      description: "Students and parents get their batches' slots; faculty get the slots they teach.",
    },
    ({ user }) => getMySchedule(user),
  )
  .get(
    "/",
    {
      summary: "List batches",
      description: "Scoped to what the caller can see: org batches for admins, assigned batches for faculty, enrolled batches for students.",
      query: listBatchesQuery,
    },
    ({ user, query }) => listBatches(user, query),
  )
  .post(
    "/",
    { summary: "Create a batch", roles: ADMIN_ROLES, body: batchBody, status: 201 },
    async ({ user, body }) => {
      await assertOrgAccess(user, body.orgId);
      await assertProgramForClass(body.programId, body.classLevel);
      const [batch] = await db
        .insert(batches)
        .values({ ...body, createdBy: user.id })
        .returning();
      return batch;
    },
  )
  .get(
    "/:id",
    { summary: "Get a batch with faculty and counts", params: idParams },
    async ({ user, params }) => {
      await assertBatchAccess(user, params.id);
      return getBatchDetail(params.id);
    },
  )
  .patch(
    "/:id",
    { summary: "Update a batch", roles: ADMIN_ROLES, params: idParams, body: updateBatchBody },
    async ({ user, params, body }) => {
      const batch = await assertBatchAccess(user, params.id, true);
      const startDate = body.startDate ?? batch.startDate;
      const endDate = body.endDate ?? batch.endDate;
      if (endDate < startDate) throw badRequest("endDate must be on or after startDate");
      if (body.classLevel) await assertProgramForClass(batch.programId, body.classLevel);
      const [updated] = await db.update(batches).set(body).where(eq(batches.id, params.id)).returning();
      return updated;
    },
  )
  .delete(
    "/:id",
    {
      summary: "Cancel a batch",
      description: "Batches are never hard-deleted; this sets status to `cancelled`.",
      roles: ADMIN_ROLES,
      params: idParams,
    },
    async ({ user, params }) => {
      await assertBatchAccess(user, params.id, true);
      await db.update(batches).set({ status: "cancelled" }).where(eq(batches.id, params.id));
    },
  )
  .get(
    "/:id/students",
    { summary: "List enrolled students", roles: STAFF_ROLES, params: idParams, query: listStudentsQuery },
    async ({ user, params, query }) => {
      await assertBatchAccess(user, params.id);
      return listStudents(params.id, query.status);
    },
  )
  .post(
    "/:id/students",
    {
      summary: "Enroll a student",
      description: "Generates a unique enrollment number and enforces batch capacity.",
      roles: ADMIN_ROLES,
      params: idParams,
      body: enrollBody,
      status: 201,
    },
    async ({ user, params, body }) => {
      const batch = await assertBatchAccess(user, params.id, true);
      return enrollStudent(batch, body.studentId);
    },
  )
  .patch(
    "/:id/students/:studentId",
    {
      summary: "Change an enrollment's status",
      roles: ADMIN_ROLES,
      params: studentParams,
      body: enrollmentStatusBody,
    },
    async ({ user, params, body }) => {
      await assertBatchAccess(user, params.id, true);
      return setEnrollmentStatus(params.id, params.studentId, body.status);
    },
  )
  .post(
    "/:id/students/:studentId/transfer",
    {
      summary: "Transfer a student to another batch",
      description: "Marks the current enrollment `transferred` and enrolls into the target batch.",
      roles: ADMIN_ROLES,
      params: studentParams,
      body: transferBody,
      status: 201,
    },
    async ({ user, params, body }) => {
      const from = await assertBatchAccess(user, params.id, true);
      const to = await assertBatchAccess(user, body.toBatchId, true);
      return transferStudent(from, to, params.studentId);
    },
  )
  .get(
    "/:id/faculty",
    { summary: "List assigned faculty", params: idParams },
    async ({ user, params }) => {
      await assertBatchAccess(user, params.id);
      return listFaculty(params.id);
    },
  )
  .post(
    "/:id/faculty",
    {
      summary: "Assign a teacher or mentor",
      description: "`subjectId: null` means the assignment covers all subjects (typical for mentors).",
      roles: ADMIN_ROLES,
      params: idParams,
      body: facultyBody,
      status: 201,
    },
    async ({ user, params, body }) => {
      const batch = await assertBatchAccess(user, params.id, true);
      return assignFaculty(batch, body);
    },
  )
  .delete(
    "/:id/faculty/:assignmentId",
    { summary: "Remove a faculty assignment", roles: ADMIN_ROLES, params: facultyParams },
    async ({ user, params }) => {
      await assertBatchAccess(user, params.id, true);
      await removeFaculty(params.id, params.assignmentId);
    },
  )
  .get(
    "/:id/timetable",
    {
      summary: "Get the batch timetable",
      params: idParams,
      query: z.object({ includeInactive: booleanish.optional() }),
    },
    async ({ user, params, query }) => {
      await assertBatchAccess(user, params.id);
      return listTimetable(params.id, query.includeInactive ?? false);
    },
  )
  .post(
    "/:id/timetable",
    {
      summary: "Add a timetable slot",
      description: "Rejects slots that clash with the batch's or the faculty member's existing classes.",
      roles: ADMIN_ROLES,
      params: idParams,
      body: slotBody,
      status: 201,
    },
    async ({ user, params, body }) => {
      const batch = await assertBatchAccess(user, params.id, true);
      return createSlot(batch, body);
    },
  )
  .patch(
    "/:id/timetable/:slotId",
    { summary: "Update a timetable slot", roles: ADMIN_ROLES, params: slotParams, body: updateSlotBody },
    async ({ user, params, body }) => {
      const batch = await assertBatchAccess(user, params.id, true);
      return updateSlot(batch, params.slotId, body);
    },
  )
  .delete(
    "/:id/timetable/:slotId",
    {
      summary: "Deactivate a timetable slot",
      description: "Slots are kept for attendance history; this sets `is_active = false`.",
      roles: ADMIN_ROLES,
      params: slotParams,
    },
    async ({ user, params }) => {
      const batch = await getBatchOrThrow(params.id);
      await assertBatchAccess(user, batch.id, true);
      await updateSlot(batch, params.slotId, { isActive: false });
    },
  );
