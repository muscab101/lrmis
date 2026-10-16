"use client";

import { Button } from "@dhulka/ui/button";
import { AsyncCombobox, type ComboOption } from "@dhulka/ui/combobox";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { ArrowRightLeft, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { searchPartiesAction } from "@/app/[locale]/(staff)/applications/actions";
import { createTransferAction } from "@/app/[locale]/(staff)/transfers/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { useRouter } from "@/i18n/navigation";

type Kind = "sale" | "gift" | "inheritance" | "court_order";
type Recipient = { party: ComboOption; role: "owner" | "co_owner" | "heir"; share: string };

/** Start a transfer: kind, declared value (or court order), new owners with shares that total 100 %. */
export function TransferWizard({ parcelId, transferOrders }: { parcelId: string; transferOrders: { id: string; order_no: string }[] }) {
  const t = useTranslations("legal");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("sale");
  const [value, setValue] = useState("");
  const [orderId, setOrderId] = useState(transferOrders[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [people, setPeople] = useState<Recipient[]>([]);
  const total = people.reduce((s, p) => s + (Number(p.share) || 0), 0);

  const search = useCallback(async (q: string): Promise<ComboOption[]> => {
    const res = await searchPartiesAction({ q });
    if (!res.ok) return [];
    return res.data.map((p) => ({ value: p.id, label: p.full_name, hint: p.id_number ?? p.phone ?? "" }));
  }, []);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <ArrowRightLeft aria-hidden />
        {t("startTransfer")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("startTransfer")}
        description={t("startTransferBody")}
        confirmLabel={t("createDraft")}
        submit={() =>
          createTransferAction({
            parcelId,
            kind,
            value: kind === "sale" || kind === "gift" ? value : null,
            courtOrderId: kind === "court_order" ? orderId || null : null,
            owners: people.map((p) => ({ partyId: p.party.value, role: p.role, share: p.share })),
            note,
          })
        }
        onDone={(d) => router.push(`/transfers/${(d as { id: string }).id}`)}
      >
        {(fe) => (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field id="kind" label={t("kind")}>
                <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                  {(["sale", "gift", "inheritance", "court_order"] as const).map((k) => (
                    <option key={k} value={k} disabled={k === "court_order" && transferOrders.length === 0}>
                      {t(`transferKinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {(kind === "sale" || kind === "gift") && (
                <Field id="value" label={t("declaredValue")} hint={t("declaredValueHint")} error={fe("value")} required>
                  <Input type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
                </Field>
              )}
              {kind === "court_order" && (
                <Field id="order" label={t("courtOrder")} error={fe("courtOrderId")} required>
                  <NativeSelect value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                    {transferOrders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.order_no}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            </div>
            <Field id="people" label={t("newOwners")} hint={t("newOwnersHint")} error={fe("owners")} required>
              <div className="space-y-2">
                <AsyncCombobox
                  search={search}
                  value={[]}
                  onChange={(o) => {
                    const p = o[0];
                    if (p && !people.some((x) => x.party.value === p.value)) setPeople([...people, { party: p, role: people.length ? "co_owner" : "owner", share: people.length ? "" : "100" }]);
                  }}
                  placeholder={t("addPerson")}
                  searchPlaceholder={tc("search")}
                  emptyText={tc("noResults")}
                />
                {people.map((p, i) => (
                  <div key={p.party.value} className="grid grid-cols-[1fr_8rem_5rem_auto] items-center gap-2 text-sm">
                    <span className="truncate">{p.party.label}</span>
                    <NativeSelect value={p.role} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, role: e.target.value as Recipient["role"] } : x)))} aria-label={t("role")}>
                      <option value="owner">{t("roles.owner")}</option>
                      <option value="co_owner">{t("roles.co_owner")}</option>
                      <option value="heir">{t("roles.heir")}</option>
                    </NativeSelect>
                    <Input type="number" min={0} max={100} aria-label={t("share")} value={p.share} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, share: e.target.value } : x)))} />
                    <Button size="icon-sm" variant="ghost" aria-label={t("remove")} onClick={() => setPeople(people.filter((_, j) => j !== i))}>
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ))}
                {people.length > 0 && <p className={`text-xs ${Math.abs(total - 100) < 0.01 ? "text-status-approved" : "text-status-rejected"}`}>{t("sharesTotal", { total })}</p>}
              </div>
            </Field>
            <Field id="note" label={t("noteOptional")}>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </>
        )}
      </FormDialog>
    </>
  );
}
