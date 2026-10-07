import { z } from "zod";

import { genderEnum, roleEnum, userStatusEnum } from "../../db/index.js";
import {
  addressSchema,
  booleanish,
  email,
  isoDate,
  paginationQuery,
  password,
  personName,
  phone,
  url,
} from "../../lib/validation.js";

export const profileFields = {
  firstName: personName,
  lastName: personName,
  dob: isoDate.nullable(),
  gender: z.enum(genderEnum.enumValues).nullable(),
  addressJson: addressSchema.nullable(),
  profilePicUrl: url.nullable(),
  bio: z.string().trim().max(2000).nullable(),
};

export const updateProfileBody = z
  .object({ ...profileFields, phone })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field" });

export const listUsersQuery = paginationQuery.extend({
  role: z.enum(roleEnum.enumValues).optional(),
  status: z.enum(userStatusEnum.enumValues).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  orgId: z.uuid().optional(),
  batchId: z.uuid().optional(),
  includeDeleted: booleanish.optional(),
});

export const createUserBody = z.object({
  ...profileFields,
  dob: profileFields.dob.optional(),
  gender: profileFields.gender.optional(),
  addressJson: profileFields.addressJson.optional(),
  profilePicUrl: profileFields.profilePicUrl.optional(),
  bio: profileFields.bio.optional(),
  email,
  phone,
  password,
  role: z.enum(roleEnum.enumValues),
  status: z.enum(["pending", "active"]).optional(),
  orgId: z.uuid().optional(),
  roleInOrg: z.enum(["admin", "coordinator", "teacher", "mentor"]).optional(),
});

export const updateUserBody = z
  .object({ ...profileFields, email, phone, password, role: z.enum(roleEnum.enumValues) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field" });

export const updateStatusBody = z.object({
  status: z.enum(["pending", "active", "suspended"]),
});
