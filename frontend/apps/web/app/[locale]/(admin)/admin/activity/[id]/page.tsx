import { StatusBadge } from "@dhulka/ui/badge";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Activity, Video } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import {
  RecordingPlayer,
  ScreenRequestButton,
  ScreenVideo,
} from "@/components/activity/recording-player";
import { TestLoginButton } from "@/components/activity/test-login";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";
import { actionWords, validDay } from "../words";

interface Entry {
  kind: "action" | "test" | "page" | "login";
  at: string;
  what: string;
  table_name: string | null;
  record_id: string | null;
  detail: string | null;
}
interface Rec {
  id: string;
  started_at: string;
  last_at: string;
  bytes: number;
  pieces: number;
  tested_by_name: string | null;
}
interface Screen {
  id: string;
  status: "pending" | "sharing" | "done" | "declined" | "failed";
  created_at: string;
  bytes: number | null;
  has_file: boolean;
  requester: string | null;
}

const size = (b: number) =>
  b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`;

export async function generateMetadata() {
  const t = await getTranslations("staffActivity");
  return { title: t("title") };
}

export default async function StaffActivityPersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ day?: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "audit.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = await getTranslations("staffActivity");
  const format = await getFormatter();
  const day = validDay((await searchParams).day);
  const supabase = await createClient();
  const { data: person } = await supabase
    .from("profiles")
    .select("user_id, full_name, email, status")
    .eq("user_id", id)
    .eq("kind", "staff")
    .maybeSingle();
  if (!person) notFound();
  const name = person.full_name || person.email || "";

  const [timeline, recordings, screens] = await Promise.all([
    supabase.rpc("staff_activity_timeline", { p_user: id, p_day: day }),
    viewer.isSuperAdmin
      ? supabase.rpc("staff_recordings_of", { p_user: id, p_day: day })
      : Promise.resolve({ data: [] }),
    viewer.isSuperAdmin
      ? supabase.rpc("screen_requests_of", { p_user: id })
      : Promise.resolve({ data: [] }),
  ]);
  const entries = (timeline.data ?? []) as Entry[];
  const recs = (recordings.data ?? []) as Rec[];
  const shots = (screens.data ?? []) as Screen[];
  const time = (s: string) => format.dateTime(new Date(s), { timeStyle: "short" });

  const describe = (e: Entry) => {
    if (e.kind === "page") return <Mono>{e.what}</Mono>;
    if (e.kind === "login") return e.detail ? t("loginFailed", { reason: e.detail }) : t("login");
    if (e.kind === "test")
      return e.what === "test_login.start"
        ? t("testStart", { who: e.detail ?? "" })
        : t("testStop", { who: e.detail ?? "" });
    return actionWords(t, e.what, e.table_name);
  };

  return (
    <>
      <PageHeader title={name} description={person.email ?? undefined}>
        <div className="flex flex-wrap items-center gap-2">
          <form method="get" className="flex items-center gap-2">
            <Input
              type="date"
              name="day"
              defaultValue={day ?? ""}
              aria-label={t("day")}
              className="w-44"
            />
            <Button type="submit" variant="outline" size="sm">
              {t("show")}
            </Button>
          </form>
          {viewer.isSuperAdmin && id !== viewer.user.id && (
            <TestLoginButton userId={id} name={name} size="sm" />
          )}
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/activity">{t("backToList")}</Link>
          </Button>
        </div>
      </PageHeader>

      <div className="space-y-6">
        {viewer.isSuperAdmin && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t("recordings")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-muted-foreground text-sm">{t("recordingsHint")}</p>
                {recs.length === 0 && (
                  <p className="text-muted-foreground text-sm">{t("noRecordings")}</p>
                )}
                <ul className="divide-y">
                  {recs.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span>
                        {time(r.started_at)} – {time(r.last_at)}
                        <span className="text-muted-foreground"> · {size(r.bytes)}</span>
                        {r.tested_by_name && (
                          <p className="text-muted-foreground text-xs">
                            {t("testedBy", { name: r.tested_by_name })}
                          </p>
                        )}
                      </span>
                      <RecordingPlayer id={r.id} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Video className="size-4" aria-hidden />
                  {t("screenVideos")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-muted-foreground text-sm">{t("screenHint")}</p>
                {id !== viewer.user.id && <ScreenRequestButton userId={id} />}
                <ul className="divide-y">
                  {shots.map((s) => (
                    <li key={s.id} className="space-y-1 py-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span>
                          {format.dateTime(new Date(s.created_at), {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                          {s.bytes ? (
                            <span className="text-muted-foreground"> · {size(s.bytes)}</span>
                          ) : null}
                        </span>
                        <StatusBadge
                          tone={
                            s.status === "done"
                              ? "approved"
                              : s.status === "pending" || s.status === "sharing"
                                ? "pending"
                                : "rejected"
                          }
                        >
                          {t(`screen_${s.status}`)}
                        </StatusBadge>
                      </div>
                      {s.has_file && <ScreenVideo id={s.id} />}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        )}

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>{t("timeline")}</CardTitle>
          </CardHeader>
          {entries.length === 0 ? (
            <CardContent>
              <EmptyState icon={<Activity aria-hidden />} title={t("nothingThisDay")} />
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">{t("colTime")}</TableHead>
                  <TableHead className="w-32">{t("colKind")}</TableHead>
                  <TableHead>{t("colWhat")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e, i) => (
                  <TableRow key={`${e.at}-${i}`}>
                    <TableCell className="text-sm tabular-nums">{time(e.at)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {t(`kind_${e.kind}`)}
                    </TableCell>
                    <TableCell className="text-sm">{describe(e)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
