"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createNotificationOverviewQueryStateDefaults,
  createNotificationTenantDrilldownQueryStateDefaults,
  hydrateNotificationOverviewQueryStateFromSearchParams,
  hydrateNotificationTenantDrilldownQueryStateFromSearchParams,
  normalizeNotificationOverviewQueryState,
  normalizeNotificationTenantDrilldownQueryState,
  serializeNotificationOverviewQueryParams,
  serializeNotificationTenantDrilldownQueryParams,
  type NotificationOverviewQueryState,
  type NotificationTenantDrilldownQueryState,
  type ReadonlyURLSearchParamsLike,
} from "./notification-read-api-query-state";

type UrlSyncOptions = {
  omitDefaults?: boolean;
  now?: Date | (() => Date);
};

function buildUrl(pathname: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function buildNotificationOverviewUrlSearchParams(
  state: NotificationOverviewQueryState,
  options: UrlSyncOptions = {},
) {
  const omitDefaults = options.omitDefaults !== false;
  const serialized = serializeNotificationOverviewQueryParams(state);
  if (!omitDefaults) return serialized.params;

  const defaults = createNotificationOverviewQueryStateDefaults(options.now);
  const defaultSerialized = serializeNotificationOverviewQueryParams(defaults);
  const params = new URLSearchParams();
  if (serialized.state.tenantId !== defaults.tenantId) params.set("tenantId", serialized.state.tenantId);
  if (serialized.state.channel !== defaults.channel) params.set("channel", serialized.state.channel);
  if (serialized.state.from !== defaults.from) params.set("from", serialized.params.get("from") || defaultSerialized.params.get("from") || "");
  if (serialized.state.to !== defaults.to) params.set("to", serialized.params.get("to") || defaultSerialized.params.get("to") || "");
  if (serialized.state.limit !== defaults.limit) params.set("limit", String(serialized.state.limit));
  return params;
}

function buildNotificationTenantDrilldownUrlSearchParams(
  state: NotificationTenantDrilldownQueryState,
  options: UrlSyncOptions = {},
) {
  const omitDefaults = options.omitDefaults !== false;
  const serialized = serializeNotificationTenantDrilldownQueryParams(state);
  if (!omitDefaults) return serialized.params;

  const defaults = createNotificationTenantDrilldownQueryStateDefaults(options.now);
  const defaultSerialized = serializeNotificationTenantDrilldownQueryParams(defaults);
  const params = new URLSearchParams();
  if (serialized.state.channel !== defaults.channel) params.set("channel", serialized.state.channel);
  if (serialized.state.aggregationMode !== defaults.aggregationMode) params.set("aggregationMode", serialized.state.aggregationMode);
  if (serialized.state.from !== defaults.from) params.set("from", serialized.params.get("from") || defaultSerialized.params.get("from") || "");
  if (serialized.state.to !== defaults.to) params.set("to", serialized.params.get("to") || defaultSerialized.params.get("to") || "");
  if (serialized.state.limit !== defaults.limit) params.set("limit", String(serialized.state.limit));
  if (serialized.state.anomalyLimit !== defaults.anomalyLimit) params.set("anomalyLimit", String(serialized.state.anomalyLimit));
  return params;
}

function statesEqualOverview(a: NotificationOverviewQueryState, b: NotificationOverviewQueryState) {
  return a.tenantId === b.tenantId && a.channel === b.channel && a.from === b.from && a.to === b.to && a.limit === b.limit;
}

function statesEqualTenantDrilldown(a: NotificationTenantDrilldownQueryState, b: NotificationTenantDrilldownQueryState) {
  return (
    a.channel === b.channel &&
    a.aggregationMode === b.aggregationMode &&
    a.from === b.from &&
    a.to === b.to &&
    a.limit === b.limit &&
    a.anomalyLimit === b.anomalyLimit
  );
}

export function buildNotificationOverviewPageUrl(
  pathname: string,
  state: NotificationOverviewQueryState,
  options: UrlSyncOptions = {},
) {
  return buildUrl(pathname, buildNotificationOverviewUrlSearchParams(state, options));
}

export function buildNotificationTenantDrilldownPageUrl(
  pathname: string,
  state: NotificationTenantDrilldownQueryState,
  options: UrlSyncOptions = {},
) {
  return buildUrl(pathname, buildNotificationTenantDrilldownUrlSearchParams(state, options));
}

export function buildNotificationTenantDrilldownHrefFromOverviewState(
  tenantId: string,
  overviewState: NotificationOverviewQueryState,
  options: UrlSyncOptions = {},
) {
  const path = `/platform-admin/notifications-overview/${encodeURIComponent(tenantId)}`;
  return buildNotificationTenantDrilldownPageUrl(path, buildNotificationTenantDrilldownStateFromOverviewState(overviewState, options), options);
}

export function buildNotificationTenantDrilldownStateFromOverviewState(
  overviewState: NotificationOverviewQueryState,
  options: UrlSyncOptions = {},
): NotificationTenantDrilldownQueryState {
  return {
    channel: overviewState.channel,
    aggregationMode: "auto",
    from: overviewState.from,
    to: overviewState.to,
    limit: overviewState.limit,
    anomalyLimit: createNotificationTenantDrilldownQueryStateDefaults(options.now).anomalyLimit,
  };
}

export function buildNotificationOverviewHrefFromTenantDrilldownState(
  tenantId: string,
  state: NotificationTenantDrilldownQueryState,
  options: UrlSyncOptions = {},
) {
  return buildNotificationOverviewPageUrl(
    "/platform-admin/notifications-overview",
    {
      tenantId,
      channel: state.channel,
      from: state.from,
      to: state.to,
      limit: state.limit,
    },
    options,
  );
}

function currentUrl(pathname: string, searchParams: ReadonlyURLSearchParamsLike) {
  const params = new URLSearchParams();
  const raw = searchParams as unknown as URLSearchParams;
  const asString = typeof raw.toString === "function" ? raw.toString() : "";
  return asString ? `${pathname}?${asString}` : pathname;
}

export function useNotificationOverviewUrlSync() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const referenceNow = useMemo(() => new Date(), []);

  const restored = useMemo(
    () => hydrateNotificationOverviewQueryStateFromSearchParams(searchParams, referenceNow),
    [referenceNow, searchParams],
  );
  const [filters, setFilters] = useState<NotificationOverviewQueryState>(restored.state);
  const [draft, setDraft] = useState<NotificationOverviewQueryState>(restored.state);
  const pageUrl = useMemo(() => currentUrl(pathname, searchParams), [pathname, searchParams]);

  useEffect(() => {
    const canonical = buildNotificationOverviewPageUrl(pathname, restored.state, {
      omitDefaults: true,
      now: referenceNow,
    });
    if (canonical !== pageUrl) {
      router.replace(canonical, { scroll: false });
      return;
    }

    setFilters((current) => (statesEqualOverview(current, restored.state) ? current : restored.state));
    setDraft((current) => (statesEqualOverview(current, restored.state) ? current : restored.state));
  }, [pageUrl, pathname, referenceNow, restored.state, router]);

  function applyDraft() {
    const normalized = normalizeNotificationOverviewQueryState(draft, referenceNow).state;
    const nextUrl = buildNotificationOverviewPageUrl(pathname, normalized, {
      omitDefaults: true,
      now: referenceNow,
    });
    setFilters(normalized);
    setDraft(normalized);
    if (nextUrl !== pageUrl) {
      router.push(nextUrl, { scroll: false });
    }
  }

  function resetFilters() {
    const defaults = createNotificationOverviewQueryStateDefaults(referenceNow);
    const nextUrl = buildNotificationOverviewPageUrl(pathname, defaults, { omitDefaults: true, now: referenceNow });
    setFilters(defaults);
    setDraft(defaults);
    if (nextUrl !== pageUrl) {
      router.push(nextUrl, { scroll: false });
    }
  }

  function buildTenantDrilldownHref(tenantId: string) {
    return buildNotificationTenantDrilldownHrefFromOverviewState(tenantId, filters, {
      omitDefaults: true,
      now: referenceNow,
    });
  }

  return {
    filters,
    draft,
    setDraft,
    applyDraft,
    resetFilters,
    buildTenantDrilldownHref,
  };
}

export function useNotificationTenantDrilldownUrlSync(tenantId: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const referenceNow = useMemo(() => new Date(), []);

  const restored = useMemo(
    () => hydrateNotificationTenantDrilldownQueryStateFromSearchParams(searchParams, referenceNow),
    [referenceNow, searchParams],
  );
  const [filters, setFilters] = useState<NotificationTenantDrilldownQueryState>(restored.state);
  const [draft, setDraft] = useState<NotificationTenantDrilldownQueryState>(restored.state);
  const pageUrl = useMemo(() => currentUrl(pathname, searchParams), [pathname, searchParams]);

  useEffect(() => {
    const canonical = buildNotificationTenantDrilldownPageUrl(pathname, restored.state, {
      omitDefaults: true,
      now: referenceNow,
    });
    if (canonical !== pageUrl) {
      router.replace(canonical, { scroll: false });
      return;
    }

    setFilters((current) => (statesEqualTenantDrilldown(current, restored.state) ? current : restored.state));
    setDraft((current) => (statesEqualTenantDrilldown(current, restored.state) ? current : restored.state));
  }, [pageUrl, pathname, referenceNow, restored.state, router]);

  function applyDraft() {
    const normalized = normalizeNotificationTenantDrilldownQueryState(draft, referenceNow).state;
    const nextUrl = buildNotificationTenantDrilldownPageUrl(pathname, normalized, {
      omitDefaults: true,
      now: referenceNow,
    });
    setFilters(normalized);
    setDraft(normalized);
    if (nextUrl !== pageUrl) {
      router.push(nextUrl, { scroll: false });
    }
  }

  function resetFilters() {
    const defaults = createNotificationTenantDrilldownQueryStateDefaults(referenceNow);
    const nextUrl = buildNotificationTenantDrilldownPageUrl(pathname, defaults, { omitDefaults: true, now: referenceNow });
    setFilters(defaults);
    setDraft(defaults);
    if (nextUrl !== pageUrl) {
      router.push(nextUrl, { scroll: false });
    }
  }

  const backHref = useMemo(
    () => buildNotificationOverviewHrefFromTenantDrilldownState(tenantId, filters, { omitDefaults: true, now: referenceNow }),
    [filters, referenceNow, tenantId],
  );

  return {
    filters,
    draft,
    setDraft,
    applyDraft,
    resetFilters,
    backHref,
  };
}
