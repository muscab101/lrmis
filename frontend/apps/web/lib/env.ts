import { z } from "zod";

/**
 * Public env (safe in the browser). Read lazily so `next build` works without a project
 * configured; the first request that needs Supabase fails with a clear message instead.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type PublicEnv = z.infer<typeof publicSchema>;

let cached: PublicEnv | null = null;

export function publicEnv(): PublicEnv {
  if (cached) return cached;
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED,
  });
  if (!parsed.success) {
    throw new Error(
      `Missing or invalid public environment variables: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}. See .env.example.`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Env values that must never reach the browser. */
export function serverEnv() {
  const schema = z.object({
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
    SETUP_TOKEN: z.string().min(16).optional(),
  });
  const parsed = schema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SETUP_TOKEN: process.env.SETUP_TOKEN || undefined,
  });
  if (!parsed.success) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing. See .env.example.");
  }
  return parsed.data;
}
