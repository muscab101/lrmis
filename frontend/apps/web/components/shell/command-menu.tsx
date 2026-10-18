"use client";

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@dhulka/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@dhulka/ui/dialog";
import { Kbd } from "@dhulka/ui/misc";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import type { NavGroup } from "./nav";

/** ⌘K / Ctrl+K: jump to any page. Record search (PUN, owner, phone) plugs in from Phase 3. */
export function CommandMenu({ groups }: { groups: NavGroup[] }) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={tc("search")}
        className="flex size-10 shrink-0 items-center justify-center gap-2.5 rounded-md border bg-surface text-[13px] text-muted-foreground transition-colors hover:border-foreground/25 sm:w-full sm:max-w-md sm:justify-start sm:px-3"
      >
        <Search className="size-4" aria-hidden />
        <span className="hidden flex-1 truncate text-start sm:inline">{tc("searchPlaceholder")}</span>
        <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl overflow-hidden p-0" closeLabel={tc("close")}>
          <DialogTitle className="sr-only">{tc("search")}</DialogTitle>
          <Command>
            <CommandInput placeholder={tc("searchPlaceholder")} />
            <CommandList>
              <CommandEmpty>{tc("noResults")}</CommandEmpty>
              {groups.map((g) => (
                <CommandGroup key={g.key} heading={t(`groups.${g.key}`)}>
                  {g.items
                    .filter((i) => i.phase === undefined)
                    .map((i) => (
                      <CommandItem
                        key={i.key}
                        value={`${t(`items.${i.key}`)} ${i.href}`}
                        onSelect={() => {
                          setOpen(false);
                          router.push(i.href);
                        }}
                      >
                        <i.icon />
                        {t(`items.${i.key}`)}
                      </CommandItem>
                    ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
