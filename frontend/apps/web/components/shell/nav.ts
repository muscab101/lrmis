import type { PermissionKey } from "@dhulka/core/permissions";
import {
  Activity,
  Stamp,
  BadgeCheck,
  Banknote,
  BarChart3,
  Building2,
  FileStack,
  Gavel,
  History,
  Home,
  IdCard,
  KeyRound,
  Landmark,
  LayoutDashboard,
  ListTodo,
  Map,
  MapPinned,
  Hammer,
  MapPinOff,
  MessageSquare,
  Receipt,
  Store,
  Ruler,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  type LucideIcon,
  Printer,
  MessagesSquare,
  MonitorPlay,
} from "lucide-react";

export interface NavItem {
  key: string;
  href: string;
  icon: LucideIcon;
  /** Left out: every staff member sees it. */
  permission?: PermissionKey;
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
      { key: "chat", href: "/chat", icon: MessagesSquare },
      { key: "incomplete", href: "/incomplete", icon: ListTodo, permission: "dashboard.view" },
    ],
  },
  {
    key: "land",
    items: [
      { key: "yetToRegister", href: "/parcels/yet-to-register", icon: MapPinOff, permission: "parcels.yet_to_register" },
      { key: "surveys", href: "/surveys", icon: Ruler, permission: "surveys.view" },
      { key: "owners", href: "/owners", icon: Users, permission: "owners.view" },
      { key: "parcels", href: "/parcels", icon: MapPinned, permission: "parcels.view" },
      { key: "demolished", href: "/demolished", icon: Hammer, permission: "parcels.demolitions" },
    ],
  },
  {
    key: "revenue",
    items: [
      { key: "valuation", href: "/valuation", icon: Scale, permission: "valuation.view" },
      { key: "billing", href: "/billing/runs", icon: FileStack, permission: "billing.view" },
      { key: "invoices", href: "/invoices", icon: Receipt, permission: "invoices.view" },
      { key: "payments", href: "/payments", icon: Banknote, permission: "payments.view" },
      { key: "collections", href: "/collections", icon: ShieldCheck, permission: "reconciliation.view" },
      { key: "cashier", href: "/cashier", icon: Wallet, permission: "cashier.view" },
      { key: "pointsOfSale", href: "/points-of-sale", icon: Store, permission: "payments.view" },
      { key: "accounting", href: "/accounting", icon: Landmark, permission: "accounting.view" },
    ],
  },
  {
    key: "legal",
    items: [
      { key: "transfers", href: "/transfers", icon: Home, permission: "transfers.view" },
      { key: "disputes", href: "/disputes", icon: Gavel, permission: "disputes.view" },
      { key: "permits", href: "/permits", icon: Building2, permission: "permits.view" },
      { key: "certificates", href: "/documents/print", icon: BadgeCheck, permission: "certificates.view" },
      { key: "idCards", href: "/documents/cards", icon: IdCard, permission: "certificates.id_cards" },
      { key: "addPrinter", href: "/printers", icon: Printer, permission: "certificates.printers" },
    ],
  },
  {
    key: "insight",
    items: [
      { key: "reports", href: "/reports", icon: BarChart3, permission: "reports.view" },
      { key: "assistant", href: "/assistant", icon: Sparkles, permission: "dashboard.view" },
      { key: "messages", href: "/messages", icon: MessageSquare, permission: "messages.view" },
      { key: "locations", href: "/locations", icon: MapPinned, permission: "locations.view" },
    ],
  },
  {
    key: "admin",
    items: [
      { key: "users", href: "/admin/users", icon: Users, permission: "users.view" },
      { key: "roles", href: "/admin/roles", icon: ShieldCheck, permission: "roles.view" },
      { key: "permissions", href: "/admin/permissions", icon: KeyRound, permission: "roles.view" },
      { key: "activity", href: "/admin/activity", icon: MonitorPlay, permission: "audit.view" },
      { key: "loginHistory", href: "/admin/login-history", icon: History, permission: "audit.view" },
      { key: "audit", href: "/audit", icon: ScrollText, permission: "audit.view" },
      { key: "signatureStamp", href: "/admin/signature-stamp", icon: Stamp, permission: "certificates.signature" },
      { key: "settings", href: "/admin/settings", icon: Settings, permission: "settings.view" },
      { key: "health", href: "/admin/health", icon: Activity, permission: "settings.view" },
    ],
  },
];

export function visibleNav(can: (p: PermissionKey) => boolean): NavGroup[] {
  return STAFF_NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || can(i.permission)) })).filter(
    (g) => g.items.length > 0,
  );
}
