import { and, asc, eq, ilike, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  chapters,
  contentItems,
  db,
  difficultyEnum,
  examTypeEnum,
  programs,
  studentContentProgress,
  subjects,
  topics,
} from "../../db/index.js";
import { ADMIN_ROLES, isStaff } from "../../lib/access.js";
import { ApiModule } from "../../lib/api-module.js";
import { badRequest, notFound } from "../../lib/http-error.js";
import { booleanish, idParams, url } from "../../lib/validation.js";
import { rethrowUniqueAsConflict } from "../users/users.service.js";
import { buildCurriculumTree, getStudentProgramIds, visibleContent } from "./curriculum.service.js";

const nonEmpty = { message: "Provide at least one field" };
const sequenceOrder = z.coerce.number().int().min(0).max(32767);

// ---------------------------------------------------------------- Programs

export const programsModule = new ApiModule("Programs", "/programs");

const programBody = z.object({
  name: z.string().trim().min(3).max(150),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, digits and dashes")
    .max(150),
  examType: z.enum(examTypeEnum.enumValues),
  targetClass: z.array(z.number().int().min(9).max(12)).min(1),
  description: z.string().trim().nullable().optional(),
  durationMonths: z.coerce.number().int().min(1).max(60),
  isActive: z.boolean().optional(),
  thumbnailUrl: url.nullable().optional(),
});

async function getProgramOrThrow(id: string) {
  const [program] = await db.select().from(programs).where(eq(programs.id, id));
  if (!program) throw notFound("Program");
  return program;
}

programsModule
  .get(
    "/",
    {
      summary: "List programs",
      description: "Public catalogue. Inactive programs are only listed for staff who ask for them.",
      auth: false,
      query: z.object({
        examType: z.enum(examTypeEnum.enumValues).optional(),
        includeInactive: booleanish.optional(),
        search: z.string().trim().min(1).max(100).optional(),
      }),
    },
    async ({ query }) => {
      const conditions: SQL[] = [];
      if (!query.includeInactive) conditions.push(eq(programs.isActive, true));
      if (query.examType) conditions.push(eq(programs.examType, query.examType));
      if (query.search) conditions.push(ilike(programs.name, `%${query.search}%`));
      return db
        .select()
        .from(programs)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(asc(programs.name));
    },
  )
  .post(
    "/",
    { summary: "Create a program", roles: ["super_admin"], body: programBody, status: 201 },
    async ({ body }) => {
      try {
        const [program] = await db.insert(programs).values(body).returning();
        return program;
      } catch (err) {
        rethrowUniqueAsConflict(err, "A program with this slug already exists");
      }
    },
  )
  .get(
    "/:id",
    { summary: "Get a program with its subjects", auth: false, params: idParams },
    async ({ params }) => {
      const program = await getProgramOrThrow(params.id);
      const programSubjects = await db
        .select()
        .from(subjects)
        .where(eq(subjects.programId, program.id))
        .orderBy(asc(subjects.sequenceOrder));
      return { ...program, subjects: programSubjects };
    },
  )
  .get(
    "/:id/curriculum",
    {
      summary: "Full curriculum tree",
      description: "Subjects → chapters → topics with content counts. Students also get progress percentages.",
      params: idParams,
    },
    async ({ user, params }) => {
      await getProgramOrThrow(params.id);
      const subjectIds = (
        await db.select({ id: subjects.id }).from(subjects).where(eq(subjects.programId, params.id))
      ).map((s) => s.id);
      return buildCurriculumTree(subjectIds, {
        studentId: user.role === "student" ? user.id : undefined,
        includeInactive: isStaff(user),
      });
    },
  )
  .patch(
    "/:id",
    {
      summary: "Update a program",
      roles: ["super_admin"],
      params: idParams,
      body: programBody.partial().refine((v) => Object.keys(v).length > 0, nonEmpty),
    },
    async ({ params, body }) => {
      await getProgramOrThrow(params.id);
      try {
        const [program] = await db.update(programs).set(body).where(eq(programs.id, params.id)).returning();
        return program;
      } catch (err) {
        rethrowUniqueAsConflict(err, "A program with this slug already exists");
      }
    },
  )
  .delete(
    "/:id",
    { summary: "Deactivate a program", roles: ["super_admin"], params: idParams },
    async ({ params }) => {
      await getProgramOrThrow(params.id);
      await db.update(programs).set({ isActive: false }).where(eq(programs.id, params.id));
    },
  );

// ---------------------------------------------------------------- Subjects

export const subjectsModule = new ApiModule("Subjects", "/subjects");

const subjectBody = z.object({
  programId: z.uuid(),
  name: z.string().trim().min(2).max(100),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,20}$/),
  sequenceOrder,
  iconUrl: url.nullable().optional(),
});

subjectsModule
  .get(
    "/",
    {
      summary: "List subjects with progress",
      description:
        "Without `programId`, students get the subjects of the programs they are enrolled in. Each subject includes its chapter/topic tree.",
      query: z.object({ programId: z.uuid().optional() }),
    },
    async ({ user, query }) => {
      let programIds: string[];
      if (query.programId) programIds = [query.programId];
      else if (user.role === "student") programIds = await getStudentProgramIds(user.id);
      else throw badRequest("programId is required");
      if (!programIds.length) return [];

      const subjectIds = (
        await db.select({ id: subjects.id }).from(subjects).where(inArray(subjects.programId, programIds))
      ).map((s) => s.id);
      return buildCurriculumTree(subjectIds, {
        studentId: user.role === "student" ? user.id : undefined,
        includeInactive: isStaff(user),
      });
    },
  )
  .post(
    "/",
    { summary: "Create a subject", roles: ["super_admin"], body: subjectBody, status: 201 },
    async ({ body }) => {
      await getProgramOrThrow(body.programId);
      try {
        const [subject] = await db.insert(subjects).values(body).returning();
        return subject;
      } catch (err) {
        rethrowUniqueAsConflict(err, "This program already has a subject with that code");
      }
    },
  )
  .get(
    "/:id",
    { summary: "Get a subject with chapters, topics and progress", params: idParams },
    async ({ user, params }) => {
      const [tree] = await buildCurriculumTree([params.id], {
        studentId: user.role === "student" ? user.id : undefined,
        includeInactive: isStaff(user),
      });
      if (!tree) throw notFound("Subject");
      return tree;
    },
  )
  .patch(
    "/:id",
    {
      summary: "Update a subject",
      roles: ["super_admin"],
      params: idParams,
      body: subjectBody.omit({ programId: true }).partial().refine((v) => Object.keys(v).length > 0, nonEmpty),
    },
    async ({ params, body }) => {
      try {
        const [subject] = await db.update(subjects).set(body).where(eq(subjects.id, params.id)).returning();
        if (!subject) throw notFound("Subject");
        return subject;
      } catch (err) {
        rethrowUniqueAsConflict(err, "This program already has a subject with that code");
      }
    },
  );

// ---------------------------------------------------------------- Chapters

export const chaptersModule = new ApiModule("Chapters", "/chapters");

const chapterBody = z.object({
  subjectId: z.uuid(),
  name: z.string().trim().min(2).max(200),
  sequenceOrder,
  ncertRef: z.string().trim().max(50).nullable().optional(),
  isActive: z.boolean().optional(),
});

chaptersModule
  .get(
    "/",
    {
      summary: "List chapters of a subject",
      query: z.object({ subjectId: z.uuid(), includeInactive: booleanish.optional() }),
    },
    async ({ user, query }) => {
      const conditions: SQL[] = [eq(chapters.subjectId, query.subjectId)];
      if (!(query.includeInactive && isStaff(user))) conditions.push(eq(chapters.isActive, true));
      return db.select().from(chapters).where(and(...conditions)).orderBy(asc(chapters.sequenceOrder));
    },
  )
  .post(
    "/",
    { summary: "Create a chapter", roles: ADMIN_ROLES, body: chapterBody, status: 201 },
    async ({ body }) => {
      const [chapter] = await db.insert(chapters).values(body).returning();
      return chapter;
    },
  )
  .patch(
    "/:id",
    {
      summary: "Update a chapter",
      roles: ADMIN_ROLES,
      params: idParams,
      body: chapterBody.omit({ subjectId: true }).partial().refine((v) => Object.keys(v).length > 0, nonEmpty),
    },
    async ({ params, body }) => {
      const [chapter] = await db.update(chapters).set(body).where(eq(chapters.id, params.id)).returning();
      if (!chapter) throw notFound("Chapter");
      return chapter;
    },
  )
  .delete(
    "/:id",
    { summary: "Deactivate a chapter", roles: ADMIN_ROLES, params: idParams },
    async ({ params }) => {
      const [chapter] = await db
        .update(chapters)
        .set({ isActive: false })
        .where(eq(chapters.id, params.id))
        .returning({ id: chapters.id });
      if (!chapter) throw notFound("Chapter");
    },
  );

// ---------------------------------------------------------------- Topics

export const topicsModule = new ApiModule("Topics", "/topics");

const topicBody = z.object({
  chapterId: z.uuid(),
  name: z.string().trim().min(2).max(200),
  sequenceOrder,
  difficultyTag: z.enum(difficultyEnum.enumValues).optional(),
  estimatedMinutes: z.coerce.number().int().min(1).max(32767).nullable().optional(),
  isActive: z.boolean().optional(),
});

topicsModule
  .get(
    "/",
    {
      summary: "List topics of a chapter",
      query: z.object({ chapterId: z.uuid(), includeInactive: booleanish.optional() }),
    },
    async ({ user, query }) => {
      const conditions: SQL[] = [eq(topics.chapterId, query.chapterId)];
      if (!(query.includeInactive && isStaff(user))) conditions.push(eq(topics.isActive, true));
      return db.select().from(topics).where(and(...conditions)).orderBy(asc(topics.sequenceOrder));
    },
  )
  .post(
    "/",
    { summary: "Create a topic", roles: ADMIN_ROLES, body: topicBody, status: 201 },
    async ({ body }) => {
      const [topic] = await db.insert(topics).values(body).returning();
      return topic;
    },
  )
  .get(
    "/:id",
    {
      summary: "Get a topic with its content",
      description: "Students only see published, released items and get their own progress per item.",
      params: idParams,
    },
    async ({ user, params }) => {
      const [row] = await db
        .select({ topic: topics, chapterName: chapters.name, subjectId: subjects.id, subjectName: subjects.name })
        .from(topics)
        .innerJoin(chapters, eq(chapters.id, topics.chapterId))
        .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
        .where(eq(topics.id, params.id));
      if (!row) throw notFound("Topic");

      const staff = isStaff(user);
      const items = await db
        .select({ item: contentItems, progress: studentContentProgress })
        .from(contentItems)
        .leftJoin(
          studentContentProgress,
          and(
            eq(studentContentProgress.contentItemId, contentItems.id),
            eq(studentContentProgress.studentId, user.id),
          ),
        )
        .where(and(eq(contentItems.topicId, params.id), staff ? undefined : visibleContent()))
        .orderBy(asc(contentItems.sequenceOrder));

      return {
        ...row.topic,
        chapterName: row.chapterName,
        subjectId: row.subjectId,
        subjectName: row.subjectName,
        content: items
          .filter((i) => staff || !i.item.deletedAt)
          .map((i) => ({ ...i.item, progress: i.progress })),
      };
    },
  )
  .patch(
    "/:id",
    {
      summary: "Update a topic",
      roles: ADMIN_ROLES,
      params: idParams,
      body: topicBody.omit({ chapterId: true }).partial().refine((v) => Object.keys(v).length > 0, nonEmpty),
    },
    async ({ params, body }) => {
      const [topic] = await db.update(topics).set(body).where(eq(topics.id, params.id)).returning();
      if (!topic) throw notFound("Topic");
      return topic;
    },
  )
  .delete(
    "/:id",
    { summary: "Deactivate a topic", roles: ADMIN_ROLES, params: idParams },
    async ({ params }) => {
      const [topic] = await db
        .update(topics)
        .set({ isActive: false })
        .where(eq(topics.id, params.id))
        .returning({ id: topics.id });
      if (!topic) throw notFound("Topic");
    },
  );
