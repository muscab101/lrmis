import type { PermissionKey } from "@dhulka/core/permissions";
import {
  Activity,
  BadgeCheck,
  Banknote,
  BarChart3,
  Building2,
  ClipboardList,
  FileStack,
  Gavel,
  History,
  Home,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Map,
  MapPinned,
  MessageSquare,
  Receipt,
  Ruler,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  key: string;
  href: string;
  icon: LucideIcon;
  permission: PermissionKey;
  /** Delivery phase that builds the page (§13). Items without it exist now. */
  phase?: number;
}

export interface NavGroup {
  key: string;
  items: NavItem[];
}

/** Staff navigation. Items are hidden when the user lacks the permission. */
export const STAFF_NAV: NavGroup[] = [
  {
    key: "overview",
    items: [
      { key: "dashboard", href: "/dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
      { key: "map", href: "/map", icon: Map, permission: "map.view" },
    ],
  },
  {
    key: "land",
    items: [
      { key: "applications", href: "/applications", icon: ClipboardList, permission: "applications.view" },
      { key: "parcels", href: "/parcels", icon: MapPinned, permission: "parcels.view" },
      { key: "owners", href: "/owners", icon: Users, permission: "owners.view" },
      { key: "surveys", href: "/surveys", icon: Ruler, permission: "surveys.view" },
    ],
  },
  {
    key: "revenue",
    items: [
      { key: "valuation", href: "/valuation", icon: Scale, permission: "valuation.view" },
      { key: "billing", href: "/billing/runs", icon: FileStack, permission: "billing.view" },
      { key: "invoices", href: "/invoices", icon: Receipt, permission: "invoices.view" },
      { key: "payments", href: "/payments", icon: Banknote, permission: "payments.view" },
      { key: "cashier", href: "/cashier", icon: Wallet, permission: "cashier.view" },
      { key: "accounting", href: "/accounting", icon: Landmark, permission: "accounting.view" },
    ],
  },
  {
    key: "legal",
    items: [
      { key: "transfers", href: "/transfers", icon: Home, permission: "transfers.view", phase: 9 },
      { key: "disputes", href: "/disputes", icon: Gavel, permission: "disputes.view", phase: 9 },
      { key: "permits", href: "/permits", icon: Building2, permission: "permits.view", phase: 9 },
      { key: "certificates", href: "/documents/print", icon: BadgeCheck, permission: "certificates.view" },
    ],
  },
  {
    key: "insight",
    items: [
      { key: "reports", href: "/reports", icon: BarChart3, permission: "reports.view", phase: 10 },
      { key: "messages", href: "/messages", icon: MessageSquare, permission: "messages.view", phase: 10 },
      { key: "locations", href: "/locations", icon: MapPinned, permission: "locations.view" },
    ],
  },
  {
    key: "admin",
    items: [
      { key: "users", href: "/admin/users", icon: Users, permission: "users.view" },
      { key: "roles", href: "/admin/roles", icon: ShieldCheck, permission: "roles.view" },
      { key: "permissions", href: "/admin/permissions", icon: KeyRound, permission: "roles.view" },
      { key: "loginHistory", href: "/admin/login-history", icon: History, permission: "audit.view" },
      { key: "audit", href: "/audit", icon: ScrollText, permission: "audit.view" },
      { key: "settings", href: "/admin/settings", icon: Settings, permission: "settings.view" },
      { key: "health", href: "/admin/health", icon: Activity, permission: "settings.view", phase: 12 },
    ],
  },
];

export function visibleNav(can: (p: PermissionKey) => boolean): NavGroup[] {
  return STAFF_NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(i.permission)) })).filter(
    (g) => g.items.length > 0,
  );
}
