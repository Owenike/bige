import assert from "node:assert/strict";
import test from "node:test";
import { buildFeedbackItems, type FeedbackEventItem } from "../lib/member-progress-feedback";

const baseEvents: FeedbackEventItem[] = [
  {
    id: "e1",
    entryId: "t1",
    category: "task",
    title: "Task member",
    eventType: "note_changed",
    fromStatus: "active",
    toStatus: "active",
    fromNote: null,
    toNote: "member note",
    actorRole: "member",
    createdAt: "2026-02-25T02:40:00.000Z",
  },
  {
    id: "e2",
    entryId: "g1",
    category: "goal",
    title: "Goal coach",
    eventType: "status_note_changed",
    fromStatus: "active",
    toStatus: "completed",
    fromNote: null,
    toNote: "coach note",
    actorRole: "coach",
    createdAt: "2026-02-25T02:41:00.000Z",
  },
];

test("uses events first and sorts by createdAt desc", () => {
  const rows = buildFeedbackItems({
    feedbackEvents: baseEvents,
    goals: [],
    tasks: [],
    onlyMemberFeedback: false,
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.id, "e2");
  assert.equal(rows[1]?.id, "e1");
});

test("member-only filter keeps only member events", () => {
  const rows = buildFeedbackItems({
    feedbackEvents: baseEvents,
    goals: [],
    tasks: [],
    onlyMemberFeedback: true,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, "e1");
  assert.equal(rows[0]?.actorRole, "member");
});

test("falls back to goals/tasks notes when no events", () => {
  const rows = buildFeedbackItems({
    feedbackEvents: [],
    goals: [
      { id: "g1", title: "Goal", note: "goal note", status: "active", updatedAt: "2026-02-25T01:00:00.000Z" },
    ],
    tasks: [
      { id: "t1", title: "Task", note: "task note", status: "completed", updatedAt: "2026-02-25T02:00:00.000Z", source: "member" },
    ],
    onlyMemberFeedback: false,
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.kind, "task");
  assert.equal(rows[0]?.actorRole, "member");
});

test("does not fallback when event history exists but event notes are empty", () => {
  const rows = buildFeedbackItems({
    feedbackEvents: [{
      ...baseEvents[0],
      id: "e-empty",
      toNote: "   ",
    }],
    goals: [{ id: "g1", title: "Goal", note: "goal note", status: "active", updatedAt: "2026-02-25T01:00:00.000Z" }],
    tasks: [],
    onlyMemberFeedback: false,
  });
  assert.equal(rows.length, 0);
});
