import assert from "node:assert/strict";
import test from "node:test";
import {
  bumpBigeBoardRevision,
  isBigeBoardRevisionCurrent,
  readBigeBoardRevision,
} from "../lib/bige-board-freshness";

test("a board response started before a completion mutation becomes stale", () => {
  const revisions = new Map<string, number>();
  const businessDate = "2026-08-19";
  const requestRevision = readBigeBoardRevision(revisions, businessDate);

  assert.equal(isBigeBoardRevisionCurrent(revisions, businessDate, requestRevision), true);
  assert.equal(bumpBigeBoardRevision(revisions, businessDate), 1);
  assert.equal(isBigeBoardRevisionCurrent(revisions, businessDate, requestRevision), false);
  assert.equal(isBigeBoardRevisionCurrent(revisions, businessDate, 1), true);
});

test("board revisions are isolated by business date", () => {
  const revisions = new Map<string, number>();

  bumpBigeBoardRevision(revisions, "2026-08-19");

  assert.equal(readBigeBoardRevision(revisions, "2026-08-19"), 1);
  assert.equal(readBigeBoardRevision(revisions, "2026-08-20"), 0);
});
