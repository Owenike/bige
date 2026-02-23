"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function parseEntryError(payload: any, lang: "zh" | "en") {
  const raw = typeof payload?.error === "string" ? payload.error : "";
  if (!raw) return lang === "zh" ? "\u8acb\u6c42\u5931\u6557" : "Request failed";
  if (raw === "reason is required") return lang === "zh" ? "\u8acb\u8f38\u5165\u53d6\u6d88\u539f\u56e0" : "Reason is required";
  if (raw === "Only allow records can be canceled") return lang === "zh" ? "\u53ea\u80fd\u53d6\u6d88\u300c\u653e\u884c\u300d\u8a18\u9304" : raw;
  return raw;
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
            resultPending: "\u5c1a\u672a\u9a57\u8b49\uff0c\u8acb\u5148\u6383\u78bc\u6216\u624b\u52d5\u8cbc\u4e0a token\u3002",
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
             recentTitle: "\u6700\u8fd1\u5165\u5834\u7d00\u9304",
             recentReload: "\u91cd\u65b0\u6574\u7406",
             recentLoading: "\u8f09\u5165\u4e2d...",
             recentEmpty: "\u76ee\u524d\u6c92\u6709\u5165\u5834\u7d00\u9304\u3002",
             recentMember: "\u6703\u54e1",
             recentMethod: "\u65b9\u5f0f",
             recentResult: "\u7d50\u679c",
             recentReason: "\u539f\u56e0",
             recentCheckedAt: "\u6642\u9593",
             recentVoidAction: "\u53d6\u6d88\u8aa4\u5237",
             recentVoidingAction: "\u53d6\u6d88\u4e2d...",
             recentVoidPrompt: "\u8acb\u8f38\u5165\u53d6\u6d88\u8aa4\u5237\u539f\u56e0",
             recentVoidSuccess: "\u8aa4\u5237\u8a18\u9304\u5df2\u53d6\u6d88\u3002",
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
            resultPending: "No verification yet. Scan QR or paste token first.",
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

  const loadRecentCheckins = useCallback(async () => {
    setRecentLoading(true);
    setRecentError(null);
    try {
      const response = await fetch(`/api/frontdesk/checkins?limit=${embedded ? 12 : 24}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(parseEntryError(payload, lang));
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
      if (payload.decision === "allow") {
        void loadRecentCheckins();
      }
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
  }, [loadRecentCheckins]);

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
      if (!response.ok) throw new Error(parseEntryError(payload, lang));
      setRecentWarning(typeof payload.warning === "string" ? payload.warning : t.recentVoidSuccess);
      await loadRecentCheckins();
    } catch (error) {
      setRecentError(error instanceof Error ? error.message : parseEntryError({}, lang));
    } finally {
      setVoidingId(null);
    }
  }, [lang, loadRecentCheckins, t.recentVoidPrompt, t.recentVoidSuccess]);

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

  useEffect(() => {
    void loadRecentCheckins();
  }, [loadRecentCheckins]);

  const decisionColor = result?.decision === "allow" ? "var(--brand)" : "#9b1c1c";

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

        <section className="fdTwoCol fdEntryTopGrid" style={{ alignItems: "start" }}>
          <div className="fdGlassSubPanel fdEntryScannerPanel">
            <h2 className="sectionTitle">{t.cameraTitle}</h2>
            <video ref={videoRef} className="input fdEntryScannerVideo" muted playsInline />
            <p className="fdGlassText fdEntryScannerState">
              {scannerReady ? t.cameraReady : t.cameraPreparing}
            </p>
            {cameraError ? <p className="error" style={{ marginTop: 8 }}>{cameraError}</p> : null}
          </div>

          <div className="fdEntrySideCol" style={{ alignSelf: "start" }}>
            <div className="fdEntryManualCard">
              <h2 className="sectionTitle">{t.manualTitle}</h2>
              <form
                className="field fdEntryManualForm"
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

            <div className="fdGlassSubPanel fdEntryResultPanelInline">
              <div className="actions" style={{ marginTop: 0, justifyContent: "space-between", alignItems: "center" }}>
                <h2 className="sectionTitle" style={{ margin: 0 }}>{t.resultTitle}</h2>
                {result ? <strong style={{ color: decisionColor }}>{decisionLabel(result.decision, lang)}</strong> : null}
              </div>
              {result ? (
                <div className="fdDataGrid" style={{ marginTop: 10 }}>
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
              ) : (
                <p className="fdGlassText" style={{ marginTop: 8 }}>{t.resultPending}</p>
              )}
            </div>
          </div>
        </section>

        <ManualAllowPanel onDone={() => { void loadRecentCheckins(); }} />

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
              const memberLabel = item.memberCode
                ? `${item.memberName || "-"} (#${item.memberCode})`
                : (item.memberName || "-");
              const canVoid = item.result.toLowerCase() === "allow";
              return (
                <div key={item.id} className="card fdEntryRecentItem" style={{ padding: 10 }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <p className="sub" style={{ marginTop: 0 }}>{t.recentMember}: {memberLabel}</p>
                    <p className="sub" style={{ marginTop: 0 }}>{t.recentMethod}: {item.method || "-"}</p>
                    <p className="sub" style={{ marginTop: 0 }}>{t.recentResult}: {item.result || "-"}</p>
                    <p className="sub" style={{ marginTop: 0 }}>{t.recentReason}: {item.reason || "-"}</p>
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
