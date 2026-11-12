"use client";

import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { setUserPowersAction } from "@/app/[locale]/(admin)/admin/users/actions";
import { useErrorMessage } from "@/lib/client/errors";
import { PermissionMatrix } from "./permission-matrix";

/**
 * A user's powers, in the same grid as a role: what their role gives is ticked; the Super Admin can tick more for this user only (given) or untick
 * a role's power for this user only (taken away). The role itself doesn't change.
 */
export function UserPowers({
  userId,
  fromRole,
  allow,
  deny,
  canEdit,
  superAdminUser,
}: {
  userId: string;
  /** Powers the user's roles give. */
  fromRole: string[];
  allow: string[];
  deny: string[];
  canEdit: boolean;
  /** The user is a Super Admin: they have every power, nothing to set. */
  superAdminUser: boolean;
}) {
  const t = useTranslations("admin.users.powers");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const role = useMemo(() => new Set(fromRole), [fromRole]);
  const start = () => new Set([...fromRole.filter((k) => !deny.includes(k)), ...allow]);
  const [on, setOn] = useState<Set<string>>(start);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const given = [...on].filter((k) => !role.has(k));
  const taken = fromRole.filter((k) => !on.has(k));
  const changed = given.join() !== [...allow].sort().join() || taken.join() !== [...deny].sort().join();
  given.sort();
  taken.sort();

  const save = async () => {
    setBusy(true);
    setProblem(null);
    const res = await setUserPowersAction({ userId, allow: given, deny: taken });
    setBusy(false);
    if (!res.ok) return setProblem(errorMessage(res.error));
    toast.success(t("saved"));
    router.refresh();
  };

  if (superAdminUser) {
    return (
      <Card>
        <CardContent className="text-muted-foreground p-5 text-sm">{t("superAdmin")}</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("title")}</CardTitle>
          <p className="text-muted-foreground mt-1 text-sm">{canEdit ? t("body") : t("bodyReadOnly")}</p>
          <p className="mt-2 text-xs">
            <span className="text-status-approved font-medium">{t("givenCount", { count: given.length })}</span>
            {" · "}
            <span className="text-status-rejected font-medium">{t("takenCount", { count: taken.length })}</span>
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!changed || busy} onClick={() => setOn(start())}>
              {t("undo")}
            </Button>
            <Button size="sm" loading={busy} disabled={!changed} onClick={save}>
              {t("save")}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {problem && <Alert tone="danger" title={problem} />}
        <PermissionMatrix value={[...on]} onChange={(next) => setOn(new Set(next))} grantable={() => true} readOnly={!canEdit} />
      </CardContent>
    </Card>
  );
}
