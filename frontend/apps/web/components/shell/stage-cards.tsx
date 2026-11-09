import type { LucideIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";

export interface StageCard {
  key: string;
  href: string;
  active: boolean;
  label: string;
  count: string;
  /** What the stage holds; shown when hovering the card. */
  line: string;
  icon?: LucideIcon;
  tone: "pending" | "approved" | "primary" | "muted";
}

const TONE: Record<StageCard["tone"], string> = {
  pending: "text-status-pending",
  approved: "text-status-approved",
  primary: "text-primary",
  muted: "text-muted-foreground",
};

/** Stages as plain links: name and count (and an icon, if given) on one line; the open one is underlined. */
export function StageCards({ cards, label }: { cards: StageCard[]; label: string }) {
  return (
    <nav className="mb-5 flex flex-wrap gap-x-6 gap-y-2" aria-label={label}>
      {cards.map((c) => (
        <Link
          key={c.key}
          href={c.href}
          title={c.line}
          aria-current={c.active ? "page" : undefined}
          className={`group flex items-center gap-2 border-b-2 py-1 text-sm transition-colors ${
            c.active ? "border-primary" : "border-transparent"
          }`}
        >
          {c.icon && <c.icon className={`size-4 shrink-0 ${TONE[c.tone]}`} aria-hidden />}
          <span className={c.active ? "font-medium" : "text-muted-foreground group-hover:text-foreground"}>
            {c.label}
          </span>
          <span className="font-semibold tabular-nums">{c.count}</span>
        </Link>
      ))}
    </nav>
  );
}
