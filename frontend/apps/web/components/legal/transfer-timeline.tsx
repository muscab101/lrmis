import { CheckCircle2, FileUp, FileX, Flag, Search, Send, UserMinus, UserPlus, XCircle, Clock, Home } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import type { TransferEvent } from "@/lib/server/transfer-history";

const ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  initiated: Flag,
  previous_owner: UserMinus,
  new_owner: UserPlus,
  document: FileUp,
  document_removed: FileX,
  submitted: Send,
  under_review: Search,
  needs_documents: Clock,
  approved: CheckCircle2,
  rejected: XCircle,
  cancelled: XCircle,
  ownership_updated: Home,
};

/** The transfer's activity, oldest first: what happened, when, who did it, and their comment. */
export async function TransferTimeline({ events }: { events: TransferEvent[] }) {
  const t = await getTranslations("legal.timeline");
  const tf = await getTranslations("legal.files");
  const format = await getFormatter();
  if (events.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  const owners = (d: Record<string, unknown>) =>
    ((d.owners as { full_name?: string }[] | undefined) ?? []).map((o) => o.full_name).filter(Boolean).join(", ");
  return (
    <ol className="relative space-y-4 border-s ps-6">
      {events.map((e) => {
        const Icon = ICON[e.kind] ?? Flag;
        const bad = e.kind === "rejected" || e.kind === "cancelled" || e.kind === "needs_documents";
        const good = e.kind === "approved" || e.kind === "ownership_updated";
        const detail =
          e.kind === "document" || e.kind === "document_removed"
            ? [String(e.data.file_name ?? ""), e.data.category ? tf(`categories.${String(e.data.category)}`) : ""].filter(Boolean).join(" · ")
            : e.kind === "previous_owner" || e.kind === "new_owner" || e.kind === "ownership_updated"
              ? owners(e.data)
              : "";
        return (
          <li key={e.id} className="relative">
            <span
              className={`absolute -start-[2.15rem] flex size-7 items-center justify-center rounded-full border bg-card ${good ? "text-success" : bad ? "text-danger" : "text-primary"}`}
            >
              <Icon className="size-3.5" aria-hidden />
            </span>
            <p className="text-sm font-medium">{t.has(e.kind) ? t(e.kind) : e.kind}</p>
            {detail && <p className="text-sm">{detail}</p>}
            {e.note && <p className="text-sm text-muted-foreground">“{e.note}”</p>}
            <p className="text-xs text-muted-foreground">
              {format.dateTime(new Date(e.at), { dateStyle: "medium", timeStyle: "short" })}
              {e.actor_name && ` · ${e.actor_name}`}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
