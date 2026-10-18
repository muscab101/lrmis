import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ApplicationView } from "@/components/applications/application-view";
import { getApplication } from "@/lib/server/applications";
import { requirePermission } from "@/lib/server/auth";
import { listDistricts } from "@/lib/server/users";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getApplication(id);
  return { title: data?.app.number ?? "404" };
}

export default async function ApplicationPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { locale, id } = await params;
  const { tab } = await searchParams;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "applications.view");
  const [data, districts] = await Promise.all([getApplication(id), listDistricts()]);
  if (!data) notFound();
  return <ApplicationView data={data} viewer={viewer} mode="staff" districts={districts} tab={tab} basePath="/applications" />;
}
