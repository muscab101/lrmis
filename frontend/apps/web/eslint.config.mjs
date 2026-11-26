import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", ".next-build/**", ".next-prod/**", "node_modules/**", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "@/lib/supabase/admin", message: "Service-role client: import only in server actions / route handlers." }] },
      ],
    },
  },
  {
    files: ["app/**/actions.ts", "app/**/actions/*.ts", "app/**/route.ts", "lib/server/**/*.ts", "lib/supabase/admin.ts"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default config;
