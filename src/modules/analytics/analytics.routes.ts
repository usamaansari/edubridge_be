import { z } from "zod";

import {
  ADMIN_ROLES,
  assertBatchAccess,
  assertCanViewStudent,
  STAFF_ROLES,
} from "../../lib/access.js";
import { ApiModule } from "../../lib/api-module.js";
import { isoDate } from "../../lib/validation.js";
import { getTopicPerformance } from "../students/students.service.js";
import {
  computeSnapshots,
  getAdminOverview,
  getBatchAnalytics,
  getStudentOverview,
  listSnapshots,
} from "./analytics.service.js";

export const analyticsModule = new ApiModule("Analytics", "/analytics");

const studentParams = z.object({ studentId: z.uuid() });

analyticsModule
  .get(
    "/overview",
    {
      summary: "Admin dashboard KPIs",
      description: "Students, batches, faculty, tests, doubts, fees and at-risk counts, scoped to the admin's organisations.",
      roles: ADMIN_ROLES,
    },
    ({ user }) => getAdminOverview(user),
  )
  .get(
    "/students/:studentId",
    {
      summary: "Student performance overview",
      description: "Summary, 30-day snapshot trend, recent test scores, weak/strong topics and full topic performance.",
      params: studentParams,
    },
    async ({ user, params }) => {
      await assertCanViewStudent(user, params.studentId);
      return getStudentOverview(params.studentId);
    },
  )
  .get(
    "/students/:studentId/snapshots",
    {
      summary: "Daily analytics snapshots",
      params: studentParams,
      query: z.object({ from: isoDate.optional(), to: isoDate.optional() }),
    },
    async ({ user, params, query }) => {
      await assertCanViewStudent(user, params.studentId);
      return listSnapshots(params.studentId, query.from, query.to);
    },
  )
  .get(
    "/students/:studentId/topics",
    { summary: "Topic-wise accuracy (heatmap data)", params: studentParams },
    async ({ user, params }) => {
      await assertCanViewStudent(user, params.studentId);
      return getTopicPerformance(params.studentId);
    },
  )
  .get(
    "/batches/:batchId",
    {
      summary: "Batch analytics",
      description: "Per-test averages, attendance, top performers, students needing attention, weak topics and at-risk students.",
      roles: STAFF_ROLES,
      params: z.object({ batchId: z.uuid() }),
    },
    async ({ user, params }) => {
      await assertBatchAccess(user, params.batchId);
      return getBatchAnalytics(params.batchId);
    },
  )
  .post(
    "/snapshots/compute",
    {
      summary: "Run the daily snapshot job",
      description: "Idempotent. Normally triggered by a scheduler; exposed for super admins to run on demand.",
      roles: ["super_admin"],
      body: z.object({ date: isoDate.optional() }),
    },
    ({ body }) => computeSnapshots(body.date),
  );
