"use client";

import { cn } from "@dhulka/ui/lib/cn";
import { Tooltip } from "@dhulka/ui/form-controls";
import { BrandLockup, BrandMark } from "@dhulka/ui/brand";
import { ChevronDown, ChevronsLeft } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import type { NavGroup, NavItem } from "./nav";

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
    .flatMap((g) => g.items.flatMap((i) => [i, ...(i.children ?? [])]))
    .flatMap((i) => [i.href, ...(i.also ?? [])].map((path) => ({ path, href: i.href })))
    .filter(({ path }) => pathname === path || pathname.startsWith(`${path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]?.href;

  return (
    <nav aria-label={t("label")} className="glass-bar flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* data-brand-logo: where the welcome screen's emblem lands after signing in. */}
      <div data-brand-logo className={cn("flex h-16 items-center border-b border-sidebar-border px-4", collapsed && "justify-center px-0")}>
        {collapsed ? <BrandMark title={tc("appShortName")} /> : <BrandLockup name={tc("appShortName")} sub={tc("orgName")} />}
      </div>

      <div className="no-scrollbar flex-1 space-y-6 overflow-y-auto px-2.5 py-5">
        {groups.map((group) => (
          <div key={group.key}>
            {!collapsed && (
              <div className="label-caps mb-1.5 px-2.5 text-sidebar-foreground/55">
                {t(`groups.${group.key}`)}
              </div>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                if (item.children && !collapsed) {
                  return (
                    <NavDropdown key={item.key} item={item} label={t(`items.${item.key}`)} activeHref={activeHref} onNavigate={onNavigate} renderLabel={(k) => t(`items.${k}`)} />
                  );
                }
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
                        : "hover:bg-sidebar-active/60 hover:text-sidebar-active-foreground",
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
        className="hidden h-11 items-center gap-2 border-t border-sidebar-border px-4 text-xs text-sidebar-foreground/70 hover:text-sidebar-active-foreground lg:flex"
        aria-label={collapsed ? t("expand") : t("collapse")}
      >
        <ChevronsLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} aria-hidden />
        {!collapsed && t("collapse")}
      </button>
    </nav>
  );
}

/** A menu item with sub-items under it: the item opens its own page; the arrow shows or hides the sub-items (shown by
 * themselves when the item or one of them is the page open). */
function NavDropdown({
  item,
  label,
  activeHref,
  onNavigate,
  renderLabel,
}: {
  item: NavItem;
  label: string;
  activeHref: string | undefined;
  onNavigate?: () => void;
  renderLabel: (key: string) => string;
}) {
  const children = item.children ?? [];
  const self = item.href === activeHref;
  const here = self || children.some((c) => c.href === activeHref);
  const [open, setOpen] = useState(here);
  const shown = open || here;
  return (
    <li>
      <div
        className={cn(
          "relative flex h-9 items-center rounded-md text-[13px] transition-colors",
          self
            ? "bg-sidebar-active font-medium text-sidebar-active-foreground before:absolute before:inset-y-2 before:-start-2.5 before:w-[3px] before:rounded-e before:bg-flag"
            : "hover:bg-sidebar-active/60 hover:text-sidebar-active-foreground",
        )}
      >
        <Link href={item.href} aria-current={self ? "page" : undefined} onClick={onNavigate} className="flex h-full flex-1 items-center gap-3 px-2.5">
          <item.icon className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 truncate">{label}</span>
        </Link>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={shown} aria-label={label} className="grid h-full w-8 place-items-center">
          <ChevronDown className={cn("size-3.5 transition-transform", shown && "rotate-180")} aria-hidden />
        </button>
      </div>
      {shown && (
        <ul className="border-sidebar-border ms-4.5 mt-0.5 space-y-0.5 border-s ps-2">
          {children.map((c) => {
            const active = c.href === activeHref;
            return (
              <li key={c.key}>
                <Link
                  href={c.href}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                  className={cn(
                    "relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors",
                    active ? "bg-sidebar-active text-sidebar-active-foreground font-medium" : "hover:bg-sidebar-active/60 hover:text-sidebar-active-foreground",
                  )}
                >
                  <span className="truncate">{renderLabel(c.key)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
