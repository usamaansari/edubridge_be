import { and, eq, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { db, parentStudentLinks, userProfiles } from "../../db/index.js";
import { ADMIN_ROLES } from "../../lib/access.js";
import { ApiModule } from "../../lib/api-module.js";
import { fullName } from "../../lib/dates.js";
import { notFound } from "../../lib/http-error.js";
import { idParams } from "../../lib/validation.js";
import { assertUserRole, rethrowUniqueAsConflict } from "../users/users.service.js";
import { getStudentSummary } from "../students/students.service.js";

export const parentsModule = new ApiModule("Parents", "/parents");

const createLinkBody = z.object({
  parentUserId: z.uuid(),
  studentUserId: z.uuid(),
  relationship: z.enum(["mother", "father", "guardian"]),
  isPrimary: z.boolean().default(false),
});

const listLinksQuery = z.object({
  parentUserId: z.uuid().optional(),
  studentUserId: z.uuid().optional(),
});

const parentProfile = alias(userProfiles, "parent_profile");
const studentProfile = alias(userProfiles, "student_profile");

parentsModule
  .get(
    "/me/children",
    {
      summary: "List my children with a performance summary",
      roles: ["parent"],
    },
    async ({ user }) => {
      const links = await db
        .select({
          linkId: parentStudentLinks.id,
          studentId: parentStudentLinks.studentUserId,
          relationship: parentStudentLinks.relationship,
          isPrimary: parentStudentLinks.isPrimary,
        })
        .from(parentStudentLinks)
        .where(eq(parentStudentLinks.parentUserId, user.id));
      return Promise.all(
        links.map(async (link) => ({ ...link, summary: await getStudentSummary(link.studentId) })),
      );
    },
  )
  .get(
    "/links",
    { summary: "List parent–student links", roles: ADMIN_ROLES, query: listLinksQuery },
    async ({ query }) => {
      const conditions: SQL[] = [];
      if (query.parentUserId) conditions.push(eq(parentStudentLinks.parentUserId, query.parentUserId));
      if (query.studentUserId) conditions.push(eq(parentStudentLinks.studentUserId, query.studentUserId));
      const rows = await db
        .select({
          link: parentStudentLinks,
          parentFirstName: parentProfile.firstName,
          parentLastName: parentProfile.lastName,
          studentFirstName: studentProfile.firstName,
          studentLastName: studentProfile.lastName,
        })
        .from(parentStudentLinks)
        .leftJoin(parentProfile, eq(parentProfile.userId, parentStudentLinks.parentUserId))
        .leftJoin(studentProfile, eq(studentProfile.userId, parentStudentLinks.studentUserId))
        .where(conditions.length ? and(...conditions) : undefined);
      return rows.map((r) => ({
        ...r.link,
        parentName: fullName(r.parentFirstName, r.parentLastName),
        studentName: fullName(r.studentFirstName, r.studentLastName),
      }));
    },
  )
  .post(
    "/links",
    {
      summary: "Link a parent to a student",
      roles: ADMIN_ROLES,
      body: createLinkBody,
      status: 201,
    },
    async ({ body }) => {
      await assertUserRole(body.parentUserId, ["parent"], "parentUserId");
      await assertUserRole(body.studentUserId, ["student"], "studentUserId");
      try {
        return await db.transaction(async (tx) => {
          if (body.isPrimary) {
            await tx
              .update(parentStudentLinks)
              .set({ isPrimary: false })
              .where(eq(parentStudentLinks.studentUserId, body.studentUserId));
          }
          const [link] = await tx.insert(parentStudentLinks).values(body).returning();
          return link;
        });
      } catch (err) {
        rethrowUniqueAsConflict(err, "This parent is already linked to the student");
      }
    },
  )
  .delete(
    "/links/:id",
    { summary: "Remove a parent–student link", roles: ADMIN_ROLES, params: idParams },
    async ({ params }) => {
      const [row] = await db
        .delete(parentStudentLinks)
        .where(eq(parentStudentLinks.id, params.id))
        .returning({ id: parentStudentLinks.id });
      if (!row) throw notFound("Link");
    },
  );
