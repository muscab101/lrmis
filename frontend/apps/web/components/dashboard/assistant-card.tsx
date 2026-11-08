"use client";

import { Button } from "@dhulka/ui/button";
import { ArrowUp, Sparkles } from "lucide-react";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

/** Ask the assistant from the dashboard: the question opens in the assistant page. */
export function AssistantCard({ title, body, placeholder, send }: { title: string; body: string; placeholder: string; send: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <div className="bg-card relative overflow-hidden rounded-xl border p-4 shadow-xs">
      <div className="from-primary/15 to-accent/10 pointer-events-none absolute -top-16 -right-16 size-44 rounded-full bg-gradient-to-br blur-2xl" aria-hidden />
      <div className="relative flex items-center gap-3">
        <span className="text-primary grid size-10 place-items-center">
          <Sparkles className="size-6" aria-hidden />
        </span>
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-muted-foreground text-xs">{body}</p>
        </div>
      </div>
      <form
        className="bg-background relative mt-4 flex items-center gap-2 rounded-full border p-1 ps-4"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(q.trim() ? `/assistant?q=${encodeURIComponent(q.trim())}` : "/assistant");
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        <Button type="submit" size="icon-sm" className="rounded-full" aria-label={send}>
          <ArrowUp aria-hidden />
        </Button>
      </form>
    </div>
  );
}
