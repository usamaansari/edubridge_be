import {
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { primaryId, timestamps, tz } from "./columns.js";
import { genderEnum, otpPurposeEnum, roleEnum, userStatusEnum } from "./enums.js";

export type Address = {
  street?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
};

export type DeviceInfo = {
  ua?: string;
  ip?: string;
  device_type?: string;
};

export const users = pgTable(
  "users",
  {
    id: primaryId(),
    email: varchar({ length: 255 }).notNull().unique(),
    phone: varchar({ length: 15 }).notNull().unique(),
    passwordHash: varchar({ length: 255 }).notNull(),
    role: roleEnum().notNull(),
    status: userStatusEnum().notNull().default("pending"),
    emailVerified: boolean().notNull().default(false),
    phoneVerified: boolean().notNull().default(false),
    lastLoginAt: tz(),
    deletedAt: tz(),
    ...timestamps(),
  },
  (t) => [index("users_role_idx").on(t.role), index("users_status_idx").on(t.status)],
);

export const userProfiles = pgTable("user_profiles", {
  id: primaryId(),
  userId: uuid()
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  firstName: varchar({ length: 100 }).notNull(),
  lastName: varchar({ length: 100 }).notNull(),
  dob: date({ mode: "string" }),
  gender: genderEnum(),
  addressJson: jsonb().$type<Address>(),
  profilePicUrl: text(),
  bio: text(),
  ...timestamps(),
});

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar({ length: 512 }).notNull(),
    deviceInfo: jsonb().$type<DeviceInfo>(),
    expiresAt: tz().notNull(),
    revoked: boolean().notNull().default(false),
    revokedAt: tz(),
    ...timestamps(),
  },
  (t) => [
    index("refresh_tokens_token_hash_idx").on(t.tokenHash),
    index("refresh_tokens_user_id_idx").on(t.userId),
  ],
);

export const otpVerifications = pgTable(
  "otp_verifications",
  {
    id: primaryId(),
    identifier: varchar({ length: 255 }).notNull(),
    otpHash: varchar({ length: 255 }).notNull(),
    purpose: otpPurposeEnum().notNull(),
    attempts: smallint().notNull().default(0),
    expiresAt: tz().notNull(),
    used: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [index("otp_verifications_identifier_idx").on(t.identifier)],
);

export const parentStudentLinks = pgTable(
  "parent_student_links",
  {
    id: primaryId(),
    parentUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    studentUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    relationship: varchar({ length: 50 }).notNull(),
    isPrimary: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    unique("parent_student_links_parent_student_unique").on(t.parentUserId, t.studentUserId),
    index("parent_student_links_student_idx").on(t.studentUserId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type OtpVerification = typeof otpVerifications.$inferSelect;
export type ParentStudentLink = typeof parentStudentLinks.$inferSelect;
