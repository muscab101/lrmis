"use client";

import { Button } from "@dhulka/ui/button";
import { Dialog, DialogTitle, SheetContent } from "@dhulka/ui/dialog";
import { cn } from "@dhulka/ui/lib/cn";
import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { TestingBanner } from "@/components/activity/test-login";
import { WorkRecorder } from "@/components/activity/work-recorder";
import { CommandMenu } from "./command-menu";
import { EnvBadge } from "./env-badge";
import { LocaleSwitch } from "./locale-switch";
import { visibleNav } from "./nav";
import { NotificationsBell } from "./notifications-bell";
import { SystemWarning } from "./system-warning";
import { Sidebar } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

interface AppShellProps {
  /** Effective permission keys. Plain strings cross the server→client boundary; the
   *  menu (with its icon components) is built here in the browser. */
  permissions: string[];
  user: { id: string; name: string; email: string | null; photo: string | null };
  env: "development" | "staging" | "production";
  /** The user's name while a super admin is testing this account. */
  testingAs?: string | null;
  children: ReactNode;
}

const COLLAPSE_KEY = "dhulka.sidebar.collapsed";

export function AppShell({ permissions, user, env, testingAs, children }: AppShellProps) {
  const groups = useMemo(() => {
    const allowed = new Set(permissions);
    return visibleNav((p) => allowed.has(p));
  }, [permissions]);
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* storage blocked: keep default */
    }
  }, []);

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2">
        {tc("skipToContent")}
      </a>

      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 border-e border-sidebar-border transition-[width] duration-200 lg:block",
          collapsed ? "w-16" : "w-[248px]",
        )}
      >
        <Sidebar groups={groups} collapsed={collapsed} onToggle={toggle} />
      </aside>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent className="start-0 end-auto max-w-72 border-0 bg-sidebar p-0 [&>button]:text-sidebar-foreground" closeLabel={tc("close")}>
          <DialogTitle className="sr-only">{t("label")}</DialogTitle>
          <Sidebar groups={groups} collapsed={false} onToggle={() => setMobileOpen(false)} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        {testingAs && <TestingBanner name={testingAs} />}
        <SystemWarning />
        <header className="glass-bar sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background px-3 sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t("open")}>
            <Menu aria-hidden />
          </Button>
          <div className="flex min-w-10 flex-1 items-center gap-3">
            <CommandMenu groups={groups} />
            <EnvBadge env={env} />
          </div>
          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
            <WorkRecorder userId={user.id} />
            <LocaleSwitch />
            <ThemeToggle />
            <NotificationsBell userId={user.id} />
            <div className="ms-1">
              <UserMenu name={user.name} email={user.email} photo={user.photo} />
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-8 sm:px-6 lg:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
