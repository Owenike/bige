import type { ProgressStatus } from "./member-progress-events";

export type FeedbackActorRole = "platform_admin" | "manager" | "frontdesk" | "coach" | "member";

export type FeedbackEventItem = {
  id: string;
  entryId: string;
  category: "goal" | "task";
  title: string;
  eventType: "status_changed" | "note_changed" | "status_note_changed";
  fromStatus: ProgressStatus;
  toStatus: ProgressStatus;
  fromNote: string | null;
  toNote: string | null;
  actorRole: FeedbackActorRole;
  createdAt: string;
};

type GoalItem = {
  id: string;
  title: string;
  note: string | null;
  status: ProgressStatus;
  updatedAt: string;
};

type TaskItem = {
  id: string;
  title: string;
  note: string | null;
  status: ProgressStatus;
  updatedAt: string;
  source: "coach" | "member";
};

export type FeedbackItem = {
  id: string;
  kind: "goal" | "task";
  title: string;
  status: ProgressStatus;
  note: string;
  actorRole: FeedbackActorRole;
  createdAt: string;
};

export function buildFeedbackItems(params: {
  feedbackEvents: FeedbackEventItem[];
  goals: GoalItem[];
  tasks: TaskItem[];
  onlyMemberFeedback: boolean;
  limit?: number;
}) {
  const limit = params.limit ?? 12;

  const eventRows: FeedbackItem[] = params.feedbackEvents
    .filter((item) => Boolean((item.toNote || "").trim()))
    .filter((item) => !params.onlyMemberFeedback || item.actorRole === "member")
    .map((item) => ({
      id: item.id,
      kind: item.category,
      title: item.title,
      status: item.toStatus,
      note: (item.toNote || "").trim(),
      actorRole: item.actorRole,
      createdAt: item.createdAt,
    }));

  if (eventRows.length > 0 || params.feedbackEvents.length > 0) {
    eventRows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return eventRows.slice(0, limit);
  }

  const fallbackRows: FeedbackItem[] = [
    ...params.goals
      .filter((item) => Boolean((item.note || "").trim()))
      .map((item) => ({
        id: item.id,
        kind: "goal" as const,
        title: item.title,
        status: item.status,
        note: (item.note || "").trim(),
        actorRole: "coach" as const,
        createdAt: item.updatedAt,
      })),
    ...params.tasks
      .filter((item) => Boolean((item.note || "").trim()))
      .map((item) => ({
        id: item.id,
        kind: "task" as const,
        title: item.title,
        status: item.status,
        note: (item.note || "").trim(),
        actorRole: item.source === "member" ? "member" as const : "coach" as const,
        createdAt: item.updatedAt,
      })),
  ].filter((item) => !params.onlyMemberFeedback || item.actorRole === "member");

  fallbackRows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return fallbackRows.slice(0, limit);
}
