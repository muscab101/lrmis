import { ACTIONS, MODULES, specialPermissionsFor } from "@dhulka/core/permissions";
import { Card } from "@dhulka/ui/card";
import { Mono, PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/server/auth";

/** Read-only catalog of every permission key (roles combine these). */
export default async function PermissionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "roles.view");
  const t = await getTranslations("permissions");
  const ta = await getTranslations("admin.permissionsPage");
  return (
    <>
      <PageHeader title={ta("title")} description={ta("subtitle")} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {MODULES.map((m) => (
          <Card key={m} className="p-4">
            <h2 className="mb-2 font-semibold">{t(`modules.${m}`)}</h2>
            <ul className="flex flex-wrap gap-1.5">
              {[...ACTIONS.map((a) => `${m}.${a}`), ...specialPermissionsFor(m)].map((k) => (
                <li key={k}>
                  <Mono className="rounded-md bg-muted px-1.5 py-0.5 text-xs">{k}</Mono>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
