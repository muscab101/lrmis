"use client";

import { Button } from "@dhulka/ui/button";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { CheckCheck, MapPinPlus, Route, X } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { closeZoneAction } from "@/app/[locale]/(staff)/parcels/yet-to-register/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link } from "@/i18n/navigation";
import type { ZoneRow } from "@/lib/server/zones";

/** Assigned zones with their progress (houses recorded since assignment out of the target). */
export function ZoneTable({ rows, me, canManage, canAddLand }: { rows: ZoneRow[]; me: string; canManage: boolean; canAddLand: boolean }) {
  const t = useTranslations("yetToRegister.zones");
  const locale = useLocale();
  const format = useFormatter();
  const [target, setTarget] = useState<{ id: string; status: "done" | "cancelled"; name: string } | null>(null);
  const name = (o: { name_so: string; name_en: string }) => (locale === "so" ? o.name_so : o.name_en);
  if (rows.length === 0) return <EmptyState icon={<Route />} title={t("empty")} description={t("emptyBody")} />;
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("neighbourhood")}</TableHead>
            <TableHead className="hidden md:table-cell">{t("surveyor")}</TableHead>
            <TableHead>{t("progress")}</TableHead>
            <TableHead className="hidden text-end lg:table-cell">{t("partial")}</TableHead>
            <TableHead className="hidden text-end lg:table-cell">{t("registered")}</TableHead>
            <TableHead className="hidden xl:table-cell">{t("assigned")}</TableHead>
            <TableHead className="text-end">{t("actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((z) => {
            const pct = Math.min(100, Math.round((z.recorded / z.target) * 100));
            const mine = z.surveyor_id === me;
            return (
              <TableRow key={z.id}>
                <TableCell className="text-sm">
                  <Link href={`/surveys/zones/${z.id}`} className="hover:text-primary font-medium underline-offset-2 hover:underline">
                    {name(z)}
                  </Link>
                  <Mono className="text-muted-foreground ms-2 text-xs">{z.code}</Mono>
                  <div className="text-muted-foreground text-xs">{locale === "so" ? z.district_so : z.district_en}</div>
                  {z.note && <div className="text-muted-foreground text-xs italic">{z.note}</div>}
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">{mine ? t("you") : (z.surveyor ?? "—")}</TableCell>
                <TableCell className="min-w-36 text-sm">
                  <div className="tabular-nums">{t("count", { recorded: format.number(z.recorded), target: format.number(z.target) })}</div>
                  <div className="bg-muted mt-1 h-1.5 w-full overflow-hidden rounded-full" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <div className={`h-full ${pct >= 100 ? "bg-status-approved" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                  </div>
                  {z.status !== "open" && <div className="text-muted-foreground mt-0.5 text-xs">{t(`status.${z.status}`)}</div>}
                </TableCell>
                <TableCell className="hidden text-end text-sm tabular-nums lg:table-cell">{format.number(z.partial)}</TableCell>
                <TableCell className="hidden text-end text-sm tabular-nums lg:table-cell">{format.number(z.registered)}</TableCell>
                <TableCell className="text-muted-foreground hidden text-xs xl:table-cell">
                  {format.dateTime(new Date(z.assigned_at), { dateStyle: "medium" })}
                  {z.assigned_by && <div>{z.assigned_by}</div>}
                </TableCell>
                <TableCell className="text-end">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {z.status === "open" && mine && canAddLand && (
                      <Button size="sm" asChild>
                        <Link href={`/parcels/new?${new URLSearchParams({ nbhd: z.neighbourhood_id, zone: z.id })}`}>
                          <MapPinPlus aria-hidden />
                          {t("addLand")}
                        </Link>
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={`/surveys/zones/${z.id}`}>{t("open")}</Link>
                    </Button>
                    {z.status === "open" && (mine || canManage) && (
                      <Button size="sm" variant="outline" onClick={() => setTarget({ id: z.id, status: "done", name: name(z) })}>
                        <CheckCheck aria-hidden />
                        {t("done")}
                      </Button>
                    )}
                    {z.status === "open" && canManage && (
                      <Button size="sm" variant="ghost" onClick={() => setTarget({ id: z.id, status: "cancelled", name: name(z) })} aria-label={t("cancel")}>
                        <X aria-hidden />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <FormDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title={target?.status === "cancelled" ? t("cancelTitle", { name: target?.name ?? "" }) : t("doneTitle", { name: target?.name ?? "" })}
        description={target?.status === "cancelled" ? t("cancelBody") : t("doneBody")}
        confirmLabel={target?.status === "cancelled" ? t("cancel") : t("done")}
        destructive={target?.status === "cancelled"}
        successMessage={t("closed")}
        submit={() => closeZoneAction({ id: target!.id, status: target!.status })}
      />
    </>
  );
}
