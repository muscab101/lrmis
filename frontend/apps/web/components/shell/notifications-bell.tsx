"use client";

import { Button } from "@dhulka/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@dhulka/ui/dropdown-menu";
import { Bell } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

interface Notification {
  id: string;
  title_so: string;
  title_en: string;
  body_so: string;
  body_en: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/** Live notifications (Supabase Realtime) for the signed-in user. */
export function NotificationsBell({ userId }: { userId: string }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const format = useFormatter();
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Notification[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("notifications")
      .select("id, title_so, title_en, body_so, body_en, link, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    setItems((data as Notification[] | null) ?? []);
  }, [supabase]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => void load())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [supabase, userId, load]);

  const unread = items.filter((n) => !n.read_at).length;

  return (
    <DropdownMenu
      onOpenChange={async (open) => {
        if (!open && unread > 0) {
          await supabase.rpc("mark_notifications_read", { p_ids: null });
          void load();
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t("notificationsCount", { count: unread })}>
          <Bell aria-hidden />
          {unread > 0 && (
            <span className="absolute end-1 top-1 flex min-w-4 items-center justify-center rounded-sm bg-danger px-1 text-[10px] font-semibold text-danger-foreground ring-2 ring-background">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>{t("notifications")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("noNotifications")}</p>}
        <ul className="max-h-80 overflow-y-auto">
          {items.map((n) => (
            <li key={n.id} className="flex gap-2 rounded-sm px-2 py-2 text-sm">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-primary"}`} aria-hidden />
              <div className="min-w-0">
                {/* With a link (e.g. a new house to collect → Cashier) the notice opens it. */}
                {n.link ? (
                  <Link href={n.link} className="leading-snug hover:text-primary hover:underline">
                    {locale === "so" ? n.title_so : n.title_en}
                  </Link>
                ) : (
                  <p className="leading-snug">{locale === "so" ? n.title_so : n.title_en}</p>
                )}
                {(locale === "so" ? n.body_so : n.body_en) && <p className="text-xs text-muted-foreground">{locale === "so" ? n.body_so : n.body_en}</p>}
                <p className="text-xs text-muted-foreground">{format.relativeTime(new Date(n.created_at))}</p>
              </div>
            </li>
          ))}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
