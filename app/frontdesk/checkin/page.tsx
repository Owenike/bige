"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VerifyEntryResponse } from "../../../types/entry";
import { ManualAllowPanel } from "./ManualAllowPanel";

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function membershipLabel(input: VerifyEntryResponse["membership"]) {
  switch (input.kind) {
    case "monthly":
      return `月費 (到期: ${formatDateTime(input.monthlyExpiresAt)})`;
    case "single":
      return `單次票 (剩餘: ${input.remainingSessions ?? 0})`;
    case "punch":
      return `次數票 (剩餘: ${input.remainingSessions ?? 0})`;
    default:
      return "無有效方案";
  }
}

function denyReasonLabel(reason: VerifyEntryResponse["reason"]) {
  switch (reason) {
    case "token_invalid":
      return "QR 無效";
    case "token_expired":
      return "QR 已過期";
    case "token_used":
      return "QR 已使用";
    case "rate_limited":
      return "請稍後再試 (掃碼過於頻繁)";
    case "member_not_found":
      return "找不到會員";
    case "already_checked_in_recently":
      return "短時間內已入場 (防回刷)";
    case "no_valid_pass":
      return "無有效票券或會籍";
    default:
      return "-";
  }
}

function decisionLabel(decision: VerifyEntryResponse["decision"]) {
  return decision === "allow" ? "放行" : "拒絕";
}

export default function FrontdeskCheckinPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);

  const [scannerReady, setScannerReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyEntryResponse | null>(null);

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
        membership: {
          kind: "none",
          monthlyExpiresAt: null,
          remainingSessions: null,
        },
        latestCheckinAt: null,
        todayCheckinCount: 0,
        checkedAt: new Date().toISOString(),
        gate: {
          attempted: false,
          opened: false,
          message: "Verify request failed",
        },
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
      setManualInput("");
    }
  }, []);

  const canUseBarcodeDetector = useMemo(
    () => typeof window !== "undefined" && "BarcodeDetector" in window,
    [],
  );

  useEffect(() => {
    let mounted = true;

    async function startCameraScanner() {
      if (!canUseBarcodeDetector) {
        setCameraError("此瀏覽器不支援 BarcodeDetector。請改用手動輸入 token，或使用 Chrome/Edge。");
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
            if (value) {
              await callVerify(value);
            }
          }

          timerRef.current = window.setTimeout(() => {
            void tick();
          }, 500);
        };

        void tick();
      } catch {
        setCameraError("無法啟用相機掃碼。請確認已允許相機權限，且使用 HTTPS 或 localhost。");
      }
    }

    void startCameraScanner();

    return () => {
      mounted = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    };
  }, [callVerify, canUseBarcodeDetector]);

  const decisionColor = result?.decision === "allow" ? "text-green-700" : "text-red-700";

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-bold">櫃台掃碼入場</h1>
      <p className="mt-2 text-sm text-gray-600">
        掃會員動態 QR，或貼上 token 手動驗證。驗證會呼叫 <code>/api/entry/verify</code>。
      </p>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h2 className="font-semibold">相機掃碼</h2>
          <video ref={videoRef} className="mt-3 aspect-video w-full rounded bg-black" muted playsInline />
          <p className="mt-2 text-sm text-gray-600">{scannerReady ? "相機已啟用" : "相機初始化中..."}</p>
          {cameraError ? <p className="mt-2 text-sm text-red-600">{cameraError}</p> : null}
        </div>

        <div className="rounded-lg border p-4">
          <h2 className="font-semibold">手動驗證</h2>
          <form
            className="mt-3 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void callVerify(manualInput);
            }}
          >
            <input
              value={manualInput}
              onChange={(event) => setManualInput(event.target.value)}
              className="w-full rounded border px-3 py-2 font-mono text-sm"
              placeholder="貼上 token 後按 Enter"
              autoFocus
            />
            <button
              type="submit"
              disabled={busy || !manualInput.trim()}
              className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
            >
              {busy ? "驗證中..." : "驗證"}
            </button>
          </form>
        </div>
      </section>

      <ManualAllowPanel />

      {result ? (
        <section className="mt-6 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">驗證結果</h2>
            <span className={`font-semibold ${decisionColor}`}>{decisionLabel(result.decision)}</span>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[120px_1fr]">
            <div>
              {result.member?.photoUrl ? (
                <Image
                  className="h-28 w-28 rounded object-cover"
                  src={result.member.photoUrl}
                  alt={`${result.member.name} photo`}
                  width={112}
                  height={112}
                  unoptimized
                />
              ) : (
                <div className="flex h-28 w-28 items-center justify-center rounded border bg-gray-50 text-xs text-gray-500">
                  No photo
                </div>
              )}
            </div>

            <div className="grid gap-2 text-sm">
              <p>
                <span className="text-gray-600">姓名:</span> {result.member?.name ?? "-"}
              </p>
              <p>
                <span className="text-gray-600">電話後四碼:</span> {result.member?.phoneLast4 ?? "-"}
              </p>
              <p>
                <span className="text-gray-600">方案:</span> {membershipLabel(result.membership)}
              </p>
              <p>
                <span className="text-gray-600">最近入場:</span> {formatDateTime(result.latestCheckinAt)}
              </p>
              <p>
                <span className="text-gray-600">今日入場次數:</span> {result.todayCheckinCount}
              </p>
              <p>
                <span className="text-gray-600">本次驗證時間:</span> {formatDateTime(result.checkedAt)}
              </p>
              <p>
                <span className="text-gray-600">原因:</span> {denyReasonLabel(result.reason)}
              </p>
              <p>
                <span className="text-gray-600">閘門:</span>{" "}
                {result.gate ? `${result.gate.opened ? "已開門" : "未開門"} (${result.gate.message})` : "-"}
              </p>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
