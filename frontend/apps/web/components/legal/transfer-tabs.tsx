import { getTranslations } from "next-intl/server";
import { tabClass } from "@/components/shell/tabs";
import { Link } from "@/i18n/navigation";

/** The two tabs of Transfers: the work in hand, and the full ownership transfer history. */
export async function TransferTabs({ active }: { active: "work" | "history" }) {
  const t = await getTranslations("legal.tabs");
  return (
    <nav className="flex gap-5 overflow-x-auto text-sm" aria-label={t("label")}>
      <Link href="/transfers" className={tabClass(active === "work")}>
        {t("work")}
      </Link>
      <Link href="/transfers/history" className={tabClass(active === "history")}>
        {t("history")}
      </Link>
    </nav>
  );
}
