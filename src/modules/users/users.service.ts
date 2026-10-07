import bcrypt from "bcryptjs";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import {
  type Address,
  batches,
  batchStudents,
  db,
  organisations,
  orgUsers,
  parentStudentLinks,
  type Role,
  userProfiles,
  users,
  type UserStatus,
} from "../../db/index.js";
import { getUserOrgIds, isSuperAdmin } from "../../lib/access.js";
import { BCRYPT_ROUNDS } from "../../lib/crypto.js";
import { fullName } from "../../lib/dates.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/http-error.js";
import { offsetOf, paginate } from "../../lib/pagination.js";
import { getPgError, PG_UNIQUE_VIOLATION } from "../../lib/pg-error.js";
import type { AuthUser } from "../../middleware/auth.js";
import { revokeAllRefreshTokens } from "../auth/token.service.js";

export const publicUserColumns = {
  id: users.id,
  email: users.email,
  phone: users.phone,
  role: users.role,
  status: users.status,
  emailVerified: users.emailVerified,
  phoneVerified: users.phoneVerified,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

export const userSummaryColumns = {
  id: users.id,
  email: users.email,
  phone: users.phone,
  role: users.role,
  status: users.status,
  firstName: userProfiles.firstName,
  lastName: userProfiles.lastName,
  profilePicUrl: userProfiles.profilePicUrl,
} as const;

/** Roles a centre admin may create or manage. super_admin can manage everything. */
const CENTRE_MANAGEABLE_ROLES: readonly Role[] = [
  "school_coordinator",
  "teacher",
  "mentor",
  "student",
  "parent",
];

export function assertCanManageRole(actor: AuthUser, role: Role) {
  if (isSuperAdmin(actor)) return;
  if (actor.role === "centre_admin" && CENTRE_MANAGEABLE_ROLES.includes(role)) return;
  throw forbidden(`You cannot manage users with role ${role}`);
}

export function rethrowUniqueAsConflict(err: unknown, message: string): never {
  if (getPgError(err)?.code === PG_UNIQUE_VIOLATION) throw conflict(message);
  throw err;
}

async function getPrimaryOrgId(userId: string, role: Role): Promise<string | null> {
  const [membership] = await db
    .select({ orgId: orgUsers.orgId })
    .from(orgUsers)
    .where(and(eq(orgUsers.userId, userId), isNull(orgUsers.leftAt)))
    .orderBy(desc(orgUsers.isPrimaryOrg), asc(orgUsers.joinedAt))
    .limit(1);
  if (membership) return membership.orgId;
  if (role !== "student") return null;
  const [enrollment] = await db
    .select({ orgId: batches.orgId })
    .from(batchStudents)
    .innerJoin(batches, eq(batches.id, batchStudents.batchId))
    .where(and(eq(batchStudents.studentId, userId), eq(batchStudents.status, "active")))
    .orderBy(desc(batchStudents.enrolledAt))
    .limit(1);
  return enrollment?.orgId ?? null;
}

/** Shape the frontend stores in its `eb_session` cookie. */
export async function getSessionUser(userId: string) {
  const [row] = await db
    .select({ ...publicUserColumns, firstName: userProfiles.firstName, lastName: userProfiles.lastName, profilePicUrl: userProfiles.profilePicUrl })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(eq(users.id, userId));
  if (!row) throw notFound("User");
  return {
    id: row.id,
    name: fullName(row.firstName, row.lastName) || row.email,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    emailVerified: row.emailVerified,
    phoneVerified: row.phoneVerified,
    firstName: row.firstName,
    lastName: row.lastName,
    profilePicUrl: row.profilePicUrl,
    organisationId: await getPrimaryOrgId(row.id, row.role),
  };
}

export async function getUserDetail(userId: string) {
  const [row] = await db
    .select({ user: publicUserColumns, profile: userProfiles, deletedAt: users.deletedAt })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(eq(users.id, userId));
  if (!row) throw notFound("User");

  const memberships = await db
    .select({
      orgId: orgUsers.orgId,
      orgName: organisations.name,
      orgCode: organisations.code,
      roleInOrg: orgUsers.roleInOrg,
      isPrimaryOrg: orgUsers.isPrimaryOrg,
      joinedAt: orgUsers.joinedAt,
      leftAt: orgUsers.leftAt,
    })
    .from(orgUsers)
    .innerJoin(organisations, eq(organisations.id, orgUsers.orgId))
    .where(eq(orgUsers.userId, userId));

  const detail: Record<string, unknown> = {
    ...row.user,
    deletedAt: row.deletedAt,
    name: fullName(row.profile?.firstName, row.profile?.lastName),
    profile: row.profile,
    organisations: memberships,
  };

  if (row.user.role === "student") {
    detail.enrollments = await db
      .select({
        id: batchStudents.id,
        batchId: batchStudents.batchId,
        batchName: batches.name,
        enrollmentNo: batchStudents.enrollmentNo,
        status: batchStudents.status,
        enrolledAt: batchStudents.enrolledAt,
      })
      .from(batchStudents)
      .innerJoin(batches, eq(batches.id, batchStudents.batchId))
      .where(eq(batchStudents.studentId, userId));
    detail.parents = await db
      .select({
        linkId: parentStudentLinks.id,
        relationship: parentStudentLinks.relationship,
        isPrimary: parentStudentLinks.isPrimary,
        ...userSummaryColumns,
      })
      .from(parentStudentLinks)
      .innerJoin(users, eq(users.id, parentStudentLinks.parentUserId))
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(eq(parentStudentLinks.studentUserId, userId));
  }

  if (row.user.role === "parent") {
    detail.children = await db
      .select({
        linkId: parentStudentLinks.id,
        relationship: parentStudentLinks.relationship,
        isPrimary: parentStudentLinks.isPrimary,
        ...userSummaryColumns,
      })
      .from(parentStudentLinks)
      .innerJoin(users, eq(users.id, parentStudentLinks.studentUserId))
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(eq(parentStudentLinks.parentUserId, userId));
  }

  return detail;
}

export type ListUsersQuery = {
  page: number;
  limit: number;
  role?: Role;
  status?: UserStatus;
  search?: string;
  orgId?: string;
  batchId?: string;
  includeDeleted?: boolean;
};

export async function listUsers(query: ListUsersQuery) {
  const conditions: SQL[] = [];
  if (!query.includeDeleted) conditions.push(isNull(users.deletedAt));
  if (query.role) conditions.push(eq(users.role, query.role));
  if (query.status) conditions.push(eq(users.status, query.status));
  if (query.search) {
    const term = `%${query.search}%`;
    conditions.push(
      or(
        ilike(users.email, term),
        ilike(users.phone, term),
        ilike(sql`${userProfiles.firstName} || ' ' || ${userProfiles.lastName}`, term),
      )!,
    );
  }
  if (query.orgId) {
    conditions.push(
      inArray(
        users.id,
        db
          .select({ id: orgUsers.userId })
          .from(orgUsers)
          .where(and(eq(orgUsers.orgId, query.orgId), isNull(orgUsers.leftAt))),
      ),
    );
  }
  if (query.batchId) {
    conditions.push(
      inArray(
        users.id,
        db
          .select({ id: batchStudents.studentId })
          .from(batchStudents)
          .where(eq(batchStudents.batchId, query.batchId)),
      ),
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, [total]] = await Promise.all([
    db
      .select({ ...userSummaryColumns, emailVerified: users.emailVerified, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(query.limit)
      .offset(offsetOf(query.page, query.limit)),
    db
      .select({ value: count() })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(where),
  ]);

  return paginate(
    rows.map((r) => ({ ...r, name: fullName(r.firstName, r.lastName) })),
    total?.value ?? 0,
    query.page,
    query.limit,
  );
}

export type ProfileInput = {
  firstName?: string;
  lastName?: string;
  dob?: string | null;
  gender?: "male" | "female" | "other" | "prefer_not_to_say" | null;
  addressJson?: Address | null;
  profilePicUrl?: string | null;
  bio?: string | null;
};

export type CreateUserInput = ProfileInput & {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  role: Role;
  status?: UserStatus;
  orgId?: string;
  roleInOrg?: string;
};

export async function createUser(input: CreateUserInput) {
  const { email, phone, password, role, status, orgId, roleInOrg, ...profile } = input;
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  try {
    const userId = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email, phone, passwordHash, role, status: status ?? "active" })
        .returning({ id: users.id });
      if (!user) throw new Error("Failed to create user");
      await tx.insert(userProfiles).values({ ...profile, userId: user.id });
      if (orgId) {
        await tx.insert(orgUsers).values({
          orgId,
          userId: user.id,
          roleInOrg: roleInOrg ?? defaultRoleInOrg(role),
        });
      }
      return user.id;
    });
    return getUserDetail(userId);
  } catch (err) {
    rethrowUniqueAsConflict(err, "Email or phone is already registered");
  }
}

export function defaultRoleInOrg(role: Role): string {
  switch (role) {
    case "centre_admin":
    case "super_admin":
      return "admin";
    case "school_coordinator":
      return "coordinator";
    case "mentor":
      return "mentor";
    default:
      return "teacher";
  }
}

export async function getUserRow(userId: string) {
  const [row] = await db
    .select({ id: users.id, role: users.role, status: users.status, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId));
  if (!row) throw notFound("User");
  return row;
}

/** Returns the user if it exists, is not deleted and has the expected role. */
export async function assertUserRole(userId: string, roles: readonly Role[], label = "User") {
  const row = await getUserRow(userId);
  if (row.deletedAt || !roles.includes(row.role)) {
    throw badRequest(`${label} must be an active user with role ${roles.join(" or ")}`);
  }
  return row;
}

export type UpdateUserInput = ProfileInput & {
  email?: string;
  phone?: string;
  role?: Role;
  password?: string;
};

export async function updateUser(actor: AuthUser, userId: string, input: UpdateUserInput) {
  const target = await getUserRow(userId);
  if (target.deletedAt) throw notFound("User");
  assertCanManageRole(actor, target.role);
  if (input.role) assertCanManageRole(actor, input.role);
  await applyUserUpdate(userId, input);
  if (input.password || input.role) await revokeAllRefreshTokens(userId);
  return getUserDetail(userId);
}

export async function updateOwnProfile(userId: string, input: ProfileInput & { phone?: string }) {
  await applyUserUpdate(userId, input);
  return getUserDetail(userId);
}

async function applyUserUpdate(userId: string, input: UpdateUserInput) {
  const { email, phone, role, password, ...profile } = input;
  const userPatch: Partial<typeof users.$inferInsert> = {};
  if (email !== undefined) Object.assign(userPatch, { email, emailVerified: false });
  if (phone !== undefined) Object.assign(userPatch, { phone, phoneVerified: false });
  if (role !== undefined) userPatch.role = role;
  if (password !== undefined) userPatch.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  try {
    await db.transaction(async (tx) => {
      if (Object.keys(userPatch).length) {
        await tx.update(users).set(userPatch).where(eq(users.id, userId));
      }
      if (Object.keys(profile).length) {
        await tx.update(userProfiles).set(profile).where(eq(userProfiles.userId, userId));
      }
    });
  } catch (err) {
    rethrowUniqueAsConflict(err, "Email or phone is already registered");
  }
}

export async function setUserStatus(actor: AuthUser, userId: string, status: UserStatus) {
  if (actor.id === userId) throw badRequest("You cannot change your own status");
  const target = await getUserRow(userId);
  if (target.deletedAt) throw notFound("User");
  assertCanManageRole(actor, target.role);

  await db
    .update(users)
    .set({ status, deletedAt: status === "deleted" ? new Date() : null })
    .where(eq(users.id, userId));
  if (status === "suspended" || status === "deleted") await revokeAllRefreshTokens(userId);
  return getUserDetail(userId);
}

/** Centre admins only see users that belong to one of their organisations. */
export async function assertCanViewUser(actor: AuthUser, userId: string) {
  if (actor.id === userId || isSuperAdmin(actor)) return;
  if (actor.role !== "centre_admin") throw forbidden();
  const orgIds = await getUserOrgIds(actor.id);
  const target = await getUserRow(userId);
  if (target.role === "student" || target.role === "parent") return;
  if (!orgIds.length) throw forbidden();
  const [membership] = await db
    .select({ id: orgUsers.id })
    .from(orgUsers)
    .where(and(eq(orgUsers.userId, userId), inArray(orgUsers.orgId, orgIds)))
    .limit(1);
  if (!membership) throw forbidden();
}
