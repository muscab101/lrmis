"use client";

import { Button } from "@dhulka/ui/button";
import { AsyncCombobox, type ComboOption } from "@dhulka/ui/combobox";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Textarea } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { ArrowRightLeft, Trash2, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { searchPartiesAction } from "@/app/[locale]/(staff)/applications/actions";
import { createTransferAction } from "@/app/[locale]/(staff)/transfers/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { PartyForm } from "@/components/owners/party-form";
import { useRouter } from "@/i18n/navigation";

type Kind = "sale" | "gift" | "inheritance" | "court_order";
type Recipient = { party: ComboOption; role: "owner" | "co_owner" | "heir" };

/** Equal shares that add up to exactly 100 % (the last one takes the rounding). */
function equalShares(n: number): number[] {
  const each = Math.floor(10000 / n) / 100;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? Math.round((100 - each * (n - 1)) * 100) / 100 : each));
}

/** Start a transfer: kind (or court order), and the new owners (who share the land equally). */
export function TransferWizard({
  parcelId,
  transferOrders,
  newOwner,
}: {
  parcelId: string;
  transferOrders: { id: string; order_no: string }[];
  /** Staff who may create owners can register a new one here (the full owner form) and add them straight away. */
  newOwner?: { districts: { id: string; name_so: string; name_en: string }[]; districtId: string | null } | null;
}) {
  const t = useTranslations("legal");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("sale");
  const [orderId, setOrderId] = useState(transferOrders[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [people, setPeople] = useState<Recipient[]>([]);
  const [creating, setCreating] = useState(false);
  // The owner just added (picked or newly registered) stays shown in the search box.
  const [lastAdded, setLastAdded] = useState<ComboOption | null>(null);
  const addPerson = (p: ComboOption) => {
    setLastAdded(p);
    setPeople((cur) => (cur.some((x) => x.party.value === p.value) ? cur : [...cur, { party: p, role: cur.length ? "co_owner" : "owner" }]));
  };

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
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setCreating(false);
            setLastAdded(null);
          }
        }}
        title={t("startTransfer")}
        description={t("startTransferBody")}
        confirmLabel={t("createDraft")}
        submit={() =>
          createTransferAction({
            parcelId,
            kind,
            value: null,
            courtOrderId: kind === "court_order" ? orderId || null : null,
            owners: people.map((p, i) => ({ partyId: p.party.value, role: p.role, share: equalShares(people.length)[i]! })),
            note,
          })
        }
        onDone={(d) => router.push(`/transfers/${(d as { id: string }).id}`)}
        className={creating ? "max-w-3xl" : undefined}
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
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-48 flex-1">
                    <AsyncCombobox
                      search={search}
                      value={lastAdded && people.some((x) => x.party.value === lastAdded.value) ? [lastAdded] : []}
                      onChange={(o) => o[0] && addPerson(o[0])}
                      placeholder={t("addPerson")}
                      searchPlaceholder={tc("search")}
                      emptyText={tc("noResults")}
                    />
                  </div>
                  {newOwner && !creating && (
                    <Button type="button" size="sm" variant="outline" onClick={() => setCreating(true)}>
                      <UserPlus aria-hidden />
                      {t("newOwnerButton")}
                    </Button>
                  )}
                </div>
                {/* Register a new owner right here, below the search; when saved they join the new owners. */}
                {newOwner && creating && (
                  <div className="bg-muted/40 space-y-3 rounded-md border p-4">
                    <div>
                      <p className="text-sm font-semibold">{t("newOwnerTitle")}</p>
                      <p className="text-muted-foreground text-xs">{t("newOwnerBody")}</p>
                    </div>
                    <PartyForm
                      party={null}
                      districts={newOwner.districts}
                      districtId={newOwner.districtId}
                      onCancel={() => setCreating(false)}
                      submitLabel={t("newOwnerSave")}
                      onSaved={(id, values) => {
                        addPerson({ value: id, label: values.fullName, hint: values.idNumber || values.phone || "" });
                        setCreating(false);
                        toast.success(t("newOwnerAdded", { name: values.fullName }));
                      }}
                    />
                  </div>
                )}
                {people.map((p, i) => (
                  <div key={p.party.value} className="grid grid-cols-[1fr_8rem_auto] items-center gap-2 text-sm">
                    <span className="truncate">{p.party.label}</span>
                    <NativeSelect value={p.role} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, role: e.target.value as Recipient["role"] } : x)))} aria-label={t("role")}>
                      <option value="owner">{t("roles.owner")}</option>
                      <option value="co_owner">{t("roles.co_owner")}</option>
                      <option value="heir">{t("roles.heir")}</option>
                    </NativeSelect>
                    <Button size="icon-sm" variant="ghost" aria-label={t("remove")} onClick={() => setPeople(people.filter((_, j) => j !== i))}>
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ))}
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
