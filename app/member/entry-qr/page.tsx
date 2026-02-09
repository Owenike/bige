"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IssueEntryTokenResponse } from "../../../types/entry";

const FALLBACK_REFRESH_SECONDS = 60;

function secondsLeft(targetIso: string | null): number {
  if (!targetIso) return 0;
  const diff = Math.ceil((new Date(targetIso).getTime() - Date.now()) / 1000);
  return Math.max(0, diff);
}

export default function MemberEntryQrPage() {
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
      setError(err instanceof Error ? err.message : "無法更新入場 QR，請檢查網路後重試。");
    } finally {
      setLoading(false);
    }
  }, []);

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
      <h1 className="text-2xl font-bold">會員入場 QR</h1>
      <p className="mt-2 text-sm text-gray-600">QR 每 60 秒自動更新，Token TTL 為 90 秒。</p>

      <section className="mt-6 rounded-lg border p-4">
        {qrImageSrc ? (
          <Image src={qrImageSrc} alt="Entry QR" className="mx-auto h-72 w-72 rounded bg-white p-2" width={288} height={288} unoptimized />
        ) : (
          <div className="mx-auto flex h-72 w-72 items-center justify-center rounded border bg-gray-50 text-sm text-gray-500">
            {loading ? "載入中..." : "尚未取得 QR"}
          </div>
        )}

        <div className="mt-4 space-y-1 text-sm">
          <p>下次更新倒數: {countdown} 秒</p>
          <p>本次到期時間: {payload?.expiresAt ? new Date(payload.expiresAt).toLocaleTimeString() : "-"}</p>
          {error ? <p className="text-red-600">更新失敗: {error}</p> : null}
          {!error && !loading ? <p className="text-green-600">狀態: QR 已更新</p> : null}
        </div>

        <button
          type="button"
          onClick={() => void refreshToken()}
          className="mt-4 rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={loading}
        >
          {loading ? "更新中..." : "立即更新"}
        </button>
      </section>

      <details className="mt-4 text-xs text-gray-500">
        <summary>除錯資訊</summary>
        <pre className="mt-2 overflow-auto rounded bg-gray-100 p-2">
          {payload?.token ? `${payload.token.slice(0, 64)}...` : "(no token)"}
        </pre>
      </details>
    </main>
  );
}


