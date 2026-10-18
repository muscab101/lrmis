"use client";

import { cn } from "@dhulka/ui/lib/cn";
import { Tooltip } from "@dhulka/ui/form-controls";
import { BrandLockup, BrandMark } from "@dhulka/ui/brand";
import { ChevronsLeft, type LucideIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { activeHref, type NavGroup } from "./nav";

interface SidebarProps {
  groups: NavGroup[];
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}

/**
 * Every page is listed all the time under its section heading; nothing folds away.
 * Single-page sections (Dashboard, Collections, System Settings, Map) are plain links.
 */
export function Sidebar({ groups, collapsed, onToggle, onNavigate }: SidebarProps) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const search = useSearchParams();
  const current = useMemo(
    () => activeHref(groups, pathname, new URLSearchParams(search?.toString() ?? "")),
    [groups, pathname, search],
  );

  const link = (key: string, href: string, label: string, Icon?: LucideIcon, within?: NavGroup) => {
    const active = within ? within.items.some((i) => i.href === current) : current === href;
    const node = (
      <Link
        href={href}
        aria-current={active && !within ? "page" : undefined}
        onClick={onNavigate}
        className={cn(
          "relative flex h-9 items-center gap-3 rounded-md px-2.5 text-[13px] transition-colors",
          !Icon && "ps-9",
          collapsed && "justify-center px-0",
          active
            ? "bg-sidebar-active text-sidebar-active-foreground before:bg-flag font-medium before:absolute before:inset-y-2 before:-start-2.5 before:w-[3px] before:rounded-e"
            : "hover:bg-sidebar-active/60 hover:text-white",
        )}
      >
        {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
        {!collapsed && <span className="flex-1 truncate">{label}</span>}
      </Link>
    );
    return (
      <li key={key}>
        {collapsed ? (
          <Tooltip content={label} side="right">
            {node}
          </Tooltip>
        ) : (
          node
        )}
      </li>
    );
  };

  const firstExtra = groups.findIndex((g) => g.extra);

  return (
    <nav aria-label={t("label")} className="bg-sidebar text-sidebar-foreground flex h-full flex-col">
      <div className={cn("border-sidebar-border flex h-16 items-center border-b px-4", collapsed && "justify-center px-0")}>
        {collapsed ? <BrandMark title={tc("appShortName")} /> : <BrandLockup name={tc("appShortName")} sub={tc("orgName")} inverted />}
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-5">
        {groups.map((group, index) => {
          const label = t(`sections.${group.key}`);
          return (
            <div key={group.key} className={cn(collapsed ? "mb-0.5" : "mb-5")}>
              {index === firstExtra && (
                <div aria-hidden className={cn("border-sidebar-border mb-5 border-t", collapsed && "mx-2")} />
              )}
              {!collapsed && !group.href && (
                <div className="label-caps text-sidebar-foreground/55 mb-1 flex items-center gap-3 px-2.5">
                  <group.icon className="size-4 shrink-0" aria-hidden />
                  {label}
                </div>
              )}
              <ul className="space-y-0.5">
                {group.href
                  ? link(group.key, group.href, label, group.icon)
                  : collapsed
                    ? link(group.key, group.items[0]!.href, label, group.icon, group)
                    : group.items.map((item) => link(item.key, item.href, t(`items.${item.key}`)))}
              </ul>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onToggle}
        className="border-sidebar-border text-sidebar-foreground/70 hidden h-11 items-center gap-2 border-t px-4 text-xs hover:text-white lg:flex"
        aria-label={collapsed ? t("expand") : t("collapse")}
      >
        <ChevronsLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} aria-hidden />
        {!collapsed && t("collapse")}
      </button>
    </nav>
  );
}
