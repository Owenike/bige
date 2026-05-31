import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const allowedPurposes = new Set(["course_fee", "price_difference", "event_fee", "other"]);

type CustomPaymentRequest = {
  payerName?: unknown;
  phone?: unknown;
  purpose?: unknown;
  note?: unknown;
  amount?: unknown;
};

function validationError(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

function parseRequiredText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseOptionalText(value: unknown) {
  if (value == null) return null;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseAmount(value: unknown) {
  if (typeof value !== "string") return null;
  if (value !== value.trim()) return null;
  if (!/^\d+$/.test(value)) return null;

  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;

  return amount;
}

export async function POST(request: Request) {
  let body: CustomPaymentRequest;

  try {
    body = (await request.json()) as CustomPaymentRequest;
  } catch {
    return validationError("請提供有效的付款資料。");
  }

  const payerName = parseRequiredText(body.payerName);
  const phone = parseRequiredText(body.phone);
  const purpose = parseRequiredText(body.purpose);
  const note = parseOptionalText(body.note);
  const amount = parseAmount(body.amount);

  if (!payerName) return validationError("請輸入姓名。");
  if (!phone) return validationError("請輸入電話。");
  if (!allowedPurposes.has(purpose)) return validationError("請選擇有效的付款用途。");
  if (amount == null) return validationError("付款金額必須為大於 0 的正整數。");

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("custom_payments")
      .insert({
        payer_name: payerName,
        phone,
        purpose,
        note,
        amount,
        currency: "TWD",
        payment_status: "pending_payment",
        source: "website_custom_payment",
      })
      .select("id, amount, payment_status")
      .single();

    if (error || !data) {
      console.error("[custom-payment/create] insert failed", error);
      return NextResponse.json({ ok: false, error: "付款資料建立失敗，請稍後再試。" }, { status: 500 });
    }

    return NextResponse.json(
      {
        ok: true,
        id: data.id,
        amount: data.amount,
        paymentStatus: data.payment_status,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[custom-payment/create] server error", error);
    return NextResponse.json({ ok: false, error: "伺服器暫時無法建立付款資料。" }, { status: 500 });
  }
}
