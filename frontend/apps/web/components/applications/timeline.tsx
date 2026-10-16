"use client";

import type { ApplicationStatus } from "@dhulka/core/schemas";
import { useFormatter, useTranslations } from "next-intl";
import { ApplicationStatusBadge } from "./status-badge";

interface Event {
  id: number;
  action: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  at: string;
}

export function Timeline({ events }: { events: Event[] }) {
  const t = useTranslations("applications");
  const format = useFormatter();
  return (
    <ol className="relative space-y-5 border-s ps-6">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -start-[29px] top-1.5 size-2.5 rotate-45 bg-flag" aria-hidden />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{t.has(`events.${e.action}`) ? t(`events.${e.action}`) : e.action}</span>
            {e.to_status && <ApplicationStatusBadge status={e.to_status as ApplicationStatus} />}
            <span className="text-xs text-muted-foreground">{format.dateTime(new Date(e.at), { dateStyle: "medium", timeStyle: "short" })}</span>
          </div>
          {e.note && <p className="mt-1 rounded-md bg-muted px-3 py-2 text-sm">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}
