import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import so from "../../messages/so.json";

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`)));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".") || name === "tests") return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}

const root = join(import.meta.dirname, "..", "..");
const enKeys = new Set(flatten(en as Tree));
const soKeys = new Set(flatten(so as Tree));

/** Every t("key") / t(`a.${x}`) used in code must exist in both catalogs. */
function usedKeys(): { file: string; key: string; pattern: RegExp }[] {
  const out: { file: string; key: string; pattern: RegExp }[] = [];
  const decl = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:"([\w.]+)"|\{[^}]*namespace:\s*"([\w.]+)"[^}]*\})?\s*\)/g;
  for (const file of sourceFiles(root)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(decl)) {
      const [, name, ns1, ns2] = m;
      const ns = ns1 ?? ns2 ?? "";
      const call = new RegExp(`\\b${name}\\(\\s*(?:"([^"]+)"|\`([^\`]+)\`)`, "g");
      for (const c of src.matchAll(call)) {
        const raw = c[1] ?? c[2] ?? "";
        const full = ns ? `${ns}.${raw}` : raw;
        const pattern = new RegExp(`^${full.replace(/[.*+?^()|[\]\\]/g, "\\$&").replace(/\$\\\{[^}]*\}|\$\{[^}]*\}/g, "[\\w.]+")}$`);
        out.push({ file: file.slice(root.length + 1), key: full, pattern });
      }
    }
  }
  return out;
}

describe("i18n", () => {
  it("Somali and English have the same keys", () => {
    expect([...enKeys].filter((k) => !soKeys.has(k))).toEqual([]);
    expect([...soKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });

  it("every key used in code exists", () => {
    const used = usedKeys();
    expect(used.length).toBeGreaterThan(100);
    const missing = used.filter(({ pattern }) => ![...enKeys].some((k) => pattern.test(k)));
    expect(missing.map((m) => `${m.file}: ${m.key}`)).toEqual([]);
  });
});
