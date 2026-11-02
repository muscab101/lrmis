"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Checkbox } from "@dhulka/ui/form-controls";
import { Field } from "@dhulka/ui/field";
import { Input, Textarea } from "@dhulka/ui/input";
import { cn } from "@dhulka/ui/lib/cn";
import {
  ArrowLeft,
  Image as ImageIcon,
  MessageSquarePlus,
  Paperclip,
  Send,
  Trash2,
  UserPlus,
  Users,
  Video,
  X,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  chatAddMembersAction,
  chatCreateGroupAction,
  chatDeleteAction,
  chatDeleteMessageAction,
  chatDirectoryAction,
  chatListAction,
  chatMarkReadAction,
  chatMembersAction,
  chatMessagesAction,
  chatOpenDirectAction,
  chatPrepareUploadAction,
  chatRemoveMemberAction,
  chatSendAction,
  type ChatMessage,
  type ChatPerson,
  type ChatRow,
} from "@/app/[locale]/(staff)/chat/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { FormError } from "@/components/forms/form-error";
import { createClient } from "@/lib/supabase/client";

/** Tick people from the staff list, with a search. */
function PeoplePicker({
  picked,
  onChange,
  exclude = [],
}: {
  picked: string[];
  onChange: (ids: string[]) => void;
  exclude?: string[];
}) {
  const t = useTranslations("chat");
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<ChatPerson[]>([]);
  useEffect(() => {
    let live = true;
    const h = setTimeout(
      () => void chatDirectoryAction({ q }).then((r) => live && r.ok && setPeople(r.data)),
      200,
    );
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [q]);
  const shown = people.filter((p) => !exclude.includes(p.user_id));
  return (
    <div className="space-y-2">
      <Input
        value={q}
        placeholder={t("searchStaff")}
        aria-label={t("searchStaff")}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
        {shown.length === 0 && (
          <li className="text-muted-foreground p-3 text-sm">{t("noStaff")}</li>
        )}
        {shown.map((p) => (
          <li key={p.user_id}>
            <label className="hover:bg-muted/40 flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm">
              <Checkbox
                checked={picked.includes(p.user_id)}
                onCheckedChange={(c) =>
                  onChange(
                    c === true ? [...picked, p.user_id] : picked.filter((x) => x !== p.user_id),
                  )
                }
              />
              <span className="min-w-0">
                <span className="block truncate">{p.full_name || p.email}</span>
                <span className="text-muted-foreground block truncate text-xs">{p.email}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

const LINK_REUSE_MS = 50 * 60 * 1000; // the signed links last an hour

/** The whole page: the list of chats, and the open chat. On a phone, one at a time. */
export function ChatApp({ me, initial }: { me: string; initial: string | null }) {
  const t = useTranslations("chat");
  const format = useFormatter();
  const [chats, setChats] = useState<ChatRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(initial);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [more, setMore] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [dialog, setDialog] = useState<"direct" | "group" | "members" | "delete" | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [deleteBody, setDeleteBody] = useState("");
  const [members, setMembers] = useState<ChatPerson[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<string | null>(null);
  // Each load signs new links; keeping the first one stops pictures reloading and videos restarting.
  const linksRef = useRef(new Map<string, { url: string; at: number }>());
  const fileRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(openId);
  openRef.current = openId;
  const open = chats?.find((c) => c.id === openId) ?? null;

  const loadChats = useCallback(async () => {
    const r = await chatListAction({});
    if (r.ok) setChats(r.data);
  }, []);

  const loadMessages = useCallback(
    async (id: string, scroll: boolean) => {
      const r = await chatMessagesAction({ conversationId: id, before: null });
      if (!r.ok && r.error.code === "NOT_FOUND" && openRef.current === id) {
        // The group was closed, or I was taken out of it, while it was open here.
        setOpenId(null);
        window.history.replaceState(null, "", "?");
        void loadChats();
        return;
      }
      if (!r.ok || openRef.current !== id) return;
      const now = Date.now();
      const rows = r.data.map((m) => {
        if (!m.file_url) return m;
        const kept = linksRef.current.get(m.id);
        if (kept && now - kept.at < LINK_REUSE_MS) return { ...m, file_url: kept.url };
        linksRef.current.set(m.id, { url: m.file_url, at: now });
        return m;
      });
      setMessages((cur) => {
        // Keep older pages already loaded.
        const fresh = new Set(rows.map((m) => m.id));
        const first = rows[0]?.created_at ?? "";
        return [...cur.filter((m) => !fresh.has(m.id) && m.created_at < first), ...rows];
      });
      setMore(r.data.length === 50);
      // A new message only moves the view for someone already at the bottom, not someone reading back.
      const box = scrollRef.current;
      const atBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 120;
      const lastId = r.data.at(-1)?.id ?? null;
      const isNew = lastId !== lastIdRef.current;
      lastIdRef.current = lastId;
      if (scroll || (isNew && atBottom)) {
        setTimeout(() => endRef.current?.scrollIntoView({ block: "end" }), 30);
      }
      // A chat left open in a hidden tab hasn't been read yet.
      if (document.visibilityState === "visible") await chatMarkReadAction({ conversationId: id });
      void loadChats();
    },
    [loadChats],
  );

  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  useEffect(() => {
    setMessages([]);
    lastIdRef.current = null;
    setError(null);
    setFile(null);
    if (!openId) return;
    void loadMessages(openId, true);
    window.history.replaceState(null, "", `?c=${openId}`);
  }, [openId, loadMessages]);

  // New messages arrive live; the database only sends each person those of their own chats. A slow check covers a dropped connection.
  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      void loadChats();
      if (openRef.current) void loadMessages(openRef.current, false);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const channel = supabase
      .channel(`chat:${me}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, refresh)
      .subscribe();
    const slow = setInterval(refresh, 20000);
    return () => {
      clearInterval(slow);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [me, loadChats, loadMessages]);

  async function send() {
    if (!openId || sending || (!text.trim() && !file)) return;
    setSending(true);
    setError(null);
    try {
      let sent: { path: string; kind: "image" | "video"; name: string } | null = null;
      if (file) {
        const prep = await chatPrepareUploadAction({
          conversationId: openId,
          type: file.type,
          size: file.size,
        });
        if (!prep.ok) return setError(prep.error);
        const up = await createClient()
          .storage.from(prep.data.bucket)
          .uploadToSignedUrl(prep.data.path, prep.data.token, file, { contentType: file.type });
        if (up.error)
          return setError({
            code: "VALIDATION",
            requestId: "upload",
            values: { detail: "chat_upload_failed" },
          });
        sent = { path: prep.data.path, kind: prep.data.kind, name: file.name };
      }
      const r = await chatSendAction({ conversationId: openId, body: text, file: sent });
      if (!r.ok) return setError(r.error);
      setText("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await loadMessages(openId, true);
    } finally {
      setSending(false);
    }
  }

  const older = async () => {
    const first = messages[0];
    if (!openId || !first) return;
    const r = await chatMessagesAction({ conversationId: openId, before: first.created_at });
    if (!r.ok) return;
    setMessages((cur) => [...r.data, ...cur]);
    setMore(r.data.length === 50);
  };

  const openMembers = async () => {
    if (!openId) return;
    const r = await chatMembersAction({ conversationId: openId });
    if (r.ok) setMembers(r.data);
    setPicked([]);
    setDialog("members");
  };

  const when = (s: string) => {
    const d = new Date(s);
    return Date.now() - d.getTime() < 86400000
      ? format.dateTime(d, { timeStyle: "short" })
      : format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  };
  const preview = (c: ChatRow) =>
    c.last_body ??
    (c.last_file_kind === "image"
      ? t("anImage")
      : c.last_file_kind === "video"
        ? t("aVideo")
        : t("noMessages"));

  return (
    <div className="bg-card -mx-4 -my-8 flex h-[calc(100dvh-4rem)] overflow-hidden border-y sm:-mx-6 lg:-mx-10">
      {/* The list of chats */}
      <aside
        className={cn("flex w-full shrink-0 flex-col border-e md:w-80", openId && "hidden md:flex")}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <h1 className="font-semibold">{t("title")}</h1>
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="outline"
              aria-label={t("newChat")}
              onClick={() => {
                setPicked([]);
                setDialog("direct");
              }}
            >
              <MessageSquarePlus aria-hidden />
              {t("newChat")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-label={t("newGroup")}
              onClick={() => {
                setPicked([]);
                setGroupName("");
                setDialog("group");
              }}
            >
              <Users aria-hidden />
              {t("newGroup")}
            </Button>
          </div>
        </div>
        <ul className="flex-1 divide-y overflow-y-auto">
          {chats?.length === 0 && (
            <li className="text-muted-foreground p-4 text-sm">{t("noChats")}</li>
          )}
          {chats?.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpenId(c.id)}
                className={cn(
                  "hover:bg-muted/50 flex w-full items-center gap-3 px-3 py-2.5 text-start",
                  c.id === openId && "bg-muted",
                )}
              >
                <span className="bg-primary-soft text-primary grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold">
                  {c.kind === "group" ? (
                    <Users className="size-4" aria-hidden />
                  ) : (
                    c.name.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{c.name}</span>
                    <span className="text-muted-foreground shrink-0 text-[11px]">
                      {when(c.last_message_at)}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground truncate text-xs">{preview(c)}</span>
                    {c.unread > 0 && (
                      <span className="bg-primary text-primary-foreground grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1 text-[11px] font-semibold">
                        {c.unread}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* The open chat */}
      <section className={cn("flex min-w-0 flex-1 flex-col", !openId && "hidden md:flex")}>
        {!openId ? (
          <p className="text-muted-foreground m-auto p-6 text-center text-sm">{t("pickChat")}</p>
        ) : (
          <>
            <header className="flex items-center gap-2 border-b p-3">
              <Button
                size="icon-sm"
                variant="ghost"
                className="md:hidden"
                aria-label={t("back")}
                onClick={() => setOpenId(null)}
              >
                <ArrowLeft aria-hidden />
              </Button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-semibold">{open?.name ?? ""}</h2>
                {open?.kind === "group" && (
                  <p className="text-muted-foreground text-xs">
                    {t("memberCount", { count: open.member_count })}
                  </p>
                )}
              </div>
              {open?.kind === "group" && (
                <Button size="sm" variant="outline" onClick={() => void openMembers()}>
                  <Users aria-hidden />
                  {t("members")}
                </Button>
              )}
              {open && (open.kind === "direct" || open.created_by === me) && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-danger shrink-0"
                  aria-label={t("deleteChat")}
                  title={t("deleteChat")}
                  onClick={() => {
                    setDeleteBody(
                      open.kind === "group" ? t("deleteGroupBody") : t("deleteChatBody"),
                    );
                    setDialog("delete");
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </header>
            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
              {more && (
                <div className="text-center">
                  <Button size="sm" variant="ghost" onClick={() => void older()}>
                    {t("older")}
                  </Button>
                </div>
              )}
              {messages.map((m) => {
                const mine = m.sender_id === me;
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "group flex items-end gap-1",
                      mine ? "justify-end" : "justify-start",
                    )}
                  >
                    {mine && !m.deleted && (
                      <button
                        type="button"
                        aria-label={t("deleteMessage")}
                        className="text-muted-foreground hover:text-danger p-1 focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                        onClick={() =>
                          void chatDeleteMessageAction({ id: m.id }).then(() => {
                            if (openId) void loadMessages(openId, false);
                          })
                        }
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    )}
                    <div
                      className={cn(
                        "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                        mine ? "bg-primary text-primary-foreground" : "bg-muted",
                      )}
                    >
                      {!mine && open?.kind === "group" && (
                        <p className="text-primary mb-0.5 text-xs font-semibold">{m.sender_name}</p>
                      )}
                      {m.deleted ? (
                        <p className="italic opacity-70">{t("deleted")}</p>
                      ) : (
                        <>
                          {m.file_kind === "image" && m.file_url && (
                            <a href={m.file_url} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element -- private storage link */}
                              <img
                                src={m.file_url}
                                alt={m.file_name ?? ""}
                                className="mb-1 max-h-72 rounded-md object-contain"
                              />
                            </a>
                          )}
                          {m.file_kind === "video" && m.file_url && (
                            <video
                              src={m.file_url}
                              controls
                              preload="metadata"
                              className="mb-1 max-h-72 max-w-full rounded-md"
                            />
                          )}
                          {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                        </>
                      )}
                      <p
                        className={cn(
                          "mt-0.5 text-end text-[10px]",
                          mine ? "opacity-70" : "text-muted-foreground",
                        )}
                      >
                        {when(m.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
            <footer className="space-y-2 border-t p-3">
              <FormError error={error} />
              {file && (
                <div className="bg-muted flex items-center gap-2 rounded-md px-3 py-1.5 text-sm">
                  {file.type.startsWith("video/") ? (
                    <Video className="size-4 shrink-0" aria-hidden />
                  ) : (
                    <ImageIcon className="size-4 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("removeFile")}
                    onClick={() => {
                      setFile(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
                  aria-label={t("attach")}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <Button
                  size="icon-sm"
                  variant="outline"
                  className="size-10"
                  aria-label={t("attach")}
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip aria-hidden />
                </Button>
                <Textarea
                  rows={1}
                  value={text}
                  maxLength={4000}
                  placeholder={t("placeholder")}
                  aria-label={t("placeholder")}
                  className="max-h-32 min-h-10 flex-1 resize-none"
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <Button
                  className="size-10 p-0"
                  loading={sending}
                  disabled={!text.trim() && !file}
                  aria-label={t("send")}
                  onClick={() => void send()}
                >
                  {!sending && <Send aria-hidden />}
                </Button>
              </div>
              {sending && file && <p className="text-muted-foreground text-xs">{t("uploading")}</p>}
            </footer>
          </>
        )}
      </section>

      <FormDialog
        open={dialog === "direct"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("newChat")}
        description={t("newChatBody")}
        confirmLabel={t("startChat")}
        submit={async () => {
          const r = await chatOpenDirectAction({ userId: picked[0] ?? "" });
          if (r.ok) {
            await loadChats();
            setOpenId(r.data);
          }
          return r;
        }}
      >
        {() => <PeoplePicker picked={picked} onChange={(ids) => setPicked(ids.slice(-1))} />}
      </FormDialog>

      <FormDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("deleteChat")}
        description={deleteBody}
        confirmLabel={t("deleteChat")}
        destructive
        submit={() => chatDeleteAction({ conversationId: openId ?? "" })}
        onDone={() => {
          setOpenId(null);
          window.history.replaceState(null, "", "?");
          void loadChats();
        }}
      />

      <FormDialog
        open={dialog === "group"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("newGroup")}
        description={t("newGroupBody")}
        confirmLabel={t("createGroup")}
        submit={async () => {
          const r = await chatCreateGroupAction({ name: groupName, members: picked });
          if (r.ok) {
            await loadChats();
            setOpenId(r.data);
          }
          return r;
        }}
      >
        {(fe) => (
          <>
            <Field id="group-name" label={t("groupName")} error={fe("name")} required>
              <Input
                value={groupName}
                maxLength={80}
                onChange={(e) => setGroupName(e.target.value)}
              />
            </Field>
            <Field id="group-people" label={t("members")} error={fe("members")} required>
              <PeoplePicker picked={picked} onChange={setPicked} />
            </Field>
          </>
        )}
      </FormDialog>

      <FormDialog
        open={dialog === "members"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={open?.name ?? ""}
        description={t("membersBody")}
        confirmLabel={t("addPeople")}
        submit={async () => {
          const r = await chatAddMembersAction({ conversationId: openId ?? "", members: picked });
          if (r.ok) await loadChats();
          return r;
        }}
      >
        {() => (
          <>
            <ul className="divide-y rounded-md border">
              {members.map((p) => (
                <li
                  key={p.user_id}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {p.full_name || p.email}
                    {p.user_id === me && (
                      <span className="text-muted-foreground"> ({t("you")})</span>
                    )}
                  </span>
                  {(p.user_id === me || open?.created_by === me) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={async () => {
                        const r = await chatRemoveMemberAction({
                          conversationId: openId ?? "",
                          userId: p.user_id,
                        });
                        if (!r.ok) return;
                        await loadChats();
                        if (p.user_id === me) {
                          setDialog(null);
                          setOpenId(null);
                          window.history.replaceState(null, "", "?");
                        } else setMembers((cur) => cur.filter((x) => x.user_id !== p.user_id));
                      }}
                    >
                      {p.user_id === me ? t("leave") : t("remove")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <UserPlus className="size-4" aria-hidden />
              {t("addPeople")}
            </p>
            <PeoplePicker
              picked={picked}
              onChange={setPicked}
              exclude={members.map((m) => m.user_id)}
            />
          </>
        )}
      </FormDialog>
    </div>
  );
}
