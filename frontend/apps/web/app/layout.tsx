import type { ReactNode } from "react";

// The real <html> lives in app/[locale]/layout.tsx so `lang` matches the locale.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
