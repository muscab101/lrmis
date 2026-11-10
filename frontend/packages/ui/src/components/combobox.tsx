"use client";

import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
}

interface AsyncComboboxProps {
  id?: string;
  /** Fetches at most ~20 matches for the query. Never load the whole list (old LRMIS bug). */
  search: (query: string) => Promise<ComboOption[]>;
  value: ComboOption[];
  onChange: (value: ComboOption[]) => void;
  multiple?: boolean;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

/** Async, searchable, keyboard-friendly combobox for big lists (owners, neighbourhoods …). */
export function AsyncCombobox({
  id,
  search,
  value,
  onChange,
  multiple = false,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
  ...aria
}: AsyncComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [options, setOptions] = React.useState<ComboOption[]>([]);
  const [loading, setLoading] = React.useState(false);

  // The latest search function, so a page that passes a new one on every render doesn't restart the search in a loop:
  // it runs only when the box opens or the text changes.
  const searchRef = React.useRef(search);
  searchRef.current = search;

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      searchRef.current(query)
        .then((res) => !cancelled && setOptions(res))
        .catch(() => !cancelled && setOptions([]))
        .finally(() => !cancelled && setLoading(false));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query]);

  const selected = new Set(value.map((v) => v.value));

  function toggle(option: ComboOption) {
    if (multiple) {
      onChange(selected.has(option.value) ? value.filter((v) => v.value !== option.value) : [...value, option]);
    } else {
      onChange([option]);
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "flex min-h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-1.5 text-start text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 aria-invalid:border-danger",
          )}
          {...aria}
        >
          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
            {value.length === 0 && <span className="text-muted-foreground">{placeholder}</span>}
            {!multiple && value[0] && <span className="truncate">{value[0].label}</span>}
            {multiple &&
              value.map((v) => (
                <span key={v.value} className="inline-flex items-center gap-1 rounded-sm border border-primary/25 bg-primary-soft px-1.5 py-0.5 text-xs text-primary">
                  {v.label}
                  <X
                    className="size-3 cursor-pointer"
                    aria-hidden
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(v);
                    }}
                  />
                </span>
              ))}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={searchPlaceholder} />
          <CommandList>
            {loading && (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
              </div>
            )}
            {!loading && <CommandEmpty>{emptyText}</CommandEmpty>}
            {!loading && (
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem key={o.value} value={o.value} onSelect={() => toggle(o)}>
                    <Check className={cn("size-4", selected.has(o.value) ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
