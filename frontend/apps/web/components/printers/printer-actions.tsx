"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect, Tooltip } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { Alert, Mono } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import { Check, Copy, KeyRound, Pencil, Plus, Power, PowerOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  newPrinterKeyAction,
  printerPosChoicesAction,
  resolvePrinterAlertAction,
  savePrinterAction,
  setPrinterActiveAction,
} from "@/app/[locale]/(staff)/printers/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { useRouter } from "@/i18n/navigation";
import type { PrinterRow } from "@/lib/server/printers";

const EMPTY = {
  name: "",
  manufacturer: "",
  model: "",
  serialNo: "",
  macAddress: "",
  ipAddress: "",
  connectionType: "ethernet" as PrinterRow["connection_type"],
  systemName: "",
  location: "",
  department: "",
  posId: "",
};

/** Add or edit a printer. */
function PrinterForm({
  printer,
  open,
  onOpenChange,
  onSaved,
}: {
  printer: PrinterRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved?: (id: string) => void;
}) {
  const t = useTranslations("printers");
  const tc = useTranslations("common");
  const [v, setV] = useState(
    printer
      ? {
          name: printer.name,
          manufacturer: printer.manufacturer,
          model: printer.model,
          serialNo: printer.serial_no,
          macAddress: printer.mac_address ?? "",
          ipAddress: printer.ip_address ?? "",
          connectionType: printer.connection_type,
          systemName: printer.system_name,
          location: printer.location,
          department: printer.department ?? "",
          posId: printer.pos_id ?? "",
        }
      : EMPTY,
  );
  // The offices and cash desks to choose from, loaded when the form opens.
  const [places, setPlaces] = useState<{ id: string; code: string; name: string }[]>([]);
  useEffect(() => {
    if (!open) return;
    void printerPosChoicesAction({}).then((r) => r.ok && setPlaces(r.data ?? []));
  }, [open]);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setV((s) => ({ ...s, [k]: e.target.value }));
  const usb = v.connectionType === "usb";
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      className="max-w-2xl"
      title={printer ? t("editTitle", { code: printer.code }) : t("addTitle")}
      description={t("addBody")}
      confirmLabel={printer ? tc("saveChanges") : t("add")}
      successMessage={tc("saved")}
      submit={() => savePrinterAction({ id: printer?.id ?? null, ...v, posId: v.posId || null })}
      onDone={(id) => {
        if (!printer) setV(EMPTY);
        onSaved?.(id as string);
      }}
    >
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="p-name" label={t("name")} hint={t("nameHint")} error={fe("name")} required>
            <Input value={v.name} maxLength={80} onChange={set("name")} />
          </Field>
          <Field
            id="p-pos"
            label={t("pos")}
            hint={t("posHint")}
            error={fe("posId")}
            className="sm:col-span-2"
          >
            <NativeSelect value={v.posId} onChange={set("posId")}>
              <option value="">{t("posNone")}</option>
              {places.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.code}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="p-conn" label={t("connectionLabel")} required>
            <NativeSelect value={v.connectionType} onChange={set("connectionType")}>
              {(["ethernet", "wifi", "usb"] as const).map((c) => (
                <option key={c} value={c}>
                  {t(`connection.${c}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="p-make" label={t("manufacturer")} error={fe("manufacturer")} required>
            <Input value={v.manufacturer} maxLength={60} onChange={set("manufacturer")} />
          </Field>
          <Field id="p-model" label={t("model")} error={fe("model")} required>
            <Input value={v.model} maxLength={60} onChange={set("model")} />
          </Field>
          <Field id="p-serial" label={t("serialNo")} error={fe("serialNo")} required>
            <Input
              value={v.serialNo}
              maxLength={40}
              className="font-mono"
              autoComplete="off"
              onChange={set("serialNo")}
            />
          </Field>
          <Field
            id="p-system"
            label={t("systemName")}
            hint={t("systemNameHint")}
            error={fe("systemName")}
            required
          >
            <Input
              value={v.systemName}
              maxLength={120}
              autoComplete="off"
              onChange={set("systemName")}
            />
          </Field>
          <Field
            id="p-mac"
            label={t("macAddress")}
            hint={usb ? t("optionalUsb") : t("macHint")}
            error={fe("macAddress")}
            required={!usb}
          >
            <Input
              value={v.macAddress}
              maxLength={17}
              className="font-mono"
              autoComplete="off"
              onChange={set("macAddress")}
            />
          </Field>
          <Field
            id="p-ip"
            label={t("ipAddress")}
            hint={usb ? t("optionalUsb") : t("ipHint")}
            error={fe("ipAddress")}
            required={!usb}
          >
            <Input
              value={v.ipAddress}
              maxLength={45}
              className="font-mono"
              autoComplete="off"
              onChange={set("ipAddress")}
            />
          </Field>
          <Field id="p-location" label={t("location")} error={fe("location")} required>
            <Input value={v.location} maxLength={120} onChange={set("location")} />
          </Field>
          <Field id="p-dept" label={t("department")}>
            <Input value={v.department} maxLength={80} onChange={set("department")} />
          </Field>
        </div>
      )}
    </FormDialog>
  );
}

/** Shows a new key once, with a copy button. */
function KeyShown({ value }: { value: string }) {
  const t = useTranslations("printers");
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      <Alert tone="warning" title={t("keyOnce")} />
      <Mono className="rr-block bg-muted block break-all rounded-md p-3 text-xs">{value}</Mono>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? t("copied") : t("copy")}
      </Button>
    </div>
  );
}

export function AddPrinterButton() {
  const t = useTranslations("printers");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {t("add")}
      </Button>
      <PrinterForm printer={null} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function PrinterRowActions({ printer }: { printer: PrinterRow }) {
  const t = useTranslations("printers");
  const tc = useTranslations("common");
  const router = useRouter();
  const [dialog, setDialog] = useState<"edit" | "power" | "key" | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const close = (o: boolean) => {
    if (!o) setDialog(null);
  };
  return (
    <div className="flex justify-end gap-0.5">
      <Tooltip content={tc("edit")}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={tc("edit")}
          onClick={() => setDialog("edit")}
        >
          <Pencil aria-hidden />
        </Button>
      </Tooltip>
      <Tooltip content={printer.has_key ? t("newKey") : t("createKey")}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={printer.has_key ? t("newKey") : t("createKey")}
          onClick={() => setDialog("key")}
        >
          <KeyRound aria-hidden />
        </Button>
      </Tooltip>
      <Tooltip content={printer.active ? t("deactivate") : t("activate")}>
        <Button
          variant="ghost"
          size="icon-sm"
          className={printer.active ? "text-danger" : undefined}
          aria-label={printer.active ? t("deactivate") : t("activate")}
          onClick={() => setDialog("power")}
        >
          {printer.active ? <PowerOff aria-hidden /> : <Power aria-hidden />}
        </Button>
      </Tooltip>
      {dialog === "edit" && <PrinterForm printer={printer} open onOpenChange={close} />}
      <FormDialog
        open={dialog === "power"}
        onOpenChange={close}
        title={
          printer.active
            ? t("deactivateTitle", { code: printer.code })
            : t("activateTitle", { code: printer.code })
        }
        description={printer.active ? t("deactivateBody") : t("activateBody")}
        confirmLabel={printer.active ? t("deactivate") : t("activate")}
        destructive={printer.active}
        successMessage={tc("saved")}
        submit={() => setPrinterActiveAction({ id: printer.id, active: !printer.active })}
      />
      <FormDialog
        open={dialog === "key"}
        onOpenChange={close}
        title={
          printer.has_key
            ? t("newKeyTitle", { code: printer.code })
            : t("createKeyTitle", { code: printer.code })
        }
        description={printer.has_key ? t("newKeyBody") : t("createKeyBody")}
        confirmLabel={printer.has_key ? t("newKey") : t("createKey")}
        destructive={printer.has_key}
        submit={() => newPrinterKeyAction({ id: printer.id })}
        onDone={(k) => setKey(k as string)}
      />
      <FormDialog
        open={key !== null}
        onOpenChange={(o) => {
          if (!o) {
            setKey(null);
            router.refresh();
          }
        }}
        title={t("keyTitle", { code: printer.code })}
        confirmLabel={tc("close")}
        hideCancel
        submit={async () => ({ ok: true as const, data: null })}
      >
        {() => key && <KeyShown value={key} />}
      </FormDialog>
    </div>
  );
}

export function ResolveAlertButton({ id }: { id: string }) {
  const t = useTranslations("printers");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        const r = await resolvePrinterAlertAction({ id });
        setBusy(false);
        if (r.ok) router.refresh();
        else toast.error(t("alertNotClosed"));
      }}
    >
      {t("alertResolve")}
    </Button>
  );
}
