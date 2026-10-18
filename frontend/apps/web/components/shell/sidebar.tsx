"use client";

import { cn } from "@dhulka/ui/lib/cn";
import { Tooltip } from "@dhulka/ui/form-controls";
import { BrandLockup, BrandMark } from "@dhulka/ui/brand";
import { ChevronDown, ChevronsLeft } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { activeHref, type NavGroup } from "./nav";

interface SidebarProps {
  groups: NavGroup[];
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}

const OPEN_KEY = "lrmis.sidebar.open";

/**
 * Menu laid out like the original LRMIS: each section is a row with its icon and a chevron;
 * opening it shows its pages underneath on a tree line. The section holding the current page
 * opens by itself.
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
  const currentGroup =
    groups.find((g) => g.href === current || g.items.some((i) => i.href === current))?.key ?? null;
  const [open, setOpen] = useState<string | null>(currentGroup);

  // Follow navigation; remember the last section opened by hand.
  useEffect(() => {
    if (currentGroup && groups.find((g) => g.key === currentGroup)?.items.length)
      setOpen(currentGroup);
  }, [currentGroup, groups]);
  useEffect(() => {
    if (currentGroup) return;
    try {
      const saved = localStorage.getItem(OPEN_KEY);
      if (saved) setOpen(saved);
    } catch {
      /* storage blocked */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleSection = (key: string) =>
    setOpen((o) => {
      const next = o === key ? null : key;
      try {
        if (next) localStorage.setItem(OPEN_KEY, next);
        else localStorage.removeItem(OPEN_KEY);
      } catch {
        /* storage blocked */
      }
      return next;
    });

  const firstExtra = groups.findIndex((g) => g.extra);

  return (
    <nav
      aria-label={t("label")}
      className="bg-sidebar text-sidebar-foreground flex h-full flex-col"
    >
      <div
        className={cn(
          "border-sidebar-border bg-sidebar-head flex h-16 items-center border-b px-4",
          collapsed && "justify-center px-0",
        )}
      >
        {collapsed ? (
          <BrandMark title={tc("appShortName")} />
        ) : (
          <BrandLockup name={tc("appShortName")} sub={tc("orgName")} />
        )}
      </div>

      <ul className="flex-1 overflow-y-auto">
        {groups.map((group, index) => {
          const label = t(`sections.${group.key}`);
          const isCurrent = currentGroup === group.key;
          const isOpen = !collapsed && open === group.key && group.items.length > 0;
          const row = cn(
            "flex w-full items-center gap-3 border-b border-sidebar-border px-4 py-3 text-start text-[15px] transition-colors",
            collapsed && "justify-center px-0",
            isCurrent || isOpen
              ? "bg-sidebar-active text-sidebar-active-foreground"
              : "hover:bg-sidebar-active/70",
          );
          const icon = <group.icon className="size-5 shrink-0" aria-hidden />;
          const divider = index === firstExtra && (
            <li
              aria-hidden
              className={cn(
                "label-caps border-sidebar-border text-sidebar-foreground/60 border-b px-4 pb-1.5 pt-4",
                collapsed && "px-0 text-center",
              )}
            >
              {collapsed ? "•" : t("more")}
            </li>
          );

          // A single page (Dashboard, Collections, System Settings, Map).
          if (group.href) {
            const link = (
              <Link
                href={group.href}
                className={row}
                aria-current={current === group.href ? "page" : undefined}
                onClick={onNavigate}
              >
                {icon}
                {!collapsed && <span className="flex-1 truncate">{label}</span>}
              </Link>
            );
            return (
              <Fragment key={group.key}>
                {divider}
                <li>
                  {collapsed ? (
                    <Tooltip content={label} side="right">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              </Fragment>
            );
          }

          // A section: in the narrow rail it jumps to its first page.
          if (collapsed) {
            return (
              <Fragment key={group.key}>
                {divider}
                <li>
                  <Tooltip content={label} side="right">
                    <Link href={group.items[0]!.href} className={row} onClick={onNavigate}>
                      {icon}
                    </Link>
                  </Tooltip>
                </li>
              </Fragment>
            );
          }
          return (
            <Fragment key={group.key}>
              {divider}
              <li>
                <button
                  type="button"
                  className={row}
                  aria-expanded={isOpen}
                  aria-controls={`nav-${group.key}`}
                  onClick={() => toggleSection(group.key)}
                >
                  {icon}
                  <span className="flex-1 truncate">{label}</span>
                  <ChevronDown
                    className={cn("size-4 shrink-0 transition-transform", isOpen && "rotate-180")}
                    aria-hidden
                  />
                </button>
                {isOpen && (
                  <ul
                    id={`nav-${group.key}`}
                    className="border-sidebar-border bg-sidebar-sub border-b py-1"
                  >
                    {group.items.map((item) => {
                      const active = current === item.href;
                      return (
                        <li key={item.key} className="border-sidebar-border relative ms-7 border-s [&:not(:last-child)>a]:border-b [&:not(:last-child)>a]:border-dotted">
                          <Link
                            href={item.href}
                            aria-current={active ? "page" : undefined}
                            onClick={onNavigate}
                            className={cn(
                              "border-sidebar-border relative flex items-center gap-2 py-2.5 pe-3 ps-6 text-[14px] transition-colors",
                              "before:bg-sidebar-border before:absolute before:start-0 before:top-1/2 before:h-px before:w-3",
                              active
                                ? "text-sidebar-active-foreground font-medium"
                                : "hover:text-sidebar-active-foreground",
                            )}
                          >
                            {t(`items.${item.key}`)}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            </Fragment>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={onToggle}
        className="border-sidebar-border text-sidebar-foreground/70 hover:text-sidebar-active-foreground hidden h-11 items-center gap-2 border-t px-4 text-xs lg:flex"
        aria-label={collapsed ? t("expand") : t("collapse")}
      >
        <ChevronsLeft
          className={cn("size-4 transition-transform", collapsed && "rotate-180")}
          aria-hidden
        />
        {!collapsed && t("collapse")}
      </button>
    </nav>
  );
}
