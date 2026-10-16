import { z } from "zod";
import { uuid } from "./common";

export const LOCATION_LEVELS = ["districts", "sections", "sectors", "neighbourhoods", "streets", "facilities"] as const;
export type LocationLevel = (typeof LOCATION_LEVELS)[number];

export const FACILITY_KINDS = [
  "school", "mosque", "hospital", "clinic", "market", "police", "government", "water", "park", "other",
] as const;

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,8}$/, "validation.code");
const nameSo = z.string().trim().min(2, "validation.name").max(120, "validation.too_long");
const nameEn = z.string().trim().max(120, "validation.too_long");

/** One schema per level; `parentId` is the district, section or sector the row belongs to. */
export const locationInputSchema = z.discriminatedUnion("level", [
  z.object({
    level: z.literal("districts"),
    code: code.refine((v) => v.length >= 2 && v.length <= 6, "validation.code"),
    nameSo,
    nameEn: nameEn.min(2, "validation.name"),
  }),
  z.object({ level: z.literal("sections"), parentId: uuid, code, nameSo, nameEn: nameEn.min(2, "validation.name") }),
  z.object({ level: z.literal("sectors"), parentId: uuid, code, nameSo, nameEn: nameEn.min(2, "validation.name") }),
  z.object({
    level: z.literal("neighbourhoods"),
    parentId: uuid,
    code,
    nameSo,
    nameEn: nameEn.min(2, "validation.name"),
    capacity: z.coerce.number().int().min(0).max(1_000_000).nullable().default(null),
  }),
  z.object({ level: z.literal("streets"), parentId: uuid, nameSo, nameEn }),
  z.object({ level: z.literal("facilities"), parentId: uuid, nameSo, nameEn, kind: z.enum(FACILITY_KINDS) }),
]);
export type LocationInput = z.infer<typeof locationInputSchema>;

export const saveLocationSchema = z.object({ id: uuid.nullable(), input: locationInputSchema });

export const locationsQuerySchema = z.object({
  level: z.enum(LOCATION_LEVELS).default("neighbourhoods"),
  district: uuid.or(z.literal("")).default(""),
  q: z.string().trim().max(80).default(""),
  archived: z.enum(["0", "1"]).default("0"),
  page: z.coerce.number().int().min(1).default(1),
});
export type LocationsQuery = z.infer<typeof locationsQuerySchema>;

export const geometryInputSchema = z.object({
  level: z.enum(LOCATION_LEVELS),
  id: uuid,
  /** Raw GeoJSON text from a file or paste (validated and repaired by PostGIS). */
  geojson: z.string().min(10, "validation.geojson").max(5_000_000, "validation.too_long"),
});
