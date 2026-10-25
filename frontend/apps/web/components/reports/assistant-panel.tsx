"use client";

import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Textarea } from "@dhulka/ui/input";
import { Loader2, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

type Turn = { role: "user" | "assistant"; content: string };

/** Ask questions about the figures; answers come only from the report functions for this user. */
export function AssistantPanel() {
  const t = useTranslations("reports");
  const locale = useLocale() as "so" | "en";
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(question: string) {
    if (question.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, locale, history: turns, reports: true }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError(t("assistant.offline"));
    const data = (await res.json().catch(() => ({}))) as { answer?: string; code?: string };
    if (!res.ok || !data.answer) {
      return setError(data.code === "NOT_CONFIGURED" ? t("assistant.notConfigured") : data.code === "RATE_LIMITED" ? t("assistant.limit") : t("assistant.failed"));
    }
    setTurns([...turns, { role: "user", content: question }, { role: "assistant", content: data.answer }]);
    setQ("");
  }

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" aria-hidden />
          {t("assistant.title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("assistant.help")}</p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {turns.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {(["q1", "q2", "q3"] as const).map((k) => (
              <button key={k} type="button" onClick={() => ask(t(`assistant.${k}`))} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground" disabled={busy}>
                {t(`assistant.${k}`)}
              </button>
            ))}
          </div>
        )}
        <ol className="space-y-3" aria-live="polite">
          {turns.map((m, i) => (
            <li key={i} className={m.role === "user" ? "font-medium" : "whitespace-pre-wrap text-muted-foreground"}>
              {m.content}
            </li>
          ))}
        </ol>
        {error && <p className="text-status-rejected">{error}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(q);
          }}
          className="space-y-2"
        >
          <Textarea rows={2} maxLength={500} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("assistant.placeholder")} aria-label={t("assistant.placeholder")} />
          <Button type="submit" size="sm" className="w-full" disabled={busy || q.trim().length < 3}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {t("assistant.ask")}
          </Button>
        </form>
        <p className="text-[11px] text-muted-foreground">{t("assistant.disclaimer")}</p>
      </CardContent>
    </Card>
  );
}
