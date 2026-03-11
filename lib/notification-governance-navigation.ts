export type NotificationGovernanceMode = "platform" | "manager";

export type NotificationGovernanceNavKey =
  | "ops"
  | "audit"
  | "config-integrity"
  | "preflight"
  | "runtime-readiness";

export type NotificationGovernanceNavItem = {
  key: NotificationGovernanceNavKey;
  label: string;
  description: string;
  pagePath: string;
  apiPaths: string[];
  readOnly: true;
};

const PLATFORM_BASE = "/platform-admin";
const MANAGER_BASE = "/manager";

const NAV_DEFINITIONS: Array<Omit<NotificationGovernanceNavItem, "pagePath" | "apiPaths"> & {
  pageSegment: string;
  platformApiPaths: string[];
  managerApiPaths: string[];
}> = [
  {
    key: "ops",
    label: "Notifications Ops",
    description: "Reliability summary, scheduled health, coverage, retry overview.",
    pageSegment: "notifications-ops",
    platformApiPaths: [
      "/api/platform/notifications/ops/summary",
      "/api/platform/notifications/ops/health",
      "/api/platform/notifications/ops/coverage",
    ],
    managerApiPaths: [
      "/api/manager/notifications/ops/summary",
      "/api/manager/notifications/ops/health",
      "/api/manager/notifications/ops/coverage",
    ],
    readOnly: true,
  },
  {
    key: "audit",
    label: "Notifications Audit",
    description: "Admin operation audit trail explorer.",
    pageSegment: "notifications-audit",
    platformApiPaths: ["/api/platform/notifications/audit"],
    managerApiPaths: ["/api/manager/notifications/audit"],
    readOnly: true,
  },
  {
    key: "config-integrity",
    label: "Config Integrity",
    description: "Tenant notification config completeness and gap analysis.",
    pageSegment: "notifications-config-integrity",
    platformApiPaths: ["/api/platform/notifications/config-integrity"],
    managerApiPaths: ["/api/manager/notifications/config-integrity"],
    readOnly: true,
  },
  {
    key: "preflight",
    label: "Runtime Preflight",
    description: "Read-only preflight report for preference/template/planning resolution.",
    pageSegment: "notifications-preflight",
    platformApiPaths: ["/api/platform/notifications/preflight"],
    managerApiPaths: ["/api/manager/notifications/preflight"],
    readOnly: true,
  },
  {
    key: "runtime-readiness",
    label: "Runtime Readiness",
    description: "Read-only readiness report for future runtime integration.",
    pageSegment: "notifications-runtime-readiness",
    platformApiPaths: ["/api/platform/notifications/runtime-readiness"],
    managerApiPaths: ["/api/manager/notifications/runtime-readiness"],
    readOnly: true,
  },
];

export function getNotificationGovernanceNavItems(mode: NotificationGovernanceMode): NotificationGovernanceNavItem[] {
  const base = mode === "platform" ? PLATFORM_BASE : MANAGER_BASE;
  return NAV_DEFINITIONS.map((item) => ({
    key: item.key,
    label: item.label,
    description: item.description,
    pagePath: `${base}/${item.pageSegment}`,
    apiPaths: mode === "platform" ? item.platformApiPaths : item.managerApiPaths,
    readOnly: true,
  }));
}

export type NotificationGovernanceRouteMapItem = {
  key: NotificationGovernanceNavKey;
  platformPagePath: string;
  managerPagePath: string;
  platformApiPaths: string[];
  managerApiPaths: string[];
};

export function getNotificationGovernanceRouteMap(): NotificationGovernanceRouteMapItem[] {
  return NAV_DEFINITIONS.map((item) => ({
    key: item.key,
    platformPagePath: `${PLATFORM_BASE}/${item.pageSegment}`,
    managerPagePath: `${MANAGER_BASE}/${item.pageSegment}`,
    platformApiPaths: item.platformApiPaths,
    managerApiPaths: item.managerApiPaths,
  }));
}

export function isNotificationGovernancePath(pathname: string | null | undefined) {
  const normalized = String(pathname || "");
  return NAV_DEFINITIONS.some((item) => normalized.endsWith(`/${item.pageSegment}`));
}
