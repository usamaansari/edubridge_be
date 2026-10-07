import { and, asc, count, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import {
  db,
  goalStatusEnum,
  type MentorSession,
  mentorAssignments,
  mentorSessions,
  sessionStatusEnum,
  type StudentGoal,
  studentGoals,
  userProfiles,
  users,
} from "../../db/index.js";
import {
  ADMIN_ROLES,
  assertCanViewStudent,
  getParentChildIds,
  isAdmin,
  isMentorOf,
} from "../../lib/access.js";
import { ApiModule } from "../../lib/api-module.js";
import { fullName } from "../../lib/dates.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/http-error.js";
import { offsetOf, paginate } from "../../lib/pagination.js";
import { booleanish, idParams, isoDate, isoDateTime, paginationQuery, url } from "../../lib/validation.js";
import type { AuthUser } from "../../middleware/auth.js";
import { notify } from "../notifications/notifications.service.js";
import { getStudentSummary } from "../students/students.service.js";
import { assertUserRole } from "../users/users.service.js";

const mentorProfile = alias(userProfiles, "mentor_profile");
const studentProfile = alias(userProfiles, "student_profile");

/** Restricts a student-scoped list to what the caller may see. */
async function studentScope(user: AuthUser, column: typeof mentorSessions.studentId | typeof studentGoals.studentId, mentorColumn: typeof mentorSessions.mentorId | typeof studentGoals.mentorId): Promise<SQL | null | "none"> {
  switch (user.role) {
    case "student":
      return eq(column, user.id);
    case "mentor":
      return eq(mentorColumn, user.id);
    case "parent": {
      const children = await getParentChildIds(user.id);
      return children.length ? inArray(column, children) : "none";
    }
    case "super_admin":
    case "centre_admin":
      return null;
    default:
      throw forbidden();
  }
}

// ---------------------------------------------------------------- Mentor assignments

export const mentorAssignmentsModule = new ApiModule("Mentor Assignments", "/mentor-assignments");

mentorAssignmentsModule
  .get(
    "/my-students",
    { summary: "My mentees with performance summaries", roles: ["mentor"] },
    async ({ user }) => {
      const rows = await db
        .select({ assignmentId: mentorAssignments.id, studentId: mentorAssignments.studentId, assignedAt: mentorAssignments.assignedAt })
        .from(mentorAssignments)
        .where(and(eq(mentorAssignments.mentorId, user.id), eq(mentorAssignments.isActive, true)));
      return Promise.all(rows.map(async (r) => ({ ...r, summary: await getStudentSummary(r.studentId) })));
    },
  )
  .get(
    "/my-mentor",
    { summary: "My current mentor", roles: ["student"] },
    async ({ user }) => {
      const [row] = await db
        .select({
          assignmentId: mentorAssignments.id,
          assignedAt: mentorAssignments.assignedAt,
          mentorId: users.id,
          email: users.email,
          phone: users.phone,
          firstName: userProfiles.firstName,
          lastName: userProfiles.lastName,
          bio: userProfiles.bio,
          profilePicUrl: userProfiles.profilePicUrl,
        })
        .from(mentorAssignments)
        .innerJoin(users, eq(users.id, mentorAssignments.mentorId))
        .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(and(eq(mentorAssignments.studentId, user.id), eq(mentorAssignments.isActive, true)))
        .orderBy(desc(mentorAssignments.assignedAt))
        .limit(1);
      if (!row) return null;
      return { ...row, name: fullName(row.firstName, row.lastName) };
    },
  )
  .get(
    "/",
    {
      summary: "List mentor assignments",
      roles: [...ADMIN_ROLES, "mentor"],
      query: z.object({
        mentorId: z.uuid().optional(),
        studentId: z.uuid().optional(),
        active: booleanish.optional(),
      }),
    },
    async ({ user, query }) => {
      const conditions: SQL[] = [];
      if (user.role === "mentor") conditions.push(eq(mentorAssignments.mentorId, user.id));
      else if (query.mentorId) conditions.push(eq(mentorAssignments.mentorId, query.mentorId));
      if (query.studentId) conditions.push(eq(mentorAssignments.studentId, query.studentId));
      if (query.active !== undefined) conditions.push(eq(mentorAssignments.isActive, query.active));
      const rows = await db
        .select({
          assignment: mentorAssignments,
          mentorFirstName: mentorProfile.firstName,
          mentorLastName: mentorProfile.lastName,
          studentFirstName: studentProfile.firstName,
          studentLastName: studentProfile.lastName,
        })
        .from(mentorAssignments)
        .leftJoin(mentorProfile, eq(mentorProfile.userId, mentorAssignments.mentorId))
        .leftJoin(studentProfile, eq(studentProfile.userId, mentorAssignments.studentId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(mentorAssignments.assignedAt));
      return rows.map((r) => ({
        ...r.assignment,
        mentorName: fullName(r.mentorFirstName, r.mentorLastName),
        studentName: fullName(r.studentFirstName, r.studentLastName),
      }));
    },
  )
  .post(
    "/",
    {
      summary: "Assign a mentor to a student",
      description: "A student has one active mentor; any previous active assignment is closed.",
      roles: ADMIN_ROLES,
      body: z.object({ mentorId: z.uuid(), studentId: z.uuid() }),
      status: 201,
    },
    async ({ body }) => {
      await assertUserRole(body.mentorId, ["mentor"], "mentorId");
      await assertUserRole(body.studentId, ["student"], "studentId");
      if (await isMentorOf(body.mentorId, body.studentId)) throw conflict("This mentor is already assigned");

      const assignment = await db.transaction(async (tx) => {
        await tx
          .update(mentorAssignments)
          .set({ isActive: false, unassignedAt: new Date() })
          .where(and(eq(mentorAssignments.studentId, body.studentId), eq(mentorAssignments.isActive, true)));
        const [row] = await tx.insert(mentorAssignments).values(body).returning();
        return row!;
      });
      await notify({
        userIds: [body.studentId, body.mentorId],
        type: "mentor_session",
        title: "Mentor assigned",
        body: "A new mentor assignment has been made. You can now schedule sessions.",
        data: { entity_type: "mentor_assignment", entity_id: assignment.id },
      });
      return assignment;
    },
  )
  .delete(
    "/:id",
    { summary: "End a mentor assignment", roles: ADMIN_ROLES, params: idParams },
    async ({ params }) => {
      const [row] = await db
        .update(mentorAssignments)
        .set({ isActive: false, unassignedAt: new Date() })
        .where(and(eq(mentorAssignments.id, params.id), eq(mentorAssignments.isActive, true)))
        .returning({ id: mentorAssignments.id });
      if (!row) throw notFound("Active assignment");
    },
  );

// ---------------------------------------------------------------- Mentor sessions

export const mentorSessionsModule = new ApiModule("Mentor Sessions", "/mentor-sessions");

const actionItems = z.array(
  z.object({ title: z.string().trim().min(1).max(255), done: z.boolean().optional(), dueDate: isoDate.optional() }),
);

async function getSessionOrThrow(id: string) {
  const [session] = await db.select().from(mentorSessions).where(eq(mentorSessions.id, id));
  if (!session) throw notFound("Session");
  return session;
}

function assertSessionManager(user: AuthUser, session: MentorSession) {
  if (session.mentorId !== user.id && !isAdmin(user)) throw forbidden("Only the mentor can change this session");
}

async function assertSessionViewer(user: AuthUser, session: MentorSession) {
  if (session.mentorId === user.id || session.studentId === user.id || isAdmin(user)) return;
  if (user.role === "parent") return assertCanViewStudent(user, session.studentId);
  throw forbidden();
}

mentorSessionsModule
  .get(
    "/",
    {
      summary: "List mentor sessions",
      description: "Mentors see their sessions, students their own, parents their children's, admins all.",
      query: paginationQuery.extend({
        status: z.enum(sessionStatusEnum.enumValues).optional(),
        studentId: z.uuid().optional(),
        mentorId: z.uuid().optional(),
        from: isoDateTime.optional(),
        to: isoDateTime.optional(),
      }),
    },
    async ({ user, query }) => {
      const scope = await studentScope(user, mentorSessions.studentId, mentorSessions.mentorId);
      if (scope === "none") return paginate([], 0, query.page, query.limit);
      const conditions: SQL[] = scope ? [scope] : [];
      if (query.status) conditions.push(eq(mentorSessions.status, query.status));
      if (query.studentId) conditions.push(eq(mentorSessions.studentId, query.studentId));
      if (query.mentorId) conditions.push(eq(mentorSessions.mentorId, query.mentorId));
      if (query.from) conditions.push(gte(mentorSessions.scheduledAt, query.from));
      if (query.to) conditions.push(lte(mentorSessions.scheduledAt, query.to));
      const where = conditions.length ? and(...conditions) : undefined;

      const [rows, [total]] = await Promise.all([
        db
          .select({
            session: mentorSessions,
            mentorFirstName: mentorProfile.firstName,
            mentorLastName: mentorProfile.lastName,
            studentFirstName: studentProfile.firstName,
            studentLastName: studentProfile.lastName,
          })
          .from(mentorSessions)
          .leftJoin(mentorProfile, eq(mentorProfile.userId, mentorSessions.mentorId))
          .leftJoin(studentProfile, eq(studentProfile.userId, mentorSessions.studentId))
          .where(where)
          .orderBy(desc(mentorSessions.scheduledAt))
          .limit(query.limit)
          .offset(offsetOf(query.page, query.limit)),
        db.select({ value: count() }).from(mentorSessions).where(where),
      ]);
      return paginate(
        rows.map((r) => ({
          ...r.session,
          mentorName: fullName(r.mentorFirstName, r.mentorLastName),
          studentName: fullName(r.studentFirstName, r.studentLastName),
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
      summary: "Schedule a session",
      description: "Mentors schedule with their own mentees; admins must pass `mentorId`.",
      roles: [...ADMIN_ROLES, "mentor"],
      body: z.object({
        studentId: z.uuid(),
        mentorId: z.uuid().optional(),
        scheduledAt: isoDateTime,
        durationMinutes: z.coerce.number().int().min(10).max(240).default(30),
        meetingLink: url.nullable().optional(),
      }),
      status: 201,
    },
    async ({ user, body }) => {
      const mentorId = user.role === "mentor" ? user.id : body.mentorId;
      if (!mentorId) throw badRequest("mentorId is required");
      if (!(await isMentorOf(mentorId, body.studentId))) {
        throw badRequest("The mentor is not actively assigned to this student");
      }
      if (body.scheduledAt <= new Date()) throw badRequest("scheduledAt must be in the future");
      const [session] = await db
        .insert(mentorSessions)
        .values({ ...body, mentorId })
        .returning();
      await notify({
        userIds: [body.studentId],
        type: "mentor_session",
        title: "Mentor session scheduled",
        body: `Your mentor session is on ${body.scheduledAt.toISOString()} (${body.durationMinutes} min).`,
        data: { entity_type: "mentor_session", entity_id: session!.id },
      });
      return session;
    },
  )
  .get(
    "/:id",
    { summary: "Get a session", params: idParams },
    async ({ user, params }) => {
      const session = await getSessionOrThrow(params.id);
      await assertSessionViewer(user, session);
      return session;
    },
  )
  .patch(
    "/:id",
    {
      summary: "Update a session",
      roles: [...ADMIN_ROLES, "mentor"],
      params: idParams,
      body: z
        .object({
          scheduledAt: isoDateTime,
          durationMinutes: z.coerce.number().int().min(10).max(240),
          meetingLink: url.nullable(),
          notesHtml: z.string().nullable(),
          actionItemsJson: actionItems.nullable(),
          status: z.enum(sessionStatusEnum.enumValues),
        })
        .partial()
        .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field" }),
    },
    async ({ user, params, body }) => {
      const session = await getSessionOrThrow(params.id);
      assertSessionManager(user, session);
      const patch: Partial<MentorSession> = { ...body };
      if (body.status === "completed" && !session.conductedAt) patch.conductedAt = new Date();
      const [updated] = await db.update(mentorSessions).set(patch).where(eq(mentorSessions.id, params.id)).returning();
      if (body.scheduledAt && body.scheduledAt.getTime() !== session.scheduledAt.getTime()) {
        await notify({
          userIds: [session.studentId],
          type: "mentor_session",
          title: "Mentor session rescheduled",
          body: `Your session has moved to ${body.scheduledAt.toISOString()}.`,
          data: { entity_type: "mentor_session", entity_id: session.id },
        });
      }
      return updated;
    },
  )
  .post(
    "/:id/complete",
    {
      summary: "Mark a session completed with notes",
      roles: [...ADMIN_ROLES, "mentor"],
      params: idParams,
      body: z.object({
        conductedAt: isoDateTime.optional(),
        notesHtml: z.string().optional(),
        actionItemsJson: actionItems.optional(),
      }),
    },
    async ({ user, params, body }) => {
      const session = await getSessionOrThrow(params.id);
      assertSessionManager(user, session);
      if (session.status !== "scheduled") throw conflict(`The session is already ${session.status}`);
      const [updated] = await db
        .update(mentorSessions)
        .set({ ...body, status: "completed", conductedAt: body.conductedAt ?? new Date() })
        .where(eq(mentorSessions.id, params.id))
        .returning();
      return updated;
    },
  )
  .post(
    "/:id/cancel",
    { summary: "Cancel a session", params: idParams },
    async ({ user, params }) => {
      const session = await getSessionOrThrow(params.id);
      if (session.studentId !== user.id) assertSessionManager(user, session);
      if (session.status !== "scheduled") throw conflict(`The session is already ${session.status}`);
      const [updated] = await db
        .update(mentorSessions)
        .set({ status: "cancelled" })
        .where(eq(mentorSessions.id, params.id))
        .returning();
      await notify({
        userIds: [session.studentId === user.id ? session.mentorId : session.studentId],
        type: "mentor_session",
        title: "Mentor session cancelled",
        body: `The session on ${session.scheduledAt.toISOString()} was cancelled.`,
        data: { entity_type: "mentor_session", entity_id: session.id },
      });
      return updated;
    },
  )
  .post(
    "/:id/rate",
    {
      summary: "Rate a completed session",
      roles: ["student"],
      params: idParams,
      body: z.object({ rating: z.coerce.number().int().min(1).max(5) }),
    },
    async ({ user, params, body }) => {
      const session = await getSessionOrThrow(params.id);
      if (session.studentId !== user.id) throw forbidden();
      if (session.status !== "completed") throw conflict("Only completed sessions can be rated");
      const [updated] = await db
        .update(mentorSessions)
        .set({ studentRating: body.rating })
        .where(eq(mentorSessions.id, params.id))
        .returning();
      return updated;
    },
  );

// ---------------------------------------------------------------- Goals

export const goalsModule = new ApiModule("Student Goals", "/goals");

async function getGoalOrThrow(id: string) {
  const [goal] = await db.select().from(studentGoals).where(eq(studentGoals.id, id));
  if (!goal) throw notFound("Goal");
  return goal;
}

const CLOSED_GOAL_STATUSES: StudentGoal["status"][] = ["achieved", "missed"];

goalsModule
  .get(
    "/",
    {
      summary: "List goals",
      query: z.object({
        studentId: z.uuid().optional(),
        status: z.enum(goalStatusEnum.enumValues).optional(),
      }),
    },
    async ({ user, query }) => {
      const scope = await studentScope(user, studentGoals.studentId, studentGoals.mentorId);
      if (scope === "none") return [];
      const conditions: SQL[] = scope ? [scope] : [];
      if (query.studentId) conditions.push(eq(studentGoals.studentId, query.studentId));
      if (query.status) conditions.push(eq(studentGoals.status, query.status));
      return db
        .select()
        .from(studentGoals)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(asc(studentGoals.dueDate));
    },
  )
  .post(
    "/",
    {
      summary: "Set a goal for a student",
      roles: [...ADMIN_ROLES, "mentor"],
      body: z.object({
        studentId: z.uuid(),
        mentorId: z.uuid().optional(),
        title: z.string().trim().min(3).max(255),
        description: z.string().trim().nullable().optional(),
        dueDate: isoDate,
      }),
      status: 201,
    },
    async ({ user, body }) => {
      const mentorId = user.role === "mentor" ? user.id : body.mentorId;
      if (!mentorId) throw badRequest("mentorId is required");
      if (!(await isMentorOf(mentorId, body.studentId))) {
        throw badRequest("The mentor is not actively assigned to this student");
      }
      const [goal] = await db.insert(studentGoals).values({ ...body, mentorId }).returning();
      return goal;
    },
  )
  .patch(
    "/:id",
    {
      summary: "Update a goal",
      description: "Students may only change the status of their own goals.",
      params: idParams,
      body: z
        .object({
          title: z.string().trim().min(3).max(255),
          description: z.string().trim().nullable(),
          dueDate: isoDate,
          status: z.enum(goalStatusEnum.enumValues),
        })
        .partial()
        .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field" }),
    },
    async ({ user, params, body }) => {
      const goal = await getGoalOrThrow(params.id);
      const isOwnerStudent = goal.studentId === user.id;
      if (!isOwnerStudent && goal.mentorId !== user.id && !isAdmin(user)) throw forbidden();
      if (isOwnerStudent && Object.keys(body).some((k) => k !== "status")) {
        throw forbidden("Students can only update the goal status");
      }
      const patch: Partial<StudentGoal> = { ...body };
      if (body.status) patch.closedAt = CLOSED_GOAL_STATUSES.includes(body.status) ? new Date() : null;
      const [updated] = await db.update(studentGoals).set(patch).where(eq(studentGoals.id, params.id)).returning();
      return updated;
    },
  );
