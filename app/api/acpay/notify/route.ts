import { NextResponse } from "next/server";
import { parseAcpayXml, verifyAcpaySign } from "../../../../lib/acpay";
import { recordAcpayChecklist } from "../../../../lib/acpay-checklist";
import { sendLineTrialBookingNotification } from "../../../../lib/line-push";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

type TrialBookingPaymentRow = {
  id: string;
  name: string;
  phone: string;
  birthday: string;
  line_name: string | null;
  service: string;
  preferred_time: string;
  note: string | null;
  payment_method: string;
  payment_status: string;
  amount: number | string | null;
  currency: string | null;
  merchant_trade_no: string | null;
  acpay_trade_no: string | null;
};

type CustomPaymentRow = {
  id: string;
  amount: number | string | null;
  currency: string | null;
  payment_status: string;
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

function serviceLabel(value: string) {
  if (value === "weight_training") return "重量訓練";
  if (value === "boxing_fitness") return "拳擊體適能訓練";
  if (value === "pilates") return "器械皮拉提斯";
  if (value === "sports_massage") return "運動按摩";
  return value || "未提供";
}

function preferredTimeLabel(value: string) {
  const labels: Record<string, string> = {
    weekday_morning: "平日上午",
    weekday_afternoon: "平日下午",
    weekday_evening: "平日晚上",
    weekend_morning: "週末上午",
    weekend_afternoon: "週末下午",
    weekend_evening: "週末晚上",
    other: "其他時間",
  };
  return labels[value] || value || "未提供";
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
    .select(
      "id, name, phone, birthday, line_name, service, preferred_time, note, payment_method, payment_status, amount, currency, merchant_trade_no, acpay_trade_no",
    )
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
  if (booking) {
    if (booking.payment_method !== "online_payment") {
      console.warn("[acpay] notify booking payment method mismatch", {
        outTradeNo: parsed.out_trade_no,
        bookingId: booking.id,
        paymentMethod: booking.payment_method,
      });
      return textResponse("FAIL", 409);
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

      const lineResult = await sendLineTrialBookingNotification({
        name: booking.name,
        phone: booking.phone,
        birthday: booking.birthday,
        lineName: booking.line_name,
        service: serviceLabel(booking.service),
        preferredTime: preferredTimeLabel(booking.preferred_time),
        paymentMethod: "線上付款",
        paymentStatus: "已付款",
        amount: booking.amount,
        currency: booking.currency,
        note: booking.note,
      });

      if (!lineResult.ok) {
        console.warn("[acpay] notify line notification did not complete", {
          outTradeNo: parsed.out_trade_no,
          bookingId: booking.id,
          status: lineResult.status,
          error: lineResult.error,
          skipped: lineResult.skipped,
        });
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

  const customPaymentResult = await admin
    .from("custom_payments")
    .select("id, amount, currency, payment_status, merchant_trade_no, acpay_trade_no")
    .eq("merchant_trade_no", parsed.out_trade_no)
    .maybeSingle();

  if (customPaymentResult.error) {
    console.warn("[acpay] notify custom payment lookup failed", {
      outTradeNo: parsed.out_trade_no,
      error: customPaymentResult.error.message,
    });
    return textResponse("FAIL", 500);
  }

  const customPayment = customPaymentResult.data as CustomPaymentRow | null;
  if (!customPayment) {
    console.warn("[acpay] notify payment target not found", {
      outTradeNo: parsed.out_trade_no,
      hasTransactionId: Boolean(parsed.transaction_id),
    });
    return textResponse("SUCCESS");
  }

  if ((customPayment.currency || "TWD") !== "TWD") {
    console.warn("[acpay] notify custom payment currency mismatch", {
      outTradeNo: parsed.out_trade_no,
      customPaymentId: customPayment.id,
      currency: customPayment.currency,
    });
    return textResponse("FAIL", 409);
  }

  if (!sameAmount(customPayment.amount, parsed.total_fee)) {
    console.warn("[acpay] notify custom payment amount mismatch", {
      outTradeNo: parsed.out_trade_no,
      customPaymentId: customPayment.id,
      expectedAmount: customPayment.amount,
      receivedAmount: parsed.total_fee,
    });
    return textResponse("FAIL", 409);
  }

  if (customPayment.payment_status !== "paid") {
    const updateResult = await admin
      .from("custom_payments")
      .update({
        payment_status: "paid",
        acpay_trade_no: parsed.transaction_id || customPayment.acpay_trade_no,
        paid_at: new Date().toISOString(),
      })
      .eq("id", customPayment.id)
      .neq("payment_status", "paid")
      .select("id")
      .maybeSingle();

    if (updateResult.error || !updateResult.data) {
      console.warn("[acpay] notify custom payment update failed", {
        outTradeNo: parsed.out_trade_no,
        customPaymentId: customPayment.id,
        error: updateResult.error?.message || "custom_payment_not_updated",
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
  console.info("[acpay] custom payment notify accepted", {
    outTradeNo: parsed.out_trade_no,
    customPaymentId: customPayment.id,
    totalFee: parsed.total_fee,
    hasTransactionId: Boolean(parsed.transaction_id),
    alreadyPaid: customPayment.payment_status === "paid",
  });

  return textResponse("SUCCESS");
}
