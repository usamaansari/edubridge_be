import { timestamp, uuid } from "drizzle-orm/pg-core";

export const primaryId = () => uuid().primaryKey().defaultRandom();

export const tz = () => timestamp({ withTimezone: true });

export const timestamps = () => ({
  createdAt: tz().notNull().defaultNow(),
  updatedAt: tz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
