import { and, count, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";

import {
  batchStudents,
  db,
  type DbOrTx,
  notifications,
  type NotificationData,
  type NotificationType,
  orgUsers,
  parentStudentLinks,
  type Role,
  users,
} from "../../db/index.js";
import { badRequest, notFound } from "../../lib/http-error.js";
import { offsetOf, paginate } from "../../lib/pagination.js";

export type NotifyInput = {
  userIds: string[];
  type: NotificationType;
  title: string;
  body: string;
  data?: NotificationData;
  channels?: string[];
};

/**
 * Persists in-app notifications. `sent_at` stays null until a delivery worker
 * (push/email/SMS/WhatsApp) dispatches them.
 */
export async function notify(input: NotifyInput, tx: DbOrTx = db) {
  const userIds = [...new Set(input.userIds)];
  if (!userIds.length) return [];
  return tx
    .insert(notifications)
    .values(
      userIds.map((userId) => ({
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        dataJson: input.data ?? null,
        channels: input.channels ?? ["push"],
      })),
    )
    .returning({ id: notifications.id });
}

export async function getParentIds(studentId: string): Promise<string[]> {
  const rows = await db
    .select({ parentId: parentStudentLinks.parentUserId })
    .from(parentStudentLinks)
    .where(eq(parentStudentLinks.studentUserId, studentId));
  return rows.map((r) => r.parentId);
}

export async function listNotifications(
  userId: string,
  query: { page: number; limit: number; unread?: boolean; type?: NotificationType },
) {
  const conditions: SQL[] = [eq(notifications.userId, userId)];
  if (query.unread !== undefined) conditions.push(eq(notifications.isRead, !query.unread));
  if (query.type) conditions.push(eq(notifications.type, query.type));
  const where = and(...conditions);

  const [rows, [total], [unread]] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(query.limit)
      .offset(offsetOf(query.page, query.limit)),
    db.select({ value: count() }).from(notifications).where(where),
    db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false))),
  ]);

  const page = paginate(rows, total?.value ?? 0, query.page, query.limit);
  return { ...page, meta: { ...page.meta, unreadCount: unread?.value ?? 0 } };
}

export async function unreadCount(userId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return { unreadCount: row?.value ?? 0 };
}

export async function markRead(userId: string, id: string) {
  const [row] = await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning();
  if (!row) throw notFound("Notification");
  return row;
}

export async function markAllRead(userId: string) {
  const rows = await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
    .returning({ id: notifications.id });
  return { updated: rows.length };
}

export type BroadcastTarget = {
  userIds?: string[];
  role?: Role;
  orgId?: string;
  batchId?: string;
  includeParents?: boolean;
};

export async function resolveRecipients(target: BroadcastTarget): Promise<string[]> {
  const ids = new Set<string>(target.userIds ?? []);

  if (target.batchId) {
    const rows = await db
      .select({ id: batchStudents.studentId })
      .from(batchStudents)
      .where(and(eq(batchStudents.batchId, target.batchId), eq(batchStudents.status, "active")));
    rows.forEach((r) => ids.add(r.id));
  }

  if (target.orgId) {
    const rows = await db
      .select({ id: orgUsers.userId })
      .from(orgUsers)
      .where(and(eq(orgUsers.orgId, target.orgId), isNull(orgUsers.leftAt)));
    rows.forEach((r) => ids.add(r.id));
  }

  if (target.role) {
    const conditions: SQL[] = [eq(users.role, target.role), isNull(users.deletedAt)];
    if (target.orgId || target.batchId) {
      // Narrow the role filter to the already-resolved org/batch audience.
      if (!ids.size) return [];
      conditions.push(inArray(users.id, [...ids]));
      ids.clear();
    }
    const rows = await db.select({ id: users.id }).from(users).where(and(...conditions));
    rows.forEach((r) => ids.add(r.id));
  }

  if (target.includeParents && ids.size) {
    const rows = await db
      .select({ id: parentStudentLinks.parentUserId })
      .from(parentStudentLinks)
      .where(inArray(parentStudentLinks.studentUserId, [...ids]));
    rows.forEach((r) => ids.add(r.id));
  }

  if (!ids.size) throw badRequest("The broadcast target matched no users");
  return [...ids];
}
