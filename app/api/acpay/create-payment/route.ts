import { NextResponse } from "next/server";
import {
  buildAcpayXml,
  createAcpaySign,
  createNonceStr,
  createOutTradeNo,
  parseAcpayXml,
  type AcpayParams,
} from "../../../../lib/acpay";

const ALLOWED_AMOUNTS = new Set([880, 1500]);

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function getConfig() {
  const acpayEnv = process.env.ACPAY_ENV?.trim() || "";
  const merchantNo = process.env.ACPAY_MERCHANT_NO?.trim() || "";
  const secretKey = process.env.ACPAY_SECRET_KEY?.trim() || "";
  const apiRoot = process.env.ACPAY_API_ROOT?.trim() || "";
  const apiRoot2 = process.env.ACPAY_API_ROOT2?.trim() || "";
  const appBaseUrl = (process.env.APP_BASE_URL?.trim() || "").replace(/\/+$/, "");
  const trialAmount = process.env.ACPAY_TRIAL_AMOUNT?.trim() || "";
  const envAmount = Number(trialAmount || 880);

  return { acpayEnv, merchantNo, secretKey, apiRoot, apiRoot2, appBaseUrl, trialAmount, envAmount };
}

function normalizeAmount(input: unknown, fallback: number) {
  if (Number.isFinite(fallback) && ALLOWED_AMOUNTS.has(fallback)) return fallback;
  const requested = Number(input);
  if (Number.isFinite(requested) && ALLOWED_AMOUNTS.has(requested)) return requested;
  return 880;
}

export async function POST(request: Request) {
  const config = getConfig();

  if (!config.merchantNo || !config.secretKey || !config.apiRoot || !config.appBaseUrl) {
    console.warn("[acpay] create payment skipped: missing env", {
      hasAcpayEnv: Boolean(config.acpayEnv),
      hasMerchantNo: Boolean(config.merchantNo),
      hasSecretKey: Boolean(config.secretKey),
      secretKeyLength: config.secretKey.length,
      hasApiRoot: Boolean(config.apiRoot),
      hasApiRoot2: Boolean(config.apiRoot2),
      hasAppBaseUrl: Boolean(config.appBaseUrl),
      hasTrialAmount: Boolean(config.trialAmount),
      apiRoot: config.apiRoot || null,
      appBaseUrl: config.appBaseUrl || null,
    });
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
    auto_settle: "N",
    notify_url: `${config.appBaseUrl}/api/acpay/notify`,
    callback_url: `${config.appBaseUrl}/payment/acpay-result`,
    layout: 2,
    three_domain_secure: "Y",
    show_notify_email_field: "N",
  };

  params.sign = createAcpaySign(params, config.secretKey);
  const requestXml = buildAcpayXml(params);

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
