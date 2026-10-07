import type { ErrorRequestHandler, RequestHandler } from "express";

import { HttpError } from "../lib/http-error.js";
import {
  getPgError,
  PG_CHECK_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_INVALID_TEXT,
  PG_UNIQUE_VIOLATION,
} from "../lib/pg-error.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ message: `Route ${req.method} ${req.path} not found` });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message, details: err.details });
    return;
  }

  const e = err as { name?: string; type?: string; message?: string; status?: number };

  if (e.type === "entity.parse.failed") {
    res.status(400).json({ message: "Malformed JSON body" });
    return;
  }
  if (e.type === "entity.too.large") {
    res.status(413).json({ message: "Request body too large" });
    return;
  }
  if (e.name === "MulterError") {
    res.status(400).json({ message: `Upload failed: ${e.message}` });
    return;
  }

  const pg = getPgError(err);
  if (pg) {
    const details = pg.constraint ? { constraint: [pg.constraint] } : undefined;
    switch (pg.code) {
      case PG_UNIQUE_VIOLATION:
        res.status(409).json({ message: "A record with these values already exists", details });
        return;
      case PG_FOREIGN_KEY_VIOLATION:
        res.status(409).json({
          message: "A referenced record does not exist or is still in use",
          details,
        });
        return;
      case PG_CHECK_VIOLATION:
        res.status(400).json({ message: "A value is outside the allowed range", details });
        return;
      case PG_INVALID_TEXT:
        res.status(400).json({ message: "Invalid value format" });
        return;
    }
  }

  console.error(err);
  res.status(500).json({ message: "Internal server error" });
};
