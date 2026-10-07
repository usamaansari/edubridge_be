import { and, asc, count, eq, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import {
  batches,
  batchStudents,
  chapters,
  contentItems,
  db,
  studentContentProgress,
  subjects,
  topics,
} from "../../db/index.js";
import { round } from "../../lib/dates.js";

/** Content a student is allowed to see: published, released and not deleted. */
export function visibleContent(): SQL {
  return and(
    eq(contentItems.isPublished, true),
    isNull(contentItems.deletedAt),
    or(isNull(contentItems.releasedAt), lte(contentItems.releasedAt, new Date())),
  )!;
}

type Stats = { total: number; completed: number };

export async function contentStatsByTopic(topicIds: string[], studentId?: string) {
  const stats = new Map<string, Stats>();
  if (!topicIds.length) return stats;
  const completedExpr = studentId
    ? sql<number>`count(case when ${studentContentProgress.completed} then 1 end)::int`
    : sql<number>`0`;
  const rows = await db
    .select({ topicId: contentItems.topicId, total: count(contentItems.id), completed: completedExpr })
    .from(contentItems)
    .leftJoin(
      studentContentProgress,
      studentId
        ? and(
            eq(studentContentProgress.contentItemId, contentItems.id),
            eq(studentContentProgress.studentId, studentId),
          )
        : sql`false`,
    )
    .where(and(inArray(contentItems.topicId, topicIds), visibleContent()))
    .groupBy(contentItems.topicId);
  for (const row of rows) stats.set(row.topicId, { total: row.total, completed: Number(row.completed) });
  return stats;
}

const pct = ({ total, completed }: Stats) => (total ? round((completed / total) * 100, 1) : 0);

function sumStats(items: Stats[]): Stats {
  return items.reduce((acc, s) => ({ total: acc.total + s.total, completed: acc.completed + s.completed }), {
    total: 0,
    completed: 0,
  });
}

/** Builds subject → chapter → topic trees with content counts and (for students) progress. */
export async function buildCurriculumTree(
  subjectIds: string[],
  options: { studentId?: string; includeInactive?: boolean } = {},
) {
  if (!subjectIds.length) return [];

  const subjectRows = await db
    .select()
    .from(subjects)
    .where(inArray(subjects.id, subjectIds))
    .orderBy(asc(subjects.sequenceOrder));

  const chapterConditions: SQL[] = [inArray(chapters.subjectId, subjectIds)];
  if (!options.includeInactive) chapterConditions.push(eq(chapters.isActive, true));
  const chapterRows = await db
    .select()
    .from(chapters)
    .where(and(...chapterConditions))
    .orderBy(asc(chapters.sequenceOrder));

  const chapterIds = chapterRows.map((c) => c.id);
  const topicConditions: SQL[] = chapterIds.length
    ? [inArray(topics.chapterId, chapterIds)]
    : [sql`false`];
  if (!options.includeInactive) topicConditions.push(eq(topics.isActive, true));
  const topicRows = chapterIds.length
    ? await db
        .select()
        .from(topics)
        .where(and(...topicConditions))
        .orderBy(asc(topics.sequenceOrder))
    : [];

  const stats = await contentStatsByTopic(
    topicRows.map((t) => t.id),
    options.studentId,
  );
  const empty: Stats = { total: 0, completed: 0 };

  return subjectRows.map((subject) => {
    const subjectChapters = chapterRows
      .filter((c) => c.subjectId === subject.id)
      .map((chapter) => {
        const chapterTopics = topicRows
          .filter((t) => t.chapterId === chapter.id)
          .map((topic) => {
            const s = stats.get(topic.id) ?? empty;
            return { ...topic, contentCount: s.total, completedCount: s.completed, progress: pct(s) };
          });
        const s = sumStats(chapterTopics.map((t) => ({ total: t.contentCount, completed: t.completedCount })));
        return { ...chapter, topics: chapterTopics, contentCount: s.total, progress: pct(s) };
      });
    const s = sumStats(
      subjectChapters.flatMap((c) => c.topics.map((t) => ({ total: t.contentCount, completed: t.completedCount }))),
    );
    return { ...subject, chapters: subjectChapters, contentCount: s.total, progress: pct(s) };
  });
}

export async function getStudentProgramIds(studentId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ programId: batches.programId })
    .from(batchStudents)
    .innerJoin(batches, eq(batches.id, batchStudents.batchId))
    .where(and(eq(batchStudents.studentId, studentId), eq(batchStudents.status, "active")));
  return rows.map((r) => r.programId);
}
