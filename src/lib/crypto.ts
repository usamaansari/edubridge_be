import { createHash, randomBytes, randomInt } from "node:crypto";

export const BCRYPT_ROUNDS = 10;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString("base64url");
}

export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomCode(length: number): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

export function generateEnrollmentNo(academicYear: string): string {
  const year = academicYear.replace(/\D/g, "").slice(0, 4) || String(new Date().getFullYear());
  return `ENR-${year}-${randomCode(8)}`;
}

export function generateReceiptNo(date = new Date()): string {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, "");
  return `RCPT-${ymd}-${randomCode(8)}`;
}

/** Deterministic PRNG so a resumed attempt sees the same shuffled order. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  let state = 0;
  for (const ch of seed) state = (Math.imul(state, 31) + ch.charCodeAt(0)) | 0;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}
