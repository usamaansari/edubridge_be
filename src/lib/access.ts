import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  batches,
  batchFaculty,
  batchStudents,
  db,
  mentorAssignments,
  orgUsers,
  parentStudentLinks,
  type Role,
} from "../db/index.js";
import type { AuthUser } from "../middleware/auth.js";
import { forbidden, notFound } from "./http-error.js";

export const ADMIN_ROLES = ["super_admin", "centre_admin"] as const satisfies readonly Role[];
export const ORG_STAFF_ROLES = [
  "super_admin",
  "centre_admin",
  "school_coordinator",
] as const satisfies readonly Role[];
export const FACULTY_ROLES = ["teacher", "mentor"] as const satisfies readonly Role[];
export const STAFF_ROLES = [
  "super_admin",
  "centre_admin",
  "school_coordinator",
  "teacher",
  "mentor",
] as const satisfies readonly Role[];
export const AUTHOR_ROLES = [
  "super_admin",
  "centre_admin",
  "teacher",
  "mentor",
] as const satisfies readonly Role[];

export const isSuperAdmin = (user: AuthUser) => user.role === "super_admin";
export const isAdmin = (user: AuthUser) => (ADMIN_ROLES as readonly Role[]).includes(user.role);
export const isOrgStaff = (user: AuthUser) =>
  (ORG_STAFF_ROLES as readonly Role[]).includes(user.role);
export const isStaff = (user: AuthUser) => (STAFF_ROLES as readonly Role[]).includes(user.role);
export const isFaculty = (user: AuthUser) => (FACULTY_ROLES as readonly Role[]).includes(user.role);

export async function getUserOrgIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ orgId: orgUsers.orgId })
    .from(orgUsers)
    .where(and(eq(orgUsers.userId, userId), isNull(orgUsers.leftAt)));
  return rows.map((r) => r.orgId);
}

/**
 * super_admin: any org. centre_admin: orgs they belong to.
 * school_coordinator: read-only access to their orgs (`manage: false`).
 */
export async function assertOrgAccess(user: AuthUser, orgId: string, manage = true) {
  if (isSuperAdmin(user)) return;
  const allowed = manage ? user.role === "centre_admin" : isOrgStaff(user);
  if (allowed && (await getUserOrgIds(user.id)).includes(orgId)) return;
  throw forbidden("You do not have access to this organisation");
}

export async function getStudentBatchIds(studentId: string): Promise<string[]> {
  const rows = await db
    .select({ batchId: batchStudents.batchId })
    .from(batchStudents)
    .where(and(eq(batchStudents.studentId, studentId), eq(batchStudents.status, "active")));
  return rows.map((r) => r.batchId);
}

export async function getFacultyBatchIds(userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ batchId: batchFaculty.batchId })
    .from(batchFaculty)
    .where(eq(batchFaculty.userId, userId));
  return rows.map((r) => r.batchId);
}

export async function getParentChildIds(parentId: string): Promise<string[]> {
  const rows = await db
    .select({ studentId: parentStudentLinks.studentUserId })
    .from(parentStudentLinks)
    .where(eq(parentStudentLinks.parentUserId, parentId));
  return rows.map((r) => r.studentId);
}

/** Batch ids the user may read, or `null` when unrestricted (super_admin). */
export async function getAccessibleBatchIds(user: AuthUser): Promise<string[] | null> {
  switch (user.role) {
    case "super_admin":
      return null;
    case "centre_admin":
    case "school_coordinator": {
      const orgIds = await getUserOrgIds(user.id);
      if (!orgIds.length) return [];
      const rows = await db
        .select({ id: batches.id })
        .from(batches)
        .where(inArray(batches.orgId, orgIds));
      return rows.map((r) => r.id);
    }
    case "teacher":
    case "mentor":
      return getFacultyBatchIds(user.id);
    case "student":
      return getStudentBatchIds(user.id);
    case "parent": {
      const childIds = await getParentChildIds(user.id);
      if (!childIds.length) return [];
      const rows = await db
        .selectDistinct({ batchId: batchStudents.batchId })
        .from(batchStudents)
        .where(and(inArray(batchStudents.studentId, childIds), eq(batchStudents.status, "active")));
      return rows.map((r) => r.batchId);
    }
  }
}

export async function getBatchOrThrow(batchId: string) {
  const [batch] = await db.select().from(batches).where(eq(batches.id, batchId));
  if (!batch) throw notFound("Batch");
  return batch;
}

/** `manage` = create/update rights (admins of the batch's org). */
export async function assertBatchAccess(user: AuthUser, batchId: string, manage = false) {
  const batch = await getBatchOrThrow(batchId);
  if (manage) {
    await assertOrgAccess(user, batch.orgId, true);
    return batch;
  }
  const accessible = await getAccessibleBatchIds(user);
  if (accessible === null || accessible.includes(batchId)) return batch;
  throw forbidden("You do not have access to this batch");
}

async function sharesBatch(facultyId: string, studentId: string): Promise<boolean> {
  const facultyBatches = await getFacultyBatchIds(facultyId);
  if (!facultyBatches.length) return false;
  const [row] = await db
    .select({ id: batchStudents.id })
    .from(batchStudents)
    .where(
      and(eq(batchStudents.studentId, studentId), inArray(batchStudents.batchId, facultyBatches)),
    )
    .limit(1);
  return Boolean(row);
}

export async function canViewStudent(user: AuthUser, studentId: string): Promise<boolean> {
  if (user.id === studentId) return true;
  switch (user.role) {
    case "super_admin":
    case "centre_admin":
      return true;
    case "school_coordinator": {
      const accessible = await getAccessibleBatchIds(user);
      if (!accessible?.length) return false;
      const [row] = await db
        .select({ id: batchStudents.id })
        .from(batchStudents)
        .where(and(eq(batchStudents.studentId, studentId), inArray(batchStudents.batchId, accessible)))
        .limit(1);
      return Boolean(row);
    }
    case "parent":
      return (await getParentChildIds(user.id)).includes(studentId);
    case "mentor": {
      const [assignment] = await db
        .select({ id: mentorAssignments.id })
        .from(mentorAssignments)
        .where(
          and(
            eq(mentorAssignments.mentorId, user.id),
            eq(mentorAssignments.studentId, studentId),
            eq(mentorAssignments.isActive, true),
          ),
        )
        .limit(1);
      return Boolean(assignment) || sharesBatch(user.id, studentId);
    }
    case "teacher":
      return sharesBatch(user.id, studentId);
    case "student":
      return false;
  }
}

export async function assertCanViewStudent(user: AuthUser, studentId: string) {
  if (!(await canViewStudent(user, studentId))) {
    throw forbidden("You do not have access to this student");
  }
}

export async function isMentorOf(mentorId: string, studentId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: mentorAssignments.id })
    .from(mentorAssignments)
    .where(
      and(
        eq(mentorAssignments.mentorId, mentorId),
        eq(mentorAssignments.studentId, studentId),
        eq(mentorAssignments.isActive, true),
      ),
    )
    .limit(1);
  return Boolean(row);
}
