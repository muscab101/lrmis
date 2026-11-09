import { LineChart } from "@/components/charts/line-chart";

/** One series (e.g. money per month) in the system's one chart look. Kept under this name for the report pages. */
export function BarChart({ data, format, label }: { data: { label: string; value: number }[]; format: (n: number) => string; height?: number; label: string }) {
  return (
    <LineChart
      label={label}
      series={[{ label }]}
      legend={false}
      points={data.map((d) => ({ label: d.label, values: [d.value], shown: [format(d.value)] }))}
    />
  );
}
