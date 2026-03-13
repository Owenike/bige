import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import {
  parseWithDualValidation,
  queueRunCollectionJsonSchema,
  queueRunCollectionSchema,
  queueWorkerCollectionJsonSchema,
  queueWorkerCollectionSchema,
  type BackendType,
  type QueueRunCollection,
  type QueueWorkerCollection,
} from "../schemas";
import type { StorageProvider } from "../storage";
import type { RemoteDocumentStore, RemoteStoreOperationResult } from "../supabase";

export type BackendInspection = {
  backendType: BackendType;
  queueDepth: number;
  runningCount: number;
  queuedCount: number;
  pausedCount: number;
  blockedCount: number;
  staleLeaseCount: number;
  cancelRequestedCount: number;
  pauseRequestedCount: number;
  workerCount: number;
  activeWorkers: string[];
  updatedAt: string;
};

export type BackendStatusResult = RemoteStoreOperationResult & {
  backendType: BackendType;
  inspection: BackendInspection;
};

export interface BackendProvider {
  readonly backendType: BackendType;
  loadQueue(): Promise<QueueRunCollection>;
  saveQueue(queue: QueueRunCollection): Promise<void>;
  mutateQueue<TResult>(
    mutator: (queue: QueueRunCollection) => Promise<{ queue: QueueRunCollection; result: TResult }> | { queue: QueueRunCollection; result: TResult },
  ): Promise<TResult>;
  loadWorkers(): Promise<QueueWorkerCollection>;
  saveWorkers(workers: QueueWorkerCollection): Promise<void>;
  mutateWorkers<TResult>(
    mutator: (workers: QueueWorkerCollection) => Promise<{ workers: QueueWorkerCollection; result: TResult }> | { workers: QueueWorkerCollection; result: TResult },
  ): Promise<TResult>;
  inspect(now?: Date): Promise<BackendInspection>;
  initialize(): Promise<RemoteStoreOperationResult>;
  migrate(): Promise<RemoteStoreOperationResult>;
  status(now?: Date): Promise<BackendStatusResult>;
}

export class BackendConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendConflictError";
  }
}

function emptyQueue() {
  return queueRunCollectionSchema.parse({
    updatedAt: new Date(0).toISOString(),
    items: [],
  });
}

function emptyWorkers() {
  return queueWorkerCollectionSchema.parse({
    updatedAt: new Date(0).toISOString(),
    workers: [],
  });
}

function buildInspection(params: {
  backendType: BackendType;
  queue: QueueRunCollection;
  workers: QueueWorkerCollection;
  now: Date;
}): BackendInspection {
  const running = params.queue.items.filter((item) => item.status === "running");
  const queued = params.queue.items.filter((item) => item.status === "queued");
  const paused = params.queue.items.filter((item) => item.status === "paused");
  const blocked = params.queue.items.filter((item) => item.status === "blocked");
  const staleLeaseCount = running.filter(
    (item) => item.leaseExpiresAt && new Date(item.leaseExpiresAt).getTime() <= params.now.getTime(),
  ).length;
  return {
    backendType: params.backendType,
    queueDepth: params.queue.items.length,
    runningCount: running.length,
    queuedCount: queued.length,
    pausedCount: paused.length,
    blockedCount: blocked.length,
    staleLeaseCount,
    cancelRequestedCount: params.queue.items.filter((item) => item.cancellationStatus === "cancel_requested").length,
    pauseRequestedCount: params.queue.items.filter((item) => item.pauseStatus === "pause_requested").length,
    workerCount: params.workers.workers.length,
    activeWorkers: params.workers.workers
      .filter((worker) => ["polling", "running", "backing_off"].includes(worker.status))
      .map((worker) => worker.workerId),
    updatedAt: params.now.toISOString(),
  };
}

async function atomicWrite(filePath: string, value: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, value, "utf8");
  await rename(tempPath, filePath);
}

async function createStatusResult(
  backend: BackendProvider,
  params: {
    status: RemoteStoreOperationResult["status"];
    summary: string;
    details?: string[];
    migrationPath?: string | null;
    now?: Date;
  },
) {
  return {
    backendType: backend.backendType,
    inspection: await backend.inspect(params.now),
    status: params.status,
    summary: params.summary,
    details: params.details ?? [],
    migrationPath: params.migrationPath ?? null,
  } satisfies BackendStatusResult;
}

export class FileBackendProvider implements BackendProvider {
  readonly backendType = "file" as const;
  private mutationChain = Promise.resolve();

  constructor(
    private readonly params: {
      rootDir: string;
      storage: StorageProvider;
    },
  ) {}

  private getWorkersPath() {
    return path.join(this.params.rootDir, "workers.json");
  }

  async loadQueue() {
    return this.params.storage.loadQueue();
  }

  async saveQueue(queue: QueueRunCollection) {
    await this.params.storage.saveQueue(queue);
  }

  async mutateQueue<TResult>(
    mutator: (queue: QueueRunCollection) => Promise<{ queue: QueueRunCollection; result: TResult }> | { queue: QueueRunCollection; result: TResult },
  ) {
    const runMutation = async () => {
      const queue = await this.loadQueue();
      const { queue: nextQueue, result } = await mutator(queue);
      await this.saveQueue(nextQueue);
      return result;
    };
    const next = this.mutationChain.then(runMutation, runMutation);
    this.mutationChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async loadWorkers() {
    try {
      const content = await readFile(this.getWorkersPath(), "utf8");
      return parseWithDualValidation({
        schemaName: "QueueWorkerCollection",
        zodSchema: queueWorkerCollectionSchema,
        jsonSchema: queueWorkerCollectionJsonSchema,
        data: JSON.parse(content),
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return emptyWorkers();
      }
      throw error;
    }
  }

  async saveWorkers(workers: QueueWorkerCollection) {
    await atomicWrite(this.getWorkersPath(), `${JSON.stringify(workers, null, 2)}\n`);
  }

  async mutateWorkers<TResult>(
    mutator: (workers: QueueWorkerCollection) => Promise<{ workers: QueueWorkerCollection; result: TResult }> | { workers: QueueWorkerCollection; result: TResult },
  ) {
    const runMutation = async () => {
      const workers = await this.loadWorkers();
      const { workers: nextWorkers, result } = await mutator(workers);
      await this.saveWorkers(nextWorkers);
      return result;
    };
    const next = this.mutationChain.then(runMutation, runMutation);
    this.mutationChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async inspect(now = new Date()) {
    const [queue, workers] = await Promise.all([this.loadQueue(), this.loadWorkers()]);
    return buildInspection({
      backendType: this.backendType,
      queue,
      workers,
      now,
    });
  }

  async initialize() {
    return {
      status: "ready",
      summary: "File backend is ready without extra initialization.",
      details: [this.params.rootDir],
      migrationPath: null,
    } satisfies RemoteStoreOperationResult;
  }

  async migrate() {
    return {
      status: "ready",
      summary: "File backend does not require migrations.",
      details: [this.params.rootDir],
      migrationPath: null,
    } satisfies RemoteStoreOperationResult;
  }

  async status(now = new Date()) {
    return createStatusResult(this, {
      status: "ready",
      summary: "File backend is healthy.",
      details: [this.params.rootDir],
      now,
    });
  }
}

export class SqliteBackendProvider implements BackendProvider {
  readonly backendType = "sqlite" as const;
  private sqliteRuntime: Promise<SqlJsStatic> | null = null;
  private database: Promise<Database> | null = null;
  private mutationChain = Promise.resolve();

  constructor(
    private readonly params: {
      rootDir: string;
      filename?: string;
    },
  ) {}

  private get databasePath() {
    return path.join(this.params.rootDir, this.params.filename ?? "orchestrator-backend.sqlite");
  }

  private getSqlite() {
    if (!this.sqliteRuntime) {
      this.sqliteRuntime = initSqlJs();
    }
    return this.sqliteRuntime;
  }

  private async ensureDatabase() {
    if (!this.database) {
      this.database = (async () => {
        const SQL = await this.getSqlite();
        await mkdir(this.params.rootDir, { recursive: true });
        let db: Database;
        try {
          const existing = await readFile(this.databasePath);
          db = new SQL.Database(existing);
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
            throw error;
          }
          db = new SQL.Database();
        }
        db.run("CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
        return db;
      })();
    }
    return this.database;
  }

  private async persistDatabase(db: Database) {
    const bytes = db.export();
    await mkdir(this.params.rootDir, { recursive: true });
    await writeFile(this.databasePath, Buffer.from(bytes));
  }

  private async writeDocumentImmediate(key: string, value: unknown) {
    const db = await this.ensureDatabase();
    db.run("INSERT OR REPLACE INTO documents(key, value) VALUES (?, ?)", [key, JSON.stringify(value)]);
    await this.persistDatabase(db);
  }

  private async readDocument<T>(params: {
    key: string;
    fallback: T;
    schemaName: string;
    zodSchema: Parameters<typeof parseWithDualValidation<T>>[0]["zodSchema"];
    jsonSchema: Parameters<typeof parseWithDualValidation<T>>[0]["jsonSchema"];
  }) {
    const db = await this.ensureDatabase();
    const query = db.prepare("SELECT value FROM documents WHERE key = ?");
    query.bind([params.key]);
    try {
      if (!query.step()) {
        return params.fallback;
      }
      const row = query.getAsObject() as { value?: string };
      if (!row.value) {
        return params.fallback;
      }
      return parseWithDualValidation({
        schemaName: params.schemaName,
        zodSchema: params.zodSchema,
        jsonSchema: params.jsonSchema,
        data: JSON.parse(row.value),
      });
    } finally {
      query.free();
    }
  }

  private async writeDocument(key: string, value: unknown) {
    const runMutation = async () => {
      await this.writeDocumentImmediate(key, value);
    };
    const next = this.mutationChain.then(runMutation, runMutation);
    this.mutationChain = next.then(
      () => undefined,
      () => undefined,
    );
    await next;
  }

  async loadQueue() {
    return this.readDocument({
      key: "queue",
      fallback: emptyQueue(),
      schemaName: "QueueRunCollection",
      zodSchema: queueRunCollectionSchema,
      jsonSchema: queueRunCollectionJsonSchema,
    });
  }

  async saveQueue(queue: QueueRunCollection) {
    await this.writeDocument("queue", queue);
  }

  async mutateQueue<TResult>(
    mutator: (queue: QueueRunCollection) => Promise<{ queue: QueueRunCollection; result: TResult }> | { queue: QueueRunCollection; result: TResult },
  ) {
    const runMutation = async () => {
      const queue = await this.loadQueue();
      const { queue: nextQueue, result } = await mutator(queue);
      await this.writeDocumentImmediate("queue", nextQueue);
      return result;
    };
    const next = this.mutationChain.then(runMutation, runMutation);
    this.mutationChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async loadWorkers() {
    return this.readDocument({
      key: "workers",
      fallback: emptyWorkers(),
      schemaName: "QueueWorkerCollection",
      zodSchema: queueWorkerCollectionSchema,
      jsonSchema: queueWorkerCollectionJsonSchema,
    });
  }

  async saveWorkers(workers: QueueWorkerCollection) {
    await this.writeDocument("workers", workers);
  }

  async mutateWorkers<TResult>(
    mutator: (workers: QueueWorkerCollection) => Promise<{ workers: QueueWorkerCollection; result: TResult }> | { workers: QueueWorkerCollection; result: TResult },
  ) {
    const runMutation = async () => {
      const workers = await this.loadWorkers();
      const { workers: nextWorkers, result } = await mutator(workers);
      await this.writeDocumentImmediate("workers", nextWorkers);
      return result;
    };
    const next = this.mutationChain.then(runMutation, runMutation);
    this.mutationChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async inspect(now = new Date()) {
    const [queue, workers] = await Promise.all([this.loadQueue(), this.loadWorkers()]);
    return buildInspection({
      backendType: this.backendType,
      queue,
      workers,
      now,
    });
  }

  async initialize() {
    await this.ensureDatabase();
    return {
      status: "initialized",
      summary: "SQLite backend is initialized.",
      details: [this.databasePath],
      migrationPath: null,
    } satisfies RemoteStoreOperationResult;
  }

  async migrate() {
    await this.ensureDatabase();
    return {
      status: "migrated",
      summary: "SQLite backend schema is ready.",
      details: [this.databasePath],
      migrationPath: null,
    } satisfies RemoteStoreOperationResult;
  }

  async status(now = new Date()) {
    return createStatusResult(this, {
      status: "ready",
      summary: "SQLite backend is healthy.",
      details: [this.databasePath],
      now,
    });
  }
}

export class SupabaseBackendProvider implements BackendProvider {
  readonly backendType = "supabase" as const;

  constructor(
    private readonly params: {
      store: RemoteDocumentStore;
      conflictRetries?: number;
    },
  ) {}

  private async loadDocument<T>(params: {
    key: string;
    fallback: T;
    schemaName: string;
    zodSchema: Parameters<typeof parseWithDualValidation<T>>[0]["zodSchema"];
    jsonSchema: Parameters<typeof parseWithDualValidation<T>>[0]["jsonSchema"];
  }) {
    const record = await this.params.store.load(params.key);
    if (!record) {
      return {
        value: params.fallback,
        version: null as number | null,
      };
    }
    return {
      value: parseWithDualValidation({
        schemaName: params.schemaName,
        zodSchema: params.zodSchema,
        jsonSchema: params.jsonSchema,
        data: record.value,
      }),
      version: record.version,
    };
  }

  private async mutateDocument<TDocument, TResult>(params: {
    key: string;
    fallback: TDocument;
    schemaName: string;
    zodSchema: Parameters<typeof parseWithDualValidation<TDocument>>[0]["zodSchema"];
    jsonSchema: Parameters<typeof parseWithDualValidation<TDocument>>[0]["jsonSchema"];
    mutator: (document: TDocument) => Promise<{ document: TDocument; result: TResult }> | { document: TDocument; result: TResult };
  }) {
    const retries = this.params.conflictRetries ?? 5;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const current = await this.loadDocument({
        key: params.key,
        fallback: params.fallback,
        schemaName: params.schemaName,
        zodSchema: params.zodSchema,
        jsonSchema: params.jsonSchema,
      });
      const { document, result } = await params.mutator(current.value);
      const sameDocument = JSON.stringify(document) === JSON.stringify(current.value);
      if (sameDocument) {
        return result;
      }
      const saved = await this.params.store.save(params.key, document, current.version);
      if (saved.applied) {
        return result;
      }
    }
    throw new BackendConflictError(`Supabase backend update for ${params.key} exceeded retry budget.`);
  }

  async loadQueue() {
    return (
      await this.loadDocument({
        key: "queue",
        fallback: emptyQueue(),
        schemaName: "QueueRunCollection",
        zodSchema: queueRunCollectionSchema,
        jsonSchema: queueRunCollectionJsonSchema,
      })
    ).value;
  }

  async saveQueue(queue: QueueRunCollection) {
    await this.mutateDocument({
      key: "queue",
      fallback: emptyQueue(),
      schemaName: "QueueRunCollection",
      zodSchema: queueRunCollectionSchema,
      jsonSchema: queueRunCollectionJsonSchema,
      mutator: () => ({
        document: queue,
        result: undefined,
      }),
    });
  }

  async mutateQueue<TResult>(
    mutator: (queue: QueueRunCollection) => Promise<{ queue: QueueRunCollection; result: TResult }> | { queue: QueueRunCollection; result: TResult },
  ) {
    return this.mutateDocument({
      key: "queue",
      fallback: emptyQueue(),
      schemaName: "QueueRunCollection",
      zodSchema: queueRunCollectionSchema,
      jsonSchema: queueRunCollectionJsonSchema,
      mutator: async (queue) => {
        const next = await mutator(queue);
        return {
          document: next.queue,
          result: next.result,
        };
      },
    });
  }

  async loadWorkers() {
    return (
      await this.loadDocument({
        key: "workers",
        fallback: emptyWorkers(),
        schemaName: "QueueWorkerCollection",
        zodSchema: queueWorkerCollectionSchema,
        jsonSchema: queueWorkerCollectionJsonSchema,
      })
    ).value;
  }

  async saveWorkers(workers: QueueWorkerCollection) {
    await this.mutateDocument({
      key: "workers",
      fallback: emptyWorkers(),
      schemaName: "QueueWorkerCollection",
      zodSchema: queueWorkerCollectionSchema,
      jsonSchema: queueWorkerCollectionJsonSchema,
      mutator: () => ({
        document: workers,
        result: undefined,
      }),
    });
  }

  async mutateWorkers<TResult>(
    mutator: (workers: QueueWorkerCollection) => Promise<{ workers: QueueWorkerCollection; result: TResult }> | { workers: QueueWorkerCollection; result: TResult },
  ) {
    return this.mutateDocument({
      key: "workers",
      fallback: emptyWorkers(),
      schemaName: "QueueWorkerCollection",
      zodSchema: queueWorkerCollectionSchema,
      jsonSchema: queueWorkerCollectionJsonSchema,
      mutator: async (workers) => {
        const next = await mutator(workers);
        return {
          document: next.workers,
          result: next.result,
        };
      },
    });
  }

  async inspect(now = new Date()) {
    const [queue, workers] = await Promise.all([this.loadQueue(), this.loadWorkers()]);
    return buildInspection({
      backendType: this.backendType,
      queue,
      workers,
      now,
    });
  }

  async initialize() {
    return this.params.store.initialize();
  }

  async migrate() {
    return this.params.store.migrate();
  }

  async status(now = new Date()) {
    const base = await this.params.store.status();
    return createStatusResult(this, {
      ...base,
      now,
    });
  }
}
