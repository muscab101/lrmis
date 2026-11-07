/** The official's signature over a line with their name and title, and the office stamp pressed over its edge. */
export function SignBlock({
  signature,
  stamp,
  labels,
}: {
  signature: { url: string | null; name: string | null; title: string | null } | null;
  stamp: { url: string } | null;
  labels: { signature: string; stamp: string };
}) {
  return (
    <div className="relative flex w-[62mm] flex-col items-center text-center">
      <div className="flex h-[17mm] w-full items-end justify-center">
        {signature?.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed private-storage URL, also printed
          <img
            src={signature.url}
            alt={labels.signature}
            className="max-h-full max-w-[52mm] object-contain mix-blend-multiply"
          />
        ) : null}
      </div>
      <div className="w-full border-t border-neutral-500" />
      <p className="mt-1 text-[10px] font-semibold leading-tight text-neutral-900">
        {signature?.name ?? " "}
      </p>
      <p className="text-[9px] leading-tight text-neutral-600">
        {signature?.title ?? labels.signature}
      </p>
      {stamp && (
        // eslint-disable-next-line @next/next/no-img-element -- signed private-storage URL, also printed
        <img
          src={stamp.url}
          alt={labels.stamp}
          className="pointer-events-none absolute -end-[5mm] -top-[3mm] size-[25mm] rotate-[-8deg] object-contain opacity-90 mix-blend-multiply"
        />
      )}
    </div>
  );
}
