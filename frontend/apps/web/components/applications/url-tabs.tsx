"use client";

import { Tabs } from "@dhulka/ui/form-controls";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";

/** Tabs that keep the open tab in ?tab=, so the step guide and links stay in step with it. */
export function UrlTabs({ value, children, className }: { value: string; children: React.ReactNode; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState(value);
  useEffect(() => setTab(value), [value]);
  return (
    <Tabs
      value={tab}
      className={className}
      onValueChange={(v) => {
        setTab(v);
        router.replace(`${pathname}?tab=${v}`, { scroll: false });
      }}
    >
      {children}
    </Tabs>
  );
}
