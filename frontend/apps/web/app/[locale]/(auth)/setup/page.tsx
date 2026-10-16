import { Lock } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@dhulka/ui/button";
import { EmptyState } from "@dhulka/ui/misc";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthCard } from "../auth-card";
import { SetupForm } from "./setup-form";

// Per-user page: never prerender or cache.
export const dynamic = "force-dynamic";

/** One-time first-run page. Locks itself once a Super Admin exists. */
export default async function SetupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("setup");
  const supabase = await createClient();
  const { data } = await supabase.rpc("setup_status");
  const complete = (data as { complete?: boolean } | null)?.complete ?? true;

  if (complete) {
    return (
      <AuthCard title={t("title")}>
        <EmptyState
          icon={<Lock />}
          title={t("lockedTitle")}
          description={t("lockedBody")}
          action={
            <Button asChild>
              <Link href="/login">{t("goToLogin")}</Link>
            </Button>
          }
        />
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t("title")} description={t("body")}>
      <SetupForm />
    </AuthCard>
  );
}
