import cookieParser from "cookie-parser";
import cors from "cors";
import { sql } from "drizzle-orm";
import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";

import { env } from "./config/env.js";
import { db } from "./db/index.js";
import { buildOpenApiSpec } from "./lib/openapi.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { modules } from "./modules/index.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.use("/uploads", express.static(env.uploadDir, { maxAge: "7d", index: false }));

  app.get("/", (_req, res) => {
    res.json({ name: "EduBridge Academy API", docs: "/api-docs" });
  });
  app.get("/health", async (_req, res) => {
    await db.execute(sql`select 1`);
    res.json({ status: "ok", database: "ok" });
  });

  for (const module of modules) {
    app.use(module.prefix, module.router);
  }

  const spec = buildOpenApiSpec();
  app.get("/api-docs.json", (_req, res) => {
    res.json(spec);
  });
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(spec, { swaggerOptions: { persistAuthorization: true } }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
