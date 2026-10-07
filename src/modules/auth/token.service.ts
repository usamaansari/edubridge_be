import { and, eq } from "drizzle-orm";

import { env } from "../../config/env.js";
import { db, type DeviceInfo, refreshTokens } from "../../db/index.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { addDays } from "../../lib/dates.js";
import { unauthorized } from "../../lib/http-error.js";

export async function issueRefreshToken(userId: string, deviceInfo?: DeviceInfo) {
  const token = randomToken();
  const expiresAt = addDays(new Date(), env.refreshTokenTtlDays);
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: sha256(token),
    deviceInfo: deviceInfo ?? null,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function revokeAllRefreshTokens(userId: string) {
  await db
    .update(refreshTokens)
    .set({ revoked: true, revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.revoked, false)));
}

/**
 * Rotates a refresh token. Presenting an already-revoked token is treated as theft:
 * every session for that user is revoked.
 */
export async function consumeRefreshToken(rawToken: string): Promise<string> {
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, sha256(rawToken)));

  if (!row) throw unauthorized("Invalid refresh token");
  if (row.revoked) {
    await revokeAllRefreshTokens(row.userId);
    throw unauthorized("Refresh token has been revoked");
  }
  if (row.expiresAt < new Date()) throw unauthorized("Refresh token has expired");

  await db
    .update(refreshTokens)
    .set({ revoked: true, revokedAt: new Date() })
    .where(eq(refreshTokens.id, row.id));
  return row.userId;
}

export async function revokeRefreshToken(rawToken: string) {
  await db
    .update(refreshTokens)
    .set({ revoked: true, revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, sha256(rawToken)), eq(refreshTokens.revoked, false)));
}
