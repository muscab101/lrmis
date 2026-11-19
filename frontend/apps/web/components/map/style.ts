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
const PIN_PAID_COLOUR = "#1d4ed8";
const PIN_OWING_COLOUR = "#dc2626";
const PIN_PARTIAL_COLOUR = "#d97706";
const FLAG = "#4189dd";
const TEAL = "#0e8f8e";

/**
 * Each level of the location hierarchy has its own colour, used for its outline and a soft fill
 * on every map and in the legend: district red, section yellow, sector green, neighbourhood
 * blue, street purple. Nested levels draw on top, so a section shows yellow inside its red district.
 */
export const LEVEL_COLOURS: Record<BoundaryLayer, string> = {
  districts: "#dc2626",
  sections: "#d97706",
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
/** Demolished land: grey on the map, its boundary kept. */
export const DEMOLISHED_COLOUR = "#6b7280";

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
/**
 * How each level's border looks, biggest first: thick and solid for a district, then thinner and lighter at each level
 * down, so you can tell which border is which at a glance. `from` is the zoom where the level fades in.
 */
const hoverOr = (opacity: number) => ["case", ["boolean", ["feature-state", "hover"], false], 0.3, opacity];
const zoomWidth = (a: number, b: number) => ["interpolate", ["linear"], ["zoom"], 10, a, 16, b];
// The two biggest levels also get a soft band of their colour along the border, so their edge reads from far away.
const BORDERS = [
  { level: "neighbourhoods", colour: C.neighbourhoods, width: zoomWidth(0.8, 1.4), halo: zoomWidth(2.5, 3.5), dash: [2, 2], band: null, from: 12.6 },
  { level: "sectors", colour: C.sectors, width: zoomWidth(1.6, 2.6), halo: zoomWidth(3.5, 5), dash: null, band: null, from: 12 },
  { level: "sections", colour: C.sections, width: zoomWidth(2.2, 3.2), halo: zoomWidth(4.5, 6.5), dash: null, band: zoomWidth(6, 12), from: 11 },
  { level: "districts", colour: districtColour, width: zoomWidth(3, 5), halo: zoomWidth(6, 9), dash: null, band: zoomWidth(10, 22), from: 0 },
] as const;

/** A level's tint while it is the one to read, so each area stands out from the next; brighter under the pointer. */
const tintAt = (stops: [number, number][]) => ["interpolate", ["linear"], ["zoom"], ...stops.flatMap(([z, o]) => [z, hoverOr(o)])];
const LEVEL_TINT: Record<"sections" | "sectors" | "neighbourhoods", unknown> = {
  sections: tintAt([[11, 0], [12, 0.12], [14, 0.08], [15, 0.02]]),
  sectors: tintAt([[13.2, 0], [14.2, 0.1], [15.5, 0.06], [16.5, 0.02]]),
  neighbourhoods: tintAt([[15, 0], [16, 0.05]]),
};

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

/** A land shape's colour, the same as its pin: grey when demolished, blue when paid, red while it owes —
 * land not registered yet is red too (its first bills are still unpaid). Only these three colours. */
const PARCEL_FILL = [
  "case",
  ["boolean", ["get", "demolished"], false],
  DEMOLISHED_COLOUR,
  ["==", ["get", "status"], "registered"],
  ["case", ["boolean", ["get", "owing"], false], PIN_OWING_COLOUR, PIN_PAID_COLOUR],
  PIN_OWING_COLOUR,
];

export function buildStyle(origin: string, locale: "so" | "en", opts: { parcels?: boolean; pinsOnly?: boolean } = {}): StyleSpecification {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  // Set to "on" next to MAPBOX_ACCESS_TOKEN: streets and satellite pictures come from Mapbox (through our server).
  const mapbox = process.env.NEXT_PUBLIC_MAPBOX === "on";
  const nameField = locale === "so" ? "name_so" : "name_en";
  const vector = (layer: BoundaryLayer) => ({
    type: "vector" as const,
    // v=2: borders drawn again on 2026-11-17; a new version makes browsers drop the old pictures.
    tiles: [`${origin}/api/tiles/${layer}/{z}/{x}/{y}?v=2`],
    minzoom: LAYER_MINZOOM[layer],
    maxzoom: 16,
    // Feature ids are UUID strings: promote them so hover/selection state works.
    promoteId: "id",
  });

  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      "base-streets": mapbox
        ? {
            type: "raster",
            tileSize: 256,
            maxzoom: 20,
            tiles: [`${origin}/api/mapbox-tiles/streets/{z}/{x}/{y}`],
            attribution: "© Mapbox © OpenStreetMap contributors",
          }
        : {
            type: "raster",
            tileSize: 256,
            maxzoom: 19,
            tiles: [key ? `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${key}` : "https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            attribution: key ? "© MapTiler © OpenStreetMap contributors" : "© OpenStreetMap contributors",
          },
      // Esri's satellite pictures: free, and much sharper over Mogadishu than MapTiler's or Mapbox's. (Google's satellite
      // map is drawn underneath instead when the site has a Google key: see google-base.ts.)
      "base-satellite": {
        type: "raster",
        tileSize: 256,
        maxzoom: 19,
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
      },
      districts: vector("districts"),
      sections: vector("sections"),
      sectors: vector("sectors"),
      neighbourhoods: vector("neighbourhoods"),
      streets: vector("streets"),
      facilities: vector("facilities"),
      highlight: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      ...(opts.parcels
        ? {
            parcels: {
              type: "vector" as const,
              tiles: [`${origin}/api/parcel-tiles/{z}/{x}/{y}`],
              // Pins of registered houses come from zoom 11; the parcel shapes from 13.
              minzoom: 11,
              maxzoom: 18,
              promoteId: "id",
            },
          }
        : {}),
    },
    layers: [
      { id: "base-streets", type: "raster", source: "base-streets", layout: { visibility: "visible" } },
      { id: "base-satellite", type: "raster", source: "base-satellite", layout: { visibility: "none" } },
      // Only the district is tinted, and less as you zoom in; the smaller levels are told apart by their borders. Their
      // fills stay (clear) so they can still be hovered and clicked, and light up under the pointer.
      {
        id: "districts-fill",
        type: "fill",
        source: "districts",
        "source-layer": "districts",
        paint: {
          "fill-color": districtColour as never,
          // Zoom has to come first in MapLibre, so the hover choice sits inside each step.
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, hoverOr(0.2), 13, hoverOr(0.07), 15, hoverOr(0.03)] as never,
        },
      },
      ...(["sections", "sectors", "neighbourhoods"] as const).map((level) => ({
        id: `${level}-fill`,
        type: "fill" as const,
        source: level,
        "source-layer": level,
        paint: { "fill-color": C[level], "fill-opacity": LEVEL_TINT[level] as never },
      })),
      // Borders, smallest level first so the bigger ones stay on top: the bigger the level, the thicker its line. Each
      // has a white edge under it to stand out on any base map, and fades in at its own zoom.
      ...BORDERS.flatMap(({ level, colour, width, halo, dash, band, from }) => {
        const fade = (top: number) => ["interpolate", ["linear"], ["zoom"], from, 0, from + 0.6, top];
        return [
          ...(band
            ? [
                {
                  id: `${level}-band`,
                  type: "line" as const,
                  source: level,
                  "source-layer": level,
                  layout: { "line-join": "round" as const },
                  paint: { "line-color": colour as never, "line-width": band as never, "line-blur": 4, "line-opacity": fade(0.22) as never },
                },
              ]
            : []),
          {
            id: `${level}-halo`,
            type: "line" as const,
            source: level,
            "source-layer": level,
            layout: { "line-join": "round" as const },
            paint: { "line-color": "#f8fafc", "line-width": halo as never, "line-opacity": fade(0.85) as never },
          },
          {
            id: `${level}-line`,
            type: "line" as const,
            source: level,
            "source-layer": level,
            layout: { "line-join": "round" as const, "line-cap": "round" as const },
            paint: {
              "line-color": colour as never,
              "line-width": width as never,
              "line-opacity": fade(1) as never,
              ...(dash ? { "line-dasharray": [...dash] } : {}),
            },
          },
        ];
      }),
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
        paint: { "circle-radius": 5, "circle-color": TEAL, "circle-stroke-color": "#f8fafc", "circle-stroke-width": 1.5 },
      },
      ...(opts.parcels && !opts.pinsOnly
        ? ([
            {
              id: "parcels-fill",
              type: "fill",
              source: "parcels",
              "source-layer": "parcels",
              paint: {
                "fill-color": PARCEL_FILL,
                "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.45, 0.28],
              },
            },
            {
              id: "parcels-line",
              type: "line",
              source: "parcels",
              "source-layer": "parcels",
              paint: { "line-color": PARCEL_FILL, "line-width": 1.5 },
            },
            {
              id: "parcels-label",
              type: "symbol",
              source: "parcels",
              "source-layer": "parcels",
              minzoom: 17,
              layout: { "text-field": ["coalesce", ["get", "pun"], ""], "text-font": FONT, "text-size": 10 },
              paint: { "text-color": INK, "text-halo-color": "#f8fafc", "text-halo-width": 1.5 },
            },
          ] as StyleSpecification["layers"])
        : []),
      ...(opts.parcels
        ? ([
            // A pin on every house, in three colours: blue when nothing is owed, red when a bill is unpaid (land not
            // registered yet too), grey when demolished (DhulkaMap draws them when the style asks).
            {
              id: "parcel-pins",
              type: "symbol",
              source: "parcels",
              "source-layer": "parcel_pins",
              layout: {
                "icon-image": [
                  "case",
                  ["boolean", ["get", "demolished"], false],
                  "house-pin-demolished",
                  ["boolean", ["get", "partial"], false],
                  "house-pin-owing",
                  ["boolean", ["get", "owing"], false],
                  "house-pin-owing",
                  "house-pin-paid",
                ],
                "icon-anchor": "bottom",
                "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.55, 16, 0.85, 19, 1],
                "icon-allow-overlap": true,
              },
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
      // Names: the bigger the level, the bigger its name; each shows only while its level is the one to read.
      {
        id: "neighbourhoods-label",
        type: "symbol",
        source: "neighbourhoods",
        "source-layer": "neighbourhoods",
        minzoom: 15.2,
        layout: { "text-field": ["get", nameField], "text-font": FONT, "text-size": 11.5 },
        paint: { "text-color": "#1e3a8a", "text-halo-color": "#f8fafc", "text-halo-width": 1.5 },
      },
      {
        id: "sectors-label",
        type: "symbol",
        source: "sectors",
        "source-layer": "sectors",
        minzoom: 13.8,
        maxzoom: 15.6,
        layout: { "text-field": ["get", nameField], "text-font": FONT, "text-size": 13.5, "text-letter-spacing": 0.04 },
        paint: { "text-color": "#14532d", "text-halo-color": "#f8fafc", "text-halo-width": 1.8 },
      },
      {
        id: "sections-label",
        type: "symbol",
        source: "sections",
        "source-layer": "sections",
        minzoom: 11.5,
        maxzoom: 14.2,
        layout: { "text-field": ["get", nameField], "text-font": FONT, "text-size": 14, "text-transform": "uppercase", "text-letter-spacing": 0.1 },
        paint: { "text-color": "#78350f", "text-halo-color": "#f8fafc", "text-halo-width": 2 },
      },
      {
        id: "districts-label",
        type: "symbol",
        source: "districts",
        // One point per district (public.districts.label_point), so a name is drawn once, not once per tile.
        "source-layer": "district_labels",
        maxzoom: 12.5,
        layout: { "text-field": ["get", nameField], "text-font": FONT, "text-size": 16, "text-transform": "uppercase", "text-letter-spacing": 0.12 },
        paint: { "text-color": INK, "text-halo-color": "#f8fafc", "text-halo-width": 2 },
      },
    ],
  };
}

/** Map layer ids that belong to each toggle in the layers panel. */
export const LAYER_IDS: Record<BoundaryLayer, string[]> = {
  districts: ["districts-fill", "districts-band", "districts-halo", "districts-line", "districts-label"],
  sections: ["sections-fill", "sections-band", "sections-halo", "sections-line", "sections-label"],
  sectors: ["sectors-fill", "sectors-halo", "sectors-line", "sectors-label"],
  neighbourhoods: ["neighbourhoods-fill", "neighbourhoods-halo", "neighbourhoods-line", "neighbourhoods-label"],
  streets: ["streets-line"],
  facilities: ["facilities-circle"],
};

/** The colours of the house pins. */
export const PIN_PAID = PIN_PAID_COLOUR;
export const PIN_OWING = PIN_OWING_COLOUR;
/** Land still partial (not registered yet). */
export const PIN_PARTIAL = PIN_PARTIAL_COLOUR;

/** What a house's pin shows, on every map. */
export type PinState = "paid" | "owing" | "demolished" | "partial";
export const PIN_COLOURS: Record<PinState, string> = { paid: PIN_PAID_COLOUR, owing: PIN_OWING_COLOUR, demolished: DEMOLISHED_COLOUR, partial: PIN_OWING_COLOUR };

export const LEGEND: { layer: BoundaryLayer; swatch: string; kind: "line" | "fill" | "dashed" | "dot" }[] = [
  { layer: "districts", swatch: C.districts, kind: "fill" },
  { layer: "sections", swatch: C.sections, kind: "line" },
  { layer: "sectors", swatch: C.sectors, kind: "line" },
  { layer: "neighbourhoods", swatch: C.neighbourhoods, kind: "dashed" },
  { layer: "streets", swatch: C.streets, kind: "line" },
  { layer: "facilities", swatch: TEAL, kind: "dot" },
];
