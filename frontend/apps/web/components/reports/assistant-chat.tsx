"use client";

import { Button } from "@dhulka/ui/button";
import { ConfirmDialog } from "@dhulka/ui/dialog";
import { Textarea } from "@dhulka/ui/input";
import { History, Loader2, MessageSquarePlus, Sparkles, Trash2 } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

type Turn = { role: "user" | "assistant"; content: string };
type Chat = { id: string; title: string; updated_at: string };

/**
 * Full-page chat for the staff, admin and citizen assistants, with the person's saved chats beside it.
 * Texts come from `<namespace>.*`: title, help, placeholder, ask, disclaimer, suggestions.q1–q4,
 * notConfigured, limit, failed, offline; the history texts from `assistantHistory.*`.
 */
export function AssistantChat({ endpoint, namespace }: { endpoint: string; namespace: "assistantPage" | "adminAssistant" | "portalAssistant" }) {
  const t = useTranslations(namespace);
  const th = useTranslations("assistantHistory");
  const tc = useTranslations("common");
  const format = useFormatter();
  const locale = useLocale() as "so" | "en";
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [removing, setRemoving] = useState<Chat | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  const loadChats = useCallback(async () => {
    const res = await fetch("/api/assistant/chats").catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => ({}))) as { chats?: Chat[] }) : {};
    setChats(data.chats ?? []);
  }, []);
  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  function newChat() {
    if (busy) return;
    setChatId(null);
    setTurns([]);
    setError(null);
    setShowHistory(false);
  }

  async function openChat(id: string) {
    if (busy || id === chatId) return setShowHistory(false);
    setOpening(true);
    setError(null);
    const res = await fetch(`/api/assistant/chats/${id}`).catch(() => null);
    setOpening(false);
    const data = res?.ok ? ((await res.json().catch(() => ({}))) as { messages?: Turn[] }) : {};
    if (!data.messages) return setError(th("loadFailed"));
    setChatId(id);
    setTurns(data.messages);
    setShowHistory(false);
  }

  async function removeChat(chat: Chat) {
    const res = await fetch(`/api/assistant/chats/${chat.id}`, { method: "DELETE" }).catch(() => null);
    setRemoving(null);
    if (!res?.ok) return setError(th("deleteFailed"));
    setChats((cs) => (cs ?? []).filter((c) => c.id !== chat.id));
    if (chat.id === chatId) newChat();
  }

  async function ask(question: string) {
    if (question.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    setTurns((tt) => [...tt, { role: "user", content: question }]);
    setQ("");
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, locale, history: turns, chatId }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError(t("offline"));
    const data = (await res.json().catch(() => ({}))) as { answer?: string; chatId?: string | null; code?: string };
    if (!res.ok || !data.answer) {
      setTurns((tt) => tt.slice(0, -1));
      setQ(question);
      return setError(data.code === "NOT_CONFIGURED" ? t("notConfigured") : data.code === "RATE_LIMITED" ? t("limit") : t("failed"));
    }
    setTurns((tt) => [...tt, { role: "assistant", content: data.answer! }]);
    if (data.chatId) setChatId(data.chatId);
    void loadChats();
  }

  const history = (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <Button variant="outline" size="sm" className="w-full justify-start" onClick={newChat} disabled={busy}>
          <MessageSquarePlus aria-hidden />
          {th("newChat")}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <h2 className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">{th("title")}</h2>
        {chats === null ? (
          <Loader2 className="mx-auto mt-4 size-4 animate-spin text-muted-foreground" aria-hidden />
        ) : chats.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">{th("empty")}</p>
        ) : (
          <ul className="space-y-0.5">
            {chats.map((c) => (
              <li key={c.id} className={`group flex items-center rounded-md ${c.id === chatId ? "bg-muted" : "hover:bg-muted/60"}`}>
                <button
                  type="button"
                  onClick={() => void openChat(c.id)}
                  aria-current={c.id === chatId ? "true" : undefined}
                  className="min-w-0 flex-1 px-2 py-1.5 text-start"
                  disabled={opening}
                >
                  <span className={`block truncate text-sm ${c.id === chatId ? "font-medium" : ""}`}>{c.title}</span>
                  <span className="block text-[11px] text-muted-foreground">{format.relativeTime(new Date(c.updated_at))}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRemoving(c)}
                  aria-label={th("delete")}
                  className="me-1 rounded p-1 text-muted-foreground opacity-60 hover:bg-background hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  return (
    <div className="grid min-h-[60vh] overflow-hidden rounded-xl border bg-card md:grid-cols-[15rem_1fr]">
      <aside className={`border-b md:block md:border-e md:border-b-0 ${showHistory ? "block max-h-80" : "hidden"}`}>{history}</aside>
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2 md:hidden">
          <Button variant="ghost" size="sm" onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}>
            <History aria-hidden />
            {th("title")}
          </Button>
          <Button variant="ghost" size="sm" onClick={newChat} disabled={busy}>
            <MessageSquarePlus aria-hidden />
            {th("newChat")}
          </Button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
          {opening && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" aria-hidden />}
          {!opening && turns.length === 0 && (
            <div className="mx-auto max-w-xl py-8 text-center">
              <Sparkles className="mx-auto mb-3 size-8 text-primary" aria-hidden />
              <h2 className="text-lg font-semibold">{t("title")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("help")}</p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {(["q1", "q2", "q3", "q4"] as const).map((k) => (
                  <button key={k} type="button" onClick={() => ask(t(`suggestions.${k}`))} disabled={busy} className="rounded-lg border p-3 text-start text-sm hover:border-primary hover:bg-muted/40">
                    {t(`suggestions.${k}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!opening &&
            turns.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{m.content}</div>
              </div>
            ))}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("thinking")}
            </div>
          )}
          <div ref={end} />
        </div>
        <form
          className="space-y-2 border-t p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(q);
          }}
        >
          {error && <p className="text-sm text-status-rejected">{error}</p>}
          <div className="flex items-end gap-2">
            <Textarea
              rows={2}
              maxLength={500}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(q);
                }
              }}
              placeholder={t("placeholder")}
              aria-label={t("placeholder")}
              className="flex-1"
            />
            <Button type="submit" disabled={busy || q.trim().length < 3}>
              {t("ask")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("disclaimer")}</p>
        </form>
      </div>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={th("deleteTitle")}
        description={th("deleteBody", { title: removing?.title ?? "" })}
        confirmLabel={th("delete")}
        cancelLabel={tc("cancel")}
        destructive
        onConfirm={() => removing && void removeChat(removing)}
      />
    </div>
  );
}
