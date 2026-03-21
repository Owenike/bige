export type ManagerDomainKey =
  | "manager"
  | "settings"
  | "therapists"
  | "coach-slots"
  | "services"
  | "plans"
  | "packages"
  | "booking-waitlist"
  | "integrations"
  | "operations"
  | "notifications";

export type ManagerDomainSection = "landing" | "business" | "system";

export type ManagerDomainRouteKind = "landing" | "manager-subpage" | "settings-subpage" | "domain-entry";

export type ManagerDomainItem = {
  key: ManagerDomainKey;
  label: string;
  pagePath: string;
  section: ManagerDomainSection;
  routeKind: ManagerDomainRouteKind;
  owns: string;
  doesNotOwn: string;
  useWhen: string;
};

const ITEMS: ManagerDomainItem[] = [
  {
    key: "manager",
    label: "Manager Hub",
    pagePath: "/manager",
    section: "landing",
    routeKind: "landing",
    owns: "Top-level manager landing, business-domain discovery, and manager-wide route index.",
    doesNotOwn: "Deep settings policy editing, notifications subdomain execution, or frontdesk booking operations.",
    useWhen: "Start here when you need to decide which manager page or subdomain to open next.",
  },
  {
    key: "settings",
    label: "Settings Hub",
    pagePath: "/manager/settings",
    section: "landing",
    routeKind: "landing",
    owns: "Settings-domain landing, global policy entry points, integrations entry, and notifications system entry.",
    doesNotOwn: "Business master data like services, therapists, packages, or waitlist execution itself.",
    useWhen: "Open this page when you need system-level policy, integrations, or notifications governance entry points.",
  },
  {
    key: "therapists",
    label: "Therapists",
    pagePath: "/manager/therapists",
    section: "business",
    routeKind: "manager-subpage",
    owns: "Coach identity, branch assignment, and active status master data.",
    doesNotOwn: "Slot scheduling rules, global operations policy, or booking-day frontdesk execution.",
    useWhen: "Use this page when coach master data or branch coverage needs to change.",
  },
  {
    key: "coach-slots",
    label: "Coach Slots",
    pagePath: "/manager/coach-slots",
    section: "business",
    routeKind: "manager-subpage",
    owns: "Scheduling windows, blocked time, and slot availability maintenance.",
    doesNotOwn: "Coach identity master data, package rules, or global settings governance.",
    useWhen: "Use this page when staffing availability, slots, or blocked times need adjustment.",
  },
  {
    key: "services",
    label: "Services",
    pagePath: "/manager/services",
    section: "business",
    routeKind: "manager-subpage",
    owns: "Service catalog, duration/pricing metadata, and service-level business rules.",
    doesNotOwn: "Package sales configuration, storefront-global settings, or notifications governance.",
    useWhen: "Use this page when the service catalog or service-level commercial rules need updates.",
  },
  {
    key: "plans",
    label: "Plans",
    pagePath: "/manager/plans",
    section: "business",
    routeKind: "manager-subpage",
    owns: "Membership plan definitions and plan-side entitlement rules.",
    doesNotOwn: "Package sale bundles, slot scheduling, or system-level integration policy.",
    useWhen: "Use this page when recurring plan rules or membership entitlements need review.",
  },
  {
    key: "packages",
    label: "Packages",
    pagePath: "/manager/packages",
    section: "business",
    routeKind: "manager-subpage",
    owns: "Package sale configuration, redemption framing, and sellable bundle setup.",
    doesNotOwn: "Plan policy, service catalog master data, or operations governance.",
    useWhen: "Use this page when sellable packages or redemption framing need adjustment.",
  },
  {
    key: "booking-waitlist",
    label: "Booking Waitlist",
    pagePath: "/manager/booking-waitlist",
    section: "business",
    routeKind: "manager-subpage",
    owns: "Waitlist intake, status tracking, and manager-side conversion workflow.",
    doesNotOwn: "Frontdesk booking creation loop, slot policy, or notifications configuration.",
    useWhen: "Use this page when supply gaps require waitlist follow-up and conversion management.",
  },
  {
    key: "integrations",
    label: "Integrations",
    pagePath: "/manager/integrations",
    section: "system",
    routeKind: "manager-subpage",
    owns: "External boundary visibility, readiness entry, and cross-system delivery boundary notes.",
    doesNotOwn: "OAuth/provider credential editing, business master data, or notification retry execution.",
    useWhen: "Use this page when an external boundary or channel integration status needs review.",
  },
  {
    key: "operations",
    label: "Operations",
    pagePath: "/manager/settings/operations",
    section: "system",
    routeKind: "settings-subpage",
    owns: "Global operating defaults, permission-adjacent policy, and branch/tenant-level booking governance.",
    doesNotOwn: "Business catalog CRUD, notifications subdomain workflows, or auth/activation systems.",
    useWhen: "Use this page when a cross-page operating policy or permission boundary needs adjustment.",
  },
  {
    key: "notifications",
    label: "Notifications",
    pagePath: "/manager/notifications",
    section: "system",
    routeKind: "domain-entry",
    owns: "Manager-facing notifications subdomain landing and entry to retry, audit, readiness, templates, preferences, and ops.",
    doesNotOwn: "General business catalog maintenance or unrelated system policy outside notifications.",
    useWhen: "Use this page when the issue belongs to notifications and you need the correct notifications subpage.",
  },
];

export function getManagerDomainItems() {
  return ITEMS;
}

export function getManagerDomainItemsForSection(section: ManagerDomainSection | "all") {
  if (section === "all") return ITEMS;
  return ITEMS.filter((item) => item.section === section);
}
