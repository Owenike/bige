import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type WorkspaceSession = {
  id: string;
  taskId: string;
  iterationNumber: number;
  rootDir: string;
  sourceRepoPath: string;
  allowedFiles: string[];
  forbiddenFiles: string[];
};

export type WorkspaceDescriptor = WorkspaceSession & {
  metadataPath: string;
  updatedAt: string;
};

function normalizeRelative(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

async function pathExists(targetPath: string) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function loadWorkspaceMetadata(rootDir: string) {
  const metadataPath = path.join(rootDir, ".orchestrator", "workspace.json");
  const content = await readFile(metadataPath, "utf8");
  return JSON.parse(content) as WorkspaceSession;
}

async function collectFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.name === ".orchestrator") continue;
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(rootDir, absolutePath)));
    } else if (entry.isFile()) {
      files.push(normalizeRelative(path.relative(rootDir, absolutePath)));
    }
  }
  return files.sort();
}

async function collectWorkspaceMetadataFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectWorkspaceMetadataFiles(rootDir, absolutePath)));
      continue;
    }
    if (entry.isFile() && entry.name === "workspace.json" && absolutePath.includes(`${path.sep}.orchestrator${path.sep}`)) {
      files.push(absolutePath);
    }
  }
  return files.sort();
}

function createPatchForFile(relativePath: string, before: string | null, after: string | null) {
  return [
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    "@@",
    ...(before === null ? [] : before.split(/\r?\n/).map((line) => `-${line}`)),
    ...(after === null ? [] : after.split(/\r?\n/).map((line) => `+${line}`)),
  ].join("\n");
}

export class FileSystemWorkspaceManager {
  constructor(private readonly rootDir: string) {}

  private workspacePath(taskId: string, iterationNumber: number) {
    return path.join(this.rootDir, taskId, `iteration-${iterationNumber}`);
  }

  async createWorkspace(params: {
    taskId: string;
    iterationNumber: number;
    repoPath: string;
    allowedFiles: string[];
    forbiddenFiles: string[];
  }) {
    const rootDir = this.workspacePath(params.taskId, params.iterationNumber);
    await rm(rootDir, { recursive: true, force: true });
    await mkdir(rootDir, { recursive: true });
    await mkdir(path.join(rootDir, ".orchestrator"), { recursive: true });

    for (const allowed of params.allowedFiles) {
      const sourcePath = path.resolve(params.repoPath, allowed);
      if (!(await pathExists(sourcePath))) continue;
      const targetPath = path.resolve(rootDir, allowed);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await cp(sourcePath, targetPath, {
        recursive: true,
        force: true,
      });
    }

    const session: WorkspaceSession = {
      id: `${params.taskId}:${params.iterationNumber}`,
      taskId: params.taskId,
      iterationNumber: params.iterationNumber,
      rootDir,
      sourceRepoPath: params.repoPath,
      allowedFiles: params.allowedFiles.map(normalizeRelative),
      forbiddenFiles: params.forbiddenFiles.map(normalizeRelative),
    };
    await writeFile(
      path.join(rootDir, ".orchestrator", "workspace.json"),
      `${JSON.stringify(session, null, 2)}\n`,
      "utf8",
    );
    return session;
  }

  async cleanupWorkspace(taskId: string, iterationNumber?: number) {
    const target = iterationNumber === undefined ? path.join(this.rootDir, taskId) : this.workspacePath(taskId, iterationNumber);
    await rm(target, { recursive: true, force: true });
  }

  async cleanupAll() {
    await rm(this.rootDir, { recursive: true, force: true });
  }

  async loadWorkspace(rootDir: string) {
    return loadWorkspaceMetadata(rootDir);
  }

  async listWorkspaces(taskId?: string) {
    if (!(await pathExists(this.rootDir))) {
      return [] as WorkspaceDescriptor[];
    }
    const metadataFiles = await collectWorkspaceMetadataFiles(this.rootDir, taskId ? path.join(this.rootDir, taskId) : this.rootDir);
    const descriptors: WorkspaceDescriptor[] = [];
    for (const metadataPath of metadataFiles) {
      const session = await loadWorkspaceMetadata(path.dirname(path.dirname(metadataPath)));
      const details = await stat(metadataPath);
      descriptors.push({
        ...session,
        metadataPath,
        updatedAt: details.mtime.toISOString(),
      });
    }
    return descriptors;
  }

  async cleanupPath(targetPath: string) {
    await rm(targetPath, { recursive: true, force: true });
  }

  async collectDiffArtifacts(session: WorkspaceSession) {
    const files = await collectFiles(session.rootDir);
    const changedFiles: string[] = [];
    const patchChunks: string[] = [];

    for (const relativePath of files) {
      const workspaceFilePath = path.join(session.rootDir, relativePath);
      const sourceFilePath = path.join(session.sourceRepoPath, relativePath);
      const workspaceContent = await readFile(workspaceFilePath, "utf8");
      let sourceContent: string | null = null;
      if (await pathExists(sourceFilePath)) {
        sourceContent = await readFile(sourceFilePath, "utf8");
      }
      if (workspaceContent !== sourceContent) {
        changedFiles.push(relativePath);
        patchChunks.push(createPatchForFile(relativePath, sourceContent, workspaceContent));
      }
    }

    const diffPath = path.join(session.rootDir, ".orchestrator", "diff.patch");
    await writeFile(diffPath, `${patchChunks.join("\n\n")}\n`, "utf8");

    return {
      changedFiles,
      diffPath,
      diffText: patchChunks.join("\n\n"),
    };
  }

  async applyWorkspaceToRepo(session: WorkspaceSession, changedFiles: string[]) {
    for (const relativePath of changedFiles) {
      const sourcePath = path.join(session.rootDir, relativePath);
      const targetPath = path.join(session.sourceRepoPath, relativePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await cp(sourcePath, targetPath, { force: true });
    }
  }

  async applyWorkspaceRootToRepo(rootDir: string, changedFiles: string[]) {
    const session = await this.loadWorkspace(rootDir);
    await this.applyWorkspaceToRepo(session, changedFiles);
  }
}

export function isPathAllowed(session: WorkspaceSession, relativePath: string) {
  const normalized = normalizeRelative(relativePath);
  const hitsForbidden = session.forbiddenFiles.some(
    (forbidden) => normalized === forbidden || normalized.startsWith(`${forbidden}/`),
  );
  if (hitsForbidden) return false;
  return session.allowedFiles.some(
    (allowed) => normalized === allowed || normalized.startsWith(`${allowed}/`),
  );
}

export async function listWorkspaceFiles(session: WorkspaceSession, relativeDir = ".") {
  const target = path.resolve(session.rootDir, relativeDir);
  return collectFiles(session.rootDir, target);
}

export async function readWorkspaceFile(session: WorkspaceSession, relativePath: string) {
  if (!isPathAllowed(session, relativePath)) {
    throw new Error(`Workspace blocked forbidden path: ${relativePath}`);
  }
  return readFile(path.join(session.rootDir, relativePath), "utf8");
}

export async function writeWorkspaceFile(session: WorkspaceSession, relativePath: string, content: string) {
  if (!isPathAllowed(session, relativePath)) {
    throw new Error(`Workspace blocked forbidden path: ${relativePath}`);
  }
  const target = path.join(session.rootDir, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

export async function applyWorkspacePatch(params: {
  session: WorkspaceSession;
  relativePath: string;
  search: string;
  replace: string;
}) {
  const original = await readWorkspaceFile(params.session, params.relativePath);
  if (!original.includes(params.search)) {
    throw new Error(`Patch search text not found in ${params.relativePath}.`);
  }
  await writeWorkspaceFile(params.session, params.relativePath, original.replace(params.search, params.replace));
}

export async function searchWorkspaceFiles(session: WorkspaceSession, pattern: string) {
  const files = await collectFiles(session.rootDir);
  const results: Array<{ path: string; matches: number }> = [];
  for (const relativePath of files) {
    if (!isPathAllowed(session, relativePath)) continue;
    const content = await readFile(path.join(session.rootDir, relativePath), "utf8");
    const matches = content.split(pattern).length - 1;
    if (matches > 0) {
      results.push({ path: relativePath, matches });
    }
  }
  return results;
}
