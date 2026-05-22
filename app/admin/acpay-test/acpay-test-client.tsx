"use client";

import { useState } from "react";

type ActionKind = "capture" | "refund";

const DEFAULTS = {
  outTradeNo: "BEMPH1PADN7957C8",
  transactionId: "AA260522aEHHujaJk5",
  totalFee: "880",
  settleFee: "880",
  refundFee: "880",
  outRefundNo: "",
};

export function AcpayTestClient() {
  const [token, setToken] = useState("");
  const [form, setForm] = useState(DEFAULTS);
  const [loading, setLoading] = useState<ActionKind | null>(null);
  const [result, setResult] = useState<{
    action: ActionKind;
    ok: boolean;
    status: number;
    body: unknown;
  } | null>(null);
  const [error, setError] = useState("");

  function updateField(field: keyof typeof DEFAULTS, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function runAction(action: ActionKind) {
    setLoading(action);
    setError("");
    setResult(null);

    const isCapture = action === "capture";
    const body = isCapture
      ? {
          outTradeNo: form.outTradeNo,
          transactionId: form.transactionId,
          totalFee: form.totalFee,
          settleFee: form.settleFee,
        }
      : {
          outTradeNo: form.outTradeNo,
          transactionId: form.transactionId,
          outRefundNo: form.outRefundNo || undefined,
          totalFee: form.totalFee,
          refundFee: form.refundFee,
        };

    try {
      const response = await fetch(`/api/acpay/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-acpay-test-token": token,
        },
        body: JSON.stringify(body),
      });
      const responseBody = (await response.json().catch(() => ({ error: "Unable to parse JSON response." }))) as unknown;

      setResult({
        action,
        ok: response.ok,
        status: response.status,
        body: responseBody,
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Request failed.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <section className="acpayTestTool">
      <div className="acpayTestNotice">
        <strong>測試順序提醒</strong>
        <span>請先確認付款已成功，再執行請款；請款成功後才執行退款，避免重複請款。</span>
      </div>

      <div className="acpayTestGrid">
        <label className="acpayTestField acpayTestFieldWide">
          <span>測試 token</span>
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="請輸入 ACPAY_TEST_ACTION_TOKEN"
            type="password"
            autoComplete="off"
          />
          <small>token 只存在目前頁面的 React state，不會寫入 localStorage。</small>
        </label>

        <label className="acpayTestField">
          <span>outTradeNo</span>
          <input value={form.outTradeNo} onChange={(event) => updateField("outTradeNo", event.target.value)} />
        </label>
        <label className="acpayTestField">
          <span>transactionId</span>
          <input value={form.transactionId} onChange={(event) => updateField("transactionId", event.target.value)} />
        </label>
        <label className="acpayTestField">
          <span>totalFee</span>
          <input value={form.totalFee} onChange={(event) => updateField("totalFee", event.target.value)} />
        </label>
        <label className="acpayTestField">
          <span>settleFee</span>
          <input value={form.settleFee} onChange={(event) => updateField("settleFee", event.target.value)} />
        </label>
        <label className="acpayTestField">
          <span>refundFee</span>
          <input value={form.refundFee} onChange={(event) => updateField("refundFee", event.target.value)} />
        </label>
        <label className="acpayTestField">
          <span>outRefundNo</span>
          <input
            value={form.outRefundNo}
            onChange={(event) => updateField("outRefundNo", event.target.value)}
            placeholder="可空白，由 API 自動產生"
          />
        </label>
      </div>

      <div className="acpayTestActions">
        <button type="button" onClick={() => runAction("capture")} disabled={!token || loading !== null}>
          {loading === "capture" ? "請款中..." : "執行請款 Capture"}
        </button>
        <button type="button" onClick={() => runAction("refund")} disabled={!token || loading !== null}>
          {loading === "refund" ? "退款中..." : "執行退款 Refund"}
        </button>
      </div>

      {error ? <p className="acpayTestError">{error}</p> : null}
      {result ? (
        <section className="acpayTestResult">
          <div>
            <span>{result.action === "capture" ? "Capture" : "Refund"}</span>
            <strong>{result.ok ? `HTTP ${result.status} 成功` : `HTTP ${result.status} 失敗`}</strong>
          </div>
          <pre>{JSON.stringify(result.body, null, 2)}</pre>
        </section>
      ) : null}
    </section>
  );
}
