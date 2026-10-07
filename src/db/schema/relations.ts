import { relations } from "drizzle-orm";

import { questionBank, questionOptions, testQuestions, tests } from "./assessments.js";
import { chapters, contentItems, programs, subjects, topics } from "./curriculum.js";
import { doubtReplies, doubts } from "./mentorship.js";
import { userProfiles, users } from "./users.js";

export const usersRelations = relations(users, ({ one }) => ({
  profile: one(userProfiles, { fields: [users.id], references: [userProfiles.userId] }),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, { fields: [userProfiles.userId], references: [users.id] }),
}));

export const programsRelations = relations(programs, ({ many }) => ({
  subjects: many(subjects),
}));

export const subjectsRelations = relations(subjects, ({ one, many }) => ({
  program: one(programs, { fields: [subjects.programId], references: [programs.id] }),
  chapters: many(chapters),
}));

export const chaptersRelations = relations(chapters, ({ one, many }) => ({
  subject: one(subjects, { fields: [chapters.subjectId], references: [subjects.id] }),
  topics: many(topics),
}));

export const topicsRelations = relations(topics, ({ one, many }) => ({
  chapter: one(chapters, { fields: [topics.chapterId], references: [chapters.id] }),
  contentItems: many(contentItems),
}));

export const contentItemsRelations = relations(contentItems, ({ one }) => ({
  topic: one(topics, { fields: [contentItems.topicId], references: [topics.id] }),
}));

export const questionBankRelations = relations(questionBank, ({ many }) => ({
  options: many(questionOptions),
}));

export const questionOptionsRelations = relations(questionOptions, ({ one }) => ({
  question: one(questionBank, {
    fields: [questionOptions.questionId],
    references: [questionBank.id],
  }),
}));

export const testsRelations = relations(tests, ({ many }) => ({
  questions: many(testQuestions),
}));

export const testQuestionsRelations = relations(testQuestions, ({ one }) => ({
  test: one(tests, { fields: [testQuestions.testId], references: [tests.id] }),
  question: one(questionBank, {
    fields: [testQuestions.questionId],
    references: [questionBank.id],
  }),
}));

export const doubtsRelations = relations(doubts, ({ many }) => ({
  replies: many(doubtReplies),
}));

export const doubtRepliesRelations = relations(doubtReplies, ({ one }) => ({
  doubt: one(doubts, { fields: [doubtReplies.doubtId], references: [doubts.id] }),
}));
