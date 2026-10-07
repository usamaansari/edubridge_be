import { env } from "../config/env.js";
import type { OtpPurpose } from "../db/index.js";

/**
 * OTP delivery hook. No email/SMS provider is wired up yet: in development the code is
 * logged so flows can be tested end to end; in production a provider must replace this.
 */
export async function deliverOtp(identifier: string, otp: string, purpose: OtpPurpose) {
  if (!env.isProduction) {
    console.info(`[otp] ${purpose} code for ${identifier}: ${otp}`);
    return;
  }
  console.warn(`[otp] no delivery provider configured; ${purpose} OTP for ${identifier} not sent`);
}
