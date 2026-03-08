"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n-provider";
import type { VerifyEntryResponse } from "../../../types/entry";
import { ManualAllowPanel } from "./ManualAllowPanel";

interface RecentCheckinItem {
  id: string;
  memberId: string;
  memberName: string;
  memberCode: string;
  phoneLast4: string | null;
  method: string;
  result: string;
  reason: string;
  checkedAt: string | null;
}

type ScannerMode = "detector" | "zxing" | "jsqr" | "manual";
type NoticeTone = "ok" | "warn" | "error";
type RecentRange = "today" | "week" | "all";
type WorkflowState = "idle" | "scanning" | "success" | "failed";

interface EntryNotice {
  tone: NoticeTone;
  text: string;
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function memberInitials(name: string | null | undefined) {
  if (!name) return "--";
  const normalized = name.trim();
  if (!normalized) return "--";
  if (normalized.length <= 2) return normalized.toUpperCase();
  return normalized.slice(0, 2).toUpperCase();
}

function normalizeScannedToken(raw: string) {
  const value = raw.trim();
  if (!value) return "";

  const readTokenFromUrl = (input: string) => {
    const parsed = new URL(input);
    const tokenFromUrl = parsed.searchParams.get("token");
    return tokenFromUrl ? tokenFromUrl.trim() : "";
  };

  try {
    const tokenFromUrl = readTokenFromUrl(value);
    if (tokenFromUrl) return tokenFromUrl;
  } catch {
    try {
      const tokenFromRelative = readTokenFromUrl(new URL(value, "https://entry.local").toString());
      if (tokenFromRelative) return tokenFromRelative;
    } catch {
      // ignore URL parse failure and fall back to raw value
    }
  }

  const tokenParam = value.match(/[?&]token=([^&#\s]+)/i);
  if (tokenParam?.[1]) {
    try {
      return decodeURIComponent(tokenParam[1]).trim();
    } catch {
      return tokenParam[1].trim();
    }
  }

  if (value.startsWith("token:")) {
    return value.slice(6).trim();
  }
  return value;
}

function parseEntryError(payload: any, lang: "zh" | "en", status?: number) {
  const raw =
    (typeof payload?.error === "string" ? payload.error : "") ||
    (typeof payload?.error?.message === "string" ? payload.error.message : "") ||
    (typeof payload?.message === "string" ? payload.message : "") ||
    (typeof payload?.errorMessage === "string" ? payload.errorMessage : "");
  if (raw === "reason is required") return lang === "zh" ? "請輸入取消原因" : "Reason is required";
  if (raw === "Only allow records can be canceled") return lang === "zh" ? "只能取消「放行」記錄" : raw;
  if (raw === "Shift is not open") return lang === "zh" ? "班別尚未開啟，請先開班。" : "Shift is not open. Please open shift first.";
  if (raw === "Unauthorized") return lang === "zh" ? "尚未登入櫃檯帳號，請重新登入。" : "Unauthorized. Please sign in again.";
  if (raw === "Missing branch context") return lang === "zh" ? "缺少分店資訊，請聯絡管理員。" : "Missing branch context.";
  if (raw === "Missing tenant context") return lang === "zh" ? "缺少租戶資訊，請聯絡管理員。" : "Missing tenant context.";
  if (raw) return raw;
  if (status === 401) return lang === "zh" ? "未授權，請先登入。" : "Unauthorized request.";
  if (status === 409) return lang === "zh" ? "目前不可驗證，請先確認班別狀態。" : "Cannot verify now. Check shift status.";
  if (status === 429) return lang === "zh" ? "操作過於頻繁，請稍後再試。" : "Too many requests. Try again shortly.";
  return lang === "zh" ? "請求失敗" : "Request failed";
}

function membershipLabel(input: VerifyEntryResponse["membership"], lang: "zh" | "en") {
  if (lang === "en") {
    switch (input.kind) {
      case "monthly":
        return `Monthly (expires: ${formatDateTime(input.monthlyExpiresAt)})`;
      case "single":
        return `Single Session (remaining: ${input.remainingSessions ?? 0})`;
      case "punch":
        return `Punch Pass (remaining: ${input.remainingSessions ?? 0})`;
      default:
        return "No valid membership";
    }
  }

  switch (input.kind) {
    case "monthly":
      return `月費會員 (到期: ${formatDateTime(input.monthlyExpiresAt)})`;
    case "single":
      return `單堂方案 (剩餘: ${input.remainingSessions ?? 0})`;
    case "punch":
      return `點數方案 (剩餘: ${input.remainingSessions ?? 0})`;
    default:
      return "無有效會籍";
  }
}

function denyReasonLabel(reason: VerifyEntryResponse["reason"], lang: "zh" | "en") {
  if (!reason) return "-";
  const zh: Record<NonNullable<VerifyEntryResponse["reason"]>, string> = {
    token_invalid: "QR 無效",
    token_expired: "QR 已過期",
    token_used: "QR 已使用",
    rate_limited: "操作過於頻繁",
    member_not_found: "找不到會員",
    already_checked_in_recently: "近期已報到",
    no_valid_pass: "無可用會籍/堂數",
  };
  const en: Record<NonNullable<VerifyEntryResponse["reason"]>, string> = {
    token_invalid: "Invalid QR token",
    token_expired: "Token expired",
    token_used: "Token already used",
    rate_limited: "Too many requests",
    member_not_found: "Member not found",
    already_checked_in_recently: "Recently checked in",
    no_valid_pass: "No valid pass",
  };
  return lang === "en" ? en[reason] : zh[reason];
}

function decisionLabel(decision: VerifyEntryResponse["decision"], lang: "zh" | "en") {
  if (lang === "en") return decision === "allow" ? "Allow" : "Deny";
  return decision === "allow" ? "放行" : "拒絕";
}

function recentMethodLabel(method: string | null | undefined, lang: "zh" | "en") {
  const code = (method || "").trim().toLowerCase();
  if (!code || code === "unknown") return "-";
  const zhMap: Record<string, string> = {
    qr: "掃碼",
    barcode: "條碼",
    manual: "人工",
    token: "手動 token",
  };
  const enMap: Record<string, string> = {
    qr: "QR",
    barcode: "Barcode",
    manual: "Manual",
    token: "Manual token",
  };
  return lang === "zh" ? (zhMap[code] || method || "-") : (enMap[code] || method || "-");
}

function recentResultLabel(result: string | null | undefined, lang: "zh" | "en") {
  const code = (result || "").trim().toLowerCase();
  if (!code || code === "unknown") return "-";
  if (lang === "zh") {
    if (code === "allow") return "成功";
    if (code === "deny") return "拒絕";
    return result || "-";
  }
  if (code === "allow") return "Success";
  if (code === "deny") return "Denied";
  return result || "-";
}

function recentReasonLabel(reason: string | null | undefined, lang: "zh" | "en") {
  const raw = (reason || "").trim();
  if (!raw) return "-";
  const code = raw.toLowerCase();
  const knownReasons: Array<NonNullable<VerifyEntryResponse["reason"]>> = [
    "token_invalid",
    "token_expired",
    "token_used",
    "rate_limited",
    "member_not_found",
    "already_checked_in_recently",
    "no_valid_pass",
  ];
  if (knownReasons.includes(code as NonNullable<VerifyEntryResponse["reason"]>)) {
    return denyReasonLabel(code as NonNullable<VerifyEntryResponse["reason"]>, lang);
  }
  return raw;
}

function isSameLocalDay(isoString: string, now: Date) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function isWithinDays(isoString: string, days: number, now: Date) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return false;
  const diffMs = now.getTime() - date.getTime();
  return diffMs >= 0 && diffMs <= days * 24 * 60 * 60 * 1000;
}

export function FrontdeskCheckinView({ embedded = false }: { embedded?: boolean }) {
  const { locale } = useI18n();
  const lang: "zh" | "en" = locale === "en" ? "en" : "zh";

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const lastDetectedRef = useRef<{ token: string; at: number }>({ token: "", at: 0 });
  const scannedTokenLockRef = useRef<Set<string>>(new Set());
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  const [scannerReady, setScannerReady] = useState(false);
  const [cameraBooting, setCameraBooting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scannerMode, setScannerMode] = useState<ScannerMode>("manual");
  const [cameraFacingMode, setCameraFacingMode] = useState<"environment" | "user">("environment");
  const [cameraClosed, setCameraClosed] = useState(false);
  const [cameraNonce, setCameraNonce] = useState(0);
  const [manualAllowOpen, setManualAllowOpen] = useState(false);
  const [memberViewOpen, setMemberViewOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);

  const [manualInput, setManualInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyEntryResponse | null>(null);
  const [notice, setNotice] = useState<EntryNotice | null>(null);
  const [recentItems, setRecentItems] = useState<RecentCheckinItem[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentWarning, setRecentWarning] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [recentQuery, setRecentQuery] = useState("");
  const [recentRange, setRecentRange] = useState<RecentRange>("today");
  const [recentViewItem, setRecentViewItem] = useState<RecentCheckinItem | null>(null);

  const t = useMemo(
    () =>
      lang === "zh"
        ? {
            title: "櫃檯報到驗證",
            sub: "掃描會員動態 QR，或手動貼上 token 進行驗證。",
            toolbarSwitchCamera: "切換鏡頭",
            toolbarClose: "關閉",
            toolbarOpen: "開啟",
            toolbarMore: "更多",
            moreRestart: "重新啟動鏡頭",
            moreManualAllow: "開啟人工放行",
            moreClearResult: "清空驗證結果",
            statusIdle: "等待掃描",
            statusScanning: "掃描中",
            statusSuccess: "驗證成功",
            statusFailed: "驗證失敗",
            cameraGuide: "將 QR 對準框內，系統會自動辨識",
            cameraReady: "鏡頭已就緒，可開始掃描",
            cameraPreparing: "正在啟動鏡頭...",
            cameraOff: "鏡頭已關閉",
            cameraFailed: "鏡頭不可用",
            cameraPermissionHint: "若畫面無法掃描，請在瀏覽器網址列允許攝影機權限。",
            fallbackLoadFailed: "無法載入備援掃碼引擎，請改用手動 token 驗證。",
            modeDetector: "BarcodeDetector",
            modeFallback: "Fallback",
            modeManual: "Manual only",
            scannerModeLabel: "掃碼模式",
            restartCamera: "重啟鏡頭",
            switchCamera: "切換前後鏡頭",
            infoCardTitle: "狀態與會員資訊",
            infoWaitingTitle: "尚未讀取會員",
            infoWaitingDesc: "請將會員 QR/條碼置於掃描框內，成功後會自動顯示會員摘要。",
            memberName: "姓名",
            phoneLast4: "電話末四碼",
            membership: "會籍",
            lastCheckin: "最近報到",
            todayCount: "今日報到次數",
            checkedAt: "驗證時間",
            reason: "原因",
            gate: "閘門",
            noPhoto: "無照片",
            gateOpen: "已開門",
            gateClosed: "未開門",
            verifyAllowed: "驗證通過，會員可入場。",
            verifyDenied: "驗證未通過",
            verifyNetworkFailed: "驗證失敗，請檢查網路後重試。",
            actionsTitle: "操作",
            actionManualAllow: "人工放行",
            actionConfirmAllow: "確認放行",
            actionRestart: "重啟鏡頭",
            actionSwitchCamera: "切換前後鏡頭",
            actionCloseCamera: "關閉鏡頭",
            actionOpenCamera: "開啟鏡頭",
            manualTitle: "手動 token 驗證",
            manualPlaceholder: "貼上 token 後按 Enter",
            manualBtn: "驗證",
            manualBusy: "驗證中...",
            manualHint: "貼上完整 token 會自動驗證。",
            clearToken: "清空 token",
            resultTitle: "驗證結果",
            resultPending: "尚未驗證，請先掃碼或手動貼上 token。",
            clearResult: "清空結果",
            manualAllowQuickTitle: "人工放行",
            manualAllowQuickHint: "僅限例外情境使用，點擊按鈕開啟視窗填寫。",
            manualAllowOpenBtn: "開啟人工放行",
            manualAllowModalTitle: "人工放行",
            closeModal: "關閉",
            memberModalTitle: "會員資料（唯讀）",
            recentTitle: "最近入場紀錄",
            recentReload: "重新整理",
            recentLoading: "載入中...",
            recentEmpty: "查無符合條件的紀錄。",
            recentSearchPlaceholder: "搜尋姓名 / 電話末碼 / 方案關鍵字",
            recentFilterToday: "今日",
            recentFilterWeek: "本週",
            recentFilterAll: "全部",
            recentColumnTime: "時間",
            recentColumnName: "姓名",
            recentColumnStatus: "狀態",
            recentColumnAction: "操作",
            recentView: "查看",
            recentDetailTitle: "入場紀錄明細",
            recentMember: "會員",
            recentMethod: "方式",
            recentResult: "結果",
            recentReason: "原因",
            recentCheckedAt: "時間",
            recentVoidAction: "取消誤刷",
            recentVoidingAction: "取消中...",
            recentVoidPrompt: "請輸入取消誤刷原因",
            recentVoidSuccess: "誤刷記錄已取消。",
          }
        : {
            title: "Frontdesk Check-in Verification",
            sub: "Scan member dynamic QR or paste token manually for verification.",
            toolbarSwitchCamera: "Switch Camera",
            toolbarClose: "Close",
            toolbarOpen: "Open",
            toolbarMore: "More",
            moreRestart: "Restart Camera",
            moreManualAllow: "Open Manual Allow",
            moreClearResult: "Clear Result",
            statusIdle: "Waiting",
            statusScanning: "Scanning",
            statusSuccess: "Verified",
            statusFailed: "Failed",
            cameraGuide: "Align member QR within the frame for auto detection",
            cameraReady: "Camera ready",
            cameraPreparing: "Initializing camera...",
            cameraOff: "Camera is off",
            cameraFailed: "Camera unavailable",
            cameraPermissionHint: "If scanner stays black, allow camera permission from browser site settings.",
            fallbackLoadFailed: "Failed to load fallback scanner. Use manual token verification.",
            modeDetector: "BarcodeDetector",
            modeFallback: "Fallback",
            modeManual: "Manual only",
            scannerModeLabel: "Scanner Mode",
            restartCamera: "Restart Camera",
            switchCamera: "Switch Camera",
            infoCardTitle: "Status & Member",
            infoWaitingTitle: "No member scanned yet",
            infoWaitingDesc: "Place member QR/barcode inside the scan frame. Member summary will appear automatically.",
            memberName: "Name",
            phoneLast4: "Phone Last 4",
            membership: "Membership",
            lastCheckin: "Latest Check-in",
            todayCount: "Today Count",
            checkedAt: "Verified At",
            reason: "Reason",
            gate: "Gate",
            noPhoto: "No photo",
            gateOpen: "Opened",
            gateClosed: "Not opened",
            verifyAllowed: "Verification passed. Member can enter.",
            verifyDenied: "Verification denied",
            verifyNetworkFailed: "Verification failed. Check network and retry.",
            actionsTitle: "Actions",
            actionManualAllow: "Manual Allow",
            actionConfirmAllow: "Confirm Entry",
            actionRestart: "Restart Camera",
            actionSwitchCamera: "Switch Front/Back",
            actionCloseCamera: "Close Camera",
            actionOpenCamera: "Open Camera",
            manualTitle: "Manual token verification",
            manualPlaceholder: "Paste token and press Enter",
            manualBtn: "Verify",
            manualBusy: "Verifying...",
            manualHint: "Pasting a full token will auto verify.",
            clearToken: "Clear token",
            resultTitle: "Verification Result",
            resultPending: "No verification yet. Scan QR or paste token first.",
            clearResult: "Clear result",
            manualAllowQuickTitle: "Manual Allow",
            manualAllowQuickHint: "Use for exceptions only. Click the button to open the manual-allow dialog.",
            manualAllowOpenBtn: "Open Manual Allow",
            manualAllowModalTitle: "Manual Allow",
            closeModal: "Close",
            memberModalTitle: "Member Profile (Read-only)",
            recentTitle: "Recent Entry Logs",
            recentReload: "Reload",
            recentLoading: "Loading...",
            recentEmpty: "No matching records.",
            recentSearchPlaceholder: "Search by name / phone suffix / keyword",
            recentFilterToday: "Today",
            recentFilterWeek: "This week",
            recentFilterAll: "All",
            recentColumnTime: "Time",
            recentColumnName: "Name",
            recentColumnStatus: "Status",
            recentColumnAction: "Action",
            recentView: "View",
            recentDetailTitle: "Check-in Detail",
            recentMember: "Member",
            recentMethod: "Method",
            recentResult: "Result",
            recentReason: "Reason",
            recentCheckedAt: "Time",
            recentVoidAction: "Undo Wrong Scan",
            recentVoidingAction: "Undoing...",
            recentVoidPrompt: "Please input reason to undo this scan",
            recentVoidSuccess: "Wrong scan has been canceled.",
          },
    [lang],
  );

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!result?.member) return;
    setMemberViewOpen(true);
  }, [result]);

  useEffect(() => {
    if (!manualAllowOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setManualAllowOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [manualAllowOpen]);

  useEffect(() => {
    if (!memberViewOpen && !recentViewItem) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMemberViewOpen(false);
        setRecentViewItem(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [memberViewOpen, recentViewItem]);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!moreMenuRef.current) return;
      if (!moreMenuRef.current.contains(event.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [moreMenuOpen]);

  const stopScanner = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setScannerReady(false);
    setCameraBooting(false);
  }, []);

  const loadRecentCheckins = useCallback(async () => {
    setRecentLoading(true);
    setRecentError(null);
    try {
      const response = await fetch(`/api/frontdesk/checkins?limit=${embedded ? 12 : 24}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(parseEntryError(payload, lang, response.status));
      setRecentItems(Array.isArray(payload.items) ? (payload.items as RecentCheckinItem[]) : []);
      setRecentWarning(typeof payload.warning === "string" ? payload.warning : null);
    } catch (error) {
      setRecentItems([]);
      setRecentWarning(null);
      setRecentError(error instanceof Error ? error.message : parseEntryError({}, lang));
    } finally {
      setRecentLoading(false);
    }
  }, [embedded, lang]);

  const callVerify = useCallback(async (token: string) => {
    const trimmed = token.trim();
    if (!trimmed || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);

    try {
      const response = await fetch("/api/entry/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: trimmed }),
      });
      const payload = (await response.json().catch(() => null)) as VerifyEntryResponse | { error?: string } | null;

      if (!response.ok) {
        const message = parseEntryError(payload, lang, response.status);
        setResult(null);
        setNotice({ tone: "error", text: message });
        return true;
      }

      const verified = payload as VerifyEntryResponse;
      setResult(verified);

      if (verified.decision === "allow") {
        setNotice({ tone: "ok", text: t.verifyAllowed });
        void loadRecentCheckins();
      } else {
        const reasonText = denyReasonLabel(verified.reason, lang);
        setNotice({ tone: "warn", text: `${t.verifyDenied}: ${reasonText}` });
      }
      return true;
    } catch {
      setNotice({ tone: "error", text: t.verifyNetworkFailed });
      setResult({
        decision: "deny",
        reason: "token_invalid",
        member: null,
        membership: { kind: "none", monthlyExpiresAt: null, remainingSessions: null },
        latestCheckinAt: null,
        todayCheckinCount: 0,
        checkedAt: new Date().toISOString(),
        gate: { attempted: false, opened: false, message: "Verify request failed" },
      });
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
      setManualInput("");
    }
  }, [lang, loadRecentCheckins, t.verifyAllowed, t.verifyDenied, t.verifyNetworkFailed]);

  const submitScannedToken = useCallback(async (rawToken: string) => {
    const token = normalizeScannedToken(rawToken);
    if (!token) return;
    if (scannedTokenLockRef.current.has(token)) return;

    const now = Date.now();
    if (lastDetectedRef.current.token === token && now - lastDetectedRef.current.at < 1500) {
      return;
    }
    lastDetectedRef.current = { token, at: now };
    const reachedServer = await callVerify(token);
    if (!reachedServer) return;

    scannedTokenLockRef.current.add(token);
    if (scannedTokenLockRef.current.size > 120) {
      const oldest = scannedTokenLockRef.current.values().next().value as string | undefined;
      if (oldest) scannedTokenLockRef.current.delete(oldest);
    }
  }, [callVerify]);

  const handleVoidCheckin = useCallback(async (item: RecentCheckinItem) => {
    const reasonInput = window.prompt(t.recentVoidPrompt, "");
    if (reasonInput === null) return;
    const reason = reasonInput.trim();
    if (!reason) return;

    setVoidingId(item.id);
    setRecentError(null);
    try {
      const response = await fetch("/api/frontdesk/checkins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "void", checkinId: item.id, reason }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(parseEntryError(payload, lang, response.status));
      setRecentWarning(typeof payload.warning === "string" ? payload.warning : t.recentVoidSuccess);
      await loadRecentCheckins();
      setRecentViewItem((current) => (current?.id === item.id ? null : current));
    } catch (error) {
      setRecentError(error instanceof Error ? error.message : parseEntryError({}, lang));
    } finally {
      setVoidingId(null);
    }
  }, [lang, loadRecentCheckins, t.recentVoidPrompt, t.recentVoidSuccess]);

  const restartCamera = useCallback(() => {
    setCameraNonce((value) => value + 1);
  }, []);

  const toggleCameraFacing = useCallback(() => {
    setCameraFacingMode((mode) => (mode === "environment" ? "user" : "environment"));
  }, []);

  const closeCamera = useCallback(() => {
    setCameraClosed(true);
    setCameraError(null);
    stopScanner();
  }, [stopScanner]);

  const openCamera = useCallback(() => {
    setCameraClosed(false);
    setCameraError(null);
    setCameraNonce((value) => value + 1);
  }, []);

  const toggleCameraPower = useCallback(() => {
    if (cameraClosed) openCamera();
    else closeCamera();
  }, [cameraClosed, closeCamera, openCamera]);

  const handleManualPaste = useCallback((event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text").trim();
    if (!pasted) return;
    event.preventDefault();
    setManualInput(pasted);
    setNotice({ tone: "ok", text: t.manualHint });
    window.setTimeout(() => {
      void callVerify(pasted);
    }, 80);
  }, [callVerify, t.manualHint]);

  useEffect(() => {
    let mounted = true;
    let zxingDecodeFrame: null | ((canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, width: number, height: number) => string | null) = null;
    let jsQrDecode: null | ((bytes: Uint8ClampedArray, width: number, height: number) => string | null) = null;
    let jsQrDecodeFrame: null | ((context: CanvasRenderingContext2D, width: number, height: number) => string | null) = null;
    let detector: any = null;

    const bootScanner = async () => {
      if (cameraClosed) {
        stopScanner();
        setScannerReady(false);
        setCameraError(null);
        setCameraBooting(false);
        return;
      }

      stopScanner();
      setScannerReady(false);
      setCameraError(null);
      setCameraBooting(true);

      try {
        if (typeof window !== "undefined" && "BarcodeDetector" in window) {
          detector = new (window as any).BarcodeDetector({ formats: ["qr_code", "code_128"] });
          setScannerMode("detector");
        }
      } catch {
        detector = null;
      }

      if (!detector) {
        try {
          const mod = await import("@zxing/browser");
          const reader = new mod.BrowserMultiFormatReader();
          reader.possibleFormats = [mod.BarcodeFormat.QR_CODE, mod.BarcodeFormat.CODE_128];
          zxingDecodeFrame = (canvas, context, width, height) => {
            const decodeRegion = (sx: number, sy: number, sw: number, sh: number) => {
              const video = videoRef.current;
              if (!video) return null;
              if (canvas.width !== sw || canvas.height !== sh) {
                canvas.width = sw;
                canvas.height = sh;
              }
              context.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
              try {
                const result = reader.decodeFromCanvas(canvas);
                const text = typeof result.getText === "function" ? result.getText() : "";
                return typeof text === "string" ? text : null;
              } catch {
                return null;
              }
            };

            const full = decodeRegion(0, 0, width, height);
            if (full) return full;

            const cropW = Math.floor(width * 0.72);
            const cropH = Math.floor(height * 0.72);
            if (cropW >= 180 && cropH >= 180) {
              const sx = Math.floor((width - cropW) / 2);
              const sy = Math.floor((height - cropH) / 2);
              return decodeRegion(sx, sy, cropW, cropH);
            }
            return null;
          };
        } catch {
          zxingDecodeFrame = null;
        }

        try {
          const mod = await import("jsqr");
          const decode = (bytes: Uint8ClampedArray, width: number, height: number) => {
            const result = mod.default(bytes, width, height, { inversionAttempts: "attemptBoth" });
            return result?.data ?? null;
          };
          jsQrDecode = decode;
          jsQrDecodeFrame = (context: CanvasRenderingContext2D, width: number, height: number) => {
            const decodeRegion = (sx: number, sy: number, sw: number, sh: number) => {
              const frame = context.getImageData(sx, sy, sw, sh);
              return decode(frame.data, sw, sh);
            };

            const full = decodeRegion(0, 0, width, height);
            if (full) return full;

            const cropW = Math.floor(width * 0.72);
            const cropH = Math.floor(height * 0.72);
            if (cropW >= 180 && cropH >= 180) {
              const sx = Math.floor((width - cropW) / 2);
              const sy = Math.floor((height - cropH) / 2);
              const center = decodeRegion(sx, sy, cropW, cropH);
              if (center) return center;
            }
            return null;
          };
        } catch {
          jsQrDecode = null;
          jsQrDecodeFrame = null;
        }

        if (zxingDecodeFrame) {
          setScannerMode("zxing");
        } else if (jsQrDecodeFrame) {
          setScannerMode("jsqr");
        } else {
          setScannerMode("manual");
          setCameraError(t.fallbackLoadFailed);
          setCameraBooting(false);
          return;
        }
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: cameraFacingMode },
              width: { ideal: 1920, min: 640 },
              height: { ideal: 1080, min: 480 },
              frameRate: { ideal: 30, max: 60 },
            },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        if (!mounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        if (!mounted) return;
        setScannerReady(true);
        setCameraBooting(false);

        const tick = async () => {
          if (!mounted || !videoRef.current) return;

          if (!busyRef.current && videoRef.current.readyState >= 2) {
            let value: string | null = null;

            if (detector) {
              try {
                const codes = await detector.detect(videoRef.current);
                value = (codes?.[0]?.rawValue as string | undefined) ?? null;
              } catch {
                value = null;
              }
            } else if (scanCanvasRef.current) {
              const video = videoRef.current;
              const canvas = scanCanvasRef.current;
              const width = video.videoWidth;
              const height = video.videoHeight;

              if (width > 0 && height > 0) {
                const context = canvas.getContext("2d", { willReadFrequently: true });
                if (context) {
                  if (zxingDecodeFrame) {
                    value = zxingDecodeFrame(canvas, context, width, height);
                  }
                  if (!value && jsQrDecodeFrame) {
                    if (canvas.width !== width || canvas.height !== height) {
                      canvas.width = width;
                      canvas.height = height;
                    }
                    context.drawImage(video, 0, 0, width, height);
                    value = jsQrDecodeFrame(context, width, height);
                  }
                }
              }
            }

            if (value) {
              await submitScannedToken(value);
            }
          }

          timerRef.current = window.setTimeout(() => {
            void tick();
          }, 260);
        };

        void tick();
      } catch {
        setScannerMode("manual");
        setCameraError(t.cameraFailed);
        setCameraBooting(false);
      }
    };

    void bootScanner();
    return () => {
      mounted = false;
      stopScanner();
    };
  }, [
    cameraClosed,
    cameraFacingMode,
    cameraNonce,
    stopScanner,
    submitScannedToken,
    t.cameraFailed,
    t.fallbackLoadFailed,
  ]);

  useEffect(() => {
    void loadRecentCheckins();
  }, [loadRecentCheckins]);

  const decisionColor = result?.decision === "allow" ? "var(--brand)" : "#9b1c1c";
  const decisionClass = result?.decision === "allow" ? "fdEntryDecisionAllow" : "fdEntryDecisionDeny";
  const modeLabel =
    scannerMode === "detector"
      ? t.modeDetector
      : scannerMode === "zxing" || scannerMode === "jsqr"
        ? t.modeFallback
        : t.modeManual;
  const modeClass =
    scannerMode === "detector"
      ? "fdEntryModeDetector"
      : scannerMode === "zxing" || scannerMode === "jsqr"
        ? "fdEntryModeFallback"
        : "fdEntryModeManual";
  const noticeClass =
    notice?.tone === "ok" ? "fdEntryNoticeOk" : notice?.tone === "warn" ? "fdEntryNoticeWarn" : "fdEntryNoticeError";

  const workflowState: WorkflowState = useMemo(() => {
    if (busy || cameraBooting) return "scanning";
    if (result?.decision === "allow") return "success";
    if (result?.decision === "deny" || notice?.tone === "error") return "failed";
    return "idle";
  }, [busy, cameraBooting, notice?.tone, result?.decision]);

  const workflowStatusLabel =
    workflowState === "scanning"
      ? t.statusScanning
      : workflowState === "success"
        ? t.statusSuccess
        : workflowState === "failed"
          ? t.statusFailed
          : t.statusIdle;

  const cameraStatusText =
    cameraClosed
      ? t.cameraOff
      : cameraBooting
        ? t.cameraPreparing
        : scannerReady
          ? t.cameraReady
          : t.cameraFailed;

  const filteredRecentItems = useMemo(() => {
    const now = new Date();
    const q = recentQuery.trim().toLowerCase();
    return recentItems.filter((item) => {
      const checkedAt = item.checkedAt || "";
      if (recentRange === "today" && checkedAt && !isSameLocalDay(checkedAt, now)) return false;
      if (recentRange === "week" && checkedAt && !isWithinDays(checkedAt, 7, now)) return false;
      if (!q) return true;
      const haystack = [
        item.memberName,
        item.memberCode,
        item.phoneLast4 || "",
        item.method || "",
        item.result || "",
        item.reason || "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [recentItems, recentQuery, recentRange]);

  const manualPrimaryLabel = result?.decision === "allow" ? t.actionConfirmAllow : t.actionManualAllow;

  return (
    <main className={embedded ? "fdEmbedScene" : "fdGlassScene"} style={embedded ? { width: "100%", margin: 0, padding: 0 } : undefined}>
      <section
        className={`${embedded ? "fdEmbedBackdrop" : "fdGlassBackdrop"} fdEntryWfLayout`}
        style={embedded ? { minHeight: "auto", height: "auto", padding: 12 } : undefined}
      >
        <header className="fdGlassSubPanel fdEntryWfToolbar">
          <div className="fdEntryWfToolbarLeft">
            <h1 className="fdEntryWfTitle">{t.title}</h1>
          </div>
          <div className={`fdEntryWfStatusBadge fdEntryWfStatus-${workflowState}`}>{workflowStatusLabel}</div>
          <div className="fdEntryWfToolbarRight">
            <button
              type="button"
              className="fdPillBtn fdPillBtnGhost"
              onClick={toggleCameraFacing}
              disabled={busy || cameraBooting || cameraClosed}
            >
              {t.toolbarSwitchCamera}
            </button>
            <button
              type="button"
              className="fdPillBtn fdPillBtnGhost"
              onClick={toggleCameraPower}
              disabled={busy}
            >
              {cameraClosed ? t.toolbarOpen : t.toolbarClose}
            </button>
            <div className="fdEntryWfMoreWrap" ref={moreMenuRef}>
              <button
                type="button"
                className="fdPillBtn fdPillBtnGhost fdEntryWfMoreButton"
                onClick={() => setMoreMenuOpen((open) => !open)}
              >
                {t.toolbarMore}
              </button>
              {moreMenuOpen ? (
                <div className="fdEntryWfMoreMenu">
                  <button
                    type="button"
                    className="fdEntryWfMenuItem"
                    onClick={() => {
                      restartCamera();
                      setMoreMenuOpen(false);
                    }}
                    disabled={cameraBooting || busy || cameraClosed}
                  >
                    {t.moreRestart}
                  </button>
                  <button
                    type="button"
                    className="fdEntryWfMenuItem"
                    onClick={() => {
                      setManualAllowOpen(true);
                      setMoreMenuOpen(false);
                    }}
                  >
                    {t.moreManualAllow}
                  </button>
                  <button
                    type="button"
                    className="fdEntryWfMenuItem"
                    onClick={() => {
                      setResult(null);
                      setNotice(null);
                      setMoreMenuOpen(false);
                    }}
                    disabled={!result && !notice}
                  >
                    {t.moreClearResult}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {notice ? <div className={`fdEntryNotice ${noticeClass}`}>{notice.text}</div> : null}

        <section className="fdEntryWfMainGrid">
          <section className="fdGlassSubPanel fdEntryWfCameraCard">
            <div className="fdEntryWfCameraGuide">{t.cameraGuide}</div>
            <div className="fdEntryWfCameraStage">
              <video ref={videoRef} className="input fdEntryWfVideo" muted playsInline />
              <div className="fdEntryWfScanOverlay" aria-hidden>
                <div className="fdEntryWfScanFrame">
                  <span className="fdEntryWfCorner fdEntryWfCorner-tl" />
                  <span className="fdEntryWfCorner fdEntryWfCorner-tr" />
                  <span className="fdEntryWfCorner fdEntryWfCorner-bl" />
                  <span className="fdEntryWfCorner fdEntryWfCorner-br" />
                </div>
              </div>
            </div>
            <canvas ref={scanCanvasRef} className="fdEntryScanCanvas" aria-hidden />
            <div className="fdEntryWfCameraMeta">
              <span>{cameraStatusText}</span>
              <span className={`fdEntryModeChip ${modeClass}`}>{t.scannerModeLabel}: {modeLabel}</span>
            </div>
            {cameraError ? (
              <div className="fdEntryWfAlert fdEntryWfAlertWarn">
                <strong>{t.cameraFailed}</strong>
                <span>{cameraError}</span>
              </div>
            ) : (
              <p className="fdGlassText fdEntryWfCameraHint">{t.cameraPermissionHint}</p>
            )}
          </section>

          <aside className="fdEntryWfSideCol">
            <section className="fdGlassSubPanel fdEntryWfInfoCard">
              <h2 className="sectionTitle">{t.infoCardTitle}</h2>
              {!result ? (
                <div className="fdEntryWfInfoEmpty">
                  <p className="fdEntryWfInfoEmptyTitle">{t.infoWaitingTitle}</p>
                  <p className="fdGlassText">{t.infoWaitingDesc}</p>
                </div>
              ) : result.member ? (
                <div className="fdEntryWfMemberSummary">
                  <div className="fdEntryAvatar">
                    {result.member.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={result.member.photoUrl} alt={result.member.name || t.noPhoto} className="fdEntryAvatarImage" />
                    ) : (
                      <span className="fdEntryAvatarFallback">{memberInitials(result.member.name)}</span>
                    )}
                  </div>
                  <div className="fdEntryMemberBlock">
                    <h3 className="fdEntryMemberName">{result.member.name ?? "-"}</h3>
                    <p className="fdEntryMemberMeta">{t.phoneLast4}: {result.member.phoneLast4 ?? "-"}</p>
                    <p className="fdEntryMemberMeta">{t.membership}: {membershipLabel(result.membership, lang)}</p>
                    <div className="fdEntryResultMetaGrid">
                      <p className="sub">{t.lastCheckin}: {formatDateTime(result.latestCheckinAt)}</p>
                      <p className="sub">{t.todayCount}: {result.todayCheckinCount}</p>
                      <p className="sub">{t.checkedAt}: {formatDateTime(result.checkedAt)}</p>
                      <p className="sub">{t.reason}: {denyReasonLabel(result.reason, lang)}</p>
                    </div>
                    <p className="fdEntryGateStatus">
                      {t.gate}: {result.gate ? `${result.gate.opened ? t.gateOpen : t.gateClosed} (${result.gate.message})` : "-"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="fdEntryWfInfoEmpty">
                  <p className="fdEntryWfInfoEmptyTitle">{t.verifyDenied}</p>
                  <p className="fdGlassText">{t.reason}: {denyReasonLabel(result.reason, lang)}</p>
                </div>
              )}
            </section>

            <section className="fdGlassSubPanel fdEntryWfActionsCard">
              <h2 className="sectionTitle">{t.actionsTitle}</h2>
              <button
                type="button"
                className="fdPillBtn fdPillBtnPrimary fdEntryWfPrimaryAction"
                onClick={() => setManualAllowOpen(true)}
              >
                {manualPrimaryLabel}
              </button>
              <div className="fdEntryWfSecondaryActions">
                <button
                  type="button"
                  className="fdPillBtn fdPillBtnGhost"
                  onClick={restartCamera}
                  disabled={busy || cameraBooting || cameraClosed}
                >
                  {t.actionRestart}
                </button>
                <button
                  type="button"
                  className="fdPillBtn fdPillBtnGhost"
                  onClick={toggleCameraFacing}
                  disabled={busy || cameraBooting || cameraClosed}
                >
                  {t.actionSwitchCamera}
                </button>
              </div>
              <button
                type="button"
                className="fdPillBtn fdEntryWfDangerAction"
                onClick={toggleCameraPower}
                disabled={busy}
              >
                {cameraClosed ? t.actionOpenCamera : t.actionCloseCamera}
              </button>
              <form
                className="fdEntryWfTokenForm"
                onSubmit={(event) => {
                  event.preventDefault();
                  void callVerify(manualInput);
                }}
              >
                <label className="kvLabel" htmlFor="entry-manual-token">{t.manualTitle}</label>
                <input
                  id="entry-manual-token"
                  value={manualInput}
                  onChange={(event) => setManualInput(event.target.value)}
                  onPaste={handleManualPaste}
                  className="input"
                  placeholder={t.manualPlaceholder}
                />
                <div className="fdEntryWfTokenActions">
                  <button type="submit" disabled={busy || !manualInput.trim()} className="fdPillBtn fdPillBtnGhost">
                    {busy ? t.manualBusy : t.manualBtn}
                  </button>
                  <button
                    type="button"
                    className="fdPillBtn fdPillBtnGhost"
                    onClick={() => setManualInput("")}
                    disabled={busy || !manualInput}
                  >
                    {t.clearToken}
                  </button>
                </div>
              </form>
            </section>
          </aside>
        </section>

        {manualAllowOpen && portalReady
          ? createPortal(
              <div
                className="fdModalBackdrop fdModalBackdropFeature fdEntryManualAllowBackdrop"
                onClick={() => setManualAllowOpen(false)}
                role="presentation"
              >
                <div
                  className="fdModal fdModalLight fdEntryManualAllowModal"
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-label={t.manualAllowModalTitle}
                >
                  <div className="fdModalHead">
                    <h2 className="sectionTitle" style={{ margin: 0 }}>{t.manualAllowModalTitle}</h2>
                    <button
                      type="button"
                      className="fdPillBtn fdPillBtnGhost fdModalCloseBtn"
                      onClick={() => setManualAllowOpen(false)}
                    >
                      {t.closeModal}
                    </button>
                  </div>
                  <div className="fdEntryManualAllowModalBody">
                    <ManualAllowPanel onDone={() => { void loadRecentCheckins(); }} />
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}

        <section className="fdGlassSubPanel fdEntryWfRecentCard">
          <div className="fdEntryWfRecentHeader">
            <h2 className="sectionTitle">{t.recentTitle}</h2>
            <div className="fdEntryWfRecentTools">
              <input
                className="input fdEntryWfSearchInput"
                value={recentQuery}
                onChange={(event) => setRecentQuery(event.target.value)}
                placeholder={t.recentSearchPlaceholder}
              />
              <div className="fdEntryWfRangeSwitch">
                <button
                  type="button"
                  className={`fdEntryWfRangeBtn ${recentRange === "today" ? "active" : ""}`}
                  onClick={() => setRecentRange("today")}
                >
                  {t.recentFilterToday}
                </button>
                <button
                  type="button"
                  className={`fdEntryWfRangeBtn ${recentRange === "week" ? "active" : ""}`}
                  onClick={() => setRecentRange("week")}
                >
                  {t.recentFilterWeek}
                </button>
                <button
                  type="button"
                  className={`fdEntryWfRangeBtn ${recentRange === "all" ? "active" : ""}`}
                  onClick={() => setRecentRange("all")}
                >
                  {t.recentFilterAll}
                </button>
              </div>
              <button
                type="button"
                className="fdPillBtn"
                onClick={() => void loadRecentCheckins()}
                disabled={recentLoading || !!voidingId}
              >
                {t.recentReload}
              </button>
            </div>
          </div>

          {recentWarning ? <p className="fdGlassText" style={{ marginTop: 8, color: "var(--brand)" }}>{recentWarning}</p> : null}
          {recentError ? <p className="error" style={{ marginTop: 8 }}>{recentError}</p> : null}
          {recentLoading ? <p className="fdGlassText" style={{ marginTop: 8 }}>{t.recentLoading}</p> : null}
          {!recentLoading && filteredRecentItems.length === 0 ? <p className="fdGlassText" style={{ marginTop: 8 }}>{t.recentEmpty}</p> : null}

          {!recentLoading && filteredRecentItems.length > 0 ? (
            <div className="fdEntryWfRecentTableWrap">
              <table className="fdEntryWfRecentTable">
                <thead>
                  <tr>
                    <th>{t.recentColumnTime}</th>
                    <th>{t.recentColumnName}</th>
                    <th>{t.recentColumnStatus}</th>
                    <th>{t.recentColumnAction}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecentItems.map((item) => {
                    const code = (item.result || "").trim().toLowerCase();
                    const statusClass = code === "allow" ? "allow" : code === "deny" ? "deny" : "manual";
                    const memberLabel = item.memberCode
                      ? `${item.memberName || "-"} (#${item.memberCode})`
                      : (item.memberName || "-");
                    return (
                      <tr key={item.id}>
                        <td>{formatDateTime(item.checkedAt)}</td>
                        <td>{memberLabel}</td>
                        <td>
                          <span className={`fdEntryWfResultBadge ${statusClass}`}>
                            {recentResultLabel(item.result, lang)}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="fdPillBtn fdPillBtnGhost fdEntryWfViewBtn"
                            onClick={() => setRecentViewItem(item)}
                          >
                            {t.recentView}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <div className="fdEntryWfMobileBar">
          <button
            type="button"
            className="fdPillBtn fdPillBtnPrimary fdEntryWfMobilePrimary"
            onClick={() => setManualAllowOpen(true)}
          >
            {manualPrimaryLabel}
          </button>
        </div>

        {memberViewOpen && result && result.member && portalReady
          ? createPortal(
              <div
                className="fdModalBackdrop fdModalBackdropFeature fdEntryMemberViewBackdrop"
                onClick={() => setMemberViewOpen(false)}
                role="presentation"
              >
                <div
                  className="fdModal fdModalLight fdEntryMemberViewModal"
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-label={t.memberModalTitle}
                >
                  <div className="fdModalHead">
                    <h2 className="sectionTitle" style={{ margin: 0 }}>{t.memberModalTitle}</h2>
                    <button
                      type="button"
                      className="fdPillBtn fdPillBtnGhost fdModalCloseBtn"
                      onClick={() => setMemberViewOpen(false)}
                    >
                      {t.closeModal}
                    </button>
                  </div>
                  <section className="fdGlassSubPanel fdEntryResultPanelInline">
                    <div className="actions" style={{ marginTop: 0, justifyContent: "space-between", alignItems: "center" }}>
                      <h3 className="sectionTitle" style={{ margin: 0 }}>{t.resultTitle}</h3>
                      <strong className={`fdEntryDecisionTag ${decisionClass}`} style={{ color: decisionColor }}>
                        {decisionLabel(result.decision, lang)}
                      </strong>
                    </div>
                    <div className="fdEntryResultHero">
                      <div className="fdEntryAvatar">
                        {result.member.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={result.member.photoUrl} alt={result.member.name || t.noPhoto} className="fdEntryAvatarImage" />
                        ) : (
                          <span className="fdEntryAvatarFallback">{memberInitials(result.member.name)}</span>
                        )}
                      </div>
                      <div className="fdEntryMemberBlock">
                        <h3 className="fdEntryMemberName">{result.member.name ?? "-"}</h3>
                        <p className="fdEntryMemberMeta">{t.phoneLast4}: {result.member.phoneLast4 ?? "-"}</p>
                        <p className="fdEntryMemberMeta">{t.membership}: {membershipLabel(result.membership, lang)}</p>
                        <div className="fdEntryResultMetaGrid">
                          <p className="sub">{t.lastCheckin}: {formatDateTime(result.latestCheckinAt)}</p>
                          <p className="sub">{t.todayCount}: {result.todayCheckinCount}</p>
                          <p className="sub">{t.checkedAt}: {formatDateTime(result.checkedAt)}</p>
                          <p className="sub">{t.reason}: {denyReasonLabel(result.reason, lang)}</p>
                        </div>
                        <p className="fdEntryGateStatus">
                          {t.gate}: {result.gate ? `${result.gate.opened ? t.gateOpen : t.gateClosed} (${result.gate.message})` : "-"}
                        </p>
                      </div>
                    </div>
                  </section>
                </div>
              </div>,
              document.body,
            )
          : null}

        {recentViewItem && portalReady
          ? createPortal(
              <div
                className="fdModalBackdrop fdModalBackdropFeature fdEntryMemberViewBackdrop"
                onClick={() => setRecentViewItem(null)}
                role="presentation"
              >
                <div
                  className="fdModal fdModalLight fdEntryWfRecentModal"
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-label={t.recentDetailTitle}
                >
                  <div className="fdModalHead">
                    <h2 className="sectionTitle" style={{ margin: 0 }}>{t.recentDetailTitle}</h2>
                    <button
                      type="button"
                      className="fdPillBtn fdPillBtnGhost fdModalCloseBtn"
                      onClick={() => setRecentViewItem(null)}
                    >
                      {t.closeModal}
                    </button>
                  </div>
                  <section className="fdGlassSubPanel">
                    <div className="fdListStack" style={{ gap: 8 }}>
                      <p className="sub">{t.recentMember}: {recentViewItem.memberName || "-"}{recentViewItem.memberCode ? ` (#${recentViewItem.memberCode})` : ""}</p>
                      <p className="sub">{t.recentMethod}: {recentMethodLabel(recentViewItem.method, lang)}</p>
                      <p className="sub">{t.recentResult}: {recentResultLabel(recentViewItem.result, lang)}</p>
                      <p className="sub">{t.recentReason}: {recentReasonLabel(recentViewItem.reason, lang)}</p>
                      <p className="sub">{t.recentCheckedAt}: {formatDateTime(recentViewItem.checkedAt)}</p>
                    </div>
                    <div className="fdInventoryActions" style={{ marginTop: 12 }}>
                      <button
                        type="button"
                        className="fdPillBtn"
                        disabled={(recentViewItem.result || "").toLowerCase() !== "allow" || voidingId === recentViewItem.id}
                        onClick={() => void handleVoidCheckin(recentViewItem)}
                      >
                        {voidingId === recentViewItem.id ? t.recentVoidingAction : t.recentVoidAction}
                      </button>
                    </div>
                  </section>
                </div>
              </div>,
              document.body,
            )
          : null}
      </section>
    </main>
  );
}
