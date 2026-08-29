export const STAFF_NOTIFICATION_BUTTON_SIZE = 48;
export const STAFF_NOTIFICATION_VIEWPORT_MARGIN = 14;
export const STAFF_NOTIFICATION_DRAG_THRESHOLD = 6;

export type StaffNotificationPosition = {
  x: number;
  y: number;
};

export type SavedStaffNotificationPosition = {
  side: "left" | "right";
  yRatio: number;
};

type ViewportSize = {
  width: number;
  height: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function axisBounds(viewportSize: number, buttonSize: number, margin: number) {
  const available = Math.max(0, viewportSize - buttonSize);
  const min = Math.min(margin, available);
  const max = Math.max(min, available - margin);
  return { min, max };
}

export function clampStaffNotificationPosition(
  position: StaffNotificationPosition,
  viewport: ViewportSize,
  buttonSize = STAFF_NOTIFICATION_BUTTON_SIZE,
  margin = STAFF_NOTIFICATION_VIEWPORT_MARGIN,
): StaffNotificationPosition {
  const horizontal = axisBounds(viewport.width, buttonSize, margin);
  const vertical = axisBounds(viewport.height, buttonSize, margin);

  return {
    x: clamp(position.x, horizontal.min, horizontal.max),
    y: clamp(position.y, vertical.min, vertical.max),
  };
}

export function snapStaffNotificationPosition(
  position: StaffNotificationPosition,
  viewport: ViewportSize,
  buttonSize = STAFF_NOTIFICATION_BUTTON_SIZE,
  margin = STAFF_NOTIFICATION_VIEWPORT_MARGIN,
) {
  const clamped = clampStaffNotificationPosition(position, viewport, buttonSize, margin);
  const horizontal = axisBounds(viewport.width, buttonSize, margin);
  const vertical = axisBounds(viewport.height, buttonSize, margin);
  const side: SavedStaffNotificationPosition["side"] =
    clamped.x + buttonSize / 2 < viewport.width / 2 ? "left" : "right";
  const verticalRange = vertical.max - vertical.min;
  const yRatio = verticalRange > 0 ? (clamped.y - vertical.min) / verticalRange : 0;

  return {
    position: {
      x: side === "left" ? horizontal.min : horizontal.max,
      y: clamped.y,
    },
    saved: {
      side,
      yRatio,
    } satisfies SavedStaffNotificationPosition,
  };
}

export function restoreStaffNotificationPosition(
  saved: SavedStaffNotificationPosition,
  viewport: ViewportSize,
  buttonSize = STAFF_NOTIFICATION_BUTTON_SIZE,
  margin = STAFF_NOTIFICATION_VIEWPORT_MARGIN,
): StaffNotificationPosition {
  const horizontal = axisBounds(viewport.width, buttonSize, margin);
  const vertical = axisBounds(viewport.height, buttonSize, margin);
  const yRatio = clamp(saved.yRatio, 0, 1);

  return {
    x: saved.side === "left" ? horizontal.min : horizontal.max,
    y: vertical.min + (vertical.max - vertical.min) * yRatio,
  };
}

export function parseSavedStaffNotificationPosition(value: string | null) {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<SavedStaffNotificationPosition>;
    if (parsed.side !== "left" && parsed.side !== "right") return null;
    if (typeof parsed.yRatio !== "number" || !Number.isFinite(parsed.yRatio)) return null;
    return {
      side: parsed.side,
      yRatio: clamp(parsed.yRatio, 0, 1),
    } satisfies SavedStaffNotificationPosition;
  } catch {
    return null;
  }
}
