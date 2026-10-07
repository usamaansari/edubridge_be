import { ADMIN_ROLES, assertOrgAccess } from "../../lib/access.js";
import { ApiModule } from "../../lib/api-module.js";
import { idParams } from "../../lib/validation.js";
import {
  createUserBody,
  listUsersQuery,
  updateProfileBody,
  updateStatusBody,
  updateUserBody,
} from "./users.schemas.js";
import {
  assertCanManageRole,
  assertCanViewUser,
  createUser,
  getUserDetail,
  listUsers,
  setUserStatus,
  updateOwnProfile,
  updateUser,
} from "./users.service.js";

export const usersModule = new ApiModule("Users", "/users");

usersModule
  .get("/me", { summary: "Get my account and profile" }, ({ user }) => getUserDetail(user.id))
  .patch(
    "/me",
    {
      summary: "Update my profile",
      description: "Changing the phone number resets `phoneVerified`.",
      body: updateProfileBody,
    },
    ({ user, body }) => updateOwnProfile(user.id, body),
  )
  .get(
    "/",
    { summary: "List users", roles: ADMIN_ROLES, query: listUsersQuery },
    async ({ user, query }) => {
      if (query.orgId) await assertOrgAccess(user, query.orgId, false);
      return listUsers(query);
    },
  )
  .post(
    "/",
    {
      summary: "Create a user",
      description:
        "Creates a user with a profile, optionally adding them to an organisation. Centre admins cannot create super or centre admins.",
      roles: ADMIN_ROLES,
      body: createUserBody,
      status: 201,
    },
    async ({ user, body }) => {
      assertCanManageRole(user, body.role);
      if (body.orgId) await assertOrgAccess(user, body.orgId);
      return createUser(body);
    },
  )
  .get(
    "/:id",
    { summary: "Get a user", roles: ADMIN_ROLES, params: idParams },
    async ({ user, params }) => {
      await assertCanViewUser(user, params.id);
      return getUserDetail(params.id);
    },
  )
  .patch(
    "/:id",
    { summary: "Update a user", roles: ADMIN_ROLES, params: idParams, body: updateUserBody },
    ({ user, params, body }) => updateUser(user, params.id, body),
  )
  .patch(
    "/:id/status",
    {
      summary: "Activate or suspend a user",
      description: "Suspending revokes all of the user's refresh tokens.",
      roles: ADMIN_ROLES,
      params: idParams,
      body: updateStatusBody,
    },
    ({ user, params, body }) => setUserStatus(user, params.id, body.status),
  )
  .delete(
    "/:id",
    {
      summary: "Soft-delete a user",
      description: "Sets status to `deleted` and stamps `deleted_at`. Rows are never hard-deleted.",
      roles: ADMIN_ROLES,
      params: idParams,
    },
    async ({ user, params }) => {
      await setUserStatus(user, params.id, "deleted");
    },
  );
