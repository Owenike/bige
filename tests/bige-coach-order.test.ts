import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCoachIdOrder,
  applyStoredCoachOrder,
  hasExactCoachSet,
  reorderCoachList,
  synchronizeCoachOrderAcrossBoards,
} from "../lib/bige-coach-order";

const coaches = ["Bae", "Becky", "Lily", "Una", "Wade", "Wiwi"].map((id) => ({ id }));

test("a coach column can move from first to fifth without losing any coach", () => {
  const reordered = reorderCoachList(coaches, "Bae", "Wade");
  assert.deepEqual(reordered.map((coach) => coach.id), ["Becky", "Lily", "Una", "Wade", "Bae", "Wiwi"]);
  assert.deepEqual(coaches.map((coach) => coach.id), ["Bae", "Becky", "Lily", "Una", "Wade", "Wiwi"]);
});

test("stored coach order is applied while unordered new coaches stay stable", () => {
  const reordered = applyStoredCoachOrder(coaches, [
    { coach_id: "Lily", sort_order: 0 },
    { coach_id: "Bae", sort_order: 1 },
  ]);
  assert.deepEqual(reordered.map((coach) => coach.id), ["Lily", "Bae", "Becky", "Una", "Wade", "Wiwi"]);
});

test("a reordered coach list is synchronized across every cached schedule date", () => {
  const boards = new Map([
    ["2026-08-15", { businessDate: "2026-08-15", coaches: [...coaches] }],
    ["2026-08-16", { businessDate: "2026-08-16", coaches: [...coaches].reverse() }],
  ]);
  const orderedCoachIds = ["Wiwi", "Wade", "Una", "Lily", "Becky", "Bae"];

  synchronizeCoachOrderAcrossBoards(boards, orderedCoachIds);

  assert.deepEqual(
    [...boards.values()].map((board) => board.coaches.map((coach) => coach.id)),
    [orderedCoachIds, orderedCoachIds],
  );
  assert.deepEqual(
    applyCoachIdOrder([...coaches, { id: "NewCoach" }], orderedCoachIds).map((coach) => coach.id),
    [...orderedCoachIds, "NewCoach"],
  );
});

test("coach reorder payload must contain every visible coach exactly once", () => {
  const expected = coaches.map((coach) => coach.id);
  assert.equal(hasExactCoachSet(expected, ["Wiwi", "Wade", "Una", "Lily", "Becky", "Bae"]), true);
  assert.equal(hasExactCoachSet(expected, ["Wiwi", "Wade", "Una", "Lily", "Becky"]), false);
  assert.equal(hasExactCoachSet(expected, ["Wiwi", "Wade", "Una", "Lily", "Becky", "Becky"]), false);
});
