"use client";

import { Button } from "@dhulka/ui/button";
import { AsyncCombobox, type ComboOption } from "@dhulka/ui/combobox";
import { Field } from "@dhulka/ui/field";
import { Input } from "@dhulka/ui/input";
import { Pencil, Plus, Trash2, UserCog, UserPlus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { searchPartiesAction } from "@/app/[locale]/(staff)/applications/actions";
import { buildingAreaRemoveAction, buildingAreaSaveAction, buildingManagerSetAction } from "@/app/[locale]/(staff)/parcels/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { PartyForm } from "@/components/owners/party-form";
import { Link } from "@/i18n/navigation";
import type { BuildingArea } from "@/lib/server/apartments";

const SUGGESTED = ["parking", "playground", "garden"] as const;

/**
 * An apartment building's manager (a person, like an owner) and its extra areas (parking, playgrounds, …). Each area is
 * its m² × the price per m² set here, charged on the building's bill, which the manager pays, on top of the open ground.
 */
export function BuildingManagerAreas({
  buildingId,
  manager,
  legacyName,
  areas,
  canEdit,
  newOwner,
}: {
  buildingId: string;
  manager: { id: string; full_name: string; phone: string | null } | null;
  legacyName: { name: string; phone: string | null } | null;
  areas: BuildingArea[];
  canEdit: boolean;
  newOwner: { districts: { id: string; name_so: string; name_en: string }[]; districtId: string | null } | null;
}) {
  const t = useTranslations("parcels.buildingExtras");
  const tc = useTranslations("common");
  const format = useFormatter();
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD" });
  const num = (n: number) => format.number(n, { maximumFractionDigits: 2 });
  const total = areas.reduce((s, a) => s + Math.round(a.area_m2 * a.price_m2 * 100) / 100, 0);

  // Choosing the manager.
  const [choosing, setChoosing] = useState(false);
  const [picked, setPicked] = useState<ComboOption | null>(null);
  const [creating, setCreating] = useState(false);
  const search = useCallback(async (q: string): Promise<ComboOption[]> => {
    const res = await searchPartiesAction({ q });
    return res.ok ? res.data.map((p) => ({ value: p.id, label: p.full_name, hint: p.phone ?? p.id_number ?? "" })) : [];
  }, []);

  // An extra area being added or changed.
  const blank = { id: null as string | null, name: "", area: "", price: "" };
  const [area, setArea] = useState<typeof blank | null>(null);
  const [removing, setRemoving] = useState<BuildingArea | null>(null);
  const amount = area ? Math.round(Number(area.area || 0) * Number(area.price || 0) * 100) / 100 : 0;

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      {/* The manager */}
      <div className="rounded-md border p-3 text-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="font-medium">{t("manager")}</p>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setChoosing(true)}>
              <UserCog aria-hidden />
              {manager ? t("changeManager") : t("chooseManager")}
            </Button>
          )}
        </div>
        {manager ? (
          <p>
            <Link href={`/owners/${manager.id}`} className="hover:text-primary font-medium">
              {manager.full_name}
            </Link>
            {manager.phone && <span className="text-muted-foreground"> · {manager.phone}</span>}
          </p>
        ) : (
          <p className="text-muted-foreground">{legacyName ? t("legacy", { name: legacyName.name }) : t("noManager")}</p>
        )}
        <p className="text-muted-foreground mt-1 text-xs">{t("managerHint")}</p>
      </div>

      {/* Extra areas */}
      <div className="rounded-md border p-3 text-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="font-medium">{t("areas")}</p>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setArea(blank)}>
              <Plus aria-hidden />
              {t("addArea")}
            </Button>
          )}
        </div>
        {areas.length === 0 ? (
          <p className="text-muted-foreground">{t("noAreas")}</p>
        ) : (
          <ul className="divide-y">
            {areas.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-1.5">
                <span>
                  {a.name}
                  <span className="text-muted-foreground text-xs">
                    {" "}
                    · {num(a.area_m2)} m² × {usd(a.price_m2)}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="tabular-nums">{usd(Math.round(a.area_m2 * a.price_m2 * 100) / 100)}</span>
                  {canEdit && (
                    <>
                      <Button size="icon-sm" variant="ghost" aria-label={tc("edit")} onClick={() => setArea({ id: a.id, name: a.name, area: String(a.area_m2), price: String(a.price_m2) })}>
                        <Pencil aria-hidden />
                      </Button>
                      <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label={tc("delete")} onClick={() => setRemoving(a)}>
                        <Trash2 aria-hidden />
                      </Button>
                    </>
                  )}
                </span>
              </li>
            ))}
            <li className="flex justify-between pt-1.5 font-medium">
              <span>{t("areasTotal")}</span>
              <span className="tabular-nums">{usd(total)}</span>
            </li>
          </ul>
        )}
        <p className="text-muted-foreground mt-1 text-xs">{t("areasHint")}</p>
      </div>

      <FormDialog
        open={choosing}
        onOpenChange={(o) => {
          setChoosing(o);
          if (!o) {
            setPicked(null);
            setCreating(false);
          }
        }}
        title={manager ? t("changeManager") : t("chooseManager")}
        description={t("chooseBody")}
        confirmLabel={t("saveManager")}
        successMessage={t("managerSaved")}
        className={creating ? "max-w-3xl" : undefined}
        submit={() => buildingManagerSetAction({ buildingId, partyId: picked?.value ?? "" })}
      >
        {(fe) => (
          <div className="space-y-3">
            <Field id="manager" label={t("manager")} error={fe("partyId")} required>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-48 flex-1">
                  <AsyncCombobox
                    search={search}
                    value={picked ? [picked] : []}
                    onChange={(o) => setPicked(o[0] ?? null)}
                    placeholder={t("searchPerson")}
                    searchPlaceholder={tc("search")}
                    emptyText={tc("noResults")}
                  />
                </div>
                {newOwner && !creating && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setCreating(true)}>
                    <UserPlus aria-hidden />
                    {t("newPerson")}
                  </Button>
                )}
              </div>
            </Field>
            {newOwner && creating && (
              <div className="bg-muted/40 rounded-md border p-4">
                <PartyForm
                  party={null}
                  districts={newOwner.districts}
                  districtId={newOwner.districtId}
                  onCancel={() => setCreating(false)}
                  submitLabel={t("newPersonSave")}
                  onSaved={(id, values) => {
                    setPicked({ value: id, label: values.fullName, hint: values.phone || "" });
                    setCreating(false);
                  }}
                />
              </div>
            )}
          </div>
        )}
      </FormDialog>

      <FormDialog
        open={area !== null}
        onOpenChange={(o) => !o && setArea(null)}
        title={area?.id ? t("editArea") : t("addArea")}
        description={t("areaBody")}
        confirmLabel={tc("saveChanges")}
        successMessage={t("areaSaved")}
        submit={() =>
          buildingAreaSaveAction({ id: area!.id, buildingId, name: area!.name, areaM2: Number(area!.area), priceM2: Number(area!.price || 0) })
        }
      >
        {(fe) =>
          area && (
            <>
              <Field id="area-name" label={t("areaName")} error={fe("name")} required>
                <Input value={area.name} maxLength={60} onChange={(e) => setArea({ ...area, name: e.target.value })} />
              </Field>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED.map((k) => (
                  <Button key={k} type="button" size="sm" variant="ghost" className="h-7 border" onClick={() => setArea({ ...area, name: t(`suggest.${k}`) })}>
                    {t(`suggest.${k}`)}
                  </Button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="area-m2" label={t("areaM2")} error={fe("areaM2")} required>
                  <Input type="number" inputMode="decimal" min={0} step="0.01" value={area.area} onChange={(e) => setArea({ ...area, area: e.target.value })} />
                </Field>
                <Field id="area-price" label={t("priceM2")} error={fe("priceM2")} required>
                  <Input type="number" inputMode="decimal" min={0} step="0.01" value={area.price} onChange={(e) => setArea({ ...area, price: e.target.value })} />
                </Field>
              </div>
              <p className="bg-muted/50 rounded-md px-3 py-2 text-sm">
                <span className="text-muted-foreground">{t("areaAmount")}: </span>
                <span className="font-medium tabular-nums">{usd(amount)}</span>
              </p>
            </>
          )
        }
      </FormDialog>

      {removing && (
        <FormDialog
          open
          onOpenChange={(o) => !o && setRemoving(null)}
          title={t("removeTitle", { name: removing.name })}
          description={t("removeBody")}
          confirmLabel={tc("delete")}
          destructive
          successMessage={t("areaRemoved")}
          submit={() => buildingAreaRemoveAction({ id: removing.id })}
        />
      )}
    </div>
  );
}
