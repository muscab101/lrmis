import { z } from "zod";
import { ALL_PERMISSIONS, DATA_SCOPES } from "../permissions";
import { email, idempotencyKey, optionalPhone, password, uuid } from "./common";

export const USER_STATUSES = ["active", "invited", "suspended", "deleted"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

const districtScope = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  z.object({ mode: z.literal("selected"), districtIds: z.array(uuid).min(1, "validation.district_required") }),
]);
export type DistrictScopeInput = z.infer<typeof districtScope>;

const userBase = z.object({
  fullName: z.string().trim().min(2, "validation.name").max(120, "validation.too_long").regex(/^[\p{L}\p{M}\s'.-]+$/u, "validation.letters_only"),
  phone: optionalPhone,
  roleIds: z.array(uuid).min(1, "validation.role_required"),
  districts: districtScope,
});

export const createUserSchema = userBase.extend({
  email,
  idempotencyKey,
  credentials: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("password"), password }),
    z.object({ mode: z.literal("invite") }),
  ]),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = userBase.extend({ userId: uuid });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const setUserPasswordSchema = z.discriminatedUnion("mode", [
  z.object({ userId: uuid, mode: z.literal("password"), password }),
  z.object({ userId: uuid, mode: z.literal("link") }),
]);

export const userIdSchema = z.object({ userId: uuid });

export const deleteUserSchema = z.object({
  userId: uuid,
  hard: z.boolean().default(false),
  password: z.string().min(1, "validation.required"),
});

const permissionKeyEnum = z.enum(ALL_PERMISSIONS as unknown as [string, ...string[]]);

export const roleSchema = z.object({
  nameSo: z.string().trim().min(2, "validation.name").max(80, "validation.too_long"),
  nameEn: z.string().trim().min(2, "validation.name").max(80, "validation.too_long"),
  description: z.string().trim().max(500, "validation.too_long").default(""),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, "validation.colour"),
  dataScope: z.enum(DATA_SCOPES),
  permissions: z.array(permissionKeyEnum),
  limits: z
    .object({
      maxWaiverAmount: z.number().nonnegative().nullable().default(null),
      maxRefundAmount: z.number().nonnegative().nullable().default(null),
    })
    .default({ maxWaiverAmount: null, maxRefundAmount: null }),
});
export type RoleInput = z.infer<typeof roleSchema>;

export const createRoleSchema = roleSchema.extend({ idempotencyKey, copyFromRoleId: uuid.nullable().default(null) });
export const updateRoleSchema = roleSchema.extend({ roleId: uuid });
export const deleteRoleSchema = z.object({ roleId: uuid });

export const usersQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  status: z.enum([...USER_STATUSES, "any"]).default("any"),
  roleId: uuid.or(z.literal("")).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(50).default(25),
  sort: z.enum(["full_name", "email", "last_login_at", "created_at"]).default("created_at"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});
export type UsersQuery = z.infer<typeof usersQuerySchema>;
