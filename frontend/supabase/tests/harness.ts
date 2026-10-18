/**
 * Runs the real migrations in an in-process Postgres (PGlite) with a minimal stand-in for
 * Supabase's `auth` schema and API roles, with real PostGIS and pg_trgm extensions.
 */
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { postgis } from "@electric-sql/pglite-postgis";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
grant anon, authenticated, service_role to postgres;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  phone text unique,
  raw_app_meta_data jsonb not null default '{}',
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade);
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, factor_type text, status text);

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
-- Supabase lets every API role use the extensions schema (PostGIS types and functions).
create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
alter default privileges in schema extensions grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

function adaptForPglite(sql: string): string {
  // Supabase-only bits that PGlite doesn't have.
  return sql.replace(/alter publication supabase_realtime[^;]*;/gi, "select 1;");
}

export async function createDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm, postgis } });
  await db.exec(SUPABASE_STUB);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    try {
      await db.exec(adaptForPglite(readFileSync(join(MIGRATIONS_DIR, file), "utf8")));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return db;
}

export interface Claims {
  sub?: string;
  aal?: "aal1" | "aal2";
  iat?: number;
  role?: string;
}

type Tx = Transaction;

/** Run `fn` as an API role with the given JWT claims, inside a transaction that commits. */
export async function as<T>(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
  claims: Claims,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const full = { role, iat: Math.floor(Date.now() / 1000), ...claims };
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(full)]);
    await tx.query(
      `select set_config('request.headers', $1, true)`,
      [JSON.stringify({ "x-client-ip": "203.0.113.7", "x-request-id": randomUUID() })],
    );
    await tx.exec(`set local role ${role}`);
    return fn(tx);
  });
}

export const asUser = <T>(db: PGlite, sub: string, fn: (tx: Tx) => Promise<T>, aal: "aal1" | "aal2" = "aal2") =>
  as(db, "authenticated", { sub, aal }, fn);

export const asService = <T>(db: PGlite, fn: (tx: Tx) => Promise<T>) => as(db, "service_role", {}, fn);

/** Simulates `auth.admin.createUser` (the profile is created by the trigger). */
export async function createAuthUser(
  db: PGlite,
  opts: { email?: string; phone?: string; kind?: "staff"; fullName?: string },
): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into auth.users (email, phone, raw_app_meta_data, raw_user_meta_data)
     values ($1, $2, $3, $4) returning id`,
    [
      opts.email ?? null,
      opts.phone ?? null,
      JSON.stringify(opts.kind ? { kind: opts.kind } : {}),
      JSON.stringify({ full_name: opts.fullName ?? "" }),
    ],
  );
  return res.rows[0]!.id;
}

export async function scalar<T>(tx: Tx | PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const res = await tx.query<Record<string, T>>(sql, params);
  const row = res.rows[0];
  if (!row) throw new Error(`no rows: ${sql}`);
  return Object.values(row)[0] as T;
}

export async function roleId(db: PGlite, key: string): Promise<string> {
  return scalar<string>(db, `select id from public.roles where key = $1`, [key]);
}

/** Fresh Super Admin (bootstrapped through the real setup RPC). */
export async function bootstrapSuperAdmin(db: PGlite, email = "boss@gmail.com"): Promise<string> {
  const id = await createAuthUser(db, { email, kind: "staff", fullName: "Boss" });
  await asService(db, (tx) => tx.query(`select public.setup_bootstrap_super_admin($1, 'Boss', false)`, [id]));
  return id;
}

/** Staff user with the given system role keys, scoped to districts (or all). */
export async function createStaff(
  db: PGlite,
  admin: string,
  email: string,
  roleKeys: string[],
  districtIds: string[] | "all",
): Promise<string> {
  const id = await createAuthUser(db, { email, kind: "staff" });
  const roleIds = (await db.query<{ id: string }>(`select id from public.roles where key = any($1)`, [roleKeys])).rows.map((r) => r.id);
  await asUser(db, admin, (tx) =>
    tx.query(`select public.admin_provision_user($1, $2, null, $3::uuid[], $4, $5::uuid[], false)`, [
      id,
      email,
      roleIds,
      districtIds === "all",
      districtIds === "all" ? [] : districtIds,
    ]),
  );
  return id;
}

/** A square polygon as GeoJSON around (lon, lat) with half-size `d` degrees. */
export function square(lon: number, lat: number, d = 0.002) {
  return {
    type: "Polygon",
    coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]],
  };
}

/**
 * Since migration 0042 only surveyors (and admins) create owners and land. Tests about other
 * steps (fees, surveys, valuation, …) still set up their data through a clerk; this gives the
 * clerk roles back the two create rights inside that test database only.
 */
export async function letClerksCreate(db: PGlite): Promise<void> {
  await db.query(
    `insert into public.role_permissions (role_id, permission_key)
     select r.id, k from public.roles r, unnest(array['owners.create', 'applications.create']) k
      where r.key in ('front_desk_clerk', 'data_entry_clerk')
     on conflict do nothing`,
  );
}
