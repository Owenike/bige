import { getNotificationGovernanceRouteMap, type NotificationGovernanceNavKey } from "./notification-governance-navigation";

export type NotificationGovernanceRouteFileMapItem = {
  key: NotificationGovernanceNavKey;
  platformPagePath: string;
  managerPagePath: string;
  platformPageFile: string;
  managerPageFile: string;
  componentFile: string;
  platformApiFiles: string[];
  managerApiFiles: string[];
};

const PLATFORM_PAGE_FILE_BY_KEY: Record<NotificationGovernanceNavKey, string> = {
  ops: "app/platform-admin/notifications-ops/page.tsx",
  audit: "app/platform-admin/notifications-audit/page.tsx",
  "config-integrity": "app/platform-admin/notifications-config-integrity/page.tsx",
  preflight: "app/platform-admin/notifications-preflight/page.tsx",
  "runtime-readiness": "app/platform-admin/notifications-runtime-readiness/page.tsx",
};

const MANAGER_PAGE_FILE_BY_KEY: Record<NotificationGovernanceNavKey, string> = {
  ops: "app/manager/notifications-ops/page.tsx",
  audit: "app/manager/notifications-audit/page.tsx",
  "config-integrity": "app/manager/notifications-config-integrity/page.tsx",
  preflight: "app/manager/notifications-preflight/page.tsx",
  "runtime-readiness": "app/manager/notifications-runtime-readiness/page.tsx",
};

const COMPONENT_FILE_BY_KEY: Record<NotificationGovernanceNavKey, string> = {
  ops: "components/notification-ops-dashboard.tsx",
  audit: "components/notification-audit-read-dashboard.tsx",
  "config-integrity": "components/notification-config-integrity-dashboard.tsx",
  preflight: "components/notification-preflight-dashboard.tsx",
  "runtime-readiness": "components/notification-runtime-readiness-dashboard.tsx",
};

const PLATFORM_API_FILES_BY_KEY: Record<NotificationGovernanceNavKey, string[]> = {
  ops: [
    "app/api/platform/notifications/ops/summary/route.ts",
    "app/api/platform/notifications/ops/health/route.ts",
    "app/api/platform/notifications/ops/coverage/route.ts",
  ],
  audit: ["app/api/platform/notifications/audit/route.ts"],
  "config-integrity": ["app/api/platform/notifications/config-integrity/route.ts"],
  preflight: ["app/api/platform/notifications/preflight/route.ts"],
  "runtime-readiness": ["app/api/platform/notifications/runtime-readiness/route.ts"],
};

const MANAGER_API_FILES_BY_KEY: Record<NotificationGovernanceNavKey, string[]> = {
  ops: [
    "app/api/manager/notifications/ops/summary/route.ts",
    "app/api/manager/notifications/ops/health/route.ts",
    "app/api/manager/notifications/ops/coverage/route.ts",
  ],
  audit: ["app/api/manager/notifications/audit/route.ts"],
  "config-integrity": ["app/api/manager/notifications/config-integrity/route.ts"],
  preflight: ["app/api/manager/notifications/preflight/route.ts"],
  "runtime-readiness": ["app/api/manager/notifications/runtime-readiness/route.ts"],
};

export function getNotificationGovernanceRouteFileMap(): NotificationGovernanceRouteFileMapItem[] {
  return getNotificationGovernanceRouteMap().map((item) => ({
    key: item.key,
    platformPagePath: item.platformPagePath,
    managerPagePath: item.managerPagePath,
    platformPageFile: PLATFORM_PAGE_FILE_BY_KEY[item.key],
    managerPageFile: MANAGER_PAGE_FILE_BY_KEY[item.key],
    componentFile: COMPONENT_FILE_BY_KEY[item.key],
    platformApiFiles: PLATFORM_API_FILES_BY_KEY[item.key],
    managerApiFiles: MANAGER_API_FILES_BY_KEY[item.key],
  }));
}
