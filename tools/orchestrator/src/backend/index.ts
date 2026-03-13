import { mkdir, readFile, writeFile } from "node:fs/promises";
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

export interface BackendProvider {
  readonly backendType: BackendType;
  loadQueue(): Promise<QueueRunCollection>;
  saveQueue(queue: QueueRunCollection): Promise<void>;
  loadWorkers(): Promise<QueueWorkerCollection>;
  saveWorkers(workers: QueueWorkerCollection): Promise<void>;
  inspect(now?: Date): Promise<BackendInspection>;
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

export class FileBackendProvider implements BackendProvider {
  readonly backendType = "file" as const;

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
    await mkdir(this.params.rootDir, { recursive: true });
    await writeFile(this.getWorkersPath(), `${JSON.stringify(workers, null, 2)}\n`, "utf8");
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
      const db = await this.ensureDatabase();
      db.run("INSERT OR REPLACE INTO documents(key, value) VALUES (?, ?)", [key, JSON.stringify(value)]);
      await this.persistDatabase(db);
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

  async inspect(now = new Date()) {
    const [queue, workers] = await Promise.all([this.loadQueue(), this.loadWorkers()]);
    return buildInspection({
      backendType: this.backendType,
      queue,
      workers,
      now,
    });
  }
}
