"use client";

import { toast } from "@dhulka/ui/toaster";
import { useTranslations } from "next-intl";
import { PartyForm } from "@/components/owners/party-form";
import { useRouter } from "@/i18n/navigation";

export function NewOwnerForm({
  districts,
  fromZone = null,
}: {
  districts: { id: string; name_so: string; name_en: string }[];
  /** Opened from a survey zone: next is that zone's Add land for this owner. */
  fromZone?: { zone: string; nbhd: string } | null;
}) {
  const t = useTranslations("owners");
  const router = useRouter();
  return (
    <PartyForm
      party={null}
      districts={districts}
      onCancel={() => router.back()}
      submitLabel={fromZone ? t("saveAndAddLand") : undefined}
      onSaved={(id) => {
        if (fromZone) {
          toast.success(t("createdNextLand"));
          return router.push(`/parcels/new?${new URLSearchParams({ nbhd: fromZone.nbhd, zone: fromZone.zone, owner: id })}`);
        }
        toast.success(t("created"));
        router.push(`/owners/${id}`);
      }}
    />
  );
}
