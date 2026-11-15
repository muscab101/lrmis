/** Small dependency-free charts (server-rendered SVG, theme colours via CSS variables). */
import { LineChart } from "@/components/charts/line-chart";

/** Two or more series per category (e.g. money in vs money out per month), in the system's one chart look. */
export function GroupedBars({
  categories,
  series,
  format,
  label,
}: {
  categories: string[];
  series: { label: string; values: number[]; color?: string }[];
  format: (n: number) => string;
  label: string;
  height?: number;
}) {
  return (
    <LineChart
      label={label}
      series={series.map((s) => ({ label: s.label }))}
      points={categories.map((c, i) => ({
        label: c,
        values: series.map((s) => s.values[i] ?? 0),
        shown: series.map((s) => format(s.values[i] ?? 0)),
      }))}
    />
  );
}

