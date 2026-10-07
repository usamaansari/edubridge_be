import { boolean, index, jsonb, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";

import { primaryId, timestamps, tz } from "./columns.js";
import { notificationTypeEnum } from "./enums.js";
import { users } from "./users.js";

export type NotificationData = { entity_type?: string; entity_id?: string; [key: string]: unknown };

export const NOTIFICATION_CHANNELS = ["push", "email", "sms", "whatsapp"] as const;

export const notifications = pgTable(
  "notifications",
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum().notNull(),
    title: varchar({ length: 255 }).notNull(),
    body: text().notNull(),
    dataJson: jsonb().$type<NotificationData>(),
    channels: text().array().notNull(),
    isRead: boolean().notNull().default(false),
    readAt: tz(),
    sentAt: tz(),
    ...timestamps(),
  },
  (t) => [index("notifications_user_read_idx").on(t.userId, t.isRead)],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
