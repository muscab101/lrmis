import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asUser, bootstrapSuperAdmin, createDb, createStaff, scalar } from "./harness";

let db: PGlite;
let admin: string;
let amina: string;
let bashir: string;
const REC = "11111111-1111-4111-8111-111111111111";

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}
const save = (user: string, rec: string, seq: number, path: string | null, pages: unknown[] = []) =>
  asUser(db, user, (tx) => tx.query(`select public.recording_save($1, $2, $3, 100, $4)`, [rec, seq, path, JSON.stringify(pages)]));

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  amina = await createStaff(db, admin, "amina@gmail.com", ["print_officer"], [hodan]);
  bashir = await createStaff(db, admin, "bashir@gmail.com", ["cashier"], [hodan]);
  // Recording is switched off on the live system (0259); these checks are about recording when it is on.
  await db.query(`update public.settings set value = 'true'::jsonb where key = 'security.staff_recording'`);
});

describe("recording switched off (0259)", () => {
  it("keeps nothing, and the staff screen is told not to record", async () => {
    await db.query(`update public.settings set value = 'false'::jsonb where key = 'security.staff_recording'`);
    const OFF = "44444444-4444-4444-8444-444444444444";
    expect(await asUser(db, amina, (tx) => scalar<boolean>(tx, `select public.recording_save($1, 0, null, 0, '[]')`, [OFF]))).toBe(false);
    expect(await scalar<number>(db, `select count(*)::int from public.staff_recordings where id = $1`, [OFF])).toBe(0);
    expect(await asUser(db, amina, (tx) => scalar<boolean>(tx, `select public.staff_recording_on()`))).toBe(false);
    await db.query(`update public.settings set value = 'true'::jsonb where key = 'security.staff_recording'`);
    expect(await asUser(db, amina, (tx) => scalar<boolean>(tx, `select public.staff_recording_on()`))).toBe(true);
  });
});

describe("test login", () => {
  it("only a super admin, never on a super admin or themselves, and it is logged", async () => {
    await expectError(asUser(db, amina, (tx) => tx.query(`select public.admin_test_login_start($1)`, [bashir])), "PERMISSION_DENIED");
    await expectError(asUser(db, admin, (tx) => tx.query(`select public.admin_test_login_start($1)`, [admin])), "CONFLICT: test_login_super_admin");
    expect(await asUser(db, admin, (tx) => scalar<string>(tx, `select public.admin_test_login_start($1)`, [amina]))).toBe("amina@gmail.com");
    expect(await scalar<number>(db, `select count(*)::int from public.audit_log where action = 'test_login.start' and record_id = $1 and actor_id = $2`, [amina, admin])).toBe(1);
  });
});

describe("watching live", () => {
  const LIVE = "33333333-3333-4333-8333-333333333333";
  it("only a super admin; it needs nothing from the person, tells their browser to send faster, and is logged", async () => {
    await save(bashir, LIVE, 0, `${bashir}/${LIVE}/0.json.gz`);
    await expectError(asUser(db, amina, (tx) => tx.query(`select * from public.staff_live_list()`)), "PERMISSION_DENIED");
    await expectError(asUser(db, amina, (tx) => tx.query(`select public.recording_live_pieces($1)`, [bashir])), "PERMISSION_DENIED");
    const online = await asUser(db, admin, (tx) => tx.query<{ user_id: string }>(`select * from public.staff_live_list()`));
    expect(online.rows.map((r) => r.user_id)).toContain(bashir);
    expect(await asUser(db, bashir, (tx) => scalar<boolean>(tx, `select public.recording_save($1, 1, null, 0, '[]')`, [LIVE]))).toBe(false);

    const first = await asUser(db, admin, (tx) => scalar<{ recording: string; pieces: { seq: number; path: string }[] }>(tx, `select public.recording_live_pieces($1)`, [bashir]));
    expect(first).toMatchObject({ recording: LIVE, pieces: [{ seq: 0, path: `${bashir}/${LIVE}/0.json.gz` }] });
    expect(await asUser(db, bashir, (tx) => scalar<boolean>(tx, `select public.recording_save($1, 1, null, 0, '[]')`, [LIVE]))).toBe(true);

    await save(bashir, LIVE, 1, `${bashir}/${LIVE}/1.json.gz`);
    const next = await asUser(db, admin, (tx) => scalar<{ pieces: { seq: number }[] }>(tx, `select public.recording_live_pieces($1, $2, 0)`, [bashir, LIVE]));
    expect(next.pieces.map((p) => p.seq)).toEqual([1]);
    // One log entry for the watch, not one for each look.
    expect(await scalar<number>(db, `select count(*)::int from public.audit_log where action = 'recording.watch_live' and record_id = $1`, [bashir])).toBe(1);
    await db.query(`delete from public.staff_recordings where id = $1`, [LIVE]);
  });

  it("someone who left isn't listed", async () => {
    const gone = await asUser(db, admin, (tx) => scalar<{ recording: string | null }>(tx, `select public.recording_live_pieces($1)`, [bashir]));
    expect(gone.recording).toBeNull();
    const online = await asUser(db, admin, (tx) => tx.query<{ user_id: string }>(`select * from public.staff_live_list()`));
    expect(online.rows.map((r) => r.user_id)).not.toContain(bashir);
  });
});

describe("work recording", () => {
  it("saves pieces only in the person's own folder, and only for their own recording", async () => {
    await save(amina, REC, 0, `${amina}/${REC}/0.json.gz`, [{ path: "/parcels", at: new Date().toISOString() }]);
    await expectError(save(amina, REC, 1, `${bashir}/${REC}/1.json.gz`), "VALIDATION: recording_path");
    await expectError(save(bashir, REC, 1, `${bashir}/${REC}/1.json.gz`), "PERMISSION_DENIED");
    await expect(as(db, "anon", {}, (tx) => tx.query(`select public.recording_save($1, 0, null, 0, '[]')`, [REC]))).rejects.toThrow();
  });

  it("nobody reads the tables directly; only a super admin watches, and watching is logged", async () => {
    for (const u of [amina, bashir, admin]) {
      expect((await asUser(db, u, (tx) => tx.query(`select * from public.staff_recordings`))).rows).toHaveLength(0);
    }
    await expectError(asUser(db, amina, (tx) => tx.query(`select * from public.recording_watch($1)`, [REC])), "PERMISSION_DENIED");
    await expectError(asUser(db, amina, (tx) => tx.query(`select * from public.staff_recordings_of($1)`, [amina])), "PERMISSION_DENIED");
    const rows = await asUser(db, admin, (tx) => tx.query<{ recording_watch: string }>(`select * from public.recording_watch($1)`, [REC]));
    expect(rows.rows.map((r) => r.recording_watch)).toEqual([`${amina}/${REC}/0.json.gz`]);
    expect(await scalar<number>(db, `select count(*)::int from public.audit_log where action = 'recording.watch' and record_id = $1`, [REC])).toBe(1);
  });

  it("activity shows the day's pages and actions, for those allowed", async () => {
    await expectError(asUser(db, amina, (tx) => tx.query(`select * from public.staff_activity_list()`)), "PERMISSION_DENIED");
    const list = await asUser(db, admin, (tx) => tx.query<{ user_id: string; pages: number }>(`select * from public.staff_activity_list()`));
    expect(list.rows.find((r) => r.user_id === amina)?.pages).toBe(1);
    const day = await asUser(db, admin, (tx) => tx.query<{ kind: string; what: string }>(`select * from public.staff_activity_timeline($1)`, [amina]));
    expect(day.rows).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "page", what: "/parcels" }), expect.objectContaining({ kind: "test", what: "test_login.start" })]));
  });

  it("past 30 days the files are listed for removal, then forgotten; signed-in users can't call this", async () => {
    await db.query(`update public.staff_recording_chunks set at = now() - interval '31 days'`);
    await db.query(`update public.staff_recordings set last_at = now() - interval '31 days'`);
    await expect(asUser(db, admin, (tx) => tx.query(`select * from public.recording_expired()`))).rejects.toThrow();
    await expect(asUser(db, admin, (tx) => tx.query(`select public.recording_forget($1)`, [[`x`]]))).rejects.toThrow();
    const paths = await db.query<{ recording_expired: string }>(`select * from public.recording_expired()`);
    expect(paths.rows.map((r) => r.recording_expired)).toEqual([`${amina}/${REC}/0.json.gz`]);
    await db.query(`select public.recording_forget($1)`, [paths.rows.map((r) => r.recording_expired)]);
    expect(await scalar<number>(db, `select count(*)::int from public.staff_recordings`)).toBe(0);
  });
});
