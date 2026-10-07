CREATE TYPE "public"."attendance_status_enum" AS ENUM('present', 'absent', 'late', 'excused');--> statement-breakpoint
CREATE TYPE "public"."batch_mode_enum" AS ENUM('in_school', 'independent');--> statement-breakpoint
CREATE TYPE "public"."batch_status_enum" AS ENUM('upcoming', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."content_type_enum" AS ENUM('video', 'pdf', 'dpp', 'pyq', 'notes', 'simulation');--> statement-breakpoint
CREATE TYPE "public"."difficulty_enum" AS ENUM('easy', 'medium', 'hard', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."doubt_status_enum" AS ENUM('open', 'assigned', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status_enum" AS ENUM('active', 'transferred', 'withdrawn', 'completed');--> statement-breakpoint
CREATE TYPE "public"."exam_type_enum" AS ENUM('jee_main', 'jee_advanced', 'neet', 'board', 'foundation');--> statement-breakpoint
CREATE TYPE "public"."fee_status_enum" AS ENUM('pending', 'partial', 'paid', 'overdue', 'waived');--> statement-breakpoint
CREATE TYPE "public"."gender_enum" AS ENUM('male', 'female', 'other', 'prefer_not_to_say');--> statement-breakpoint
CREATE TYPE "public"."goal_status_enum" AS ENUM('open', 'in_progress', 'achieved', 'missed');--> statement-breakpoint
CREATE TYPE "public"."notification_type_enum" AS ENUM('test_reminder', 'result_ready', 'doubt_answered', 'fee_due', 'report_ready', 'mentor_session', 'at_risk', 'announcement');--> statement-breakpoint
CREATE TYPE "public"."org_status_enum" AS ENUM('pending', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."org_type_enum" AS ENUM('school', 'centre');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose_enum" AS ENUM('login', 'register', 'reset_password', 'verify_email', 'verify_phone');--> statement-breakpoint
CREATE TYPE "public"."payment_mode_enum" AS ENUM('cash', 'upi', 'bank_transfer', 'card', 'cheque', 'online_gateway');--> statement-breakpoint
CREATE TYPE "public"."question_type_enum" AS ENUM('mcq_single', 'mcq_multi', 'integer', 'assertion_reason', 'matrix_match', 'subjective');--> statement-breakpoint
CREATE TYPE "public"."response_status_enum" AS ENUM('not_visited', 'visited', 'answered', 'marked_review');--> statement-breakpoint
CREATE TYPE "public"."role_enum" AS ENUM('super_admin', 'centre_admin', 'school_coordinator', 'teacher', 'mentor', 'student', 'parent');--> statement-breakpoint
CREATE TYPE "public"."scholarship_type_enum" AS ENUM('merit', 'need_based', 'toppers', 'staff_ward');--> statement-breakpoint
CREATE TYPE "public"."session_status_enum" AS ENUM('scheduled', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."solution_visibility_enum" AS ENUM('after_submit', 'after_end_time', 'never');--> statement-breakpoint
CREATE TYPE "public"."test_status_enum" AS ENUM('draft', 'scheduled', 'live', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."test_type_enum" AS ENUM('chapter', 'part', 'full_syllabus', 'mock_jee', 'mock_neet', 'board_pattern', 'practice');--> statement-breakpoint
CREATE TYPE "public"."status_enum" AS ENUM('pending', 'active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TABLE "otp_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" varchar(255) NOT NULL,
	"otp_hash" varchar(255) NOT NULL,
	"purpose" "otp_purpose_enum" NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parent_student_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_user_id" uuid NOT NULL,
	"student_user_id" uuid NOT NULL,
	"relationship" varchar(50) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parent_student_links_parent_student_unique" UNIQUE("parent_user_id","student_user_id")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(512) NOT NULL,
	"device_info" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"dob" date,
	"gender" "gender_enum",
	"address_json" jsonb,
	"profile_pic_url" text,
	"bio" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_userId_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(15) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" "role_enum" NOT NULL,
	"status" "status_enum" DEFAULT 'pending' NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"sequence_order" smallint NOT NULL,
	"ncert_ref" varchar(50),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"type" "content_type_enum" NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"url" text,
	"mux_asset_id" varchar(100),
	"mux_playback_id" varchar(100),
	"duration_sec" integer,
	"file_size_bytes" bigint,
	"sequence_order" smallint NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"released_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"slug" varchar(150) NOT NULL,
	"exam_type" "exam_type_enum" NOT NULL,
	"target_class" smallint[] NOT NULL,
	"description" text,
	"duration_months" smallint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"thumbnail_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "student_content_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"watched_pct" smallint DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"bookmarked" boolean DEFAULT false NOT NULL,
	"last_position_sec" integer,
	"last_accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_content_progress_unique" UNIQUE("student_id","content_item_id")
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(20) NOT NULL,
	"sequence_order" smallint NOT NULL,
	"icon_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subjects_program_code_unique" UNIQUE("program_id","code")
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"sequence_order" smallint NOT NULL,
	"difficulty_tag" "difficulty_enum" DEFAULT 'medium' NOT NULL,
	"estimated_minutes" smallint,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_faculty" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" uuid,
	"role" varchar(20) NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enrollment_no" varchar(30) NOT NULL,
	"status" "enrollment_status_enum" DEFAULT 'active' NOT NULL,
	"transferred_from_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_students_enrollmentNo_unique" UNIQUE("enrollment_no"),
	CONSTRAINT "batch_students_batch_student_unique" UNIQUE("batch_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"mode" "batch_mode_enum" NOT NULL,
	"capacity" smallint DEFAULT 60 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"academic_year" varchar(10) NOT NULL,
	"class_level" smallint NOT NULL,
	"status" "batch_status_enum" DEFAULT 'upcoming' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batches_class_level_check" CHECK ("batches"."class_level" between 9 and 12),
	CONSTRAINT "batches_dates_check" CHECK ("batches"."end_date" >= "batches"."start_date")
);
--> statement-breakpoint
CREATE TABLE "org_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_in_org" varchar(50) NOT NULL,
	"is_primary_org" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_users_org_user_unique" UNIQUE("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "org_type_enum" NOT NULL,
	"code" varchar(20) NOT NULL,
	"address_json" jsonb NOT NULL,
	"contact_email" varchar(255) NOT NULL,
	"contact_phone" varchar(15) NOT NULL,
	"principal_name" varchar(100),
	"affiliation_board" varchar(50),
	"partnership_start" date,
	"logo_url" text,
	"status" "org_status_enum" DEFAULT 'pending' NOT NULL,
	"metadata_json" jsonb,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "timetable_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"faculty_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"room_or_link" varchar(255),
	"effective_from" date NOT NULL,
	"effective_until" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timetable_slots_day_check" CHECK ("timetable_slots"."day_of_week" between 0 and 6),
	CONSTRAINT "timetable_slots_time_check" CHECK ("timetable_slots"."end_time" > "timetable_slots"."start_time")
);
--> statement-breakpoint
CREATE TABLE "question_bank" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"chapter_id" uuid,
	"topic_id" uuid,
	"type" "question_type_enum" NOT NULL,
	"difficulty" "difficulty_enum" NOT NULL,
	"content_html" text NOT NULL,
	"solution_html" text,
	"hint_html" text,
	"marks_default" numeric(4, 1) DEFAULT '4' NOT NULL,
	"negative_marks_default" numeric(4, 1) DEFAULT '-1' NOT NULL,
	"source" varchar(100),
	"year_of_appearance" smallint,
	"tags" text[],
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"is_approved" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"option_text" text NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL,
	"sequence_order" smallint NOT NULL,
	"explanation_html" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"attempt_number" smallint DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"auto_submitted" boolean DEFAULT false NOT NULL,
	"score" numeric(7, 2),
	"max_score" numeric(7, 2),
	"percentile" numeric(5, 2),
	"rank_in_batch" integer,
	"time_taken_sec" integer,
	"tab_switch_count" smallint DEFAULT 0 NOT NULL,
	"ip_address" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_attempts_test_student_attempt_unique" UNIQUE("test_id","student_id","attempt_number")
);
--> statement-breakpoint
CREATE TABLE "test_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"section_name" varchar(100) NOT NULL,
	"sequence_order" smallint NOT NULL,
	"marks_correct" numeric(4, 1) NOT NULL,
	"marks_incorrect" numeric(4, 1) NOT NULL,
	"marks_unattempted" numeric(4, 1) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_questions_test_question_unique" UNIQUE("test_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "test_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"response_json" jsonb,
	"status" "response_status_enum" DEFAULT 'not_visited' NOT NULL,
	"is_correct" boolean,
	"marks_awarded" numeric(4, 1),
	"time_spent_sec" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_responses_attempt_question_unique" UNIQUE("attempt_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "test_type_enum" NOT NULL,
	"batch_id" uuid,
	"program_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"instructions_html" text,
	"duration_minutes" smallint NOT NULL,
	"marking_scheme_json" jsonb NOT NULL,
	"shuffle_questions" boolean DEFAULT true NOT NULL,
	"shuffle_options" boolean DEFAULT true NOT NULL,
	"show_solution_after" "solution_visibility_enum" DEFAULT 'after_submit' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"max_attempts" smallint DEFAULT 1 NOT NULL,
	"is_proctored" boolean DEFAULT false NOT NULL,
	"status" "test_status_enum" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"timetable_slot_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "attendance_status_enum" NOT NULL,
	"marked_by" uuid NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_student_slot_date_unique" UNIQUE("student_id","timetable_slot_id","date")
);
--> statement-breakpoint
CREATE TABLE "doubt_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doubt_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body_html" text NOT NULL,
	"media_urls" text[],
	"is_accepted_answer" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doubts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"topic_id" uuid,
	"content_item_id" uuid,
	"question_id" uuid,
	"title" varchar(255) NOT NULL,
	"body_html" text NOT NULL,
	"media_urls" text[],
	"status" "doubt_status_enum" DEFAULT 'open' NOT NULL,
	"assigned_to" uuid,
	"assigned_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"upvotes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mentor_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mentor_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unassigned_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mentor_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mentor_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" smallint DEFAULT 30 NOT NULL,
	"meeting_link" text,
	"status" "session_status_enum" DEFAULT 'scheduled' NOT NULL,
	"conducted_at" timestamp with time zone,
	"notes_html" text,
	"action_items_json" jsonb,
	"student_rating" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mentor_sessions_rating_check" CHECK ("mentor_sessions"."student_rating" is null or "mentor_sessions"."student_rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "student_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"mentor_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"due_date" date NOT NULL,
	"status" "goal_status_enum" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_analytics_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"overall_score_pct" numeric(5, 2),
	"subject_scores_json" jsonb,
	"weak_topics_json" jsonb,
	"strong_topics_json" jsonb,
	"predicted_rank" integer,
	"study_hours_today" numeric(4, 2),
	"study_hours_week" numeric(5, 2),
	"dpp_completion_pct" numeric(5, 2),
	"streak_days" smallint DEFAULT 0 NOT NULL,
	"is_at_risk" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_analytics_snapshots_student_date_unique" UNIQUE("student_id","snapshot_date")
);
--> statement-breakpoint
CREATE TABLE "topic_performance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"total_questions_attempted" integer DEFAULT 0 NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"accuracy_pct" numeric(5, 2),
	"avg_time_per_q_sec" numeric(6, 2),
	"last_attempted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_performance_student_topic_unique" UNIQUE("student_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "fee_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_fee_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"payment_mode" "payment_mode_enum" NOT NULL,
	"transaction_ref" varchar(100),
	"receipt_no" varchar(50) NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"recorded_by" uuid NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_payments_receiptNo_unique" UNIQUE("receipt_no")
);
--> statement-breakpoint
CREATE TABLE "fee_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"org_id" uuid,
	"name" varchar(100) NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"installment_plan_json" jsonb,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scholarships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"type" "scholarship_type_enum" NOT NULL,
	"percentage_waiver" numeric(5, 2) NOT NULL,
	"fixed_waiver_amount" numeric(10, 2),
	"awarded_by" uuid NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_till" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"fee_structure_id" uuid NOT NULL,
	"base_amount" numeric(10, 2) NOT NULL,
	"discount_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(10, 2) NOT NULL,
	"amount_paid" numeric(10, 2) DEFAULT '0' NOT NULL,
	"status" "fee_status_enum" DEFAULT 'pending' NOT NULL,
	"next_due_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type_enum" NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"data_json" jsonb,
	"channels" text[] NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parent_student_links" ADD CONSTRAINT "parent_student_links_parent_user_id_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_student_links" ADD CONSTRAINT "parent_student_links_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_content_progress" ADD CONSTRAINT "student_content_progress_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_content_progress" ADD CONSTRAINT "student_content_progress_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_faculty" ADD CONSTRAINT "batch_faculty_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_faculty" ADD CONSTRAINT "batch_faculty_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_faculty" ADD CONSTRAINT "batch_faculty_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_students" ADD CONSTRAINT "batch_students_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_students" ADD CONSTRAINT "batch_students_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_students" ADD CONSTRAINT "batch_students_transferred_from_batch_id_batches_id_fk" FOREIGN KEY ("transferred_from_batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_users" ADD CONSTRAINT "org_users_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_users" ADD CONSTRAINT "org_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_faculty_id_users_id_fk" FOREIGN KEY ("faculty_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank" ADD CONSTRAINT "question_bank_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank" ADD CONSTRAINT "question_bank_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank" ADD CONSTRAINT "question_bank_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank" ADD CONSTRAINT "question_bank_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank" ADD CONSTRAINT "question_bank_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_id_question_bank_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question_bank"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD CONSTRAINT "test_attempts_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD CONSTRAINT "test_attempts_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_questions" ADD CONSTRAINT "test_questions_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_questions" ADD CONSTRAINT "test_questions_question_id_question_bank_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question_bank"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_responses" ADD CONSTRAINT "test_responses_attempt_id_test_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."test_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_responses" ADD CONSTRAINT "test_responses_question_id_question_bank_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question_bank"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_timetable_slot_id_timetable_slots_id_fk" FOREIGN KEY ("timetable_slot_id") REFERENCES "public"."timetable_slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doubt_replies" ADD CONSTRAINT "doubt_replies_doubt_id_doubts_id_fk" FOREIGN KEY ("doubt_id") REFERENCES "public"."doubts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doubt_replies" ADD CONSTRAINT "doubt_replies_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doubts" ADD CONSTRAINT "doubts_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doubts" ADD CONSTRAINT "doubts_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doubts" ADD CONSTRAINT "doubts_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doubts" ADD CONSTRAINT "doubts_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doubts" ADD CONSTRAINT "doubts_question_id_question_bank_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question_bank"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doubts" ADD CONSTRAINT "doubts_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentor_assignments" ADD CONSTRAINT "mentor_assignments_mentor_id_users_id_fk" FOREIGN KEY ("mentor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentor_assignments" ADD CONSTRAINT "mentor_assignments_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentor_sessions" ADD CONSTRAINT "mentor_sessions_mentor_id_users_id_fk" FOREIGN KEY ("mentor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentor_sessions" ADD CONSTRAINT "mentor_sessions_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_goals" ADD CONSTRAINT "student_goals_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_goals" ADD CONSTRAINT "student_goals_mentor_id_users_id_fk" FOREIGN KEY ("mentor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_analytics_snapshots" ADD CONSTRAINT "student_analytics_snapshots_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_performance" ADD CONSTRAINT "topic_performance_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_performance" ADD CONSTRAINT "topic_performance_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_student_fee_id_student_fees_id_fk" FOREIGN KEY ("student_fee_id") REFERENCES "public"."student_fees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scholarships" ADD CONSTRAINT "scholarships_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scholarships" ADD CONSTRAINT "scholarships_awarded_by_users_id_fk" FOREIGN KEY ("awarded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_fee_structure_id_fee_structures_id_fk" FOREIGN KEY ("fee_structure_id") REFERENCES "public"."fee_structures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "otp_verifications_identifier_idx" ON "otp_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "parent_student_links_student_idx" ON "parent_student_links" USING btree ("student_user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chapters_subject_idx" ON "chapters" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "content_items_topic_idx" ON "content_items" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "topics_chapter_idx" ON "topics" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "batch_faculty_batch_idx" ON "batch_faculty" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "batch_faculty_user_idx" ON "batch_faculty" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "batch_students_student_idx" ON "batch_students" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "batches_org_idx" ON "batches" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "batches_program_idx" ON "batches" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "org_users_user_idx" ON "org_users" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "timetable_slots_batch_idx" ON "timetable_slots" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "timetable_slots_faculty_idx" ON "timetable_slots" USING btree ("faculty_id");--> statement-breakpoint
CREATE INDEX "question_bank_subject_idx" ON "question_bank" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "question_bank_topic_idx" ON "question_bank" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "question_options_question_idx" ON "question_options" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "test_attempts_student_idx" ON "test_attempts" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "tests_batch_idx" ON "tests" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "tests_status_idx" ON "tests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "attendance_batch_date_idx" ON "attendance" USING btree ("batch_id","date");--> statement-breakpoint
CREATE INDEX "doubt_replies_doubt_idx" ON "doubt_replies" USING btree ("doubt_id");--> statement-breakpoint
CREATE INDEX "doubts_student_idx" ON "doubts" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "doubts_status_idx" ON "doubts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "doubts_assigned_to_idx" ON "doubts" USING btree ("assigned_to");--> statement-breakpoint
CREATE UNIQUE INDEX "mentor_assignments_active_unique" ON "mentor_assignments" USING btree ("mentor_id","student_id") WHERE "mentor_assignments"."is_active" = true;--> statement-breakpoint
CREATE INDEX "mentor_assignments_student_idx" ON "mentor_assignments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "mentor_sessions_mentor_idx" ON "mentor_sessions" USING btree ("mentor_id");--> statement-breakpoint
CREATE INDEX "mentor_sessions_student_idx" ON "mentor_sessions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "student_goals_student_idx" ON "student_goals" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "fee_payments_student_fee_idx" ON "fee_payments" USING btree ("student_fee_id");--> statement-breakpoint
CREATE INDEX "scholarships_student_idx" ON "scholarships" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "student_fees_student_idx" ON "student_fees" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "student_fees_status_idx" ON "student_fees" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","is_read");