import type {
  RemoteDocumentRecord,
  RemoteDocumentSaveResult,
  RemoteDocumentStore,
  RemoteStoreOperationResult,
} from "../../src/supabase";

export class MemorySupabaseDocumentStore implements RemoteDocumentStore {
  readonly kind = "supabase" as const;
  readonly table = "orchestrator_documents";
  private readonly records = new Map<string, RemoteDocumentRecord>();

  constructor(
    private readonly params: {
      status?: RemoteStoreOperationResult["status"];
      summary?: string;
      manualMigration?: boolean;
    } = {},
  ) {}

  async load(key: string) {
    return this.records.get(key) ?? null;
  }

  async list(prefix?: string) {
    return [...this.records.values()]
      .filter((record) => (prefix ? record.key.startsWith(prefix) : true))
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  async save(key: string, value: unknown, expectedVersion: number | null): Promise<RemoteDocumentSaveResult> {
    const existing = this.records.get(key) ?? null;
    if (existing) {
      if (expectedVersion === null || existing.version !== expectedVersion) {
        return {
          applied: false,
          version: existing.version,
          updatedAt: existing.updatedAt,
        };
      }
      const next: RemoteDocumentRecord = {
        key,
        value,
        version: existing.version + 1,
        updatedAt: new Date().toISOString(),
      };
      this.records.set(key, next);
      return {
        applied: true,
        version: next.version,
        updatedAt: next.updatedAt,
      };
    }

    if (expectedVersion !== null) {
      return {
        applied: false,
        version: expectedVersion,
        updatedAt: new Date().toISOString(),
      };
    }

    const created: RemoteDocumentRecord = {
      key,
      value,
      version: 0,
      updatedAt: new Date().toISOString(),
    };
    this.records.set(key, created);
    return {
      applied: true,
      version: created.version,
      updatedAt: created.updatedAt,
    };
  }

  async remove(key: string) {
    this.records.delete(key);
  }

  async initialize() {
    if (this.params.manualMigration) {
      return {
        status: "manual_required",
        summary: "Manual SQL application required.",
        details: ["apply orchestrator_supabase.sql"],
        migrationPath: "tools/orchestrator/src/migrations/orchestrator_supabase.sql",
      } satisfies RemoteStoreOperationResult;
    }
    return {
      status: "initialized",
      summary: "Memory Supabase store initialized.",
      details: [],
      migrationPath: null,
    } satisfies RemoteStoreOperationResult;
  }

  async migrate() {
    if (this.params.manualMigration) {
      return {
        status: "manual_required",
        summary: "Manual SQL application required.",
        details: ["apply orchestrator_supabase.sql"],
        migrationPath: "tools/orchestrator/src/migrations/orchestrator_supabase.sql",
      } satisfies RemoteStoreOperationResult;
    }
    return {
      status: "migrated",
      summary: "Memory Supabase store migrated.",
      details: [],
      migrationPath: null,
    } satisfies RemoteStoreOperationResult;
  }

  async status() {
    return {
      status: this.params.status ?? "ready",
      summary: this.params.summary ?? "Memory Supabase store ready.",
      details: [],
      migrationPath: this.params.manualMigration ? "tools/orchestrator/src/migrations/orchestrator_supabase.sql" : null,
    } satisfies RemoteStoreOperationResult;
  }
}
