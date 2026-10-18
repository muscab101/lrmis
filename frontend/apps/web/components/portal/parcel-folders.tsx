"use client";

import { useFormatter, useTranslations } from "next-intl";
import GlassFolder, { type ArtPreset, type FolderFile } from "@/components/ui/glass-folder-cards";
import { useRouter } from "@/i18n/navigation";
import type { CitizenOverview } from "@/lib/server/portal";

const ART_BY_USE: Record<string, ArtPreset> = {
  residential: "aurora",
  commercial: "ember",
  agricultural: "verdant",
  industrial: "dusk",
};

/**
 * "My files": one glass folder per property, holding its title documents, the bills still
 * to pay and the receipts. Opening a file goes to its page (verify, pay, or the property).
 */
export function ParcelFolders({ overview }: { overview: CitizenOverview }) {
  const t = useTranslations("portal");
  const tf = useTranslations("portal.folder");
  const format = useFormatter();
  const router = useRouter();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const date = (d: string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const text = {
    open: tf("open"),
    close: tf("close"),
    openFolder: tf("openFolder"),
    closeFolder: tf("closeFolder"),
    items: (count: number) => tf("items", { count }),
    contents: tf("contents"),
    options: tf("options"),
    addTo: tf("addTo"),
    moreFor: tf("moreFor"),
    untitled: tf("untitled"),
    justNow: tf("justNow"),
  };

  return (
    <ul className="flex flex-wrap justify-center gap-x-10 gap-y-8 pt-10 sm:justify-start">
      {overview.parcels.map((p, n) => {
        const files: (FolderFile & { to: string })[] = [
          ...overview.payments
            .filter((r) => r.pun && r.pun === p.pun)
            .slice(0, 2)
            .map((r) => ({
              name: `${t("receipt")} ${r.receipt_no}`,
              meta: usd(r.amount),
              to: `/portal/parcels/${p.id}`,
            })),
          ...p.invoices
            .filter((i) => Number(i.balance) > 0 && i.token)
            .map((i) => ({
              name: `${t("bill")} ${i.number}`,
              meta: usd(i.balance),
              to: `/pay/${i.token}`,
            })),
          ...p.documents.map((d) => ({
            name: t(`docTypes.${d.type}`),
            meta: date(d.issued_at),
            art: (d.type === "certificate" ? "glacier" : "dusk") as ArtPreset,
            to: `/verify/${d.verify_code}`,
          })),
        ];
        const next = p.invoices.find((i) => Number(i.balance) > 0 && i.token);
        return (
          <li key={p.id}>
            <GlassFolder
              label={p.pun ?? "—"}
              art={ART_BY_USE[p.land_use] ?? "glacier"}
              seed={n + 3}
              width={300}
              files={files}
              action="more"
              appearDelay={n * 140}
              text={text}
              menu={[
                { label: t("details"), onSelect: () => router.push(`/portal/parcels/${p.id}`) },
                ...(next ? [{ label: t("payNow"), onSelect: () => router.push(`/pay/${next.token}`) }] : []),
              ]}
              onFileSelect={(_, i) => router.push(files[i]!.to)}
            />
          </li>
        );
      })}
    </ul>
  );
}
