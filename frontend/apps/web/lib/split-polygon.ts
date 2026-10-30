/**
 * Split a parcel into strips of given areas with straight, parallel cuts. The cuts run across the parcel's longest side
 * ("across") or along it ("along"). Works in metres on a flat local frame, good enough for plots a few hundred metres wide.
 */
type Pt = [number, number];

const R = 6_378_137;

/** Shoelace area of a ring in the local frame (m²). */
function ringArea(ring: Pt[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/** Keep the part of the ring with x >= c (keep = 1) or x <= c (keep = -1). */
function clip(ring: Pt[], c: number, keep: 1 | -1): Pt[] {
  const inside = (p: Pt) => keep * (p[0] - c) >= 0;
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    if (inside(p)) out.push(p);
    if (inside(p) !== inside(q)) {
      const t = (c - p[0]) / (q[0] - p[0]);
      out.push([c, p[1] + t * (q[1] - p[1])]);
    }
  }
  return out;
}

export function splitPolygon(polygon: GeoJSON.Polygon, areas: number[], direction: "across" | "along"): GeoJSON.Polygon[] {
  const lonlat = polygon.coordinates[0]!.slice(0, -1).map((c) => [c[0]!, c[1]!] as Pt);
  const lon0 = lonlat.reduce((s, p) => s + p[0], 0) / lonlat.length;
  const lat0 = lonlat.reduce((s, p) => s + p[1], 0) / lonlat.length;
  const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180);
  const ky = (Math.PI / 180) * R;
  const flat = lonlat.map(([x, y]) => [(x - lon0) * kx, (y - lat0) * ky] as Pt);

  // Turn the frame so the cuts are vertical lines x = c.
  let longest = 0;
  let angle = 0;
  flat.forEach((p, i) => {
    const q = flat[(i + 1) % flat.length]!;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len > longest) {
      longest = len;
      angle = Math.atan2(q[1] - p[1], q[0] - p[0]);
    }
  });
  if (direction === "along") angle += Math.PI / 2;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const local = flat.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos] as Pt);
  const back = (ring: Pt[]): number[][] => {
    const pts = ring.map(([x, y]) => {
      const fx = x * cos + y * sin;
      const fy = -x * sin + y * cos;
      return [Number((fx / kx + lon0).toFixed(9)), Number((fy / ky + lat0).toFixed(9))];
    });
    return [...pts, pts[0]!];
  };

  const xs = local.map((p) => p[0]);
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const total = ringArea(local);
  const scale = total / areas.reduce((s, a) => s + a, 0);

  // Each cut where the area to its left reaches the running total.
  const cuts: number[] = [];
  let want = 0;
  for (const a of areas.slice(0, -1)) {
    want += a * scale;
    let lo = min;
    let hi = max;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (ringArea(clip(local, mid, -1)) < want) lo = mid;
      else hi = mid;
    }
    cuts.push((lo + hi) / 2);
  }
  const edges = [min - 1, ...cuts, max + 1];
  return areas.map((_, i) => ({ type: "Polygon", coordinates: [back(clip(clip(local, edges[i]!, 1), edges[i + 1]!, -1))] }));
}
