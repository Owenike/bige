import { NextResponse } from "next/server";
import { buildAcpayXml, createAcpaySign, createNonceStr, parseAcpayXml, type AcpayParams } from "../../../../lib/acpay";
import { recordAcpayChecklist } from "../../../../lib/acpay-checklist";
import { getAcpayConfigSummary, getAcpayServerConfig, isAuthorizedAcpayTestRequest } from "../../../../lib/acpay-server";

const TEST_REFUND_DEFAULTS = {
  outTradeNo: "BEMPH1PADN7957C8",
  transactionId: "AA260522aEHHujaJk5",
  totalFee: "880",
  refundFee: "880",
};
const ACPAY_REQUEST_TIMEOUT_MS = 25_000;

type RefundRequestBody = {
  outTradeNo?: string;
  transactionId?: string;
  outRefundNo?: string;
  totalFee?: string | number;
  refundFee?: string | number;
};

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function readText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function createOutRefundNo() {
  return `RF${Date.now().toString().slice(-10)}`;
}

export async function POST(request: Request) {
  const config = getAcpayServerConfig();

  if (config.acpayEnv !== "test") {
    return jsonError(403, "ACpay test refund is only available when ACPAY_ENV=test.");
  }

  const receivedTokenLength = request.headers.get("x-acpay-test-token")?.trim().length || 0;

  if (!isAuthorizedAcpayTestRequest(request, config.testActionToken)) {
    console.warn("[acpay] refund rejected: invalid test token", {
      hasTestActionToken: Boolean(config.testActionToken),
      receivedTokenLength,
      expectedTokenLength: config.testActionToken.length,
    });
    return jsonError(401, "Unauthorized ACpay test action.");
  }

  if (!config.merchantNo || !config.secretKey || !config.apiRoot2) {
    console.warn("[acpay] refund skipped: missing env", getAcpayConfigSummary(config));
    return jsonError(503, "ACpay refund settings are incomplete.");
  }

  const body = (await request.json().catch(() => null)) as RefundRequestBody | null;
  const outTradeNo = readText(body?.outTradeNo, TEST_REFUND_DEFAULTS.outTradeNo);
  const transactionId = readText(body?.transactionId, TEST_REFUND_DEFAULTS.transactionId);
  const outRefundNo = readText(body?.outRefundNo, createOutRefundNo());
  const totalFee = readText(String(body?.totalFee ?? ""), TEST_REFUND_DEFAULTS.totalFee);
  const refundFee = readText(String(body?.refundFee ?? ""), TEST_REFUND_DEFAULTS.refundFee);

  const params: AcpayParams = {
    service: "unified.trade.refund",
    version: "2.0",
    charset: "UTF-8",
    sign_type: "SHA-256",
    merchant_no: config.merchantNo,
    out_trade_no: outTradeNo,
    transaction_id: transactionId,
    out_refund_no: outRefundNo,
    total_fee: totalFee,
    refund_fee: refundFee,
    nonce_str: createNonceStr(),
  };

  params.sign = createAcpaySign(params, config.secretKey);
  const requestXml = buildAcpayXml(params);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ACPAY_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.apiRoot2}/Refund`, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml; charset=UTF-8",
      },
      body: requestXml,
      signal: controller.signal,
    });
    const responseXml = await response.text();
    const parsed = parseAcpayXml(responseXml);

    recordAcpayChecklist({
      refundRequestXml: requestXml,
      refundResponseXml: responseXml,
      outTradeNo,
      transactionId,
    });
    console.info("[acpay] refund xml for checklist", {
      outTradeNo,
      transactionId,
      outRefundNo,
      requestXml,
      responseXml,
      httpStatus: response.status,
    });

    return NextResponse.json({
      ok: response.ok,
      httpStatus: response.status,
      parsed,
      requestXml,
      responseXml,
      summary: {
        outTradeNo,
        transactionId,
        outRefundNo,
        totalFee,
        refundFee,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("[acpay] refund request timeout", { outTradeNo, transactionId, outRefundNo });
      return jsonError(504, "ACpay refund request timeout.");
    }

    console.warn("[acpay] refund request failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonError(502, "ACpay refund request failed.");
  } finally {
    clearTimeout(timeoutId);
  }
}
