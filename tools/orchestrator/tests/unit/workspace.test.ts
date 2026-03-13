import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { FileSystemWorkspaceManager, writeWorkspaceFile } from "../../src/workspace";

async function createRepoFixture() {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-workspace-"));
  await mkdir(path.join(repoRoot, "allowed"), { recursive: true });
  await mkdir(path.join(repoRoot, "forbidden"), { recursive: true });
  await writeFile(path.join(repoRoot, "allowed", "sample.txt"), "source\n", "utf8");
  await writeFile(path.join(repoRoot, "forbidden", "secret.txt"), "secret\n", "utf8");
  return repoRoot;
}

test("workspace manager creates and cleans an isolated workspace without mutating the source repo", async () => {
  const repoRoot = await createRepoFixture();
  const workspaceRoot = path.join(repoRoot, ".tmp-workspaces");
  const manager = new FileSystemWorkspaceManager(workspaceRoot);

  const session = await manager.createWorkspace({
    taskId: "workspace-test",
    iterationNumber: 1,
    repoPath: repoRoot,
    allowedFiles: ["allowed"],
    forbiddenFiles: ["forbidden"],
  });

  await writeWorkspaceFile(session, "allowed/sample.txt", "workspace\n");
  assert.equal(await readFile(path.join(repoRoot, "allowed", "sample.txt"), "utf8"), "source\n");

  await manager.cleanupWorkspace("workspace-test");
  await assert.rejects(() => access(session.rootDir));
});
