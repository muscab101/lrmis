export interface DistrictOutline {
  code: string;
  name_so: string;
  name_en: string;
  outline: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

/**
 * The Banadir region as district outlines (printed on the back of the property ID card): the holder's
 * district shaded and their house marked. Plain SVG, so it prints sharp at any size.
 */
export function BanadirMapSvg({ districts, highlight, point, className }: { districts: DistrictOutline[]; highlight?: string; point?: [number, number] | null; className?: string }) {
  const rings = (o: DistrictOutline["outline"]) => (o.type === "Polygon" ? [o.coordinates] : o.coordinates);
  const all = districts.flatMap((d) => rings(d.outline).flatMap((p) => p[0] ?? []));
  if (all.length === 0) return null;
  const lons = all.map((c) => c[0]!);
  const lats = all.map((c) => c[1]!);
  const [minX, maxX, minY, maxY] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  // Equirectangular with the latitude's cosine: true proportions this close to the equator.
  const k = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  const W = 520;
  const pad = 8;
  const scale = (W - pad * 2) / ((maxX - minX) * k);
  const H = Math.round((maxY - minY) * scale + pad * 2);
  const px = (c: GeoJSON.Position) => [pad + (c[0]! - minX) * k * scale, pad + (maxY - c[1]!) * scale] as const;
  const path = (o: DistrictOutline["outline"]) =>
    rings(o)
      .flatMap((poly) => poly.map((r) => r.map((c, i) => `${i ? "L" : "M"}${px(c)[0].toFixed(1)},${px(c)[1].toFixed(1)}`).join("") + "Z"))
      .join("");
  const dot = point ? px(point) : null;
  const ordered = [...districts].sort((a, b) => Number(a.code === highlight) - Number(b.code === highlight));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-hidden>
      {ordered.map((d) => (
        <path
          key={d.code}
          d={path(d.outline)}
          fill={d.code === highlight ? "#2a55d6" : "#e8eefb"}
          stroke={d.code === highlight ? "#0b2a8f" : "#7c93c9"}
          strokeWidth={d.code === highlight ? 3 : 1.5}
          strokeLinejoin="round"
        />
      ))}
      {dot && (
        <g>
          <circle cx={dot[0]} cy={dot[1]} r={14} fill="#dc2626" fillOpacity={0.25} />
          <circle cx={dot[0]} cy={dot[1]} r={7} fill="#dc2626" stroke="#fff" strokeWidth={3} />
        </g>
      )}
    </svg>
  );
}
