import assert from "node:assert/strict";
import test from "node:test";
import { extractGptCodeReportFromGitHubComment } from "../../src/gpt-code-external-automation";
import { completedSliceReport } from "./helpers/gpt-code-report-fixtures";

test("external source adapter extracts GPT CODE report metadata from a GitHub issue comment payload", () => {
  const metadata = extractGptCodeReportFromGitHubComment({
    payload: {
      action: "created",
      issue: {
        number: 44,
        title: "Transport MVP",
      },
      comment: {
        id: 9911,
        body: completedSliceReport,
      },
      repository: {
        full_name: "example/bige",
      },
    },
    deliveryId: "delivery-report-1",
    payloadPath: "C:/tmp/payload.json",
    headersPath: "C:/tmp/headers.json",
    receivedAt: "2026-03-18T00:00:00.000Z",
  });

  assert.equal(metadata?.sourceType, "github_issue_comment");
  assert.equal(metadata?.sourceLaneClassification, "github_issue_comment_lane");
  assert.equal(metadata?.sourceId, "github-comment:9911");
  assert.equal(metadata?.repository, "example/bige");
  assert.equal(metadata?.issueNumber, 44);
  assert.equal(metadata?.commentId, 9911);
  assert.equal(metadata?.payloadPath, "C:/tmp/payload.json");
});

test("external source adapter extracts GPT CODE report metadata from a GitHub pull request review comment payload", () => {
  const metadata = extractGptCodeReportFromGitHubComment({
    payload: {
      action: "created",
      pull_request: {
        number: 77,
        title: "External lane on PR review comment",
      },
      comment: {
        id: 9922,
        body: completedSliceReport,
      },
      repository: {
        full_name: "example/bige",
      },
    },
    deliveryId: "delivery-report-2",
    payloadPath: "C:/tmp/review-comment-payload.json",
    headersPath: "C:/tmp/review-comment-headers.json",
    receivedAt: "2026-03-18T00:00:00.000Z",
  });

  assert.equal(metadata?.sourceType, "github_pull_request_review_comment");
  assert.equal(metadata?.sourceLaneClassification, "github_pull_request_review_comment_lane");
  assert.equal(metadata?.sourceId, "github-pr-review-comment:9922");
  assert.equal(metadata?.repository, "example/bige");
  assert.equal(metadata?.prNumber, 77);
  assert.equal(metadata?.commentId, 9922);
});
