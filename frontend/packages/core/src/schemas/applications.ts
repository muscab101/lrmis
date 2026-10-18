import { z } from "zod";
import { uuid } from "./common";

export const PARTY_KINDS = ["person", "organisation"] as const;
export const ID_TYPES = ["national_id", "passport", "driving_licence", "birth_certificate", "company_registration", "other"] as const;
export const APPLICATION_TYPES = ["new_registration", "transfer", "subdivision", "merge", "reprint", "permit", "correction"] as const;
export const APPLICATION_STATUSES = [
  "draft", "awaiting_payment", "in_survey", "surveyed", "in_verification", "returned",
  "public_notice", "approved", "rejected", "cancelled",
] as const;
export const APPLICATION_CHANNELS = ["portal", "office", "field"] as const;
export const PARTY_ROLES = ["owner", "co_owner", "agent", "heir"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type ApplicationType = (typeof APPLICATION_TYPES)[number];

/** Accepted upload types and size (mirrors the DB check and the storage bucket). */
export const DOCUMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "validation.too_long")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null);

const phoneOrEmpty = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .pipe(z.union([z.literal(""), z.string().regex(/^\+[1-9]\d{7,14}$/, "validation.phone")]))
  .transform((v) => (v === "" ? null : v));

export const partySchema = z
  .object({
    kind: z.enum(PARTY_KINDS).default("person"),
    fullName: z.string().trim().min(2, "validation.name").max(160, "validation.too_long"),
    motherName: optionalText(120),
    gender: z.enum(["male", "female", ""]).default("").transform((v) => (v === "" ? null : v)),
    dateOfBirth: z
      .string()
      .default("")
      .refine((v) => v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v) <= new Date()), "validation.date")
      .transform((v) => (v === "" ? null : v)),
    nationality: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "validation.invalid").default("SO"),
    idType: z.enum([...ID_TYPES, ""]).default("").transform((v) => (v === "" ? null : v)),
    idNumber: optionalText(40),
    phone: phoneOrEmpty.default(""),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.union([z.literal(""), z.email("validation.email")]))
      .transform((v) => (v === "" ? null : v))
      .default(""),
    address: optionalText(300),
    orgRegistrationNo: optionalText(60),
    nextOfKinName: optionalText(120),
    nextOfKinPhone: phoneOrEmpty.default(""),
    districtId: uuid.or(z.literal("")).default("").transform((v) => (v === "" ? null : v)),
  })
  .refine((v) => (v.idNumber === null) === (v.idType === null), { path: ["idNumber"], message: "validation.id_pair" });
export type PartyInput = z.input<typeof partySchema>;

export const saveApplicationLocationSchema = z.object({
  type: z.enum(APPLICATION_TYPES),
  channel: z.enum(APPLICATION_CHANNELS).default("office"),
  districtId: uuid,
  neighbourhoodId: uuid.or(z.literal("")).default(""),
  pinLon: z.number().min(40).max(52).nullable().default(null),
  pinLat: z.number().min(-2).max(12.5).nullable().default(null),
  pinAccuracyM: z.number().min(0).max(10_000).nullable().default(null),
  pinMethod: z.enum(["gps", "manual"]).nullable().default(null),
  plotWidthM: z.number().gt(0, "validation.plot_size").max(5000, "validation.plot_size").nullable().default(null),
  plotLengthM: z.number().gt(0, "validation.plot_size").max(5000, "validation.plot_size").nullable().default(null),
  addressNote: z.string().trim().max(400, "validation.too_long").default(""),
  plotNo: z.string().trim().max(40, "validation.too_long").default(""),
  oldDeedNo: z.string().trim().max(60, "validation.too_long").default(""),
  govtFileNo: z.string().trim().max(60, "validation.too_long").default(""),
  houseNo: z.string().trim().max(40, "validation.too_long").default(""),
  govtReceiptNo: z.string().trim().max(60, "validation.too_long").default(""),
});
export type ApplicationLocationInput = z.input<typeof saveApplicationLocationSchema>;

export const applicationPartiesSchema = z.object({
  applicationId: uuid,
  parties: z
    .array(
      z.object({
        partyId: uuid,
        role: z.enum(PARTY_ROLES),
        sharePct: z.number().gt(0, "validation.share").max(100, "validation.share").nullable(),
      }),
    )
    .max(30),
});

export const applicationTransitionSchema = z.object({
  applicationId: uuid,
  action: z.enum(["return", "reject", "cancel"]),
  note: z.string().trim().max(1000, "validation.too_long").default(""),
});

export const applicationsQuerySchema = z.object({
  q: z.string().trim().max(80).default(""),
  status: z.enum([...APPLICATION_STATUSES, "open", "any"]).default("open"),
  type: z.enum([...APPLICATION_TYPES, ""]).default(""),
  district: uuid.or(z.literal("")).default(""),
  page: z.coerce.number().int().min(1).default(1),
});
export type ApplicationsQuery = z.infer<typeof applicationsQuerySchema>;

export const partiesQuerySchema = z.object({
  q: z.string().trim().max(80).default(""),
  kind: z.enum([...PARTY_KINDS, ""]).default(""),
  /** draft = partial registration, registered = on the register ("real data"), all = both. */
  stage: z.enum(["draft", "registered", "all"]).catch("draft").default("draft"),
  page: z.coerce.number().int().min(1).default(1),
});
export type PartiesQuery = z.infer<typeof partiesQuerySchema>;

export const trackSchema = z.object({
  number: z.string().trim().toUpperCase().regex(/^APP-\d{4}-\d{6}$/, "validation.app_number"),
  phoneLast4: z.string().trim().regex(/^\d{4}$/, "validation.last4"),
});
