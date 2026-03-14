import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import {
  formatSandboxProfileList,
  listSandboxProfiles,
  showSandboxProfile,
  validateSandboxProfile,
} from "../../src/sandbox-profile-ops";
import type { LoadedGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";

function createRegistry(): LoadedGitHubSandboxTargetRegistry {
  return {
    registry: {
      version: "sandbox-v3",
      defaultProfileId: "default",
      profiles: {
        default: {
          repository: "example/bige",
          targetType: "issue",
          targetNumber: 42,
          actionPolicy: "create_or_update",
        },
        release: {
          repository: "example/bige",
          targetType: "pull_request",
          targetNumber: 88,
          actionPolicy: "update_only",
        },
      },
    },
    version: "sandbox-v3",
    source: "file",
    path: "sandbox-targets.json",
  };
}

function createState(profileId = "default") {
  const state = createInitialState({
    id: `sandbox-profile-ops-${profileId}`,
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Inspect sandbox profiles",
    objective: "Expose operator-facing sandbox profile tools",
    subtasks: ["sandbox-profile-ops"],
    successCriteria: ["operators can list and validate profiles"],
  });
  return {
    ...state,
    task: {
      ...state.task,
      profileId,
    },
  };
}

test("sandbox profile ops list profiles and mark the default profile", () => {
  const profiles = listSandboxProfiles(createRegistry());
  assert.equal(profiles.length, 2);
  assert.equal(profiles[0]?.profileId, "default");
  assert.equal(profiles[0]?.isDefault, true);
  assert.match(formatSandboxProfileList(createRegistry()), /default \(default\): example\/bige#42/);
});

test("sandbox profile ops show the selected profile", () => {
  const profile = showSandboxProfile(createRegistry(), "release");
  assert.equal(profile?.profileId, "release");
  assert.equal(profile?.targetType, "pull_request");
  assert.equal(profile?.actionPolicy, "update_only");
});

test("sandbox profile ops validate the active profile", () => {
  const validation = validateSandboxProfile({
    state: createState("release"),
    loadedRegistry: createRegistry(),
  });
  assert.equal(validation.status, "resolved");
  assert.equal(validation.profileId, "release");
  assert.equal(validation.targetType, "pull_request");
});

test("sandbox profile ops block invalid profiles without falling back to arbitrary targets", () => {
  const validation = validateSandboxProfile({
    state: createState("missing"),
    loadedRegistry: {
      registry: {
        version: "empty-v1",
        defaultProfileId: null,
        profiles: {},
      },
      version: "empty-v1",
      source: "default",
      path: null,
    },
    profileId: "missing",
  });
  assert.equal(validation.status, "manual_required");
  assert.equal(validation.failureReason, "github_auth_smoke_missing_sandbox_target_profile");
});
