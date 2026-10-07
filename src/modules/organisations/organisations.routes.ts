import { and, count, desc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  batches,
  db,
  organisations,
  orgStatusEnum,
  orgTypeEnum,
  orgUsers,
  userProfiles,
  users,
} from "../../db/index.js";
import {
  assertOrgAccess,
  getUserOrgIds,
  isSuperAdmin,
  ORG_STAFF_ROLES,
} from "../../lib/access.js";
import { ApiModule } from "../../lib/api-module.js";
import { fullName } from "../../lib/dates.js";
import { notFound } from "../../lib/http-error.js";
import { offsetOf, paginate } from "../../lib/pagination.js";
import {
  addressSchema,
  email,
  idParams,
  isoDate,
  paginationQuery,
  phone,
  url,
} from "../../lib/validation.js";
import { assertUserRole, rethrowUniqueAsConflict } from "../users/users.service.js";

export const organisationsModule = new ApiModule("Organisations", "/organisations");

const orgBody = z.object({
  name: z.string().trim().min(2).max(255),
  type: z.enum(orgTypeEnum.enumValues),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, "Use 2–20 letters, digits or dashes"),
  addressJson: addressSchema,
  contactEmail: email,
  contactPhone: phone,
  principalName: z.string().trim().max(100).nullable().optional(),
  affiliationBoard: z.enum(["CBSE", "ICSE", "State", "IB", "Other"]).nullable().optional(),
  partnershipStart: isoDate.nullable().optional(),
  logoUrl: url.nullable().optional(),
  status: z.enum(orgStatusEnum.enumValues).optional(),
  metadataJson: z.record(z.string(), z.unknown()).nullable().optional(),
});

const listQuery = paginationQuery.extend({
  type: z.enum(orgTypeEnum.enumValues).optional(),
  status: z.enum(orgStatusEnum.enumValues).optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

const memberParams = z.object({ id: z.uuid(), userId: z.uuid() });

const roleInOrg = z.enum(["admin", "coordinator", "teacher", "mentor"]);

const addMemberBody = z.object({
  userId: z.uuid(),
  roleInOrg,
  isPrimaryOrg: z.boolean().default(true),
});

const updateMemberBody = z
  .object({ roleInOrg, isPrimaryOrg: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field" });

async function getOrgOrThrow(id: string) {
  const [org] = await db
    .select()
    .from(organisations)
    .where(and(eq(organisations.id, id), isNull(organisations.deletedAt)));
  if (!org) throw notFound("Organisation");
  return org;
}

organisationsModule
  .get(
    "/",
    {
      summary: "List organisations",
      description: "super_admin sees all; centre admins and coordinators see their own.",
      roles: ORG_STAFF_ROLES,
      query: listQuery,
    },
    async ({ user, query }) => {
      const conditions: SQL[] = [isNull(organisations.deletedAt)];
      if (!isSuperAdmin(user)) {
        const orgIds = await getUserOrgIds(user.id);
        if (!orgIds.length) return paginate([], 0, query.page, query.limit);
        conditions.push(inArray(organisations.id, orgIds));
      }
      if (query.type) conditions.push(eq(organisations.type, query.type));
      if (query.status) conditions.push(eq(organisations.status, query.status));
      if (query.search) {
        const term = `%${query.search}%`;
        conditions.push(or(ilike(organisations.name, term), ilike(organisations.code, term))!);
      }
      const where = and(...conditions);
      const [rows, [total]] = await Promise.all([
        db
          .select()
          .from(organisations)
          .where(where)
          .orderBy(desc(organisations.createdAt))
          .limit(query.limit)
          .offset(offsetOf(query.page, query.limit)),
        db.select({ value: count() }).from(organisations).where(where),
      ]);
      return paginate(rows, total?.value ?? 0, query.page, query.limit);
    },
  )
  .post(
    "/",
    { summary: "Create an organisation", roles: ["super_admin"], body: orgBody, status: 201 },
    async ({ body }) => {
      try {
        const [org] = await db.insert(organisations).values(body).returning();
        return org;
      } catch (err) {
        rethrowUniqueAsConflict(err, "An organisation with this code already exists");
      }
    },
  )
  .get(
    "/:id",
    { summary: "Get an organisation", roles: ORG_STAFF_ROLES, params: idParams },
    async ({ user, params }) => {
      await assertOrgAccess(user, params.id, false);
      const org = await getOrgOrThrow(params.id);
      const [[members], [batchCount]] = await Promise.all([
        db
          .select({ value: count() })
          .from(orgUsers)
          .where(and(eq(orgUsers.orgId, org.id), isNull(orgUsers.leftAt))),
        db.select({ value: count() }).from(batches).where(eq(batches.orgId, org.id)),
      ]);
      return { ...org, memberCount: members?.value ?? 0, batchCount: batchCount?.value ?? 0 };
    },
  )
  .patch(
    "/:id",
    {
      summary: "Update an organisation",
      description: "Centre admins may update their own organisation but not its status or code.",
      roles: ["super_admin", "centre_admin"],
      params: idParams,
      body: orgBody.partial(),
    },
    async ({ user, params, body }) => {
      await assertOrgAccess(user, params.id);
      await getOrgOrThrow(params.id);
      const patch = { ...body };
      if (!isSuperAdmin(user)) {
        delete patch.status;
        delete patch.code;
      }
      try {
        const [org] = await db
          .update(organisations)
          .set(patch)
          .where(eq(organisations.id, params.id))
          .returning();
        return org;
      } catch (err) {
        rethrowUniqueAsConflict(err, "An organisation with this code already exists");
      }
    },
  )
  .delete(
    "/:id",
    {
      summary: "Soft-delete an organisation",
      description: "Marks the organisation inactive and stamps `deleted_at`.",
      roles: ["super_admin"],
      params: idParams,
    },
    async ({ params }) => {
      await getOrgOrThrow(params.id);
      await db
        .update(organisations)
        .set({ status: "inactive", deletedAt: new Date() })
        .where(eq(organisations.id, params.id));
    },
  )
  .get(
    "/:id/users",
    {
      summary: "List organisation members",
      roles: ORG_STAFF_ROLES,
      params: idParams,
      query: z.object({ includeFormer: z.enum(["true", "false"]).optional() }),
    },
    async ({ user, params, query }) => {
      await assertOrgAccess(user, params.id, false);
      const conditions: SQL[] = [eq(orgUsers.orgId, params.id)];
      if (query.includeFormer !== "true") conditions.push(isNull(orgUsers.leftAt));
      const rows = await db
        .select({
          membership: orgUsers,
          email: users.email,
          phone: users.phone,
          role: users.role,
          status: users.status,
          firstName: userProfiles.firstName,
          lastName: userProfiles.lastName,
        })
        .from(orgUsers)
        .innerJoin(users, eq(users.id, orgUsers.userId))
        .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(and(...conditions))
        .orderBy(desc(orgUsers.joinedAt));
      return rows.map(({ membership, firstName, lastName, ...rest }) => ({
        ...membership,
        ...rest,
        name: fullName(firstName, lastName),
      }));
    },
  )
  .post(
    "/:id/users",
    {
      summary: "Add a member to an organisation",
      description: "Re-adding a former member clears `left_at`.",
      roles: ["super_admin", "centre_admin"],
      params: idParams,
      body: addMemberBody,
      status: 201,
    },
    async ({ user, params, body }) => {
      await assertOrgAccess(user, params.id);
      await getOrgOrThrow(params.id);
      await assertUserRole(
        body.userId,
        ["centre_admin", "school_coordinator", "teacher", "mentor"],
        "userId",
      );
      return db.transaction(async (tx) => {
        if (body.isPrimaryOrg) {
          await tx.update(orgUsers).set({ isPrimaryOrg: false }).where(eq(orgUsers.userId, body.userId));
        }
        const [row] = await tx
          .insert(orgUsers)
          .values({ orgId: params.id, ...body })
          .onConflictDoUpdate({
            target: [orgUsers.orgId, orgUsers.userId],
            set: { roleInOrg: body.roleInOrg, isPrimaryOrg: body.isPrimaryOrg, leftAt: null, joinedAt: new Date() },
          })
          .returning();
        return row;
      });
    },
  )
  .patch(
    "/:id/users/:userId",
    {
      summary: "Update a member's role in the organisation",
      roles: ["super_admin", "centre_admin"],
      params: memberParams,
      body: updateMemberBody,
    },
    async ({ user, params, body }) => {
      await assertOrgAccess(user, params.id);
      return db.transaction(async (tx) => {
        if (body.isPrimaryOrg) {
          await tx.update(orgUsers).set({ isPrimaryOrg: false }).where(eq(orgUsers.userId, params.userId));
        }
        const [row] = await tx
          .update(orgUsers)
          .set(body)
          .where(and(eq(orgUsers.orgId, params.id), eq(orgUsers.userId, params.userId)))
          .returning();
        if (!row) throw notFound("Membership");
        return row;
      });
    },
  )
  .delete(
    "/:id/users/:userId",
    {
      summary: "Remove a member from an organisation",
      description: "Stamps `left_at`; the membership row is kept for history.",
      roles: ["super_admin", "centre_admin"],
      params: memberParams,
    },
    async ({ user, params }) => {
      await assertOrgAccess(user, params.id);
      const [row] = await db
        .update(orgUsers)
        .set({ leftAt: new Date(), isPrimaryOrg: false })
        .where(
          and(eq(orgUsers.orgId, params.id), eq(orgUsers.userId, params.userId), isNull(orgUsers.leftAt)),
        )
        .returning({ id: orgUsers.id });
      if (!row) throw notFound("Membership");
    },
  );
