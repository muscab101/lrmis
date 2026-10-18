"use client";

import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";

export function OwnersFilters({ q, kind, stage, total }: { q: string; kind: string; stage: string; total: number }) {
  const t = useTranslations("owners");
  const tc = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [term, setTerm] = useState(q);

  const go = (next: { q?: string; kind?: string }) => {
    const p = new URLSearchParams({ stage });
    const nq = next.q ?? term;
    const nk = next.kind ?? kind;
    if (nq) p.set("q", nq);
    if (nk) p.set("kind", nk);
    start(() => router.replace(`${pathname}?${p}`));
  };

  useEffect(() => {
    if (term === q) return;
    const h = setTimeout(() => go({ q: term }), 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b p-3">
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t("searchPlaceholder")} className="max-w-xs" aria-label={tc("search")} />
      <div className="w-44">
        <NativeSelect value={kind} onChange={(e) => go({ kind: e.target.value })} aria-label={t("kind")}>
          <option value="">{t("anyKind")}</option>
          <option value="person">{t("kind_person")}</option>
          <option value="organisation">{t("kind_organisation")}</option>
        </NativeSelect>
      </div>
      <span className="ms-auto text-xs text-muted-foreground" aria-live="polite">
        {pending ? tc("loading") : t("count", { count: total })}
      </span>
    </div>
  );
}
