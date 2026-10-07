/**
 * Seeds a fresh database with demo data covering every role.
 * Run after migrations: `npm run db:migrate && npm run db:seed`.
 * Refuses to run when the demo super admin already exists, so it is safe to re-run.
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { env } from "../config/env.js";
import { BCRYPT_ROUNDS, generateEnrollmentNo } from "../lib/crypto.js";
import { addDays, todayIso } from "../lib/dates.js";
import { db, pool } from "./client.js";
import {
  batchFaculty,
  batches,
  batchStudents,
  chapters,
  contentItems,
  feeStructures,
  mentorAssignments,
  organisations,
  orgUsers,
  parentStudentLinks,
  programs,
  questionBank,
  questionOptions,
  type Role,
  scholarships,
  studentFees,
  subjects,
  testQuestions,
  tests,
  timetableSlots,
  topics,
  userProfiles,
  users,
} from "./schema/index.js";

const PASSWORD = process.env.SEED_PASSWORD?.trim() || "Password@123";

const isoInDays = (days: number) => addDays(new Date(), days).toISOString().slice(0, 10);

const DEMO_USERS: { key: string; email: string; phone: string; role: Role; firstName: string; lastName: string }[] = [
  { key: "admin", email: "admin@edubridge.dev", phone: "+919000000001", role: "super_admin", firstName: "Asha", lastName: "Admin" },
  { key: "centreAdmin", email: "centre.admin@edubridge.dev", phone: "+919000000002", role: "centre_admin", firstName: "Rahul", lastName: "Verma" },
  { key: "coordinator", email: "coordinator@edubridge.dev", phone: "+919000000003", role: "school_coordinator", firstName: "Neha", lastName: "Kapoor" },
  { key: "teacher", email: "teacher@edubridge.dev", phone: "+919000000004", role: "teacher", firstName: "Vikram", lastName: "Iyer" },
  { key: "mentor", email: "mentor@edubridge.dev", phone: "+919000000005", role: "mentor", firstName: "Priya", lastName: "Nair" },
  { key: "student1", email: "student1@edubridge.dev", phone: "+919000000006", role: "student", firstName: "Aarav", lastName: "Sharma" },
  { key: "student2", email: "student2@edubridge.dev", phone: "+919000000007", role: "student", firstName: "Diya", lastName: "Patel" },
  { key: "parent", email: "parent@edubridge.dev", phone: "+919000000008", role: "parent", firstName: "Sunil", lastName: "Sharma" },
];

const CURRICULUM: Record<string, { name: string; chapters: { name: string; ncertRef: string; topics: string[] }[] }> = {
  PHY: {
    name: "Physics",
    chapters: [
      { name: "Units and Measurements", ncertRef: "XI-PHY-1", topics: ["SI Units", "Dimensional Analysis", "Errors in Measurement"] },
      { name: "Motion in a Straight Line", ncertRef: "XI-PHY-2", topics: ["Displacement and Velocity", "Equations of Motion"] },
    ],
  },
  CHE: {
    name: "Chemistry",
    chapters: [
      { name: "Some Basic Concepts of Chemistry", ncertRef: "XI-CHE-1", topics: ["Mole Concept", "Stoichiometry"] },
      { name: "Structure of Atom", ncertRef: "XI-CHE-2", topics: ["Bohr Model", "Quantum Numbers"] },
    ],
  },
  MAT: {
    name: "Mathematics",
    chapters: [
      { name: "Sets", ncertRef: "XI-MAT-1", topics: ["Types of Sets", "Venn Diagrams"] },
      { name: "Trigonometric Functions", ncertRef: "XI-MAT-3", topics: ["Radian Measure", "Trigonometric Identities"] },
    ],
  },
};

async function main() {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, "admin@edubridge.dev"));
  if (existing) {
    console.log("Seed data already present (admin@edubridge.dev exists). Nothing to do.");
    return;
  }

  const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);
  const today = todayIso();

  await db.transaction(async (tx) => {
    // ---- Users
    const ids: Record<string, string> = {};
    for (const u of DEMO_USERS) {
      const [row] = await tx
        .insert(users)
        .values({ email: u.email, phone: u.phone, passwordHash, role: u.role, status: "active", emailVerified: true, phoneVerified: true })
        .returning({ id: users.id });
      ids[u.key] = row!.id;
      await tx.insert(userProfiles).values({ userId: row!.id, firstName: u.firstName, lastName: u.lastName });
    }
    const id = (key: string) => ids[key]!;

    await tx.insert(parentStudentLinks).values({
      parentUserId: id("parent"),
      studentUserId: id("student1"),
      relationship: "father",
      isPrimary: true,
    });

    // ---- Organisation
    const [org] = await tx
      .insert(organisations)
      .values({
        name: "EduBridge Demo Centre",
        type: "centre",
        code: "EBDEMO",
        addressJson: { street: "12 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001", country: "India" },
        contactEmail: "centre@edubridge.dev",
        contactPhone: "+919000000100",
        partnershipStart: today,
        status: "active",
      })
      .returning();
    await tx.insert(orgUsers).values([
      { orgId: org!.id, userId: id("centreAdmin"), roleInOrg: "admin" },
      { orgId: org!.id, userId: id("coordinator"), roleInOrg: "coordinator" },
      { orgId: org!.id, userId: id("teacher"), roleInOrg: "teacher" },
      { orgId: org!.id, userId: id("mentor"), roleInOrg: "mentor" },
    ]);

    // ---- Curriculum
    const [program] = await tx
      .insert(programs)
      .values({
        name: "JEE Main 2028 (Two-Year Program)",
        slug: "jee-main-2028",
        examType: "jee_main",
        targetClass: [11, 12],
        description: "Complete Physics, Chemistry and Mathematics preparation for JEE Main.",
        durationMonths: 24,
      })
      .returning();

    const subjectIds: Record<string, string> = {};
    const topicIds: Record<string, string[]> = {};
    const firstChapterIds: Record<string, string> = {};
    let subjectOrder = 1;
    for (const [code, subject] of Object.entries(CURRICULUM)) {
      const [subjectRow] = await tx
        .insert(subjects)
        .values({ programId: program!.id, name: subject.name, code, sequenceOrder: subjectOrder++ })
        .returning({ id: subjects.id });
      subjectIds[code] = subjectRow!.id;
      topicIds[code] = [];

      for (const [chapterIndex, chapter] of subject.chapters.entries()) {
        const [chapterRow] = await tx
          .insert(chapters)
          .values({ subjectId: subjectRow!.id, name: chapter.name, sequenceOrder: chapterIndex + 1, ncertRef: chapter.ncertRef })
          .returning({ id: chapters.id });
        if (chapterIndex === 0) firstChapterIds[code] = chapterRow!.id;

        const topicRows = await tx
          .insert(topics)
          .values(
            chapter.topics.map((name, i) => ({
              chapterId: chapterRow!.id,
              name,
              sequenceOrder: i + 1,
              difficultyTag: i === 0 ? ("easy" as const) : ("medium" as const),
              estimatedMinutes: 45,
            })),
          )
          .returning({ id: topics.id });
        topicIds[code]!.push(...topicRows.map((t) => t.id));
      }
    }

    // ---- Content: a lecture video and notes PDF for every topic
    const releasedAt = new Date();
    for (const code of Object.keys(CURRICULUM)) {
      for (const topicId of topicIds[code]!) {
        await tx.insert(contentItems).values([
          {
            topicId,
            type: "video",
            title: "Lecture",
            url: "https://example.com/videos/demo.mp4",
            durationSec: 2400,
            sequenceOrder: 1,
            isPublished: true,
            releasedAt,
            createdBy: id("teacher"),
          },
          {
            topicId,
            type: "notes",
            title: "Class Notes",
            url: "https://example.com/notes/demo.pdf",
            sequenceOrder: 2,
            isPublished: true,
            releasedAt,
            createdBy: id("teacher"),
          },
        ]);
      }
    }

    // ---- Batch
    const [batch] = await tx
      .insert(batches)
      .values({
        orgId: org!.id,
        programId: program!.id,
        name: "JEE 2028 - Batch A",
        mode: "independent",
        capacity: 60,
        startDate: isoInDays(-30),
        endDate: isoInDays(700),
        academicYear: "2026-27",
        classLevel: 11,
        status: "active",
        createdBy: id("centreAdmin"),
      })
      .returning();

    await tx.insert(batchStudents).values(
      ["student1", "student2"].map((key) => ({
        batchId: batch!.id,
        studentId: id(key),
        enrollmentNo: generateEnrollmentNo(batch!.academicYear),
      })),
    );
    await tx.insert(batchFaculty).values([
      { batchId: batch!.id, userId: id("teacher"), subjectId: subjectIds.PHY!, role: "teacher" },
      { batchId: batch!.id, userId: id("mentor"), role: "mentor" },
    ]);
    await tx.insert(timetableSlots).values(
      [1, 3, 5].map((dayOfWeek) => ({
        batchId: batch!.id,
        subjectId: subjectIds.PHY!,
        facultyId: id("teacher"),
        dayOfWeek,
        startTime: "09:00",
        endTime: "10:30",
        roomOrLink: "Room 101",
        effectiveFrom: batch!.startDate,
      })),
    );
    await tx.insert(mentorAssignments).values(
      ["student1", "student2"].map((key) => ({ mentorId: id("mentor"), studentId: id(key) })),
    );

    // ---- Question bank (approved, Physics chapter 1)
    const physicsTopics = topicIds.PHY!;
    const mcqs = [
      {
        content: "<p>The SI unit of luminous intensity is:</p>",
        options: ["Candela", "Lumen", "Lux", "Watt"],
        correct: 0,
        topic: physicsTopics[0]!,
      },
      {
        content: "<p>The dimensional formula of force is:</p>",
        options: ["[MLT<sup>-2</sup>]", "[ML<sup>2</sup>T<sup>-2</sup>]", "[MLT<sup>-1</sup>]", "[M<sup>0</sup>LT<sup>-2</sup>]"],
        correct: 0,
        topic: physicsTopics[1]!,
      },
      {
        content: "<p>Which of the following pairs has the same dimensions?</p>",
        options: ["Work and torque", "Force and power", "Momentum and energy", "Pressure and force"],
        correct: 0,
        topic: physicsTopics[1]!,
      },
    ];

    const questionIds: { id: string; type: "mcq_single" | "integer" }[] = [];
    for (const q of mcqs) {
      const [row] = await tx
        .insert(questionBank)
        .values({
          subjectId: subjectIds.PHY!,
          chapterId: firstChapterIds.PHY!,
          topicId: q.topic,
          type: "mcq_single",
          difficulty: "easy",
          contentHtml: q.content,
          solutionHtml: `<p>The correct answer is ${q.options[q.correct]}.</p>`,
          source: "EduBridge",
          tags: ["units", "dimensions"],
          createdBy: id("teacher"),
          approvedBy: id("centreAdmin"),
          isApproved: true,
        })
        .returning({ id: questionBank.id });
      await tx.insert(questionOptions).values(
        q.options.map((optionText, i) => ({ questionId: row!.id, optionText, isCorrect: i === q.correct, sequenceOrder: i + 1 })),
      );
      questionIds.push({ id: row!.id, type: "mcq_single" });
    }

    const [integerQ] = await tx
      .insert(questionBank)
      .values({
        subjectId: subjectIds.PHY!,
        chapterId: firstChapterIds.PHY!,
        topicId: physicsTopics[2]!,
        type: "integer",
        difficulty: "medium",
        contentHtml: "<p>A length is measured as 25 cm with an error of 0.5 cm. What is the percentage error?</p>",
        solutionHtml: "<p>(0.5 / 25) × 100 = 2%</p>",
        negativeMarksDefault: "0",
        createdBy: id("teacher"),
        approvedBy: id("centreAdmin"),
        isApproved: true,
      })
      .returning({ id: questionBank.id });
    await tx.insert(questionOptions).values({ questionId: integerQ!.id, optionText: "2", isCorrect: true, sequenceOrder: 1 });
    questionIds.push({ id: integerQ!.id, type: "integer" });

    // ---- A test that is live for the next week
    const now = new Date();
    const [test] = await tx
      .insert(tests)
      .values({
        name: "Units and Measurements - Chapter Test",
        type: "chapter",
        batchId: batch!.id,
        programId: program!.id,
        createdBy: id("teacher"),
        instructionsHtml: "<p>+4 for a correct answer, -1 for a wrong MCQ answer. Integer questions have no negative marking.</p>",
        durationMinutes: 30,
        markingSchemeJson: {
          sections: [
            { name: "Physics", questionType: "mcq_single", correct: 4, incorrect: -1, unattempted: 0 },
            { name: "Physics", questionType: "integer", correct: 4, incorrect: 0, unattempted: 0 },
          ],
        },
        scheduledAt: now,
        endsAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        status: "scheduled",
      })
      .returning({ id: tests.id });
    await tx.insert(testQuestions).values(
      questionIds.map((q, i) => ({
        testId: test!.id,
        questionId: q.id,
        sectionName: "Physics",
        sequenceOrder: i + 1,
        marksCorrect: "4",
        marksIncorrect: q.type === "integer" ? "0" : "-1",
      })),
    );

    // ---- Fees
    const [structure] = await tx
      .insert(feeStructures)
      .values({
        programId: program!.id,
        orgId: org!.id,
        name: "JEE 2028 - Annual Fee",
        totalAmount: "120000.00",
        installmentPlanJson: [
          { due_date: isoInDays(15), amount: 60000 },
          { due_date: isoInDays(195), amount: 60000 },
        ],
        validFrom: isoInDays(-30),
      })
      .returning();

    await tx.insert(scholarships).values({
      studentId: id("student2"),
      type: "merit",
      percentageWaiver: "10.00",
      awardedBy: id("centreAdmin"),
      notes: "Top 100 in entrance test",
    });

    await tx.insert(studentFees).values([
      {
        studentId: id("student1"),
        batchId: batch!.id,
        feeStructureId: structure!.id,
        baseAmount: "120000.00",
        netAmount: "120000.00",
        nextDueDate: isoInDays(15),
      },
      {
        studentId: id("student2"),
        batchId: batch!.id,
        feeStructureId: structure!.id,
        baseAmount: "120000.00",
        discountAmount: "12000.00",
        netAmount: "108000.00",
        nextDueDate: isoInDays(15),
      },
    ]);
  });

  console.log(`Seeded demo data into ${env.nodeEnv} database. All accounts use password "${PASSWORD}":`);
  for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(18)} ${u.email}`);
}

main()
  .catch((err) => {
    console.error("Seeding failed:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
