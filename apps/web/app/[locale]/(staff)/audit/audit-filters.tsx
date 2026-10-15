"use client";

import { Button } from "@dhulka/ui/button";
import { Input } from "@dhulka/ui/input";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

export function AuditFilters({ action, table, record }: { action: string; table: string; record: string }) {
  const t = useTranslations("audit");
  const router = useRouter();
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const params = new URLSearchParams();
        for (const k of ["action", "table", "record"]) {
          const v = String(data.get(k) ?? "").trim();
          if (v) params.set(k, v);
        }
        router.push(`/audit?${params}`);
      }}
    >
      <Input name="action" defaultValue={action} placeholder={t("filterAction")} className="w-44" aria-label={t("action")} />
      <Input name="table" defaultValue={table} placeholder={t("filterTable")} className="w-36" aria-label={t("table")} />
      <Input name="record" defaultValue={record} placeholder={t("filterRecord")} className="w-64" aria-label={t("record")} />
      <Button type="submit" variant="outline">
        {t("apply")}
      </Button>
    </form>
  );
}
