import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/index.js";

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`EduBridge API listening on http://localhost:${env.port}`);
  console.log(`Swagger UI: http://localhost:${env.port}/api-docs`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
