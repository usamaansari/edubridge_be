type PgErrorInfo = { code: string; constraint?: string; detail?: string };

/** Drizzle wraps driver errors in `DrizzleQueryError`, so the pg error may sit on `cause`. */
export function getPgError(err: unknown): PgErrorInfo | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 3 && current; depth++) {
    if (typeof current === "object" && current !== null && "code" in current) {
      const { code, constraint, detail } = current as Record<string, unknown>;
      if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
        return {
          code,
          constraint: typeof constraint === "string" ? constraint : undefined,
          detail: typeof detail === "string" ? detail : undefined,
        };
      }
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export const PG_UNIQUE_VIOLATION = "23505";
export const PG_FOREIGN_KEY_VIOLATION = "23503";
export const PG_CHECK_VIOLATION = "23514";
export const PG_INVALID_TEXT = "22P02";
