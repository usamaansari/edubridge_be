import {
  and,
  asc,
  avg,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  max,
  sql,
  sum,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import {
  attendance,
  batches,
  batchStudents,
  chapters,
  contentItems,
  db,
  doubts,
  feePayments,
  mentorAssignments,
  orgUsers,
  studentAnalyticsSnapshots,
  studentContentProgress,
  studentFees,
  subjects,
  testAttempts,
  tests,
  topicPerformance,
  topics,
  userProfiles,
  users,
} from "../../db/index.js";
import { getAccessibleBatchIds, getUserOrgIds, isSuperAdmin } from "../../lib/access.js";
import { addDays, fullName, round, toNumber, todayIso } from "../../lib/dates.js";
import type { AuthUser } from "../../middleware/auth.js";
import { visibleContent } from "../curriculum/curriculum.service.js";
import { getParentIds, notify } from "../notifications/notifications.service.js";
import {
  getStudentSummary,
  getTopicPerformance,
  MIN_ATTEMPTS_FOR_TOPIC_SIGNAL,
  STRONG_TOPIC_ACCURACY,
  WEAK_TOPIC_ACCURACY,
} from "../students/students.service.js";

const AT_RISK_SCORE_PCT = 40;
const AT_RISK_ATTENDANCE_PCT = 75;

export async function getStudentOverview(studentId: string) {
  const [summary, snapshots, topicsPerf, recentTests] = await Promise.all([
    getStudentSummary(studentId),
    listSnapshots(studentId, addDays(new Date(), -30).toISOString().slice(0, 10), todayIso()),
    getTopicPerformance(studentId),
    db
      .select({
        attemptId: testAttempts.id,
        testId: tests.id,
        testName: tests.name,
        testType: tests.type,
        score: testAttempts.score,
        maxScore: testAttempts.maxScore,
        rank: testAttempts.rankInBatch,
        percentile: testAttempts.percentile,
        submittedAt: testAttempts.submittedAt,
      })
      .from(testAttempts)
      .innerJoin(tests, eq(tests.id, testAttempts.testId))
      .where(and(eq(testAttempts.studentId, studentId), isNotNull(testAttempts.submittedAt)))
      .orderBy(desc(testAttempts.submittedAt))
      .limit(10),
  ]);

  const signal = topicsPerf.filter((t) => t.totalQuestionsAttempted >= MIN_ATTEMPTS_FOR_TOPIC_SIGNAL);
  return {
    summary,
    latestSnapshot: snapshots.at(-1) ?? null,
    snapshotTrend: snapshots,
    scoreTrend: recentTests
      .map((t) => ({
        ...t,
        score: toNumber(t.score),
        maxScore: toNumber(t.maxScore),
        percentile: toNumber(t.percentile),
        scorePct: t.maxScore && Number(t.maxScore) ? round((Number(t.score) / Number(t.maxScore)) * 100, 1) : null,
      }))
      .reverse(),
    weakTopics: signal.filter((t) => (t.accuracyPct ?? 100) < WEAK_TOPIC_ACCURACY),
    strongTopics: signal.filter((t) => (t.accuracyPct ?? 0) >= STRONG_TOPIC_ACCURACY).reverse(),
    topicPerformance: topicsPerf,
  };
}

export async function listSnapshots(studentId: string, from?: string, to?: string) {
  const conditions: SQL[] = [eq(studentAnalyticsSnapshots.studentId, studentId)];
  if (from) conditions.push(gte(studentAnalyticsSnapshots.snapshotDate, from));
  if (to) conditions.push(lte(studentAnalyticsSnapshots.snapshotDate, to));
  const rows = await db
    .select()
    .from(studentAnalyticsSnapshots)
    .where(and(...conditions))
    .orderBy(asc(studentAnalyticsSnapshots.snapshotDate));
  return rows.map((s) => ({
    ...s,
    overallScorePct: toNumber(s.overallScorePct),
    studyHoursToday: toNumber(s.studyHoursToday),
    studyHoursWeek: toNumber(s.studyHoursWeek),
    dppCompletionPct: toNumber(s.dppCompletionPct),
  }));
}

export async function getBatchAnalytics(batchId: string) {
  const studentRows = await db
    .select({ id: batchStudents.studentId, firstName: userProfiles.firstName, lastName: userProfiles.lastName })
    .from(batchStudents)
    .leftJoin(userProfiles, eq(userProfiles.userId, batchStudents.studentId))
    .where(and(eq(batchStudents.batchId, batchId), eq(batchStudents.status, "active")));
  const studentIds = studentRows.map((s) => s.id);
  const nameOf = new Map(studentRows.map((s) => [s.id, fullName(s.firstName, s.lastName)]));

  const scorePct = sql<string>`${testAttempts.score} * 100.0 / nullif(${testAttempts.maxScore}, 0)`;
  const [testStats, attendanceRows, studentAverages, weakTopics, latestSnapshots] = await Promise.all([
    db
      .select({
        testId: tests.id,
        name: tests.name,
        scheduledAt: tests.scheduledAt,
        attempts: count(testAttempts.id),
        avgScorePct: avg(scorePct),
        topScorePct: max(scorePct),
      })
      .from(tests)
      .leftJoin(testAttempts, and(eq(testAttempts.testId, tests.id), isNotNull(testAttempts.submittedAt)))
      .where(eq(tests.batchId, batchId))
      .groupBy(tests.id)
      .orderBy(asc(tests.scheduledAt)),
    db
      .select({ status: attendance.status, value: count() })
      .from(attendance)
      .where(and(eq(attendance.batchId, batchId), gte(attendance.date, addDays(new Date(), -30).toISOString().slice(0, 10))))
      .groupBy(attendance.status),
    db
      .select({ studentId: testAttempts.studentId, avgScorePct: avg(scorePct), tests: count() })
      .from(testAttempts)
      .innerJoin(tests, eq(tests.id, testAttempts.testId))
      .where(and(eq(tests.batchId, batchId), isNotNull(testAttempts.submittedAt)))
      .groupBy(testAttempts.studentId),
    studentIds.length
      ? db
          .select({
            topicId: topics.id,
            topicName: topics.name,
            subjectName: subjects.name,
            avgAccuracy: avg(topicPerformance.accuracyPct),
            students: count(),
          })
          .from(topicPerformance)
          .innerJoin(topics, eq(topics.id, topicPerformance.topicId))
          .innerJoin(chapters, eq(chapters.id, topics.chapterId))
          .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
          .where(inArray(topicPerformance.studentId, studentIds))
          .groupBy(topics.id, subjects.name)
          .orderBy(asc(avg(topicPerformance.accuracyPct)))
          .limit(10)
      : Promise.resolve([]),
    studentIds.length
      ? db
          .selectDistinctOn([studentAnalyticsSnapshots.studentId])
          .from(studentAnalyticsSnapshots)
          .where(inArray(studentAnalyticsSnapshots.studentId, studentIds))
          .orderBy(studentAnalyticsSnapshots.studentId, desc(studentAnalyticsSnapshots.snapshotDate))
      : Promise.resolve([]),
  ]);

  const totalMarked = attendanceRows.reduce((acc, r) => acc + r.value, 0);
  const attended = attendanceRows
    .filter((r) => r.status === "present" || r.status === "late")
    .reduce((acc, r) => acc + r.value, 0);

  const ranked = studentAverages
    .map((s) => ({ studentId: s.studentId, name: nameOf.get(s.studentId) ?? "", avgScorePct: round(Number(s.avgScorePct ?? 0), 1), tests: s.tests }))
    .sort((a, b) => b.avgScorePct - a.avgScorePct);

  return {
    batchId,
    studentCount: studentIds.length,
    attendancePct30d: totalMarked ? round((attended / totalMarked) * 100, 1) : null,
    tests: testStats.map((t) => ({
      ...t,
      avgScorePct: t.avgScorePct ? round(Number(t.avgScorePct), 1) : null,
      topScorePct: t.topScorePct ? round(Number(t.topScorePct), 1) : null,
      participationPct: studentIds.length ? round((t.attempts / studentIds.length) * 100, 1) : null,
    })),
    topPerformers: ranked.slice(0, 5),
    needsAttention: ranked.slice(-5).reverse(),
    weakTopics: weakTopics.map((t) => ({ ...t, avgAccuracy: t.avgAccuracy ? round(Number(t.avgAccuracy), 1) : null })),
    atRiskStudents: latestSnapshots
      .filter((s) => s.isAtRisk)
      .map((s) => ({
        studentId: s.studentId,
        name: nameOf.get(s.studentId) ?? "",
        overallScorePct: toNumber(s.overallScorePct),
        snapshotDate: s.snapshotDate,
      })),
  };
}

/**
 * Daily analytics job. Computes one snapshot per actively enrolled student for `date`
 * (idempotent upsert) and alerts mentors and parents when a student newly turns at-risk.
 * Intended to be triggered by a scheduler (cron / queue worker) once a day.
 */
export async function computeSnapshots(date = todayIso()) {
  const students = await db
    .selectDistinct({ id: batchStudents.studentId, programId: batches.programId })
    .from(batchStudents)
    .innerJoin(batches, eq(batches.id, batchStudents.batchId))
    .innerJoin(users, eq(users.id, batchStudents.studentId))
    .where(and(eq(batchStudents.status, "active"), isNull(users.deletedAt)));
  if (!students.length) return { date, computed: 0, atRisk: 0 };

  const studentIds = [...new Set(students.map((s) => s.id))];
  const programsOf = new Map<string, Set<string>>();
  for (const s of students) (programsOf.get(s.id) ?? programsOf.set(s.id, new Set()).get(s.id)!).add(s.programId);

  const weekStart = addDays(new Date(`${date}T00:00:00Z`), -6).toISOString().slice(0, 10);
  const prevDate = addDays(new Date(`${date}T00:00:00Z`), -1).toISOString().slice(0, 10);
  const attendanceSince = addDays(new Date(`${date}T00:00:00Z`), -13).toISOString().slice(0, 10);

  const submittedDay = sql`(${testAttempts.submittedAt})::date`;
  const accessedDay = sql`(${studentContentProgress.lastAccessedAt})::date`;
  const watchedSec = sql`coalesce(${contentItems.durationSec}, 0) * ${studentContentProgress.watchedPct} / 100.0`;

  const [perf, testTime, contentTime, dppDone, dppTotals, prevSnapshots, attendanceRows] = await Promise.all([
    db
      .select({
        studentId: topicPerformance.studentId,
        topicId: topicPerformance.topicId,
        subjectCode: subjects.code,
        attempted: topicPerformance.totalQuestionsAttempted,
        correct: topicPerformance.correctCount,
        accuracy: topicPerformance.accuracyPct,
      })
      .from(topicPerformance)
      .innerJoin(topics, eq(topics.id, topicPerformance.topicId))
      .innerJoin(chapters, eq(chapters.id, topics.chapterId))
      .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
      .where(inArray(topicPerformance.studentId, studentIds)),
    db
      .select({
        studentId: testAttempts.studentId,
        today: sql<string>`coalesce(sum(case when ${submittedDay} = ${date} then ${testAttempts.timeTakenSec} end), 0)`,
        week: sql<string>`coalesce(sum(${testAttempts.timeTakenSec}), 0)`,
      })
      .from(testAttempts)
      .where(
        and(
          inArray(testAttempts.studentId, studentIds),
          sql`${submittedDay} between ${weekStart} and ${date}`,
        ),
      )
      .groupBy(testAttempts.studentId),
    db
      .select({
        studentId: studentContentProgress.studentId,
        today: sql<string>`coalesce(sum(case when ${accessedDay} = ${date} then ${watchedSec} end), 0)`,
        week: sql<string>`coalesce(sum(${watchedSec}), 0)`,
      })
      .from(studentContentProgress)
      .innerJoin(contentItems, eq(contentItems.id, studentContentProgress.contentItemId))
      .where(
        and(
          inArray(studentContentProgress.studentId, studentIds),
          sql`${accessedDay} between ${weekStart} and ${date}`,
        ),
      )
      .groupBy(studentContentProgress.studentId),
    db
      .select({ studentId: studentContentProgress.studentId, programId: subjects.programId, value: count() })
      .from(studentContentProgress)
      .innerJoin(contentItems, eq(contentItems.id, studentContentProgress.contentItemId))
      .innerJoin(topics, eq(topics.id, contentItems.topicId))
      .innerJoin(chapters, eq(chapters.id, topics.chapterId))
      .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
      .where(
        and(
          inArray(studentContentProgress.studentId, studentIds),
          eq(studentContentProgress.completed, true),
          eq(contentItems.type, "dpp"),
        ),
      )
      .groupBy(studentContentProgress.studentId, subjects.programId),
    db
      .select({ programId: subjects.programId, value: count() })
      .from(contentItems)
      .innerJoin(topics, eq(topics.id, contentItems.topicId))
      .innerJoin(chapters, eq(chapters.id, topics.chapterId))
      .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
      .where(and(eq(contentItems.type, "dpp"), visibleContent()))
      .groupBy(subjects.programId),
    db
      .select({
        studentId: studentAnalyticsSnapshots.studentId,
        streakDays: studentAnalyticsSnapshots.streakDays,
        isAtRisk: studentAnalyticsSnapshots.isAtRisk,
      })
      .from(studentAnalyticsSnapshots)
      .where(and(inArray(studentAnalyticsSnapshots.studentId, studentIds), eq(studentAnalyticsSnapshots.snapshotDate, prevDate))),
    db
      .select({
        studentId: attendance.studentId,
        total: count(),
        attended: sql<number>`count(case when ${attendance.status} in ('present', 'late') then 1 end)::int`,
      })
      .from(attendance)
      .where(and(inArray(attendance.studentId, studentIds), gte(attendance.date, attendanceSince), lte(attendance.date, date)))
      .groupBy(attendance.studentId),
  ]);

  const byStudent = <T extends { studentId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) (map.get(r.studentId) ?? map.set(r.studentId, []).get(r.studentId)!).push(r);
    return map;
  };
  const perfBy = byStudent(perf);
  const testTimeBy = new Map(testTime.map((r) => [r.studentId, r]));
  const contentTimeBy = new Map(contentTime.map((r) => [r.studentId, r]));
  const dppDoneBy = byStudent(dppDone);
  const dppTotalBy = new Map(dppTotals.map((r) => [r.programId, r.value]));
  const prevBy = new Map(prevSnapshots.map((r) => [r.studentId, r]));
  const attendanceBy = new Map(attendanceRows.map((r) => [r.studentId, r]));

  const newlyAtRisk: string[] = [];
  const values = studentIds.map((studentId) => {
    const rows = perfBy.get(studentId) ?? [];
    const attempted = rows.reduce((a, r) => a + r.attempted, 0);
    const correct = rows.reduce((a, r) => a + r.correct, 0);
    const overall = attempted ? round((correct / attempted) * 100) : null;

    const subjectTotals = new Map<string, { attempted: number; correct: number }>();
    for (const r of rows) {
      const t = subjectTotals.get(r.subjectCode) ?? { attempted: 0, correct: 0 };
      t.attempted += r.attempted;
      t.correct += r.correct;
      subjectTotals.set(r.subjectCode, t);
    }
    const subjectScores = Object.fromEntries(
      [...subjectTotals].filter(([, t]) => t.attempted).map(([code, t]) => [code, round((t.correct / t.attempted) * 100)]),
    );
    const signal = rows.filter((r) => r.attempted >= MIN_ATTEMPTS_FOR_TOPIC_SIGNAL);
    const weak = signal.filter((r) => (toNumber(r.accuracy) ?? 100) < WEAK_TOPIC_ACCURACY).map((r) => r.topicId);
    const strong = signal.filter((r) => (toNumber(r.accuracy) ?? 0) >= STRONG_TOPIC_ACCURACY).map((r) => r.topicId);

    const todaySec = Number(testTimeBy.get(studentId)?.today ?? 0) + Number(contentTimeBy.get(studentId)?.today ?? 0);
    const weekSec = Number(testTimeBy.get(studentId)?.week ?? 0) + Number(contentTimeBy.get(studentId)?.week ?? 0);

    const programIds = [...(programsOf.get(studentId) ?? [])];
    const dppTotal = programIds.reduce((a, p) => a + (dppTotalBy.get(p) ?? 0), 0);
    const dppCompleted = (dppDoneBy.get(studentId) ?? [])
      .filter((r) => programIds.includes(r.programId))
      .reduce((a, r) => a + r.value, 0);

    const prev = prevBy.get(studentId);
    const streak = todaySec > 0 ? (prev?.streakDays ?? 0) + 1 : 0;

    const att = attendanceBy.get(studentId);
    const attendancePct = att?.total ? (Number(att.attended) / att.total) * 100 : null;
    const isAtRisk =
      (overall !== null && overall < AT_RISK_SCORE_PCT) ||
      (attendancePct !== null && attendancePct < AT_RISK_ATTENDANCE_PCT) ||
      weekSec === 0;
    if (isAtRisk && !prev?.isAtRisk) newlyAtRisk.push(studentId);

    return {
      studentId,
      snapshotDate: date,
      overallScorePct: overall?.toFixed(2) ?? null,
      subjectScoresJson: subjectScores,
      weakTopicsJson: weak,
      strongTopicsJson: strong,
      predictedRank: null,
      studyHoursToday: Math.min(99.99, round(todaySec / 3600)).toFixed(2),
      studyHoursWeek: Math.min(999.99, round(weekSec / 3600)).toFixed(2),
      dppCompletionPct: dppTotal ? Math.min(100, round((dppCompleted / dppTotal) * 100)).toFixed(2) : null,
      streakDays: Math.min(streak, 32767),
      isAtRisk,
    };
  });

  const CHUNK = 500;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db
      .insert(studentAnalyticsSnapshots)
      .values(values.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [studentAnalyticsSnapshots.studentId, studentAnalyticsSnapshots.snapshotDate],
        set: {
          overallScorePct: sql`excluded.overall_score_pct`,
          subjectScoresJson: sql`excluded.subject_scores_json`,
          weakTopicsJson: sql`excluded.weak_topics_json`,
          strongTopicsJson: sql`excluded.strong_topics_json`,
          studyHoursToday: sql`excluded.study_hours_today`,
          studyHoursWeek: sql`excluded.study_hours_week`,
          dppCompletionPct: sql`excluded.dpp_completion_pct`,
          streakDays: sql`excluded.streak_days`,
          isAtRisk: sql`excluded.is_at_risk`,
        },
      });
  }

  for (const studentId of newlyAtRisk) {
    const mentors = await db
      .select({ id: mentorAssignments.mentorId })
      .from(mentorAssignments)
      .where(and(eq(mentorAssignments.studentId, studentId), eq(mentorAssignments.isActive, true)));
    await notify({
      userIds: [...mentors.map((m) => m.id), ...(await getParentIds(studentId))],
      type: "at_risk",
      title: "Student flagged as at-risk",
      body: "Recent scores, attendance or study activity have dropped below the expected level.",
      data: { entity_type: "student", entity_id: studentId, snapshot_date: date },
      channels: ["push", "email"],
    });
  }

  return { date, computed: values.length, atRisk: values.filter((v) => v.isAtRisk).length, newlyAtRisk: newlyAtRisk.length };
}

export async function getAdminOverview(user: AuthUser) {
  const batchIds = await getAccessibleBatchIds(user);
  const scoped = batchIds !== null;
  if (scoped && !batchIds.length) {
    return { students: 0, activeBatches: 0, faculty: 0, upcomingTests: 0, openDoubts: 0, feesCollected: 0, feesOutstanding: 0, overdueFees: 0, atRiskStudents: 0 };
  }
  const inBatches = (column: AnyPgColumn) => (scoped ? inArray(column, batchIds) : undefined);

  const studentIdsQuery = db
    .selectDistinct({ id: batchStudents.studentId })
    .from(batchStudents)
    .where(and(eq(batchStudents.status, "active"), inBatches(batchStudents.batchId)));

  const orgIds = isSuperAdmin(user) ? null : await getUserOrgIds(user.id);

  const [[students], [activeBatches], [faculty], [upcomingTests], [openDoubts], [collected], [outstanding], [overdue], atRisk] =
    await Promise.all([
      db.select({ value: count() }).from(studentIdsQuery.as("s")),
      db
        .select({ value: count() })
        .from(batches)
        .where(and(eq(batches.status, "active"), inBatches(batches.id))),
      db
        .select({ value: sql<number>`count(distinct ${orgUsers.userId})::int` })
        .from(orgUsers)
        .where(
          and(
            isNull(orgUsers.leftAt),
            inArray(orgUsers.roleInOrg, ["teacher", "mentor"]),
            orgIds ? (orgIds.length ? inArray(orgUsers.orgId, orgIds) : sql`false`) : undefined,
          ),
        ),
      db
        .select({ value: count() })
        .from(tests)
        .where(and(eq(tests.status, "scheduled"), sql`${tests.scheduledAt} > now()`, inBatches(tests.batchId))),
      db
        .select({ value: count() })
        .from(doubts)
        .where(and(inArray(doubts.status, ["open", "assigned"]), scoped ? inArray(doubts.studentId, studentIdsQuery) : undefined)),
      db
        .select({ value: sum(feePayments.amount) })
        .from(feePayments)
        .innerJoin(studentFees, eq(studentFees.id, feePayments.studentFeeId))
        .where(inBatches(studentFees.batchId)),
      db
        .select({ value: sum(sql`${studentFees.netAmount} - ${studentFees.amountPaid}`) })
        .from(studentFees)
        .where(and(inArray(studentFees.status, ["pending", "partial", "overdue"]), inBatches(studentFees.batchId))),
      db
        .select({ value: count() })
        .from(studentFees)
        .where(and(eq(studentFees.status, "overdue"), inBatches(studentFees.batchId))),
      db
        .selectDistinctOn([studentAnalyticsSnapshots.studentId], {
          studentId: studentAnalyticsSnapshots.studentId,
          isAtRisk: studentAnalyticsSnapshots.isAtRisk,
        })
        .from(studentAnalyticsSnapshots)
        .where(scoped ? inArray(studentAnalyticsSnapshots.studentId, studentIdsQuery) : undefined)
        .orderBy(studentAnalyticsSnapshots.studentId, desc(studentAnalyticsSnapshots.snapshotDate)),
    ]);

  return {
    students: students?.value ?? 0,
    activeBatches: activeBatches?.value ?? 0,
    faculty: faculty?.value ?? 0,
    upcomingTests: upcomingTests?.value ?? 0,
    openDoubts: openDoubts?.value ?? 0,
    feesCollected: toNumber(collected?.value) ?? 0,
    feesOutstanding: toNumber(outstanding?.value) ?? 0,
    overdueFees: overdue?.value ?? 0,
    atRiskStudents: atRisk.filter((r) => r.isAtRisk).length,
  };
}
