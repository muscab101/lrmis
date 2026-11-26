/** When a fee type you create is billed by itself, and what its amount can be multiplied by (Valuation → Fee types). */
export const FEE_MOMENTS = ["registration", "yearly", "transfer", "id_card"] as const;
export const FEE_FACTORS = ["area", "width", "length", "storeys", "floors", "units"] as const;
export type FeeMoment = (typeof FEE_MOMENTS)[number];
export type FeeFactor = (typeof FEE_FACTORS)[number];
