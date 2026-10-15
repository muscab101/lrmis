import "server-only";
import { codeFromDbMessage, type ActionResult, type AppError, type ErrorCode } from "@dhulka/core/errors";
import type { User } from "@supabase/supabase-js";
import type { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { log } from "./log";
import { requestContext } from "./request";

/** Throw from inside an action to return a typed, translated error to the UI. */
export class AppFailure extends Error {
  constructor(
    public code: ErrorCode,
    public values?: Record<string, string | number>,
    public fieldErrors?: Record<string, string[]>,
  ) {
    super(code);
  }
}

export function fail(code: ErrorCode, values?: Record<string, string | number>): never {
  throw new AppFailure(code, values);
}

interface DbError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/** Unwrap a Supabase response; map RPC error codes (e.g. "ROLE_IN_USE: 2") to AppFailure. */
export function unwrap<T>(res: { data: T; error: DbError | null }, context: string): T {
  if (res.error) {
    const code = codeFromDbMessage(res.error.message);
    if (code) {
      const detail = res.error.message.split(": ").slice(1).join(": ");
      throw new AppFailure(code, detail ? { detail } : undefined);
    }
    throw new Error(`${context}: ${res.error.message}`);
  }
  return res.data;
}

export interface ActionContext {
  requestId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User;
}

function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

interface Options {
  /** Allow calls without a signed-in user (login, OTP, setup). */
  public?: boolean;
}

type Handler<I, O> = (input: I, ctx: ActionContext) => Promise<O>;
type PublicHandler<I, O> = (input: I, ctx: Omit<ActionContext, "user"> & { user: User | null }) => Promise<O>;

/**
 * Wraps a server action: validates input with the shared Zod schema, checks the session,
 * turns every failure into an `ActionResult` with a request id, and logs unexpected errors.
 * Authorisation itself happens in Postgres (RPC + RLS) — this layer never trusts the client.
 */
export function defineAction<S extends z.ZodType, O>(
  name: string,
  schema: S,
  handler: Handler<z.infer<S>, O>,
): (input: z.input<S>) => Promise<ActionResult<O>>;
export function defineAction<S extends z.ZodType, O>(
  name: string,
  schema: S,
  handler: PublicHandler<z.infer<S>, O>,
  options: Options & { public: true },
): (input: z.input<S>) => Promise<ActionResult<O>>;
export function defineAction<S extends z.ZodType, O>(
  name: string,
  schema: S,
  handler: Handler<z.infer<S>, O> | PublicHandler<z.infer<S>, O>,
  options: Options = {},
) {
  return async (input: z.input<S>): Promise<ActionResult<O>> => {
    const { requestId } = await requestContext();
    const error = (code: ErrorCode, extra?: Partial<AppError>): ActionResult<O> => ({
      ok: false,
      error: { code, requestId, ...extra },
    });

    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return error("VALIDATION", { fieldErrors: zodFieldErrors(parsed.error) });
    }

    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user && !options.public) return error("UNAUTHENTICATED");
      const data = await (handler as PublicHandler<z.infer<S>, O>)(parsed.data, { requestId, supabase, user });
      return { ok: true, data };
    } catch (err) {
      if (err instanceof AppFailure) {
        log("warn", "action.failed", { requestId, action: name, code: err.code, values: err.values });
        return error(err.code, {
          ...(err.values ? { values: err.values } : {}),
          ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}),
        });
      }
      // Next.js control flow (redirect/notFound) must propagate.
      if (err instanceof Error && "digest" in err && typeof err.digest === "string" && err.digest.startsWith("NEXT_")) {
        throw err;
      }
      log("error", "action.crashed", {
        requestId,
        action: name,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      return error("UNKNOWN");
    }
  };
}

/**
 * Idempotent wrapper for create actions: the same client key returns the first result
 * (double-click or network retry never creates a duplicate).
 */
export async function withIdempotency<T>(
  ctx: ActionContext,
  key: string,
  actionName: string,
  run: () => Promise<T>,
): Promise<T> {
  const begin = unwrap(
    await ctx.supabase.rpc("idempotency_begin", { p_key: key, p_action: actionName }),
    "idempotency_begin",
  ) as { state: "new" | "pending" | "done"; result?: T };
  if (begin.state === "done") return begin.result as T;
  if (begin.state === "pending") fail("DUPLICATE_SUBMISSION");
  try {
    const result = await run();
    await ctx.supabase.rpc("idempotency_finish", { p_key: key, p_result: result as never });
    return result;
  } catch (err) {
    await ctx.supabase.rpc("idempotency_abort", { p_key: key });
    throw err;
  }
}
