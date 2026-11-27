import type { TransferState } from "@/lib/server/transfer-history";

const TONE: Record<TransferState, string> = {
  draft: "bg-muted text-foreground",
  submitted: "bg-info/10 text-info",
  under_review: "bg-warning/10 text-warning",
  needs_documents: "bg-danger/10 text-danger",
  approved: "bg-success/10 text-success",
  rejected: "bg-danger/10 text-danger",
  cancelled: "bg-muted text-muted-foreground",
};

/** A transfer's state as a coloured badge (label already translated). */
export function TransferStateBadge({ state, label }: { state: TransferState; label: string }) {
  return <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE[state] ?? TONE.draft}`}>{label}</span>;
}

/** The state shown for a transfer row: submitted ones may be under review or waiting for documents. */
export function transferState(status: string, review?: string | null): TransferState {
  return (status === "submitted" && review ? review : status) as TransferState;
}
