import { usersQuerySchema } from "@dhulka/core/schemas";
import { NextResponse, type NextRequest } from "next/server";
import { listRoles, queryUsers } from "@/lib/server/users";
import { createClient } from "@/lib/supabase/server";

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  // Neutralise spreadsheet formulas (CSV injection) and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** CSV export of the staff list with the same filters as the page (RLS applies). */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("has_permission", { p_key: "users.export" });
  if (!allowed) return NextResponse.json({ code: "PERMISSION_DENIED" }, { status: 403 });

  const query = usersQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const [{ rows }, roles] = await Promise.all([queryUsers(query, 5000), listRoles()]);
  const roleName = new Map(roles.map((r) => [r.id, r.name_en]));

  const header = ["Full name", "Email", "Phone", "Roles", "All districts", "Status", "2FA", "Last login", "Created at", "Created by"];
  const lines = rows.map((u) =>
    [
      u.full_name,
      u.email,
      u.phone,
      u.role_ids.map((id) => roleName.get(id)).join("; "),
      u.all_districts ? "yes" : "no",
      u.status,
      u.has_totp ? "on" : "off",
      u.last_login_at,
      u.created_at,
      u.created_by_name,
    ]
      .map(csvCell)
      .join(","),
  );
  const body = "﻿" + [header.map(csvCell).join(","), ...lines].join("\r\n");
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="dhulka-users-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
