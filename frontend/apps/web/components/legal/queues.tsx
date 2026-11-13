"use client";

import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Inbox } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { decideChangeAction } from "@/app/[locale]/(staff)/transfers/actions";
import { DecideButtons } from "./decide";

function Empty() {
  const t = useTranslations("legal");
  return <EmptyState icon={<Inbox />} title={t("queueEmpty")} description={t("queueEmptyBody")} />;
}

type Change = {
  id: string;
  number: string;
  kind: string;
  status: string;
  reason: string;
  payload: { land_use?: string; children?: unknown[] } & Record<string, unknown>;
  requested_by: string | null;
  requested_at: string;
  puns: string[];
  result_puns: string[];
};

export function ChangeTable({ rows, canDecide }: { rows: Change[]; canDecide: boolean }) {
  const t = useTranslations("legal");
  const ts = useTranslations("stage");
  const format = useFormatter();
  if (!rows.length) return <Empty />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("number")}</TableHead>
          <TableHead>{t("kind")}</TableHead>
          <TableHead>{t("parcels")}</TableHead>
          <TableHead>{t("reason")}</TableHead>
          <TableHead>{t("requested_at")}</TableHead>
          <TableHead>{t("statusLabel")}</TableHead>
          <TableHead className="text-end">{t("actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((c) => (
          <TableRow key={c.id}>
            <TableCell>
              <Mono>{c.number}</Mono>
            </TableCell>
            <TableCell className="text-sm">
              {t(`changeKinds.${c.kind}`)}
              <span className="text-muted-foreground block text-xs">
                {c.kind === "change_of_use" &&
                  c.payload.land_use &&
                  `→ ${ts(`landUses.${c.payload.land_use}`)}`}
                {c.kind === "subdivide" && t("childCount", { n: c.payload.children?.length ?? 0 })}
                {c.kind === "correction" &&
                  Object.entries(c.payload)
                    .map(([k, val]) =>
                      k === "geom"
                        ? t("correctionBoundary")
                        : `${t(`correctionField.${k}`)}: ${typeof val === "boolean" ? (val ? t("yes") : t("no")) : String(val)}`,
                    )
                    .join(" · ")}
              </span>
            </TableCell>
            <TableCell className="font-mono text-xs">
              {c.puns.join(", ")}
              {c.result_puns.length > 0 && (
                <span className="text-status-approved block">→ {c.result_puns.join(", ")}</span>
              )}
            </TableCell>
            <TableCell className="max-w-xs text-sm">{c.reason}</TableCell>
            <TableCell className="text-sm">
              {format.dateTime(new Date(c.requested_at), { dateStyle: "medium" })}
            </TableCell>
            <TableCell className="text-sm">{t(`status.${c.status}`)}</TableCell>
            <TableCell className="whitespace-nowrap text-end">
              <span className="inline-flex items-center justify-end gap-1.5">
                {canDecide && (
                  <>
                    {c.status === "submitted" && (
                      <DecideButtons
                        decide={(v) =>
                          decideChangeAction({ id: c.id, approve: v.approve, note: v.note })
                        }
                      />
                    )}
                  </>
                )}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

