"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IssueEntryTokenResponse } from "../../../types/entry";
import { useI18n } from "../../i18n-provider";

const FALLBACK_REFRESH_SECONDS = 60;

function formatTime(input: string | null | undefined) {
  if (!input) return "-";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  return d.toLocaleTimeString();
}

export default function MemberEntryQrPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [payload, setPayload] = useState<IssueEntryTokenResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const refreshAtRef = useRef<number>(0);

  const qrImageSrc = useMemo(() => {
    if (!payload?.token) return null;
    const encoded = encodeURIComponent(payload.token);
    return `https://quickchart.io/qr?text=${encoded}&size=320&ecLevel=M`;
  }, [payload?.token]);

  const refreshToken = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/entry/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }

      const data = (await response.json()) as IssueEntryTokenResponse;
      setPayload(data);

      const refreshInSeconds = data.refreshInSeconds || FALLBACK_REFRESH_SECONDS;
      refreshAtRef.current = Date.now() + refreshInSeconds * 1000;
      setCountdown(refreshInSeconds);
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "更新入場 QR 失敗" : "Failed to refresh entry QR token");
    } finally {
      setLoading(false);
    }
  }, [zh]);

  useEffect(() => {
    void refreshToken();
  }, [refreshToken]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((refreshAtRef.current - Date.now()) / 1000));
      setCountdown(left);

      if (left <= 0 && !loading) {
        void refreshToken();
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [loading, refreshToken]);

  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="text-2xl font-bold">{zh ? "入場 QR" : "Entry QR"}</h1>
      <p className="mt-2 text-sm text-gray-600">
        {zh ? "請在櫃檯出示此 QR。系統會在過期前自動更新。" : "Present this QR at front desk. It auto refreshes before expiry."}
      </p>

      <section className="card mt-6 rounded-lg border p-4">
        {qrImageSrc ? (
          <Image src={qrImageSrc} alt={zh ? "入場 QR" : "Entry QR"} className="mx-auto h-72 w-72 rounded bg-white p-2" width={288} height={288} unoptimized />
        ) : (
          <div className="mx-auto flex h-72 w-72 items-center justify-center rounded border bg-gray-50 text-sm text-gray-500">
            {loading ? (zh ? "產生 QR 中..." : "Generating QR...") : zh ? "QR 無法使用" : "QR unavailable"}
          </div>
        )}

        <div className="mt-4 space-y-1 text-sm">
          <p>{zh ? "更新倒數：" : "Refresh in:"} {countdown} {zh ? "秒" : "seconds"}</p>
          <p>{zh ? "憑證到期時間：" : "Token expires at:"} {formatTime(payload?.expiresAt)}</p>
          {error ? <p className="text-red-600">{zh ? "更新失敗：" : "Refresh failed:"} {error}</p> : null}
          {!error && !loading ? <p className="text-green-600">{zh ? "QR 已就緒" : "QR is ready"}</p> : null}
        </div>

        <button
          type="button"
          onClick={() => void refreshToken()}
          className="mt-4 rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={loading}
        >
          {loading ? (zh ? "更新中..." : "Refreshing...") : zh ? "立即更新" : "Refresh Now"}
        </button>
      </section>

      <details className="mt-4 text-xs text-gray-500">
        <summary>{zh ? "憑證預覽" : "Token preview"}</summary>
        <pre className="mt-2 overflow-auto rounded bg-gray-100 p-2">
          {payload?.token ? `${payload.token.slice(0, 64)}...` : zh ? "（無憑證）" : "(no token)"}
        </pre>
      </details>
    </main>
  );
}
