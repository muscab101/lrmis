"use client";

import GlassFolder from "@/components/ui/glass-folder-cards";

/** Glass folders as the citizen portal uses them (sample data; dev-only page). */
export function DesignFolders() {
  return (
    <div className="flex flex-wrap justify-center gap-x-10 gap-y-8 pt-10 sm:justify-start">
      <GlassFolder
        label="BN-HDN-012-000123"
        art="aurora"
        seed={3}
        width={300}
        action="more"
        menu={[{ label: "Details" }, { label: "Pay now" }]}
        files={[
          { name: "Receipt RCP-2026-000041", meta: "$120.00" },
          { name: "Bill INV-2026-000002", meta: "$340.00" },
          { name: "Title certificate", meta: "12 Oct 2026", art: "glacier" },
        ]}
      />
      <GlassFolder
        label="BN-WDJ-004-000045"
        art="ember"
        seed={4}
        width={300}
        appearDelay={140}
        action="none"
        files={[
          { name: "Property ID card", meta: "3 Sep 2026", art: "dusk" },
          { name: "Title certificate", meta: "3 Sep 2026", art: "glacier" },
        ]}
      />
      <GlassFolder label="Archive" tone="dark" art="verdant" seed={11} width={300} appearDelay={280} files={[{ name: "Survey plan", meta: "PDF" }]} />
    </div>
  );
}
