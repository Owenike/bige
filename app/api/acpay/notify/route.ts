import { NextResponse } from "next/server";
import { parseAcpayXml, verifyAcpaySign } from "../../../../lib/acpay";
import { recordAcpayChecklist } from "../../../../lib/acpay-checklist";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

type TrialBookingPaymentRow = {
  id: string;
  payment_status: string;
  amount: number | string | null;
  merchant_trade_no: string | null;
  acpay_trade_no: string | null;
};

function textResponse(text: string, status = 200) {
  return new NextResponse(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function sameAmount(left: number | string | null, right: string | undefined) {
  return Number(left) === Number(right);
}

export async function POST(request: Request) {
  const secretKey = process.env.ACPAY_SECRET_KEY?.trim() || "";

  if (!secretKey) {
    console.warn("[acpay] notify skipped: missing secret key");
    return textResponse("FAIL", 503);
  }

  const rawBody = await request.text();
  const parsed = parseAcpayXml(rawBody);
  const isValidSign = verifyAcpaySign(parsed, secretKey);

  if (!isValidSign) {
    console.warn("[acpay] notify invalid sign", {
      hasOutTradeNo: Boolean(parsed.out_trade_no),
      hasTransactionId: Boolean(parsed.transaction_id),
    });
    return textResponse("FAIL", 401);
  }

  const isPaid = parsed.result_code === "0" && parsed.pay_result === "0";
  const hasRequiredFields = Boolean(parsed.out_trade_no && parsed.total_fee);

  if (!isPaid || !hasRequiredFields) {
    console.warn("[acpay] notify not accepted", {
      resultCode: parsed.result_code,
      payResult: parsed.pay_result,
      hasOutTradeNo: Boolean(parsed.out_trade_no),
      hasTotalFee: Boolean(parsed.total_fee),
    });
    return textResponse("FAIL", 400);
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    console.warn("[acpay] notify skipped: admin client failed", {
      outTradeNo: parsed.out_trade_no,
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return textResponse("FAIL", 500);
  }

  const bookingResult = await admin
    .from("trial_bookings")
    .select("id, payment_status, amount, merchant_trade_no, acpay_trade_no")
    .eq("merchant_trade_no", parsed.out_trade_no)
    .maybeSingle();

  if (bookingResult.error) {
    console.warn("[acpay] notify booking lookup failed", {
      outTradeNo: parsed.out_trade_no,
      error: bookingResult.error.message,
    });
    return textResponse("FAIL", 500);
  }

  const booking = bookingResult.data as TrialBookingPaymentRow | null;
  if (!booking) {
    console.warn("[acpay] notify booking not found", {
      outTradeNo: parsed.out_trade_no,
      hasTransactionId: Boolean(parsed.transaction_id),
    });
    return textResponse("FAIL", 404);
  }

  if (!sameAmount(booking.amount, parsed.total_fee)) {
    console.warn("[acpay] notify amount mismatch", {
      outTradeNo: parsed.out_trade_no,
      bookingId: booking.id,
      expectedAmount: booking.amount,
      receivedAmount: parsed.total_fee,
    });
    return textResponse("FAIL", 409);
  }

  if (booking.payment_status !== "paid") {
    const updateResult = await admin
      .from("trial_bookings")
      .update({
        payment_status: "paid",
        acpay_trade_no: parsed.transaction_id || booking.acpay_trade_no,
        paid_at: new Date().toISOString(),
      })
      .eq("id", booking.id)
      .neq("payment_status", "paid")
      .select("id")
      .maybeSingle();

    if (updateResult.error || !updateResult.data) {
      console.warn("[acpay] notify booking update failed", {
        outTradeNo: parsed.out_trade_no,
        bookingId: booking.id,
        error: updateResult.error?.message || "booking_not_updated",
      });
      return textResponse("FAIL", 500);
    }
  }

  recordAcpayChecklist({
    notifyRawXml: rawBody,
    notifyParsedPayload: parsed,
    outTradeNo: parsed.out_trade_no,
    transactionId: parsed.transaction_id,
  });
  console.info("[acpay] notify accepted", {
    outTradeNo: parsed.out_trade_no,
    bookingId: booking.id,
    totalFee: parsed.total_fee,
    hasTransactionId: Boolean(parsed.transaction_id),
    alreadyPaid: booking.payment_status === "paid",
  });
  console.info("[acpay] notify xml for checklist", {
    outTradeNo: parsed.out_trade_no,
    rawXml: rawBody,
    parsedPayload: parsed,
  });

  return textResponse("SUCCESS");
}
