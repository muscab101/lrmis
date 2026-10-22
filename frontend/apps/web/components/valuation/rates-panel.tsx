"use client";

import type { ComboOption } from "@dhulka/ui/combobox";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Plus, Scale } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { deleteRateAction, setRateAction, updateRateAction } from "@/app/[locale]/(staff)/valuation/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { RateRow } from "@/lib/server/valuation";
import { NeighbourhoodPicker } from "./neighbourhood-picker";
import { DeleteDialog, EditDeleteKeys } from "./row-actions";

const USES = ["residential", "commercial", "mixed", "state", "agricultural", "other"] as const;

export function RatesPanel({ rates, selected, canEdit }: { rates: RateRow[]; selected: ComboOption | null; canEdit: boolean }) {
  const t = useTranslations("valuation");
  const ts = useTranslations("stage");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const today = new Date().toISOString().slice(0, 10);
  const [deleting, setDeleting] = useState<RateRow | null>(null);
  const [form, setForm] = useState<null | { id?: string; nbhd: ComboOption | null; landUse: (typeof USES)[number]; developed: boolean; rate: string; service: string; validFrom: string; note: string }>(null);
  const money = (n: number) => format.number(Number(n), { style: "currency", currency: "USD", maximumFractionDigits: 4 });
  // Rows newer than or equal to today's date per (use, developed) are "in force"; the newest past one is current.
  const current = new Set<string>();
  const seen = new Set<string>();
  for (const r of rates) {
    const k = `${r.neighbourhood?.id}|${r.land_use}|${r.developed}`;
    if (r.valid_from <= today && !seen.has(k)) {
      seen.add(k);
      current.add(r.id);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="w-full max-w-sm">
          <NeighbourhoodPicker value={selected} onChange={(o) => router.replace(`${pathname}?tab=rates${o ? `&n=${o.value}` : ""}`)} />
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setForm({ nbhd: selected, landUse: "residential", developed: true, rate: "", service: "0", validFrom: `${new Date().getFullYear() + 1}-01-01`, note: "" })}>
            <Plus aria-hidden />
            {t("addRate")}
          </Button>
        )}
      </div>
      {rates.length === 0 ? (
        <EmptyState icon={<Scale />} title={t("noRates")} description={t("noRatesBody")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("neighbourhood")}</TableHead>
              <TableHead>{ts("landUse")}</TableHead>
              <TableHead>{t("developed")}</TableHead>
              <TableHead className="text-end">{t("rateM2")}</TableHead>
              <TableHead className="text-end">{t("serviceCharge")}</TableHead>
              <TableHead>{t("validFrom")}</TableHead>
              {canEdit && <TableHead className="w-20" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.map((r) => (
              <TableRow key={r.id} className={current.has(r.id) ? "" : "text-muted-foreground"}>
                <TableCell className="text-sm">
                  {r.neighbourhood ? (locale === "so" ? r.neighbourhood.name_so : r.neighbourhood.name_en) : "—"}{" "}
                  <Mono className="text-xs text-muted-foreground">{r.neighbourhood?.code}</Mono>
                </TableCell>
                <TableCell className="text-sm">{ts(`landUses.${r.land_use}`)}</TableCell>
                <TableCell className="text-sm">{r.developed ? t("yes") : t("no")}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{money(r.rate_m2)}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{money(r.service_charge)}</TableCell>
                <TableCell className="text-sm">
                  {format.dateTime(new Date(r.valid_from), { dateStyle: "medium" })}
                  {current.has(r.id) && <span className="ms-2 rounded-sm bg-status-approved/10 px-1.5 text-[11px] text-status-approved">{t("inForce")}</span>}
                  {r.valid_from > today && <span className="ms-2 rounded-sm bg-muted px-1.5 text-[11px]">{t("upcoming")}</span>}
                </TableCell>
                {canEdit && (
                  <TableCell className="text-end">
                    <EditDeleteKeys
                      onEdit={() =>
                        setForm({
                          id: r.id,
                          nbhd: r.neighbourhood ? { value: r.neighbourhood.id, label: locale === "so" ? r.neighbourhood.name_so : r.neighbourhood.name_en, hint: r.neighbourhood.code } : null,
                          landUse: r.land_use as (typeof USES)[number],
                          developed: r.developed,
                          rate: String(r.rate_m2),
                          service: String(r.service_charge),
                          validFrom: r.valid_from,
                          note: r.note ?? "",
                        })
                      }
                      onDelete={() => setDeleting(r)}
                    />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <FormDialog
        open={form !== null}
        onOpenChange={(o) => !o && setForm(null)}
        title={form?.id ? t("editRate") : t("addRate")}
        description={form?.id ? t("editRateBody") : t("addRateBody")}
        confirmLabel={t("save")}
        successMessage={t("rateSaved")}
        submit={() =>
          form!.id
            ? updateRateAction({ id: form!.id, rate: form!.rate, serviceCharge: form!.service, validFrom: form!.validFrom, note: form!.note })
            : setRateAction({
            neighbourhoodId: form!.nbhd?.value ?? "",
            landUse: form!.landUse,
            developed: form!.developed,
            rate: form!.rate,
            serviceCharge: form!.service,
            validFrom: form!.validFrom,
            note: form!.note,
          })
        }
      >
        {(fe) =>
          form && (
            <>
              <Field id="nbhd" label={t("neighbourhood")} error={fe("neighbourhoodId")} required>
                <div className={form.id ? "pointer-events-none opacity-60" : undefined}>
                  <NeighbourhoodPicker value={form.nbhd} onChange={(o) => setForm({ ...form, nbhd: o })} />
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="use" label={ts("landUse")}>
                  <NativeSelect value={form.landUse} disabled={!!form.id} onChange={(e) => setForm({ ...form, landUse: e.target.value as (typeof USES)[number] })}>
                    {USES.map((u) => (
                      <option key={u} value={u}>
                        {ts(`landUses.${u}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id="developed" label={t("developed")}>
                  <NativeSelect value={form.developed ? "1" : "0"} disabled={!!form.id} onChange={(e) => setForm({ ...form, developed: e.target.value === "1" })}>
                    <option value="1">{t("yes")}</option>
                    <option value="0">{t("no")}</option>
                  </NativeSelect>
                </Field>
                <Field id="rate" label={t("rateM2")} error={fe("rate")} required>
                  <Input type="number" min={0} step="0.0001" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
                </Field>
                <Field id="service" label={t("serviceCharge")} error={fe("serviceCharge")}>
                  <Input type="number" min={0} step="0.01" value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} />
                </Field>
              </div>
              <Field id="validFrom" label={t("validFrom")} hint={t("validFromHint")} error={fe("validFrom")} required>
                <Input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
              </Field>
              <Field id="note" label={t("noteOptional")}>
                <Input value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </Field>
            </>
          )
        }
      </FormDialog>

      <DeleteDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("deleteRateTitle")}
        body={t("deleteRateBody")}
        submit={() => deleteRateAction({ id: deleting!.id })}
      />
    </div>
  );
}
