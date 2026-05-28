import Link from "next/link";
import { recordAcpayChecklist } from "../../../lib/acpay-checklist";

type AcpayResultPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const LINE_URL = "https://lin.ee/0GWm0oZ";

function readParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function AcpayResultPage({ searchParams }: AcpayResultPageProps) {
  const params = searchParams ? await searchParams : {};
  const resultCode = readParam(params, "result_code");
  const payResult = readParam(params, "pay_result");
  const transactionId = readParam(params, "transaction_id");
  const outTradeNo = readParam(params, "out_trade_no");
  const isSuccess = resultCode === "0" && payResult === "0";
  const isPending = !resultCode && !payResult;
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
    callbackQuery,
  });

  return (
    <main className="acpayResultPage">
      <section className="acpayResultCard">
        <p className="acpayResultEyebrow">ACPAY RESULT</p>
        <h1>{isSuccess ? "付款已完成" : isPending ? "付款結果確認中" : "付款未完成"}</h1>
        <p className="acpayResultLead">
          {isSuccess
            ? "我們已收到您的付款結果，後續將由 BigE 團隊協助確認體驗時段。"
            : "這筆付款尚未完成或付款結果無法確認。你可以回到首頁、重新預約，或透過 LINE 聯繫 BigE 團隊。"}
        </p>

        <dl className="acpayResultSummary">
          <div>
            <dt>訂單編號</dt>
            <dd>{outTradeNo || "-"}</dd>
          </div>
          <div>
            <dt>交易序號</dt>
            <dd>{transactionId || "-"}</dd>
          </div>
          <div>
            <dt>付款狀態</dt>
            <dd>{isSuccess ? "成功" : isPending ? "確認中" : "未完成"}</dd>
          </div>
        </dl>

        <div className="acpayResultActions">
          <Link className="acpayResultBtn acpayResultBtnPrimary" href="/">
            回到首頁
          </Link>
          <a className="acpayResultBtn acpayResultBtnSecondary" href={LINE_URL} target="_blank" rel="noopener noreferrer">
            聯繫 LINE
          </a>
        </div>
      </section>
    </main>
  );
}
