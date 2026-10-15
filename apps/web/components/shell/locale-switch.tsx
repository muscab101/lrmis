"use client";

import { Button } from "@dhulka/ui/button";
import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Suspense, useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";

function SwitchButton({ query }: { query: string }) {
  const locale = useLocale();
  const t = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const next = locale === "so" ? "en" : "so";
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label={t("switchLanguage")}
      onClick={() => start(() => router.replace(`${pathname}${query ? `?${query}` : ""}`, { locale: next }))}
    >
      <Languages aria-hidden />
      <span className="hidden font-medium sm:inline">{next === "en" ? "English" : "Soomaali"}</span>
      <span className="font-medium uppercase sm:hidden">{next}</span>
    </Button>
  );
}

function WithQuery() {
  return <SwitchButton query={useSearchParams().toString()} />;
}

/** Keeps the current page and its filters when switching Somali ⇄ English. */
export function LocaleSwitch() {
  return (
    <Suspense fallback={<SwitchButton query="" />}>
      <WithQuery />
    </Suspense>
  );
}
