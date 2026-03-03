"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  const raw = typeof payload?.error === "string" ? payload.error : "";
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
    token_used: "Token already used. Ask member to refresh QR and scan again.",
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
    barcode: "掃碼",
    manual: "人工放行",
    token: "手動 token",
  };
  const enMap: Record<string, string> = {
    qr: "QR scan",
    barcode: "Barcode scan",
    manual: "Manual allow",
    token: "Manual token",
  };
  return lang === "zh" ? (zhMap[code] || method || "-") : (enMap[code] || method || "-");
}

function recentResultLabel(result: string | null | undefined, lang: "zh" | "en") {
  const code = (result || "").trim().toLowerCase();
  if (!code || code === "unknown") return "-";
  if (lang === "zh") {
    if (code === "allow") return "通過";
    if (code === "deny") return "拒絕";
    return result || "-";
  }
  if (code === "allow") return "Allow";
  if (code === "deny") return "Deny";
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

  const [scannerReady, setScannerReady] = useState(false);
  const [cameraBooting, setCameraBooting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [, setScannerMode] = useState<ScannerMode>("manual");
  const [cameraFacingMode, setCameraFacingMode] = useState<"environment" | "user">("environment");
  const [cameraClosed, setCameraClosed] = useState(false);
  const [cameraNonce, setCameraNonce] = useState(0);
  const [manualAllowOpen, setManualAllowOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyEntryResponse | null>(null);
  const [notice, setNotice] = useState<EntryNotice | null>(null);
  const [recentItems, setRecentItems] = useState<RecentCheckinItem[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentWarning, setRecentWarning] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const t = useMemo(
    () =>
      lang === "zh"
        ? {
            badge: "ENTRY SCAN",
            title: "櫃檯報到驗證",
            sub: "掃描會員動態 QR，或手動貼上 token 進行驗證。",
            cameraTitle: "鏡頭掃碼",
            manualTitle: "手動驗證",
            manualAllowQuickTitle: "人工放行",
            manualAllowQuickHint: "僅限例外情境使用，點擊按鈕開啟視窗填寫。",
            manualAllowOpenBtn: "開啟人工放行",
            manualAllowModalTitle: "人工放行",
            closeModal: "關閉",
            cameraReady: "鏡頭就緒",
            cameraPreparing: "正在初始化鏡頭...",
            browserNotSupport: "目前瀏覽器不支援 BarcodeDetector，已自動切換 jsQR 備援模式。",
            fallbackReady: "已使用 jsQR 備援掃碼，可正常驗證。",
            fallbackLoadFailed: "無法載入備援掃碼引擎，請改用手動 token 驗證。",
            cameraFailed: "無法啟用鏡頭，請確認權限與 HTTPS 環境。",
            cameraPermissionHint: "若畫面無法掃碼，請在瀏覽器網址列允許攝影機權限。",
            scannerModeLabel: "掃碼模式",
            modeDetector: "BarcodeDetector",
            modeFallback: "jsQR 備援",
            modeManual: "手動驗證",
            restartCamera: "重啟鏡頭",
            switchCamera: "切換前後鏡頭",
            manualPlaceholder: "貼上 token 後按 Enter",
            manualBtn: "驗證",
            manualBusy: "驗證中...",
            manualHint: "貼上完整 token 會自動驗證。",
            clearToken: "清空 token",
            resultTitle: "驗證結果",
            resultPending: "尚未驗證，請先掃碼或手動貼上 token。",
            clearResult: "清空結果",
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
            verifyNetworkFailed: "驗證失敗，請檢查網路或稍後再試。",
            recentTitle: "最近入場紀錄",
            recentReload: "重新整理",
            recentLoading: "載入中...",
            recentEmpty: "目前沒有入場紀錄。",
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
            badge: "ENTRY SCAN",
            title: "Frontdesk Entry Verification",
            sub: "Scan member dynamic QR or paste token manually for verification.",
            cameraTitle: "Camera Scanner",
            manualTitle: "Manual Verify",
            manualAllowQuickTitle: "Manual Allow",
            manualAllowQuickHint: "Use for exceptions only. Click the button to open the manual-allow dialog.",
            manualAllowOpenBtn: "Open Manual Allow",
            manualAllowModalTitle: "Manual Allow",
            closeModal: "Close",
            cameraReady: "Camera ready",
            cameraPreparing: "Initializing camera...",
            browserNotSupport: "BarcodeDetector is not supported. Switched to jsQR fallback mode.",
            fallbackReady: "jsQR fallback scanner is active.",
            fallbackLoadFailed: "Failed to load fallback scanner. Use manual token verification.",
            cameraFailed: "Cannot access camera. Check permission and HTTPS or localhost.",
            cameraPermissionHint: "If scanner stays black, allow camera permission from browser site settings.",
            scannerModeLabel: "Scanner Mode",
            modeDetector: "BarcodeDetector",
            modeFallback: "jsQR fallback",
            modeManual: "Manual only",
            restartCamera: "Restart Camera",
            switchCamera: "Switch Camera",
            manualPlaceholder: "Paste token and press Enter",
            manualBtn: "Verify",
            manualBusy: "Verifying...",
            manualHint: "Pasting a complete token will auto verify.",
            clearToken: "Clear token",
            resultTitle: "Verification Result",
            resultPending: "No verification yet. Scan QR or paste token first.",
            clearResult: "Clear result",
            memberName: "Name",
            phoneLast4: "Phone Last 4",
            membership: "Membership",
            lastCheckin: "Latest Check-in",
            todayCount: "Today Count",
            checkedAt: "Checked At",
            reason: "Reason",
            gate: "Gate",
            noPhoto: "No photo",
            gateOpen: "Opened",
            gateClosed: "Not opened",
            verifyAllowed: "Verification passed. Member can enter.",
            verifyDenied: "Verification denied",
            verifyNetworkFailed: "Verification failed. Check network and retry.",
            recentTitle: "Recent Entry Logs",
            recentReload: "Reload",
            recentLoading: "Loading...",
            recentEmpty: "No recent entry records.",
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
        // Keep deny details only in the result card to avoid duplicate top warnings.
        setNotice(null);
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
    }
  }, [lang, loadRecentCheckins, t.verifyAllowed, t.verifyNetworkFailed]);

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

  const toggleCameraPower = useCallback(() => {
    setCameraClosed((current) => {
      const next = !current;
      if (next) {
        stopScanner();
        setCameraError(null);
        setCameraBooting(false);
        setScannerReady(false);
      } else {
        setCameraNonce((value) => value + 1);
      }
      return next;
    });
  }, [stopScanner]);

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
  const noticeClass =
    notice?.tone === "ok" ? "fdEntryNoticeOk" : notice?.tone === "warn" ? "fdEntryNoticeWarn" : "fdEntryNoticeError";

  return (
    <main className={embedded ? "fdEmbedScene" : "fdGlassScene"} style={embedded ? { width: "100%", margin: 0, padding: 0 } : undefined}>
      <section
        className={`${embedded ? "fdEmbedBackdrop" : "fdGlassBackdrop"} fdEntryLayout`}
        style={embedded ? { minHeight: "auto", height: "auto", padding: 12 } : undefined}
      >
        {!embedded ? (
          <section className="hero" style={{ paddingTop: 0 }}>
            <div className="fdGlassPanel">
              <div className="fdEyebrow">{t.badge}</div>
              <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
                {t.title}
              </h1>
              <p className="fdGlassText">{t.sub}</p>
            </div>
          </section>
        ) : (
          <div className="fdGlassSubPanel fdEntryIntroPanel" style={{ padding: 12, marginBottom: 12 }}>
            <h2 className="sectionTitle" style={{ marginBottom: 2 }}>{t.title}</h2>
            <p className="fdGlassText" style={{ marginTop: 0 }}>{t.sub}</p>
          </div>
        )}

        {notice ? <div className={`fdEntryNotice ${noticeClass}`}>{notice.text}</div> : null}

        <section className="fdTwoCol fdEntryTopGrid">
          <div className="fdGlassSubPanel fdEntryScannerPanel">
            <div className="fdEntryScannerHead">
              <h2 className="sectionTitle">{t.cameraTitle}</h2>
            </div>
            <video ref={videoRef} className="input fdEntryScannerVideo" muted playsInline />
            <canvas ref={scanCanvasRef} className="fdEntryScanCanvas" aria-hidden />
            <p className="fdGlassText fdEntryScannerState">
              {cameraClosed
                ? lang === "zh"
                  ? "鏡頭已關閉"
                  : "Camera is turned off"
                : cameraBooting
                  ? t.cameraPreparing
                  : scannerReady
                    ? t.cameraReady
                    : t.cameraFailed}
            </p>
            <p className="fdGlassText fdEntryScannerHint">{t.cameraPermissionHint}</p>
            {cameraError ? <p className="error" style={{ marginTop: 8 }}>{cameraError}</p> : null}
            <div className="fdEntryScannerActions">
              <button type="button" className="fdPillBtn" onClick={restartCamera} disabled={cameraBooting || busy || cameraClosed}>
                {t.restartCamera}
              </button>
              <button type="button" className="fdPillBtn fdPillBtnGhost" onClick={toggleCameraPower} disabled={busy}>
                {cameraClosed ? (lang === "zh" ? "開啟鏡頭" : "Open Camera") : (lang === "zh" ? "關閉鏡頭" : "Close Camera")}
              </button>
              <button type="button" className="fdPillBtn fdPillBtnGhost" onClick={toggleCameraFacing} disabled={cameraBooting || busy || cameraClosed}>
                {t.switchCamera}
              </button>
            </div>
          </div>

          <div className="fdEntrySideCol">
            <section className="fdGlassSubPanel fdEntryResultPanelInline fdEntryResultPanelSide">
              <div className="actions" style={{ marginTop: 0, justifyContent: "space-between", alignItems: "center" }}>
                <h2 className="sectionTitle" style={{ margin: 0 }}>{t.resultTitle}</h2>
                <div className="fdEntryResultHeadActions">
                  {result ? <strong className={`fdEntryDecisionTag ${decisionClass}`} style={{ color: decisionColor }}>{decisionLabel(result.decision, lang)}</strong> : null}
                  <button
                    type="button"
                    className="fdPillBtn fdPillBtnGhost"
                    onClick={() => {
                      setResult(null);
                      setNotice(null);
                    }}
                    disabled={!result}
                  >
                    {t.clearResult}
                  </button>
                </div>
              </div>

              {result ? (
                <div className="fdEntryResultHero">
                  <div className="fdEntryAvatar">
                    {result.member?.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={result.member.photoUrl} alt={result.member?.name || t.noPhoto} className="fdEntryAvatarImage" />
                    ) : (
                      <span className="fdEntryAvatarFallback">{memberInitials(result.member?.name)}</span>
                    )}
                  </div>
                  <div className="fdEntryMemberBlock">
                    <h3 className="fdEntryMemberName">{result.member?.name ?? "-"}</h3>
                    <p className="fdEntryMemberMeta">{t.phoneLast4}: {result.member?.phoneLast4 ?? "-"}</p>
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
                <p className="fdGlassText" style={{ marginTop: 8 }}>{t.resultPending}</p>
              )}
            </section>
          </div>
        </section>

        <section className="fdGlassSubPanel fdEntryManualAllowTrigger" style={{ marginTop: 14 }}>
          <div className="actions fdEntryManualAllowHead" style={{ marginTop: 0, justifyContent: "space-between", alignItems: "center" }}>
            <div className="fdEntryManualAllowInfo">
              <h2 className="sectionTitle" style={{ margin: 0 }}>{t.manualAllowQuickTitle}</h2>
              <p className="fdGlassText" style={{ marginTop: 0, fontSize: 12 }}>{t.manualAllowQuickHint}</p>
            </div>
            <button
              type="button"
              className="fdPillBtn fdPillBtnPrimary fdEntryManualAllowOpenBtn"
              onClick={() => setManualAllowOpen(true)}
            >
              {t.manualAllowOpenBtn}
            </button>
          </div>
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

        <section className="fdGlassSubPanel fdEntryRecentPanel" style={{ marginTop: 14 }}>
          <div className="actions" style={{ marginTop: 0, justifyContent: "space-between", alignItems: "center" }}>
            <h2 className="sectionTitle" style={{ margin: 0 }}>{t.recentTitle}</h2>
            <button
              type="button"
              className="fdPillBtn"
              onClick={() => void loadRecentCheckins()}
              disabled={recentLoading || !!voidingId}
            >
              {t.recentReload}
            </button>
          </div>
          {recentWarning ? <p className="fdGlassText" style={{ marginTop: 8, color: "var(--brand)" }}>{recentWarning}</p> : null}
          {recentError ? <p className="error" style={{ marginTop: 8 }}>{recentError}</p> : null}
          {recentLoading ? <p className="fdGlassText" style={{ marginTop: 8 }}>{t.recentLoading}</p> : null}
          {!recentLoading && recentItems.length === 0 ? <p className="fdGlassText" style={{ marginTop: 8 }}>{t.recentEmpty}</p> : null}
          <div className="fdListStack" style={{ marginTop: 8 }}>
            {recentItems.map((item) => {
              const memberLabel = item.memberCode ? `${item.memberName || "-"} (#${item.memberCode})` : (item.memberName || "-");
              const canVoid = item.result.toLowerCase() === "allow";
              const methodText = recentMethodLabel(item.method, lang);
              const resultText = recentResultLabel(item.result, lang);
              const reasonText = recentReasonLabel(item.reason, lang);
              return (
                <div key={item.id} className="card fdEntryRecentItem" style={{ padding: 10 }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <p className="sub" style={{ marginTop: 0 }}>{t.recentMember}: {memberLabel}</p>
                    <p className="sub" style={{ marginTop: 0 }}>{t.recentMethod}: {methodText}</p>
                    <p className="sub" style={{ marginTop: 0 }}>{t.recentResult}: {resultText}</p>
                    <p className="sub" style={{ marginTop: 0 }}>{t.recentReason}: {reasonText}</p>
                    <p className="sub" style={{ marginTop: 0 }}>{t.recentCheckedAt}: {formatDateTime(item.checkedAt)}</p>
                  </div>
                  <div className="fdInventoryActions" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="fdPillBtn"
                      disabled={!canVoid || voidingId === item.id}
                      onClick={() => void handleVoidCheckin(item)}
                    >
                      {voidingId === item.id ? t.recentVoidingAction : t.recentVoidAction}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
