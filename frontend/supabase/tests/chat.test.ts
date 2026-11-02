import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asUser, bootstrapSuperAdmin, createAuthUser, createDb, createStaff, scalar } from "./harness";

let db: PGlite;
let admin: string;
let amina: string;
let bashir: string;
let cali: string;
let hodan: string;
let direct: string;
let group: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}
const send = (user: string, c: string, body: string | null, path: string | null = null, kind: string | null = null) =>
  asUser(db, user, (tx) => scalar<string>(tx, `select public.chat_send($1, $2, $3, $4, 'file.png')`, [c, body, path, kind]));
const list = (user: string) => asUser(db, user, (tx) => tx.query<{ id: string; name: string; unread: number; last_body: string | null }>(`select * from public.chat_list()`));

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  amina = await createStaff(db, admin, "amina@gmail.com", ["print_officer"], [hodan]);
  bashir = await createStaff(db, admin, "bashir@gmail.com", ["cashier"], [hodan]);
  cali = await createStaff(db, admin, "cali@gmail.com", ["surveyor"], [hodan]);
});

describe("staff chat", () => {
  it("one chat per pair, whoever opens it", async () => {
    direct = await asUser(db, amina, (tx) => scalar<string>(tx, `select public.chat_open_direct($1)`, [bashir]));
    expect(await asUser(db, bashir, (tx) => scalar<string>(tx, `select public.chat_open_direct($1)`, [amina]))).toBe(direct);
    await expectError(asUser(db, amina, (tx) => tx.query(`select public.chat_open_direct($1)`, [amina])), "VALIDATION: chat_person");
  });

  it("citizens cannot use it or be added", async () => {
    const citizen = await createAuthUser(db, { email: "citizen@gmail.com" });
    await expectError(asUser(db, citizen, (tx) => tx.query(`select * from public.chat_list()`)), "PERMISSION_DENIED");
    await expectError(asUser(db, amina, (tx) => tx.query(`select public.chat_open_direct($1)`, [citizen])), "VALIDATION: chat_person");
  });

  it("messages reach the other person: unread count, and one bell notice until read", async () => {
    await send(amina, direct, "Salaan");
    await send(amina, direct, "Ma joogtaa?");
    const b = (await list(bashir)).rows[0]!;
    expect(b).toMatchObject({ id: direct, unread: 2, last_body: "Ma joogtaa?" });
    const bell = () => scalar<number>(db, `select count(*)::int from public.notifications where user_id = $1 and kind = 'chat.message' and read_at is null`, [bashir]);
    expect(await bell()).toBe(1);
    await asUser(db, bashir, (tx) => tx.query(`select public.chat_mark_read($1)`, [direct]));
    expect((await list(bashir)).rows[0]!.unread).toBe(0);
    expect(await bell()).toBe(0);
    expect((await list(amina)).rows[0]!.unread).toBe(0);
  });

  it("nobody outside can read or write, not even an administrator; no direct writes", async () => {
    await expectError(send(cali, direct, "hello"), "NOT_FOUND");
    await expectError(asUser(db, admin, (tx) => tx.query(`select * from public.chat_messages_page($1)`, [direct])), "NOT_FOUND");
    expect((await asUser(db, cali, (tx) => tx.query(`select * from public.chat_messages`))).rows).toHaveLength(0);
    expect((await asUser(db, admin, (tx) => tx.query(`select * from public.chat_messages`))).rows).toHaveLength(0);
    await expect(asUser(db, amina, (tx) => tx.query(`insert into public.chat_messages (conversation_id, sender_id, body) values ($1, $2, 'x')`, [direct, amina]))).rejects.toThrow();
    await expect(as(db, "anon", {}, (tx) => tx.query(`select * from public.chat_list()`))).rejects.toThrow();
  });

  it("groups: made, added to, left; only the maker removes others", async () => {
    await expectError(asUser(db, amina, (tx) => tx.query(`select public.chat_create_group('x', $1)`, [[bashir]])), "VALIDATION: chat_group_name");
    await expectError(asUser(db, amina, (tx) => tx.query(`select public.chat_create_group('Kooxda', $1)`, [[amina]])), "VALIDATION: chat_members");
    group = await asUser(db, amina, (tx) => scalar<string>(tx, `select public.chat_create_group('Kooxda Hodan', $1)`, [[bashir]]));
    await send(bashir, group, "Group hello");
    expect((await list(amina)).rows.find((r) => r.id === group)).toMatchObject({ name: "Kooxda Hodan", unread: 1 });
    await asUser(db, bashir, (tx) => tx.query(`select public.chat_add_members($1, $2)`, [group, [cali]]));
    await send(cali, group, "Waan imid");
    await expectError(asUser(db, bashir, (tx) => tx.query(`select public.chat_remove_member($1, $2)`, [group, cali])), "PERMISSION_DENIED");
    await asUser(db, amina, (tx) => tx.query(`select public.chat_remove_member($1, $2)`, [group, cali]));
    await expectError(send(cali, group, "still here?"), "NOT_FOUND");
    await asUser(db, bashir, (tx) => tx.query(`select public.chat_remove_member($1, $2)`, [group, bashir]));
    expect((await list(bashir)).rows.some((r) => r.id === group)).toBe(false);
  });

  it("files stay in their chat's folder; messages can't be empty", async () => {
    const path = `${direct}/11111111-1111-4111-8111-111111111111.png`;
    await send(amina, direct, null, path, "image");
    await expectError(send(amina, direct, null, `${group}/11111111-1111-4111-8111-111111111111.png`, "image"), "VALIDATION: chat_file");
    await expectError(send(amina, direct, null, `${direct}/../secret.png`, "image"), "VALIDATION: chat_file");
    await expectError(send(amina, direct, null, path, "pdf"), "VALIDATION: chat_file");
    await expectError(send(amina, direct, "   "), "VALIDATION: chat_empty");
  });

  it("only the sender takes a message back, and its content is gone for everyone", async () => {
    const id = await send(amina, direct, "Khalad");
    await expectError(asUser(db, bashir, (tx) => tx.query(`select public.chat_delete_message($1)`, [id])), "PERMISSION_DENIED");
    await asUser(db, amina, (tx) => tx.query(`select public.chat_delete_message($1)`, [id]));
    const rows = await asUser(db, bashir, (tx) => tx.query<{ id: string; body: string | null; deleted: boolean }>(`select * from public.chat_messages_page($1)`, [direct]));
    expect(rows.rows.find((r) => r.id === id)).toMatchObject({ body: null, deleted: true });
    expect(await scalar<string | null>(db, `select coalesce(body, 'gone') from public.chat_messages where id = $1`, [id])).toBe("gone");
  });

  it("the sender can edit a message for 5 minutes, and the others see it was edited", async () => {
    const id = await send(amina, direct, "Waan iman");
    const edit = (user: string, body: string) => asUser(db, user, (tx) => tx.query(`select public.chat_edit_message($1, $2)`, [id, body]));
    await expectError(edit(bashir, "Not mine"), "PERMISSION_DENIED");
    await expectError(edit(cali, "Not my chat"), "NOT_FOUND");
    await expectError(edit(amina, "   "), "VALIDATION: chat_empty");
    await edit(amina, "Waan imanayaa");
    const rows = await asUser(db, bashir, (tx) => tx.query<{ id: string; body: string | null; edited: boolean }>(`select * from public.chat_messages_page($1)`, [direct]));
    expect(rows.rows.find((r) => r.id === id)).toMatchObject({ body: "Waan imanayaa", edited: true });
    await db.query(`update public.chat_messages set created_at = now() - interval '5 minutes 1 second' where id = $1`, [id]);
    await expectError(edit(amina, "Too late"), "CONFLICT: chat_edit_expired");
    await asUser(db, amina, (tx) => tx.query(`select public.chat_delete_message($1)`, [id]));
    const fresh = await send(amina, direct, "Fresh");
    await asUser(db, amina, (tx) => tx.query(`select public.chat_delete_message($1)`, [fresh]));
    await expectError(asUser(db, amina, (tx) => tx.query(`select public.chat_edit_message($1, 'x')`, [fresh])), "CONFLICT: chat_edit_expired");
  });

  it("deleting a direct chat removes it from my list only; a new message brings it back without the old ones", async () => {
    await send(amina, direct, "Before deleting");
    await asUser(db, bashir, (tx) => tx.query(`select public.chat_delete($1)`, [direct]));
    expect((await list(bashir)).rows.some((r) => r.id === direct)).toBe(false);
    expect((await list(amina)).rows.some((r) => r.id === direct)).toBe(true);
    await send(amina, direct, "After deleting");
    expect((await list(bashir)).rows.find((r) => r.id === direct)).toMatchObject({ last_body: "After deleting", unread: 1 });
    const seen = await asUser(db, bashir, (tx) => tx.query<{ body: string | null }>(`select * from public.chat_messages_page($1)`, [direct]));
    expect(seen.rows.map((r) => r.body)).toEqual(["After deleting"]);
    const kept = await asUser(db, amina, (tx) => tx.query<{ body: string | null }>(`select * from public.chat_messages_page($1)`, [direct]));
    expect(kept.rows.map((r) => r.body)).toContain("Before deleting");
    await asUser(db, bashir, (tx) => tx.query(`select public.chat_delete($1)`, [direct]));
    expect(await asUser(db, bashir, (tx) => scalar<string>(tx, `select public.chat_open_direct($1)`, [amina]))).toBe(direct);
    expect((await list(bashir)).rows.some((r) => r.id === direct)).toBe(true);
  });

  it("only the maker deletes a group, for everyone; its notices clear and nobody can read it after", async () => {
    const g = await asUser(db, amina, (tx) => scalar<string>(tx, `select public.chat_create_group('Kooxda Tirtir', $1)`, [[bashir]]));
    await send(amina, g, "Hello group");
    await expectError(asUser(db, bashir, (tx) => tx.query(`select public.chat_delete($1)`, [g])), "PERMISSION_DENIED");
    await expectError(asUser(db, cali, (tx) => tx.query(`select public.chat_delete($1)`, [g])), "NOT_FOUND");
    await asUser(db, amina, (tx) => tx.query(`select public.chat_delete($1)`, [g]));
    for (const u of [amina, bashir]) expect((await list(u)).rows.some((r) => r.id === g)).toBe(false);
    await expectError(send(bashir, g, "still here?"), "NOT_FOUND");
    await expectError(asUser(db, bashir, (tx) => tx.query(`select * from public.chat_messages_page($1)`, [g])), "NOT_FOUND");
    expect((await asUser(db, bashir, (tx) => tx.query(`select * from public.chat_messages where conversation_id = $1`, [g]))).rows).toHaveLength(0);
    expect(await scalar<number>(db, `select count(*)::int from public.notifications where link = $1 and read_at is null`, [`/chat?c=${g}`])).toBe(0);
    expect(await scalar<number>(db, `select count(*)::int from public.chat_messages where conversation_id = $1`, [g])).toBe(1);
  });
});
