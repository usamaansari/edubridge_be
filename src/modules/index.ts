import type { ApiModule } from "../lib/api-module.js";
import { analyticsModule } from "./analytics/analytics.routes.js";
import { attemptsModule } from "./assessments/attempts.routes.js";
import { questionsModule } from "./assessments/questions.routes.js";
import { testsModule } from "./assessments/tests.routes.js";
import { attendanceModule } from "./attendance/attendance.routes.js";
import { authModule } from "./auth/auth.routes.js";
import { batchesModule } from "./batches/batches.routes.js";
import { contentModule } from "./content/content.routes.js";
import { chaptersModule, programsModule, subjectsModule, topicsModule } from "./curriculum/curriculum.routes.js";
import { doubtsModule } from "./doubts/doubts.routes.js";
import {
  feePaymentsModule,
  feeStructuresModule,
  scholarshipsModule,
  studentFeesModule,
} from "./financial/financial.routes.js";
import { goalsModule, mentorAssignmentsModule, mentorSessionsModule } from "./mentorship/mentorship.routes.js";
import { notificationsModule } from "./notifications/notifications.routes.js";
import { organisationsModule } from "./organisations/organisations.routes.js";
import { parentsModule } from "./parents/parents.routes.js";
import { studentsModule } from "./students/students.routes.js";
import { uploadsModule } from "./uploads/uploads.routes.js";
import { usersModule } from "./users/users.routes.js";

export const modules: ApiModule[] = [
  authModule,
  usersModule,
  parentsModule,
  studentsModule,
  organisationsModule,
  batchesModule,
  programsModule,
  subjectsModule,
  chaptersModule,
  topicsModule,
  contentModule,
  uploadsModule,
  questionsModule,
  testsModule,
  attemptsModule,
  mentorAssignmentsModule,
  mentorSessionsModule,
  goalsModule,
  doubtsModule,
  attendanceModule,
  analyticsModule,
  feeStructuresModule,
  studentFeesModule,
  feePaymentsModule,
  scholarshipsModule,
  notificationsModule,
];
