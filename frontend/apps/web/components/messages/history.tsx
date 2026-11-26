"use client";

import { Button } from "@dhulka/ui/button";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { toast } from "@dhulka/ui/toaster";
import { Megaphone } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { cancelCampaignAction, decideCampaignAction, retryCampaignAction } from "@/app/[locale]/(staff)/messages/actions";
import { DecideButtons } from "@/components/legal/decide";
import { Link, useRouter } from "@/i18n/navigation";
import { useErrorMessage } from "@/lib/client/errors";
import type { CampaignState, CampaignSummary } from "@/lib/server/messages";

const STATE_TONE: Record<CampaignState, string> = {
  scheduled: "bg-info/10 text-info",
  sending: "bg-warning/10 text-warning",
  sent: "bg-success/10 text-success",
  partial: "bg-warning/10 text-warning",
  failed: "bg-danger/10 text-danger",
  cancelled: "bg-muted text-muted-foreground",
  draft: "bg-muted text-foreground",
  rejected: "bg-danger/10 text-danger",
};

export function CampaignStateBadge({ state }: { state: CampaignState }) {
  const th = useTranslations("messages.history");
  return <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATE_TONE[state]}`}>{th(`states.${state}`)}</span>;
}

/** What a campaign was: its title, category or old template. */
export function useCampaignLabel() {
  const tm = useTranslations("messages");
  return (c: CampaignSummary) =>
    c.kind === "compose" ? (c.title ?? tm(`compose.categories.${c.category ?? "custom"}`)) : tm(`templates.${c.template_code ?? "general_notice"}`);
}

/** Who it went to: the areas, the chosen owners, or the old campaign's audience. */
export function useCampaignAudience() {
  const tm = useTranslations("messages");
  const locale = useLocale();
  return (c: CampaignSummary) => {
    if (c.kind === "compose") {
      if (c.areas && c.areas.length > 0)
        return c.areas.map((a) => `${tm(`compose.levels.${a.level}`)} ${locale === "so" ? a.name_so : a.name_en}`).join(" · ");
      if (c.target?.all) return tm("history.allOwners");
      return tm("history.chosenOwners", { n: c.target?.owners?.length ?? 0 });
    }
    const district = c.district ? (locale === "so" ? c.district.name_so : c.district.name_en) : tm("allDistricts");
    const who = c.audience?.kind === "overdue" ? tm("audOverdue", { n: c.audience.min_days ?? 0 }) : c.audience?.kind === "tax_due" ? tm("audTaxDue", { period: c.audience.period ?? "" }) : tm("audOwners");
    return `${who} · ${district}`;
  };
}

/** Message history: one row per campaign with its delivery counts. */
export function CampaignHistory({ rows, me, can }: { rows: CampaignSummary[]; me: string; can: { decide: boolean; retry: boolean; cancel: boolean } }) {
  const th = useTranslations("messages.history");
  const format = useFormatter();
  const label = useCampaignLabel();
  const audience = useCampaignAudience();
  if (rows.length === 0) return <EmptyState icon={<Megaphone />} title={th("empty")} description={th("emptyBody")} />;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{th("number")}</TableHead>
            <TableHead>{th("message")}</TableHead>
            <TableHead>{th("to")}</TableHead>
            <TableHead>{th("sender")}</TableHead>
            <TableHead className="text-end">{th("recipients")}</TableHead>
            <TableHead className="text-end">{th("delivered")}</TableHead>
            <TableHead className="text-end">{th("failed")}</TableHead>
            <TableHead>{th("state")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="whitespace-nowrap">
                <Link href={`/messages/${c.id}`} className="hover:underline">
                  <Mono>{c.number}</Mono>
                </Link>
                <span className="block text-xs text-muted-foreground">{format.dateTime(new Date(c.created_at), { dateStyle: "medium", timeStyle: "short" })}</span>
              </TableCell>
              <TableCell className="max-w-sm text-sm">
                <Link href={`/messages/${c.id}`} className="font-medium hover:underline">
                  {label(c)}
                </Link>
                {c.body && <span className="line-clamp-1 text-xs text-muted-foreground">{c.body}</span>}
                {(c.channel === "email" || c.per_parcel) && (
                  <span className="text-xs text-muted-foreground">
                    {[c.channel === "email" ? "Email" : null, c.per_parcel ? th("perParcel") : null].filter(Boolean).join(" · ")}
                  </span>
                )}
              </TableCell>
              <TableCell className="max-w-xs text-sm">
                <span className="line-clamp-2">{audience(c)}</span>
              </TableCell>
              <TableCell className="text-sm whitespace-nowrap">{c.sender ?? "—"}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{c.total || c.recipients}</TableCell>
              <TableCell className="text-end text-sm text-success tabular-nums">{c.sent}</TableCell>
              <TableCell className={`text-end text-sm tabular-nums ${c.failed ? "text-danger" : ""}`}>{c.failed}</TableCell>
              <TableCell className="text-sm">
                <CampaignStateBadge state={c.state} />
                {c.state === "scheduled" && c.scheduled_at && (
                  <span className="block text-xs text-muted-foreground">{format.dateTime(new Date(c.scheduled_at), { dateStyle: "short", timeStyle: "short" })}</span>
                )}
              </TableCell>
              <TableCell className="text-end whitespace-nowrap">
                {c.state === "draft" && can.decide && c.created_by !== me ? (
                  <DecideButtons decide={(v) => decideCampaignAction({ id: c.id, approve: v.approve, note: v.note })} />
                ) : (
                  <CampaignButtons campaign={c} can={can} compact />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Retry the failed messages, or stop the ones that have not gone yet. */
export function CampaignButtons({ campaign: c, can, compact = false }: { campaign: CampaignSummary; can: { retry: boolean; cancel: boolean }; compact?: boolean }) {
  const th = useTranslations("messages.history");
  const em = useErrorMessage();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = async (fn: typeof retryCampaignAction, ok: (n: number) => string) => {
    setBusy(true);
    const r = await fn({ id: c.id });
    setBusy(false);
    if (r.ok) {
      toast.success(ok(r.data));
      router.refresh();
    } else toast.error(em(r.error));
  };
  return (
    <span className="inline-flex gap-1.5">
      {can.retry && c.failed > 0 && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(retryCampaignAction, (n) => th("retried", { n }))}>
          {compact ? th("retry") : th("retryFailed", { n: c.failed })}
        </Button>
      )}
      {can.cancel && c.waiting > 0 && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(cancelCampaignAction, (n) => th("stopped", { n }))}>
          {compact ? th("stop") : th("stopWaiting", { n: c.waiting })}
        </Button>
      )}
    </span>
  );
}
