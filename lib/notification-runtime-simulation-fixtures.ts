import type { NotificationRolePreferenceIntegrityRow } from "./notification-config-integrity";
import type { NotificationDeliveryPlanningDraftInput } from "./notification-delivery-planning-draft-service";
import type { NotificationPreferenceResolutionInput } from "./notification-preference-resolution-service";
import type { NotificationTemplateResolutionRow } from "./notification-template-resolution-service";
import type {
  NotificationRuntimeEventInputContract,
  NotificationRuntimeFallbackReasonCode,
  NotificationRuntimeSkippedReasonCode,
} from "./notification-runtime-integration-contracts";

export type NotificationRuntimeSimulationScenarioId =
  | "complete_tenant_ready"
  | "missing_template_tenant"
  | "missing_preference_tenant"
  | "user_override_disabled"
  | "role_fallback_tenant_default"
  | "skipped_disabled_scenario";

export const NOTIFICATION_RUNTIME_SIMULATION_SCENARIO_IDS: readonly NotificationRuntimeSimulationScenarioId[] = [
  "complete_tenant_ready",
  "missing_template_tenant",
  "missing_preference_tenant",
  "user_override_disabled",
  "role_fallback_tenant_default",
  "skipped_disabled_scenario",
] as const;

export type NotificationRuntimeSimulationScenario = {
  id: NotificationRuntimeSimulationScenarioId;
  name: string;
  description: string;
  eventInput: NotificationRuntimeEventInputContract;
  preferenceInput: NotificationPreferenceResolutionInput;
  templates: NotificationTemplateResolutionRow[];
  recipients: NonNullable<NotificationDeliveryPlanningDraftInput["recipients"]>;
  rolePreferenceRows: NotificationRolePreferenceIntegrityRow[];
  expected: {
    ready: boolean;
    skippedCodes: NotificationRuntimeSkippedReasonCode[];
    fallbackReasons: NotificationRuntimeFallbackReasonCode[];
  };
};

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const USER_MANAGER = "22222222-2222-4222-8222-222222222222";
const USER_SALES = "33333333-3333-4333-8333-333333333333";

function createBaseTemplates(): NotificationTemplateResolutionRow[] {
  return [
    {
      id: "tpl-tenant-in-app",
      tenant_id: TENANT_A,
      event_type: "opportunity_due",
      channel: "in_app",
      locale: "zh-TW",
      title_template: "Opportunity due",
      message_template: "Please review opportunity",
      email_subject: null,
      action_url: "/manager/opportunities",
      priority: "warning",
      channel_policy: {},
      is_active: true,
      version: 2,
      updated_at: "2026-03-11T00:00:00.000Z",
    },
    {
      id: "tpl-global-email",
      tenant_id: null,
      event_type: "opportunity_due",
      channel: "email",
      locale: "zh-TW",
      title_template: "Opportunity due email",
      message_template: "Email body",
      email_subject: "Opportunity due",
      action_url: "/manager/opportunities",
      priority: "warning",
      channel_policy: {},
      is_active: true,
      version: 1,
      updated_at: "2026-03-10T00:00:00.000Z",
    },
  ];
}

function baseRoleRows(): NotificationRolePreferenceIntegrityRow[] {
  return [
    {
      role: "manager",
      event_type: "opportunity_due",
      is_enabled: true,
      channels: {
        in_app: true,
        email: true,
        line: false,
        sms: false,
        webhook: false,
      },
    },
  ];
}

function baseRecipients() {
  return [
    {
      userId: USER_MANAGER,
      role: "manager",
    },
  ];
}

function baseEventInput(): NotificationRuntimeEventInputContract {
  return {
    tenantId: TENANT_A,
    eventKey: "opportunity_due",
    roleKey: "manager",
    userId: null,
    channelHint: null,
    locale: "zh-TW",
    defaultLocale: "zh-TW",
    recipientLimit: 20,
    payload: {},
  };
}

const SCENARIOS: NotificationRuntimeSimulationScenario[] = [
  {
    id: "complete_tenant_ready",
    name: "Complete tenant ready",
    description: "Role preference and templates are available; runtime readiness should be true.",
    eventInput: baseEventInput(),
    preferenceInput: {
      tenantDefault: {
        enabled: true,
        channels: { in_app: true, email: true },
        reason: "tenant default",
      },
      rolePreference: {
        enabled: true,
        channels: { in_app: true, email: true },
        reason: "manager role enabled",
      },
    },
    templates: createBaseTemplates(),
    recipients: baseRecipients(),
    rolePreferenceRows: baseRoleRows(),
    expected: {
      ready: true,
      skippedCodes: [],
      fallbackReasons: ["GLOBAL_LOCALE_FALLBACK"],
    },
  },
  {
    id: "missing_template_tenant",
    name: "Missing template tenant",
    description: "Preference enables email but email template is missing.",
    eventInput: baseEventInput(),
    preferenceInput: {
      rolePreference: {
        enabled: true,
        channels: { in_app: false, email: true },
      },
    },
    templates: [],
    recipients: baseRecipients(),
    rolePreferenceRows: baseRoleRows(),
    expected: {
      ready: false,
      skippedCodes: ["CHANNEL_TEMPLATE_MISSING"],
      fallbackReasons: ["NO_TEMPLATE_FOUND"],
    },
  },
  {
    id: "missing_preference_tenant",
    name: "Missing preference tenant",
    description: "No explicit platform/tenant/role/user preference; system default applies.",
    eventInput: baseEventInput(),
    preferenceInput: {},
    templates: createBaseTemplates(),
    recipients: baseRecipients(),
    rolePreferenceRows: [],
    expected: {
      ready: true,
      skippedCodes: [],
      fallbackReasons: ["GLOBAL_LOCALE_FALLBACK"],
    },
  },
  {
    id: "user_override_disabled",
    name: "User override disabled",
    description: "User-level preference disables notification delivery.",
    eventInput: {
      ...baseEventInput(),
      userId: USER_MANAGER,
    },
    preferenceInput: {
      rolePreference: {
        enabled: true,
        channels: { in_app: true, email: true },
      },
      userPreference: {
        enabled: false,
        channels: { in_app: false, email: false, line: false, sms: false, webhook: false },
        reason: "user opt-out",
      },
    },
    templates: createBaseTemplates(),
    recipients: baseRecipients(),
    rolePreferenceRows: baseRoleRows(),
    expected: {
      ready: false,
      skippedCodes: ["PREFERENCE_DISABLED", "NO_CHANNEL_ENABLED"],
      fallbackReasons: [],
    },
  },
  {
    id: "role_fallback_tenant_default",
    name: "Role fallback to tenant default",
    description: "Role preference missing; tenant default becomes winner.",
    eventInput: {
      ...baseEventInput(),
      roleKey: "sales",
    },
    preferenceInput: {
      tenantDefault: {
        enabled: true,
        channels: { in_app: true, email: true },
      },
    },
    templates: createBaseTemplates(),
    recipients: [
      {
        userId: USER_SALES,
        role: "sales",
      },
    ],
    rolePreferenceRows: [],
    expected: {
      ready: true,
      skippedCodes: [],
      fallbackReasons: ["GLOBAL_LOCALE_FALLBACK"],
    },
  },
  {
    id: "skipped_disabled_scenario",
    name: "Skipped disabled scenario",
    description: "No recipients and preference disabled produce readiness=false with multiple skipped reasons.",
    eventInput: baseEventInput(),
    preferenceInput: {
      tenantDefault: {
        enabled: false,
        channels: { in_app: false, email: false, line: false, sms: false, webhook: false },
      },
    },
    templates: createBaseTemplates(),
    recipients: [],
    rolePreferenceRows: baseRoleRows(),
    expected: {
      ready: false,
      skippedCodes: ["PREFERENCE_DISABLED", "NO_CHANNEL_ENABLED", "NO_RECIPIENTS"],
      fallbackReasons: [],
    },
  },
];

export function parseNotificationRuntimeSimulationScenarioId(input: string | null | undefined) {
  const value = String(input || "").trim();
  if (!value) return null;
  return (NOTIFICATION_RUNTIME_SIMULATION_SCENARIO_IDS as readonly string[]).includes(value)
    ? (value as NotificationRuntimeSimulationScenarioId)
    : null;
}

export function listNotificationRuntimeSimulationScenarios(): NotificationRuntimeSimulationScenario[] {
  return SCENARIOS.map((item) => ({
    ...item,
    eventInput: {
      ...item.eventInput,
      payload: { ...item.eventInput.payload },
    },
    templates: item.templates.map((row) => ({
      ...row,
      channel_policy: row.channel_policy ? { ...row.channel_policy } : row.channel_policy,
    })),
    recipients: item.recipients.map((recipient) => ({ ...recipient })),
    rolePreferenceRows: item.rolePreferenceRows.map((row) => ({
      ...row,
      channels: { ...row.channels },
    })),
  }));
}

export function getNotificationRuntimeSimulationScenario(
  id: NotificationRuntimeSimulationScenarioId,
): NotificationRuntimeSimulationScenario | null {
  return listNotificationRuntimeSimulationScenarios().find((item) => item.id === id) || null;
}
