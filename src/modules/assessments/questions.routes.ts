import { ADMIN_ROLES, AUTHOR_ROLES, STAFF_ROLES } from "../../lib/access.js";
import { ApiModule } from "../../lib/api-module.js";
import { idParams } from "../../lib/validation.js";
import {
  createQuestionBody,
  listQuestionsQuery,
  updateQuestionBody,
} from "./assessments.schemas.js";
import {
  createQuestion,
  getQuestionOrThrow,
  listQuestions,
  setApproval,
  softDeleteQuestion,
  updateQuestion,
} from "./questions.service.js";

export const questionsModule = new ApiModule(
  "Question Bank",
  "/questions",
  "Questions with LaTeX-capable HTML, options and solutions.",
);

questionsModule
  .get(
    "/",
    { summary: "Search the question bank", roles: STAFF_ROLES, query: listQuestionsQuery },
    ({ user, query }) => listQuestions(user, query),
  )
  .post(
    "/",
    {
      summary: "Create a question",
      description:
        "Options are stored in order (A, B, C, …). Integer questions use a single correct option holding the numeric answer. Questions created by admins are auto-approved.",
      roles: AUTHOR_ROLES,
      body: createQuestionBody,
      status: 201,
    },
    ({ user, body }) => createQuestion(user, body),
  )
  .get(
    "/:id",
    { summary: "Get a question with options and solution", roles: STAFF_ROLES, params: idParams },
    ({ params }) => getQuestionOrThrow(params.id),
  )
  .patch(
    "/:id",
    {
      summary: "Update a question",
      description: "Sending `options` replaces all options. Non-admin edits reset approval.",
      roles: AUTHOR_ROLES,
      params: idParams,
      body: updateQuestionBody,
    },
    ({ user, params, body }) => updateQuestion(user, params.id, body),
  )
  .post(
    "/:id/approve",
    { summary: "Approve a question", roles: ADMIN_ROLES, params: idParams },
    ({ user, params }) => setApproval(user, params.id, true),
  )
  .post(
    "/:id/unapprove",
    { summary: "Withdraw approval", roles: ADMIN_ROLES, params: idParams },
    ({ user, params }) => setApproval(user, params.id, false),
  )
  .delete(
    "/:id",
    { summary: "Soft-delete a question", roles: AUTHOR_ROLES, params: idParams },
    async ({ user, params }) => {
      await softDeleteQuestion(user, params.id);
    },
  );
