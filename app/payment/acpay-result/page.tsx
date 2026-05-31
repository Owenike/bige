import Link from "next/link";
import { recordAcpayChecklist } from "../../../lib/acpay-checklist";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

type AcpayResultPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type TrialBookingResultRow = {
  id: string;
  name: string | null;
  phone: string | null;
  birthday: string | null;
  service: string | null;
  preferred_time: string | null;
  note: string | null;
  payment_method: string | null;
  payment_status: string | null;
  amount: number | string | null;
  currency: string | null;
  merchant_trade_no: string | null;
  acpay_trade_no: string | null;
  paid_at: string | null;
};

type CustomPaymentResultRow = {
  id: string;
  payer_name: string | null;
  phone: string | null;
  purpose: string | null;
  note: string | null;
  amount: number | string | null;
  currency: string | null;
  payment_status: string | null;
  merchant_trade_no: string | null;
  acpay_trade_no: string | null;
  paid_at: string | null;
};

type SummaryRow = {
  label: string;
  value: string;
};

const LINE_URL = "https://lin.ee/0GWm0oZ";

function readParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function serviceLabel(value: string | null) {
  if (value === "weight_training") return "重量訓練";
  if (value === "boxing_fitness") return "拳擊體適能";
  if (value === "pilates") return "器械皮拉提斯";
  if (value === "sports_massage") return "運動按摩";
  return value || "";
}

function preferredTimeLabel(value: string | null) {
  const labels: Record<string, string> = {
    weekday_morning: "平日上午",
    weekday_afternoon: "平日下午",
    weekday_evening: "平日晚上",
    weekend_morning: "週末上午",
    weekend_afternoon: "週末下午",
    weekend_evening: "週末晚上",
    other: "其他時間",
  };
  return value ? labels[value] || value : "";
}

function paymentMethodLabel(value: string | null) {
  if (value === "online_payment") return "線上付款";
  if (value === "cash_on_site") return "現場付款";
  return value || "";
}

function purposeLabel(value: string | null) {
  if (value === "course_fee") return "課程費用";
  if (value === "price_difference") return "補差額";
  if (value === "event_fee") return "活動費用";
  if (value === "other") return "其他";
  return value || "";
}

function paymentStatusLabel(value: string | null, isSuccess: boolean, isPending: boolean) {
  if (value === "paid") return "付款已完成";
  if (value === "pending_payment" && isSuccess) return "付款結果確認中";
  if (value === "pending_payment") return "待付款";
  if (value === "pending_cash") return "現場付款待確認";
  if (value === "failed") return "付款未完成";
  if (value === "cancelled") return "付款已取消";
  if (value) return value;
  if (isSuccess) return "付款已完成";
  if (isPending) return "付款結果確認中";
  return "付款未完成";
}

function formatCurrency(amount: number | string | null, currency: string | null) {
  if (amount === null || amount === undefined || amount === "") return "";
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return "";
  if (!currency || currency === "TWD") return `NT$${numericAmount.toLocaleString("zh-TW")}`;
  return `${currency} ${numericAmount.toLocaleString("zh-TW")}`;
}

function addRow(rows: SummaryRow[], label: string, value: string) {
  const normalized = value.trim();
  if (normalized) rows.push({ label, value: normalized });
}

function buildTrialBookingRows(booking: TrialBookingResultRow, isSuccess: boolean, isPending: boolean) {
  const rows: SummaryRow[] = [];

  addRow(rows, "姓名", booking.name || "");
  addRow(rows, "電話", booking.phone || "");
  addRow(rows, "生日", booking.birthday || "");
  addRow(rows, "體驗項目", serviceLabel(booking.service));
  addRow(rows, "方便時段", preferredTimeLabel(booking.preferred_time));
  addRow(rows, "付款方式", paymentMethodLabel(booking.payment_method));
  addRow(rows, "付款金額", formatCurrency(booking.amount, booking.currency));
  addRow(rows, "付款狀態", paymentStatusLabel(booking.payment_status, isSuccess, isPending));
  addRow(rows, "備註", booking.note || "");

  return rows;
}

function buildCustomPaymentRows(payment: CustomPaymentResultRow, isSuccess: boolean, isPending: boolean) {
  const rows: SummaryRow[] = [];

  addRow(rows, "姓名", payment.payer_name || "");
  addRow(rows, "電話", payment.phone || "");
  addRow(rows, "付款用途", purposeLabel(payment.purpose));
  addRow(rows, "付款金額", formatCurrency(payment.amount, payment.currency));
  addRow(rows, "付款狀態", paymentStatusLabel(payment.payment_status, isSuccess, isPending));
  addRow(rows, "備註", payment.note || "");

  return rows;
}

async function findPaymentTargetByOutTradeNo(outTradeNo: string) {
  if (!outTradeNo) return { booking: null, customPayment: null };

  try {
    const admin = createSupabaseAdminClient();
    const bookingResult = await admin
      .from("trial_bookings")
      .select(
        "id, name, phone, birthday, service, preferred_time, note, payment_method, payment_status, amount, currency, merchant_trade_no, acpay_trade_no, paid_at",
      )
      .eq("merchant_trade_no", outTradeNo)
      .maybeSingle();

    if (bookingResult.error) {
      console.warn("[acpay] result booking lookup failed", {
        outTradeNo,
        error: bookingResult.error.message,
      });
      return { booking: null, customPayment: null };
    }

    const booking = (bookingResult.data as TrialBookingResultRow | null) || null;
    if (booking) return { booking, customPayment: null };

    const customPaymentResult = await admin
      .from("custom_payments")
      .select(
        "id, payer_name, phone, purpose, note, amount, currency, payment_status, merchant_trade_no, acpay_trade_no, paid_at",
      )
      .eq("merchant_trade_no", outTradeNo)
      .maybeSingle();

    if (customPaymentResult.error) {
      console.warn("[acpay] result custom payment lookup failed", {
        outTradeNo,
        error: customPaymentResult.error.message,
      });
      return { booking: null, customPayment: null };
    }

    return { booking: null, customPayment: (customPaymentResult.data as CustomPaymentResultRow | null) || null };
  } catch (error) {
    console.warn("[acpay] result lookup skipped", {
      outTradeNo,
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return { booking: null, customPayment: null };
  }
}

export default async function AcpayResultPage({ searchParams }: AcpayResultPageProps) {
  const params = searchParams ? await searchParams : {};
  const resultCode = readParam(params, "result_code");
  const payResult = readParam(params, "pay_result");
  const transactionId = readParam(params, "transaction_id");
  const outTradeNo = readParam(params, "out_trade_no");
  const isSuccess = resultCode === "0" && payResult === "0";
  const isPending = !resultCode && !payResult;
  const { booking, customPayment } = await findPaymentTargetByOutTradeNo(outTradeNo);
  const summaryRows = booking
    ? buildTrialBookingRows(booking, isSuccess, isPending)
    : customPayment
      ? buildCustomPaymentRows(customPayment, isSuccess, isPending)
      : [{ label: "付款狀態", value: paymentStatusLabel(null, isSuccess, isPending) }];
  const isCustomPayment = Boolean(customPayment);
  const callbackQuery = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] || "" : value || ""]),
  );

  recordAcpayChecklist({
    callbackQuery,
    outTradeNo,
    transactionId,
  });
  console.info("[acpay] callback query for checklist", {
    outTradeNo: outTradeNo || null,
    hasTransactionId: Boolean(transactionId),
    hasBooking: Boolean(booking),
    hasCustomPayment: Boolean(customPayment),
    callbackQuery,
  });

  return (
    <main className="acpayResultPage">
      <section className="acpayResultCard">
        <p className="acpayResultEyebrow">{isSuccess ? (isCustomPayment ? "付款成功" : "預約成功") : "付款結果"}</p>
        <h1>
          {isSuccess
            ? isCustomPayment
              ? "付款資料已送出"
              : "付款與預約資料已送出"
            : isPending
              ? "付款結果確認中"
              : "付款未完成"}
        </h1>
        <p className="acpayResultLead">
          {isSuccess
            ? isCustomPayment
              ? "我們已收到您的付款資訊，BigE 團隊將依照付款用途協助後續確認。"
              : "歡迎報名 BigE 的體驗課程，我們已收到您的預約資料，團隊將會盡快與您聯繫，協助確認實際體驗時間。"
            : "若您已完成付款但畫面顯示尚未完成，請稍候再重新整理，或透過官方 LINE 聯繫 BigE 團隊。"}
        </p>

        <dl className="acpayResultSummary">
          {summaryRows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>

        {isSuccess && booking ? (
          <>
            <div className="trialBookingSuccessCopy">
              <p>體驗課程約 1.5～2 小時，實際時間會依課程內容與現場狀況調整。</p>
              <p>如需取消或改期，請至少於 24 小時前聯繫 BigE 團隊。</p>
              <p>期待與您在 BigE 見面，協助您完成這次體驗課程。</p>
              <p>若有任何問題，歡迎透過官方 LINE 與我們聯繫。</p>
            </div>

            <div className="trialBookingSuccessNotice">
              <strong>提醒您</strong>
              <p>若臨時未到且未事先告知，可能會影響後續安排。</p>
            </div>
          </>
        ) : null}

        <div className="acpayResultActions">
          <a className="acpayResultBtn acpayResultBtnSecondary" href={LINE_URL} target="_blank" rel="noopener noreferrer">
            聯繫 LINE
          </a>
          <Link className="acpayResultBtn acpayResultBtnPrimary" href="/">
            回到首頁
          </Link>
        </div>
      </section>
    </main>
  );
}
