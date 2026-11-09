"use client";

import { useFormatter } from "next-intl";
import { LineChart } from "@/components/charts/line-chart";

type Point = { day: string; collected: number; billed: number };

/** Collected (filled line) against billed (dashed line), day by day, in the system's one chart look. */
export function TrendChart({ series, labels, legend = false }: { series: Point[]; labels: { collected: string; billed: string }; legend?: boolean }) {
  const format = useFormatter();
  const money = (v: number) => format.number(v, { style: "currency", currency: "USD", notation: v >= 10000 ? "compact" : "standard", maximumFractionDigits: 0 });
  const day = (d: string, long = false) => format.dateTime(new Date(`${d}T00:00:00`), long ? { dateStyle: "medium" } : { day: "numeric", month: "short" });
  return (
    <LineChart
      label={`${labels.collected} / ${labels.billed}`}
      series={[{ label: labels.collected }, { label: labels.billed }]}
      legend={legend}
      points={series.map((p) => ({
        label: day(p.day),
        long: day(p.day, true),
        values: [p.collected, p.billed],
        shown: [money(p.collected), money(p.billed)],
      }))}
    />
  );
}
