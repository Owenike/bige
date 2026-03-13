export type NotificationDeliveryChannel = "in_app" | "email" | "line" | "sms" | "webhook" | "other";

export type NotificationAggregationMode = "auto" | "raw" | "rollup";

export type NotificationReadApiWindowType = "whole_utc_day" | "partial_utc_window";

export type NotificationOverviewQueryState = {
  tenantId: string;
  channel: "" | NotificationDeliveryChannel;
  from: string;
  to: string;
  limit: number;
};

export type NotificationTenantDrilldownQueryState = {
  channel: "" | NotificationDeliveryChannel;
  aggregationMode: NotificationAggregationMode;
  from: string;
  to: string;
  limit: number;
  anomalyLimit: number;
};

export type NotificationReadApiQueryIssueKind =
  | "invalid_datetime"
  | "invalid_aggregation_mode"
  | "invalid_number"
  | "range_inverted";

export type NotificationReadApiQueryIssue = {
  kind: NotificationReadApiQueryIssueKind;
  field: string;
  message: string;
};

type NotificationWindowNormalization = {
  from: string;
  to: string;
  fromIso: string;
  toIso: string;
  windowType: NotificationReadApiWindowType;
  issues: NotificationReadApiQueryIssue[];
};

type NotificationNowFactory = Date | (() => Date);

const OVERVIEW_LIMIT_MIN = 200;
const OVERVIEW_LIMIT_MAX = 50_000;
const OVERVIEW_LIMIT_DEFAULT = 2_000;
const ANOMALY_LIMIT_MIN = 10;
const ANOMALY_LIMIT_MAX = 120;
const ANOMALY_LIMIT_DEFAULT = 40;

function resolveNow(now?: NotificationNowFactory) {
  if (typeof now === "function") return now();
  if (now instanceof Date) return now;
  return new Date();
}

export function toNotificationReadApiLocalDateTimeInput(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const tzOffset = date.getTimezoneOffset();
  return new Date(date.getTime() - tzOffset * 60_000).toISOString().slice(0, 16);
}

export function parseNotificationReadApiLocalDateTimeToIso(input: string) {
  const value = String(input || "").trim();
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function parseNotificationReadApiIsoQueryToLocalInput(raw: string | null) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return toNotificationReadApiLocalDateTimeInput(parsed.toISOString());
}

function isWholeUtcDayWindow(fromIso: string, toIso: string) {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return false;

  return (
    from.getUTCHours() === 0 &&
    from.getUTCMinutes() === 0 &&
    from.getUTCSeconds() === 0 &&
    from.getUTCMilliseconds() === 0 &&
    to.getUTCHours() === 23 &&
    to.getUTCMinutes() === 59 &&
    to.getUTCSeconds() === 59 &&
    to.getUTCMilliseconds() === 999 &&
    to.getTime() >= from.getTime()
  );
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function normalizeAggregationMode(value: unknown) {
  if (value === "auto" || value === "raw" || value === "rollup") {
    return {
      value,
      issue: null,
    } as const;
  }

  return {
    value: "auto" as const,
    issue: {
      kind: "invalid_aggregation_mode" as const,
      field: "aggregationMode",
      message: `aggregationMode must be auto, raw, or rollup; received ${String(value || "") || "<empty>"}.`,
    },
  };
}

function normalizeWindowInputs(
  rawFrom: string,
  rawTo: string,
  fallbackFrom: string,
  fallbackTo: string,
): NotificationWindowNormalization {
  const issues: NotificationReadApiQueryIssue[] = [];
  let from = String(rawFrom || "");
  let to = String(rawTo || "");
  let fromIso = parseNotificationReadApiLocalDateTimeToIso(from);
  let toIso = parseNotificationReadApiLocalDateTimeToIso(to);

  if (!fromIso) {
    from = fallbackFrom;
    fromIso = parseNotificationReadApiLocalDateTimeToIso(from)!;
    issues.push({
      kind: "invalid_datetime",
      field: "from",
      message: "from must be a valid datetime-local value; default window start was used instead.",
    });
  }

  if (!toIso) {
    to = fallbackTo;
    toIso = parseNotificationReadApiLocalDateTimeToIso(to)!;
    issues.push({
      kind: "invalid_datetime",
      field: "to",
      message: "to must be a valid datetime-local value; default window end was used instead.",
    });
  }

  if (fromIso > toIso) {
    [from, to] = [to, from];
    [fromIso, toIso] = [toIso, fromIso];
    issues.push({
      kind: "range_inverted",
      field: "from,to",
      message: "from was after to; the window bounds were swapped to keep the request valid.",
    });
  }

  return {
    from,
    to,
    fromIso,
    toIso,
    windowType: isWholeUtcDayWindow(fromIso, toIso) ? "whole_utc_day" : "partial_utc_window",
    issues,
  };
}

export function createNotificationOverviewQueryStateDefaults(now?: NotificationNowFactory): NotificationOverviewQueryState {
  const current = resolveNow(now);
  const last7d = new Date(current.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    tenantId: "",
    channel: "",
    from: toNotificationReadApiLocalDateTimeInput(last7d.toISOString()),
    to: toNotificationReadApiLocalDateTimeInput(current.toISOString()),
    limit: OVERVIEW_LIMIT_DEFAULT,
  };
}

export function createNotificationTenantDrilldownQueryStateDefaults(
  now?: NotificationNowFactory,
): NotificationTenantDrilldownQueryState {
  const overviewDefaults = createNotificationOverviewQueryStateDefaults(now);
  return {
    channel: "",
    aggregationMode: "auto",
    from: overviewDefaults.from,
    to: overviewDefaults.to,
    limit: OVERVIEW_LIMIT_DEFAULT,
    anomalyLimit: ANOMALY_LIMIT_DEFAULT,
  };
}

export function normalizeNotificationOverviewQueryState(
  input: Partial<NotificationOverviewQueryState>,
  now?: NotificationNowFactory,
) {
  const defaults = createNotificationOverviewQueryStateDefaults(now);
  const issues: NotificationReadApiQueryIssue[] = [];
  const window = normalizeWindowInputs(input.from ?? defaults.from, input.to ?? defaults.to, defaults.from, defaults.to);
  issues.push(...window.issues);

  const limit = clampNumber(input.limit, OVERVIEW_LIMIT_DEFAULT, OVERVIEW_LIMIT_MIN, OVERVIEW_LIMIT_MAX);
  if (String(input.limit ?? "").trim() !== "" && Number(limit) !== Number(input.limit)) {
    issues.push({
      kind: "invalid_number",
      field: "limit",
      message: `limit was normalized into the supported range ${OVERVIEW_LIMIT_MIN}-${OVERVIEW_LIMIT_MAX}.`,
    });
  }

  return {
    state: {
      tenantId: String(input.tenantId ?? defaults.tenantId).trim(),
      channel: (input.channel as NotificationOverviewQueryState["channel"]) || defaults.channel,
      from: window.from,
      to: window.to,
      limit,
    } satisfies NotificationOverviewQueryState,
    windowType: window.windowType,
    fromIso: window.fromIso,
    toIso: window.toIso,
    issues,
  };
}

export function normalizeNotificationTenantDrilldownQueryState(
  input: Partial<NotificationTenantDrilldownQueryState>,
  now?: NotificationNowFactory,
) {
  const defaults = createNotificationTenantDrilldownQueryStateDefaults(now);
  const issues: NotificationReadApiQueryIssue[] = [];
  const window = normalizeWindowInputs(input.from ?? defaults.from, input.to ?? defaults.to, defaults.from, defaults.to);
  issues.push(...window.issues);

  const aggregationMode = normalizeAggregationMode(input.aggregationMode);
  if (aggregationMode.issue) issues.push(aggregationMode.issue);

  const limit = clampNumber(input.limit, OVERVIEW_LIMIT_DEFAULT, OVERVIEW_LIMIT_MIN, OVERVIEW_LIMIT_MAX);
  if (String(input.limit ?? "").trim() !== "" && Number(limit) !== Number(input.limit)) {
    issues.push({
      kind: "invalid_number",
      field: "limit",
      message: `limit was normalized into the supported range ${OVERVIEW_LIMIT_MIN}-${OVERVIEW_LIMIT_MAX}.`,
    });
  }

  const anomalyLimit = clampNumber(input.anomalyLimit, ANOMALY_LIMIT_DEFAULT, ANOMALY_LIMIT_MIN, ANOMALY_LIMIT_MAX);
  if (String(input.anomalyLimit ?? "").trim() !== "" && Number(anomalyLimit) !== Number(input.anomalyLimit)) {
    issues.push({
      kind: "invalid_number",
      field: "anomalyLimit",
      message: `anomalyLimit was normalized into the supported range ${ANOMALY_LIMIT_MIN}-${ANOMALY_LIMIT_MAX}.`,
    });
  }

  return {
    state: {
      channel: (input.channel as NotificationTenantDrilldownQueryState["channel"]) || defaults.channel,
      aggregationMode: aggregationMode.value,
      from: window.from,
      to: window.to,
      limit,
      anomalyLimit,
    } satisfies NotificationTenantDrilldownQueryState,
    windowType: window.windowType,
    fromIso: window.fromIso,
    toIso: window.toIso,
    issues,
  };
}

export function hydrateNotificationOverviewQueryStateFromSearchParams(
  searchParams: URLSearchParams | ReadonlyURLSearchParamsLike,
  now?: NotificationNowFactory,
) {
  return normalizeNotificationOverviewQueryState(
    {
      tenantId: searchParams.get("tenantId") || "",
      channel: (searchParams.get("channel") as NotificationOverviewQueryState["channel"]) || "",
      from: parseNotificationReadApiIsoQueryToLocalInput(searchParams.get("from")),
      to: parseNotificationReadApiIsoQueryToLocalInput(searchParams.get("to")),
      limit: Number(searchParams.get("limit") ?? OVERVIEW_LIMIT_DEFAULT),
    },
    now,
  );
}

export function hydrateNotificationTenantDrilldownQueryStateFromSearchParams(
  searchParams: URLSearchParams | ReadonlyURLSearchParamsLike,
  now?: NotificationNowFactory,
) {
  return normalizeNotificationTenantDrilldownQueryState(
    {
      channel: (searchParams.get("channel") as NotificationTenantDrilldownQueryState["channel"]) || "",
      aggregationMode: (searchParams.get("aggregationMode") as NotificationAggregationMode) || "auto",
      from: parseNotificationReadApiIsoQueryToLocalInput(searchParams.get("from")),
      to: parseNotificationReadApiIsoQueryToLocalInput(searchParams.get("to")),
      limit: Number(searchParams.get("limit") ?? OVERVIEW_LIMIT_DEFAULT),
      anomalyLimit: Number(searchParams.get("anomalyLimit") ?? ANOMALY_LIMIT_DEFAULT),
    },
    now,
  );
}

export function serializeNotificationOverviewQueryParams(state: NotificationOverviewQueryState) {
  const normalized = normalizeNotificationOverviewQueryState(state);
  const params = new URLSearchParams();
  if (normalized.state.tenantId) params.set("tenantId", normalized.state.tenantId);
  if (normalized.state.channel) params.set("channel", normalized.state.channel);
  params.set("from", normalized.fromIso);
  params.set("to", normalized.toIso);
  params.set("limit", String(normalized.state.limit));
  return {
    params,
    aggregationMode: "auto" as const,
    state: normalized.state,
    windowType: normalized.windowType,
    issues: normalized.issues,
  };
}

export function serializeNotificationTenantDrilldownQueryParams(state: NotificationTenantDrilldownQueryState) {
  const normalized = normalizeNotificationTenantDrilldownQueryState(state);
  const params = new URLSearchParams();
  if (normalized.state.channel) params.set("channel", normalized.state.channel);
  params.set("aggregationMode", normalized.state.aggregationMode);
  params.set("from", normalized.fromIso);
  params.set("to", normalized.toIso);
  params.set("limit", String(normalized.state.limit));
  params.set("anomalyLimit", String(normalized.state.anomalyLimit));
  return {
    params,
    state: normalized.state,
    windowType: normalized.windowType,
    issues: normalized.issues,
  };
}

export function buildNotificationOverviewPageHrefFromQueryState(
  tenantId: string,
  state: NotificationTenantDrilldownQueryState,
) {
  const { params } = serializeNotificationTenantDrilldownQueryParams(state);
  params.set("tenantId", tenantId);
  params.delete("anomalyLimit");
  return `/platform-admin/notifications-overview?${params.toString()}`;
}

export type ReadonlyURLSearchParamsLike = {
  get(name: string): string | null;
};
