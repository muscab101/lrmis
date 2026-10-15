import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { ClipboardList, Plus } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ApplicationStatusBadge } from "@/components/applications/status-badge";
import { Link } from "@/i18n/navigation";
import { queryApplications } from "@/lib/server/applications";

export default async function PortalHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("portal");
  const ta = await getTranslations("applications");
  const format = await getFormatter();
  const { rows } = await queryApplications({ q: "", status: "any", type: "", district: "", page: 1 }, { citizenOnly: true });

  return (
    <>
      <PageHeader
        title={t("myApplications")}
        description={t("myApplicationsBody")}
        actions={
          <Button asChild>
            <Link href="/portal/applications/new">
              <Plus aria-hidden />
              {t("applyCta")}
            </Link>
          </Button>
        }
      />
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardList />}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            action={
              <Button asChild>
                <Link href="/portal/applications/new">{t("applyCta")}</Link>
              </Button>
            }
          />
        ) : (
          <ul className="divide-y">
            {rows.map((a) => (
              <li key={a.id}>
                <Link href={`/portal/applications/${a.id}`} className="flex flex-wrap items-center gap-3 p-4 hover:bg-surface/70">
                  <div className="min-w-0 flex-1">
                    <Mono>{a.number}</Mono>
                    <div className="text-sm text-muted-foreground">
                      {ta(`types.${a.type}`)} · {a.district?.name_so}
                      {a.neighbourhood ? `, ${a.neighbourhood.name_so}` : ""}
                    </div>
                  </div>
                  <ApplicationStatusBadge status={a.status} />
                  <span className="text-xs text-muted-foreground">{format.relativeTime(new Date(a.submitted_at ?? a.created_at))}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
