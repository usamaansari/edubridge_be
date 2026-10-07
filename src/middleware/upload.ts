import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

import multer from "multer";

import { env } from "../config/env.js";
import { badRequest } from "../lib/http-error.js";

mkdirSync(env.uploadDir, { recursive: true });

const ALLOWED_MIME = /^(image\/(png|jpe?g|gif|webp|svg\+xml)|video\/(mp4|webm|quicktime)|application\/pdf)$/;

export const upload = multer({
  storage: multer.diskStorage({
    destination: env.uploadDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "");
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.test(file.mimetype)) cb(null, true);
    else cb(badRequest(`Unsupported file type: ${file.mimetype}`));
  },
});

export function publicFileUrl(filename: string): string {
  return `${env.publicBaseUrl}/uploads/${filename}`;
}
