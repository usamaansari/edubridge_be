import { assertCanViewStudent } from "../../lib/access.js";
import { ApiModule } from "../../lib/api-module.js";
import { idParams } from "../../lib/validation.js";
import { getStudentSummary } from "./students.service.js";

export const studentsModule = new ApiModule("Students", "/students");

studentsModule.get(
  "/:id",
  {
    summary: "Student summary",
    description:
      "Matches the frontend's `StudentSummary`: name, class, batch, target exam, average score, attendance, streak and weak topics. Visible to the student, their parents, mentor, faculty and admins.",
    params: idParams,
  },
  async ({ user, params }) => {
    await assertCanViewStudent(user, params.id);
    return getStudentSummary(params.id);
  },
);
