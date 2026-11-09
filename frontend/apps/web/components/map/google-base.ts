/**
 * Google's satellite map (Maps JavaScript API) drawn under our MapLibre map: MapLibre stays on top for the boundaries,
 * parcels and clicks, and Google follows every move. The key (NEXT_PUBLIC_GOOGLE_MAPS_KEY) is a browser key that Google
 * Cloud limits to our website addresses, and billing must be on for the key's project.
 */

/** The little of Google Maps we use (no extra package for the full types). */
export interface GoogleMapLike {
  moveCamera(camera: { center: { lat: number; lng: number }; zoom: number }): void;
}
type GoogleMapsNs = {
  importLibrary(name: "maps"): Promise<{ Map: new (el: HTMLElement, opts: Record<string, unknown>) => GoogleMapLike }>;
};

export const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "";

let loading: Promise<GoogleMapsNs | null> | null = null;
/** Set when Google turns the key down; the map then keeps its own pictures. */
let refused = false;
const refusedListeners = new Set<() => void>();

export function googleRefused() {
  return refused;
}

export function onGoogleRefused(fn: () => void) {
  refusedListeners.add(fn);
  return () => refusedListeners.delete(fn);
}

function markRefused() {
  refused = true;
  refusedListeners.forEach((fn) => fn());
}

/** Loads Google's map script once for the whole page. */
export function loadGoogleMaps(): Promise<GoogleMapsNs | null> {
  if (!GOOGLE_MAPS_KEY || refused) return Promise.resolve(null);
  loading ??= new Promise((resolve) => {
    const w = window as unknown as Record<string, unknown> & { google?: { maps?: GoogleMapsNs } };
    // Google calls this when the key is wrong or this website address isn't allowed.
    w.gm_authFailure = () => markRefused();
    // Billing off or the API not switched on: Google only says so in the console, so listen for it there.
    const error = console.error;
    console.error = (...args: unknown[]) => {
      const text = String(args[0] ?? "");
      if (text.includes("Google Maps JavaScript API error")) markRefused();
      error(...args);
    };
    w.__dhulkaGoogleReady = () => resolve(w.google?.maps ?? null);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&v=weekly&loading=async&callback=__dhulkaGoogleReady`;
    s.async = true;
    s.onerror = () => {
      markRefused();
      resolve(null);
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** A Google satellite map (with place and street names) in `el`, which only shows pictures: no buttons, no gestures. */
export async function createGoogleBase(el: HTMLElement, center: { lat: number; lng: number }, zoom: number) {
  const g = await loadGoogleMaps();
  if (!g || refused) return null;
  const { Map } = await g.importLibrary("maps");
  return new Map(el, {
    center,
    zoom,
    mapTypeId: "hybrid",
    tilt: 0,
    isFractionalZoomEnabled: true,
    disableDefaultUI: true,
    gestureHandling: "none",
    keyboardShortcuts: false,
    clickableIcons: false,
    backgroundColor: "#1f2937",
  });
}
