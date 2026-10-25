import type { StyleSpecification } from "maplibre-gl";

export const BOUNDARY_LAYERS = ["districts", "sections", "sectors", "neighbourhoods", "streets", "facilities"] as const;
export type BoundaryLayer = (typeof BOUNDARY_LAYERS)[number];
export type BaseMap = "streets" | "satellite";

/** Zoom at which each tile layer starts (must match public.location_tile). */
export const LAYER_MINZOOM: Record<BoundaryLayer, number> = {
  districts: 0,
  sections: 11,
  sectors: 12,
  neighbourhoods: 12,
  streets: 13,
  facilities: 13,
};

const INK = "#0d1b2e";
const FLAG = "#4189dd";
const TEAL = "#0e8f8e";

/**
 * Each level of the location hierarchy has its own colour, used for its outline and a soft fill
 * on every map and in the legend: district red, section yellow, sector green, neighbourhood
 * blue, street purple. Nested levels draw on top, so a section shows yellow inside its red district.
 */
export const LEVEL_COLOURS: Record<BoundaryLayer, string> = {
  districts: "#dc2626",
  sections: "#eab308",
  sectors: "#16a34a",
  neighbourhoods: "#2563eb",
  streets: "#9333ea",
  facilities: TEAL,
};
const C = LEVEL_COLOURS;

/**
 * Every Banadir district has its own colour (outline and soft fill), matched on its name in
 * either language and the common spellings. A district not on the list keeps the district red.
 */
export const DISTRICT_COLOURS: { colour: string; names: string[] }[] = [
  { colour: "#dc2626", names: ["kaaraan", "karaan", "kaaran", "karan"] },
  { colour: "#ea580c", names: ["cabdicasiis", "cabdi casiis", "abdiaziz", "abdi aziz"] },
  { colour: "#d97706", names: ["shibis", "shibbis"] },
  { colour: "#65a30d", names: ["yaaqshiid", "yaqshiid", "yaqshid"] },
  { colour: "#16a34a", names: ["huriwaa", "huriwa", "heliwaa", "heliwa", "heliwaa (huriwaa)"] },
  { colour: "#059669", names: ["dayniile", "deyniile", "daynile"] },
  { colour: "#0d9488", names: ["warta nabadda", "warta-nabadda", "wartanabadda", "wardhiigley", "wardhigley"] },
  { colour: "#0891b2", names: ["hodan"] },
  { colour: "#0284c7", names: ["hawlwadaag", "hawl wadaag", "hawl-wadaag", "howlwadaag", "howl wadaag"] },
  { colour: "#2563eb", names: ["waaberi", "waberi"] },
  { colour: "#4f46e5", names: ["boondheere", "bondhere", "boondhere"] },
  { colour: "#7c3aed", names: ["xamar weyne", "xamar-weyne", "xamarweyne", "hamar weyne", "hamarweyne"] },
  { colour: "#9333ea", names: ["xamar jajab", "xamar-jajab", "xamarjajab", "hamar jajab", "hamarjajab"] },
  { colour: "#c026d3", names: ["shangaani", "shangani", "shingaani"] },
  { colour: "#db2777", names: ["wadajir", "wadajiir", "medina"] },
  { colour: "#e11d48", names: ["dharkenley", "dharkeenley", "darkenley"] },
  { colour: "#92400e", names: ["kaxda", "kahda"] },
  { colour: "#4d7c0f", names: ["daarusalaam", "darusalaam", "darusalam", "daaru salaam"] },
  { colour: "#1e3a8a", names: ["garasbaaley", "garasbaley", "garibaale", "garasbaaleey"] },
  { colour: "#475569", names: ["gubadley", "gubadle"] },
  { colour: "#9f1239", names: ["tarabuunka", "tarabunka"] },
];
const districtPairs = DISTRICT_COLOURS.flatMap((d) => d.names.flatMap((n) => [n, d.colour]));
/** The map colour of one district (same rule as the map: Somali name, then English, else district red). */
export function districtColourFor(nameSo: string, nameEn?: string | null): string {
  const find = (n?: string | null) => (n ? DISTRICT_COLOURS.find((d) => d.names.includes(n.trim().toLowerCase()))?.colour : undefined);
  return find(nameSo) ?? find(nameEn) ?? C.districts;
}
/** MapLibre colour expression: the Somali name first, then the English one, else district red. */
const districtColour = [
  "match",
  ["downcase", ["get", "name_so"]],
  ...districtPairs,
  ["match", ["downcase", ["get", "name_en"]], ...districtPairs, C.districts],
];
const softFill = (hoverOpacity: number, opacity: number) => ["case", ["boolean", ["feature-state", "hover"], false], hoverOpacity, opacity];
const FONT = ["Open Sans Semibold"];

/** Mogadishu (Banadir) — used when nothing is mapped yet. */
export const DEFAULT_VIEW = { center: [45.32, 2.05] as [number, number], zoom: 11.5 };

/** Parcel fill colour by status (matches the status badges). */
export const PARCEL_COLOURS: Record<string, string> = {
  draft: "#5d6573",
  surveyed: "#1d5fc2",
  verified: "#b45309",
  registered: "#15803d",
  disputed: "#c62828",
};

export function buildStyle(origin: string, locale: "so" | "en", opts: { parcels?: boolean } = {}): StyleSpecification {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  const nameField = locale === "so" ? "name_so" : "name_en";
  const vector = (layer: BoundaryLayer) => ({
    type: "vector" as const,
    tiles: [`${origin}/api/tiles/${layer}/{z}/{x}/{y}`],
    minzoom: LAYER_MINZOOM[layer],
    maxzoom: 16,
    // Feature ids are UUID strings: promote them so hover/selection state works.
    promoteId: "id",
  });

  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      "base-streets": {
        type: "raster",
        tileSize: 256,
        maxzoom: 19,
        tiles: [key ? `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${key}` : "https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        attribution: key ? "© MapTiler © OpenStreetMap contributors" : "© OpenStreetMap contributors",
      },
      "base-satellite": {
        type: "raster",
        tileSize: 256,
        maxzoom: 19,
        tiles: [
          key
            ? `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${key}`
            : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        attribution: key ? "© MapTiler © Maxar" : "Imagery © Esri, Maxar, Earthstar Geographics",
      },
      districts: vector("districts"),
      sections: vector("sections"),
      sectors: vector("sectors"),
      neighbourhoods: vector("neighbourhoods"),
      streets: vector("streets"),
      facilities: vector("facilities"),
      highlight: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      // Section/sector points (public.location_pins), filled in by DhulkaMap's `pins` prop.
      pins: { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" },
      ...(opts.parcels
        ? {
            parcels: {
              type: "vector" as const,
              tiles: [`${origin}/api/parcel-tiles/{z}/{x}/{y}`],
              minzoom: 13,
              maxzoom: 18,
              promoteId: "id",
            },
          }
        : {}),
    },
    layers: [
      { id: "base-streets", type: "raster", source: "base-streets", layout: { visibility: "visible" } },
      { id: "base-satellite", type: "raster", source: "base-satellite", layout: { visibility: "none" } },
      // Fills, widest level first so the smaller ones sit on top.
      {
        id: "districts-fill",
        type: "fill",
        source: "districts",
        "source-layer": "districts",
        paint: { "fill-color": districtColour as never, "fill-opacity": softFill(0.4, 0.22) as never },
      },
      {
        id: "sections-fill",
        type: "fill",
        source: "sections",
        "source-layer": "sections",
        paint: { "fill-color": C.sections, "fill-opacity": softFill(0.2, 0.08) as never },
      },
      {
        id: "sectors-fill",
        type: "fill",
        source: "sectors",
        "source-layer": "sectors",
        paint: { "fill-color": C.sectors, "fill-opacity": softFill(0.2, 0.08) as never },
      },
      {
        id: "neighbourhoods-fill",
        type: "fill",
        source: "neighbourhoods",
        "source-layer": "neighbourhoods",
        paint: { "fill-color": C.neighbourhoods, "fill-opacity": softFill(0.28, 0.12) as never },
      },
      // Outlines, smallest level first so district borders stay on top.
      {
        id: "neighbourhoods-line",
        type: "line",
        source: "neighbourhoods",
        "source-layer": "neighbourhoods",
        paint: { "line-color": C.neighbourhoods, "line-width": 1.4 },
      },
      {
        id: "sectors-line",
        type: "line",
        source: "sectors",
        "source-layer": "sectors",
        paint: { "line-color": C.sectors, "line-width": 1.6, "line-dasharray": [2, 1.5] },
      },
      {
        id: "sections-line",
        type: "line",
        source: "sections",
        "source-layer": "sections",
        paint: { "line-color": C.sections, "line-width": 2 },
      },
      {
        id: "districts-line",
        type: "line",
        source: "districts",
        "source-layer": "districts",
        paint: { "line-color": districtColour as never, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2, 14, 3.5] },
      },
      {
        id: "streets-line",
        type: "line",
        source: "streets",
        "source-layer": "streets",
        paint: { "line-color": C.streets, "line-width": 2.5 },
      },
      {
        id: "facilities-circle",
        type: "circle",
        source: "facilities",
        "source-layer": "facilities",
        paint: { "circle-radius": 5, "circle-color": TEAL, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 },
      },
      ...(opts.parcels
        ? ([
            {
              id: "parcels-fill",
              type: "fill",
              source: "parcels",
              "source-layer": "parcels",
              paint: {
                "fill-color": ["match", ["get", "status"], ...Object.entries(PARCEL_COLOURS).flat(), "#5d6573"],
                "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.45, 0.28],
              },
            },
            {
              id: "parcels-line",
              type: "line",
              source: "parcels",
              "source-layer": "parcels",
              paint: { "line-color": ["match", ["get", "status"], ...Object.entries(PARCEL_COLOURS).flat(), "#5d6573"], "line-width": 1.5 },
            },
            {
              id: "parcels-label",
              type: "symbol",
              source: "parcels",
              "source-layer": "parcels",
              minzoom: 17,
              layout: { "text-field": ["coalesce", ["get", "pun"], ""], "text-font": FONT, "text-size": 10 },
              paint: { "text-color": INK, "text-halo-color": "#fff", "text-halo-width": 1.5 },
            },
          ] as StyleSpecification["layers"])
        : []),
      {
        id: "highlight-fill",
        type: "fill",
        source: "highlight",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": FLAG, "fill-opacity": 0.25 },
      },
      {
        id: "highlight-line",
        type: "line",
        source: "highlight",
        paint: { "line-color": FLAG, "line-width": 3 },
      },
      // Sector pins sit under the section pins. A sector that only inherits its section's point
      // is a green ring around that section pin; one with its own point is a solid green dot.
      {
        id: "sector-pins",
        type: "circle",
        source: "pins",
        filter: ["==", ["get", "level"], "sector"],
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            ["case", ["boolean", ["get", "inherited"], false], 7, 4],
            15,
            ["case", ["boolean", ["get", "inherited"], false], 11, 7],
          ],
          "circle-color": ["case", ["boolean", ["get", "inherited"], false], "rgba(0,0,0,0)", C.sectors],
          "circle-stroke-color": ["case", ["==", ["get", "confidence"], "placeholder"], "#5d6573", ["boolean", ["get", "inherited"], false], C.sectors, INK],
          "circle-stroke-width": ["case", ["boolean", ["get", "inherited"], false], 2.5, 1.5],
          "circle-stroke-opacity": ["case", ["==", ["get", "confidence"], "placeholder"], 0.6, 1],
        },
      },
      // Section pins: solid where the point names the place, hollow where it is only the district centre.
      {
        id: "section-pins",
        type: "circle",
        source: "pins",
        filter: ["==", ["get", "level"], "section"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 15, 7],
          "circle-color": ["case", ["==", ["get", "confidence"], "placeholder"], "#ffffff", C.sections],
          "circle-stroke-color": ["case", ["==", ["get", "confidence"], "placeholder"], "#5d6573", INK],
          "circle-stroke-width": 1.5,
          "circle-opacity": ["case", ["==", ["get", "confidence"], "placeholder"], 0.7, 1],
        },
      },
      {
        id: "pins-label",
        type: "symbol",
        source: "pins",
        minzoom: 13,
        filter: ["all", ["!=", ["get", "confidence"], "placeholder"], ["!", ["boolean", ["get", "inherited"], false]]],
        layout: { "text-field": ["get", nameField], "text-font": FONT, "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top" },
        paint: { "text-color": INK, "text-halo-color": "#fff", "text-halo-width": 1.5 },
      },
      {
        id: "neighbourhoods-label",
        type: "symbol",
        source: "neighbourhoods",
        "source-layer": "neighbourhoods",
        minzoom: 13,
        layout: { "text-field": ["get", nameField], "text-font": FONT, "text-size": 12 },
        paint: { "text-color": INK, "text-halo-color": "#fff", "text-halo-width": 1.5 },
      },
      {
        id: "districts-label",
        type: "symbol",
        source: "districts",
        "source-layer": "districts",
        maxzoom: 13,
        layout: { "text-field": ["get", nameField], "text-font": FONT, "text-size": 14, "text-transform": "uppercase" },
        paint: { "text-color": INK, "text-halo-color": "#fff", "text-halo-width": 2 },
      },
    ],
  };
}

/** Map layer ids that belong to each toggle in the layers panel. */
export const LAYER_IDS: Record<BoundaryLayer, string[]> = {
  districts: ["districts-fill", "districts-line", "districts-label"],
  sections: ["sections-fill", "sections-line", "section-pins", "pins-label"],
  sectors: ["sectors-fill", "sectors-line", "sector-pins"],
  neighbourhoods: ["neighbourhoods-fill", "neighbourhoods-line", "neighbourhoods-label"],
  streets: ["streets-line"],
  facilities: ["facilities-circle"],
};

export const LEGEND: { layer: BoundaryLayer; swatch: string; kind: "line" | "fill" | "dashed" | "dot" }[] = [
  { layer: "districts", swatch: C.districts, kind: "fill" },
  { layer: "sections", swatch: C.sections, kind: "fill" },
  { layer: "sectors", swatch: C.sectors, kind: "fill" },
  { layer: "neighbourhoods", swatch: C.neighbourhoods, kind: "fill" },
  { layer: "streets", swatch: C.streets, kind: "line" },
  { layer: "facilities", swatch: TEAL, kind: "dot" },
];
