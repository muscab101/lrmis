"use client";

import { toast } from "@dhulka/ui/toaster";
import { useTranslations } from "next-intl";
import { PartyForm } from "@/components/owners/party-form";
import { useRouter } from "@/i18n/navigation";

export function NewOwnerForm({ districts, canApply }: { districts: { id: string; name_so: string; name_en: string }[]; canApply: boolean }) {
  const t = useTranslations("owners");
  const router = useRouter();
  return (
    <PartyForm
      party={null}
      districts={districts}
      onCancel={() => router.back()}
      onSaved={(id) => {
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
