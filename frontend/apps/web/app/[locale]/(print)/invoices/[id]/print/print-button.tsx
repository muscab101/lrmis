"use client";

import { Button } from "@dhulka/ui/button";
import { Printer } from "lucide-react";

export function PrintButton({ label }: { label: string }) {
  return (
    <Button onClick={() => window.print()}>
      <Printer aria-hidden />
      {label}
    </Button>
  );
}
