import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar } from "./harness";

let db: PGlite;
let mine: string;
let other: string;

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const admin = await bootstrapSuperAdmin(db);
  mine = await createStaff(db, admin, "cashier@gmail.com", ["cashier"], [hodan]);
  other = await createStaff(db, admin, "registrar@gmail.com", ["registrar"], [hodan]);
});

describe("assistant chat history", () => {
  it("each person keeps their own chats; nobody else reads or adds to them", async () => {
    const chat = await asUser(db, mine, (tx) => scalar<string>(tx, `insert into public.assistant_chats (title) values ('How do I close my shift?') returning id`));
    await asUser(db, mine, (tx) => tx.query(`insert into public.assistant_messages (chat_id, role, content) values ($1, 'user', 'How do I close my shift?'), ($1, 'assistant', 'Open Cashier…')`, [chat]));
    expect(await asUser(db, mine, (tx) => scalar<number>(tx, `select count(*)::int from public.assistant_messages where chat_id = $1`, [chat]))).toBe(2);

    expect(await asUser(db, other, (tx) => scalar<number>(tx, `select count(*)::int from public.assistant_chats`))).toBe(0);
    expect(await asUser(db, other, (tx) => scalar<number>(tx, `select count(*)::int from public.assistant_messages`))).toBe(0);
    await expect(asUser(db, other, (tx) => tx.query(`insert into public.assistant_messages (chat_id, role, content) values ($1, 'user', 'hi')`, [chat]))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, other, (tx) => tx.query(`insert into public.assistant_chats (user_id, title) values ($1, 'x')`, [mine]))).rejects.toThrow(/row-level security/);
    await asUser(db, other, (tx) => tx.query(`delete from public.assistant_chats where id = $1`, [chat]));
    expect(await scalar<number>(db, `select count(*)::int from public.assistant_chats where id = $1`, [chat])).toBe(1);
  });

  it("messages can't be edited; deleting a chat removes its messages", async () => {
    const chat = await asUser(db, mine, (tx) => scalar<string>(tx, `insert into public.assistant_chats (title) values ('Bills') returning id`));
    await asUser(db, mine, (tx) => tx.query(`insert into public.assistant_messages (chat_id, role, content) values ($1, 'user', 'Bills?')`, [chat]));
    await expect(asUser(db, mine, (tx) => tx.query(`update public.assistant_messages set content = 'x' where chat_id = $1`, [chat]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, mine, (tx) => tx.query(`update public.assistant_chats set user_id = $2 where id = $1`, [chat, other]))).rejects.toThrow(/permission denied/);
    await asUser(db, mine, (tx) => tx.query(`update public.assistant_chats set title = 'Bills and payments' where id = $1`, [chat]));
    await asUser(db, mine, (tx) => tx.query(`delete from public.assistant_chats where id = $1`, [chat]));
    expect(await scalar<number>(db, `select count(*)::int from public.assistant_messages where chat_id = $1`, [chat])).toBe(0);
  });
});
