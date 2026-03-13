"use client";

export type NotificationReadApiRequestCause = "query" | "refresh";

export type NotificationReadApiRequestPhase = "idle" | "initial_loading" | "reloading" | "refreshing";

export type NotificationReadApiRequestState<TData, TError extends Error> = {
  data: TData | null;
  loading: boolean;
  error: TError | null;
  requestKey: string | null;
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

export function createNotificationReadApiRequestState<TData, TError extends Error>(
  data: TData | null = null,
): NotificationReadApiRequestState<TData, TError> {
  return {
    data,
    loading: data === null,
    error: null,
    requestKey: null,
    phase: data === null ? "initial_loading" : "idle",
    isInitialLoading: data === null,
    isReloading: false,
    isRefreshing: false,
  };
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

  start(params: {
    requestKey: string;
    cause: NotificationReadApiRequestCause;
    loader: RequestLoader<TData>;
  }) {
    if (this.disposed) return;
    if (this.state.loading && this.state.requestKey === params.requestKey) return;
    if (!this.state.loading && this.state.requestKey === params.requestKey && params.cause === "query") return;

    this.sequence += 1;
    const sequence = this.sequence;
    this.releaseCurrent?.();

    const hasData = this.state.data !== null;
    const phase: NotificationReadApiRequestPhase = hasData
      ? params.cause === "refresh"
        ? "refreshing"
        : "reloading"
      : "initial_loading";

    this.commit({
      data: this.state.data,
      loading: true,
      error: null,
      requestKey: params.requestKey,
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
        this.commit({
          data,
          loading: false,
          error: null,
          requestKey: params.requestKey,
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
          this.commit({
            data: this.state.data,
            loading: false,
            error: null,
            requestKey: params.requestKey,
            phase: "idle",
            isInitialLoading: false,
            isReloading: false,
            isRefreshing: false,
          });
          return;
        }

        this.commit({
          data: this.state.data,
          loading: false,
          error: classified,
          requestKey: params.requestKey,
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
