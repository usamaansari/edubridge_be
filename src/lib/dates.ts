/** Today's date as `YYYY-MM-DD` in UTC. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function isoDaysAgo(days: number): string {
  return addDays(new Date(), -days).toISOString().slice(0, 10);
}

export function fullName(firstName: string | null | undefined, lastName: string | null | undefined) {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
