import { Skeleton } from "@dhulka/ui/misc";

/** The page title area: a title, a line under it and a few buttons. */
function HeaderBoxes() {
  return (
    <div className="mb-7 space-y-5 border-b pb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2.5">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80 max-w-[70vw]" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
    </div>
  );
}

function CardBoxes({ count }: { count: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3 rounded-md border p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

function TableBoxes({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex gap-6 border-b px-4 py-3">
        {[28, 20, 16, 14, 12].map((w, i) => (
          <Skeleton key={i} className="h-3" style={{ width: `${w}%` }} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-6 border-b px-4 py-4 last:border-0">
          <div className="flex w-full items-center gap-3 sm:w-[28%]">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="w-full space-y-1.5">
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          {[20, 16, 14, 12].map((w, i) => (
            <Skeleton
              key={i}
              className="hidden h-3.5 sm:block"
              style={{ width: `${w - ((r + i) % 3) * 2}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * What a page shows while it loads: blurred boxes in the shape of the page to come. `list` for tables, `detail` for
 * one record, `dashboard` for figures and charts, `full` for a map or chat that fills the screen.
 */
export function PageLoading({
  kind = "list",
  label,
}: {
  kind?: "list" | "detail" | "dashboard" | "full";
  label: string;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {kind === "full" ? (
        <Skeleton className="-mx-4 -my-8 h-[calc(100dvh-4rem)] rounded-none sm:-mx-6 lg:-mx-10" />
      ) : (
        <>
          <HeaderBoxes />
          {kind === "list" && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-9 w-64" />
                <Skeleton className="h-9 w-32" />
                <Skeleton className="h-9 w-32" />
              </div>
              <TableBoxes />
            </div>
          )}
          {kind === "dashboard" && (
            <div className="space-y-6">
              <CardBoxes count={4} />
              <div className="grid gap-4 lg:grid-cols-3">
                <Skeleton className="h-72 lg:col-span-2" />
                <Skeleton className="h-72" />
              </div>
              <TableBoxes rows={4} />
            </div>
          )}
          {kind === "detail" && (
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <div className="space-y-4 rounded-md border p-6">
                  <Skeleton className="h-5 w-40" />
                  <div className="grid gap-4 sm:grid-cols-2">
                    {Array.from({ length: 6 }, (_, i) => (
                      <div key={i} className="space-y-2">
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="h-4 w-3/4" />
                      </div>
                    ))}
                  </div>
                </div>
                <TableBoxes rows={4} />
              </div>
              <div className="space-y-4">
                <Skeleton className="h-56" />
                <Skeleton className="h-40" />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
