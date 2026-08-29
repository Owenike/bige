"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { canUseStaffNotificationCenter } from "../lib/staff-credentials";
import {
  STAFF_NOTIFICATION_DRAG_THRESHOLD,
  clampStaffNotificationPosition,
  parseSavedStaffNotificationPosition,
  restoreStaffNotificationPosition,
  snapStaffNotificationPosition,
  type SavedStaffNotificationPosition,
  type StaffNotificationPosition,
} from "../lib/staff-notification-position";
import styles from "./staff-notification-button.module.css";

const POSITION_STORAGE_KEY = "bige.staff-notification-button-position.v1";

type DragState = {
  active: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
  lastPosition: StaffNotificationPosition;
  cleanup: (() => void) | null;
};

function viewportSize() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

export default function StaffNotificationButton() {
  const [unread, setUnread] = useState(0);
  const [available, setAvailable] = useState(false);
  const [position, setPosition] = useState<StaffNotificationPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const savedPositionRef = useRef<SavedStaffNotificationPosition | null>(null);
  const suppressPointerClickRef = useRef(false);
  const suppressClickTimerRef = useRef<number | null>(null);
  const dragRef = useRef<DragState>({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    moved: false,
    lastPosition: { x: 0, y: 0 },
    cleanup: null,
  });

  useEffect(() => {
    let active = true;

    async function load() {
      const identityResponse = await fetch("/api/auth/me", {
        cache: "no-store",
      }).catch(() => null);
      if (!active) return;
      if (identityResponse?.ok) {
        const identity = await identityResponse.json().catch(() => null);
        if (!canUseStaffNotificationCenter(identity?.employeeNumber)) {
          setAvailable(false);
          return;
        }
      }

      const response = await fetch("/api/notifications?status=unread&limit=1", {
        cache: "no-store",
      }).catch(() => null);
      if (!active || !response?.ok) return;
      const payload = await response.json().catch(() => null);
      const data = payload?.data || payload;
      setUnread(Number(data?.unreadCount || 0));
      setAvailable(true);
    }

    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!available) return;

    let saved: SavedStaffNotificationPosition | null = null;
    try {
      saved = parseSavedStaffNotificationPosition(
        window.localStorage.getItem(POSITION_STORAGE_KEY),
      );
    } catch {
      // Some privacy modes block storage access; dragging still works for this page view.
    }
    savedPositionRef.current = saved;
    if (saved) {
      setPosition(restoreStaffNotificationPosition(saved, viewportSize()));
    }

    const keepInsideViewport = () => {
      const viewport = viewportSize();
      if (savedPositionRef.current) {
        setPosition(restoreStaffNotificationPosition(savedPositionRef.current, viewport));
        return;
      }
      setPosition((current) =>
        current ? clampStaffNotificationPosition(current, viewport) : current,
      );
    };

    window.addEventListener("resize", keepInsideViewport);
    return () => window.removeEventListener("resize", keepInsideViewport);
  }, [available]);

  useEffect(() => {
    return () => {
      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current);
      }
      dragRef.current.cleanup?.();
    };
  }, []);

  const rememberSnappedPosition = (current: StaffNotificationPosition) => {
    const snapped = snapStaffNotificationPosition(current, viewportSize());
    setPosition(snapped.position);
    savedPositionRef.current = snapped.saved;
    try {
      window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(snapped.saved));
    } catch {
      // The button remains draggable when storage is unavailable.
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag.active || event.pointerId !== drag.pointerId) return;

    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.moved && distance < STAFF_NOTIFICATION_DRAG_THRESHOLD) return;

    drag.moved = true;
    const next = clampStaffNotificationPosition(
      {
        x: event.clientX - drag.offsetX,
        y: event.clientY - drag.offsetY,
      },
      viewportSize(),
    );
    drag.lastPosition = next;
    setPosition(next);
    event.preventDefault();
  };

  const finishPointerInteraction = (event: PointerEvent, target: HTMLAnchorElement) => {
    const drag = dragRef.current;
    if (!drag.active || event.pointerId !== drag.pointerId) return;

    drag.active = false;
    drag.pointerId = -1;
    drag.cleanup?.();
    drag.cleanup = null;
    setDragging(false);
    if (target.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture?.(event.pointerId);
    }

    if (!drag.moved) return;
    rememberSnappedPosition(drag.lastPosition);
    suppressPointerClickRef.current = true;
    if (suppressClickTimerRef.current !== null) {
      window.clearTimeout(suppressClickTimerRef.current);
    }
    suppressClickTimerRef.current = window.setTimeout(() => {
      suppressPointerClickRef.current = false;
      suppressClickTimerRef.current = null;
    }, 250);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    const initial = { x: rect.left, y: rect.top };
    dragRef.current.cleanup?.();

    const move = (pointerEvent: PointerEvent) => handlePointerMove(pointerEvent);
    const finish = (pointerEvent: PointerEvent) =>
      finishPointerInteraction(pointerEvent, target);
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      target.removeEventListener("lostpointercapture", finish);
    };

    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
      lastPosition: initial,
      cleanup,
    };
    suppressPointerClickRef.current = false;
    setPosition(initial);
    setDragging(true);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    target.addEventListener("lostpointercapture", finish);
    try {
      target.setPointerCapture?.(event.pointerId);
    } catch {
      // Window listeners continue the drag if pointer capture is unavailable.
    }
  };

  const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!suppressPointerClickRef.current || event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
    suppressPointerClickRef.current = false;
  };

  if (!available) return null;

  return (
    <Link
      className={`${styles.button} ${dragging ? styles.dragging : ""}`}
      href="/staff/notifications"
      aria-label={unread > 0 ? `通知中心，${unread} 則未讀；可拖曳移動` : "通知中心；可拖曳移動"}
      title="拖曳可移動，點一下開啟通知中心"
      data-staff-notification-button
      data-dragging={dragging ? "true" : "false"}
      draggable={false}
      style={position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : undefined}
      onClick={handleClick}
      onDragStart={(event) => event.preventDefault()}
      onPointerDown={handlePointerDown}
    >
      <Bell size={20} />
      {unread > 0 ? <span className={styles.badge}>{unread > 99 ? "99+" : unread}</span> : null}
    </Link>
  );
}
