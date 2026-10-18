"use client";

import { toast } from "@dhulka/ui/toaster";
import { useTranslations } from "next-intl";
import { PartyForm } from "@/components/owners/party-form";
import { useRouter } from "@/i18n/navigation";

export function NewOwnerForm({ districts }: { districts: { id: string; name_so: string; name_en: string }[] }) {
  const t = useTranslations("owners");
  const router = useRouter();
  return (
    <PartyForm
      party={null}
      districts={districts}
      onCancel={() => router.back()}
      onSaved={() => {
        toast.success(t("created"));
        // Back to Partial registration, where the new draft can be checked and moved to the register.
        router.push("/owners?stage=draft");
      }}
    />
  );
}
