import { and, count, desc, eq, ilike, isNull, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  chapters,
  contentItems,
  contentTypeEnum,
  db,
  studentContentProgress,
  subjects,
  topics,
} from "../../db/index.js";
import { AUTHOR_ROLES, isAdmin, isStaff } from "../../lib/access.js";
import { ApiModule } from "../../lib/api-module.js";
import { badRequest, forbidden, notFound } from "../../lib/http-error.js";
import { offsetOf, paginate } from "../../lib/pagination.js";
import { booleanish, idParams, isoDateTime, paginationQuery, url } from "../../lib/validation.js";
import type { AuthUser } from "../../middleware/auth.js";
import { publicFileUrl, upload } from "../../middleware/upload.js";
import { visibleContent } from "../curriculum/curriculum.service.js";

export const contentModule = new ApiModule("Content", "/content");

const optionalInt = z.coerce.number().int().min(0).nullable().optional();

const contentFields = {
  topicId: z.uuid(),
  type: z.enum(contentTypeEnum.enumValues),
  title: z.string().trim().min(3).max(255),
  description: z.string().trim().nullable().optional(),
  url: url.nullable().optional(),
  muxAssetId: z.string().trim().max(100).nullable().optional(),
  muxPlaybackId: z.string().trim().max(100).nullable().optional(),
  durationSec: optionalInt,
  fileSizeBytes: optionalInt,
  sequenceOrder: z.coerce.number().int().min(0).max(32767).default(0),
  isPublished: booleanish.default(false),
  releasedAt: isoDateTime.nullable().optional(),
};

const createContentBody = z.object(contentFields);

const updateContentBody = z
  .object(contentFields)
  .omit({ topicId: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field" });

const listQuery = paginationQuery.extend({
  topicId: z.uuid().optional(),
  chapterId: z.uuid().optional(),
  subjectId: z.uuid().optional(),
  type: z.enum(contentTypeEnum.enumValues).optional(),
  isPublished: booleanish.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  mine: booleanish.optional(),
});

const progressBody = z
  .object({
    watchedPct: z.coerce.number().int().min(0).max(100),
    lastPositionSec: z.coerce.number().int().min(0),
    completed: z.boolean(),
    bookmarked: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field" });

/** Videos count as completed once 90% has been watched. */
const COMPLETION_THRESHOLD_PCT = 90;

async function getContentOrThrow(id: string) {
  const [item] = await db
    .select()
    .from(contentItems)
    .where(and(eq(contentItems.id, id), isNull(contentItems.deletedAt)));
  if (!item) throw notFound("Content item");
  return item;
}

function assertCanEdit(user: AuthUser, createdBy: string) {
  if (createdBy !== user.id && !isAdmin(user)) {
    throw forbidden("Only the uploader or an admin can change this content");
  }
}

contentModule
  .get(
    "/",
    {
      summary: "List content items",
      description: "Students only see published, released items and get their own progress.",
      query: listQuery,
    },
    async ({ user, query }) => {
      const staff = isStaff(user);
      const conditions: SQL[] = [isNull(contentItems.deletedAt)];
      if (!staff) conditions.push(visibleContent());
      else if (query.isPublished !== undefined) conditions.push(eq(contentItems.isPublished, query.isPublished));
      if (staff && query.mine) conditions.push(eq(contentItems.createdBy, user.id));
      if (query.topicId) conditions.push(eq(contentItems.topicId, query.topicId));
      if (query.chapterId) conditions.push(eq(topics.chapterId, query.chapterId));
      if (query.subjectId) conditions.push(eq(chapters.subjectId, query.subjectId));
      if (query.type) conditions.push(eq(contentItems.type, query.type));
      if (query.search) conditions.push(ilike(contentItems.title, `%${query.search}%`));
      const where = and(...conditions);

      const base = () =>
        db
          .select({
            item: contentItems,
            topicName: topics.name,
            chapterName: chapters.name,
            subjectName: subjects.name,
            progress: studentContentProgress,
          })
          .from(contentItems)
          .innerJoin(topics, eq(topics.id, contentItems.topicId))
          .innerJoin(chapters, eq(chapters.id, topics.chapterId))
          .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
          .leftJoin(
            studentContentProgress,
            and(
              eq(studentContentProgress.contentItemId, contentItems.id),
              eq(studentContentProgress.studentId, user.id),
            ),
          );

      const [rows, [total]] = await Promise.all([
        base()
          .where(where)
          .orderBy(desc(contentItems.createdAt))
          .limit(query.limit)
          .offset(offsetOf(query.page, query.limit)),
        db
          .select({ value: count() })
          .from(contentItems)
          .innerJoin(topics, eq(topics.id, contentItems.topicId))
          .innerJoin(chapters, eq(chapters.id, topics.chapterId))
          .where(where),
      ]);

      return paginate(
        rows.map(({ item, progress, ...names }) => ({ ...item, ...names, progress })),
        total?.value ?? 0,
        query.page,
        query.limit,
      );
    },
  )
  .get(
    "/bookmarks",
    { summary: "My bookmarked content", roles: ["student"] },
    async ({ user }) => {
      const rows = await db
        .select({ item: contentItems, progress: studentContentProgress, topicName: topics.name })
        .from(studentContentProgress)
        .innerJoin(contentItems, eq(contentItems.id, studentContentProgress.contentItemId))
        .innerJoin(topics, eq(topics.id, contentItems.topicId))
        .where(
          and(
            eq(studentContentProgress.studentId, user.id),
            eq(studentContentProgress.bookmarked, true),
            visibleContent(),
          ),
        )
        .orderBy(desc(studentContentProgress.lastAccessedAt));
      return rows.map(({ item, ...rest }) => ({ ...item, ...rest }));
    },
  )
  .post(
    "/",
    {
      summary: "Create a content item",
      description:
        "Send JSON with a CDN `url` / Mux ids, or `multipart/form-data` with a `file` field (PDF, image or video) which is stored and served from `/uploads`.",
      roles: AUTHOR_ROLES,
      body: createContentBody,
      multipart: true,
      middleware: [upload.single("file")],
      status: 201,
    },
    async ({ req, user, body }) => {
      const [topic] = await db.select({ id: topics.id }).from(topics).where(eq(topics.id, body.topicId));
      if (!topic) throw badRequest("topicId does not exist");

      const file = req.file;
      const values = {
        ...body,
        url: file ? publicFileUrl(file.filename) : (body.url ?? null),
        fileSizeBytes: file ? file.size : (body.fileSizeBytes ?? null),
        createdBy: user.id,
      };
      if (values.type === "video" ? !values.url && !values.muxPlaybackId : !values.url) {
        throw badRequest("Provide a file, a url, or (for videos) a muxPlaybackId");
      }
      const [item] = await db.insert(contentItems).values(values).returning();
      return item;
    },
  )
  .get(
    "/:id",
    { summary: "Get a content item", params: idParams },
    async ({ user, params }) => {
      const conditions: SQL[] = [eq(contentItems.id, params.id), isNull(contentItems.deletedAt)];
      if (!isStaff(user)) conditions.push(visibleContent());
      const [row] = await db
        .select({ item: contentItems, progress: studentContentProgress })
        .from(contentItems)
        .leftJoin(
          studentContentProgress,
          and(
            eq(studentContentProgress.contentItemId, contentItems.id),
            eq(studentContentProgress.studentId, user.id),
          ),
        )
        .where(and(...conditions));
      if (!row) throw notFound("Content item");
      return { ...row.item, progress: row.progress };
    },
  )
  .patch(
    "/:id",
    {
      summary: "Update a content item",
      description: "Accepts JSON or multipart (to replace the file).",
      roles: AUTHOR_ROLES,
      params: idParams,
      body: updateContentBody,
      multipart: true,
      middleware: [upload.single("file")],
    },
    async ({ req, user, params, body }) => {
      const existing = await getContentOrThrow(params.id);
      assertCanEdit(user, existing.createdBy);
      const patch = req.file
        ? { ...body, url: publicFileUrl(req.file.filename), fileSizeBytes: req.file.size }
        : body;
      const [item] = await db.update(contentItems).set(patch).where(eq(contentItems.id, params.id)).returning();
      return item;
    },
  )
  .delete(
    "/:id",
    { summary: "Soft-delete a content item", roles: AUTHOR_ROLES, params: idParams },
    async ({ user, params }) => {
      const existing = await getContentOrThrow(params.id);
      assertCanEdit(user, existing.createdBy);
      await db
        .update(contentItems)
        .set({ deletedAt: new Date(), isPublished: false })
        .where(eq(contentItems.id, params.id));
    },
  )
  .put(
    "/:id/progress",
    {
      summary: "Record my progress on a content item",
      description: `Upserts watch percentage, resume position, completion and bookmark. Watching ${COMPLETION_THRESHOLD_PCT}%+ marks the item completed.`,
      roles: ["student"],
      params: idParams,
      body: progressBody,
    },
    async ({ user, params, body }) => {
      const [item] = await db
        .select({ id: contentItems.id, type: contentItems.type })
        .from(contentItems)
        .where(and(eq(contentItems.id, params.id), visibleContent()));
      if (!item) throw notFound("Content item");

      const patch = { ...body, lastAccessedAt: new Date() };
      if (body.watchedPct !== undefined && body.watchedPct >= COMPLETION_THRESHOLD_PCT) patch.completed = true;
      if (item.type !== "video" && body.watchedPct === undefined && body.bookmarked === undefined) {
        patch.watchedPct = 100;
      }

      const [progress] = await db
        .insert(studentContentProgress)
        .values({ studentId: user.id, contentItemId: params.id, ...patch })
        .onConflictDoUpdate({
          target: [studentContentProgress.studentId, studentContentProgress.contentItemId],
          set: patch,
        })
        .returning();
      return progress;
    },
  );
