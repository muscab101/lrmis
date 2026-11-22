"use client";

import { Button } from "@dhulka/ui/button";
import { AsyncCombobox, type ComboOption } from "@dhulka/ui/combobox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@dhulka/ui/dropdown-menu";
import { Field } from "@dhulka/ui/field";
import { NativeSelect, Tooltip } from "@dhulka/ui/form-controls";
import { Ellipsis, Info, Pencil, UserCog } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { searchPartiesAction } from "@/app/[locale]/(staff)/applications/actions";
import { EditOwner } from "@/app/[locale]/(staff)/owners/[id]/edit-owner";
import { buildingManagerSetAction } from "@/app/[locale]/(staff)/parcels/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link, useRouter } from "@/i18n/navigation";
import type { PartyRow } from "@/lib/server/applications";

type Districts = { id: string; name_so: string; name_en: string }[];

/** Row keys for a building manager: view their record, edit their details, and give a building to another manager. */
export function ManagerRowActions({
  partyId,
  party,
  buildings,
  districts,
  can,
}: {
  partyId: string | null;
  /** The manager's full record, for Edit (null for a name typed before managers were people). */
  party: PartyRow | null;
  buildings: { id: string; label: string }[];
  districts: Districts;
  can: { edit: boolean; change: boolean };
}) {
  const t = useTranslations("managers");
  const tc = useTranslations("common");
  const tb = useTranslations("parcels.buildingExtras");
  const router = useRouter();
  const [dialog, setDialog] = useState<"edit" | "change" | null>(null);
  const [building, setBuilding] = useState(buildings[0]?.id ?? "");
  const [picked, setPicked] = useState<ComboOption | null>(null);
  const icon = (label: string, node: React.ReactElement) => <Tooltip content={label}>{node}</Tooltip>;
  const canEdit = can.edit && !!party;
  const search = useCallback(async (q: string): Promise<ComboOption[]> => {
    const res = await searchPartiesAction({ q });
    return res.ok ? res.data.filter((p) => p.id !== partyId).map((p) => ({ value: p.id, label: p.full_name, hint: p.phone ?? p.id_number ?? "" })) : [];
  }, [partyId]);
  const openChange = () => {
    setBuilding(buildings[0]?.id ?? "");
    setPicked(null);
    setDialog("change");
  };

  return (
    <div className="flex items-center justify-end gap-0.5">
      {/* Phones: one "⋯" menu. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="sm:hidden" aria-label={t("actions")}>
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {partyId && (
            <DropdownMenuItem onSelect={() => router.push(`/owners/${partyId}`)}>
              <Info aria-hidden />
              {t("actionView")}
            </DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem onSelect={() => setDialog("edit")}>
              <Pencil aria-hidden />
              {tc("edit")}
            </DropdownMenuItem>
          )}
          {can.change && buildings.length > 0 && (
            <DropdownMenuItem onSelect={openChange}>
              <UserCog aria-hidden />
              {t("actionChange")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {partyId &&
        icon(
          t("actionView"),
          <Button asChild variant="ghost" size="icon-sm" className="text-status-partial hidden sm:flex">
            <Link href={`/owners/${partyId}`} aria-label={t("actionView")}>
              <Info aria-hidden />
            </Link>
          </Button>,
        )}
      {canEdit &&
        icon(
          tc("edit"),
          <Button variant="ghost" size="icon-sm" className="hidden sm:flex" aria-label={tc("edit")} onClick={() => setDialog("edit")}>
            <Pencil aria-hidden />
          </Button>,
        )}
      {can.change &&
        buildings.length > 0 &&
        icon(
          t("actionChange"),
          <Button variant="ghost" size="icon-sm" className="hidden sm:flex" aria-label={t("actionChange")} onClick={openChange}>
            <UserCog aria-hidden />
          </Button>,
        )}

      {canEdit && <EditOwner party={party!} districts={districts} hideTrigger open={dialog === "edit"} onOpenChange={(o) => setDialog(o ? "edit" : null)} />}

      <FormDialog
        open={dialog === "change"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("changeTitle")}
        description={t("changeBody")}
        confirmLabel={tb("saveManager")}
        successMessage={tb("managerSaved")}
        submit={() => buildingManagerSetAction({ buildingId: building, partyId: picked?.value ?? "" })}
      >
        {(fe) => (
          <div className="space-y-3">
            {buildings.length > 1 && (
              <Field id="building" label={t("building")} required>
                <NativeSelect value={building} onChange={(e) => setBuilding(e.target.value)}>
                  {buildings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field id="manager" label={t("newManager")} error={fe("partyId")} required>
              <div>
                <AsyncCombobox
                  search={search}
                  value={picked ? [picked] : []}
                  onChange={(o) => setPicked(o[0] ?? null)}
                  placeholder={tb("searchPerson")}
                  searchPlaceholder={tc("search")}
                  emptyText={tc("noResults")}
                />
              </div>
            </Field>
          </div>
        )}
      </FormDialog>
    </div>
  );
}
