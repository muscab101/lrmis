"use client";

import type { UsersQuery } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { EmptyState } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ShieldCheck, ShieldOff, Users } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { RoleBadge, UserStatusBadge } from "@/components/admin/badges";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import type { RoleLite, UserRow } from "@/lib/server/users";

interface Props {
  rows: UserRow[];
  total: number;
  query: UsersQuery;
  roles: RoleLite[];
  districts: { id: string; name_so: string; name_en: string }[];
}

/** Filters, sort and page live in the URL: Back, refresh and shared links always work. */
export function UsersTable({ rows, total, query, roles, districts }: Props) {
  const t = useTranslations("admin.users");
  const tc = useTranslations("common");
  const ts = useTranslations("status");
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(query.q);

  const roleMap = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const districtMap = useMemo(() => new Map(districts.map((d) => [d.id, locale === "so" ? d.name_so : d.name_en])), [districts, locale]);

  function setParams(patch: Record<string, string | number | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === "any") next.delete(k);
      else next.set(k, String(v));
    }
    if (!("page" in patch)) next.delete("page");
    start(() => router.replace(`${pathname}?${next}`));
  }

  // Debounced search box.
  useEffect(() => {
    if (q === query.q) return;
    const h = setTimeout(() => setParams({ q }), 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const sortHeader = (key: UsersQuery["sort"], label: string) => (
    <button
      type="button"
      className="inline-flex items-center gap-1 hover:text-foreground"
      onClick={() => setParams({ sort: key, dir: query.sort === key && query.dir === "asc" ? "desc" : "asc" })}
    >
      {label}
      {query.sort === key && (query.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
    </button>
  );

  const columns: ColumnDef<UserRow>[] = [
    {
      id: "name",
      header: () => sortHeader("full_name", t("colName")),
      cell: ({ row }) => (
        <Link href={`/admin/users/${row.original.user_id}`} className="group block min-w-0">
          <div className="truncate font-medium group-hover:text-primary">{row.original.full_name || "—"}</div>
          <div className="truncate text-xs text-muted-foreground">{row.original.email}</div>
        </Link>
      ),
    },
    { id: "phone", header: t("colPhone"), cell: ({ row }) => <span className="font-mono text-xs">{row.original.phone ?? "—"}</span> },
    {
      id: "roles",
      header: t("colRoles"),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.role_ids.map((id) => {
            const role = roleMap.get(id);
            return role ? <RoleBadge key={id} role={role} /> : null;
          })}
        </div>
      ),
    },
    {
      id: "districts",
      header: t("colDistricts"),
      cell: ({ row }) =>
        row.original.all_districts ? (
          <span className="text-xs">{t("allDistricts")}</span>
        ) : (
          <span className="text-xs">{row.original.district_ids.map((d) => districtMap.get(d)).filter(Boolean).join(", ") || "—"}</span>
        ),
    },
    { id: "status", header: t("colStatus"), cell: ({ row }) => <UserStatusBadge status={row.original.status} /> },
    {
      id: "mfa",
      header: t("col2fa"),
      cell: ({ row }) =>
        row.original.has_totp ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <ShieldCheck className="size-3.5" aria-hidden />
            {tc("on")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldOff className="size-3.5" aria-hidden />
            {tc("off")}
          </span>
        ),
    },
    {
      id: "last_login",
      header: () => sortHeader("last_login_at", t("colLastLogin")),
      cell: ({ row }) => (
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          {row.original.last_login_at ? format.relativeTime(new Date(row.original.last_login_at)) : t("never")}
        </span>
      ),
    },
    {
      id: "created_by",
      header: t("colCreatedBy"),
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.created_by_name ?? t("system")}</span>,
    },
  ];

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualSorting: true });
  const pages = Math.max(1, Math.ceil(total / query.pageSize));

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b p-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="max-w-xs"
          aria-label={tc("search")}
        />
        <div className="w-40">
          <NativeSelect value={query.status} onChange={(e) => setParams({ status: e.target.value })} aria-label={t("colStatus")}>
            <option value="any">{t("anyStatus")}</option>
            {(["active", "invited", "suspended", "deleted"] as const).map((s) => (
              <option key={s} value={s}>
                {ts(s)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="w-56">
          <NativeSelect value={query.roleId} onChange={(e) => setParams({ roleId: e.target.value })} aria-label={t("colRoles")}>
            <option value="">{t("anyRole")}</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {locale === "so" ? r.name_so : r.name_en}
              </option>
            ))}
          </NativeSelect>
        </div>
        <span className="ms-auto text-xs text-muted-foreground" aria-live="polite">
          {pending ? tc("loading") : t("count", { count: total })}
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Users />} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody className={pending ? "opacity-60" : undefined}>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Mobile cards */}
          <ul className="divide-y md:hidden">
            {rows.map((u) => (
              <li key={u.user_id} className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/admin/users/${u.user_id}`} className="min-w-0">
                    <div className="truncate font-medium">{u.full_name || "—"}</div>
                    <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                  </Link>
                  <UserStatusBadge status={u.status} />
                </div>
                <div className="flex flex-wrap gap-1">
                  {u.role_ids.map((id) => {
                    const role = roleMap.get(id);
                    return role ? <RoleBadge key={id} role={role} /> : null;
                  })}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex items-center justify-between border-t p-3 text-sm">
        <span className="text-muted-foreground">{t("pageOf", { page: query.page, pages })}</span>
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
  );
}
