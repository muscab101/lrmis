import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ownershipHistory } from "@/lib/server/transfer-history";

/** Every owner a parcel has had, current first: their period, and the transfer that started or ended it. Nothing is ever removed. */
export async function OwnershipHistory({ parcelId }: { parcelId: string }) {
  const t = await getTranslations("legal.ownershipHistory");
  const ta = await getTranslations("applications");
  const format = await getFormatter();
  const rows = await ownershipHistory(parcelId);
  const day = (d: string | null) => (d ? format.dateTime(new Date(`${d}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }) : "…");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-6 pb-5 text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("owner")}</TableHead>
                  <TableHead>{t("period")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead>{t("transfer")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.party_id}-${i}`}>
                    <TableCell className="text-sm">
                      <Link href={`/owners/${r.party_id}`} className="font-medium hover:text-primary">
                        {r.full_name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {ta(`roles.${r.role}`)}
                        {r.share_pct != null && Number(r.share_pct) < 100 && ` · ${Number(r.share_pct)}%`}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {day(r.valid_from)} – {r.current ? t("present") : day(r.valid_to)}
                    </TableCell>
                    <TableCell>
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${r.current ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                        {r.current ? t("current") : t("previous")}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.ended_transfer_id ? (
                        <Link href={`/transfers/${r.ended_transfer_id}`} className="hover:text-primary">
                          {t("endedBy")} <Mono>{r.ended_number}</Mono>
                        </Link>
                      ) : r.source_transfer_id ? (
                        <Link href={`/transfers/${r.source_transfer_id}`} className="hover:text-primary">
                          {t("startedBy")} <Mono>{r.source_number}</Mono>
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
