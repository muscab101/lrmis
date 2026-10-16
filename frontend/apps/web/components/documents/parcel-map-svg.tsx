/** Static, scale-true map extract of a parcel and its neighbours for printed documents (no tiles needed). */
export function ParcelMapSvg({
  geom,
  adjacent,
  width = 360,
  height = 280,
  labels,
}: {
  geom: GeoJSON.Polygon;
  adjacent: { pun: string | null; geom: GeoJSON.Polygon }[];
  width?: number;
  height?: number;
  labels: { north: string; metres: string };
}) {
  const ring = geom.coordinates[0] ?? [];
  const lat0 = ring.reduce((s, c) => s + c[1]!, 0) / Math.max(ring.length, 1);
  const lon0 = ring.reduce((s, c) => s + c[0]!, 0) / Math.max(ring.length, 1);
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111_320;
  const ky = 110_540;
  const toM = (c: GeoJSON.Position) => [(c[0]! - lon0) * kx, (lat0 - c[1]!) * ky] as const;

  // Frame the parcel with room for its neighbours (≈ 2.2× its size).
  const pts = ring.map(toM);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 10) * 2.2;
  const pad = 14;
  const scale = Math.min((width - pad * 2) / span, (height - pad * 2) / span);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const px = (c: GeoJSON.Position) => {
    const [x, y] = toM(c);
    return [width / 2 + (x - cx) * scale, height / 2 + (y - cy) * scale] as const;
  };
  const path = (r: GeoJSON.Position[]) => r.map((c, i) => `${i ? "L" : "M"}${px(c)[0].toFixed(1)},${px(c)[1].toFixed(1)}`).join(" ") + " Z";

  // A round scale bar near a quarter of the frame.
  const target = span / 4;
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((s) => s >= target / 1.5) ?? 500;
  const barPx = step * scale;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Parcel map" className="block">
      <defs>
        <clipPath id="frame">
          <rect x="0" y="0" width={width} height={height} />
        </clipPath>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#1f45b8" strokeWidth="1" opacity="0.35" />
        </pattern>
      </defs>
      <rect x="0" y="0" width={width} height={height} fill="#f8fafc" stroke="#cbd5e1" />
      <g clipPath="url(#frame)">
        {adjacent.map((a, i) => {
          const r = a.geom.coordinates[0] ?? [];
          const c = r.reduce((s, p) => [s[0]! + p[0]! / r.length, s[1]! + p[1]! / r.length], [0, 0]);
          const [lx, ly] = px(c);
          return (
            <g key={i}>
              <path d={path(r)} fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1" />
              {a.pun && (
                <text x={lx} y={ly} fontSize="7" textAnchor="middle" fill="#64748b" fontFamily="monospace">
                  {a.pun.split("-").slice(-1)[0]}
                </text>
              )}
            </g>
          );
        })}
        <path d={path(ring)} fill="url(#hatch)" stroke="#1f45b8" strokeWidth="2" />
        {ring.slice(0, -1).map((c, i) => {
          const [x, y] = px(c);
          return (
            <g key={i}>
              <circle cx={x} cy={y} r="2.6" fill="#1f45b8" />
              <text x={x + 4} y={y - 4} fontSize="8" fill="#0b1a3a" fontFamily="sans-serif">
                {i + 1}
              </text>
            </g>
          );
        })}
      </g>
      <g transform={`translate(${width - 24}, 22)`} fontFamily="sans-serif">
        <path d="M0,-12 L6,6 L0,2 L-6,6 Z" fill="#0b1a3a" />
        <text y="18" fontSize="9" textAnchor="middle" fill="#0b1a3a">
          {labels.north}
        </text>
      </g>
      <g transform={`translate(${pad}, ${height - pad})`} fontFamily="sans-serif">
        <rect x="0" y="-4" width={barPx} height="4" fill="#0b1a3a" />
        <rect x={barPx / 2} y="-4" width={barPx / 2} height="4" fill="#fff" stroke="#0b1a3a" strokeWidth="0.6" />
        <text x={barPx + 4} y="0" fontSize="8" fill="#0b1a3a">
          {step} {labels.metres}
        </text>
      </g>
    </svg>
  );
}
