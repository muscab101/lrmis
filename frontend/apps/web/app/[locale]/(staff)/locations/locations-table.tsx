"use client";

import { LOCATION_LEVELS, type LocationLevel, type LocationsQuery } from "@dhulka/core/schemas";
import { StatusBadge } from "@dhulka/ui/badge";
import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { ConfirmDialog } from "@dhulka/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@dhulka/ui/dropdown-menu";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { toast } from "@dhulka/ui/toaster";
import { Archive, ChevronLeft, ChevronRight, MapPinned, MoreHorizontal, Pencil, Plus, RotateCcw, Shapes } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useErrorMessage } from "@/lib/client/errors";
import type { DistrictCount, LocationRow } from "@/lib/server/locations";
import { archiveLocationAction } from "./actions";
import { BoundarySheet } from "./boundary-sheet";
import { LocationSheet } from "./location-sheet";

interface Props {
  rows: LocationRow[];
  total: number;
  pageSize: number;
  query: LocationsQuery;
  districts: { id: string; code: string; name_so: string; name_en: string }[];
  counts: DistrictCount[];
  can: { create: boolean; update: boolean; archive: boolean };
}

export function LocationsTable({ rows, total, pageSize, query, districts, counts, can }: Props) {
  const t = useTranslations("locations");
  const tc = useTranslations("common");
  const tm = useTranslations("map");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const errorText = useErrorMessage();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(query.q);
  const [editing, setEditing] = useState<LocationRow | "new" | null>(null);
  const [boundary, setBoundary] = useState<LocationRow | null>(null);
  const [archiving, setArchiving] = useState<LocationRow | null>(null);
  const [busy, setBusy] = useState(false);
  const countMap = useMemo(() => new Map(counts.map((c) => [c.district_id, c])), [counts]);
  const name = (r: { name_so: string; name_en: string }) => (locale === "so" ? r.name_so : r.name_en || r.name_so);
  const level = query.level;
  const archivedView = query.archived === "1";

  function setParams(patch: Record<string, string | number | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    if (!("page" in patch)) next.delete("page");
    start(() => router.replace(`${pathname}?${next}`));
  }

  useEffect(() => {
    if (q === query.q) return;
    const h = setTimeout(() => setParams({ q }), 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const hasCode = level !== "streets" && level !== "facilities";

  const parentLabel = (r: LocationRow) => {
    if (level === "sectors" && r.section) return `${r.section.code} · ${r.section.name_so}`;
    if (level === "neighbourhoods" && r.sector) return `${r.sector.code} · ${r.sector.name_so}`;
    return null;
  };

  return (
    <>
      <nav className="mb-5 flex gap-5 overflow-x-auto border-b text-sm" aria-label={t("levels")}>
        {LOCATION_LEVELS.map((l) => (
          <Link
            key={l}
            href={`/locations?level=${l}${query.district ? `&district=${query.district}` : ""}`}
            className={`-mb-px border-b-2 pb-2.5 whitespace-nowrap ${l === level ? "border-flag font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            aria-current={l === level ? "page" : undefined}
          >
            {t(`level_${l}`)}
          </Link>
        ))}
      </nav>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchPlaceholder")} className="max-w-xs" aria-label={tc("search")} />
          <div className="w-52">
            <NativeSelect value={query.district} onChange={(e) => setParams({ district: e.target.value })} aria-label={t("district")}>
              <option value="">{t("allDistricts")}</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {name(d)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-primary" checked={archivedView} onChange={(e) => setParams({ archived: e.target.checked ? "1" : null })} />
            {t("showArchived")}
          </label>
          <span className="ms-auto text-xs text-muted-foreground" aria-live="polite">
            {pending ? tc("loading") : t("count", { count: total })}
          </span>
          {can.create && !archivedView && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus aria-hidden />
              {t(`new_${level}`)}
            </Button>
          )}
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Shapes />}
            title={archivedView ? t("emptyArchived") : t("emptyTitle")}
            description={archivedView ? undefined : t("emptyBody")}
            action={
              can.create && !archivedView ? (
                <Button size="sm" onClick={() => setEditing("new")}>
                  {t(`new_${level}`)}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {hasCode && <TableHead>{t("code")}</TableHead>}
                <TableHead>{t("name")}</TableHead>
                {level !== "districts" && <TableHead>{t("district")}</TableHead>}
                {(level === "sectors" || level === "neighbourhoods") && <TableHead className="hidden md:table-cell">{t(level === "sectors" ? "section" : "sector")}</TableHead>}
                {level === "neighbourhoods" && <TableHead className="hidden text-end lg:table-cell">{t("capacity")}</TableHead>}
                {level === "facilities" && <TableHead>{t("kind")}</TableHead>}
                {level === "districts" && (
                  <>
                    <TableHead className="hidden text-end md:table-cell">{t("level_sections")}</TableHead>
                    <TableHead className="hidden text-end md:table-cell">{t("level_neighbourhoods")}</TableHead>
                  </>
                )}
                <TableHead>{t("boundary")}</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">{t("actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={pending ? "opacity-60" : undefined}>
              {rows.map((r) => {
                const c = level === "districts" ? countMap.get(r.id) : undefined;
                return (
                  <TableRow key={r.id}>
                    {hasCode && (
                      <TableCell>
                        <Mono>{level === "neighbourhoods" && r.district ? `${r.district.code}-${r.code}` : r.code}</Mono>
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="font-medium">{r.name_so}</div>
                      {r.name_en && r.name_en !== r.name_so && <div className="text-xs text-muted-foreground">{r.name_en}</div>}
                    </TableCell>
                    {level !== "districts" && <TableCell className="text-sm">{r.district ? name(r.district) : "—"}</TableCell>}
                    {(level === "sectors" || level === "neighbourhoods") && (
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{parentLabel(r)}</TableCell>
                    )}
                    {level === "neighbourhoods" && <TableCell className="hidden text-end lg:table-cell">{r.capacity ?? "—"}</TableCell>}
                    {level === "facilities" && <TableCell className="text-sm">{tm(`facility_${r.kind ?? "other"}`)}</TableCell>}
                    {level === "districts" && (
                      <>
                        <TableCell className="hidden text-end md:table-cell">{c?.sections ?? 0}</TableCell>
                        <TableCell className="hidden text-end md:table-cell">
                          {c ? `${c.mapped_neighbourhoods}/${c.neighbourhoods}` : "0/0"}
                        </TableCell>
                      </>
                    )}
                    <TableCell>
                      <StatusBadge tone={r.has_geom ? "approved" : "draft"}>{r.has_geom ? t("mapped") : t("notMapped")}</StatusBadge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={t("actions")}>
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {can.update && !archivedView && (
                            <DropdownMenuItem onSelect={() => setEditing(r)}>
                              <Pencil />
                              {tc("edit")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => setBoundary(r)}>
                            <MapPinned />
                            {can.update && !archivedView ? t("editBoundary") : t("viewBoundary")}
                          </DropdownMenuItem>
                          {can.archive && (
                            <DropdownMenuItem destructive={!archivedView} onSelect={() => setArchiving(r)}>
                              {archivedView ? <RotateCcw /> : <Archive />}
                              {archivedView ? t("restore") : t("archive")}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <div className="flex items-center justify-between border-t p-3 text-sm">
          <span className="text-muted-foreground">{tc("pageOf", { page: query.page, pages })}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={query.page <= 1 || pending} onClick={() => setParams({ page: query.page - 1 })}>
              <ChevronLeft className="rtl:rotate-180" aria-hidden />
              {tc("previous")}
            </Button>
            <Button variant="outline" size="sm" disabled={query.page >= pages || pending} onClick={() => setParams({ page: query.page + 1 })}>
              {tc("next")}
              <ChevronRight className="rtl:rotate-180" aria-hidden />
            </Button>
          </div>
        </div>
      </Card>

      {editing && (
        <LocationSheet
          level={level}
          row={editing === "new" ? null : editing}
          districts={districts}
          defaultDistrictId={query.district || null}
          onClose={() => setEditing(null)}
        />
      )}
      {boundary && <BoundarySheet level={level} row={boundary} canEdit={can.update && !archivedView} onClose={() => setBoundary(null)} />}

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={archivedView ? t("restoreTitle") : t("archiveTitle")}
        description={archivedView ? t("restoreBody") : t("archiveBody")}
        confirmLabel={archivedView ? t("restore") : t("archive")}
        cancelLabel={tc("cancel")}
        destructive={!archivedView}
        loading={busy}
        onConfirm={async () => {
          if (!archiving) return;
          setBusy(true);
          const res = await archiveLocationAction({ level, id: archiving.id, archived: !archivedView });
          setBusy(false);
          setArchiving(null);
          if (!res.ok) return toast.error(errorText(res.error));
          toast.success(archivedView ? t("restored") : t("archived"));
          router.refresh();
        }}
      />
    </>
  );
}

export type { LocationLevel };
