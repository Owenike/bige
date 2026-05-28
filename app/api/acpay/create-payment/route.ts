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
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

const ALLOWED_AMOUNTS = new Set([880, 1500]);

type TrialBookingPaymentRow = {
  id: string;
  payment_method: string;
  payment_status: string;
  amount: number | string | null;
  currency: string | null;
  merchant_trade_no: string | null;
};

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function normalizeBookingAmount(input: number | string | null) {
  const amount = Number(input);
  if (Number.isFinite(amount) && ALLOWED_AMOUNTS.has(amount)) return amount;
  return null;
}

export async function POST(request: Request) {
  const config = getAcpayServerConfig();

  if (!config.merchantNo || !config.secretKey || !config.apiRoot || !config.appBaseUrl) {
    console.warn("[acpay] create payment skipped: missing env", getAcpayConfigSummary(config));
    return jsonError(503, "ACPay payment is not configured.");
  }

  const body = (await request.json().catch(() => null)) as { bookingId?: unknown } | null;
  const bookingId = typeof body?.bookingId === "string" ? body.bookingId.trim() : "";
  if (!bookingId) {
    return jsonError(400, "bookingId is required.");
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase admin client initialization failed");
  }

  const bookingResult = await admin
    .from("trial_bookings")
    .select("id, payment_method, payment_status, amount, currency, merchant_trade_no")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingResult.error) {
    return jsonError(500, bookingResult.error.message);
  }

  const booking = bookingResult.data as TrialBookingPaymentRow | null;
  if (!booking) {
    return jsonError(404, "Trial booking not found.");
  }

  if (booking.payment_method !== "online_payment") {
    return jsonError(400, "Trial booking is not configured for online payment.");
  }

  if (booking.payment_status === "paid") {
    return jsonError(409, "Trial booking is already paid.");
  }

  if (booking.payment_status !== "pending_payment") {
    return jsonError(409, "Trial booking payment status is not pending payment.");
  }

  if (booking.merchant_trade_no) {
    return jsonError(409, "ACPay payment has already been created for this booking.");
  }

  const totalFee = normalizeBookingAmount(booking.amount);
  if (!totalFee) {
    return jsonError(400, "Trial booking amount is invalid.");
  }

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
    bookingId,
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
      bookingId,
      responseXml: responseText,
      hasCodeUrl: Boolean(parsed.code_url),
    });

    if (parsed.status === "0" && parsed.result_code === "0" && parsed.code_url) {
      const updateResult = await admin
        .from("trial_bookings")
        .update({
          merchant_trade_no: outTradeNo,
          amount: totalFee,
          currency: booking.currency || "TWD",
        })
        .eq("id", booking.id)
        .eq("payment_method", "online_payment")
        .eq("payment_status", "pending_payment")
        .is("merchant_trade_no", null)
        .select("id")
        .maybeSingle();

      if (updateResult.error || !updateResult.data) {
        console.warn("[acpay] failed to bind payment to trial booking", {
          bookingId,
          outTradeNo,
          error: updateResult.error?.message || "booking_not_updated",
        });
        return jsonError(500, "ACPay payment was created but could not be linked to the booking.");
      }

      return NextResponse.json({ ok: true, codeUrl: parsed.code_url, outTradeNo, bookingId });
    }

    console.warn("[acpay] create payment failed", {
      bookingId,
      httpStatus: response.status,
      status: parsed.status,
      resultCode: parsed.result_code,
      hasCodeUrl: Boolean(parsed.code_url),
      message: parsed.message || parsed.result_msg || null,
    });

    return jsonError(502, "Unable to create ACPay payment.");
  } catch (error) {
    console.warn("[acpay] create payment request failed", {
      bookingId,
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonError(502, "Unable to reach ACPay payment service.");
  }
}
