"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";
import { printerPointsOfSale } from "@/lib/server/printers";

const done = <T>(v: T) => {
  revalidatePath("/[locale]/printers", "page");
  return v;
};

/** Database checks that belong under one field of the form. */
const FIELDS: Record<string, string> = {
  name: "name",
  manufacturer: "manufacturer",
  model: "model",
  serial_no: "serialNo",
  serial_taken: "serialNo",
  mac_address: "macAddress",
  mac_taken: "macAddress",
  ip_address: "ipAddress",
  ip_taken: "ipAddress",
  system_name: "systemName",
  location: "location",
  pos: "posId",
};

export const savePrinterAction = defineAction(
  "printers.save",
  z.object({
    id: z.uuid().nullable().default(null),
    name: z.string().trim().max(80),
    manufacturer: z.string().trim().max(60),
    model: z.string().trim().max(60),
    serialNo: z.string().trim().max(40),
    macAddress: z.string().trim().max(17),
    ipAddress: z.string().trim().max(45),
    connectionType: z.enum(["usb", "ethernet", "wifi"]),
    systemName: z.string().trim().max(120),
    location: z.string().trim().max(120),
    department: z.string().trim().max(80).default(""),
    posId: z.uuid().nullable().default(null),
  }),
  async (v, ctx) => {
    try {
      return done(
        unwrap(
          await ctx.supabase.rpc("printer_save", {
            p: {
              id: v.id,
              name: v.name,
              manufacturer: v.manufacturer,
              model: v.model,
              serial_no: v.serialNo,
              mac_address: v.macAddress,
              ip_address: v.ipAddress,
              connection_type: v.connectionType,
              system_name: v.systemName,
              location: v.location,
              department: v.department,
              pos_id: v.posId,
            },
          }),
          "save printer",
        ) as string,
      );
    } catch (err) {
      const detail = err instanceof AppFailure ? String(err.values?.detail ?? "") : "";
      if (err instanceof AppFailure && FIELDS[detail])
        throw new AppFailure(err.code, err.values, {
          [FIELDS[detail]!]: [`validation.printer_${detail}`],
        });
      throw err;
    }
  },
);

export const setPrinterActiveAction = defineAction(
  "printers.set_active",
  z.object({ id: z.uuid(), active: z.boolean() }),
  async (v, ctx) =>
    done(
      unwrap(
        await ctx.supabase.rpc("printer_set_active", { p_id: v.id, p_active: v.active }),
        "printer status",
      ),
    ),
);

/** A new secret key for the print program. It is shown once, here, and never again. */
export const newPrinterKeyAction = defineAction(
  "printers.new_key",
  z.object({ id: z.uuid() }),
  async (v, ctx) =>
    done(
      unwrap(await ctx.supabase.rpc("printer_new_key", { p_id: v.id }), "printer key") as string,
    ),
);

export const resolvePrinterAlertAction = defineAction(
  "printers.resolve_alert",
  z.object({ id: z.uuid() }),
  async (v, ctx) =>
    done(unwrap(await ctx.supabase.rpc("printer_resolve_alert", { p_id: v.id }), "printer alert")),
);

/** The points of sale a printer can belong to, for the printer form. */
export const printerPosChoicesAction = defineAction(
  "printers.pos_choices",
  z.object({}),
  async () => printerPointsOfSale(),
);
