import "dotenv/config";

import path from "node:path";

function readString(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is not set. Add it to .env (see .env.example).`);
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new Error(`${name} must be an integer`);
  return value;
}

const nodeEnv = readString("NODE_ENV", "development");
const isProduction = nodeEnv === "production";
const port = readInt("PORT", 3011);

function readJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;
  if (isProduction) throw new Error("JWT_SECRET must be set in production");
  return "dev-only-insecure-secret";
}

const publicBaseUrl = readString("PUBLIC_BASE_URL", `http://localhost:${port}`);

export const env = {
  nodeEnv,
  isProduction,
  port,
  databaseUrl: readString("DATABASE_URL"),
  jwtSecret: readJwtSecret(),
  /** Matches the frontend's 7-day session cookie, which has no refresh flow. */
  accessTokenTtl: readString("ACCESS_TOKEN_TTL", "7d"),
  refreshTokenTtlDays: readInt("REFRESH_TOKEN_TTL_DAYS", 30),
  otpTtlMinutes: readInt("OTP_TTL_MINUTES", 10),
  otpMaxAttempts: readInt("OTP_MAX_ATTEMPTS", 5),
  otpResendCooldownSec: readInt("OTP_RESEND_COOLDOWN_SEC", 60),
  corsOrigins: readString("CORS_ORIGINS", "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  uploadDir: path.resolve(readString("UPLOAD_DIR", "uploads")),
  maxUploadMb: readInt("MAX_UPLOAD_MB", 200),
  publicBaseUrl,
  swaggerServerUrl: readString("SWAGGER_SERVER_URL", publicBaseUrl),
} as const;
