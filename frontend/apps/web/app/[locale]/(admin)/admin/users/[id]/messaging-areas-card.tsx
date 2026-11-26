"use client";

import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@dhulka/ui/card";
import { toast } from "@dhulka/ui/toaster";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AreaPicker, type PickedArea } from "@/components/messages/area-picker";
import { useErrorMessage } from "@/lib/client/errors";
import { setUserAreasAction } from "../actions";

/**
 * Who this user may send messages to. Empty: every owner in their districts. Otherwise only owners with land in the
 * chosen sections, sectors or neighbourhoods (a section officer, a sector officer, a neighbourhood officer).
 */
export function MessagingAreasCard({ userId, initial, canEdit }: { userId: string; initial: PickedArea[]; canEdit: boolean }) {
  const t = useTranslations("admin.messagingAreas");
  const tc = useTranslations("common");
  const em = useErrorMessage();
  const [areas, setAreas] = useState<PickedArea[]>(initial);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const changed = JSON.stringify(areas.map((a) => a.id).sort()) !== JSON.stringify(initial.map((a) => a.id).sort());

  return (
    <Card className="mt-6">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("help")}</CardDescription>
        </div>
        {canEdit && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {t("change")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!editing && (
          <p className="text-sm">
            {areas.length === 0
              ? t("wholeDistricts")
              : areas.map((a) => `${t(`levels.${a.level}`)} ${a.code} ${a.name}`).join(" · ")}
          </p>
        )}
        {editing && (
          <>
            <AreaPicker value={areas} onChange={setAreas} selectable={["section", "sector", "neighbourhood"]} showOwners={false} />
            <div className="flex flex-wrap gap-2">
              <Button
                loading={busy}
                disabled={!changed}
                onClick={async () => {
                  setBusy(true);
                  const r = await setUserAreasAction({ userId, areas: areas.map((a) => ({ level: a.level as "section" | "sector" | "neighbourhood", id: a.id })) });
                  setBusy(false);
                  if (!r.ok) return toast.error(em(r.error));
                  toast.success(tc("saved"));
                  setEditing(false);
                }}
              >
                {tc("save")}
              </Button>
              <Button variant="ghost" onClick={() => (setAreas(initial), setEditing(false))}>
                {tc("cancel")}
              </Button>
              {areas.length > 0 && (
                <Button variant="ghost" onClick={() => setAreas([])}>
                  {t("clear")}
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
