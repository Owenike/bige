"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n-provider";
import type { VerifyEntryResponse } from "../../../types/entry";
import { ManualAllowPanel } from "./ManualAllowPanel";

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
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
    rate_limited: "操作過於頻繁，請稍後再試",
    member_not_found: "找不到會員",
    already_checked_in_recently: "近期已完成報到",
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

export default function FrontdeskCheckinPage() {
  const { locale } = useI18n();
  const lang: "zh" | "en" = locale === "en" ? "en" : "zh";

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);

  const [scannerReady, setScannerReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyEntryResponse | null>(null);

  const t = useMemo(
    () =>
      lang === "zh"
        ? {
            badge: "ENTRY SCAN",
            title: "櫃檯報到驗證",
            sub: "掃描會員動態 QR，或手動貼上 token 進行驗證。",
            cameraTitle: "鏡頭掃碼",
            manualTitle: "手動驗證",
            cameraReady: "鏡頭已就緒",
            cameraPreparing: "正在初始化鏡頭...",
            browserNotSupport: "目前瀏覽器不支援 BarcodeDetector，請改用手動貼 token 或使用新版 Chrome/Edge。",
            cameraFailed: "無法啟用鏡頭。請確認權限、HTTPS 或 localhost 環境。",
            manualPlaceholder: "貼上 token 後按 Enter",
            manualBtn: "驗證",
            manualBusy: "驗證中...",
            resultTitle: "驗證結果",
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
          }
        : {
            badge: "ENTRY SCAN",
            title: "Frontdesk Entry Verification",
            sub: "Scan member dynamic QR or paste token manually for verification.",
            cameraTitle: "Camera Scanner",
            manualTitle: "Manual Verify",
            cameraReady: "Camera ready",
            cameraPreparing: "Initializing camera...",
            browserNotSupport: "BarcodeDetector is not supported here. Use manual token input or latest Chrome/Edge.",
            cameraFailed: "Cannot access camera. Check permission and HTTPS or localhost.",
            manualPlaceholder: "Paste token and press Enter",
            manualBtn: "Verify",
            manualBusy: "Verifying...",
            resultTitle: "Verification Result",
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
          },
    [lang],
  );

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const callVerify = useCallback(async (token: string) => {
    const trimmed = token.trim();
    if (!trimmed || busyRef.current) return;

    busyRef.current = true;
    setBusy(true);

    try {
      const response = await fetch("/api/entry/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: trimmed }),
      });

      const payload = (await response.json()) as VerifyEntryResponse;
      setResult(payload);
    } catch {
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
    } finally {
      busyRef.current = false;
      setBusy(false);
      setManualInput("");
    }
  }, []);

  const canUseBarcodeDetector = useMemo(() => typeof window !== "undefined" && "BarcodeDetector" in window, []);

  useEffect(() => {
    let mounted = true;

    async function startCameraScanner() {
      if (!canUseBarcodeDetector) {
        setCameraError(t.browserNotSupport);
        return;
      }

      try {
        const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });

        streamRef.current = stream;
        if (!videoRef.current) return;

        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setScannerReady(true);

        const tick = async () => {
          if (!mounted || !videoRef.current) return;
          if (!busyRef.current) {
            const codes = await detector.detect(videoRef.current);
            const value = codes?.[0]?.rawValue;
            if (value) await callVerify(value);
          }
          timerRef.current = window.setTimeout(() => {
            void tick();
          }, 500);
        };

        void tick();
      } catch {
        setCameraError(t.cameraFailed);
      }
    }

    void startCameraScanner();
    return () => {
      mounted = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    };
  }, [callVerify, canUseBarcodeDetector, t.browserNotSupport, t.cameraFailed]);

  const decisionColor = result?.decision === "allow" ? "var(--brand)" : "#9b1c1c";

  return (
    <main className="container">
      <section className="hero">
        <div className="card kv" style={{ padding: 18 }}>
          <div className="kvLabel">{t.badge}</div>
          <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
            {t.title}
          </h1>
          <p className="sub">{t.sub}</p>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card kv" style={{ padding: 14 }}>
          <h2 className="sectionTitle">{t.cameraTitle}</h2>
          <video ref={videoRef} className="input" style={{ marginTop: 8, minHeight: 260, background: "#111" }} muted playsInline />
          <p className="sub" style={{ marginTop: 8 }}>
            {scannerReady ? t.cameraReady : t.cameraPreparing}
          </p>
          {cameraError ? <p className="error" style={{ marginTop: 8 }}>{cameraError}</p> : null}
        </div>

        <div className="card kv" style={{ padding: 14 }}>
          <h2 className="sectionTitle">{t.manualTitle}</h2>
          <form
            className="field"
            onSubmit={(event) => {
              event.preventDefault();
              void callVerify(manualInput);
            }}
          >
            <input
              value={manualInput}
              onChange={(event) => setManualInput(event.target.value)}
              className="input"
              placeholder={t.manualPlaceholder}
              autoFocus
            />
            <button type="submit" disabled={busy || !manualInput.trim()} className="btn btnPrimary">
              {busy ? t.manualBusy : t.manualBtn}
            </button>
          </form>
        </div>
      </section>

      <ManualAllowPanel />

      {result ? (
        <section className="card kv" style={{ marginTop: 14, padding: 14 }}>
          <div className="actions" style={{ marginTop: 0, justifyContent: "space-between", alignItems: "center" }}>
            <h2 className="sectionTitle" style={{ margin: 0 }}>
              {t.resultTitle}
            </h2>
            <strong style={{ color: decisionColor }}>{decisionLabel(result.decision, lang)}</strong>
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 14, gridTemplateColumns: "112px 1fr" }}>
            <div>
              {result.member?.photoUrl ? (
                <Image
                  className="card"
                  style={{ width: 112, height: 112, objectFit: "cover" }}
                  src={result.member.photoUrl}
                  alt={`${result.member.name} photo`}
                  width={112}
                  height={112}
                  unoptimized
                />
              ) : (
                <div className="card" style={{ width: 112, height: 112, display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 12 }}>
                  {t.noPhoto}
                </div>
              )}
            </div>

            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <p className="sub">
                {t.memberName}: {result.member?.name ?? "-"}
              </p>
              <p className="sub">
                {t.phoneLast4}: {result.member?.phoneLast4 ?? "-"}
              </p>
              <p className="sub">
                {t.membership}: {membershipLabel(result.membership, lang)}
              </p>
              <p className="sub">
                {t.lastCheckin}: {formatDateTime(result.latestCheckinAt)}
              </p>
              <p className="sub">
                {t.todayCount}: {result.todayCheckinCount}
              </p>
              <p className="sub">
                {t.checkedAt}: {formatDateTime(result.checkedAt)}
              </p>
              <p className="sub">
                {t.reason}: {denyReasonLabel(result.reason, lang)}
              </p>
              <p className="sub">
                {t.gate}: {result.gate ? `${result.gate.opened ? t.gateOpen : t.gateClosed} (${result.gate.message})` : "-"}
              </p>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
