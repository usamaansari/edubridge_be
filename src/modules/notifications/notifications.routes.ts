import { z } from "zod";

import { notificationTypeEnum, NOTIFICATION_CHANNELS, roleEnum } from "../../db/index.js";
import { ADMIN_ROLES, assertBatchAccess, assertOrgAccess } from "../../lib/access.js";
import { ApiModule } from "../../lib/api-module.js";
import { forbidden } from "../../lib/http-error.js";
import { booleanish, idParams, paginationQuery } from "../../lib/validation.js";
import {
  listNotifications,
  markAllRead,
  markRead,
  notify,
  resolveRecipients,
  unreadCount,
} from "./notifications.service.js";

export const notificationsModule = new ApiModule("Notifications", "/notifications");

const listQuery = paginationQuery.extend({
  unread: booleanish.optional(),
  type: z.enum(notificationTypeEnum.enumValues).optional(),
});

const broadcastBody = z.object({
  type: z.enum(notificationTypeEnum.enumValues).default("announcement"),
  title: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1),
  channels: z.array(z.enum(NOTIFICATION_CHANNELS)).min(1).default(["push"]),
  data: z.record(z.string(), z.unknown()).optional(),
  target: z
    .object({
      userIds: z.array(z.uuid()).optional(),
      role: z.enum(roleEnum.enumValues).optional(),
      orgId: z.uuid().optional(),
      batchId: z.uuid().optional(),
      includeParents: z.boolean().default(false),
    })
    .refine((t) => t.userIds?.length || t.role || t.orgId || t.batchId, {
      message: "Specify at least one of userIds, role, orgId or batchId",
    }),
});

notificationsModule
  .get(
    "/",
    { summary: "List my notifications", query: listQuery },
    ({ user, query }) => listNotifications(user.id, query),
  )
  .get("/unread-count", { summary: "Count my unread notifications" }, ({ user }) =>
    unreadCount(user.id),
  )
  .post("/read-all", { summary: "Mark all my notifications as read" }, ({ user }) =>
    markAllRead(user.id),
  )
  .patch(
    "/:id/read",
    { summary: "Mark a notification as read", params: idParams },
    ({ user, params }) => markRead(user.id, params.id),
  )
  .post(
    "/broadcast",
    {
      summary: "Send an announcement",
      description: "Targets explicit users, a role, an organisation, a batch, or a combination.",
      roles: ADMIN_ROLES,
      body: broadcastBody,
      status: 201,
    },
    async ({ user, body }) => {
      if (body.target.orgId) await assertOrgAccess(user, body.target.orgId);
      if (body.target.batchId) await assertBatchAccess(user, body.target.batchId, true);
      if (user.role !== "super_admin" && !body.target.orgId && !body.target.batchId && body.target.role) {
        throw forbidden("Centre admins must scope role broadcasts to an organisation or batch");
      }
      const recipients = await resolveRecipients(body.target);
      const created = await notify({
        userIds: recipients,
        type: body.type,
        title: body.title,
        body: body.body,
        channels: body.channels,
        data: body.data,
      });
      return { recipients: created.length };
    },
  );
