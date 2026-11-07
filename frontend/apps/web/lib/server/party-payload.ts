import "server-only";
import type { partySchema } from "@dhulka/core/schemas";
import type { z } from "zod";
import { AppFailure } from "./action";

/** An owner form's values as save_party takes them. */
export function partyPayload(v: z.output<typeof partySchema>) {
  return {
    kind: v.kind,
    full_name: v.fullName,
    mother_name: v.motherName,
    gender: v.gender,
    date_of_birth: v.dateOfBirth,
    nationality: v.nationality,
    id_type: v.idType,
    id_number: v.idNumber,
    phone: v.phone,
    email: v.email,
    address: v.address,
    org_registration_no: v.orgRegistrationNo,
    next_of_kin: v.nextOfKinName || v.nextOfKinPhone ? { name: v.nextOfKinName, phone: v.nextOfKinPhone } : {},
    district_id: v.districtId,
    owner_type_id: v.ownerTypeId,
  };
}

/** save_party errors under the right field (a clashing ID number, a refused birth date). */
export function partyErrors(err: unknown, prefix = ""): never {
  if (err instanceof AppFailure && err.code === "CONFLICT" && err.values?.detail === "id_number") {
    throw new AppFailure("CONFLICT", undefined, { [`${prefix}idNumber`]: ["validation.id_taken"] });
  }
  if (err instanceof Error && err.message.includes("parties_date_of_birth_check")) {
    throw new AppFailure("VALIDATION", undefined, { [`${prefix}dateOfBirth`]: ["validation.birth_date"] });
  }
  throw err;
}
