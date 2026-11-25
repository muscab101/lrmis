/** What the Deleted items page can hold and bring back. */
export const DELETED_KINDS = ["land", "owner", "user", "district", "section", "sector", "neighbourhood", "street", "facility"] as const;
export type DeletedKind = (typeof DELETED_KINDS)[number];
