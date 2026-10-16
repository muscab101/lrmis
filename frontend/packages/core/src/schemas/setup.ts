import { z } from "zod";
import { email, password } from "./common";

export const setupSchema = z
  .object({
    setupToken: z.string().min(16, "validation.required"),
    fullName: z.string().trim().min(2, "validation.name"),
    email,
    password,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "validation.password_mismatch" });
