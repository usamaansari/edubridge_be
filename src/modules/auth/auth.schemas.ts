import { z } from "zod";

import { otpPurposeEnum } from "../../db/index.js";
import { email, password, personName, phone } from "../../lib/validation.js";

export const registerBody = z
  .object({
    name: z.string().trim().min(2).max(201).optional(),
    firstName: personName.optional(),
    lastName: personName.optional(),
    email,
    phone,
    password,
    confirmPassword: z.string().optional(),
    role: z.enum(["student", "parent"]).default("student"),
  })
  .refine((d) => d.name || (d.firstName && d.lastName), {
    message: "Provide either name or firstName and lastName",
    path: ["name"],
  })
  .refine((d) => d.confirmPassword === undefined || d.confirmPassword === d.password, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const loginBody = z.object({
  email,
  password: z.string().min(1, "Password is required"),
});

export const refreshBody = z.object({
  refreshToken: z.string().min(1).optional(),
});

const identifier = z.string().trim().min(3).max(255);

export const otpSendBody = z.object({
  identifier,
  purpose: z.enum(otpPurposeEnum.enumValues),
});

export const otpVerifyBody = otpSendBody.extend({
  otp: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const forgotPasswordBody = z.object({ email });

export const resetPasswordBody = z.object({
  email,
  otp: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
  newPassword: password,
});

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
});

export type RegisterInput = z.output<typeof registerBody>;
