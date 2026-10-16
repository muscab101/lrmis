import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["so", "en"],
  defaultLocale: "so",
  localePrefix: "always",
});

export type AppLocale = (typeof routing.locales)[number];
