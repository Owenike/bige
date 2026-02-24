import assert from "node:assert/strict";
import test from "node:test";
import { computeProgressEventChange } from "../lib/member-progress-events";

test("returns unchanged when status and note are unchanged", () => {
  const result = computeProgressEventChange({
    currentStatus: "active",
    nextStatus: "active",
    currentNote: "same",
    nextNoteInput: null,
    hasNote: false,
  });
  assert.equal(result.changed, false);
  assert.equal(result.eventType, null);
  assert.equal(result.targetNote, "same");
});

test("detects status-only change", () => {
  const result = computeProgressEventChange({
    currentStatus: "active",
    nextStatus: "completed",
    currentNote: "same",
    nextNoteInput: null,
    hasNote: false,
  });
  assert.equal(result.changed, true);
  assert.equal(result.statusChanged, true);
  assert.equal(result.noteChanged, false);
  assert.equal(result.eventType, "status_changed");
  assert.equal(result.targetNote, "same");
});

test("detects note-only change with trimming", () => {
  const result = computeProgressEventChange({
    currentStatus: "active",
    nextStatus: "active",
    currentNote: "old note",
    nextNoteInput: "  new note  ",
    hasNote: true,
  });
  assert.equal(result.changed, true);
  assert.equal(result.statusChanged, false);
  assert.equal(result.noteChanged, true);
  assert.equal(result.eventType, "note_changed");
  assert.equal(result.targetNote, "  new note  ");
});

test("detects status and note change together", () => {
  const result = computeProgressEventChange({
    currentStatus: "active",
    nextStatus: "archived",
    currentNote: "a",
    nextNoteInput: "b",
    hasNote: true,
  });
  assert.equal(result.changed, true);
  assert.equal(result.statusChanged, true);
  assert.equal(result.noteChanged, true);
  assert.equal(result.eventType, "status_note_changed");
});

test("ignores note diff when hasNote is false", () => {
  const result = computeProgressEventChange({
    currentStatus: "completed",
    nextStatus: "completed",
    currentNote: "old",
    nextNoteInput: "new",
    hasNote: false,
  });
  assert.equal(result.changed, false);
  assert.equal(result.eventType, null);
  assert.equal(result.targetNote, "old");
});
