import { NextResponse } from "next/server";
import { buildAcpayXml, createAcpaySign, createNonceStr, parseAcpayXml, type AcpayParams } from "../../../../lib/acpay";
import { recordAcpayChecklist } from "../../../../lib/acpay-checklist";
import { getAcpayConfigSummary, getAcpayServerConfig, isAuthorizedAcpayTestRequest } from "../../../../lib/acpay-server";

const TEST_CAPTURE_DEFAULTS = {
  outTradeNo: "BEMPH1PADN7957C8",
  transactionId: "AA260522aEHHujaJk5",
  totalFee: "880",
  settleFee: "880",
};
const ACPAY_REQUEST_TIMEOUT_MS = 25_000;

type CaptureRequestBody = {
  outTradeNo?: string;
  transactionId?: string;
  totalFee?: string | number;
  settleFee?: string | number;
};

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function readText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export async function POST(request: Request) {
  const config = getAcpayServerConfig();

  if (config.acpayEnv !== "test") {
    return jsonError(403, "ACpay test capture is only available when ACPAY_ENV=test.");
  }

  const receivedTokenLength = request.headers.get("x-acpay-test-token")?.trim().length || 0;

  if (!isAuthorizedAcpayTestRequest(request, config.testActionToken)) {
    console.warn("[acpay] capture rejected: invalid test token", {
      hasTestActionToken: Boolean(config.testActionToken),
      receivedTokenLength,
      expectedTokenLength: config.testActionToken.length,
    });
    return jsonError(401, "Unauthorized ACpay test action.");
  }

  if (!config.merchantNo || !config.secretKey || !config.apiRoot2) {
    console.warn("[acpay] capture skipped: missing env", getAcpayConfigSummary(config));
    return jsonError(503, "ACpay capture settings are incomplete.");
  }

  const body = (await request.json().catch(() => null)) as CaptureRequestBody | null;
  const outTradeNo = readText(body?.outTradeNo, TEST_CAPTURE_DEFAULTS.outTradeNo);
  const transactionId = readText(body?.transactionId, TEST_CAPTURE_DEFAULTS.transactionId);
  const totalFee = readText(String(body?.totalFee ?? ""), TEST_CAPTURE_DEFAULTS.totalFee);
  const settleFee = readText(String(body?.settleFee ?? ""), TEST_CAPTURE_DEFAULTS.settleFee);

  const params: AcpayParams = {
    service: "unified.trade.capture",
    version: "2.0",
    charset: "UTF-8",
    sign_type: "SHA-256",
    merchant_no: config.merchantNo,
    out_trade_no: outTradeNo,
    transaction_id: transactionId,
    total_fee: totalFee,
    settle_fee: settleFee,
    nonce_str: createNonceStr(),
  };

  params.sign = createAcpaySign(params, config.secretKey);
  const requestXml = buildAcpayXml(params);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ACPAY_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.apiRoot2}/Capture`, {
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
      captureRequestXml: requestXml,
      captureResponseXml: responseXml,
      outTradeNo,
      transactionId,
    });
    console.info("[acpay] capture xml for checklist", {
      outTradeNo,
      transactionId,
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
        totalFee,
        settleFee,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("[acpay] capture request timeout", { outTradeNo, transactionId });
      return jsonError(504, "ACpay capture request timeout.");
    }

    console.warn("[acpay] capture request failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonError(502, "ACpay capture request failed.");
  } finally {
    clearTimeout(timeoutId);
  }
}
