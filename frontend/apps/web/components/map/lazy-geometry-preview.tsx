"use client";

import { cn } from "@dhulka/ui/lib/cn";
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { GeometryPreview as Preview } from "./geometry-preview";

/**
 * The map preview, loaded after the page: the map library (about 300 kB) is fetched once the page is usable instead of
 * before it, and the page shows a placeholder of the same size meanwhile. Same props as GeometryPreview.
 */
const Lazy = dynamic(() => import("./geometry-preview").then((m) => m.GeometryPreview), {
  ssr: false,
  loading: () => null,
});

export function GeometryPreview(props: ComponentProps<typeof Preview>) {
  return (
    <div className={cn("bg-muted relative overflow-hidden rounded-md", props.className ?? "h-56")}>
      <Lazy {...props} className={cn(props.className ?? "h-56", "absolute inset-0 h-full w-full")} />
    </div>
  );
}
