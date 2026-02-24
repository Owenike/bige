export type ProgressStatus = "active" | "completed" | "archived";
export type ProgressEventType = "status_changed" | "note_changed" | "status_note_changed";

export type ProgressEventComputationInput = {
  currentStatus: ProgressStatus;
  nextStatus: ProgressStatus;
  currentNote: string | null | undefined;
  nextNoteInput: string | null;
  hasNote: boolean;
};

export type ProgressEventComputationResult = {
  changed: boolean;
  statusChanged: boolean;
  noteChanged: boolean;
  targetNote: string | null;
  eventType: ProgressEventType | null;
};

export function normalizeComparableNote(input: string | null | undefined, maxLen = 1000) {
  if (typeof input !== "string") return "";
  const trimmed = input.trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

export function computeProgressEventChange(input: ProgressEventComputationInput): ProgressEventComputationResult {
  const targetNote = input.hasNote ? input.nextNoteInput : (input.currentNote ?? null);
  const statusChanged = input.currentStatus !== input.nextStatus;
  const noteChanged = input.hasNote
    && normalizeComparableNote(input.currentNote) !== normalizeComparableNote(targetNote);

  if (!statusChanged && !noteChanged) {
    return {
      changed: false,
      statusChanged: false,
      noteChanged: false,
      targetNote,
      eventType: null,
    };
  }

  const eventType: ProgressEventType = statusChanged && noteChanged
    ? "status_note_changed"
    : statusChanged
      ? "status_changed"
      : "note_changed";

  return {
    changed: true,
    statusChanged,
    noteChanged,
    targetNote,
    eventType,
  };
}
