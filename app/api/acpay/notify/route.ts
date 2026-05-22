import { NextResponse } from "next/server";
import { parseAcpayXml, verifyAcpaySign } from "../../../../lib/acpay";

function textResponse(text: string, status = 200) {
  return new NextResponse(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
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

  // TODO: ACpay may send duplicate notifications. Persist out_trade_no and
  // update payment state idempotently before treating the payment as settled.
  console.info("[acpay] notify accepted", {
    outTradeNo: parsed.out_trade_no,
    totalFee: parsed.total_fee,
    hasTransactionId: Boolean(parsed.transaction_id),
  });

  return textResponse("SUCCESS");
}
