import type { PermissionKey } from "@dhulka/core/permissions";
import {
  Activity,
  BadgeCheck,
  BarChart3,
  BookOpen,
  Columns2,
  ExternalLink,
  FolderOpen,
  Gavel,
  HardDrive,
  Home,
  LayoutDashboard,
  Map,
  MapPin,
  Mail,
  PlusCircle,
  Scale,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

/** A page in the menu. `href` may carry a query (tab or filter) that must match to be active. */
export interface NavItem {
  key: string;
  href: string;
  permission: PermissionKey;
  /** Kept for the command menu's icons; sections supply the icon in the sidebar. */
  icon: LucideIcon;
}

/**
 * A top-level menu entry, laid out like the old LRMIS menu: either a single page (href) or a
 * section that opens to show its pages. Sections without any visible page are hidden.
 */
export interface NavGroup {
  key: string;
  icon: LucideIcon;
  href?: string;
  permission?: PermissionKey;
  items: NavItem[];
  /** Extra sections the old system didn't have (shown after a divider). */
  extra?: boolean;
}

const s = (key: string, icon: LucideIcon, items: [string, string, PermissionKey][], extra = false): NavGroup => ({
  key,
  icon,
  extra,
  items: items.map(([k, href, permission]) => ({ key: k, href, permission, icon })),
});

/** Staff navigation, in the order and with the names of the old system's menu. */
export const STAFF_NAV: NavGroup[] = [
  { key: "dashboard", icon: LayoutDashboard, href: "/dashboard", permission: "dashboard.view", items: [] },
  s("landTransfer", ExternalLink, [
    ["transfer", "/transfers", "transfers.view"],
    ["transferredLands", "/transfers?f=approved", "transfers.view"],
  ]),
  s("billing", BookOpen, [
    ["singleInvoice", "/invoices/new", "invoices.create"],
    ["createBatches", "/billing/runs?new=1", "billing.create"],
    ["approveBatches", "/billing/runs?status=submitted", "billing.approve"],
    ["batches", "/billing/runs", "billing.view"],
  ]),
  s("receivable", HardDrive, [
    ["debtorInvoices", "/invoices?f=open", "invoices.view"],
    ["overdueInvoices", "/invoices?f=overdue", "invoices.view"],
    ["debtorPayments", "/payments", "payments.view"],
    ["duplicateInvoices", "/invoices/duplicates", "invoices.cancel"],
  ]),
  { key: "collections", icon: FolderOpen, href: "/cashier", permission: "cashier.view", items: [] },
  s("partialRegistration", PlusCircle, [
    ["yetToRegister", "/applications", "applications.view"],
    ["newRegistration", "/applications/new", "applications.create"],
    ["owners", "/owners", "owners.view"],
    ["fieldSurveys", "/surveys", "surveys.view"],
    ["returnedForCorrection", "/applications?status=returned", "applications.view"],
    ["excelImport", "/applications/import", "applications.create"],
  ]),
  s("registered", Home, [
    ["registeredOwners", "/owners?registered=1", "owners.view"],
    ["landParcels", "/parcels", "parcels.view"],
    ["dataCorrection", "/disputes?s=changes", "parcels.view"],
    ["enablePrinting", "/documents/print?tab=issue", "certificates.view"],
  ]),
  s("accountsSettings", Columns2, [
    ["pointOfSale", "/settings/accounts?tab=pos", "accounting.view"],
    ["cashiers", "/settings/accounts?tab=cashiers", "accounting.view"],
    ["glGroups", "/settings/accounts?tab=groups", "accounting.view"],
    ["glAccounts", "/accounting?tab=accounts", "accounting.view"],
    ["journals", "/accounting?tab=journal", "accounting.view"],
    ["bankAccounts", "/settings/accounts?tab=banks", "accounting.view"],
    ["currencies", "/settings/accounts?tab=currencies", "accounting.view"],
    ["currencyRates", "/accounting?tab=rates", "accounting.view"],
    ["feeTypes", "/valuation?tab=fees", "valuation.view"],
    ["propertyGrades", "/valuation?tab=grades", "valuation.view"],
  ]),
  s("locationSettings", MapPin, [
    ["districts", "/locations?level=districts", "locations.view"],
    ["sections", "/locations?level=sections", "locations.view"],
    ["sectors", "/locations?level=sectors", "locations.view"],
    ["neighbourhoods", "/locations?level=neighbourhoods", "locations.view"],
    ["streets", "/locations?level=streets", "locations.view"],
  ]),
  s("userSettings", Users, [
    ["users", "/admin/users", "users.view"],
    ["roles", "/admin/roles", "roles.view"],
    ["permissions", "/admin/permissions", "roles.view"],
    ["loginHistory", "/admin/login-history", "audit.view"],
  ]),
  { key: "systemSettings", icon: Settings, href: "/admin/settings", permission: "settings.view", items: [] },
  s("reports", BarChart3, [
    ["reports", "/reports", "reports.view"],
    ["incomeReport", "/reports?r=income", "reports.view"],
    ["assistant", "/assistant", "reports.view"],
  ]),
  s("sms", Mail, [
    ["smsTemplates", "/messages?s=templates", "messages.view"],
    ["singleSms", "/messages/send", "messages.create"],
    ["bulkSms", "/messages?s=campaigns", "messages.view"],
    ["smsLog", "/messages", "messages.view"],
  ]),
  s("certificates", BadgeCheck, [
    ["printingBatches", "/documents/print?tab=print", "certificates.view"],
    ["issuedDocuments", "/documents/print?tab=documents", "certificates.view"],
    ["reprints", "/documents/print?tab=reprints", "certificates.view"],
    ["printingReport", "/documents/print?tab=report", "certificates.view"],
  ]),
  // Beyond the old system.
  { key: "gisMap", icon: Map, href: "/map", permission: "map.view", items: [], extra: true },
  s(
    "valuation",
    Scale,
    [
      ["assessments", "/valuation", "valuation.view"],
      ["exemptions", "/valuation?tab=exemptions", "valuation.view"],
      ["appeals", "/valuation?tab=appeals", "valuation.view"],
    ],
    true,
  ),
  s(
    "legal",
    Gavel,
    [
      ["disputes", "/disputes", "disputes.view"],
      ["liens", "/disputes?s=liens", "disputes.view"],
      ["permits", "/permits", "permits.view"],
    ],
    true,
  ),
  s(
    "system",
    Activity,
    [
      ["health", "/admin/health", "settings.view"],
      ["audit", "/audit", "audit.view"],
    ],
    true,
  ),
];

export function visibleNav(can: (p: PermissionKey) => boolean): NavGroup[] {
  return STAFF_NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(i.permission)) })).filter((g) =>
    g.href ? !g.permission || can(g.permission) : g.items.length > 0,
  );
}

/** Which menu page best matches the current address (path plus the query keys it names). */
export function activeHref(groups: NavGroup[], pathname: string, search: URLSearchParams): string | null {
  let best: { href: string; score: number } | null = null;
  const candidates = groups.flatMap((g) => (g.href ? [g.href] : g.items.map((i) => i.href)));
  for (const href of candidates) {
    const [path, query] = href.split("?");
    const exact = pathname === path;
    if (!exact && !pathname.startsWith(`${path}/`)) continue;
    const want = new URLSearchParams(query ?? "");
    let ok = true;
    want.forEach((v, k) => {
      if (search.get(k) !== v) ok = false;
    });
    if (!ok) continue;
    // Exact paths beat nested ones; more matching query keys beat fewer.
    const score = (exact ? 100 : path!.length) + [...want.keys()].length * 10;
    if (!best || score > best.score) best = { href, score };
  }
  return best?.href ?? null;
}

