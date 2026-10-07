import { pgEnum } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role_enum", [
  "super_admin",
  "centre_admin",
  "school_coordinator",
  "teacher",
  "mentor",
  "student",
  "parent",
]);

export const userStatusEnum = pgEnum("status_enum", ["pending", "active", "suspended", "deleted"]);

export const genderEnum = pgEnum("gender_enum", ["male", "female", "other", "prefer_not_to_say"]);

export const otpPurposeEnum = pgEnum("otp_purpose_enum", [
  "login",
  "register",
  "reset_password",
  "verify_email",
  "verify_phone",
]);

export const orgTypeEnum = pgEnum("org_type_enum", ["school", "centre"]);

export const orgStatusEnum = pgEnum("org_status_enum", ["pending", "active", "inactive"]);

export const batchModeEnum = pgEnum("batch_mode_enum", ["in_school", "independent"]);

export const batchStatusEnum = pgEnum("batch_status_enum", [
  "upcoming",
  "active",
  "completed",
  "cancelled",
]);

export const enrollmentStatusEnum = pgEnum("enrollment_status_enum", [
  "active",
  "transferred",
  "withdrawn",
  "completed",
]);

export const examTypeEnum = pgEnum("exam_type_enum", [
  "jee_main",
  "jee_advanced",
  "neet",
  "board",
  "foundation",
]);

export const difficultyEnum = pgEnum("difficulty_enum", ["easy", "medium", "hard", "advanced"]);

export const contentTypeEnum = pgEnum("content_type_enum", [
  "video",
  "pdf",
  "dpp",
  "pyq",
  "notes",
  "simulation",
]);

export const questionTypeEnum = pgEnum("question_type_enum", [
  "mcq_single",
  "mcq_multi",
  "integer",
  "assertion_reason",
  "matrix_match",
  "subjective",
]);

export const testTypeEnum = pgEnum("test_type_enum", [
  "chapter",
  "part",
  "full_syllabus",
  "mock_jee",
  "mock_neet",
  "board_pattern",
  "practice",
]);

export const solutionVisibilityEnum = pgEnum("solution_visibility_enum", [
  "after_submit",
  "after_end_time",
  "never",
]);

export const testStatusEnum = pgEnum("test_status_enum", [
  "draft",
  "scheduled",
  "live",
  "completed",
  "archived",
]);

export const responseStatusEnum = pgEnum("response_status_enum", [
  "not_visited",
  "visited",
  "answered",
  "marked_review",
]);

export const sessionStatusEnum = pgEnum("session_status_enum", [
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
]);

export const goalStatusEnum = pgEnum("goal_status_enum", ["open", "in_progress", "achieved", "missed"]);

export const doubtStatusEnum = pgEnum("doubt_status_enum", ["open", "assigned", "resolved", "closed"]);

export const attendanceStatusEnum = pgEnum("attendance_status_enum", [
  "present",
  "absent",
  "late",
  "excused",
]);

export const feeStatusEnum = pgEnum("fee_status_enum", [
  "pending",
  "partial",
  "paid",
  "overdue",
  "waived",
]);

export const paymentModeEnum = pgEnum("payment_mode_enum", [
  "cash",
  "upi",
  "bank_transfer",
  "card",
  "cheque",
  "online_gateway",
]);

export const scholarshipTypeEnum = pgEnum("scholarship_type_enum", [
  "merit",
  "need_based",
  "toppers",
  "staff_ward",
]);

export const notificationTypeEnum = pgEnum("notification_type_enum", [
  "test_reminder",
  "result_ready",
  "doubt_answered",
  "fee_due",
  "report_ready",
  "mentor_session",
  "at_risk",
  "announcement",
]);

export type Role = (typeof roleEnum.enumValues)[number];
export type UserStatus = (typeof userStatusEnum.enumValues)[number];
export type OtpPurpose = (typeof otpPurposeEnum.enumValues)[number];
export type QuestionType = (typeof questionTypeEnum.enumValues)[number];
export type TestStatus = (typeof testStatusEnum.enumValues)[number];
export type FeeStatus = (typeof feeStatusEnum.enumValues)[number];
export type NotificationType = (typeof notificationTypeEnum.enumValues)[number];
