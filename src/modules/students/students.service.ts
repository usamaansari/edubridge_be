import { and, asc, avg, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";

import {
  attendance,
  batches,
  batchStudents,
  chapters,
  db,
  mentorAssignments,
  programs,
  studentAnalyticsSnapshots,
  subjects,
  testAttempts,
  topicPerformance,
  topics,
  userProfiles,
  users,
} from "../../db/index.js";
import { fullName, isoDaysAgo, round, toNumber } from "../../lib/dates.js";
import { notFound } from "../../lib/http-error.js";

export const WEAK_TOPIC_ACCURACY = 50;
export const STRONG_TOPIC_ACCURACY = 80;
export const MIN_ATTEMPTS_FOR_TOPIC_SIGNAL = 5;

const EXAM_TARGET: Record<string, string> = {
  jee_main: "JEE",
  jee_advanced: "JEE",
  neet: "NEET",
  board: "Board",
  foundation: "Foundation",
};

export async function getTopicPerformance(studentId: string) {
  const rows = await db
    .select({
      performance: topicPerformance,
      topicName: topics.name,
      chapterName: chapters.name,
      subjectId: subjects.id,
      subjectName: subjects.name,
      subjectCode: subjects.code,
    })
    .from(topicPerformance)
    .innerJoin(topics, eq(topics.id, topicPerformance.topicId))
    .innerJoin(chapters, eq(chapters.id, topics.chapterId))
    .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
    .where(eq(topicPerformance.studentId, studentId))
    .orderBy(asc(topicPerformance.accuracyPct));
  return rows.map(({ performance, ...names }) => ({
    ...performance,
    ...names,
    accuracyPct: toNumber(performance.accuracyPct),
    avgTimePerQSec: toNumber(performance.avgTimePerQSec),
  }));
}

export async function getAttendancePct(studentId: string, sinceIso: string) {
  const [row] = await db
    .select({
      total: count(),
      attended: sql<number>`count(case when ${attendance.status} in ('present', 'late') then 1 end)::int`,
    })
    .from(attendance)
    .where(and(eq(attendance.studentId, studentId), gte(attendance.date, sinceIso)));
  if (!row?.total) return null;
  return round((Number(row.attended) / row.total) * 100, 1);
}

/** Matches the frontend's `StudentSummary` type, plus a few extra fields. */
export async function getStudentSummary(studentId: string) {
  const [student] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      firstName: userProfiles.firstName,
      lastName: userProfiles.lastName,
      profilePicUrl: userProfiles.profilePicUrl,
    })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(eq(users.id, studentId));
  if (!student || student.role !== "student") throw notFound("Student");

  const [enrollment] = await db
    .select({
      batchId: batches.id,
      batchName: batches.name,
      classLevel: batches.classLevel,
      enrollmentNo: batchStudents.enrollmentNo,
      examType: programs.examType,
      programName: programs.name,
    })
    .from(batchStudents)
    .innerJoin(batches, eq(batches.id, batchStudents.batchId))
    .innerJoin(programs, eq(programs.id, batches.programId))
    .where(and(eq(batchStudents.studentId, studentId), eq(batchStudents.status, "active")))
    .orderBy(desc(batchStudents.enrolledAt))
    .limit(1);

  const [[scores], [snapshot], performance, attendancePct, [mentor]] = await Promise.all([
    db
      .select({
        avgPct: avg(sql`${testAttempts.score} * 100.0 / nullif(${testAttempts.maxScore}, 0)`),
        testsTaken: count(),
      })
      .from(testAttempts)
      .where(and(eq(testAttempts.studentId, studentId), isNotNull(testAttempts.submittedAt))),
    db
      .select()
      .from(studentAnalyticsSnapshots)
      .where(eq(studentAnalyticsSnapshots.studentId, studentId))
      .orderBy(desc(studentAnalyticsSnapshots.snapshotDate))
      .limit(1),
    getTopicPerformance(studentId),
    getAttendancePct(studentId, isoDaysAgo(90)),
    db
      .select({ mentorId: mentorAssignments.mentorId, firstName: userProfiles.firstName, lastName: userProfiles.lastName })
      .from(mentorAssignments)
      .leftJoin(userProfiles, eq(userProfiles.userId, mentorAssignments.mentorId))
      .where(and(eq(mentorAssignments.studentId, studentId), eq(mentorAssignments.isActive, true)))
      .limit(1),
  ]);

  const weakTopics = performance
    .filter(
      (p) =>
        p.totalQuestionsAttempted >= MIN_ATTEMPTS_FOR_TOPIC_SIGNAL &&
        (p.accuracyPct ?? 100) < WEAK_TOPIC_ACCURACY,
    )
    .slice(0, 5);

  return {
    id: student.id,
    name: fullName(student.firstName, student.lastName),
    email: student.email,
    profilePicUrl: student.profilePicUrl,
    className: enrollment ? String(enrollment.classLevel) : null,
    batch: enrollment?.batchName ?? null,
    batchId: enrollment?.batchId ?? null,
    enrollmentNo: enrollment?.enrollmentNo ?? null,
    program: enrollment?.programName ?? null,
    target: enrollment ? (EXAM_TARGET[enrollment.examType] ?? enrollment.examType) : null,
    avgScore: scores?.avgPct ? round(Number(scores.avgPct), 1) : 0,
    testsTaken: scores?.testsTaken ?? 0,
    attendance: attendancePct ?? 0,
    streak: snapshot?.streakDays ?? 0,
    isAtRisk: snapshot?.isAtRisk ?? false,
    predictedRank: snapshot?.predictedRank ?? null,
    weakTopics: weakTopics.map((t) => t.topicName),
    weakTopicDetails: weakTopics.map((t) => ({
      topicId: t.topicId,
      topicName: t.topicName,
      subjectName: t.subjectName,
      accuracyPct: t.accuracyPct,
    })),
    mentor: mentor ? { id: mentor.mentorId, name: fullName(mentor.firstName, mentor.lastName) } : null,
  };
}
