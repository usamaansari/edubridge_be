# EduBridge Backend

REST API for **EduBridge Academy**, a coaching platform for JEE, NEET and board-exam preparation. It serves students, parents, teachers, mentors, school coordinators and centre administrators. Features include curriculum and content delivery, online tests with automatic scoring and rankings, mentorship, doubt solving, attendance, analytics, fees and notifications.

The frontend lives at [usamaansari/edubridge_fe](https://github.com/usamaansari/edubridge_fe).

---

## Table of contents

- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [npm scripts](#npm-scripts)
- [Project structure](#project-structure)
- [Architecture](#architecture)
- [Authentication](#authentication)
- [Roles and access control](#roles-and-access-control)
- [Database](#database)
- [API reference](#api-reference)
- [Key workflows](#key-workflows)
- [Conventions](#conventions)
- [Scheduled jobs](#scheduled-jobs)
- [Known limitations](#known-limitations)
- [Deployment](#deployment)

---

## Tech stack

| Concern | Choice |
| --- | --- |
| Runtime | Node.js ≥ 20 |
| Language | TypeScript (strict, NodeNext modules) |
| HTTP framework | Express 5 |
| Database | PostgreSQL |
| ORM and migrations | Drizzle ORM and drizzle-kit |
| Validation | Zod 4 |
| Auth | JWT access tokens, rotating refresh tokens, bcrypt |
| File uploads | multer (local disk) |
| API docs | OpenAPI 3.1 generated from route definitions, served by Swagger UI |
| Security middleware | helmet, cors, express-rate-limit |

---

## Getting started

### Prerequisites

- Node.js 20 or newer
- PostgreSQL 13 or newer (the schema uses `gen_random_uuid()`, which is built in from PostgreSQL 13)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the environment

```bash
cp .env.example .env
```

Set `DATABASE_URL` at minimum. See [Environment variables](#environment-variables).

### 3. Create the database schema

> **Use an empty database.** The initial migration creates all 36 tables from scratch. It conflicts with tables left over from earlier versions of this project, such as an old `users` table.

```bash
npm run db:migrate
```

### 4. Load demo data (optional)

```bash
npm run db:seed
```

This creates one account per role. All accounts share the password `Password@123`, which you can override with `SEED_PASSWORD` in `.env`.

| Role | Email |
| --- | --- |
| super_admin | `admin@edubridge.dev` |
| centre_admin | `centre.admin@edubridge.dev` |
| school_coordinator | `coordinator@edubridge.dev` |
| teacher | `teacher@edubridge.dev` |
| mentor | `mentor@edubridge.dev` |
| student | `student1@edubridge.dev`, `student2@edubridge.dev` |
| parent | `parent@edubridge.dev` (linked to student1) |

The seed also creates:

- a demo centre
- a JEE Main program with Physics, Chemistry and Mathematics, each with chapters, topics and published content
- an active batch with both students, the teacher and the mentor, plus a timetable
- mentor assignments
- approved questions and a chapter test that is open for the next 7 days
- a fee structure with two instalments, assigned to both students
- a merit scholarship for student2

If `admin@edubridge.dev` already exists, the seed does nothing, so it is safe to re-run.

### 5. Run the server

```bash
npm run dev
```

The API listens on `http://localhost:3011` by default.

| URL | Purpose |
| --- | --- |
| `GET /` | API name and docs link |
| `GET /health` | Liveness check, which also runs `select 1` against the database |
| `/api-docs` | Swagger UI |
| `/api-docs.json` | Raw OpenAPI 3.1 document |
| `/uploads/*` | Uploaded files (static) |

---

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string. Append `?sslmode=require` for hosted databases that need TLS. |
| `PORT` | No | `3011` | HTTP port. |
| `NODE_ENV` | No | `development` | `development`, `production` or `test`. Production enables secure cookies, strict rate limits and a mandatory `JWT_SECRET`. |
| `JWT_SECRET` | In production | Insecure development secret | Signs access tokens. Generate one with `openssl rand -base64 32`. |
| `ACCESS_TOKEN_TTL` | No | `7d` | Access token lifetime in `jsonwebtoken` format (`15m`, `1h`, `7d`). The default matches the frontend's 7-day session. |
| `REFRESH_TOKEN_TTL_DAYS` | No | `30` | Refresh token lifetime in days. |
| `OTP_TTL_MINUTES` | No | `10` | How long a one-time code stays valid. |
| `OTP_MAX_ATTEMPTS` | No | `5` | Wrong guesses allowed before a code is invalidated. |
| `OTP_RESEND_COOLDOWN_SEC` | No | `60` | Minimum gap between two codes sent to the same identifier. |
| `CORS_ORIGINS` | No | `http://localhost:3000` | Comma-separated list of allowed frontend origins. Credentials are allowed. |
| `UPLOAD_DIR` | No | `uploads` | Directory for uploaded files. |
| `MAX_UPLOAD_MB` | No | `200` | Maximum upload size in MB. |
| `PUBLIC_BASE_URL` | No | `http://localhost:PORT` | Public base URL used to build links to uploaded files. |
| `SWAGGER_SERVER_URL` | No | `PUBLIC_BASE_URL` | Server URL shown in Swagger UI. |
| `SEED_PASSWORD` | No | `Password@123` | Password given to the demo accounts by `npm run db:seed`. |

---

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Starts the server with hot reload (nodemon and tsx). |
| `npm run build` | Compiles TypeScript to `dist/`. |
| `npm start` | Runs the compiled server from `dist/`. |
| `npm run typecheck` | Type-checks without emitting files. |
| `npm run db:generate` | Generates a SQL migration from schema changes. |
| `npm run db:migrate` | Applies pending migrations. |
| `npm run db:push` | Pushes the schema directly without a migration file (prototyping only). |
| `npm run db:studio` | Opens Drizzle Studio to browse the database. |
| `npm run db:seed` | Loads demo data. |

---

## Project structure

```text
edubridge_be/
├── drizzle/                      # Generated SQL migrations and drizzle-kit metadata
├── drizzle.config.ts             # drizzle-kit configuration
├── uploads/                      # Uploaded files (git-ignored)
└── src/
    ├── index.ts                  # Starts the HTTP server, handles graceful shutdown
    ├── app.ts                    # Express app: middleware, modules, Swagger, error handling
    ├── config/
    │   └── env.ts                # Typed environment configuration
    ├── db/
    │   ├── client.ts             # pg Pool and Drizzle client (snake_case casing)
    │   ├── index.ts              # Re-exports the client and schema
    │   ├── seed.ts               # Demo data
    │   └── schema/
    │       ├── enums.ts          # All pgEnums
    │       ├── columns.ts        # Shared column helpers (id, timestamps)
    │       ├── users.ts          # users, user_profiles, refresh_tokens, otp_verifications, parent_student_links
    │       ├── organisations.ts  # organisations, org_users, batches, batch_students, batch_faculty, timetable_slots
    │       ├── curriculum.ts     # programs, subjects, chapters, topics, content_items, student_content_progress
    │       ├── assessments.ts    # question_bank, question_options, tests, test_questions, test_attempts, test_responses
    │       ├── mentorship.ts     # mentor_assignments, mentor_sessions, student_goals, doubts, doubt_replies, attendance
    │       ├── analytics.ts      # student_analytics_snapshots, topic_performance
    │       ├── financial.ts      # fee_structures, student_fees, fee_payments, scholarships
    │       ├── notifications.ts  # notifications
    │       ├── relations.ts      # Drizzle relations
    │       └── index.ts
    ├── lib/
    │   ├── api-module.ts         # ApiModule: declarative routes with auth, roles and validation
    │   ├── openapi.ts            # Builds the OpenAPI document from registered routes
    │   ├── access.ts             # Role groups and scoping helpers (org, batch, student)
    │   ├── validation.ts         # Shared Zod schemas and input parsing
    │   ├── http-error.ts         # HttpError and helpers (badRequest, forbidden, ...)
    │   ├── pg-error.ts           # PostgreSQL error-code helpers
    │   ├── pagination.ts         # { data, meta } pagination helpers
    │   ├── crypto.ts             # Hashing, tokens, OTPs, enrolment and receipt numbers, seeded shuffle
    │   ├── dates.ts              # Date and number helpers
    │   └── messaging.ts          # OTP delivery (development stub)
    ├── middleware/
    │   ├── auth.ts               # JWT verification, loads req.user
    │   ├── upload.ts             # multer configuration
    │   └── error-handler.ts      # 404 handler and JSON error responses
    └── modules/
        ├── index.ts              # Registers every module
        ├── auth/                 # Register, login, refresh, OTP, password flows
        ├── users/                # Accounts and profiles
        ├── parents/              # Parent–student links, children overview
        ├── students/             # Student summary
        ├── organisations/        # Organisations and memberships
        ├── batches/              # Batches, enrolments, faculty, timetable
        ├── curriculum/           # Programs, subjects, chapters, topics
        ├── content/              # Content items and progress
        ├── uploads/              # Generic file upload
        ├── assessments/          # Question bank, tests, attempts, scoring
        ├── mentorship/           # Mentor assignments, sessions, goals
        ├── doubts/               # Doubts and replies
        ├── attendance/           # Attendance marking and summaries
        ├── analytics/            # Dashboards and daily snapshots
        ├── financial/            # Fee structures, student fees, payments, scholarships
        └── notifications/        # In-app notifications and broadcasts
```

Most modules follow the same layout: `*.routes.ts` declares the endpoints, `*.service.ts` holds the business logic and queries, and `*.schemas.ts` holds the Zod request schemas when there are many of them.

---

## Architecture

### Declarative routes with `ApiModule`

Every endpoint is declared once, and that declaration drives authentication, role checks, request validation and the OpenAPI document:

```ts
export const batchesModule = new ApiModule("Batches", "/batches");

batchesModule.post(
  "/",
  {
    summary: "Create a batch",
    roles: ADMIN_ROLES,          // omit for "any signed-in user"; `auth: false` for public routes
    body: createBatchBody,       // Zod schema; query and params work the same way
    status: 201,
  },
  async ({ user, body }) => createBatch(user, body),
);
```

- The handler receives `{ req, res, body, query, params, user }`, already validated and typed.
- Whatever the handler returns is sent as JSON. Returning `undefined` sends `204 No Content`.
- Express 5 forwards thrown errors and rejected promises to the error handler, so handlers never need `try/catch` for HTTP errors.
- New modules must be added to `src/modules/index.ts`.

### Error format

Every error response has the same shape:

```json
{
  "message": "Validation failed",
  "details": { "email": "Invalid email address" }
}
```

| Source | Status |
| --- | --- |
| Zod validation failure | `400`, with `details` keyed by field path |
| Missing or invalid token | `401` |
| Role or scope check failed | `403` |
| Resource not found | `404` |
| Unique violation (PG `23505`) | `409` |
| Foreign-key violation (PG `23503`) | `409` |
| Check-constraint violation (PG `23514`) or invalid UUID (PG `22P02`) | `400` |
| Rate limit exceeded | `429` |
| Anything else | `500`, with the message hidden in production |

### Pagination

List endpoints that can grow large accept `?page=1&limit=20` and return:

```json
{
  "data": [],
  "meta": { "page": 1, "limit": 20, "total": 134, "totalPages": 7 }
}
```

---

## Authentication

### Tokens

| Token | Format | Lifetime | Where |
| --- | --- | --- | --- |
| Access token | JWT (HS256) | `ACCESS_TOKEN_TTL` (7 days) | `Authorization: Bearer <token>` header |
| Refresh token | Random opaque string | `REFRESH_TOKEN_TTL_DAYS` (30 days) | Response body, and an httpOnly `eb_refresh` cookie scoped to `/auth` |

- The user is re-read from the database on every authenticated request. Suspending a user or changing their role takes effect immediately, without waiting for the token to expire.
- Refresh tokens are stored only as SHA-256 hashes. Each refresh **rotates** the token. If a token that was already rotated is presented again, every session for that user is revoked, because the token has probably been stolen.

Successful login, registration, OTP login and refresh all return:

```json
{
  "accessToken": "eyJ...",
  "tokenType": "Bearer",
  "expiresIn": "7d",
  "refreshToken": "f3a9...",
  "refreshTokenExpiresAt": "2026-11-06T10:00:00.000Z",
  "user": {
    "id": "…", "name": "Aarav Sharma", "email": "student1@edubridge.dev",
    "role": "student", "status": "active", "organisationId": null
  }
}
```

### Flows

| Flow | Endpoints |
| --- | --- |
| Self-registration (students and parents only) | `POST /auth/register`, then `POST /auth/otp/send` and `POST /auth/otp/verify` with purpose `verify_email` to activate the account |
| Password login | `POST /auth/login` |
| OTP login | `POST /auth/otp/send` and `POST /auth/otp/verify` with purpose `login` |
| Forgot password | `POST /auth/forgot-password`, then `POST /auth/reset-password` |
| Change password | `POST /auth/change-password` (signed in) |
| Sessions | `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all` |

Staff accounts (admins, coordinators, teachers and mentors) are created by admins through `POST /users`.

### OTPs

- Codes are 6 digits, bcrypt-hashed, valid for `OTP_TTL_MINUTES`, and invalidated after `OTP_MAX_ATTEMPTS` wrong guesses.
- A new code for the same identifier can only be requested after `OTP_RESEND_COOLDOWN_SEC`.
- **In development the code is printed to the server console.** No SMS or email provider is connected yet; see `src/lib/messaging.ts`.
- Forgot-password responses are identical whether or not the account exists, so the endpoint can't be used to discover registered emails.

### Rate limiting

Login, registration, OTP and password-reset endpoints allow 10 requests per 15 minutes per IP in production, and 1000 in development.

---

## Roles and access control

| Role | Scope |
| --- | --- |
| `super_admin` | Everything, across all organisations. |
| `centre_admin` | Manages the organisations they belong to (through `org_users`), plus those organisations' batches, staff, students, tests and fees. |
| `school_coordinator` | Read-only access to their organisations' batches, students, attendance and analytics. Can mark attendance. |
| `teacher` | Batches they are assigned to (through `batch_faculty`). Creates content, questions and tests, answers doubts and marks attendance. |
| `mentor` | Their assigned students (through `mentor_assignments`) and batches. Runs sessions, sets goals and answers doubts. |
| `student` | Their own data, plus content and tests for batches they are actively enrolled in. |
| `parent` | Read-only access to their linked children's data (through `parent_student_links`). |

The scoping rules live in `src/lib/access.ts`:

- **Role groups:** `ADMIN_ROLES`, `ORG_STAFF_ROLES`, `FACULTY_ROLES`, `STAFF_ROLES` and `AUTHOR_ROLES`.
- **Scope helpers:** `getAccessibleBatchIds(user)` returns `null` for unrestricted users, otherwise the list of batch ids the user can see. `assertOrgAccess`, `assertBatchAccess` and `assertCanViewStudent` throw `403` when access is not allowed.

Data that a student is allowed to see, such as their summary, analytics, attendance and fees, is visible to:

- the student
- their linked parents
- their mentor
- faculty of the student's batches
- admins of the student's organisation

---

## Database

The schema is defined with Drizzle in `src/db/schema/`. It has 36 tables across 8 domains:

| Domain | Tables |
| --- | --- |
| Users | `users`, `user_profiles`, `refresh_tokens`, `otp_verifications`, `parent_student_links` |
| Organisations | `organisations`, `org_users`, `batches`, `batch_students`, `batch_faculty`, `timetable_slots` |
| Curriculum | `programs`, `subjects`, `chapters`, `topics`, `content_items`, `student_content_progress` |
| Assessments | `question_bank`, `question_options`, `tests`, `test_questions`, `test_attempts`, `test_responses` |
| Mentorship | `mentor_assignments`, `mentor_sessions`, `student_goals`, `doubts`, `doubt_replies`, `attendance` |
| Analytics | `student_analytics_snapshots`, `topic_performance` |
| Financial | `fee_structures`, `student_fees`, `fee_payments`, `scholarships` |
| Notifications | `notifications` |

### Schema conventions

- **Primary keys:** UUIDs generated by `gen_random_uuid()`.
- **Timestamps:** every table has `created_at` (`defaultNow`) and `updated_at`, which is set automatically on update.
- **Soft deletes:** users, organisations, content and questions have `deleted_at` and are never hard-deleted. Other records are deactivated (`is_active = false`), cancelled or archived instead of deleted.
- **Enums:** all enumerations are PostgreSQL enums (`pgEnum`) defined in `enums.ts`.
- **Flexible data:** structured but variable data is stored as `jsonb`, for example addresses, marking schemes, test responses, instalment plans and notification payloads.
- **Naming:** columns are camelCase in TypeScript and snake_case in PostgreSQL, handled by Drizzle's `casing: "snake_case"`.
- **Foreign keys:** each one declares `onDelete: "cascade"` or `"restrict"`.
- **Integrity:** enforced with unique constraints, check constraints (class level 9–12, valid date and time ranges, day of week 0–6), and a partial unique index that allows only one *active* mentor assignment per mentor–student pair.

### Changing the schema

1. Edit the files in `src/db/schema/`.
2. Run `npm run db:generate -- --name describe_change` to create a migration in `drizzle/`.
3. Review the generated SQL.
4. Run `npm run db:migrate`.

---

## API reference

The interactive docs at **`/api-docs`** show every request and response schema, generated from the same Zod definitions the server validates against. Click **Authorize** and paste an access token to try endpoints that need sign-in.

Access column: **public** means no token is needed; **signed-in** means any authenticated user, with results scoped to what that user may see. Otherwise the listed roles apply. `super_admin` can call every admin endpoint.

### Auth — `/auth`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| POST | `/auth/register` | public | Register a student or parent |
| POST | `/auth/login` | public | Sign in with email and password |
| POST | `/auth/refresh` | public | Rotate the refresh token |
| POST | `/auth/logout` | public | Sign out this session |
| POST | `/auth/logout-all` | signed-in | Sign out every session |
| GET | `/auth/me` | signed-in | Get the signed-in user |
| POST | `/auth/otp/send` | public | Send a one-time code |
| POST | `/auth/otp/verify` | public | Verify a one-time code |
| POST | `/auth/forgot-password` | public | Request a password reset code |
| POST | `/auth/reset-password` | public | Reset password with a code |
| POST | `/auth/change-password` | signed-in | Change my password |

### Users — `/users`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/users/me` | signed-in | Get my account and profile |
| PATCH | `/users/me` | signed-in | Update my profile |
| GET | `/users` | admins | List users (filter by role, status, org, search) |
| POST | `/users` | admins | Create a user of any role |
| GET | `/users/:id` | admins | Get a user |
| PATCH | `/users/:id` | admins | Update a user |
| PATCH | `/users/:id/status` | admins | Activate or suspend a user |
| DELETE | `/users/:id` | admins | Soft-delete a user |

### Parents and students

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/parents/me/children` | parent | My children with a performance summary |
| GET | `/parents/links` | admins | List parent–student links |
| POST | `/parents/links` | admins | Link a parent to a student |
| DELETE | `/parents/links/:id` | admins | Remove a link |
| GET | `/students/:id` | signed-in | Student summary (scores, attendance, weak and strong topics) |

### Organisations — `/organisations`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/organisations` | admins, coordinator | List organisations |
| POST | `/organisations` | super_admin | Create an organisation |
| GET | `/organisations/:id` | admins, coordinator | Get an organisation |
| PATCH | `/organisations/:id` | admins | Update an organisation |
| DELETE | `/organisations/:id` | super_admin | Soft-delete an organisation |
| GET | `/organisations/:id/users` | admins, coordinator | List members |
| POST | `/organisations/:id/users` | admins | Add a member |
| PATCH | `/organisations/:id/users/:userId` | admins | Change a member's role |
| DELETE | `/organisations/:id/users/:userId` | admins | Remove a member (records `left_at`) |

### Batches — `/batches`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/batches/my-schedule` | signed-in | My weekly timetable |
| GET | `/batches` | signed-in | List batches I can see |
| POST | `/batches` | admins | Create a batch |
| GET | `/batches/:id` | signed-in | Batch with faculty and counts |
| PATCH | `/batches/:id` | admins | Update a batch |
| DELETE | `/batches/:id` | admins | Cancel a batch |
| GET | `/batches/:id/students` | staff | List enrolled students |
| POST | `/batches/:id/students` | admins | Enrol a student (generates an enrolment number) |
| PATCH | `/batches/:id/students/:studentId` | admins | Change enrolment status |
| POST | `/batches/:id/students/:studentId/transfer` | admins | Transfer to another batch |
| GET | `/batches/:id/faculty` | signed-in | List faculty |
| POST | `/batches/:id/faculty` | admins | Assign a teacher or mentor |
| DELETE | `/batches/:id/faculty/:assignmentId` | admins | Remove a faculty assignment |
| GET | `/batches/:id/timetable` | signed-in | Batch timetable |
| POST | `/batches/:id/timetable` | admins | Add a slot (rejects clashes) |
| PATCH | `/batches/:id/timetable/:slotId` | admins | Update a slot |
| DELETE | `/batches/:id/timetable/:slotId` | admins | Deactivate a slot |

### Curriculum — `/programs`, `/subjects`, `/chapters`, `/topics`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/programs` | public | List programs |
| GET | `/programs/:id` | public | Program with subjects |
| GET | `/programs/:id/curriculum` | signed-in | Full curriculum tree with my progress |
| POST / PATCH / DELETE | `/programs`, `/programs/:id` | super_admin | Manage programs (DELETE deactivates) |
| GET | `/subjects` | signed-in | Subjects with progress (students default to their programs) |
| GET | `/subjects/:id` | signed-in | Subject with chapters, topics and progress |
| POST / PATCH | `/subjects`, `/subjects/:id` | super_admin | Manage subjects |
| GET | `/chapters?subjectId=` | signed-in | Chapters of a subject |
| POST / PATCH / DELETE | `/chapters`, `/chapters/:id` | admins | Manage chapters (DELETE deactivates) |
| GET | `/topics?chapterId=` | signed-in | Topics of a chapter |
| GET | `/topics/:id` | signed-in | Topic with its content |
| POST / PATCH / DELETE | `/topics`, `/topics/:id` | admins | Manage topics (DELETE deactivates) |

### Content and uploads

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/content` | signed-in | List content (filter by topic, type) |
| GET | `/content/bookmarks` | student | My bookmarks |
| POST | `/content` | authors | Create content as JSON, or as multipart with a `file` field |
| GET | `/content/:id` | signed-in | Get a content item |
| PATCH | `/content/:id` | authors | Update content |
| DELETE | `/content/:id` | authors | Soft-delete content |
| PUT | `/content/:id/progress` | student | Save watch progress and bookmark (≥ 90% watched counts as completed) |
| POST | `/files` | signed-in | Upload a file (images, PDF, MP4/WebM/MOV) and get back its URL |

*Authors* are `super_admin`, `centre_admin`, `teacher` and `mentor`.

### Question bank — `/questions`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/questions` | staff | Search by subject, chapter, topic, type, difficulty, tags, approval |
| POST | `/questions` | authors | Create a question with options |
| GET | `/questions/:id` | staff | Question with options and solution |
| PATCH | `/questions/:id` | authors | Update a question |
| POST | `/questions/:id/approve` | admins | Approve |
| POST | `/questions/:id/unapprove` | admins | Withdraw approval |
| DELETE | `/questions/:id` | authors | Soft-delete |

### Tests and attempts — `/tests`, `/attempts`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/tests` | signed-in | List tests (students also get `myAttempt`) |
| POST | `/tests` | authors | Create a test |
| GET | `/tests/:id` | signed-in | Get a test |
| PATCH | `/tests/:id` | authors | Update a draft test |
| PATCH | `/tests/:id/status` | authors | Schedule, publish, complete or archive |
| DELETE | `/tests/:id` | authors | Archive |
| GET | `/tests/:id/questions` | staff | Questions with answers |
| POST | `/tests/:id/questions` | authors | Add questions |
| DELETE | `/tests/:id/questions/:questionId` | authors | Remove a question |
| POST | `/tests/:id/attempts` | student | Start or resume an attempt (submits at once if `answers` is sent) |
| GET | `/tests/:id/attempts` | staff | Leaderboard and all attempts |
| GET | `/tests/:id/result` | signed-in | Result with score, rank, percentile and per-question breakdown |
| GET | `/tests/:id/pending-grading` | authors | Subjective answers awaiting grading |
| GET | `/attempts/:id` | signed-in | Attempt with the question paper |
| PUT | `/attempts/:id/responses` | student | Save answers (autosave) |
| POST | `/attempts/:id/tab-switch` | student | Record a tab switch (proctoring) |
| POST | `/attempts/:id/submit` | student | Submit |
| PATCH | `/attempts/:id/responses/:questionId/grade` | authors | Grade a subjective answer |

### Mentorship — `/mentor-assignments`, `/mentor-sessions`, `/goals`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/mentor-assignments/my-students` | mentor | My mentees with summaries |
| GET | `/mentor-assignments/my-mentor` | student | My current mentor |
| GET | `/mentor-assignments` | admins, mentor | List assignments |
| POST | `/mentor-assignments` | admins | Assign a mentor (ends the student's previous active assignment) |
| DELETE | `/mentor-assignments/:id` | admins | End an assignment |
| GET | `/mentor-sessions` | signed-in | List sessions |
| POST | `/mentor-sessions` | admins, mentor | Schedule a session |
| GET | `/mentor-sessions/:id` | signed-in | Get a session |
| PATCH | `/mentor-sessions/:id` | admins, mentor | Update a session |
| POST | `/mentor-sessions/:id/complete` | admins, mentor | Complete with notes and action items |
| POST | `/mentor-sessions/:id/cancel` | signed-in | Cancel |
| POST | `/mentor-sessions/:id/rate` | student | Rate a completed session |
| GET | `/goals` | signed-in | List goals |
| POST | `/goals` | admins, mentor | Set a goal for a student |
| PATCH | `/goals/:id` | signed-in | Update a goal's progress or status |

### Doubts — `/doubts`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/doubts` | signed-in | List doubts |
| POST | `/doubts` | student | Ask a doubt |
| GET | `/doubts/:id` | signed-in | Doubt with its replies |
| PATCH | `/doubts/:id` | signed-in | Edit, or change status |
| POST | `/doubts/:id/assign` | authors | Assign to a faculty member |
| POST | `/doubts/:id/replies` | signed-in | Reply (notifies the student) |
| POST | `/doubts/:id/replies/:replyId/accept` | signed-in | Accept a reply as the answer |
| POST | `/doubts/:id/upvote` | student | "I have this doubt too" |

### Attendance — `/attendance`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| POST | `/attendance/bulk` | staff | Mark a class (upsert; parents of absent students are notified) |
| GET | `/attendance` | signed-in | List records |
| GET | `/attendance/summary` | signed-in | Present, absent, late and excused counts with percentage |
| PATCH | `/attendance/:id` | staff | Correct a record |

### Analytics — `/analytics`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/analytics/overview` | admins | Dashboard KPIs (students, batches, tests, doubts, fees, at-risk) |
| GET | `/analytics/students/:studentId` | signed-in | Student performance overview |
| GET | `/analytics/students/:studentId/snapshots` | signed-in | Daily snapshot history |
| GET | `/analytics/students/:studentId/topics` | signed-in | Topic-wise accuracy (heatmap data) |
| GET | `/analytics/batches/:batchId` | staff | Batch analytics |
| POST | `/analytics/snapshots/compute` | super_admin | Run the daily snapshot job |

### Financial — `/fee-structures`, `/student-fees`, `/fee-payments`, `/scholarships`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/fee-structures` | admins | List fee structures |
| POST | `/fee-structures` | admins | Create (`orgId: null` makes a platform default, super_admin only) |
| GET | `/fee-structures/:id` | admins | Get a fee structure |
| PATCH | `/fee-structures/:id` | admins | Update |
| DELETE | `/fee-structures/:id` | admins | Deactivate |
| GET | `/student-fees` | signed-in | List fees (students: own; parents: children's; admins: their batches) |
| POST | `/student-fees` | admins | Assign a fee (applies the best active scholarship automatically) |
| POST | `/student-fees/mark-overdue` | admins | Run the overdue-fee job |
| GET | `/student-fees/:id` | signed-in | Fee with payments and outstanding balance |
| PATCH | `/student-fees/:id` | admins | Adjust discount or due date, or waive |
| POST | `/student-fees/:id/payments` | admins | Record a payment (issues a receipt number) |
| GET | `/fee-payments` | signed-in | List payments |
| GET | `/fee-payments/:id` | signed-in | Payment receipt |
| GET | `/scholarships` | signed-in | List scholarships |
| POST | `/scholarships` | admins | Award a scholarship |
| PATCH | `/scholarships/:id` | admins | Update or end (set `validTill`) |

### Notifications — `/notifications`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/notifications` | signed-in | My notifications (`meta` includes `unreadCount`) |
| GET | `/notifications/unread-count` | signed-in | Unread count |
| POST | `/notifications/read-all` | signed-in | Mark all as read |
| PATCH | `/notifications/:id/read` | signed-in | Mark one as read |
| POST | `/notifications/broadcast` | admins | Announce to users, roles, a batch or an organisation |

---

## Key workflows

### Test lifecycle

1. **Draft.** An author creates a test with a marking scheme and adds approved questions. Marks per question are resolved in this order:
   1. an explicit override on the test question
   2. the scheme section matching the section name
   3. the scheme section matching the question type
   4. the question's default marks
2. **Scheduled.** Publishing requires every question to be approved. Students in the batch are notified. A scheduled test becomes **live** automatically at `scheduled_at` and **completed** at `ends_at`, so no cron job is needed.
3. **Attempt.**
   - `POST /tests/:id/attempts` starts an attempt, or resumes the open one.
   - Question and option order are shuffled with a seed derived from the attempt, so a resumed attempt shows the same order.
   - Answers are autosaved with `PUT /attempts/:id/responses`.
   - Options are keyed `A`, `B`, `C`, … by their sequence order. Integer answers are sent as `{ value: 42 }`.
4. **Submit.**
   - Submission runs in a transaction that locks the attempt row. Objective questions are scored immediately.
   - Ranks and percentiles are recomputed for everyone using SQL `rank()` and `cume_dist()`.
   - Topic performance is updated, and the student is notified.
   - Attempts left open after the deadline (plus a 60-second grace period) are auto-submitted the next time they are accessed.
5. **Grading.** Subjective answers appear under `/tests/:id/pending-grading`. Grading one updates the score and recomputes rankings.
6. **Solutions** are shown according to `show_solution_after`: `after_submit`, `after_end_time` or `never`.

### Fees

1. An admin creates a **fee structure** for a program, optionally with an instalment plan whose amounts must add up to the total.
2. **Assigning** the fee to an enrolled student copies the base amount. The discount is either given explicitly or comes from the student's best active scholarship. Net amount = base − discount. The next due date comes from the instalment plan, scaled to the net amount.
3. **Recording a payment:**
   - generates a unique receipt number (`RCPT-YYYYMMDD-XXXXXXXX`)
   - updates the amount paid, the status (`pending`, `partial` or `paid`) and the next due date
   - rejects payments larger than the outstanding balance
4. The **overdue job** marks unpaid fees past their due date as `overdue` and notifies the student and their parents.

### Analytics and at-risk students

`POST /analytics/snapshots/compute` writes one snapshot per active student per day. Each snapshot includes:

- subject-wise scores
- weak topics (accuracy below 50% with at least 5 attempts) and strong topics (accuracy of 80% or more)
- study hours and DPP completion
- the student's streak

A student is flagged **at risk** when any of these is true:

- their average score is below 40%
- their attendance is below 75%
- they had no activity in the past week

Mentors and parents are notified when a student first becomes at risk.

---

## Conventions

- **Imports** use the `.js` extension, as NodeNext module resolution requires (`import { db } from "../../db/index.js"`).
- **Money and marks** are PostgreSQL `numeric` values, exchanged as strings such as `"120000.00"`. Fee calculations are done in integer paise to avoid floating-point errors.
- **Dates** are ISO strings: `YYYY-MM-DD` for dates and full ISO 8601 for timestamps.
- **Never hard-delete** users or content. Use `deleted_at`, `is_active` or a status column.
- **Validation:** request bodies are validated with Zod, and unknown fields are stripped.
- **Business rules** go in services. Route files stay thin: they validate input, check roles, and call a service.

---

## Scheduled jobs

These jobs run only when their endpoint is called. In production, trigger them once a day from a scheduler such as cron, GitHub Actions or a cloud scheduler, calling with an admin token:

| Job | Endpoint | Suggested schedule |
| --- | --- | --- |
| Daily analytics snapshots and at-risk alerts | `POST /analytics/snapshots/compute` | Nightly, e.g. 01:00 |
| Mark overdue fees and send reminders | `POST /student-fees/mark-overdue` | Daily, e.g. 08:00 |

Test status changes and auto-submission happen automatically and need no scheduler.

---

## Known limitations

- **OTP delivery is a stub.** Codes are printed to the console in development. To send real SMS or email, connect a provider in `src/lib/messaging.ts`.
- **Notifications are stored, not delivered.** Rows are written to `notifications` for the in-app feed, but nothing sends them by push, email, SMS or WhatsApp yet. `sent_at` stays `null` until a delivery worker exists.
- **Uploads go to local disk.** For production with multiple instances, switch `src/middleware/upload.ts` to object storage such as S3 or GCS. The `content_items` table already has `mux_asset_id` and `mux_playback_id` columns for video hosting.
- **There is no audit log** of admin actions.
- **Differences from the frontend.** Some request shapes don't match what the frontend currently sends:
  - Tests use `name` and `type` rather than `title` and `exam`.
  - Doubts require `subjectId`, `title` and `bodyHtml`.
  - List endpoints return `{ data, meta }`.
  - Content uploads require `topicId` and `type`.
  - Registration requires a phone number.

---

## Deployment

1. Set `NODE_ENV=production`, a strong `JWT_SECRET`, `DATABASE_URL`, `CORS_ORIGINS` (your frontend's URL), `PUBLIC_BASE_URL` and `SWAGGER_SERVER_URL`.
2. Build and migrate:

   ```bash
   npm ci
   npm run build
   npm run db:migrate
   npm start
   ```

3. Run behind HTTPS. Production refresh cookies are `Secure`. The app sets `trust proxy` so that rate limiting sees the real client IP behind one reverse proxy.
4. Keep `UPLOAD_DIR` on persistent storage, or move uploads to object storage.
5. Schedule the [daily jobs](#scheduled-jobs).
6. The server shuts down gracefully on `SIGINT` and `SIGTERM`, closing the database pool.
