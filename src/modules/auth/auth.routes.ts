import type { Request, Response } from "express";
import { rateLimit } from "express-rate-limit";

import { env } from "../../config/env.js";
import { ApiModule } from "../../lib/api-module.js";
import { unauthorized } from "../../lib/http-error.js";
import {
  changePasswordBody,
  forgotPasswordBody,
  loginBody,
  otpSendBody,
  otpVerifyBody,
  refreshBody,
  registerBody,
  resetPasswordBody,
} from "./auth.schemas.js";
import {
  changePassword,
  deviceInfoFrom,
  forgotPassword,
  login,
  logout,
  logoutAll,
  refresh,
  register,
  resetPassword,
  type Session,
  sendOtp,
  verifyOtpCode,
} from "./auth.service.js";
import { getSessionUser } from "../users/users.service.js";

export const authModule = new ApiModule("Auth", "/auth");

const REFRESH_COOKIE = "eb_refresh";

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isProduction ? 10 : 1000,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many attempts. Please try again later." },
});

function setRefreshCookie(res: Response, session: Pick<Session, "refreshToken" | "refreshTokenExpiresAt">) {
  res.cookie(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/auth",
    expires: session.refreshTokenExpiresAt,
  });
}

function readRefreshToken(req: Request, bodyToken: string | undefined): string | undefined {
  return bodyToken ?? (req.cookies?.[REFRESH_COOKIE] as string | undefined);
}

authModule
  .post(
    "/register",
    {
      summary: "Register a student or parent",
      description:
        "Creates a pending account, emails a `verify_email` OTP and signs the user in. Accepts `name` (as sent by the frontend) or `firstName` + `lastName`.",
      auth: false,
      body: registerBody,
      status: 201,
      middleware: [strictLimiter],
    },
    async ({ req, res, body }) => {
      const session = await register(body, deviceInfoFrom(req));
      setRefreshCookie(res, session);
      return session;
    },
  )
  .post(
    "/login",
    {
      summary: "Sign in with email and password",
      description: "Returns `{ accessToken, refreshToken, user }`. Send the access token as `Authorization: Bearer <token>`.",
      auth: false,
      body: loginBody,
      middleware: [strictLimiter],
    },
    async ({ req, res, body }) => {
      const session = await login(body.email, body.password, deviceInfoFrom(req));
      setRefreshCookie(res, session);
      return session;
    },
  )
  .post(
    "/refresh",
    {
      summary: "Rotate the refresh token",
      description: "Reads the refresh token from the body or the `eb_refresh` cookie. Reusing a rotated token revokes all sessions.",
      auth: false,
      body: refreshBody,
    },
    async ({ req, res, body }) => {
      const token = readRefreshToken(req, body.refreshToken);
      if (!token) throw unauthorized("Refresh token is required");
      const session = await refresh(token, deviceInfoFrom(req));
      setRefreshCookie(res, session);
      return session;
    },
  )
  .post(
    "/logout",
    { summary: "Sign out this session", auth: false, body: refreshBody },
    async ({ req, res, body }) => {
      await logout(readRefreshToken(req, body.refreshToken));
      res.clearCookie(REFRESH_COOKIE, { path: "/auth" });
    },
  )
  .post("/logout-all", { summary: "Sign out every session" }, async ({ res, user }) => {
    await logoutAll(user.id);
    res.clearCookie(REFRESH_COOKIE, { path: "/auth" });
  })
  .get("/me", { summary: "Get the signed-in user" }, ({ user }) => getSessionUser(user.id))
  .post(
    "/otp/send",
    {
      summary: "Send a one-time code",
      description: "Purposes: login, register, verify_email, verify_phone, reset_password. Codes expire after OTP_TTL_MINUTES.",
      auth: false,
      body: otpSendBody,
      middleware: [strictLimiter],
    },
    ({ body }) => sendOtp(body.identifier, body.purpose),
  )
  .post(
    "/otp/verify",
    {
      summary: "Verify a one-time code",
      description: "`verify_email` activates pending accounts. `login` returns a full session.",
      auth: false,
      body: otpVerifyBody,
      middleware: [strictLimiter],
    },
    async ({ req, res, body }) => {
      const result = await verifyOtpCode(body.identifier, body.purpose, body.otp, deviceInfoFrom(req));
      if ("refreshToken" in result) setRefreshCookie(res, result);
      return result;
    },
  )
  .post(
    "/forgot-password",
    {
      summary: "Request a password reset code",
      auth: false,
      body: forgotPasswordBody,
      middleware: [strictLimiter],
    },
    ({ body }) => forgotPassword(body.email),
  )
  .post(
    "/reset-password",
    {
      summary: "Reset password with a code",
      description: "Revokes all existing sessions.",
      auth: false,
      body: resetPasswordBody,
      middleware: [strictLimiter],
    },
    ({ body }) => resetPassword(body.email, body.otp, body.newPassword),
  )
  .post(
    "/change-password",
    { summary: "Change my password", body: changePasswordBody },
    ({ user, body }) => changePassword(user.id, body.currentPassword, body.newPassword),
  );
