"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";

type PaymentPurpose = "course_fee" | "price_difference" | "event_fee" | "other";

type CustomPaymentFormData = {
  amount: string;
  payerName: string;
  phone: string;
  purpose: PaymentPurpose | "";
  note: string;
};

type CustomPaymentErrors = Partial<Record<keyof CustomPaymentFormData, string>>;

type CreatePaymentSuccess = {
  id: string;
  amount: number;
  paymentStatus: "pending_payment";
};

type CreateAcpayPaymentSuccess = {
  codeUrl: string;
  outTradeNo: string;
  customPaymentId: string;
};

const purposeOptions: Array<{ value: PaymentPurpose; label: string; description: string }> = [
  {
    value: "course_fee",
    label: "課程費用",
    description: "用於單堂課程、方案尾款或已確認的課程款項。",
  },
  {
    value: "price_difference",
    label: "補差額",
    description: "用於方案調整、服務升級或其他差額補款。",
  },
  {
    value: "event_fee",
    label: "活動費用",
    description: "用於講座、活動、工作坊或限定體驗費用。",
  },
  {
    value: "other",
    label: "其他",
    description: "若不屬於上述項目，請於備註補充付款內容。",
  },
];

const initialFormData: CustomPaymentFormData = {
  amount: "",
  payerName: "",
  phone: "",
  purpose: "course_fee",
  note: "",
};

function formatCurrency(amount: string) {
  if (!amount) return "";
  return `NT$${Number(amount).toLocaleString("zh-TW")}`;
}

function validateAmount(value: string) {
  if (!value.trim()) return "請輸入付款金額。";
  if (value !== value.trim()) return "金額不可包含空白。";
  if (!/^\d+$/.test(value)) return "金額必須為不含逗號、空白、小數或符號的正整數。";
  if (Number(value) <= 0) return "金額必須大於 0。";
  return "";
}

function validateForm(data: CustomPaymentFormData) {
  const errors: CustomPaymentErrors = {};
  const amountError = validateAmount(data.amount);

  if (amountError) errors.amount = amountError;
  if (!data.payerName.trim()) errors.payerName = "請輸入姓名。";
  if (!data.phone.trim()) errors.phone = "請輸入電話。";
  if (!data.purpose) errors.purpose = "請選擇付款用途。";

  return errors;
}

export default function CustomPaymentPage() {
  const [formData, setFormData] = useState<CustomPaymentFormData>(initialFormData);
  const [errors, setErrors] = useState<CustomPaymentErrors>({});
  const [isConfirming, setIsConfirming] = useState(false);
  const [notice, setNotice] = useState("");
  const [createdPayment, setCreatedPayment] = useState<CreatePaymentSuccess | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingAcpay, setIsCreatingAcpay] = useState(false);

  const formattedAmount = useMemo(() => formatCurrency(formData.amount), [formData.amount]);

  function updateField<K extends keyof CustomPaymentFormData>(field: K, value: CustomPaymentFormData[K]) {
    setFormData((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setNotice("");
  }

  function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateForm(formData);

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setIsConfirming(false);
      return;
    }

    setErrors({});
    setIsConfirming(true);
  }

  async function createPaymentRecord() {
    if (createdPayment) return createdPayment;

    setIsCreating(true);

    try {
      const response = await fetch("/api/custom-payment/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payerName: formData.payerName,
          phone: formData.phone,
          purpose: formData.purpose,
          note: formData.note,
          amount: formData.amount,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (Partial<CreatePaymentSuccess> & { ok?: boolean; error?: string })
        | null;

      if (!response.ok || !payload?.ok || !payload.id || typeof payload.amount !== "number") {
        setNotice(payload?.error || "付款資料建立失敗，請稍後再試。");
        return;
      }

      setCreatedPayment({
        id: payload.id,
        amount: payload.amount,
        paymentStatus: "pending_payment",
      });
      return {
        id: payload.id,
        amount: payload.amount,
        paymentStatus: "pending_payment" as const,
      };
    } catch {
      setNotice("目前無法建立付款資料，請稍後再試。");
      return null;
    } finally {
      setIsCreating(false);
    }
  }

  async function handleCreateAcpayPayment() {
    if (isCreating || isCreatingAcpay) return;

    setNotice("");
    const payment = await createPaymentRecord();
    if (!payment) return;

    setIsCreatingAcpay(true);

    try {
      const response = await fetch("/api/acpay/create-custom-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customPaymentId: payment.id }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (Partial<CreateAcpayPaymentSuccess> & { ok?: boolean; error?: string })
        | null;

      if (!response.ok || !payload?.ok || !payload.codeUrl) {
        setNotice(payload?.error || "ACPay 付款建立失敗，請稍後再試。");
        return;
      }

      setNotice("即將前往 ACPay 安全付款頁，請確認金額無誤。");
      window.location.assign(payload.codeUrl);
    } catch {
      setNotice("目前無法建立 ACPay 付款，請稍後再試。");
    } finally {
      setIsCreatingAcpay(false);
    }
  }

  return (
    <main className="customPaymentPage">
      <section className="customPaymentShell">
        <div className="customPaymentIntro">
          <p className="customPaymentEyebrow">BIGE PAYMENT</p>
          <h1>自訂金額付款</h1>
          <p>
            請輸入付款資訊並再次確認金額。確認無誤後，未來將導向 ACPay 安全付款頁完成付款。
          </p>
        </div>

        <div className="customPaymentCard">
          {isConfirming ? (
            <section className="customPaymentConfirm" aria-live="polite">
              <p className="customPaymentStepLabel">確認付款資訊</p>
              <h2>{formattedAmount}</h2>
              <p className="customPaymentConfirmLead">
                {createdPayment
                  ? "自訂付款資料已建立，接著會進入 ACPay 安全付款頁。"
                  : "請確認以下資訊正確，送出後會先建立一筆待付款資料。"}
              </p>

              <dl className="customPaymentSummary">
                <div>
                  <dt>付款金額</dt>
                  <dd>{formattedAmount}</dd>
                </div>
                <div>
                  <dt>姓名</dt>
                  <dd>{formData.payerName.trim()}</dd>
                </div>
                <div>
                  <dt>電話</dt>
                  <dd>{formData.phone.trim()}</dd>
                </div>
                {formData.note.trim() ? (
                  <div>
                    <dt>備註</dt>
                    <dd>{formData.note.trim()}</dd>
                  </div>
                ) : null}
                {createdPayment ? (
                  <div>
                    <dt>付款狀態</dt>
                    <dd>待付款</dd>
                  </div>
                ) : null}
              </dl>

              {notice ? <p className="customPaymentNotice">{notice}</p> : null}

              <div className="customPaymentActions">
                <button
                  className="customPaymentButton customPaymentButtonSecondary"
                  type="button"
                  onClick={() => {
                    setIsConfirming(false);
                    setNotice("");
                    setCreatedPayment(null);
                    setIsCreatingAcpay(false);
                  }}
                >
                  返回修改
                </button>
                <button
                  className="customPaymentButton customPaymentButtonGold"
                  type="button"
                  onClick={handleCreateAcpayPayment}
                  disabled={isCreating || isCreatingAcpay}
                >
                  {isCreating || isCreatingAcpay ? "建立付款中..." : "前往 ACPay 安全付款"}
                </button>
              </div>
            </section>
          ) : (
            <form className="customPaymentForm" onSubmit={handleConfirm} noValidate>
              <section className="customPaymentField customPaymentAmountField">
                <label htmlFor="custom-payment-amount">付款金額</label>
                <div className="customPaymentAmountInputWrap">
                  <span>NT$</span>
                  <input
                    id="custom-payment-amount"
                    inputMode="numeric"
                    autoComplete="off"
                    value={formData.amount}
                    onChange={(event) => updateField("amount", event.target.value)}
                    placeholder="請輸入正整數金額"
                    aria-describedby={errors.amount ? "custom-payment-amount-error" : undefined}
                  />
                </div>
                {formattedAmount && !errors.amount ? (
                  <p className="customPaymentHint">付款金額：{formattedAmount}</p>
                ) : null}
                {errors.amount ? (
                  <p className="customPaymentError" id="custom-payment-amount-error">
                    {errors.amount}
                  </p>
                ) : null}
              </section>

              <div className="customPaymentGrid">
                <section className="customPaymentField">
                  <label htmlFor="custom-payment-name">姓名</label>
                  <input
                    id="custom-payment-name"
                    value={formData.payerName}
                    onChange={(event) => updateField("payerName", event.target.value)}
                    placeholder="請輸入付款人姓名"
                    autoComplete="name"
                    maxLength={50}
                  />
                  {errors.payerName ? <p className="customPaymentError">{errors.payerName}</p> : null}
                </section>

                <section className="customPaymentField">
                  <label htmlFor="custom-payment-phone">電話</label>
                  <input
                    id="custom-payment-phone"
                    value={formData.phone}
                    onChange={(event) => updateField("phone", event.target.value)}
                    placeholder="請輸入聯絡電話"
                    autoComplete="tel"
                    inputMode="tel"
                    maxLength={30}
                  />
                  {errors.phone ? <p className="customPaymentError">{errors.phone}</p> : null}
                </section>
              </div>

              <section className="customPaymentField">
                <label htmlFor="custom-payment-note">備註</label>
                <textarea
                  id="custom-payment-note"
                  value={formData.note}
                  onChange={(event) => updateField("note", event.target.value)}
                  placeholder="可補充課程名稱、付款原因或與 BigE 團隊確認過的事項"
                  rows={5}
                  maxLength={500}
                />
              </section>

              <button className="customPaymentButton customPaymentButtonPrimary" type="submit">
                確認付款資訊
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
