import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGitHubEvent } from "../../src/github-events";

test("GitHub event intake normalizes issue, PR, comment, and workflow_dispatch payloads", () => {
  const issue = normalizeGitHubEvent({
    action: "opened",
    issue: {
      id: 101,
      number: 42,
      title: "Investigate orchestrator drift",
      body: "Please inspect orchestrator intake behavior.",
      labels: [{ name: "orchestrator" }],
    },
    repository: {
      full_name: "example/bige",
      name: "bige",
      default_branch: "main",
    },
  });
  assert.equal(issue.eventType, "issue_opened");
  assert.equal(issue.issueNumber, 42);

  const pr = normalizeGitHubEvent({
    action: "synchronize",
    pull_request: {
      id: 202,
      number: 7,
      title: "Refresh orchestrator queue docs",
      body: "sync",
      head: { ref: "feature/orchestrator", sha: "abc123" },
      labels: [{ name: "orchestrator:handoff" }],
    },
    repository: {
      full_name: "example/bige",
      name: "bige",
      default_branch: "main",
    },
  });
  assert.equal(pr.eventType, "pull_request_synchronize");
  assert.equal(pr.headSha, "abc123");

  const comment = normalizeGitHubEvent({
    action: "created",
    issue: {
      id: 303,
      number: 12,
      title: "Run orchestrator",
      labels: [{ name: "orchestrator" }],
    },
    comment: {
      id: 9001,
      body: "/orchestrator run",
    },
    repository: {
      full_name: "example/bige",
      name: "bige",
      default_branch: "main",
    },
  });
  assert.equal(comment.eventType, "issue_comment_command");
  assert.equal(comment.command, "/orchestrator run");

  const workflow = normalizeGitHubEvent({
    event_type: "workflow_dispatch",
    repository: {
      full_name: "example/bige",
      name: "bige",
      default_branch: "main",
    },
    ref: "refs/heads/main",
    inputs: {
      event_id: "dispatch-1",
      title: "Dispatch orchestrator task",
      issue_number: "55",
      labels: "orchestrator,orchestrator:auto",
    },
  });
  assert.equal(workflow.eventType, "workflow_dispatch");
  assert.equal(workflow.sourceEventId, "dispatch-1");
  assert.equal(workflow.issueNumber, 55);
});
