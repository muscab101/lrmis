"use client";

import { Button } from "@dhulka/ui/button";
import { Textarea } from "@dhulka/ui/input";
import { Loader2, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

type Turn = { role: "user" | "assistant"; content: string };

/**
 * Full-page chat for the staff, admin and citizen assistants.
 * Texts come from `<namespace>.*`: title, help, placeholder, ask, disclaimer, suggestions.q1–q4,
 * notConfigured, limit, failed, offline.
 */
export function AssistantChat({ endpoint, namespace }: { endpoint: string; namespace: "assistantPage" | "adminAssistant" | "portalAssistant" }) {
  const t = useTranslations(namespace);
  const locale = useLocale() as "so" | "en";
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  async function ask(question: string) {
    if (question.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    setTurns((tt) => [...tt, { role: "user", content: question }]);
    setQ("");
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, locale, history: turns }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError(t("offline"));
    const data = (await res.json().catch(() => ({}))) as { answer?: string; code?: string };
    if (!res.ok || !data.answer) {
      setTurns((tt) => tt.slice(0, -1));
      setQ(question);
      return setError(data.code === "NOT_CONFIGURED" ? t("notConfigured") : data.code === "RATE_LIMITED" ? t("limit") : t("failed"));
    }
    setTurns((tt) => [...tt, { role: "assistant", content: data.answer! }]);
  }

  return (
    <div className="flex min-h-[60vh] flex-col rounded-xl border bg-card">
      <div className="flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
        {turns.length === 0 && (
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
        {turns.map((m, i) => (
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
  );
}
