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
const FONT = ["Open Sans Semibold"];

/** Mogadishu (Banadir) — used when nothing is mapped yet. */
export const DEFAULT_VIEW = { center: [45.32, 2.05] as [number, number], zoom: 11.5 };

export function buildStyle(origin: string, locale: "so" | "en"): StyleSpecification {
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
    },
    layers: [
      { id: "base-streets", type: "raster", source: "base-streets", layout: { visibility: "visible" } },
      { id: "base-satellite", type: "raster", source: "base-satellite", layout: { visibility: "none" } },
      {
        id: "neighbourhoods-fill",
        type: "fill",
        source: "neighbourhoods",
        "source-layer": "neighbourhoods",
        paint: { "fill-color": FLAG, "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.28, 0.12] },
      },
      {
        id: "neighbourhoods-line",
        type: "line",
        source: "neighbourhoods",
        "source-layer": "neighbourhoods",
        paint: { "line-color": FLAG, "line-width": 1.2 },
      },
      {
        id: "sectors-line",
        type: "line",
        source: "sectors",
        "source-layer": "sectors",
        paint: { "line-color": INK, "line-width": 1, "line-dasharray": [2, 2], "line-opacity": 0.6 },
      },
      {
        id: "sections-line",
        type: "line",
        source: "sections",
        "source-layer": "sections",
        paint: { "line-color": INK, "line-width": 1.6, "line-opacity": 0.7 },
      },
      {
        id: "districts-line",
        type: "line",
        source: "districts",
        "source-layer": "districts",
        paint: { "line-color": INK, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.5, 14, 3], "line-opacity": 0.85 },
      },
      {
        id: "streets-line",
        type: "line",
        source: "streets",
        "source-layer": "streets",
        paint: { "line-color": "#b45309", "line-width": 2 },
      },
      {
        id: "facilities-circle",
        type: "circle",
        source: "facilities",
        "source-layer": "facilities",
        paint: { "circle-radius": 5, "circle-color": TEAL, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 },
      },
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
  districts: ["districts-line", "districts-label"],
  sections: ["sections-line"],
  sectors: ["sectors-line"],
  neighbourhoods: ["neighbourhoods-fill", "neighbourhoods-line", "neighbourhoods-label"],
  streets: ["streets-line"],
  facilities: ["facilities-circle"],
};

export const LEGEND: { layer: BoundaryLayer; swatch: string; kind: "line" | "fill" | "dashed" | "dot" }[] = [
  { layer: "districts", swatch: INK, kind: "line" },
  { layer: "sections", swatch: INK, kind: "line" },
  { layer: "sectors", swatch: INK, kind: "dashed" },
  { layer: "neighbourhoods", swatch: FLAG, kind: "fill" },
  { layer: "streets", swatch: "#b45309", kind: "line" },
  { layer: "facilities", swatch: TEAL, kind: "dot" },
];
