"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { optionalPhone, partySchema, type PartyInput } from "@dhulka/core/schemas";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";
import { partyErrors, partyPayload } from "@/lib/server/party-payload";

const text = (max: number) => z.string().trim().max(max, "validation.too_long").default("");
const reason = z.string().trim().min(5, "validation.reason").max(500, "validation.too_long");

function refresh() {
  revalidatePath("/[locale]/parcels", "layout");
}

/** Reason errors from the DB go under the reason field. */
function reasonError(err: unknown): never {
  if (err instanceof AppFailure && err.code === "VALIDATION" && err.values?.detail === "reason") {
    throw new AppFailure("VALIDATION", undefined, { reason: ["validation.reason"] });
  }
  throw err;
}

export const updateParcelDetailsAction = defineAction(
  "parcels.details",
  z.object({
    id: z.uuid(),
    houseNo: text(40),
    govtReceiptNo: text(60),
    plotNo: text(40),
    /** Left out by forms that don't show them, so they stay as they are. */
    propertyType: z.string().trim().max(40).optional(),
    flatNo: z.string().trim().max(20, "validation.too_long").optional(),
    widthM: z.string().trim().max(10).optional(),
    lengthM: z.string().trim().max(10).optional(),
    landUse: z.enum(["residential", "commercial", "state", "mixed", "agricultural", "other"]).optional(),
    units: z.string().trim().max(4).optional(),
    /** A flat or compound house not registered yet. */
    ownM2: z.string().trim().max(12).optional(),
    unitFloor: z.string().trim().max(3).optional(),
    /** One land (not a flat or compound house): its storeys above the ground floor, billed with it. */
    upperStoreys: z.string().trim().max(3).optional(),
    /** Partial land only (registered land changes owners by transfer). */
    ownerName: z.string().trim().max(120).optional(),
    ownerPhone: z.string().trim().max(30).optional(),
    /** Partial land: the owner's full details, saved together with the land. */
    ownerId: z.uuid().optional(),
    owner: partySchema.optional(),
  }),
  async (v, ctx) => {
    const p: Record<string, string> = { house_no: v.houseNo, govt_receipt_no: v.govtReceiptNo, plot_no: v.plotNo };
    if (v.propertyType !== undefined) p.property_type = v.propertyType;
    if (v.flatNo !== undefined) p.flat_no = v.flatNo;
    if (v.widthM !== undefined && v.lengthM !== undefined && (v.widthM || v.lengthM)) {
      p.plot_width_m = v.widthM;
      p.plot_length_m = v.lengthM;
    }
    if (v.landUse !== undefined) p.land_use = v.landUse;
    if (v.units !== undefined) p.units = v.units;
    if (v.ownM2 !== undefined) p.own_m2 = v.ownM2;
    if (v.unitFloor !== undefined) p.unit_floor = v.unitFloor;
    if (v.ownerName !== undefined) {
      p.owner_name = v.ownerName;
      p.owner_phone = v.ownerPhone ?? "";
    }
    try {
      unwrap(await ctx.supabase.rpc("parcel_update_details", { p_id: v.id, p }), "parcel details");
    } catch (err) {
      const field = { property_type: "propertyType", plot_size: "widthM", units: "units", owner_name: "ownerName", unit_size: "ownM2", unit_floor: "unitFloor", compound_too_big: "ownM2" }[String(err instanceof AppFailure ? err.values?.detail : "")];
      if (err instanceof AppFailure && err.code === "VALIDATION" && field) throw new AppFailure("VALIDATION", undefined, { [field]: ["validation.required"] });
      throw err;
    }
    if (v.upperStoreys !== undefined) {
      const n = v.upperStoreys === "" ? 0 : Number(v.upperStoreys);
      if (!Number.isInteger(n) || n < 0 || n > 100) throw new AppFailure("VALIDATION", undefined, { upperStoreys: ["validation.upper_storeys"] });
      try {
        unwrap(await ctx.supabase.rpc("parcel_set_upper_storeys", { p_parcel: v.id, p_storeys: n }), "upper storeys");
      } catch (err) {
        if (err instanceof AppFailure && err.code === "VALIDATION") throw new AppFailure("VALIDATION", undefined, { upperStoreys: ["validation.upper_storeys"] });
        throw err;
      }
    }
    if (v.owner && v.ownerId) {
      try {
        unwrap(await ctx.supabase.rpc("save_party", { p_id: v.ownerId, p: partyPayload(v.owner) }), "owner details");
      } catch (err) {
        partyErrors(err, "owner.");
      }
      revalidatePath("/[locale]/owners", "layout");
    }
    refresh();
    // Land not registered yet is billed again when it changes.
    revalidatePath("/[locale]/invoices", "layout");
    return null;
  },
);

/** For the parcel edit dialog: its property type and unit now, and the types to choose from. */
interface PartyDb {
  id: string;
  kind: "person" | "organisation";
  full_name: string;
  mother_name: string | null;
  gender: "male" | "female" | null;
  date_of_birth: string | null;
  nationality: string | null;
  id_type: string | null;
  id_number: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  next_of_kin: { name?: string | null; phone?: string | null } | null;
  org_registration_no: string | null;
  district_id: string | null;
  owner_type_id: string | null;
}

/** An owner as the owner fields hold it. */
function partyInput(o: PartyDb): PartyInput {
  return {
    kind: o.kind,
    fullName: o.full_name,
    motherName: o.mother_name ?? "",
    gender: o.gender ?? "",
    dateOfBirth: o.date_of_birth ?? "",
    nationality: o.nationality ?? "SO",
    idType: (o.id_type ?? "") as PartyInput["idType"],
    idNumber: o.id_number ?? "",
    phone: o.phone ?? "",
    email: o.email ?? "",
    address: o.address ?? "",
    orgRegistrationNo: o.org_registration_no ?? "",
    nextOfKinName: o.next_of_kin?.name ?? "",
    nextOfKinPhone: o.next_of_kin?.phone ?? "",
    districtId: o.district_id ?? "",
    ownerTypeId: o.owner_type_id ?? "",
  };
}

export const parcelEditInfoAction = defineAction("parcels.edit_info", z.object({ id: z.uuid() }), async (v, ctx) => {
  const [{ data: parcel }, { data: types }, { data: canEditOwner }] = await Promise.all([
    ctx.supabase
      .from("parcels")
      .select("property_type, flat_no, plot_width_m, plot_length_m, land_use, units, status, parent_id, own_m2, unit_floor, layout, upper_storeys, parcel_owners(role, valid_to, party:parties(id, kind, full_name, mother_name, gender, date_of_birth, nationality, id_type, id_number, phone, email, address, next_of_kin, org_registration_no, district_id, owner_type_id))")
      .eq("id", v.id)
      .maybeSingle(),
    ctx.supabase.from("property_grades").select("code, name_so, name_en, active").order("sort").order("name_en"),
    ctx.supabase.rpc("has_permission", { p_key: "owners.update" }),
  ]);
  const p = parcel as {
    property_type: string | null;
    flat_no: string | null;
    plot_width_m: number | null;
    plot_length_m: number | null;
    land_use: string;
    units: number | null;
    status: string;
    parent_id: string | null;
    own_m2: number | null;
    unit_floor: number | null;
    layout: string;
    upper_storeys: number | null;
    parcel_owners: { role: string; valid_to: string | null; party: PartyDb | null }[];
  } | null;
  // The building a flat belongs to, or the compound a house belongs to.
  const { data: above } = p?.parent_id ? await ctx.supabase.from("parcels").select("layout, floors").eq("id", p.parent_id).maybeSingle() : { data: null };
  const land = above as { layout: string; floors: number | null } | null;
  const owner = p?.parcel_owners.filter((o) => !o.valid_to && o.party).sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"))[0]?.party ?? null;
  return {
    propertyType: p?.property_type ?? "",
    flatNo: p?.flat_no ?? "",
    widthM: p?.plot_width_m != null ? String(p.plot_width_m) : "",
    lengthM: p?.plot_length_m != null ? String(p.plot_length_m) : "",
    landUse: (p?.land_use ?? "residential") as "residential" | "commercial" | "state" | "mixed" | "agricultural" | "other",
    units: p?.units != null ? String(p.units) : "",
    /** One land (not flats, a compound, or a unit in one): its upper storeys; null where they don't apply. */
    upperStoreys: p && !p.parent_id && p.layout === "house" ? String(p.upper_storeys ?? 0) : null,
    /** Partial land: its owner's name and phone can be fixed here. */
    owner: p && ["draft", "surveyed", "verified"].includes(p.status) && owner ? { name: owner.full_name, phone: owner.phone ?? "" } : null,
    /** Partial land, staff who may change owners: every owner field, saved with the land. */
    ownerDetails:
      p && ["draft", "surveyed", "verified"].includes(p.status) && owner && canEditOwner === true ? { id: owner.id, input: partyInput(owner) } : null,
    /** A flat or compound house: its size is its own m², not a width and length. */
    unit: p?.parent_id
      ? {
          flats: land?.layout === "flats",
          floors: land?.floors ?? null,
          ownM2: p.own_m2 != null ? String(p.own_m2) : "",
          floor: p.unit_floor != null ? String(p.unit_floor) : "",
          partial: ["draft", "surveyed", "verified"].includes(p.status),
        }
      : null,
    types: (types ?? []) as { code: string; name_so: string; name_en: string; active: boolean }[],
  };
});

export const lockParcelAction = defineAction(
  "parcels.lock",
  z.object({ id: z.uuid(), reason }),
  async (v, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("parcel_lock", { p_id: v.id, p_reason: v.reason }),
        "lock parcel",
      );
    } catch (err) {
      reasonError(err);
    }
    refresh();
    return null;
  },
);

export const unlockParcelAction = defineAction(
  "parcels.unlock",
  z.object({ id: z.uuid(), reason }),
  async (v, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("parcel_unlock", { p_id: v.id, p_reason: v.reason }),
        "unlock parcel",
      );
    } catch (err) {
      reasonError(err);
    }
    refresh();
    return null;
  },
);

const size = z
  .number({ error: "validation.plot_size" })
  .gt(0, "validation.plot_size")
  .max(5000, "validation.plot_size");

/** A surveyor adds land found in the field: it goes to Parcels → Partial registration (no application yet). */
/** A shape drawn with 4-corner drawing (GeoJSON Polygon, one ring of 4 to 51 points). */
const drawnShape = z
  .object({ type: z.literal("Polygon"), coordinates: z.array(z.array(z.tuple([z.number(), z.number()])).min(4).max(51)).length(1) })
  .nullable()
  .default(null);

export const addFieldLandAction = defineAction(
  "parcels.field_land",
  z.object({
    districtId: z.uuid("validation.district"),
    neighbourhoodId: z.uuid().nullable().default(null),
    pinLon: z.number({ error: "validation.pin_required" }).min(40).max(52),
    pinLat: z.number({ error: "validation.pin_required" }).min(-2).max(12.5),
    pinAccuracyM: z.number().min(0).max(10_000).nullable().default(null),
    /** The 4-corner shape drawn on the pin map: kept as the land's boundary. */
    drawnShape: drawnShape,
    plotWidthM: size,
    plotLengthM: size,
    houseNo: text(40),
    propertyType: text(40),
    landUse: text(40),
    /** An owner already entered with the full owner form (from a survey zone); else a new one from the name and phone. */
    ownerId: z.uuid().nullable().default(null),
    ownerName: z.string().trim().max(200, "validation.too_long").default(""),
    ownerPhone: optionalPhone,
    /** A storey building with one owner: how many storeys above the ground floor (billed on the same invoice). */
    upperStoreys: z.number().int("validation.upper_storeys").min(0, "validation.upper_storeys").max(100, "validation.upper_storeys").default(0),
    note: text(400),
  }),
  async (v, ctx) => {
    // Without an owner from the owner form, a name is needed.
    if (v.ownerId === null && v.ownerName.length < 3)
      throw new AppFailure("VALIDATION", undefined, { ownerName: ["validation.owner_name"] });
    try {
      const out = unwrap(
        await ctx.supabase.rpc("field_land_create", {
          p: {
            district_id: v.districtId,
            neighbourhood_id: v.neighbourhoodId,
            pin_lon: v.pinLon,
            pin_lat: v.pinLat,
            pin_accuracy_m: v.pinAccuracyM,
            plot_width_m: v.plotWidthM,
            plot_length_m: v.plotLengthM,
            house_no: v.houseNo,
            property_type: v.propertyType,
            land_use: v.landUse,
            owner_id: v.ownerId,
            owner_name: v.ownerName,
            owner_phone: v.ownerPhone,
            upper_storeys: v.upperStoreys,
            geom: v.drawnShape,
            note: v.note,
          },
        }),
        "field land",
      ) as { parcel_id: string };
      refresh();
      return out;
    } catch (err) {
      // Location and House No errors from the DB go under their fields.
      if (
        err instanceof AppFailure &&
        err.code === "CONFLICT" &&
        err.values?.detail === "house_no_taken"
      ) {
        throw new AppFailure("VALIDATION", err.values, { houseNo: ["validation.house_no_taken"] });
      }
      if (err instanceof AppFailure && err.code === "VALIDATION") {
        const detail = String(err.values?.detail ?? "");
        const field = detail.startsWith("pin") || detail.startsWith("drawn_shape")
          ? "pin"
          : detail.startsWith("neighbourhood")
            ? "neighbourhoodId"
            : detail === "plot_size"
              ? "plotWidthM"
              : "districtId";
        throw new AppFailure("VALIDATION", err.values, { [field]: [`validation.${detail}`] });
      }
      throw err;
    }
  },
);

type Shape = { geometry: GeoJSON.Geometry; bbox: [number, number, number, number] };

/** Where the Add land map goes for a neighbourhood: its boundary, else its point and its district's boundary. */
export const neighbourhoodViewAction = defineAction("parcels.neighbourhood_view", z.object({ id: z.uuid() }), async (v, ctx) =>
  unwrap(await ctx.supabase.rpc("neighbourhood_view", { p_id: v.id }), "neighbourhood view") as {
    neighbourhood: Shape | null;
    point: [number, number] | null;
    district: Shape | null;
  } | null,
);

/** What the map shows when a house pin is clicked: its numbers, owners and place. RLS limits it to the viewer's districts. */
const landError = (err: unknown): never => {
  if (err instanceof AppFailure && err.code === "CONFLICT" && err.values?.detail === "house_no_taken") {
    throw new AppFailure("VALIDATION", err.values, { houseNo: ["validation.house_no_taken"] });
  }
  if (err instanceof AppFailure && err.code === "VALIDATION" && String(err.values?.detail ?? "").startsWith("drawn_shape")) {
    throw new AppFailure("VALIDATION", err.values, { pin: [`validation.${String(err.values?.detail)}`] });
  }
  throw err;
};

/** A flats building or a shared compound with all its units. */
export const addLandWithUnitsAction = defineAction(
  "parcels.land_with_units",
  z.object({
    layout: z.enum(["flats", "compound"]),
    districtId: z.uuid("validation.district"),
    neighbourhoodId: z.uuid().nullable().default(null),
    pinLon: z.number({ error: "validation.pin_required" }).min(40).max(52),
    pinLat: z.number({ error: "validation.pin_required" }).min(-2).max(12.5),
    pinAccuracyM: z.number().min(0).max(10_000).nullable().default(null),
    /** The 4-corner shape drawn on the pin map: kept as the land's boundary. */
    drawnShape: drawnShape,
    plotWidthM: size,
    plotLengthM: size,
    houseNo: text(40),
    propertyType: text(40),
    landUse: text(40),
    // Empty boxes arrive as not-a-number; the database says which one is wrong.
    floors: z.number().nullable().catch(null),
    footprintM2: z.number().nullable().catch(null),
    managerPartyId: z.uuid().nullable().default(null),
    managerName: z.string().trim().max(200, "validation.too_long").default(""),
    managerPhone: optionalPhone,
    split: z.enum(["equal", "by_size"]),
    units: z
      .array(
        z.object({
          no: z.string().trim().max(6, "validation.too_long"),
          floor: z.number().nullable().catch(null),
          ownM2: z.number().nullable().catch(null),
          ownerId: z.uuid().nullable().default(null),
          ownerName: z.string().trim().max(200, "validation.too_long").default(""),
          ownerPhone: optionalPhone,
        }),
      )
      .max(200),
    spaces: z
      .array(z.object({ name: z.string().trim().max(80, "validation.too_long"), areaM2: z.number().nullable().catch(null) }))
      .max(50),
    note: text(400),
  }),
  async (v, ctx) => {
    try {
      const out = unwrap(
        await ctx.supabase.rpc("land_with_units_create", {
          p: {
            layout: v.layout,
            district_id: v.districtId,
            neighbourhood_id: v.neighbourhoodId,
            pin_lon: v.pinLon,
            pin_lat: v.pinLat,
            pin_accuracy_m: v.pinAccuracyM,
            plot_width_m: v.plotWidthM,
            plot_length_m: v.plotLengthM,
            house_no: v.houseNo,
            property_type: v.propertyType,
            land_use: v.landUse,
            floors: v.floors,
            footprint_m2: v.footprintM2,
            manager_party_id: v.managerPartyId,
            manager_name: v.managerName,
            manager_phone: v.managerPhone,
            shared_split: v.split,
            units: v.units.map((u) => ({
              unit_no: u.no,
              floor: u.floor,
              own_m2: u.ownM2,
              owner_id: u.ownerId,
              owner_name: u.ownerName,
              owner_phone: u.ownerPhone,
            })),
            shared_spaces: v.spaces.map((s) => ({ name: s.name, area_m2: s.areaM2 })),
            geom: v.drawnShape,
            note: v.note,
          },
        }),
        "land with units",
      ) as { parcel_id: string };
      refresh();
      return out;
    } catch (err) {
      return landError(err);
    }
  },
);

export const parcelSummaryAction = defineAction("parcels.summary", z.object({ id: z.uuid() }), async (v, ctx) => {
  const { data } = await ctx.supabase
    .from("parcels")
    .select(
      "id, pun, account_no, house_no, flat_no, status, land_use, area_m2, registered_at, layout, building_state, district:districts(name_so, name_en), neighbourhood:neighbourhoods(name_so, name_en), parcel_owners(role, valid_to, party:parties(full_name, phone))",
    )
    .eq("id", v.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;
  const p = data as unknown as {
    id: string;
    pun: string | null;
    account_no: string | null;
    house_no: string | null;
    flat_no: string | null;
    status: string;
    land_use: string | null;
    area_m2: number | null;
    registered_at: string | null;
    layout: string;
    building_state: string;
    district: { name_so: string; name_en: string } | null;
    neighbourhood: { name_so: string; name_en: string } | null;
    parcel_owners: { role: string; valid_to: string | null; party: { full_name: string; phone: string | null } | null }[];
  };
  const { parcel_owners, ...rest } = p;
  // A building has its units' owners and bills; demolished units' old bills still count.
  const units = (((
    await ctx.supabase
      .from("parcels")
      .select("id, unit_no, parcel_owners(valid_to, role, party:parties(full_name, phone))")
      .eq("parent_id", v.id)
      .is("deleted_at", null)
  ).data ?? []) as unknown as { id: string; unit_no: string; parcel_owners: typeof p.parcel_owners }[]);
  const { data: open } = await ctx.supabase
    .from("invoices")
    .select("balance")
    .in("parcel_id", [v.id, ...units.map((u) => u.id)])
    .in("status", ["issued", "partially_paid"]);
  const owners = p.layout === "house" ? parcel_owners : units.flatMap((u) => u.parcel_owners);
  return {
    ...rest,
    units: p.layout === "house" ? 0 : units.length,
    /** Still owed on its bills: what makes its map pin red. */
    owed: ((open ?? []) as { balance: number }[]).reduce((s, i) => s + Number(i.balance), 0),
    owners: owners.filter((o) => !o.valid_to && o.party).map((o) => ({ name: o.party!.full_name, phone: o.party!.phone, role: o.role })),
  };
});

/**
 * The House No choices: 01 up to the neighbourhood's capacity, and the numbers other land there already has. The
 * neighbourhood comes from itself, a parcel being edited or a survey (its application); their own number is not taken.
 */
export const houseNumberChoicesAction = defineAction(
  "parcels.house_numbers",
  z.object({ neighbourhoodId: z.uuid().nullable().default(null), parcelId: z.uuid().nullable().default(null), surveyId: z.uuid().nullable().default(null) }),
  async (v, ctx) => {
    let neighbourhoodId = v.neighbourhoodId;
    let applicationId: string | null = null;
    let own: string | null = null;
    if (v.parcelId) {
      const { data } = await ctx.supabase.from("parcels").select("neighbourhood_id, house_no, application_id").eq("id", v.parcelId).maybeSingle();
      const p = data as { neighbourhood_id: string | null; house_no: string | null; application_id: string | null } | null;
      neighbourhoodId = p?.neighbourhood_id ?? null;
      applicationId = p?.application_id ?? null;
      own = p?.house_no ?? null;
    } else if (v.surveyId) {
      const { data } = await ctx.supabase.from("surveys").select("application:applications(id, neighbourhood_id)").eq("id", v.surveyId).maybeSingle();
      const a = (data as { application: { id: string; neighbourhood_id: string | null } | null } | null)?.application;
      neighbourhoodId = a?.neighbourhood_id ?? null;
      applicationId = a?.id ?? null;
    }
    if (!neighbourhoodId) return null;
    const [{ data: n }, taken] = await Promise.all([
      ctx.supabase.from("neighbourhoods").select("code, capacity").eq("id", neighbourhoodId).maybeSingle(),
      ctx.supabase.rpc("house_numbers_taken", { p_neighbourhood: neighbourhoodId, p_application: applicationId }),
    ]);
    const nb = n as { code: string; capacity: number | null } | null;
    // Some land stores the number with the neighbourhood code in front (KRWJXL0102): count it as 02.
    const plain = (no: string) => {
      const rest = nb?.code && no.toUpperCase().startsWith(nb.code.toUpperCase()) ? no.slice(nb.code.length) : no;
      return /^\d+$/.test(rest) ? rest.padStart(2, "0") : rest;
    };
    const ownPlain = own ? plain(own) : null;
    let skippedOwn = false;
    return {
      /** Shown in front of the number in the House No box. */
      code: nb?.code ?? null,
      capacity: Math.max(1, Number(nb?.capacity ?? 50) || 50),
      taken: ((unwrap(taken, "house numbers") as { house_no: string; apartment: boolean }[]) ?? [])
        .map((x) => ({ ...x, house_no: plain(x.house_no) }))
        // The parcel's own number once (another house with the same number still counts).
        .filter((x) => (ownPlain && x.house_no === ownPlain && !skippedOwn ? !(skippedOwn = true) : true)),
    };
  },
);

/** Register partial land straight from the parcel: PUN, bills, owners. */
export const registerParcelAction = defineAction(
  "parcels.register",
  z.object({ parcelId: z.uuid() }),
  async ({ parcelId }, ctx) => {
    const out = unwrap(
      await ctx.supabase.rpc("parcel_register", { p_parcel: parcelId }),
      "register parcel",
    ) as { pun: string; parcel_id: string };
    refresh();
    revalidatePath("/[locale]/surveys", "layout");
    revalidatePath("/[locale]/cashier", "page");
    return out;
  },
);

/** Delete land (kept in the history with its reason): partial land, or registered land for admins. */
export const deleteParcelAction = defineAction(
  "parcels.delete",
  z.object({ id: z.uuid(), reason }),
  async ({ id, reason: why }, ctx) => {
    unwrap(await ctx.supabase.rpc("parcel_delete", { p_id: id, p_reason: why }), "delete parcel");
    refresh();
    return null;
  },
);

/** Check if it exists: send a district surveyor to confirm the house is there. */
export const requestParcelCheckAction = defineAction(
  "parcels.site_check",
  z.object({ id: z.uuid(), note: z.string().trim().max(500).default("") }),
  async ({ id, note }, ctx) => {
    unwrap(
      await ctx.supabase.rpc("parcel_request_site_check", { p_id: id, p_note: note || null }),
      "request site check",
    );
    refresh();
    revalidatePath("/[locale]/surveys", "layout");
    return null;
  },
);

/** The surveyor's answer: the house exists, or it wasn't found (with a note). */
export const confirmParcelSiteAction = defineAction(
  "parcels.site_confirm",
  z.object({ id: z.uuid(), exists: z.boolean(), note: z.string().trim().max(500).default("") }),
  async ({ id, exists, note }, ctx) => {
    unwrap(
      await ctx.supabase.rpc("parcel_confirm_site", {
        p_id: id,
        p_exists: exists,
        p_note: note || null,
      }),
      "confirm site",
    );
    refresh();
    revalidatePath("/[locale]/surveys", "layout");
    return null;
  },
);

/** Partial land: the bill now against the bill its size and type give (after an edit). */
export type BillCheck = {
  invoice: { id: string; number: string; total: number; paid: number } | null;
  expected: { amount: number; area: number; price: number; type_so: string; type_en: string };
  differs: boolean;
  below_paid: boolean;
} | null;

export const parcelBillCheckAction = defineAction("parcels.bill_check", z.object({ id: z.uuid() }), async ({ id }, ctx) =>
  unwrap(await ctx.supabase.rpc("parcel_bill_check", { p_parcel: id }), "bill check") as BillCheck,
);

/** Re-bill partial land: its unpaid bill follows its size and type now. */
export const rebillParcelAction = defineAction("parcels.rebill", z.object({ id: z.uuid() }), async ({ id }, ctx) => {
  const out = unwrap(await ctx.supabase.rpc("parcel_rebill_now", { p_parcel: id }), "re-bill") as BillCheck;
  refresh();
  revalidatePath("/[locale]/invoices", "layout");
  revalidatePath("/[locale]/cashier", "page");
  return out;
});

/** Set an apartment building's manager: a person (like an owner) who pays the building's ground and extra-area bill. */
export const buildingManagerSetAction = defineAction("parcels.building_manager", z.object({ buildingId: z.uuid(), partyId: z.uuid() }), async (v, ctx) => {
  const out = unwrap(await ctx.supabase.rpc("building_manager_set", { p_building: v.buildingId, p_party: v.partyId }), "building manager");
  refresh();
  revalidatePath("/[locale]/owners", "layout");
  revalidatePath("/[locale]/apartments", "layout");
  return out;
});

/** Add or change an extra area of an apartment building (parking, playground, …): m² × price per m², on the manager's bill. */
export const buildingAreaSaveAction = defineAction(
  "parcels.building_area",
  z.object({
    id: z.uuid().nullable(),
    buildingId: z.uuid(),
    name: z.string().trim().min(2, "validation.required").max(60, "validation.too_long"),
    areaM2: z.number().positive("validation.amount").max(1_000_000, "validation.amount"),
    priceM2: z.number().min(0, "validation.amount").max(100_000, "validation.amount"),
  }),
  async (v, ctx) => {
    const id = unwrap(
      await ctx.supabase.rpc("building_area_save", { p_id: v.id, p_building: v.buildingId, p: { name: v.name, area_m2: v.areaM2, price_m2: v.priceM2 } }),
      "building area",
    ) as string;
    refresh();
    revalidatePath("/[locale]/invoices", "layout");
    revalidatePath("/[locale]/apartments", "layout");
    return id;
  },
);

export const buildingAreaRemoveAction = defineAction("parcels.building_area_remove", z.object({ id: z.uuid() }), async ({ id }, ctx) => {
  unwrap(await ctx.supabase.rpc("building_area_remove", { p_id: id }), "remove building area");
  refresh();
  revalidatePath("/[locale]/invoices", "layout");
  revalidatePath("/[locale]/apartments", "layout");
  return null;
});

const polygon = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()])).min(4)).min(1),
});

/** Remap: put land already in the system where it really is on the map (the drawing only; size and bills stay). */
export const remapParcelAction = defineAction(
  "parcels.remap",
  z.object({ id: z.uuid(), geom: polygon, reason }),
  async ({ id, geom, reason: why }, ctx) => {
    let out: { drawn_m2: number; recorded_m2: number; moved_m: number };
    try {
      out = unwrap(await ctx.supabase.rpc("parcel_remap", { p_id: id, p_geom: geom, p_reason: why }), "remap") as typeof out;
    } catch (e) {
      reasonError(e);
    }
    refresh();
    revalidatePath("/[locale]/map", "page");
    revalidatePath("/[locale]/surveys", "layout");
    revalidatePath("/[locale]/incomplete", "page");
    return out;
  },
);

/** Surveyors who can remap this land (its district, they capture locations), least busy first. */
export const remapCandidatesAction = defineAction("parcels.remap_candidates", z.object({ id: z.uuid() }), async ({ id }, ctx) =>
  (unwrap(await ctx.supabase.rpc("parcel_remap_candidates", { p_id: id }), "remap candidates") as { user_id: string; full_name: string; open_remaps: number }[]).map(
    (s) => ({ ...s, open_remaps: Number(s.open_remaps) }),
  ),
);

/** Give the remapping of this land to a surveyor; it shows on their Surveys page under Remapping. */
export const assignRemapAction = defineAction(
  "parcels.remap_assign",
  z.object({ id: z.uuid(), surveyorId: z.uuid("validation.surveyor"), note: text(400) }),
  async ({ id, surveyorId, note }, ctx) => {
    unwrap(await ctx.supabase.rpc("parcel_remap_assign", { p_id: id, p_surveyor: surveyorId, p_note: note || null }), "assign remap");
    refresh();
    revalidatePath("/[locale]/surveys", "layout");
    return null;
  },
);

/** Call the remapping off. */
export const cancelRemapAction = defineAction("parcels.remap_cancel", z.object({ id: z.uuid() }), async ({ id }, ctx) => {
  unwrap(await ctx.supabase.rpc("parcel_remap_cancel", { p_id: id }), "cancel remap");
  refresh();
  revalidatePath("/[locale]/surveys", "layout");
  return null;
});
