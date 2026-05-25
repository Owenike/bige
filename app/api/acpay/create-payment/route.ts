import { NextResponse } from "next/server";
import {
  buildAcpayXml,
  createAcpaySign,
  createNonceStr,
  createOutTradeNo,
  parseAcpayXml,
  type AcpayParams,
} from "../../../../lib/acpay";
import { recordAcpayChecklist } from "../../../../lib/acpay-checklist";
import { getAcpayConfigSummary, getAcpayServerConfig } from "../../../../lib/acpay-server";

const ALLOWED_AMOUNTS = new Set([880, 1500]);

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function normalizeAmount(input: unknown, fallback: number) {
  if (Number.isFinite(fallback) && ALLOWED_AMOUNTS.has(fallback)) return fallback;
  const requested = Number(input);
  if (Number.isFinite(requested) && ALLOWED_AMOUNTS.has(requested)) return requested;
  return 880;
}

export async function POST(request: Request) {
  const config = getAcpayServerConfig();

  if (!config.merchantNo || !config.secretKey || !config.apiRoot || !config.appBaseUrl) {
    console.warn("[acpay] create payment skipped: missing env", getAcpayConfigSummary(config));
    return jsonError(503, "線上付款設定尚未完成，請稍後再試或改用現場付款。");
  }

  let body: { amount?: unknown } | null = null;
  try {
    body = (await request.json().catch(() => null)) as { amount?: unknown } | null;
  } catch {
    body = null;
  }

  const totalFee = normalizeAmount(body?.amount, config.envAmount);
  const outTradeNo = createOutTradeNo();
  const params: AcpayParams = {
    service: "vmj",
    version: "2.0",
    charset: "UTF-8",
    sign_type: "SHA-256",
    merchant_no: config.merchantNo,
    out_trade_no: outTradeNo,
    body: "BigE Trial Booking",
    total_fee: totalFee,
    nonce_str: createNonceStr(),
    auto_settle: "Y",
    notify_url: `${config.appBaseUrl}/api/acpay/notify`,
    callback_url: `${config.appBaseUrl}/payment/acpay-result`,
    layout: 2,
    three_domain_secure: "Y",
    show_notify_email_field: "N",
  };

  params.sign = createAcpaySign(params, config.secretKey);
  const requestXml = buildAcpayXml(params);
  recordAcpayChecklist({
    authorizationRequestXml: requestXml,
    outTradeNo,
  });
  console.info("[acpay] authorization request xml for checklist", {
    outTradeNo,
    requestXml,
  });

  try {
    const response = await fetch(config.apiRoot, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml; charset=UTF-8",
      },
      body: requestXml,
    });
    const responseText = await response.text();
    const parsed = parseAcpayXml(responseText);
    recordAcpayChecklist({
      authorizationRequestXml: requestXml,
      authorizationResponseXml: responseText,
      codeUrl: parsed.code_url,
      outTradeNo,
    });
    console.info("[acpay] authorization response xml for checklist", {
      outTradeNo,
      responseXml: responseText,
      hasCodeUrl: Boolean(parsed.code_url),
    });

    if (parsed.status === "0" && parsed.result_code === "0" && parsed.code_url) {
      return NextResponse.json({ ok: true, codeUrl: parsed.code_url, outTradeNo });
    }

    console.warn("[acpay] create payment failed", {
      httpStatus: response.status,
      status: parsed.status,
      resultCode: parsed.result_code,
      hasCodeUrl: Boolean(parsed.code_url),
      message: parsed.message || parsed.result_msg || null,
    });

    return jsonError(502, "建立付款連結失敗，請稍後再試或改用現場付款。");
  } catch (error) {
    console.warn("[acpay] create payment request failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonError(502, "無法連線至付款服務，請稍後再試或改用現場付款。");
  }
}
