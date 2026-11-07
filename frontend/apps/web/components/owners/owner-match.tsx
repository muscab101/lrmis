"use client";

import { Button } from "@dhulka/ui/button";
import { GitMerge, Home, UserCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { type OwnerMatch, ownerMatchAction } from "@/app/[locale]/(staff)/owners/actions";

/**
 * While a name and phone are typed: if an owner with that same name and phone is already on the register, offer
 * "Merge" so the new house goes under them instead of making a second copy of the same person.
 */
export function OwnerMatchNotice({
  name,
  phone,
  onMerge,
}: {
  name: string;
  phone: string;
  onMerge: (m: OwnerMatch) => void;
}) {
  const t = useTranslations("owners.match");
  const locale = useLocale();
  const [matches, setMatches] = useState<OwnerMatch[]>([]);

  useEffect(() => {
    const digits = phone.replace(/\D/g, "");
    if (name.trim().length < 3 || digits.length < 7) {
      setMatches([]);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const res = await ownerMatchAction({ name, phone });
      if (live) setMatches(res.ok ? (res.data ?? []) : []);
    }, 450);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [name, phone]);

  if (matches.length === 0) return null;
  return (
    <div className="space-y-2" role="status">
      {matches.map((m) => (
        <div
          key={m.party_id}
          className="border-primary/40 bg-primary/5 flex flex-wrap items-start gap-3 rounded-md border p-3 text-sm"
        >
          <UserCheck className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium">{t("found", { name: m.full_name })}</p>
            <p className="text-muted-foreground">
              <span className="font-mono">{m.phone}</span>
              {(locale === "so" ? m.district_so : m.district_en) &&
                ` · ${locale === "so" ? m.district_so : m.district_en}`}
              {" · "}
              {t("houses", { n: m.houses.length })}
            </p>
            {m.houses.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {m.houses.map((h, i) => (
                  <li
                    key={i}
                    className="bg-background inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs"
                  >
                    <Home className="size-3" aria-hidden />
                    <span className="font-mono">{h.pun ?? h.house_no ?? "—"}</span>
                    {(locale === "so" ? h.neighbourhood_so : h.neighbourhood_en) && (
                      <span className="text-muted-foreground">
                        {locale === "so" ? h.neighbourhood_so : h.neighbourhood_en}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-muted-foreground text-xs">{t("hint")}</p>
          </div>
          <Button type="button" size="sm" onClick={() => onMerge(m)}>
            <GitMerge aria-hidden />
            {t("merge")}
          </Button>
        </div>
      ))}
    </div>
  );
}
