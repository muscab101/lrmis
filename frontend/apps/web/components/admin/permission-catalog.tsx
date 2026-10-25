"use client";

import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { Mono } from "@dhulka/ui/misc";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { RoleBadge } from "./badges";

export interface CatalogRole {
  name_so: string;
  name_en: string;
  colour: string;
}
export interface CatalogGroup {
  label: string;
  modules: { label: string; rows: { key: string; what: string; roles: CatalogRole[] }[] }[];
}

/** The working permissions, grouped like the menu, each with what it allows and the roles that have it. */
export function PermissionCatalog({ groups, total }: { groups: CatalogGroup[]; total: number }) {
  const t = useTranslations("admin.permissionsPage");
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const match = (s: string) => s.toLowerCase().includes(needle);
  const shown = groups
    .map((g) => ({
      ...g,
      modules: g.modules
        .map((m) => ({
          ...m,
          rows: needle
            ? m.rows.filter((r) => match(r.key) || match(r.what) || match(m.label) || r.roles.some((x) => match(x.name_en) || match(x.name_so)))
            : m.rows,
        }))
        .filter((m) => m.rows.length > 0),
    }))
    .filter((g) => g.modules.length > 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="text-muted-foreground absolute start-2.5 top-1/2 size-4 -translate-y-1/2" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="ps-8" />
        </div>
        <span className="text-muted-foreground text-sm">
          {t("count", { count: total })} · {t("superAdmin")}
        </span>
      </div>
      {shown.map((g) => (
        <section key={g.label}>
          <h2 className="text-muted-foreground mb-3 text-xs font-semibold tracking-wide uppercase">{g.label}</h2>
          <div className="space-y-4">
            {g.modules.map((m) => (
              <Card key={m.label} className="overflow-hidden">
                <h3 className="bg-muted/40 border-b px-4 py-2.5 font-semibold">{m.label}</h3>
                <ul className="divide-y">
                  {m.rows.map((r) => (
                    <li key={r.key} className="grid gap-x-6 gap-y-1.5 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
                      <div>
                        <p className="text-sm">{r.what}</p>
                        <Mono className="text-muted-foreground text-[11px]">{r.key}</Mono>
                      </div>
                      <div className="flex flex-wrap content-start gap-1" aria-label={t("roles")}>
                        {r.roles.length ? r.roles.map((x) => <RoleBadge key={x.name_en} role={x} />) : <span className="text-muted-foreground text-xs italic">{t("noRole")}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
