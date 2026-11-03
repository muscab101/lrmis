import { describe, expect, it } from "vitest";
import { ownerSchema, partySchema } from "../src/schemas";

const full = {
  kind: "person",
  fullName: "Cali Xasan Maxamed",
  motherName: "Xaawo Nuur",
  gender: "male",
  dateOfBirth: "1980-05-01",
  nationality: "SO",
  idType: "national_id",
  idNumber: "SO123",
  phone: "+252 61 555 0101",
  email: "cali@example.com",
  address: "Hodan, near the market",
  nextOfKinName: "Faadumo Cali",
  nextOfKinPhone: "+252615550102",
  districtId: "00000000-0000-4000-8000-000000000001",
  ownerTypeId: "00000000-0000-4000-8000-000000000002",
};

const errors = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((r.error?.issues ?? []).map((i) => [i.path.join("."), i.message]));

describe("owner schema (staff)", () => {
  it("accepts a complete person", () => {
    expect(ownerSchema.safeParse(full).success).toBe(true);
  });

  it("requires every field of a person, the ID document included", () => {
    const e = errors(ownerSchema.safeParse({ kind: "person", fullName: "Cali" }));
    for (const k of ["motherName", "gender", "dateOfBirth", "idType", "idNumber", "phone", "email", "nextOfKinName", "nextOfKinPhone", "districtId", "ownerTypeId"]) {
      expect(e[k], k).toBe("validation.required");
    }
  });

  it("an organisation needs its registration number, owner type, phone, email and district", () => {
    const e = errors(ownerSchema.safeParse({ kind: "organisation", fullName: "Shirkadda Hormuud" }));
    expect(Object.keys(e).sort()).toEqual(["districtId", "email", "orgRegistrationNo", "ownerTypeId", "phone"]);
  });

  it("refuses a date of birth before 1900 or in the future (the register's rule)", () => {
    expect(errors(ownerSchema.safeParse({ ...full, dateOfBirth: "1888-08-08" })).dateOfBirth).toBe("validation.birth_date");
    expect(errors(ownerSchema.safeParse({ ...full, dateOfBirth: "2999-01-01" })).dateOfBirth).toBe("validation.birth_date");
    expect(errors(partySchema.safeParse({ ...full, dateOfBirth: "1888-08-08" })).dateOfBirth).toBe("validation.birth_date");
  });
});
