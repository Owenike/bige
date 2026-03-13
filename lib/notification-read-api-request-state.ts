"use client";

export type NotificationReadApiRequestCause = "query" | "refresh" | "visibility";

export type NotificationReadApiRequestPhase = "idle" | "initial_loading" | "reloading" | "refreshing";

export type NotificationReadApiCacheStatus = "miss" | "hit" | "stale";
export type NotificationReadApiPrefetchStatus = "hit" | "fetched" | "failed" | "cancelled";
export type NotificationReadApiErrorMode = "none" | "soft" | "hard";

export type NotificationReadApiRequestState<TData, TError extends Error> = {
  data: TData | null;
  loading: boolean;
  error: TError | null;
  errorMode: NotificationReadApiErrorMode;
  requestKey: string | null;
  cacheKey: string | null;
  cacheStatus: NotificationReadApiCacheStatus;
  phase: NotificationReadApiRequestPhase;
  isInitialLoading: boolean;
  isReloading: boolean;
  isRefreshing: boolean;
};

type SharedRequestEntry<TData> = {
  controller: AbortController;
  promise: Promise<TData>;
  subscribers: number;
  settled: boolean;
};

type RequestLoader<TData> = (signal: AbortSignal) => Promise<TData>;

const sharedRequestEntries = new Map<string, SharedRequestEntry<unknown>>();
const sharedResultCache = new Map<string, { data: unknown; cachedAt: number; lastAccessedAt: number }>();

export const NOTIFICATION_READ_API_RESULT_CACHE_TTL_MS = 30_000;
export const NOTIFICATION_READ_API_RESULT_CACHE_EXPIRED_MS = 5 * 60_000;
export const NOTIFICATION_READ_API_RESULT_CACHE_MAX_ENTRIES = 50;

type NotificationReadApiCacheLookupStatus = "miss" | "hit" | "stale" | "expired";

export type NotificationReadApiCacheDebugEntry = {
  cacheKey: string;
  cachedAt: number;
  lastAccessedAt: number;
  ageMs: number;
  status: NotificationReadApiCacheLookupStatus;
};

export type NotificationReadApiPrefetchResult<TData> = {
  status: NotificationReadApiPrefetchStatus;
  cacheStatus: NotificationReadApiCacheStatus;
  data: TData | null;
};

function acquireSharedRequest<TData>(requestKey: string, loader: RequestLoader<TData>) {
  let entry = sharedRequestEntries.get(requestKey) as SharedRequestEntry<TData> | undefined;

  if (!entry) {
    const controller = new AbortController();
    entry = {
      controller,
      subscribers: 0,
      settled: false,
      promise: Promise.resolve()
        .then(() => loader(controller.signal))
        .finally(() => {
          entry!.settled = true;
          if (sharedRequestEntries.get(requestKey) === entry) {
            sharedRequestEntries.delete(requestKey);
          }
        }),
    };
    sharedRequestEntries.set(requestKey, entry);
  }

  entry.subscribers += 1;
  let released = false;

  return {
    promise: entry.promise,
    release() {
      if (released) return;
      released = true;
      entry!.subscribers = Math.max(0, entry!.subscribers - 1);
      if (entry!.subscribers === 0) {
        if (!entry!.settled) {
          entry!.controller.abort();
        }
        if (sharedRequestEntries.get(requestKey) === entry) {
          sharedRequestEntries.delete(requestKey);
        }
      }
    },
  };
}

function isAbortLikeNotificationReadApiRequestError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  return (
    candidate.name === "AbortError" ||
    candidate.code === "ABORT_ERR" ||
    candidate.message === "The operation was aborted." ||
    candidate.message === "This operation was aborted"
  );
}

export function createNotificationReadApiRequestState<TData, TError extends Error>(
  data: TData | null = null,
): NotificationReadApiRequestState<TData, TError> {
  return {
    data,
    loading: data === null,
    error: null,
    errorMode: "none",
    requestKey: null,
    cacheKey: null,
    cacheStatus: "miss",
    phase: data === null ? "initial_loading" : "idle",
    isInitialLoading: data === null,
    isReloading: false,
    isRefreshing: false,
  };
}

export function clearNotificationReadApiResultCache() {
  sharedResultCache.clear();
}

export function invalidateNotificationReadApiResultCache(cacheKey?: string) {
  if (typeof cacheKey === "string") {
    sharedResultCache.delete(cacheKey);
    return;
  }
  clearNotificationReadApiResultCache();
}

function resolveNow(now?: () => number) {
  return typeof now === "function" ? now() : Date.now();
}

function getNotificationReadApiCacheStatus(params: {
  cacheKey: string;
  now?: () => number;
  cacheTtlMs?: number;
  cacheExpireMs?: number;
}): NotificationReadApiCacheLookupStatus {
  const entry = sharedResultCache.get(params.cacheKey);
  if (!entry) return "miss";

  const nowMs = resolveNow(params.now);
  const ttl = typeof params.cacheTtlMs === "number" ? params.cacheTtlMs : NOTIFICATION_READ_API_RESULT_CACHE_TTL_MS;
  const expireMs =
    typeof params.cacheExpireMs === "number" ? params.cacheExpireMs : NOTIFICATION_READ_API_RESULT_CACHE_EXPIRED_MS;
  const ageMs = Math.max(0, nowMs - entry.cachedAt);

  if (ageMs > expireMs) return "expired";
  if (ageMs > ttl) return "stale";
  return "hit";
}

export function inspectNotificationReadApiResultCache(params: {
  now?: () => number;
  cacheTtlMs?: number;
  cacheExpireMs?: number;
} = {}) {
  const nowMs = resolveNow(params.now);
  return Array.from(sharedResultCache.entries())
    .map(([cacheKey, entry]) => ({
      cacheKey,
      cachedAt: entry.cachedAt,
      lastAccessedAt: entry.lastAccessedAt,
      ageMs: Math.max(0, nowMs - entry.cachedAt),
      status: getNotificationReadApiCacheStatus({
        cacheKey,
        now: params.now,
        cacheTtlMs: params.cacheTtlMs,
        cacheExpireMs: params.cacheExpireMs,
      }),
    }))
    .sort((left, right) => left.lastAccessedAt - right.lastAccessedAt);
}

export function pruneNotificationReadApiResultCache(params: {
  now?: () => number;
  cacheExpireMs?: number;
  maxEntries?: number;
} = {}) {
  const expiredKeys = inspectNotificationReadApiResultCache({
    now: params.now,
    cacheExpireMs: params.cacheExpireMs,
  })
    .filter((entry) => entry.status === "expired")
    .map((entry) => entry.cacheKey);

  for (const cacheKey of expiredKeys) {
    sharedResultCache.delete(cacheKey);
  }

  const maxEntries =
    typeof params.maxEntries === "number" ? params.maxEntries : NOTIFICATION_READ_API_RESULT_CACHE_MAX_ENTRIES;
  const survivors = inspectNotificationReadApiResultCache({
    now: params.now,
    cacheExpireMs: params.cacheExpireMs,
  });

  if (survivors.length <= maxEntries) return;

  for (const entry of survivors.slice(0, survivors.length - maxEntries)) {
    sharedResultCache.delete(entry.cacheKey);
  }
}

export function shouldRevalidateNotificationReadApiOnVisible(params: {
  cacheKey: string | null;
  loading: boolean;
  now?: () => number;
  cacheTtlMs?: number;
  cacheExpireMs?: number;
}) {
  if (params.loading || !params.cacheKey) return false;
  const status = getNotificationReadApiCacheStatus({
    cacheKey: params.cacheKey,
    now: params.now,
    cacheTtlMs: params.cacheTtlMs,
    cacheExpireMs: params.cacheExpireMs,
  });
  return status === "stale" || status === "expired";
}

export async function prefetchNotificationReadApiResult<TData>(params: {
  requestKey: string;
  cacheKey?: string;
  loader: RequestLoader<TData>;
  cacheTtlMs?: number;
  cacheExpireMs?: number;
  now?: () => number;
}): Promise<NotificationReadApiPrefetchResult<TData>> {
  const cacheKey = params.cacheKey ?? params.requestKey;
  const cached = getNotificationReadApiCachedResult<TData>({
    cacheKey,
    now: params.now,
    cacheTtlMs: params.cacheTtlMs,
    cacheExpireMs: params.cacheExpireMs,
  });

  if (cached.status === "hit") {
    return {
      status: "hit",
      cacheStatus: "hit",
      data: cached.data,
    };
  }

  const subscription = acquireSharedRequest(params.requestKey, params.loader);
  try {
    const data = await subscription.promise;
    writeNotificationReadApiCachedResult(cacheKey, data, params.now);
    return {
      status: "fetched",
      cacheStatus: "hit",
      data,
    };
  } catch (error) {
    return {
      status: isAbortLikeNotificationReadApiRequestError(error) ? "cancelled" : "failed",
      cacheStatus: cached.data !== null ? cached.status : "miss",
      data: cached.data,
    };
  } finally {
    subscription.release();
  }
}

function getNotificationReadApiCachedResult<TData>(params: {
  cacheKey: string;
  now?: () => number;
  cacheTtlMs?: number;
  cacheExpireMs?: number;
}) {
  pruneNotificationReadApiResultCache({
    now: params.now,
    cacheExpireMs: params.cacheExpireMs,
  });

  const entry = sharedResultCache.get(params.cacheKey);
  if (!entry) {
    return {
      status: "miss" as const,
      data: null,
    };
  }

  const status = getNotificationReadApiCacheStatus({
    cacheKey: params.cacheKey,
    now: params.now,
    cacheTtlMs: params.cacheTtlMs,
    cacheExpireMs: params.cacheExpireMs,
  });

  if (status === "expired") {
    sharedResultCache.delete(params.cacheKey);
    return {
      status: "miss" as const,
      data: null,
    };
  }

  entry.lastAccessedAt = resolveNow(params.now);
  return {
    status,
    data: entry.data as TData,
  };
}

function writeNotificationReadApiCachedResult<TData>(cacheKey: string, data: TData, now?: () => number) {
  const nowMs = resolveNow(now);
  sharedResultCache.set(cacheKey, {
    data,
    cachedAt: nowMs,
    lastAccessedAt: nowMs,
  });
  pruneNotificationReadApiResultCache({ now });
}

export class NotificationReadApiRequestLifecycleController<TData, TError extends Error> {
  private state: NotificationReadApiRequestState<TData, TError>;
  private disposed = false;
  private sequence = 0;
  private releaseCurrent: (() => void) | null = null;
  private onStateChange: (state: NotificationReadApiRequestState<TData, TError>) => void;
  private classifyError: (error: unknown) => TError;
  private isCancelledError: (error: TError) => boolean;

  constructor(options: {
    onStateChange: (state: NotificationReadApiRequestState<TData, TError>) => void;
    classifyError: (error: unknown) => TError;
    isCancelledError: (error: TError) => boolean;
    initialData?: TData | null;
  }) {
    this.onStateChange = options.onStateChange;
    this.classifyError = options.classifyError;
    this.isCancelledError = options.isCancelledError;
    this.state = createNotificationReadApiRequestState<TData, TError>(options.initialData ?? null);
  }

  getState() {
    return this.state;
  }

  private resolveRetainedData(cacheKey: string, cachedData: TData | null) {
    if (cachedData !== null) return cachedData;
    if (this.state.cacheKey === cacheKey && this.state.data !== null) return this.state.data;
    return null;
  }

  start(params: {
    requestKey: string;
    cacheKey?: string;
    cause: NotificationReadApiRequestCause;
    loader: RequestLoader<TData>;
    cacheTtlMs?: number;
    cacheExpireMs?: number;
    now?: () => number;
  }) {
    if (this.disposed) return;
    if (this.state.loading && this.state.requestKey === params.requestKey) return;
    if (!this.state.loading && this.state.requestKey === params.requestKey && params.cause === "query") return;

    const cacheKey = params.cacheKey ?? params.requestKey;
    const cached =
      params.cause === "refresh"
        ? { status: "miss" as const, data: null }
        : getNotificationReadApiCachedResult<TData>({
            cacheKey,
            now: params.now,
            cacheTtlMs: params.cacheTtlMs,
            cacheExpireMs: params.cacheExpireMs,
          });

    if (params.cause === "query" && cached.status === "hit") {
      this.sequence += 1;
      this.releaseCurrent?.();
      this.releaseCurrent = null;
      this.commit({
        data: cached.data,
        loading: false,
        error: null,
        errorMode: "none",
        requestKey: params.requestKey,
        cacheKey,
        cacheStatus: "hit",
        phase: "idle",
        isInitialLoading: false,
        isReloading: false,
        isRefreshing: false,
      });
      return;
    }

    this.sequence += 1;
    const sequence = this.sequence;
    this.releaseCurrent?.();

    const nextData = this.resolveRetainedData(cacheKey, cached.data);
    const hasData = nextData !== null;
    const phase: NotificationReadApiRequestPhase = hasData
      ? params.cause === "query"
        ? "reloading"
        : "refreshing"
      : "initial_loading";

    this.commit({
      data: nextData,
      loading: true,
      error: null,
      errorMode: "none",
      requestKey: params.requestKey,
      cacheKey,
      cacheStatus: cached.status,
      phase,
      isInitialLoading: phase === "initial_loading",
      isReloading: phase === "reloading",
      isRefreshing: phase === "refreshing",
    });

    const subscription = acquireSharedRequest(params.requestKey, params.loader);
    this.releaseCurrent = subscription.release;

    subscription.promise
      .then((data) => {
        if (!this.isCurrent(sequence, subscription.release)) return;
        this.releaseCurrent = null;
        writeNotificationReadApiCachedResult(cacheKey, data, params.now);
        this.commit({
          data,
          loading: false,
          error: null,
          errorMode: "none",
          requestKey: params.requestKey,
          cacheKey,
          cacheStatus: "hit",
          phase: "idle",
          isInitialLoading: false,
          isReloading: false,
          isRefreshing: false,
        });
      })
      .catch((error) => {
        const classified = this.classifyError(error);
        if (!this.isCurrent(sequence, subscription.release)) return;
        this.releaseCurrent = null;

        if (this.isCancelledError(classified)) {
          const cancelledData = this.resolveRetainedData(cacheKey, cached.data);
          this.commit({
            data: cancelledData,
            loading: false,
            error: null,
            errorMode: "none",
            requestKey: params.requestKey,
            cacheKey,
            cacheStatus: cached.data !== null ? cached.status : "miss",
            phase: "idle",
            isInitialLoading: false,
            isReloading: false,
            isRefreshing: false,
          });
          return;
        }

        const failedData = this.resolveRetainedData(cacheKey, cached.data);
        this.commit({
          data: failedData,
          loading: false,
          error: classified,
          errorMode: failedData !== null ? "soft" : "hard",
          requestKey: params.requestKey,
          cacheKey,
          cacheStatus: cached.data !== null ? cached.status : "miss",
          phase: "idle",
          isInitialLoading: false,
          isReloading: false,
          isRefreshing: false,
        });
      });
  }

  dispose() {
    this.disposed = true;
    this.sequence += 1;
    this.releaseCurrent?.();
    this.releaseCurrent = null;
  }

  private isCurrent(sequence: number, release: () => void) {
    return !this.disposed && this.sequence === sequence && this.releaseCurrent === release;
  }

  private commit(next: NotificationReadApiRequestState<TData, TError>) {
    this.state = next;
    this.onStateChange(next);
  }
}
