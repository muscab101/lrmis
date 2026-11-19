"use client";

import { Button } from "@dhulka/ui/button";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { MapPinned } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { RemapZoneRow } from "@/lib/server/zones";

/**
 * Remapping work by neighbourhood and surveyor: plots remapped out of plots given. Open: with one plot left it goes
 * straight to that plot's map (when the viewer may remap it); with more, to the list of every plot in the job.
 */
export function RemapZoneTable({ rows, me, canRemapAny, canRemapOwn, back }: { rows: RemapZoneRow[]; me: string; canRemapAny: boolean; canRemapOwn: boolean; back: string }) {
  const t = useTranslations("yetToRegister.remapZones");
  const locale = useLocale();
  const format = useFormatter();
  const name = (o: { name_so: string; name_en: string }) => (locale === "so" ? o.name_so : o.name_en);
  if (rows.length === 0) return <EmptyState icon={<MapPinned />} title={t("empty")} description={t("emptyBody")} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("neighbourhood")}</TableHead>
          <TableHead className="hidden md:table-cell">{t("surveyor")}</TableHead>
          <TableHead>{t("progress")}</TableHead>
          <TableHead className="hidden text-end lg:table-cell">{t("left")}</TableHead>
          <TableHead className="hidden text-end lg:table-cell">{t("guessed")}</TableHead>
          <TableHead className="hidden xl:table-cell">{t("assigned")}</TableHead>
          <TableHead className="text-end">{t("actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((z) => {
          const pct = z.total ? Math.min(100, Math.round((z.done / z.total) * 100)) : 0;
          const finished = z.done >= z.total;
          const left = z.total - z.done;
          const mayRemap = canRemapAny || (z.surveyor_id === me && canRemapOwn);
          const open =
            left === 1 && z.first_open
              ? mayRemap
                ? `/parcels/${z.first_open}/remap?${new URLSearchParams({ back })}`
                : `/parcels/${z.first_open}`
              : `/surveys?${new URLSearchParams({ status: "remapping", nbhd: z.neighbourhood_id, surveyor: z.surveyor_id })}`;
          return (
            <TableRow key={`${z.neighbourhood_id}-${z.surveyor_id}`}>
              <TableCell className="text-sm">
                <span className="font-medium">{name(z)}</span>
                {z.code !== name(z) && <Mono className="text-muted-foreground ms-2 text-xs">{z.code}</Mono>}
                <div className="text-muted-foreground text-xs">{locale === "so" ? z.district_so : z.district_en}</div>
                {z.note && <div className="text-muted-foreground text-xs italic">{z.note}</div>}
              </TableCell>
              <TableCell className="hidden text-sm md:table-cell">{z.surveyor_id === me ? t("you") : (z.surveyor ?? "—")}</TableCell>
              <TableCell className="min-w-36 text-sm">
                <div className="tabular-nums">{t("count", { done: format.number(z.done), total: format.number(z.total) })}</div>
                <div className="bg-muted mt-1 h-1.5 w-full overflow-hidden rounded-full" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className={`h-full ${finished ? "bg-status-approved" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                </div>
                {finished && <div className="text-muted-foreground mt-0.5 text-xs">{t("finished")}</div>}
              </TableCell>
              <TableCell className="hidden text-end text-sm tabular-nums lg:table-cell">{format.number(z.total - z.done)}</TableCell>
              <TableCell className="hidden text-end text-sm tabular-nums lg:table-cell">{format.number(z.guessed)}</TableCell>
              <TableCell className="text-muted-foreground hidden text-xs xl:table-cell">
                {format.dateTime(new Date(z.assigned_at), { dateStyle: "medium" })}
                {z.assigned_by && <div>{z.assigned_by}</div>}
              </TableCell>
              <TableCell className="text-end">
                <Button size="sm" variant="outline" asChild>
                  <Link href={open}>{left === 1 && mayRemap ? t("remapNow") : t("open")}</Link>
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
