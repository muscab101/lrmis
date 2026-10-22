"use client";

import { cn } from "@dhulka/ui/lib/cn";
import { Tooltip } from "@dhulka/ui/form-controls";
import { BrandLockup, BrandMark } from "@dhulka/ui/brand";
import { ChevronsLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import type { NavGroup } from "./nav";

interface SidebarProps {
  groups: NavGroup[];
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}

export function Sidebar({ groups, collapsed, onToggle, onNavigate }: SidebarProps) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();
  // The longest matching link wins, so /parcels/yet-to-register lights up its own item, not Parcels too.
  const activeHref = groups
    .flatMap((g) => g.items.map((i) => i.href))
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <nav aria-label={t("label")} className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn("flex h-16 items-center border-b border-sidebar-border px-4", collapsed && "justify-center px-0")}>
        {collapsed ? <BrandMark title={tc("appShortName")} /> : <BrandLockup name={tc("appShortName")} sub={tc("orgName")} inverted />}
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-2.5 py-5">
        {groups.map((group) => (
          <div key={group.key}>
            {!collapsed && (
              <div className="label-caps mb-1.5 px-2.5 text-sidebar-foreground/55">
                {t(`groups.${group.key}`)}
              </div>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.href === activeHref;
                const label = t(`items.${item.key}`);
                const soon = item.phase !== undefined;
                const content = (
                  <span
                    className={cn(
                      "relative flex h-9 items-center gap-3 rounded-md px-2.5 text-[13px] transition-colors",
                      collapsed && "justify-center px-0",
                      active
                        ? "bg-sidebar-active font-medium text-sidebar-active-foreground before:absolute before:inset-y-2 before:-start-2.5 before:w-[3px] before:rounded-e before:bg-flag"
                        : "hover:bg-sidebar-active/60 hover:text-white",
                      soon && "opacity-45 hover:bg-transparent hover:text-sidebar-foreground",
                    )}
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden />
                    {!collapsed && <span className="flex-1 truncate">{label}</span>}
                    {!collapsed && soon && (
                      <span className="font-mono text-[10px] text-sidebar-foreground/70">
                        {tc("phaseShort", { n: item.phase ?? 0 })}
                      </span>
                    )}
                  </span>
                );
                const node = soon ? (
                  <span aria-disabled="true" title={tc("comingInPhase", { n: item.phase ?? 0 })}>
                    {content}
                  </span>
                ) : (
                  <Link href={item.href} aria-current={active ? "page" : undefined} onClick={onNavigate}>
                    {content}
                  </Link>
                );
                return (
                  <li key={item.key}>
                    {collapsed ? (
                      <Tooltip content={label} side="right">
                        {node}
                      </Tooltip>
                    ) : (
                      node
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onToggle}
        className="hidden h-11 items-center gap-2 border-t border-sidebar-border px-4 text-xs text-sidebar-foreground/70 hover:text-white lg:flex"
        aria-label={collapsed ? t("expand") : t("collapse")}
      >
        <ChevronsLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} aria-hidden />
        {!collapsed && t("collapse")}
      </button>
    </nav>
  );
}
