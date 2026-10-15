import { z } from "zod";
import { email, password, phone } from "./common";

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "validation.required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "validation.password_mismatch" });

export const changePasswordSchema = z
  .object({ current: z.string().min(1, "validation.required"), password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "validation.password_mismatch" })
  .refine((v) => v.password !== v.current, { path: ["password"], message: "validation.password_same" });

export const otpRequestSchema = z.object({ phone });
export const otpVerifySchema = z.object({
  phone,
  token: z.string().trim().regex(/^\d{6}$/, "validation.otp"),
});

export const totpCodeSchema = z.object({
  factorId: z.string().min(1),
  code: z.string().trim().regex(/^\d{6}$/, "validation.otp"),
});

export const reauthSchema = z.object({ password: z.string().min(1, "validation.required") });
