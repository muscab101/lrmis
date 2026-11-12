import { cn } from "@dhulka/ui/lib/cn";

/** DEV / STAGING marker so nobody mistakes a test system for production. */
export function EnvBadge({ env }: { env: "development" | "staging" | "production" }) {
  if (env === "production") return null;
  return (
    <span
      className={cn(
        "hidden shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-widest xl:inline",
        env === "staging" ? "border-warning/40 text-warning" : "border-accent/40 text-accent",
      )}
    >
      {env === "staging" ? "STAGING" : "DEV"}
    </span>
  );
}
