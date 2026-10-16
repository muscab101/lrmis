"use client";

import { Toaster as Sonner, toast } from "sonner";

export { toast };

export function Toaster() {
  return (
    <Sonner
      position="top-right"
      richColors
      closeButton
      toastOptions={{ classNames: { toast: "rounded-xl border font-sans", description: "text-xs opacity-80" } }}
    />
  );
}
