"use client";

import { toast } from "@dhulka/ui/toaster";
import { useTranslations } from "next-intl";
import { PartyForm } from "@/components/owners/party-form";
import { useRouter } from "@/i18n/navigation";

/** The owner form on the survey zone's New owner page: after saving (or using the same owner already on the register), on to Add land for them. */
export function ZoneOwnerForm({
  zoneId,
  districts,
  districtId,
  canAddLand,
}: {
  zoneId: string;
  districts: { id: string; name_so: string; name_en: string }[];
  districtId: string | null;
  canAddLand: boolean;
}) {
  const t = useTranslations("owners");
  const router = useRouter();
  const next = (owner: string) => router.push(canAddLand ? `/surveys/zones/${zoneId}/land?owner=${owner}` : `/surveys/zones/${zoneId}`);
  return (
    <PartyForm
      party={null}
      districts={districts}
      districtId={districtId}
      onCancel={() => router.push(`/surveys/zones/${zoneId}`)}
      submitLabel={canAddLand ? t("saveAndAddLand") : undefined}
      onMerge={(m) => {
        toast.success(t("match.mergedNextLand", { name: m.full_name }));
        next(m.party_id);
      }}
      onSaved={(id) => {
        toast.success(canAddLand ? t("createdNextLand") : t("created"));
        next(id);
      }}
    />
  );
}
