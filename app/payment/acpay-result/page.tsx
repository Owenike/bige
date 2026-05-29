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
  if (value === "boxing_fitness") return "拳擊體能";
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
    other: "其他時段",
  };
  return value ? labels[value] || value : "";
}

function paymentMethodLabel(value: string | null) {
  if (value === "online_payment") return "線上付款";
  if (value === "cash_on_site") return "現場付款";
  return value || "";
}

function paymentStatusLabel(value: string | null, isSuccess: boolean, isPending: boolean) {
  if (value === "paid") return "付款已完成";
  if (value === "pending_payment") return "線上付款待付款";
  if (value === "pending_cash") return "現場付款待確認";
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

function buildSummaryRows(booking: TrialBookingResultRow | null, isSuccess: boolean, isPending: boolean) {
  const rows: SummaryRow[] = [];

  if (booking) {
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

  addRow(rows, "付款狀態", paymentStatusLabel(null, isSuccess, isPending));
  return rows;
}

async function findTrialBookingByOutTradeNo(outTradeNo: string) {
  if (!outTradeNo) return null;

  try {
    const admin = createSupabaseAdminClient();
    const result = await admin
      .from("trial_bookings")
      .select(
        "id, name, phone, birthday, service, preferred_time, note, payment_method, payment_status, amount, currency, merchant_trade_no, acpay_trade_no, paid_at",
      )
      .eq("merchant_trade_no", outTradeNo)
      .maybeSingle();

    if (result.error) {
      console.warn("[acpay] result booking lookup failed", {
        outTradeNo,
        error: result.error.message,
      });
      return null;
    }

    return (result.data as TrialBookingResultRow | null) || null;
  } catch (error) {
    console.warn("[acpay] result booking lookup skipped", {
      outTradeNo,
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return null;
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
  const booking = await findTrialBookingByOutTradeNo(outTradeNo);
  const summaryRows = buildSummaryRows(booking, isSuccess, isPending);
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
    callbackQuery,
  });

  return (
    <main className="acpayResultPage">
      <section className="acpayResultCard">
        <p className="acpayResultEyebrow">{isSuccess ? "預約成功" : "付款結果"}</p>
        <h1>{isSuccess ? "付款與預約資料已送出" : isPending ? "付款結果確認中" : "付款未完成"}</h1>
        <p className="acpayResultLead">
          {isSuccess
            ? "歡迎報名 BigE 的體驗課程，我們已收到您的預約資料，團隊將會盡快與您聯繫，協助確認實際體驗時間。"
            : "目前付款尚未完成。如有疑問，歡迎透過官方 LINE 與 BigE 團隊聯繫。"}
        </p>

        <dl className="acpayResultSummary">
          {summaryRows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>

        {isSuccess ? (
          <>
            <div className="trialBookingSuccessCopy">
              <p>體驗課程約 1.5～2 小時，實際時間會依課程內容與現場狀況調整。</p>
              <p>如需取消或改期，請至少於 24 小時前聯繫 BigE 團隊。</p>
            </div>

            <div className="trialBookingSuccessNotice">
              <strong>提醒您</strong>
              <p>若臨時未到且未事先告知，可能會影響後續安排。</p>
            </div>

            <div className="trialBookingSuccessCopy">
              <p>期待與您在 BigE 見面，協助您完成這次體驗課程。</p>
              <p>若有任何問題，歡迎透過官方 LINE 與我們聯繫。</p>
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
