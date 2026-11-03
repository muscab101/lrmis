"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Checkbox, NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { Mono } from "@dhulka/ui/misc";
import { Hammer, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  demolitionCandidatesAction,
  demolitionPlacesAction,
  demolitionRequestAction,
  type DemolitionCandidate,
} from "@/app/[locale]/(staff)/demolished/actions";
import { FormDialog } from "@/components/forms/form-dialog";

type Option = { id: string; label: string };
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Mark land as demolished. Choose a place (a whole neighbourhood at once if needed) or search, tick the land, then say when
 * and why. With `preset`, the land is already chosen: from its parcel page or the map.
 */
export function MarkDemolished({
  canApprove,
  preset = null,
  openAtStart = false,
  size = "default",
}: {
  canApprove: boolean;
  preset?: { id: string; pun: string | null } | null;
  openAtStart?: boolean;
  size?: "default" | "sm";
}) {
  const t = useTranslations("demolitions");
  const locale = useLocale();
  const [open, setOpen] = useState(openAtStart);
  const [place, setPlace] = useState({ d: "", s: "", k: "", n: "" });
  const [q, setQ] = useState("");
  const [choices, setChoices] = useState<{ d: Option[]; s: Option[]; k: Option[]; n: Option[] }>({
    d: [],
    s: [],
    k: [],
    n: [],
  });
  const [rows, setRows] = useState<DemolitionCandidate[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState({
    date: today(),
    reason: "",
    notes: "",
    by: "",
    approveNow: canApprove,
  });

  useEffect(() => {
    if (!open || preset) return;
    void demolitionPlacesAction({
      d: place.d || undefined,
      s: place.s || undefined,
      k: place.k || undefined,
      locale,
    }).then((r) => r.ok && setChoices(r.data));
  }, [open, preset, place.d, place.s, place.k, locale]);

  const find = useCallback(async (next: typeof place, term: string) => {
    setBusy(true);
    const r = await demolitionCandidatesAction({
      d: next.d || null,
      s: next.s || null,
      k: next.k || null,
      n: next.n || null,
      q: term,
    });
    setBusy(false);
    setRows(r.ok ? r.data : []);
    setPicked(new Set());
  }, []);

  const pick = (level: "d" | "s" | "k" | "n", value: string) => {
    const next = {
      d: level === "d" ? value : place.d,
      s: level === "d" ? "" : level === "s" ? value : place.s,
      k: level === "d" || level === "s" ? "" : level === "k" ? value : place.k,
      n: level === "n" ? value : "",
    };
    setPlace(next);
    if (next.d || q.trim()) void find(next, q.trim());
    else setRows(null);
  };

  const ids = useMemo(() => (preset ? [preset.id] : [...picked]), [preset, picked]);
  const allPicked = !!rows?.length && rows.every((r) => picked.has(r.id));
  const levels: { key: "d" | "s" | "k" | "n"; options: Option[] }[] = [
    { key: "d", options: choices.d },
    { key: "s", options: choices.s },
    { key: "k", options: choices.k },
    { key: "n", options: choices.n },
  ];

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={preset ? "outline" : "default"}
        onClick={() => setOpen(true)}
      >
        <Hammer aria-hidden />
        {t("mark")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        className="sm:max-w-3xl"
        title={t("markTitle")}
        description={v.approveNow ? t("markBodyNow") : t("markBodyAsk")}
        confirmLabel={t(v.approveNow ? "markConfirm" : "askConfirm", { count: ids.length })}
        destructive
        successMessage={
          v.approveNow
            ? t("doneMarked", { count: ids.length })
            : t("doneAsked", { count: ids.length })
        }
        submit={() =>
          demolitionRequestAction({
            parcelIds: ids,
            date: v.date,
            reason: v.reason,
            notes: v.notes,
            demolishedBy: v.by,
            approveNow: v.approveNow,
          })
        }
        onDone={() => {
          setPicked(new Set());
          setRows(null);
          setV((s) => ({ ...s, reason: "", notes: "", by: "" }));
        }}
      >
        {(fe) => (
          <div className="space-y-4">
            {preset ? (
              <p className="text-sm">
                {t("land")}: <Mono>{preset.pun ?? "—"}</Mono>
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-4">
                  {levels.map((l) => (
                    <label key={l.key} className="text-muted-foreground grid gap-1 text-xs">
                      {t(`place_${l.key}`)}
                      <NativeSelect
                        value={place[l.key]}
                        disabled={l.options.length === 0}
                        onChange={(e) => pick(l.key, e.target.value)}
                      >
                        <option value="">{t("all")}</option>
                        {l.options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </NativeSelect>
                    </label>
                  ))}
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void find(place, q.trim());
                  }}
                >
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t("searchLand")}
                    aria-label={t("searchLand")}
                  />
                  <Button type="submit" variant="outline" loading={busy}>
                    <Search aria-hidden />
                    {t("find")}
                  </Button>
                </form>
                {rows === null ? (
                  <p className="text-muted-foreground text-sm">{t("chooseFirst")}</p>
                ) : rows.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t("noLand")}</p>
                ) : (
                  <div className="rounded-md border">
                    <label className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
                      <Checkbox
                        checked={allPicked}
                        onCheckedChange={(c) =>
                          setPicked(c === true ? new Set(rows.map((r) => r.id)) : new Set())
                        }
                      />
                      {t("selectAll", { count: rows.length })}
                    </label>
                    <ul className="max-h-56 divide-y overflow-y-auto">
                      {rows.map((r) => (
                        <li key={r.id}>
                          <label className="flex items-center gap-2 px-3 py-2 text-sm">
                            <Checkbox
                              checked={picked.has(r.id)}
                              onCheckedChange={(c) =>
                                setPicked((cur) => {
                                  const next = new Set(cur);
                                  if (c === true) next.add(r.id);
                                  else next.delete(r.id);
                                  return next;
                                })
                              }
                            />
                            <Mono className="shrink-0">{r.pun}</Mono>
                            <span className="min-w-0 flex-1 truncate">{r.owners ?? "—"}</span>
                            <span className="text-muted-foreground shrink-0 text-xs">
                              {t("houseShort")} {r.house_no ?? "—"}
                              {r.layout !== "house" &&
                                ` · ${t(`layout_${r.layout as "flats" | "compound"}`)}`}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="demolitionDate" label={t("date")} error={fe("date")} required>
                <Input
                  type="date"
                  max={today()}
                  value={v.date}
                  onChange={(e) => setV((s) => ({ ...s, date: e.target.value }))}
                />
              </Field>
              <Field
                id="demolishedBy"
                label={t("demolishedBy")}
                hint={t("demolishedByHint")}
                error={fe("demolishedBy")}
              >
                <Input value={v.by} onChange={(e) => setV((s) => ({ ...s, by: e.target.value }))} />
              </Field>
            </div>
            <Field id="demolitionReason" label={t("reason")} error={fe("reason")} required>
              <Input
                value={v.reason}
                onChange={(e) => setV((s) => ({ ...s, reason: e.target.value }))}
              />
            </Field>
            <Field id="demolitionNotes" label={t("notes")} error={fe("notes")}>
              <Textarea
                rows={2}
                value={v.notes}
                onChange={(e) => setV((s) => ({ ...s, notes: e.target.value }))}
              />
            </Field>
            {canApprove && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={v.approveNow}
                  onCheckedChange={(c) => setV((s) => ({ ...s, approveNow: c === true }))}
                />
                {t("approveNow")}
              </label>
            )}
          </div>
        )}
      </FormDialog>
    </>
  );
}
