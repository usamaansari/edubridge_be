import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "../config/env.js";
import { db, users, type Role, type UserStatus } from "../db/index.js";
import { unauthorized } from "../lib/http-error.js";

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signAccessToken(user: { id: string; email: string; role: Role }): string {
  return jwt.sign({ email: user.email, role: user.role }, env.jwtSecret, {
    subject: user.id,
    expiresIn: env.accessTokenTtl as jwt.SignOptions["expiresIn"],
  });
}

function readBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith("Bearer ")) return undefined;
  return authorization.slice(7).trim() || undefined;
}

function verifyAccessToken(token: string): string {
  try {
    const decoded = jwt.verify(token, env.jwtSecret);
    if (typeof decoded === "object" && typeof decoded.sub === "string") return decoded.sub;
  } catch {
    // fall through
  }
  throw unauthorized("Invalid or expired token");
}

/** The account is re-read on every request so suspensions and role changes apply immediately. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = readBearerToken(req.headers.authorization);
  if (!token) throw unauthorized();

  const userId = verifyAccessToken(token);
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      status: users.status,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!row || row.deletedAt || row.status === "suspended" || row.status === "deleted") {
    throw unauthorized("Account is not active");
  }

  req.user = { id: row.id, email: row.email, role: row.role, status: row.status };
  next();
}
