"use client";

import { toast } from "@dhulka/ui/toaster";
import { useTranslations } from "next-intl";
import { PartyForm } from "@/components/owners/party-form";
import { useRouter } from "@/i18n/navigation";

export function NewOwnerForm({
  districts,
  canApply,
  fromZone = null,
}: {
  districts: { id: string; name_so: string; name_en: string }[];
  canApply: boolean;
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
      submitLabel={fromZone ? t("saveAndAddLand") : canApply ? t("saveAndAddParcel") : undefined}
      onSaved={(id) => {
        if (fromZone) {
          toast.success(t("createdNextLand"));
          return router.push(`/parcels/new?${new URLSearchParams({ nbhd: fromZone.nbhd, zone: fromZone.zone, owner: id })}`);
        }
        if (!canApply) {
          toast.success(t("created"));
          return router.push("/owners?stage=draft");
        }
        toast.success(t("createdNext"));
        // Straight on to the owner's land parcel (step 1 of the application).
        router.push(`/applications/new?owner=${id}`);
      }}
    />
  );
}
