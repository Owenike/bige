import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const DEFAULT_SUPABASE_DOCUMENTS_TABLE = "orchestrator_documents";

export type RemoteDocumentRecord = {
  key: string;
  value: unknown;
  version: number;
  updatedAt: string;
};

export type RemoteDocumentSaveResult = {
  applied: boolean;
  version: number;
  updatedAt: string;
};

export type RemoteStoreOperationResult = {
  status: "ready" | "initialized" | "migrated" | "manual_required" | "blocked";
  summary: string;
  details: string[];
  migrationPath: string | null;
};

export interface RemoteDocumentStore {
  readonly kind: "supabase";
  readonly table: string;
  load(key: string): Promise<RemoteDocumentRecord | null>;
  list(prefix?: string): Promise<RemoteDocumentRecord[]>;
  save(key: string, value: unknown, expectedVersion: number | null): Promise<RemoteDocumentSaveResult>;
  remove(key: string): Promise<void>;
  initialize(): Promise<RemoteStoreOperationResult>;
  migrate(): Promise<RemoteStoreOperationResult>;
  status(): Promise<RemoteStoreOperationResult>;
}

export interface SupabaseMigrationExecutor {
  apply(sql: string): Promise<{
    applied: boolean;
    summary: string;
    details?: string[];
  }>;
}

export type SupabaseDocumentStoreOptions = {
  url: string;
  serviceRoleKey: string;
  schema?: string;
  table?: string;
  client?: SupabaseClient;
  migrationExecutor?: SupabaseMigrationExecutor | null;
  migrationPath?: string;
};

type SupabaseDocumentRow = {
  key: string;
  value: unknown;
  version: number;
  updated_at: string;
};

function resolveMigrationPath(customPath?: string) {
  return customPath ?? path.join(__dirname, "..", "migrations", "orchestrator_supabase.sql");
}

export class SupabaseDocumentStore implements RemoteDocumentStore {
  readonly kind = "supabase" as const;
  readonly table: string;
  private readonly schema: string;
  private readonly client: SupabaseClient;
  private readonly migrationExecutor: SupabaseMigrationExecutor | null;
  private readonly migrationPath: string;

  constructor(options: SupabaseDocumentStoreOptions) {
    this.schema = options.schema ?? "public";
    this.table = options.table ?? DEFAULT_SUPABASE_DOCUMENTS_TABLE;
    this.client =
      options.client ??
      createClient(options.url, options.serviceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
    this.migrationExecutor = options.migrationExecutor ?? null;
    this.migrationPath = resolveMigrationPath(options.migrationPath);
  }

  private tableClient() {
    return this.client.schema(this.schema).from(this.table);
  }

  async load(key: string) {
    const { data, error } = await this.tableClient()
      .select("key,value,version,updated_at")
      .eq("key", key)
      .maybeSingle<SupabaseDocumentRow>();
    if (error) {
      throw new Error(`Supabase document load failed for ${key}: ${error.message}`);
    }
    if (!data) {
      return null;
    }
    return {
      key: data.key,
      value: data.value,
      version: data.version,
      updatedAt: data.updated_at,
    } satisfies RemoteDocumentRecord;
  }

  async list(prefix?: string) {
    let query = this.tableClient().select("key,value,version,updated_at").order("key", { ascending: true });
    if (prefix) {
      query = query.like("key", `${prefix}%`);
    }
    const { data, error } = await query.returns<SupabaseDocumentRow[]>();
    if (error) {
      throw new Error(`Supabase document list failed${prefix ? ` for ${prefix}` : ""}: ${error.message}`);
    }
    return (data ?? []).map(
      (row) =>
        ({
          key: row.key,
          value: row.value,
          version: row.version,
          updatedAt: row.updated_at,
        }) satisfies RemoteDocumentRecord,
    );
  }

  async save(key: string, value: unknown, expectedVersion: number | null) {
    const updatedAt = new Date().toISOString();
    if (expectedVersion === null) {
      const { data, error } = await this.tableClient()
        .insert({
          key,
          value,
          version: 0,
          updated_at: updatedAt,
        })
        .select("version,updated_at")
        .maybeSingle<{ version: number; updated_at: string }>();
      if (error) {
        if (error.code === "23505") {
          return {
            applied: false,
            version: 0,
            updatedAt,
          } satisfies RemoteDocumentSaveResult;
        }
        throw new Error(`Supabase document insert failed for ${key}: ${error.message}`);
      }
      return {
        applied: true,
        version: data?.version ?? 0,
        updatedAt: data?.updated_at ?? updatedAt,
      } satisfies RemoteDocumentSaveResult;
    }

    const nextVersion = expectedVersion + 1;
    const { data, error } = await this.tableClient()
      .update({
        value,
        version: nextVersion,
        updated_at: updatedAt,
      })
      .eq("key", key)
      .eq("version", expectedVersion)
      .select("version,updated_at")
      .maybeSingle<{ version: number; updated_at: string }>();
    if (error) {
      throw new Error(`Supabase document update failed for ${key}: ${error.message}`);
    }
    if (!data) {
      return {
        applied: false,
        version: expectedVersion,
        updatedAt,
      } satisfies RemoteDocumentSaveResult;
    }
    return {
      applied: true,
      version: data.version,
      updatedAt: data.updated_at,
    } satisfies RemoteDocumentSaveResult;
  }

  async remove(key: string) {
    const { error } = await this.tableClient().delete().eq("key", key);
    if (error) {
      throw new Error(`Supabase document delete failed for ${key}: ${error.message}`);
    }
  }

  private async runMigration(status: "initialized" | "migrated") {
    if (!this.migrationExecutor) {
      return {
        status: "manual_required",
        summary: "Supabase migration requires manual SQL application.",
        details: [`Apply ${this.migrationPath} to schema ${this.schema} before using the Supabase backend.`],
        migrationPath: this.migrationPath,
      } satisfies RemoteStoreOperationResult;
    }
    const sql = await readFile(this.migrationPath, "utf8");
    const applied = await this.migrationExecutor.apply(sql);
    return {
      status,
      summary: applied.summary,
      details: applied.details ?? [],
      migrationPath: this.migrationPath,
    } satisfies RemoteStoreOperationResult;
  }

  async initialize() {
    return this.runMigration("initialized");
  }

  async migrate() {
    return this.runMigration("migrated");
  }

  async status() {
    try {
      const { error } = await this.tableClient().select("key", { count: "exact", head: true });
      if (error) {
        return {
          status: "blocked",
          summary: `Supabase backend status check failed: ${error.message}`,
          details: [`schema=${this.schema}`, `table=${this.table}`],
          migrationPath: this.migrationPath,
        } satisfies RemoteStoreOperationResult;
      }
      return {
        status: "ready",
        summary: "Supabase backend is reachable.",
        details: [`schema=${this.schema}`, `table=${this.table}`],
        migrationPath: this.migrationPath,
      } satisfies RemoteStoreOperationResult;
    } catch (error) {
      return {
        status: "blocked",
        summary: error instanceof Error ? error.message : String(error),
        details: [`schema=${this.schema}`, `table=${this.table}`],
        migrationPath: this.migrationPath,
      } satisfies RemoteStoreOperationResult;
    }
  }
}

export function createSupabaseDocumentStoreFromEnv(options?: {
  schema?: string;
  table?: string;
  migrationExecutor?: SupabaseMigrationExecutor | null;
  migrationPath?: string;
}) {
  const url = process.env.ORCHESTRATOR_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const serviceRoleKey =
    process.env.ORCHESTRATOR_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
  if (!url || !serviceRoleKey) {
    return null;
  }
  return new SupabaseDocumentStore({
    url,
    serviceRoleKey,
    schema: options?.schema ?? process.env.ORCHESTRATOR_SUPABASE_SCHEMA ?? "public",
    table: options?.table ?? process.env.ORCHESTRATOR_SUPABASE_TABLE ?? DEFAULT_SUPABASE_DOCUMENTS_TABLE,
    migrationExecutor: options?.migrationExecutor ?? null,
    migrationPath: options?.migrationPath,
  });
}

export function createScopedRemoteDocumentStore(store: RemoteDocumentStore, prefix: string): RemoteDocumentStore {
  const normalizeKey = (key: string) => `${prefix}${key}`;
  return {
    kind: store.kind,
    table: store.table,
    async load(key) {
      return store.load(normalizeKey(key));
    },
    async list(listPrefix) {
      const records = await store.list(normalizeKey(listPrefix ?? ""));
      return records.map((record) => ({
        ...record,
        key: record.key.startsWith(prefix) ? record.key.slice(prefix.length) : record.key,
      }));
    },
    async save(key, value, expectedVersion) {
      return store.save(normalizeKey(key), value, expectedVersion);
    },
    async remove(key) {
      await store.remove(normalizeKey(key));
    },
    async initialize() {
      return store.initialize();
    },
    async migrate() {
      return store.migrate();
    },
    async status() {
      return store.status();
    },
  };
}
