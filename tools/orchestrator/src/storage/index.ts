import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  inboundAuditCollectionJsonSchema,
  inboundAuditCollectionSchema,
  inboundAuditRecordJsonSchema,
  inboundAuditRecordSchema,
  orchestratorStateJsonSchema,
  orchestratorStateSchema,
  parseWithDualValidation,
  queueRunCollectionJsonSchema,
  queueRunCollectionSchema,
  type InboundAuditCollection,
  type InboundAuditRecord,
  type OrchestratorState,
  type QueueRunCollection,
} from "../schemas";
import type { RemoteDocumentStore } from "../supabase";

export interface StorageProvider {
  loadState(id: string): Promise<OrchestratorState | null>;
  saveState(state: OrchestratorState): Promise<void>;
  listStateIds(): Promise<string[]>;
  loadQueue(): Promise<QueueRunCollection>;
  saveQueue(queue: QueueRunCollection): Promise<void>;
  loadInboundAudit(id: string): Promise<InboundAuditRecord | null>;
  saveInboundAudit(record: InboundAuditRecord): Promise<void>;
  listInboundAuditIds(): Promise<string[]>;
  loadInboundAuditCollection(): Promise<InboundAuditCollection>;
}

export class FileStorage implements StorageProvider {
  constructor(private readonly rootDir: string) {}

  private getStatePath(id: string) {
    return path.join(this.rootDir, `${id}.json`);
  }

  private getQueuePath() {
    return path.join(this.rootDir, "queue.json");
  }

  private getInboundAuditPath(id: string) {
    return path.join(this.rootDir, "inbound", `${id}.json`);
  }

  private async atomicWrite(filePath: string, value: string) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, value, "utf8");
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await rename(tempPath, filePath);
        return;
      } catch (error) {
        lastError = error;
        if (
          error instanceof Error &&
          "code" in error &&
          (error.code === "EPERM" || error.code === "EACCES") &&
          attempt < 3
        ) {
          await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  async loadState(id: string): Promise<OrchestratorState | null> {
    try {
      const content = await readFile(this.getStatePath(id), "utf8");
      return parseWithDualValidation({
        schemaName: "OrchestratorState",
        zodSchema: orchestratorStateSchema,
        jsonSchema: orchestratorStateJsonSchema,
        data: JSON.parse(content),
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async saveState(state: OrchestratorState) {
    await this.atomicWrite(this.getStatePath(state.id), `${JSON.stringify(state, null, 2)}\n`);
  }

  async listStateIds() {
    try {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(this.rootDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "queue.json")
        .map((entry) => entry.name.slice(0, -5))
        .sort();
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async loadQueue(): Promise<QueueRunCollection> {
    try {
      const content = await readFile(this.getQueuePath(), "utf8");
      return parseWithDualValidation({
        schemaName: "QueueRunCollection",
        zodSchema: queueRunCollectionSchema,
        jsonSchema: queueRunCollectionJsonSchema,
        data: JSON.parse(content),
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return queueRunCollectionSchema.parse({
          updatedAt: new Date(0).toISOString(),
          items: [],
        });
      }
      throw error;
    }
  }

  async saveQueue(queue: QueueRunCollection) {
    await this.atomicWrite(this.getQueuePath(), `${JSON.stringify(queue, null, 2)}\n`);
  }

  async loadInboundAudit(id: string): Promise<InboundAuditRecord | null> {
    try {
      const content = await readFile(this.getInboundAuditPath(id), "utf8");
      return parseWithDualValidation({
        schemaName: "InboundAuditRecord",
        zodSchema: inboundAuditRecordSchema,
        jsonSchema: inboundAuditRecordJsonSchema,
        data: JSON.parse(content),
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async saveInboundAudit(record: InboundAuditRecord) {
    await this.atomicWrite(this.getInboundAuditPath(record.id), `${JSON.stringify(record, null, 2)}\n`);
  }

  async listInboundAuditIds() {
    try {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(path.join(this.rootDir, "inbound"), { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name.slice(0, -5))
        .sort();
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async loadInboundAuditCollection(): Promise<InboundAuditCollection> {
    const ids = await this.listInboundAuditIds();
    const items = await Promise.all(ids.map((id) => this.loadInboundAudit(id)));
    return inboundAuditCollectionSchema.parse({
      updatedAt: new Date().toISOString(),
      items: items.filter((item): item is InboundAuditRecord => Boolean(item)),
    });
  }
}

export class SupabaseStorage implements StorageProvider {
  constructor(private readonly store: RemoteDocumentStore) {}

  async loadState(id: string): Promise<OrchestratorState | null> {
    const record = await this.store.load(`state:${id}`);
    if (!record) {
      return null;
    }
    return parseWithDualValidation({
      schemaName: "OrchestratorState",
      zodSchema: orchestratorStateSchema,
      jsonSchema: orchestratorStateJsonSchema,
      data: record.value,
    });
  }

  async saveState(state: OrchestratorState) {
    const key = `state:${state.id}`;
    const current = await this.store.load(key);
    const saved = await this.store.save(key, state, current?.version ?? null);
    if (!saved.applied) {
      throw new Error(`SupabaseStorage save conflict for ${key}.`);
    }
  }

  async listStateIds() {
    const records = await this.store.list("state:");
    return records
      .map((record) => record.key)
      .filter((key) => key.startsWith("state:"))
      .map((key) => key.slice("state:".length))
      .sort();
  }

  async loadQueue(): Promise<QueueRunCollection> {
    const record = await this.store.load("queue");
    if (!record) {
      return queueRunCollectionSchema.parse({
        updatedAt: new Date(0).toISOString(),
        items: [],
      });
    }
    return parseWithDualValidation({
      schemaName: "QueueRunCollection",
      zodSchema: queueRunCollectionSchema,
      jsonSchema: queueRunCollectionJsonSchema,
      data: record.value,
    });
  }

  async saveQueue(queue: QueueRunCollection) {
    const current = await this.store.load("queue");
    const saved = await this.store.save("queue", queue, current?.version ?? null);
    if (!saved.applied) {
      throw new Error("SupabaseStorage save conflict for queue.");
    }
  }

  async loadInboundAudit(id: string): Promise<InboundAuditRecord | null> {
    const record = await this.store.load(`inbound:${id}`);
    if (!record) {
      return null;
    }
    return parseWithDualValidation({
      schemaName: "InboundAuditRecord",
      zodSchema: inboundAuditRecordSchema,
      jsonSchema: inboundAuditRecordJsonSchema,
      data: record.value,
    });
  }

  async saveInboundAudit(record: InboundAuditRecord) {
    const key = `inbound:${record.id}`;
    const current = await this.store.load(key);
    const saved = await this.store.save(key, record, current?.version ?? null);
    if (!saved.applied) {
      throw new Error(`SupabaseStorage save conflict for ${key}.`);
    }
  }

  async listInboundAuditIds() {
    const records = await this.store.list("inbound:");
    return records
      .map((record) => record.key)
      .filter((key) => key.startsWith("inbound:"))
      .map((key) => key.slice("inbound:".length))
      .sort();
  }

  async loadInboundAuditCollection(): Promise<InboundAuditCollection> {
    const records = await this.store.list("inbound:");
    return parseWithDualValidation({
      schemaName: "InboundAuditCollection",
      zodSchema: inboundAuditCollectionSchema,
      jsonSchema: inboundAuditCollectionJsonSchema,
      data: {
        updatedAt: new Date().toISOString(),
        items: records.map((record) => record.value),
      },
    });
  }
}
