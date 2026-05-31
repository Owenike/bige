import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

import {
  buildAcpayXml,
  createAcpaySign,
  createNonceStr,
  parseAcpayXml,
  type AcpayParams,
} from "@/lib/acpay";
import { getAcpayConfigSummary, getAcpayServerConfig } from "@/lib/acpay-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type CustomPaymentRow = {
  id: string;
  amount: number | string | null;
  currency: string | null;
  payment_status: string;
  merchant_trade_no: string | null;
};

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function createCustomOutTradeNo() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const suffix = randomBytes(2).toString("hex").toUpperCase();
  return `BECUSTOM${timestamp}${suffix}`.slice(0, 20);
}

function normalizeAmount(input: number | string | null) {
  const amount = Number(input);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  return amount;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { customPaymentId?: unknown } | null;
  const customPaymentId = typeof body?.customPaymentId === "string" ? body.customPaymentId.trim() : "";
  if (!customPaymentId) {
    return jsonError(400, "customPaymentId is required.");
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase admin client initialization failed.");
  }

  const paymentResult = await admin
    .from("custom_payments")
    .select("id, amount, currency, payment_status, merchant_trade_no")
    .eq("id", customPaymentId)
    .maybeSingle();

  if (paymentResult.error) {
    return jsonError(500, paymentResult.error.message);
  }

  const payment = paymentResult.data as CustomPaymentRow | null;
  if (!payment) {
    return jsonError(404, "Custom payment not found.");
  }

  if (payment.payment_status !== "pending_payment") {
    return jsonError(409, "Custom payment status is not pending payment.");
  }

  if (payment.merchant_trade_no) {
    return jsonError(409, "ACPay payment has already been created for this custom payment.");
  }

  if ((payment.currency || "TWD") !== "TWD") {
    return jsonError(400, "Custom payment currency is invalid.");
  }

  const totalFee = normalizeAmount(payment.amount);
  if (!totalFee) {
    return jsonError(400, "Custom payment amount is invalid.");
  }

  const config = getAcpayServerConfig();

  if (!config.merchantNo || !config.secretKey || !config.apiRoot || !config.appBaseUrl) {
    console.warn("[acpay] create custom payment skipped: missing env", getAcpayConfigSummary(config));
    return jsonError(503, "ACPay payment is not configured.");
  }

  const outTradeNo = createCustomOutTradeNo();
  const params: AcpayParams = {
    service: "vmj",
    version: "2.0",
    charset: "UTF-8",
    sign_type: "SHA-256",
    merchant_no: config.merchantNo,
    out_trade_no: outTradeNo,
    body: "BigE 自訂金額付款",
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
      const updateResult = await admin
        .from("custom_payments")
        .update({
          merchant_trade_no: outTradeNo,
          amount: totalFee,
          currency: "TWD",
        })
        .eq("id", payment.id)
        .eq("payment_status", "pending_payment")
        .is("merchant_trade_no", null)
        .select("id")
        .maybeSingle();

      if (updateResult.error || !updateResult.data) {
        console.warn("[acpay] failed to bind payment to custom payment", {
          customPaymentId,
          outTradeNo,
          error: updateResult.error?.message || "custom_payment_not_updated",
        });
        return jsonError(500, "ACPay payment was created but could not be linked to the custom payment.");
      }

      return NextResponse.json({ ok: true, codeUrl: parsed.code_url, outTradeNo, customPaymentId });
    }

    console.warn("[acpay] create custom payment failed", {
      customPaymentId,
      httpStatus: response.status,
      status: parsed.status,
      resultCode: parsed.result_code,
      hasCodeUrl: Boolean(parsed.code_url),
      message: parsed.message || parsed.result_msg || null,
    });

    return jsonError(502, "Unable to create ACPay custom payment.");
  } catch (error) {
    console.warn("[acpay] create custom payment request failed", {
      customPaymentId,
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonError(502, "Unable to reach ACPay payment service.");
  }
}
