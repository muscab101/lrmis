"use client";

import type { AppError } from "@dhulka/core/errors";
import { PARTY_ROLES } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { AsyncCombobox, type ComboOption } from "@dhulka/ui/combobox";
import { Dialog, DialogTitle, SheetContent } from "@dhulka/ui/dialog";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { cn } from "@dhulka/ui/lib/cn";
import { Mono } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import { Pencil, Trash2, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { searchPartiesAction, setApplicationPartiesAction } from "@/app/[locale]/(staff)/applications/actions";
import { FormError } from "@/components/forms/form-error";
import { PartyForm } from "@/components/owners/party-form";
import { useRouter } from "@/i18n/navigation";
import type { ApplicationDetail, PartyRow } from "@/lib/server/applications";

type Row = { party: Pick<PartyRow, "id" | "full_name" | "mother_name" | "id_number" | "phone">; role: (typeof PARTY_ROLES)[number]; share: string };

interface Props {
  application: ApplicationDetail;
  editable: boolean;
  mode: "staff" | "citizen";
  districts: { id: string; name_so: string; name_en: string }[];
}

/** Owners, co-owners, agents and heirs with their shares (must total 100 % for owners). */
export function OwnersEditor({ application, editable, mode, districts }: Props) {
  const t = useTranslations("applications");
  const to = useTranslations("owners");
  const tc = useTranslations("common");
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(
    application.application_parties.map((ap) => ({
      party: ap.party,
      role: ap.role as Row["role"],
      share: ap.share_pct?.toString() ?? "",
    })),
  );
  const [adding, setAdding] = useState<ComboOption[]>([]);
  const [sheet, setSheet] = useState<"new" | PartyRow | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const ownerShare = rows.filter((r) => r.role === "owner" || r.role === "co_owner").reduce((s, r) => s + (Number(r.share) || 0), 0);
  const update = (i: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const searchParties = useCallback(async (q: string): Promise<ComboOption[]> => {
    const res = await searchPartiesAction({ q });
    if (!res.ok) return [];
    return res.data.map((p) => ({ value: JSON.stringify(p), label: p.full_name, hint: p.id_number ?? p.phone ?? "" }));
  }, []);

  function addParty(p: Row["party"]) {
    if (rows.some((r) => r.party.id === p.id)) return;
    const isFirst = rows.length === 0;
    setRows((prev) => [...prev, { party: p, role: isFirst ? "owner" : "co_owner", share: isFirst ? "100" : "" }]);
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await setApplicationPartiesAction({
      applicationId: application.id,
      parties: rows.map((r) => ({
        partyId: r.party.id,
        role: r.role,
        sharePct: r.role === "owner" || r.role === "co_owner" ? (r.share === "" ? null : Number(r.share)) : null,
      })),
    });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    setDirty(false);
    toast.success(tc("saved"));
    router.refresh();
  }

  const selfRow = mode === "citizen" ? application.application_parties.find((ap) => ap.party.id === application.applicant_party_id)?.party : null;

  return (
    <div className="space-y-4">
      <FormError error={error} />
      <ul className="divide-y rounded-md border">
        {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">{t("noOwnersYet")}</li>}
        {rows.map((r, i) => (
          <li key={r.party.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
            <div className="min-w-0">
              <div className="font-medium">{r.party.full_name}</div>
              <div className="text-xs text-muted-foreground">
                {[r.party.mother_name, r.party.id_number, r.party.phone].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            <NativeSelect
              value={r.role}
              disabled={!editable || mode === "citizen"}
              onChange={(e) => update(i, { role: e.target.value as Row["role"] })}
              aria-label={t("role")}
              className="sm:w-36"
            >
              {PARTY_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`roles.${role}`)}
                </option>
              ))}
            </NativeSelect>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={r.role === "owner" || r.role === "co_owner" ? r.share : ""}
                disabled={!editable || mode === "citizen" || !(r.role === "owner" || r.role === "co_owner")}
                onChange={(e) => update(i, { share: e.target.value })}
                className="w-24 text-end tabular"
                aria-label={t("share")}
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            {editable && mode === "staff" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setRows((prev) => prev.filter((_, j) => j !== i));
                  setDirty(true);
                }}
                aria-label={tc("delete")}
              >
                <Trash2 aria-hidden />
              </Button>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className={cn("tabular", ownerShare === 100 ? "text-success" : "text-warning")}>
          {t("sharesTotal")}: <Mono>{ownerShare.toFixed(2)}%</Mono>
        </span>
        {editable && mode === "staff" && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-64">
              <AsyncCombobox
                search={searchParties}
                value={adding}
                onChange={(o) => {
                  setAdding([]);
                  if (o[0]) addParty(JSON.parse(o[0].value) as Row["party"]);
                }}
                placeholder={t("addExistingOwner")}
                searchPlaceholder={to("searchPlaceholder")}
                emptyText={tc("noResults")}
              />
            </div>
            <Button type="button" variant="outline" onClick={() => setSheet("new")}>
              <UserPlus aria-hidden />
              {to("new")}
            </Button>
          </div>
        )}
        {editable && mode === "citizen" && selfRow && (
          <Button type="button" variant="outline" onClick={() => setSheet(selfRow as PartyRow)}>
            <Pencil aria-hidden />
            {t("completeMyDetails")}
          </Button>
        )}
      </div>
      {mode === "citizen" && <p className="text-xs text-muted-foreground">{t("citizenOwnersNote")}</p>}

      {editable && mode === "staff" && dirty && (
        <div className="flex justify-end">
          <Button type="button" loading={saving} onClick={() => void save()}>
            {t("saveOwners")}
          </Button>
        </div>
      )}

      <Dialog open={sheet !== null} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent className="max-w-2xl" closeLabel={tc("close")}>
          <div className="border-b px-6 py-5">
            <DialogTitle className="text-lg font-semibold">{sheet === "new" ? to("new") : mode === "citizen" ? t("completeMyDetails") : to("edit")}</DialogTitle>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {sheet && (
              <PartyForm
                party={sheet === "new" ? null : (sheet as PartyRow)}
                mode={mode === "citizen" ? "self" : "staff"}
                districtId={application.district_id}
                districts={mode === "staff" ? districts : undefined}
                onCancel={() => setSheet(null)}
                onSaved={(id, values) => {
                  if (sheet === "new") {
                    addParty({
                      id,
                      full_name: values.fullName ?? "",
                      mother_name: values.motherName || null,
                      id_number: values.idNumber || null,
                      phone: values.phone || null,
                    });
                    toast.success(to("addedSaveHint"));
                  } else {
                    toast.success(tc("saved"));
                  }
                  setSheet(null);
                  router.refresh();
                }}
              />
            )}
          </div>
        </SheetContent>
      </Dialog>
    </div>
  );
}
