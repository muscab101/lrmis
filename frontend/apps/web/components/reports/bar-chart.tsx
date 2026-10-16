/** Small dependency-free bar chart (server-rendered SVG). Values ≥ 0. */
export function BarChart({ data, format, height = 160, label }: { data: { label: string; value: number }[]; format: (n: number) => string; height?: number; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / Math.max(1, data.length);
  return (
    <figure aria-label={label} className="w-full">
      <svg viewBox={`0 0 100 ${height / 4}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img">
        <title>{label}</title>
        {data.map((d, i) => {
          const h = (d.value / max) * (height / 4 - 2);
          return (
            <rect key={d.label} x={i * w + w * 0.18} width={w * 0.64} y={height / 4 - h} height={Math.max(h, 0.3)} rx={0.6} className="fill-primary/80">
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="mt-1 grid text-center text-[11px] text-muted-foreground" style={{ gridTemplateColumns: `repeat(${Math.max(1, data.length)}, minmax(0, 1fr))` }}>
        {data.map((d) => (
          <span key={d.label} className="truncate">
            <span className="block font-medium text-foreground tabular-nums">{format(d.value)}</span>
            {d.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
