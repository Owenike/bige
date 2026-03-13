import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { FileSystemWorkspaceManager, writeWorkspaceFile } from "../../src/workspace";

async function createRepoFixture() {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-patch-"));
  await mkdir(path.join(repoRoot, "allowed"), { recursive: true });
  await writeFile(path.join(repoRoot, "allowed", "sample.txt"), "before\n", "utf8");
  return repoRoot;
}

test("patch flow produces diff artifacts when a workspace file changes", async () => {
  const repoRoot = await createRepoFixture();
  const manager = new FileSystemWorkspaceManager(path.join(repoRoot, ".workspaces"));
  const session = await manager.createWorkspace({
    taskId: "patch-test",
    iterationNumber: 1,
    repoPath: repoRoot,
    allowedFiles: ["allowed"],
    forbiddenFiles: [],
  });

  await writeWorkspaceFile(session, "allowed/sample.txt", "after\n");
  const diff = await manager.collectDiffArtifacts(session);

  assert.deepEqual(diff.changedFiles, ["allowed/sample.txt"]);
  assert.equal(diff.diffText.includes("--- a/allowed/sample.txt"), true);
  assert.equal(diff.diffText.includes("+++ b/allowed/sample.txt"), true);
});

test("patch flow reports no-op when the isolated workspace stays unchanged", async () => {
  const repoRoot = await createRepoFixture();
  const manager = new FileSystemWorkspaceManager(path.join(repoRoot, ".workspaces"));
  const session = await manager.createWorkspace({
    taskId: "patch-noop",
    iterationNumber: 1,
    repoPath: repoRoot,
    allowedFiles: ["allowed"],
    forbiddenFiles: [],
  });

  const diff = await manager.collectDiffArtifacts(session);
  assert.deepEqual(diff.changedFiles, []);
  assert.equal(await readFile(diff.diffPath, "utf8"), "\n");
});

test("apply mode can promote isolated changes back to the source repo when explicitly allowed", async () => {
  const repoRoot = await createRepoFixture();
  const manager = new FileSystemWorkspaceManager(path.join(repoRoot, ".workspaces"));
  const session = await manager.createWorkspace({
    taskId: "patch-apply",
    iterationNumber: 1,
    repoPath: repoRoot,
    allowedFiles: ["allowed"],
    forbiddenFiles: [],
  });

  await writeWorkspaceFile(session, "allowed/sample.txt", "applied\n");
  const diff = await manager.collectDiffArtifacts(session);
  await manager.applyWorkspaceToRepo(session, diff.changedFiles);

  assert.equal(await readFile(path.join(repoRoot, "allowed", "sample.txt"), "utf8"), "applied\n");
});
