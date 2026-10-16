"use client";

import { CreditCard, Home, MapPinned, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

const ITEMS = [
  { key: "home", href: "/portal", icon: Home },
  { key: "bills", href: "/portal/bills", icon: CreditCard },
  { key: "track", href: "/portal/track", icon: MapPinned },
  { key: "assistant", href: "/portal/assistant", icon: Sparkles },
] as const;

export function PortalNav() {
  const t = useTranslations("portalNav");
  const path = usePathname();
  const active = (href: string) => (href === "/portal" ? path === "/portal" || path.startsWith("/portal/parcels") : path.startsWith(href) || (href === "/portal/bills" && path.startsWith("/portal/pay")) || (href === "/portal/track" && path.startsWith("/portal/applications")));
  return (
    <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4" aria-label={t("label")}>
      {ITEMS.map(({ key, href, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={active(href) ? "page" : undefined}
          className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap ${active(href) ? "border-flag font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          <Icon className="size-4" aria-hidden />
          {t(key)}
        </Link>
      ))}
    </nav>
  );
}
