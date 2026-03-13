import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  orchestratorStateJsonSchema,
  orchestratorStateSchema,
  parseWithDualValidation,
  queueRunCollectionJsonSchema,
  queueRunCollectionSchema,
  type OrchestratorState,
  type QueueRunCollection,
} from "../schemas";

export interface StorageProvider {
  loadState(id: string): Promise<OrchestratorState | null>;
  saveState(state: OrchestratorState): Promise<void>;
  loadQueue(): Promise<QueueRunCollection>;
  saveQueue(queue: QueueRunCollection): Promise<void>;
}

export class FileStorage implements StorageProvider {
  constructor(private readonly rootDir: string) {}

  private getStatePath(id: string) {
    return path.join(this.rootDir, `${id}.json`);
  }

  private getQueuePath() {
    return path.join(this.rootDir, `queue.json`);
  }

  private async atomicWrite(filePath: string, value: string) {
    await mkdir(this.rootDir, { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, value, "utf8");
    await rename(tempPath, filePath);
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
}

export class SupabaseStorage implements StorageProvider {
  async loadState(): Promise<OrchestratorState | null> {
    throw new Error("SupabaseStorage is reserved for a later iteration. FileStorage is the MVP storage provider.");
  }

  async saveState(): Promise<void> {
    throw new Error("SupabaseStorage is reserved for a later iteration. FileStorage is the MVP storage provider.");
  }

  async loadQueue(): Promise<QueueRunCollection> {
    throw new Error("SupabaseStorage is reserved for a later iteration. FileStorage is the MVP storage provider.");
  }

  async saveQueue(): Promise<void> {
    throw new Error("SupabaseStorage is reserved for a later iteration. FileStorage is the MVP storage provider.");
  }
}
