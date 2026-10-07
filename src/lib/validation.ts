import { z } from "zod";

import { badRequest, type ErrorDetails } from "./http-error.js";

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const details: ErrorDetails = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_root";
    (details[key] ??= []).push(issue.message);
  }
  throw badRequest("Validation failed", details);
}

export const uuid = z.uuid();

export const idParams = z.object({ id: z.uuid() });

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address").max(255));

export const phone = z
  .string()
  .transform((s) => s.replace(/[\s()-]/g, ""))
  .pipe(z.string().regex(/^\+?\d{10,14}$/, "Enter a valid phone number with country code"));

export const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

export const personName = z.string().trim().min(1).max(100);

/** `YYYY-MM-DD` */
export const isoDate = z.iso.date();

/** ISO-8601 datetime with offset, parsed to a `Date`. */
export const isoDateTime = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));

/** `HH:MM` or `HH:MM:SS` */
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Use HH:MM");

export const url = z.url().max(2048);

/** Accepts real booleans (JSON) and "true"/"false" strings (query strings, multipart forms). */
export const booleanish = z.union([
  z.boolean(),
  z.enum(["true", "false"]).transform((v) => v === "true"),
]);

export const money = z.coerce
  .number()
  .nonnegative()
  .max(99_999_999.99)
  .transform((v) => v.toFixed(2));

export const marks = z.coerce
  .number()
  .min(-999.9)
  .max(999.9)
  .transform((v) => v.toFixed(1));

export const addressSchema = z.object({
  street: z.string().trim().max(255).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  pincode: z.string().trim().max(12).optional(),
  country: z.string().trim().max(100).optional(),
});

/** Comma-separated strings (multipart / query) or real arrays. */
export function stringList<T extends z.ZodType>(item: T) {
  return z.preprocess(
    (value) =>
      typeof value === "string"
        ? value
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
        : value,
    z.array(item),
  );
}
