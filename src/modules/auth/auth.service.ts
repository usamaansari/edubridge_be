import bcrypt from "bcryptjs";
import { and, eq, isNull, or } from "drizzle-orm";
import type { Request } from "express";

import { env } from "../../config/env.js";
import { db, type DeviceInfo, type OtpPurpose, userProfiles, users } from "../../db/index.js";
import { BCRYPT_ROUNDS } from "../../lib/crypto.js";
import { badRequest, forbidden, unauthorized } from "../../lib/http-error.js";
import { signAccessToken } from "../../middleware/auth.js";
import { getSessionUser, rethrowUniqueAsConflict } from "../users/users.service.js";
import type { RegisterInput } from "./auth.schemas.js";
import { createOtp, normalizeIdentifier, verifyOtp } from "./otp.service.js";
import {
  consumeRefreshToken,
  issueRefreshToken,
  revokeAllRefreshTokens,
  revokeRefreshToken,
} from "./token.service.js";

/** Compared against when the email is unknown so response timing does not reveal accounts. */
const TIMING_DUMMY_HASH = bcrypt.hashSync("timing-dummy-password", BCRYPT_ROUNDS);

export function deviceInfoFrom(req: Request): DeviceInfo {
  const ua = req.get("user-agent") ?? undefined;
  return {
    ua,
    ip: req.ip,
    device_type: ua && /mobile|android|iphone|ipad/i.test(ua) ? "mobile" : "desktop",
  };
}

async function findActiveUserByIdentifier(identifier: string) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      phone: users.phone,
      role: users.role,
      status: users.status,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(and(or(eq(users.email, identifier), eq(users.phone, identifier)), isNull(users.deletedAt)));
  return row;
}

function assertCanSignIn(status: string) {
  if (status === "suspended") throw forbidden("Your account has been suspended");
  if (status === "deleted") throw unauthorized("Invalid email or password");
}

async function issueSession(userId: string, deviceInfo: DeviceInfo) {
  const user = await getSessionUser(userId);
  const refresh = await issueRefreshToken(userId, deviceInfo);
  return {
    accessToken: signAccessToken(user),
    tokenType: "Bearer" as const,
    expiresIn: env.accessTokenTtl,
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt,
    user,
  };
}

export type Session = Awaited<ReturnType<typeof issueSession>>;

function splitName(input: RegisterInput) {
  if (input.firstName && input.lastName) {
    return { firstName: input.firstName, lastName: input.lastName };
  }
  const parts = (input.name ?? "").trim().split(/\s+/);
  const firstName = parts.shift() ?? "";
  return { firstName: firstName.slice(0, 100), lastName: (parts.join(" ") || "-").slice(0, 100) };
}

/** Self-registration is limited to students and parents; staff are created by admins. */
export async function register(input: RegisterInput, deviceInfo: DeviceInfo) {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const { firstName, lastName } = splitName(input);

  let userId: string;
  try {
    userId = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: input.email, phone: input.phone, passwordHash, role: input.role })
        .returning({ id: users.id });
      if (!user) throw new Error("Failed to create user");
      await tx.insert(userProfiles).values({ userId: user.id, firstName, lastName });
      return user.id;
    });
  } catch (err) {
    rethrowUniqueAsConflict(err, "Email or phone is already registered");
  }

  await createOtp(input.email, "verify_email").catch((err: unknown) => {
    console.error("Failed to send verification OTP", err);
  });
  return issueSession(userId, deviceInfo);
}

export async function login(email: string, password: string, deviceInfo: DeviceInfo) {
  const user = await findActiveUserByIdentifier(email);
  const ok = await bcrypt.compare(password, user?.passwordHash ?? TIMING_DUMMY_HASH);
  if (!user || !ok) throw unauthorized("Invalid email or password");
  assertCanSignIn(user.status);

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return issueSession(user.id, deviceInfo);
}

export async function refresh(rawToken: string, deviceInfo: DeviceInfo) {
  const userId = await consumeRefreshToken(rawToken);
  const [user] = await db
    .select({ status: users.status, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId));
  if (!user || user.deletedAt) throw unauthorized("Account is not active");
  assertCanSignIn(user.status);
  return issueSession(userId, deviceInfo);
}

export async function logout(rawToken: string | undefined) {
  if (rawToken) await revokeRefreshToken(rawToken);
}

export async function logoutAll(userId: string) {
  await revokeAllRefreshTokens(userId);
}

/**
 * Always resolves without revealing whether the identifier exists, except for
 * `register`, which only makes sense for identifiers that are not yet taken.
 */
export async function sendOtp(rawIdentifier: string, purpose: OtpPurpose) {
  const identifier = normalizeIdentifier(rawIdentifier);
  const user = await findActiveUserByIdentifier(identifier);

  if (purpose === "register") {
    if (user) throw badRequest("This email or phone is already registered");
    await createOtp(identifier, purpose);
  } else if (user && user.status !== "suspended") {
    if (purpose === "verify_email" && user.email !== identifier) {
      throw badRequest("verify_email requires an email address");
    }
    if (purpose === "verify_phone" && user.phone !== identifier) {
      throw badRequest("verify_phone requires a phone number");
    }
    await createOtp(identifier, purpose);
  }

  return { message: "If the account exists, a verification code has been sent" };
}

export async function verifyOtpCode(
  rawIdentifier: string,
  purpose: OtpPurpose,
  otp: string,
  deviceInfo: DeviceInfo,
) {
  const identifier = normalizeIdentifier(rawIdentifier);
  if (purpose === "reset_password") {
    throw badRequest("Use POST /auth/reset-password to complete a password reset");
  }

  await verifyOtp(identifier, purpose, otp);

  if (purpose === "register") return { verified: true };

  const user = await findActiveUserByIdentifier(identifier);
  if (!user) throw badRequest("Invalid or expired code");

  switch (purpose) {
    case "verify_email":
      await db
        .update(users)
        .set({ emailVerified: true, ...(user.status === "pending" ? { status: "active" as const } : {}) })
        .where(eq(users.id, user.id));
      return { verified: true, user: await getSessionUser(user.id) };
    case "verify_phone":
      await db.update(users).set({ phoneVerified: true }).where(eq(users.id, user.id));
      return { verified: true, user: await getSessionUser(user.id) };
    case "login":
      assertCanSignIn(user.status);
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      return { verified: true, ...(await issueSession(user.id, deviceInfo)) };
  }
}

export async function forgotPassword(email: string) {
  return sendOtp(email, "reset_password");
}

export async function resetPassword(email: string, otp: string, newPassword: string) {
  await verifyOtp(email, "reset_password", otp);
  const user = await findActiveUserByIdentifier(email);
  if (!user) throw badRequest("Invalid or expired code");

  await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) })
    .where(eq(users.id, user.id));
  await revokeAllRefreshTokens(user.id);
  return { message: "Password updated. Please sign in again." };
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId));
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw badRequest("Current password is incorrect");
  }
  await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) })
    .where(eq(users.id, userId));
  await revokeAllRefreshTokens(userId);
  return { message: "Password updated. Other sessions have been signed out." };
}
