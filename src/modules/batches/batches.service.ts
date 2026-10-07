import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
} from "drizzle-orm";

import {
  type Batch,
  type BatchStudent,
  batches,
  batchFaculty,
  batchStudents,
  db,
  organisations,
  programs,
  subjects,
  timetableSlots,
  userProfiles,
  users,
} from "../../db/index.js";
import { getAccessibleBatchIds } from "../../lib/access.js";
import { generateEnrollmentNo } from "../../lib/crypto.js";
import { fullName, todayIso } from "../../lib/dates.js";
import { badRequest, conflict, notFound } from "../../lib/http-error.js";
import { offsetOf, paginate } from "../../lib/pagination.js";
import { getPgError, PG_UNIQUE_VIOLATION } from "../../lib/pg-error.js";
import type { AuthUser } from "../../middleware/auth.js";
import { assertUserRole } from "../users/users.service.js";

const studentCount = db
  .select({ batchId: batchStudents.batchId, value: count().as("student_count") })
  .from(batchStudents)
  .where(eq(batchStudents.status, "active"))
  .groupBy(batchStudents.batchId)
  .as("student_count");

export async function listBatches(
  user: AuthUser,
  query: {
    page: number;
    limit: number;
    orgId?: string;
    programId?: string;
    status?: Batch["status"];
    mode?: Batch["mode"];
    academicYear?: string;
    classLevel?: number;
    search?: string;
  },
) {
  const conditions: SQL[] = [];
  const accessible = await getAccessibleBatchIds(user);
  if (accessible !== null) {
    if (!accessible.length) return paginate([], 0, query.page, query.limit);
    conditions.push(inArray(batches.id, accessible));
  }
  if (query.orgId) conditions.push(eq(batches.orgId, query.orgId));
  if (query.programId) conditions.push(eq(batches.programId, query.programId));
  if (query.status) conditions.push(eq(batches.status, query.status));
  if (query.mode) conditions.push(eq(batches.mode, query.mode));
  if (query.academicYear) conditions.push(eq(batches.academicYear, query.academicYear));
  if (query.classLevel) conditions.push(eq(batches.classLevel, query.classLevel));
  if (query.search) conditions.push(ilike(batches.name, `%${query.search}%`));
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, [total]] = await Promise.all([
    db
      .select({
        batch: batches,
        orgName: organisations.name,
        programName: programs.name,
        examType: programs.examType,
        studentCount: studentCount.value,
      })
      .from(batches)
      .innerJoin(organisations, eq(organisations.id, batches.orgId))
      .innerJoin(programs, eq(programs.id, batches.programId))
      .leftJoin(studentCount, eq(studentCount.batchId, batches.id))
      .where(where)
      .orderBy(desc(batches.startDate))
      .limit(query.limit)
      .offset(offsetOf(query.page, query.limit)),
    db.select({ value: count() }).from(batches).where(where),
  ]);

  return paginate(
    rows.map((r) => ({
      ...r.batch,
      orgName: r.orgName,
      programName: r.programName,
      examType: r.examType,
      studentCount: Number(r.studentCount ?? 0),
    })),
    total?.value ?? 0,
    query.page,
    query.limit,
  );
}

export async function getBatchDetail(batchId: string) {
  const [row] = await db
    .select({ batch: batches, orgName: organisations.name, programName: programs.name, examType: programs.examType })
    .from(batches)
    .innerJoin(organisations, eq(organisations.id, batches.orgId))
    .innerJoin(programs, eq(programs.id, batches.programId))
    .where(eq(batches.id, batchId));
  if (!row) throw notFound("Batch");
  const [[students], faculty] = await Promise.all([
    db
      .select({ value: count() })
      .from(batchStudents)
      .where(and(eq(batchStudents.batchId, batchId), eq(batchStudents.status, "active"))),
    listFaculty(batchId),
  ]);
  return {
    ...row.batch,
    orgName: row.orgName,
    programName: row.programName,
    examType: row.examType,
    studentCount: students?.value ?? 0,
    faculty,
  };
}

export async function assertProgramForClass(programId: string, classLevel: number) {
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) throw badRequest("programId does not exist");
  if (!program.isActive) throw badRequest("The program is not active");
  if (!program.targetClass.includes(classLevel)) {
    throw badRequest(`This program targets classes ${program.targetClass.join(", ")}`);
  }
  return program;
}

export async function listStudents(batchId: string, status?: BatchStudent["status"]) {
  const conditions: SQL[] = [eq(batchStudents.batchId, batchId)];
  if (status) conditions.push(eq(batchStudents.status, status));
  const rows = await db
    .select({
      enrollment: batchStudents,
      email: users.email,
      phone: users.phone,
      userStatus: users.status,
      firstName: userProfiles.firstName,
      lastName: userProfiles.lastName,
      profilePicUrl: userProfiles.profilePicUrl,
    })
    .from(batchStudents)
    .innerJoin(users, eq(users.id, batchStudents.studentId))
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(and(...conditions))
    .orderBy(asc(userProfiles.firstName));
  return rows.map(({ enrollment, firstName, lastName, ...rest }) => ({
    ...enrollment,
    ...rest,
    name: fullName(firstName, lastName),
  }));
}

async function insertEnrollmentWithRetry(
  values: Omit<typeof batchStudents.$inferInsert, "enrollmentNo">,
  academicYear: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [row] = await db
        .insert(batchStudents)
        .values({ ...values, enrollmentNo: generateEnrollmentNo(academicYear) })
        .returning();
      return row;
    } catch (err) {
      const pg = getPgError(err);
      if (pg?.code === PG_UNIQUE_VIOLATION && pg.constraint?.includes("enrollment_no")) continue;
      throw err;
    }
  }
  throw new Error("Could not allocate a unique enrollment number");
}

async function assertCapacity(batch: Batch) {
  const [active] = await db
    .select({ value: count() })
    .from(batchStudents)
    .where(and(eq(batchStudents.batchId, batch.id), eq(batchStudents.status, "active")));
  if ((active?.value ?? 0) >= batch.capacity) throw conflict("The batch is at full capacity");
}

export async function enrollStudent(batch: Batch, studentId: string, transferredFromBatchId?: string) {
  if (batch.status === "cancelled" || batch.status === "completed") {
    throw badRequest(`Cannot enroll into a ${batch.status} batch`);
  }
  await assertUserRole(studentId, ["student"], "studentId");

  const [existing] = await db
    .select()
    .from(batchStudents)
    .where(and(eq(batchStudents.batchId, batch.id), eq(batchStudents.studentId, studentId)));
  if (existing?.status === "active") throw conflict("The student is already enrolled in this batch");

  await assertCapacity(batch);

  if (existing) {
    const [row] = await db
      .update(batchStudents)
      .set({ status: "active", enrolledAt: new Date(), transferredFromBatchId: transferredFromBatchId ?? null })
      .where(eq(batchStudents.id, existing.id))
      .returning();
    return row;
  }
  return insertEnrollmentWithRetry(
    { batchId: batch.id, studentId, transferredFromBatchId: transferredFromBatchId ?? null },
    batch.academicYear,
  );
}

export async function setEnrollmentStatus(
  batchId: string,
  studentId: string,
  status: "active" | "withdrawn" | "completed",
) {
  const [row] = await db
    .update(batchStudents)
    .set({ status })
    .where(and(eq(batchStudents.batchId, batchId), eq(batchStudents.studentId, studentId)))
    .returning();
  if (!row) throw notFound("Enrollment");
  return row;
}

export async function transferStudent(fromBatch: Batch, toBatch: Batch, studentId: string) {
  if (fromBatch.id === toBatch.id) throw badRequest("Target batch must be different");
  const [current] = await db
    .select()
    .from(batchStudents)
    .where(
      and(
        eq(batchStudents.batchId, fromBatch.id),
        eq(batchStudents.studentId, studentId),
        eq(batchStudents.status, "active"),
      ),
    );
  if (!current) throw notFound("Active enrollment");

  const enrollment = await enrollStudent(toBatch, studentId, fromBatch.id);
  await db.update(batchStudents).set({ status: "transferred" }).where(eq(batchStudents.id, current.id));
  return enrollment;
}

export async function listFaculty(batchId: string) {
  const rows = await db
    .select({
      assignment: batchFaculty,
      email: users.email,
      userRole: users.role,
      firstName: userProfiles.firstName,
      lastName: userProfiles.lastName,
      subjectName: subjects.name,
      subjectCode: subjects.code,
    })
    .from(batchFaculty)
    .innerJoin(users, eq(users.id, batchFaculty.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .leftJoin(subjects, eq(subjects.id, batchFaculty.subjectId))
    .where(eq(batchFaculty.batchId, batchId))
    .orderBy(asc(batchFaculty.assignedAt));
  return rows.map(({ assignment, firstName, lastName, ...rest }) => ({
    ...assignment,
    ...rest,
    name: fullName(firstName, lastName),
  }));
}

export async function assertSubjectInProgram(subjectId: string, programId: string) {
  const [subject] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(eq(subjects.id, subjectId), eq(subjects.programId, programId)));
  if (!subject) throw badRequest("subjectId does not belong to the batch's program");
}

export async function assignFaculty(
  batch: Batch,
  input: { userId: string; subjectId?: string | null; role: string },
) {
  await assertUserRole(input.userId, ["teacher", "mentor"], "userId");
  if (input.subjectId) await assertSubjectInProgram(input.subjectId, batch.programId);

  const [duplicate] = await db
    .select({ id: batchFaculty.id })
    .from(batchFaculty)
    .where(
      and(
        eq(batchFaculty.batchId, batch.id),
        eq(batchFaculty.userId, input.userId),
        input.subjectId ? eq(batchFaculty.subjectId, input.subjectId) : isNull(batchFaculty.subjectId),
      ),
    );
  if (duplicate) throw conflict("This faculty member is already assigned with that subject");

  const [row] = await db
    .insert(batchFaculty)
    .values({ batchId: batch.id, userId: input.userId, subjectId: input.subjectId ?? null, role: input.role })
    .returning();
  return row;
}

export async function removeFaculty(batchId: string, assignmentId: string) {
  const [row] = await db
    .delete(batchFaculty)
    .where(and(eq(batchFaculty.id, assignmentId), eq(batchFaculty.batchId, batchId)))
    .returning({ id: batchFaculty.id });
  if (!row) throw notFound("Faculty assignment");
}

const facultyProfile = userProfiles;

function slotSelect() {
  return db
    .select({
      slot: timetableSlots,
      batchName: batches.name,
      subjectName: subjects.name,
      subjectCode: subjects.code,
      facultyFirstName: facultyProfile.firstName,
      facultyLastName: facultyProfile.lastName,
    })
    .from(timetableSlots)
    .innerJoin(batches, eq(batches.id, timetableSlots.batchId))
    .innerJoin(subjects, eq(subjects.id, timetableSlots.subjectId))
    .leftJoin(facultyProfile, eq(facultyProfile.userId, timetableSlots.facultyId));
}

type SlotRow = Awaited<ReturnType<ReturnType<typeof slotSelect>["where"]>>[number];

function shapeSlot({ slot, facultyFirstName, facultyLastName, ...rest }: SlotRow) {
  return { ...slot, ...rest, facultyName: fullName(facultyFirstName, facultyLastName) };
}

function activeOnDate(date: string): SQL {
  return and(
    eq(timetableSlots.isActive, true),
    lte(timetableSlots.effectiveFrom, date),
    or(isNull(timetableSlots.effectiveUntil), gte(timetableSlots.effectiveUntil, date)),
  )!;
}

export async function listTimetable(batchId: string, includeInactive: boolean) {
  const conditions: SQL[] = [eq(timetableSlots.batchId, batchId)];
  if (!includeInactive) conditions.push(activeOnDate(todayIso()));
  const rows = await slotSelect()
    .where(and(...conditions))
    .orderBy(asc(timetableSlots.dayOfWeek), asc(timetableSlots.startTime));
  return rows.map(shapeSlot);
}

export async function getMySchedule(user: AuthUser) {
  const conditions: SQL[] = [activeOnDate(todayIso())];
  if (user.role === "student") {
    const accessible = await getAccessibleBatchIds(user);
    if (!accessible?.length) return [];
    conditions.push(inArray(timetableSlots.batchId, accessible));
  } else if (user.role === "parent") {
    const accessible = await getAccessibleBatchIds(user);
    if (!accessible?.length) return [];
    conditions.push(inArray(timetableSlots.batchId, accessible));
  } else {
    conditions.push(eq(timetableSlots.facultyId, user.id));
  }
  const rows = await slotSelect()
    .where(and(...conditions))
    .orderBy(asc(timetableSlots.dayOfWeek), asc(timetableSlots.startTime));
  return rows.map(shapeSlot);
}

type SlotInput = {
  subjectId: string;
  facultyId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  effectiveFrom: string;
  effectiveUntil?: string | null;
};

async function assertNoSlotClash(batchId: string, input: SlotInput, excludeSlotId?: string) {
  const conditions: SQL[] = [
    eq(timetableSlots.isActive, true),
    eq(timetableSlots.dayOfWeek, input.dayOfWeek),
    lt(timetableSlots.startTime, input.endTime),
    gt(timetableSlots.endTime, input.startTime),
    or(isNull(timetableSlots.effectiveUntil), gte(timetableSlots.effectiveUntil, input.effectiveFrom))!,
    or(eq(timetableSlots.batchId, batchId), eq(timetableSlots.facultyId, input.facultyId))!,
  ];
  if (input.effectiveUntil) conditions.push(lte(timetableSlots.effectiveFrom, input.effectiveUntil));
  if (excludeSlotId) conditions.push(ne(timetableSlots.id, excludeSlotId));
  const [clash] = await db
    .select({ id: timetableSlots.id, batchId: timetableSlots.batchId })
    .from(timetableSlots)
    .where(and(...conditions))
    .limit(1);
  if (clash) {
    throw conflict(
      clash.batchId === batchId
        ? "The batch already has a class in this time slot"
        : "The faculty member already teaches another batch in this time slot",
    );
  }
}

async function assertFacultyInBatch(batchId: string, facultyId: string) {
  const [row] = await db
    .select({ id: batchFaculty.id })
    .from(batchFaculty)
    .where(and(eq(batchFaculty.batchId, batchId), eq(batchFaculty.userId, facultyId)))
    .limit(1);
  if (!row) throw badRequest("facultyId must be assigned to the batch first");
}

export async function createSlot(batch: Batch, input: SlotInput & { roomOrLink?: string | null }) {
  await assertSubjectInProgram(input.subjectId, batch.programId);
  await assertFacultyInBatch(batch.id, input.facultyId);
  await assertNoSlotClash(batch.id, input);
  const [row] = await db
    .insert(timetableSlots)
    .values({ ...input, batchId: batch.id })
    .returning();
  return row;
}

export async function updateSlot(
  batch: Batch,
  slotId: string,
  patch: Partial<SlotInput & { roomOrLink: string | null; isActive: boolean }>,
) {
  const [existing] = await db
    .select()
    .from(timetableSlots)
    .where(and(eq(timetableSlots.id, slotId), eq(timetableSlots.batchId, batch.id)));
  if (!existing) throw notFound("Timetable slot");

  const merged = { ...existing, ...patch };
  if (merged.endTime <= merged.startTime) throw badRequest("endTime must be after startTime");
  if (patch.subjectId) await assertSubjectInProgram(patch.subjectId, batch.programId);
  if (patch.facultyId) await assertFacultyInBatch(batch.id, patch.facultyId);
  if (merged.isActive) await assertNoSlotClash(batch.id, merged, slotId);

  const [row] = await db
    .update(timetableSlots)
    .set(patch)
    .where(eq(timetableSlots.id, slotId))
    .returning();
  return row;
}
