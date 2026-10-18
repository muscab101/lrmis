import { Button } from "@dhulka/ui/button";
import { Card, CardContent } from "@dhulka/ui/card";
import { cn } from "@dhulka/ui/lib/cn";
import { ArrowRight, Check } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export const APPLICATION_TABS = ["details", "owners", "documents", "review", "activity"] as const;
export type ApplicationTab = (typeof APPLICATION_TABS)[number];

/**
 * The steps before submitting, as one row: what's done, and a button to the next one.
 * After submitting, the stage panel takes over (fee → survey → … → registration → certificate).
 */
export async function DraftSteps({ href, checklist, current }: { href: (tab: ApplicationTab) => string; checklist: { code: string }[]; current: ApplicationTab }) {
  const t = await getTranslations("applications.flow");
  const has = (...codes: string[]) => checklist.some((c) => codes.includes(c.code));
  const steps: { tab: ApplicationTab; done: boolean }[] = [
    { tab: "details", done: !has("no_neighbourhood", "no_pin") },
    { tab: "owners", done: !has("no_owner", "shares_not_100") },
    { tab: "documents", done: !has("missing_document") },
    { tab: "review", done: false },
  ];
  const next = steps.find((s) => !s.done)!;

  return (
    <Card className="mb-5">
      <CardContent className="flex flex-col gap-4 pt-5 md:flex-row md:items-center">
        <ol className="flex flex-1 flex-wrap gap-x-5 gap-y-2 text-sm">
          {steps.map((s, i) => (
            <li key={s.tab}>
              <Link
                href={href(s.tab)}
                aria-current={current === s.tab ? "step" : undefined}
                className={cn("flex items-center gap-2", current === s.tab ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground")}
              >
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full border text-xs tabular-nums",
                    s.done ? "border-success bg-success text-white" : s === next ? "border-primary text-primary" : "",
                  )}
                >
                  {s.done ? <Check className="size-3.5" aria-label={t("done")} /> : i + 1}
                </span>
                {t(`step_${s.tab}`)}
              </Link>
            </li>
          ))}
        </ol>
        {current !== next.tab && (
          <Button asChild size="sm" className="self-start md:self-auto">
            <Link href={href(next.tab)}>
              {t(`go_${next.tab}`)}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
