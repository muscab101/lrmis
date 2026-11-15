"use client";

import { CreditCard, Home, MapPinned, ScanSearch, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

const ITEMS = [
  { key: "home", href: "/portal", icon: Home },
  { key: "bills", href: "/portal/bills", icon: CreditCard },
  { key: "track", href: "/portal/track", icon: MapPinned },
  { key: "verify", href: "/portal/verify", icon: ScanSearch },
  { key: "assistant", href: "/portal/assistant", icon: Sparkles },
] as const;

/** `verify`: the citizen has the Verify power (Admin → Roles → Citizen). */
export function PortalNav({ verify = true }: { verify?: boolean }) {
  const t = useTranslations("portalNav");
  const path = usePathname();
  const active = (href: string) => (href === "/portal" ? path === "/portal" || path.startsWith("/portal/parcels") : path.startsWith(href) || (href === "/portal/bills" && path.startsWith("/portal/pay")));
  return (
    <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4" aria-label={t("label")}>
      {ITEMS.filter((i) => i.key !== "verify" || verify).map(({ key, href, icon: Icon }) => (
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
