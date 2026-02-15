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
      return `\u6708\u8cbb\u6703\u54e1 (\u5230\u671f: ${formatDateTime(input.monthlyExpiresAt)})`;
    case "single":
      return `\u55ae\u5802\u65b9\u6848 (\u5269\u9918: ${input.remainingSessions ?? 0})`;
    case "punch":
      return `\u9ede\u6578\u65b9\u6848 (\u5269\u9918: ${input.remainingSessions ?? 0})`;
    default:
      return "\u7121\u6709\u6548\u6703\u7c4d";
  }
}

function denyReasonLabel(reason: VerifyEntryResponse["reason"], lang: "zh" | "en") {
  if (!reason) return "-";
  const zh: Record<NonNullable<VerifyEntryResponse["reason"]>, string> = {
    token_invalid: "QR \u7121\u6548",
    token_expired: "QR \u5df2\u904e\u671f",
    token_used: "QR \u5df2\u4f7f\u7528",
    rate_limited: "\u64cd\u4f5c\u904e\u65bc\u983b\u7e41",
    member_not_found: "\u627e\u4e0d\u5230\u6703\u54e1",
    already_checked_in_recently: "\u8fd1\u671f\u5df2\u5831\u5230",
    no_valid_pass: "\u7121\u53ef\u7528\u6703\u7c4d/\u5802\u6578",
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
  return decision === "allow" ? "\u653e\u884c" : "\u62d2\u7d55";
}

export function FrontdeskCheckinView({ embedded = false }: { embedded?: boolean }) {
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
            title: "\u6ac3\u6aaf\u5831\u5230\u9a57\u8b49",
            sub: "\u6383\u63cf\u6703\u54e1\u52d5\u614b QR\uff0c\u6216\u624b\u52d5\u8cbc\u4e0a token \u9032\u884c\u9a57\u8b49\u3002",
            cameraTitle: "\u93e1\u982d\u6383\u78bc",
            manualTitle: "\u624b\u52d5\u9a57\u8b49",
            cameraReady: "\u93e1\u982d\u5c31\u7dd2",
            cameraPreparing: "\u6b63\u5728\u521d\u59cb\u5316\u93e1\u982d...",
            browserNotSupport: "\u76ee\u524d\u700f\u89bd\u5668\u4e0d\u652f\u63f4 BarcodeDetector\uff0c\u8acb\u6539\u7528\u624b\u52d5 token \u9a57\u8b49\u3002",
            cameraFailed: "\u7121\u6cd5\u555f\u7528\u93e1\u982d\uff0c\u8acb\u78ba\u8a8d\u6b0a\u9650\u8207 HTTPS \u74b0\u5883\u3002",
            manualPlaceholder: "\u8cbc\u4e0a token \u5f8c\u6309 Enter",
            manualBtn: "\u9a57\u8b49",
            manualBusy: "\u9a57\u8b49\u4e2d...",
            resultTitle: "\u9a57\u8b49\u7d50\u679c",
            memberName: "\u59d3\u540d",
            phoneLast4: "\u96fb\u8a71\u672b\u56db\u78bc",
            membership: "\u6703\u7c4d",
            lastCheckin: "\u6700\u8fd1\u5831\u5230",
            todayCount: "\u4eca\u65e5\u5831\u5230\u6b21\u6578",
            checkedAt: "\u9a57\u8b49\u6642\u9593",
            reason: "\u539f\u56e0",
            gate: "\u9598\u9580",
            noPhoto: "\u7121\u7167\u7247",
            gateOpen: "\u5df2\u958b\u9580",
            gateClosed: "\u672a\u958b\u9580",
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
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
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
    <main className={embedded ? "fdEmbedScene" : "fdGlassScene"} style={embedded ? { width: "100%", margin: 0, padding: 0 } : undefined}>
      <section
        className={embedded ? "fdEmbedBackdrop" : "fdGlassBackdrop"}
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
          <div className="fdGlassSubPanel" style={{ padding: 12, marginBottom: 12 }}>
            <h2 className="sectionTitle" style={{ marginBottom: 2 }}>{t.title}</h2>
            <p className="fdGlassText" style={{ marginTop: 0 }}>{t.sub}</p>
          </div>
        )}

        <section className="fdTwoCol">
          <div className="fdGlassSubPanel">
            <h2 className="sectionTitle">{t.cameraTitle}</h2>
            <video ref={videoRef} className="input" style={{ marginTop: 8, minHeight: 260, background: "#111", borderColor: "rgba(255,255,255,.25)" }} muted playsInline />
            <p className="fdGlassText" style={{ marginTop: 8 }}>
              {scannerReady ? t.cameraReady : t.cameraPreparing}
            </p>
            {cameraError ? <p className="error" style={{ marginTop: 8 }}>{cameraError}</p> : null}
          </div>

          <div className="fdGlassSubPanel">
            <h2 className="sectionTitle">{t.manualTitle}</h2>
            <form
              className="field"
              onSubmit={(event) => {
                event.preventDefault();
                void callVerify(manualInput);
              }}
            >
              <input value={manualInput} onChange={(event) => setManualInput(event.target.value)} className="input" placeholder={t.manualPlaceholder} autoFocus />
              <button type="submit" disabled={busy || !manualInput.trim()} className="fdPillBtn fdPillBtnPrimary">
                {busy ? t.manualBusy : t.manualBtn}
              </button>
            </form>
          </div>
        </section>

        <ManualAllowPanel />

      {result ? (
        <section className="fdGlassSubPanel" style={{ marginTop: 14 }}>
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
            <div className="fdDataGrid">
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
      </section>
    </main>
  );
}
