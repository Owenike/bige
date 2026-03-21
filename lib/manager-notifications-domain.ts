export type ManagerNotificationsDomainKey =
  | "overview"
  | "retry"
  | "audit"
  | "readiness"
  | "runtime-readiness"
  | "config-integrity"
  | "preferences"
  | "templates"
  | "preflight"
  | "ops";

export type ManagerNotificationsDomainItem = {
  key: ManagerNotificationsDomainKey;
  label: string;
  pagePath: string;
  routeKind: "parallel" | "nested";
  owns: string;
  doesNotOwn: string;
  useWhen: string;
};

const ITEMS: ManagerNotificationsDomainItem[] = [
  {
    key: "overview",
    label: "Overview",
    pagePath: "/manager/notifications",
    routeKind: "parallel",
    owns: "Notification domain landing page, high-level summary, and top-level workbench entry.",
    doesNotOwn: "Deep retry, audit, preflight, readiness, or manager-level ops execution detail.",
    useWhen: "Start here when you need to decide which notification page to open next.",
  },
  {
    key: "retry",
    label: "Retry",
    pagePath: "/manager/notification-retry",
    routeKind: "parallel",
    owns: "Failed / retrying deliveries, remediation queue, and row-level retry entry points.",
    doesNotOwn: "Scheduled health, recent run reporting, or global ops summaries.",
    useWhen: "Use this page when a specific failed or retrying delivery needs remediation.",
  },
  {
    key: "audit",
    label: "Audit",
    pagePath: "/manager/notifications-audit",
    routeKind: "parallel",
    owns: "Run history, audit trail, delivery history, and read-only trace review.",
    doesNotOwn: "Retry execution, readiness maintenance, or template / preference editing.",
    useWhen: "Use this page when you need to inspect what happened over time.",
  },
  {
    key: "readiness",
    label: "Readiness",
    pagePath: "/manager/notifications/readiness",
    routeKind: "nested",
    owns: "Static channel readiness, configuration gaps, coverage gaps, and blocking hints.",
    doesNotOwn: "Live runtime mismatch analysis or event-specific pre-dispatch planning.",
    useWhen: "Use this page when a channel looks misconfigured or blocked before delivery.",
  },
  {
    key: "runtime-readiness",
    label: "Runtime Readiness",
    pagePath: "/manager/notifications-runtime-readiness",
    routeKind: "parallel",
    owns: "Live constraints, runtime blocked reasons, and fixture-vs-live mismatch signals.",
    doesNotOwn: "Static readiness gap reporting or preflight planning.",
    useWhen: "Use this page when live runtime behavior does not match expected readiness.",
  },
  {
    key: "config-integrity",
    label: "Config Integrity",
    pagePath: "/manager/notifications-config-integrity",
    routeKind: "parallel",
    owns: "Domain-level completeness summary for templates, preferences, and channel coverage.",
    doesNotOwn: "Editing templates or preferences directly.",
    useWhen: "Use this page when you need to see where notification configuration is incomplete.",
  },
  {
    key: "preferences",
    label: "Preferences",
    pagePath: "/manager/notifications-preferences",
    routeKind: "parallel",
    owns: "Role / user event-channel preference rules and preference completeness editing.",
    doesNotOwn: "Template maintenance, retry execution, or provider setup.",
    useWhen: "Use this page when preference gaps or role/user opt-in rules need adjustment.",
  },
  {
    key: "templates",
    label: "Templates",
    pagePath: "/manager/notifications/templates",
    routeKind: "nested",
    owns: "Event / channel template coverage and minimal tenant-scope template editing.",
    doesNotOwn: "Preference rules, readiness diagnostics, or dispatch runtime analysis.",
    useWhen: "Use this page when a message template is missing or needs a tenant-scope update.",
  },
  {
    key: "preflight",
    label: "Preflight",
    pagePath: "/manager/notifications-preflight",
    routeKind: "parallel",
    owns: "Sendability resolution, selected channel decision, and pre-dispatch checks for an event.",
    doesNotOwn: "Live runtime dependency analysis or template/preference editing itself.",
    useWhen: "Use this page when you need to know why an event would send, skip, or block before dispatch.",
  },
  {
    key: "ops",
    label: "Ops",
    pagePath: "/manager/notifications-ops",
    routeKind: "parallel",
    owns: "Scheduled health, recent runs, external delivery summary, and manager-level batch ops.",
    doesNotOwn: "Row-level retry / remediation queue ownership or the integrations catalog.",
    useWhen: "Use this page when you need batch-level operational status or sweep-style actions.",
  },
];

export function getManagerNotificationsDomainItems() {
  return ITEMS;
}

