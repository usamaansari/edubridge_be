import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  chapters,
  db,
  type Doubt,
  doubtReplies,
  doubts,
  doubtStatusEnum,
  subjects,
  topics,
  userProfiles,
  users,
} from "../../db/index.js";
import { getParentChildIds, isAdmin, isFaculty, isStaff } from "../../lib/access.js";
import { ApiModule } from "../../lib/api-module.js";
import { fullName } from "../../lib/dates.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/http-error.js";
import { offsetOf, paginate } from "../../lib/pagination.js";
import { booleanish, idParams, paginationQuery, url } from "../../lib/validation.js";
import type { AuthUser } from "../../middleware/auth.js";
import { getStudentProgramIds } from "../curriculum/curriculum.service.js";
import { notify } from "../notifications/notifications.service.js";
import { assertUserRole } from "../users/users.service.js";

export const doubtsModule = new ApiModule("Doubts", "/doubts");

const mediaUrls = z.array(url).max(10);

const createDoubtBody = z.object({
  subjectId: z.uuid(),
  topicId: z.uuid().nullable().optional(),
  contentItemId: z.uuid().nullable().optional(),
  questionId: z.uuid().nullable().optional(),
  title: z.string().trim().min(5).max(255),
  bodyHtml: z.string().trim().min(10),
  mediaUrls: mediaUrls.optional(),
});

const updateDoubtBody = z
  .object({
    title: z.string().trim().min(5).max(255),
    bodyHtml: z.string().trim().min(10),
    mediaUrls: mediaUrls.nullable(),
    status: z.enum(doubtStatusEnum.enumValues),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field" });

const replyBody = z
  .object({
    bodyHtml: z.string().trim().min(2).optional(),
    body: z.string().trim().min(2).optional(),
    mediaUrls: mediaUrls.optional(),
  })
  .refine((r) => r.bodyHtml || r.body, { message: "bodyHtml is required", path: ["bodyHtml"] });

const listQuery = paginationQuery.extend({
  status: z.enum(doubtStatusEnum.enumValues).optional(),
  subjectId: z.uuid().optional(),
  topicId: z.uuid().optional(),
  studentId: z.uuid().optional(),
  mine: booleanish.optional(),
  assignedToMe: booleanish.optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

const replyParams = z.object({ id: z.uuid(), replyId: z.uuid() });

/** Students browse doubts in their programs' subjects (peer Q&A); parents see their children's. */
async function visibilityScope(user: AuthUser): Promise<SQL | null | "none"> {
  if (isStaff(user)) return null;
  if (user.role === "parent") {
    const children = await getParentChildIds(user.id);
    return children.length ? inArray(doubts.studentId, children) : "none";
  }
  const programIds = await getStudentProgramIds(user.id);
  if (!programIds.length) return eq(doubts.studentId, user.id);
  return or(eq(doubts.studentId, user.id), inArray(subjects.programId, programIds))!;
}

async function getDoubtOrThrow(id: string) {
  const [doubt] = await db.select().from(doubts).where(eq(doubts.id, id));
  if (!doubt) throw notFound("Doubt");
  return doubt;
}

async function assertCanSeeDoubt(user: AuthUser, doubt: Doubt) {
  const scope = await visibilityScope(user);
  if (scope === null) return;
  if (scope === "none") throw forbidden();
  const [row] = await db
    .select({ id: doubts.id })
    .from(doubts)
    .innerJoin(subjects, eq(subjects.id, doubts.subjectId))
    .where(and(eq(doubts.id, doubt.id), scope));
  if (!row) throw forbidden();
}

async function getDoubtThread(id: string) {
  const [row] = await db
    .select({
      doubt: doubts,
      subjectName: subjects.name,
      topicName: topics.name,
      studentFirstName: userProfiles.firstName,
      studentLastName: userProfiles.lastName,
    })
    .from(doubts)
    .innerJoin(subjects, eq(subjects.id, doubts.subjectId))
    .leftJoin(topics, eq(topics.id, doubts.topicId))
    .leftJoin(userProfiles, eq(userProfiles.userId, doubts.studentId))
    .where(eq(doubts.id, id));
  if (!row) throw notFound("Doubt");

  const replies = await db
    .select({
      reply: doubtReplies,
      authorRole: users.role,
      authorFirstName: userProfiles.firstName,
      authorLastName: userProfiles.lastName,
    })
    .from(doubtReplies)
    .innerJoin(users, eq(users.id, doubtReplies.authorId))
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(eq(doubtReplies.doubtId, id))
    .orderBy(desc(doubtReplies.isAcceptedAnswer), asc(doubtReplies.createdAt));

  return {
    ...row.doubt,
    subjectName: row.subjectName,
    topicName: row.topicName,
    studentName: fullName(row.studentFirstName, row.studentLastName),
    replies: replies.map((r) => ({
      ...r.reply,
      authorRole: r.authorRole,
      authorName: fullName(r.authorFirstName, r.authorLastName),
    })),
  };
}

doubtsModule
  .get(
    "/",
    { summary: "List doubts", query: listQuery },
    async ({ user, query }) => {
      const scope = await visibilityScope(user);
      if (scope === "none") return paginate([], 0, query.page, query.limit);
      const conditions: SQL[] = scope ? [scope] : [];
      if (query.status) conditions.push(eq(doubts.status, query.status));
      if (query.subjectId) conditions.push(eq(doubts.subjectId, query.subjectId));
      if (query.topicId) conditions.push(eq(doubts.topicId, query.topicId));
      if (query.studentId) conditions.push(eq(doubts.studentId, query.studentId));
      if (query.mine) conditions.push(eq(doubts.studentId, user.id));
      if (query.assignedToMe) conditions.push(eq(doubts.assignedTo, user.id));
      if (query.search) conditions.push(ilike(doubts.title, `%${query.search}%`));
      const where = conditions.length ? and(...conditions) : undefined;

      const replyCount = db
        .select({ doubtId: doubtReplies.doubtId, value: count().as("reply_count") })
        .from(doubtReplies)
        .groupBy(doubtReplies.doubtId)
        .as("reply_count");

      const [rows, [total]] = await Promise.all([
        db
          .select({
            doubt: doubts,
            subjectName: subjects.name,
            topicName: topics.name,
            firstName: userProfiles.firstName,
            lastName: userProfiles.lastName,
            replyCount: replyCount.value,
          })
          .from(doubts)
          .innerJoin(subjects, eq(subjects.id, doubts.subjectId))
          .leftJoin(topics, eq(topics.id, doubts.topicId))
          .leftJoin(userProfiles, eq(userProfiles.userId, doubts.studentId))
          .leftJoin(replyCount, eq(replyCount.doubtId, doubts.id))
          .where(where)
          .orderBy(desc(doubts.createdAt))
          .limit(query.limit)
          .offset(offsetOf(query.page, query.limit)),
        db
          .select({ value: count() })
          .from(doubts)
          .innerJoin(subjects, eq(subjects.id, doubts.subjectId))
          .where(where),
      ]);

      return paginate(
        rows.map((r) => ({
          ...r.doubt,
          subjectName: r.subjectName,
          topicName: r.topicName,
          studentName: fullName(r.firstName, r.lastName),
          replyCount: Number(r.replyCount ?? 0),
        })),
        total?.value ?? 0,
        query.page,
        query.limit,
      );
    },
  )
  .post(
    "/",
    { summary: "Ask a doubt", roles: ["student"], body: createDoubtBody, status: 201 },
    async ({ user, body }) => {
      const [subject] = await db.select().from(subjects).where(eq(subjects.id, body.subjectId));
      if (!subject) throw badRequest("subjectId does not exist");
      const programIds = await getStudentProgramIds(user.id);
      if (programIds.length && !programIds.includes(subject.programId)) {
        throw badRequest("The subject is not part of your enrolled programs");
      }
      if (body.topicId) {
        const [topic] = await db
          .select({ subjectId: chapters.subjectId })
          .from(topics)
          .innerJoin(chapters, eq(chapters.id, topics.chapterId))
          .where(eq(topics.id, body.topicId));
        if (topic?.subjectId !== body.subjectId) throw badRequest("topicId does not belong to subjectId");
      }
      const [doubt] = await db.insert(doubts).values({ ...body, studentId: user.id }).returning();
      return doubt;
    },
  )
  .get(
    "/:id",
    { summary: "Get a doubt with its replies", params: idParams },
    async ({ user, params }) => {
      const doubt = await getDoubtOrThrow(params.id);
      await assertCanSeeDoubt(user, doubt);
      return getDoubtThread(params.id);
    },
  )
  .patch(
    "/:id",
    {
      summary: "Edit or change the status of a doubt",
      description: "The author can edit while unresolved and can resolve/close. Faculty and admins can change status.",
      params: idParams,
      body: updateDoubtBody,
    },
    async ({ user, params, body }) => {
      const doubt = await getDoubtOrThrow(params.id);
      const isOwner = doubt.studentId === user.id;
      const canModerate = isFaculty(user) || isAdmin(user);
      if (!isOwner && !canModerate) throw forbidden();

      const { status, ...content } = body;
      if (Object.keys(content).length) {
        if (!isOwner) throw forbidden("Only the author can edit the doubt text");
        if (doubt.status === "resolved" || doubt.status === "closed") {
          throw conflict("Resolved or closed doubts cannot be edited");
        }
      }
      if (status && isOwner && !canModerate && !["resolved", "closed"].includes(status)) {
        throw forbidden("You can only resolve or close your doubt");
      }

      const patch: Partial<Doubt> = { ...content };
      if (status) {
        patch.status = status;
        patch.resolvedAt = status === "resolved" ? new Date() : status === "closed" ? doubt.resolvedAt : null;
      }
      const [updated] = await db.update(doubts).set(patch).where(eq(doubts.id, params.id)).returning();
      return updated;
    },
  )
  .post(
    "/:id/assign",
    {
      summary: "Assign a doubt to faculty",
      description: "Admins assign to any teacher/mentor; faculty calling without `assignedTo` take it themselves.",
      roles: ["super_admin", "centre_admin", "teacher", "mentor"],
      params: idParams,
      body: z.object({ assignedTo: z.uuid().optional() }),
    },
    async ({ user, params, body }) => {
      const doubt = await getDoubtOrThrow(params.id);
      if (doubt.status === "resolved" || doubt.status === "closed") throw conflict(`The doubt is already ${doubt.status}`);
      const assignee = body.assignedTo ?? user.id;
      if (assignee !== user.id && !isAdmin(user)) throw forbidden("Only admins can assign doubts to others");
      await assertUserRole(assignee, ["teacher", "mentor"], "assignedTo");
      const [updated] = await db
        .update(doubts)
        .set({ assignedTo: assignee, assignedAt: new Date(), status: "assigned" })
        .where(eq(doubts.id, params.id))
        .returning();
      return updated;
    },
  )
  .post(
    "/:id/replies",
    {
      summary: "Reply to a doubt",
      description: "Accepts `bodyHtml` (or `body`, as sent by the frontend). Faculty replies auto-assign open doubts and notify the student.",
      params: idParams,
      body: replyBody,
      status: 201,
    },
    async ({ user, params, body }) => {
      const doubt = await getDoubtOrThrow(params.id);
      await assertCanSeeDoubt(user, doubt);
      if (user.role === "parent") throw forbidden();
      if (doubt.status === "closed") throw conflict("The doubt is closed");

      const reply = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(doubtReplies)
          .values({
            doubtId: doubt.id,
            authorId: user.id,
            bodyHtml: (body.bodyHtml ?? body.body)!,
            mediaUrls: body.mediaUrls ?? null,
          })
          .returning();
        if (isFaculty(user) && doubt.status === "open") {
          await tx
            .update(doubts)
            .set({ status: "assigned", assignedTo: user.id, assignedAt: new Date() })
            .where(eq(doubts.id, doubt.id));
        }
        return row!;
      });

      if (user.id !== doubt.studentId) {
        await notify({
          userIds: [doubt.studentId],
          type: "doubt_answered",
          title: "New reply to your doubt",
          body: doubt.title,
          data: { entity_type: "doubt", entity_id: doubt.id, reply_id: reply.id },
        });
      }
      return reply;
    },
  )
  .post(
    "/:id/replies/:replyId/accept",
    {
      summary: "Accept a reply as the answer",
      description: "Marks the reply accepted and resolves the doubt.",
      params: replyParams,
    },
    async ({ user, params }) => {
      const doubt = await getDoubtOrThrow(params.id);
      if (doubt.studentId !== user.id && !isFaculty(user) && !isAdmin(user)) throw forbidden();
      return db.transaction(async (tx) => {
        await tx.update(doubtReplies).set({ isAcceptedAnswer: false }).where(eq(doubtReplies.doubtId, doubt.id));
        const [reply] = await tx
          .update(doubtReplies)
          .set({ isAcceptedAnswer: true })
          .where(and(eq(doubtReplies.id, params.replyId), eq(doubtReplies.doubtId, doubt.id)))
          .returning();
        if (!reply) throw notFound("Reply");
        await tx
          .update(doubts)
          .set({ status: "resolved", resolvedAt: new Date() })
          .where(eq(doubts.id, doubt.id));
        return reply;
      });
    },
  )
  .post(
    "/:id/upvote",
    { summary: "Upvote a doubt (\"I have this doubt too\")", roles: ["student"], params: idParams },
    async ({ user, params }) => {
      const doubt = await getDoubtOrThrow(params.id);
      await assertCanSeeDoubt(user, doubt);
      if (doubt.studentId === user.id) throw badRequest("You cannot upvote your own doubt");
      const [updated] = await db
        .update(doubts)
        .set({ upvotes: sql`${doubts.upvotes} + 1` })
        .where(eq(doubts.id, params.id))
        .returning({ id: doubts.id, upvotes: doubts.upvotes });
      return updated;
    },
  );
