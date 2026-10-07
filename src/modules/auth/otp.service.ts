import bcrypt from "bcryptjs";
import { and, desc, eq, gt } from "drizzle-orm";

import { env } from "../../config/env.js";
import { db, type OtpPurpose, otpVerifications } from "../../db/index.js";
import { BCRYPT_ROUNDS, generateOtp } from "../../lib/crypto.js";
import { badRequest, tooManyRequests } from "../../lib/http-error.js";
import { deliverOtp } from "../../lib/messaging.js";

export function normalizeIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  return trimmed.includes("@") ? trimmed.toLowerCase() : trimmed.replace(/[\s()-]/g, "");
}

export async function createOtp(identifier: string, purpose: OtpPurpose) {
  const cooldownStart = new Date(Date.now() - env.otpResendCooldownSec * 1000);
  const [recent] = await db
    .select({ id: otpVerifications.id })
    .from(otpVerifications)
    .where(
      and(
        eq(otpVerifications.identifier, identifier),
        eq(otpVerifications.purpose, purpose),
        gt(otpVerifications.createdAt, cooldownStart),
      ),
    )
    .limit(1);
  if (recent) {
    throw tooManyRequests(`Please wait ${env.otpResendCooldownSec} seconds before requesting another code`);
  }

  const otp = generateOtp();
  await db.transaction(async (tx) => {
    await tx
      .update(otpVerifications)
      .set({ used: true })
      .where(
        and(
          eq(otpVerifications.identifier, identifier),
          eq(otpVerifications.purpose, purpose),
          eq(otpVerifications.used, false),
        ),
      );
    await tx.insert(otpVerifications).values({
      identifier,
      purpose,
      otpHash: await bcrypt.hash(otp, BCRYPT_ROUNDS),
      expiresAt: new Date(Date.now() + env.otpTtlMinutes * 60 * 1000),
    });
  });

  await deliverOtp(identifier, otp, purpose);
}

export async function verifyOtp(identifier: string, purpose: OtpPurpose, otp: string) {
  const [row] = await db
    .select()
    .from(otpVerifications)
    .where(
      and(
        eq(otpVerifications.identifier, identifier),
        eq(otpVerifications.purpose, purpose),
        eq(otpVerifications.used, false),
        gt(otpVerifications.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(otpVerifications.createdAt))
    .limit(1);

  if (!row) throw badRequest("Invalid or expired code");

  if (row.attempts >= env.otpMaxAttempts) {
    await db.update(otpVerifications).set({ used: true }).where(eq(otpVerifications.id, row.id));
    throw tooManyRequests("Too many incorrect attempts. Request a new code.");
  }

  if (!(await bcrypt.compare(otp, row.otpHash))) {
    await db
      .update(otpVerifications)
      .set({ attempts: row.attempts + 1 })
      .where(eq(otpVerifications.id, row.id));
    throw badRequest("Invalid or expired code");
  }

  await db.update(otpVerifications).set({ used: true }).where(eq(otpVerifications.id, row.id));
}
