"use client";

import { Button } from "@dhulka/ui/button";
import { AsyncCombobox, type ComboOption } from "@dhulka/ui/combobox";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Textarea } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { ArrowRightLeft, Paperclip, Trash2, UserPlus } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { searchPartiesAction } from "@/app/[locale]/(staff)/applications/actions";
import { createTransferAction } from "@/app/[locale]/(staff)/transfers/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { PartyForm } from "@/components/owners/party-form";
import { DocIcon, formatBytes, uploadTransferFiles } from "@/components/legal/transfer-documents";
import { TRANSFER_DOC_ACCEPT } from "@/lib/transfer-files";
import { useErrorMessage, useValidationMessage } from "@/lib/client/errors";
import { Link, useRouter } from "@/i18n/navigation";
import type { TransferTypeChoice } from "@/lib/server/legal";

type Recipient = { party: ComboOption; role: "owner" | "co_owner" | "heir" };

/** Equal shares that add up to exactly 100 % (the last one takes the rounding). */
function equalShares(n: number): number[] {
  const each = Math.floor(10000 / n) / 100;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? Math.round((100 - each * (n - 1)) * 100) / 100 : each));
}

/** Start a transfer: its type (from Valuation → Transfer types), and the new owners (who share the land equally). */
export function TransferWizard({
  parcelId,
  types: allTypes,
  newOwner,
  plain = false,
}: {
  /** An outline button (in lists of actions) instead of the main blue one. */
  plain?: boolean;
  parcelId: string;
  types: TransferTypeChoice[];
  /** Staff who may create owners can register a new one here (the full owner form) and add them straight away. */
  newOwner?: { districts: { id: string; name_so: string; name_en: string }[]; districtId: string | null } | null;
}) {
  const t = useTranslations("legal");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const locale = useLocale();
  const format = useFormatter();
  // Court orders are not used any more: court-order types are not offered.
  const types = allTypes.filter((x) => x.works_as !== "court_order");
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const typeName = (x: TransferTypeChoice) => (locale === "so" ? x.name_so : x.name_en);
  const [note, setNote] = useState("");
  const [people, setPeople] = useState<Recipient[]>([]);
  const [creating, setCreating] = useState(false);
  // The supporting documents (required): uploaded once the draft exists.
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const em = useErrorMessage();
  const vm = useValidationMessage();
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
      <Button size="sm" variant={plain ? "outline" : "default"} onClick={() => setOpen(true)}>
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
            setFiles([]);
          }
        }}
        title={t("startTransfer")}
        description={t("startTransferBody")}
        confirmLabel={t("createDraft")}
        submit={async () => {
          if (files.length === 0) {
            return { ok: false as const, error: { code: "VALIDATION" as const, requestId: "", fieldErrors: { documents: ["validation.documents_required"] } } };
          }
          const res = await createTransferAction({
            parcelId,
            typeId,
            courtOrderId: null,
            owners: people.map((p, i) => ({ partyId: p.party.value, role: p.role, share: equalShares(people.length)[i]! })),
            note,
          });
          if (!res.ok) return res;
          const failed = await uploadTransferFiles((res.data as { id: string }).id, files, (m) => toast.error(m), { em, vm });
          if (failed) toast.error(t("documentsSomeFailed"));
          return res;
        }}
        onDone={(d) => router.push(`/transfers/${(d as { id: string }).id}`)}
        className={creating ? "max-w-3xl" : undefined}
      >
        {(fe) => (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field
                id="kind"
                label={t("kind")}
                error={fe("typeId")}
                hint={types.length === 0 ? undefined : t("typeDuty", { amount: format.number(Number(types.find((x) => x.id === typeId)?.duty ?? 0), { style: "currency", currency: "USD" }) })}
                required
              >
                {types.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {t("noTransferTypes")}{" "}
                    <Link href="/valuation?tab=transfer_types" className="text-primary hover:underline">
                      {t("addTransferTypes")}
                    </Link>
                  </p>
                ) : (
                  <NativeSelect value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                    {types.map((x) => (
                      <option key={x.id} value={x.id}>
                        {typeName(x)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
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
            <Field id="documents" label={t("documents")} hint={t("documentsHint")} error={fe("documents")} required>
              <div className="space-y-2">
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept={TRANSFER_DOC_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    setFiles((cur) => [...cur, ...picked.filter((f) => !cur.some((c) => c.name === f.name && c.size === f.size))]);
                    e.target.value = "";
                  }}
                />
                <Button type="button" size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
                  <Paperclip aria-hidden />
                  {t("addDocuments")}
                </Button>
                {files.map((f, i) => (
                  <div key={`${f.name}-${f.size}`} className="flex items-center gap-2 text-sm">
                    <DocIcon mime={f.type} className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={t("removeDocument")} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
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
