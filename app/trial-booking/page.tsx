"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";

type TrialService =
  | "weight_training"
  | "boxing_fitness"
  | "pilates"
  | "sports_massage";

type PreferredTime =
  | "weekday_morning"
  | "weekday_afternoon"
  | "weekday_evening"
  | "weekend_morning"
  | "weekend_afternoon"
  | "weekend_evening"
  | "other";

type PaymentMethod = "cash_on_site" | "online_payment";
type PaymentStatus = "pending_cash" | "pending_payment";

type TrialBookingFormData = {
  name: string;
  phone: string;
  lineName: string;
  service: TrialService | "";
  preferredTime: PreferredTime | "";
  paymentMethod: PaymentMethod | "";
  note: string;
};

type TrialBookingErrors = Partial<Record<keyof TrialBookingFormData, string>>;

type TrialBookingSuccess = {
  id: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  bookingStatus: "new";
};

const serviceOptions: Array<{ value: TrialService; label: string }> = [
  { value: "weight_training", label: "重量訓練" },
  { value: "boxing_fitness", label: "拳擊體能訓練" },
  { value: "pilates", label: "器械皮拉提斯" },
  { value: "sports_massage", label: "運動按摩" },
];

const preferredTimeOptions: Array<{ value: PreferredTime; label: string }> = [
  { value: "weekday_morning", label: "平日上午" },
  { value: "weekday_afternoon", label: "平日下午" },
  { value: "weekday_evening", label: "平日晚上" },
  { value: "weekend_morning", label: "假日上午" },
  { value: "weekend_afternoon", label: "假日下午" },
  { value: "weekend_evening", label: "假日晚上" },
  { value: "other", label: "其他，請於備註說明" },
];

const paymentMethodOptions: Array<{
  value: PaymentMethod;
  label: string;
  description: string;
}> = [
  {
    value: "cash_on_site",
    label: "當天付現",
    description: "送出預約後，由專人協助確認時段，體驗當天現場付款。",
  },
  {
    value: "online_payment",
    label: "線上付款",
    description: "線上付款功能即將開放，本階段會先保留您的預約需求。",
  },
];

const initialFormData: TrialBookingFormData = {
  name: "",
  phone: "",
  lineName: "",
  service: "",
  preferredTime: "",
  paymentMethod: "",
  note: "",
};

function getServiceLabel(value: TrialService | "") {
  return serviceOptions.find((option) => option.value === value)?.label ?? "-";
}

function getPreferredTimeLabel(value: PreferredTime | "") {
  return preferredTimeOptions.find((option) => option.value === value)?.label ?? "-";
}

function getPaymentMethodLabel(value: PaymentMethod | "") {
  return paymentMethodOptions.find((option) => option.value === value)?.label ?? "-";
}

function getPaymentStatusText(value: PaymentStatus) {
  if (value === "pending_cash") {
    return "當天付現，待專人確認時段";
  }
  return "線上付款待開放，待專人確認付款安排";
}

export default function TrialBookingPage() {
  const [formData, setFormData] = useState<TrialBookingFormData>(initialFormData);
  const [errors, setErrors] = useState<TrialBookingErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedBooking, setSubmittedBooking] = useState<TrialBookingSuccess | null>(null);

  const successMessage = useMemo(() => {
    if (!submittedBooking) return "";
    return submittedBooking.paymentMethod === "cash_on_site"
      ? "我們已收到您的首次體驗預約需求。付款方式為「當天付現」，後續將由專人協助確認可預約時段。"
      : "我們已收到您的首次體驗預約需求。您選擇的是「線上付款」，線上付款功能目前建置中，後續將由專人協助確認付款與預約安排。";
  }, [submittedBooking]);

  function updateField<K extends keyof TrialBookingFormData>(field: K, value: TrialBookingFormData[K]) {
    setFormData((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setSubmitError("");
  }

  function validate(data: TrialBookingFormData) {
    const nextErrors: TrialBookingErrors = {};

    if (!data.name.trim()) nextErrors.name = "請輸入姓名";
    if (!data.phone.trim()) nextErrors.phone = "請輸入可聯絡電話";
    if (!data.service) nextErrors.service = "請選擇想體驗項目";
    if (!data.preferredTime) nextErrors.preferredTime = "請選擇方便預約時段";
    if (!data.paymentMethod) nextErrors.paymentMethod = "請選擇付款方式";

    return nextErrors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const nextErrors = validate(formData);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setSubmitError("請先完成必填欄位，再送出預約資料。");
      return;
    }

    setErrors({});
    setSubmitError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/trial-booking/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: formData.name,
          phone: formData.phone,
          lineName: formData.lineName,
          service: formData.service,
          preferredTime: formData.preferredTime,
          paymentMethod: formData.paymentMethod,
          note: formData.note,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            booking?: TrialBookingSuccess;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.ok || !payload.booking) {
        setSubmitError(payload?.error || "目前無法送出預約資料，請稍後再試。");
        return;
      }

      setSubmittedBooking(payload.booking);

      // 第二階段已改為送到 /api/trial-booking/create
      // 第三階段可依 paymentMethod 決定是否導向 ACPay
    } catch {
      setSubmitError("送出失敗，請確認網路連線後再試一次。");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    setFormData(initialFormData);
    setErrors({});
    setSubmitError("");
    setSubmittedBooking(null);
    setIsSubmitting(false);
  }

  return (
    <main className="trialBookingPage">
      <section className="trialBookingShell">
        <div className="trialBookingIntro">
          <p className="trialBookingEyebrow">BIGE TRIAL</p>
          <h1 className="trialBookingTitle">BigE 首次體驗預約</h1>
          <p className="trialBookingLead">
            填寫資料後，將由專人協助確認體驗項目與可預約時段。
          </p>
        </div>

        <div className="trialBookingCard">
          {submittedBooking ? (
            <section className="trialBookingSuccessCard" aria-live="polite">
              <p className="trialBookingSuccessBadge">預約成功</p>
              <h2>預約資料已送出</h2>
              <p className="trialBookingSuccessText">{successMessage}</p>

              <dl className="trialBookingSummary">
                <div>
                  <dt>預約編號</dt>
                  <dd>{submittedBooking.id}</dd>
                </div>
                <div>
                  <dt>姓名</dt>
                  <dd>{formData.name}</dd>
                </div>
                <div>
                  <dt>電話</dt>
                  <dd>{formData.phone}</dd>
                </div>
                <div>
                  <dt>體驗項目</dt>
                  <dd>{getServiceLabel(formData.service)}</dd>
                </div>
                <div>
                  <dt>方便時段</dt>
                  <dd>{getPreferredTimeLabel(formData.preferredTime)}</dd>
                </div>
                <div>
                  <dt>付款方式</dt>
                  <dd>{getPaymentMethodLabel(submittedBooking.paymentMethod)}</dd>
                </div>
                <div>
                  <dt>付款狀態</dt>
                  <dd>{getPaymentStatusText(submittedBooking.paymentStatus)}</dd>
                </div>
              </dl>

              <div className="trialBookingActions">
                <Link className="trialBookingBtn trialBookingBtnPrimary" href="/">
                  返回首頁
                </Link>
                <button className="trialBookingBtn trialBookingBtnSecondary" type="button" onClick={handleReset}>
                  重新填寫
                </button>
              </div>
            </section>
          ) : (
            <form className="trialBookingForm" onSubmit={handleSubmit} noValidate>
              <div className="trialBookingField">
                <label className="trialBookingLabel" htmlFor="trial-name">姓名</label>
                <input
                  id="trial-name"
                  className="trialBookingInput"
                  value={formData.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  placeholder="請輸入您的姓名"
                  autoComplete="name"
                  maxLength={50}
                />
                {errors.name ? <p className="trialBookingFieldError">{errors.name}</p> : null}
              </div>

              <div className="trialBookingField">
                <label className="trialBookingLabel" htmlFor="trial-phone">電話</label>
                <input
                  id="trial-phone"
                  className="trialBookingInput"
                  value={formData.phone}
                  onChange={(event) => updateField("phone", event.target.value)}
                  placeholder="請輸入可聯絡電話"
                  autoComplete="tel"
                  inputMode="tel"
                  maxLength={30}
                />
                {errors.phone ? <p className="trialBookingFieldError">{errors.phone}</p> : null}
              </div>

              <div className="trialBookingField">
                <label className="trialBookingLabel" htmlFor="trial-line-name">LINE 名稱</label>
                <input
                  id="trial-line-name"
                  className="trialBookingInput"
                  value={formData.lineName}
                  onChange={(event) => updateField("lineName", event.target.value)}
                  placeholder="方便我們辨識您的 LINE 名稱"
                  maxLength={80}
                />
              </div>

              <div className="trialBookingField">
                <label className="trialBookingLabel" htmlFor="trial-service">想體驗項目</label>
                <select
                  id="trial-service"
                  className="trialBookingInput trialBookingSelect"
                  value={formData.service}
                  onChange={(event) => updateField("service", event.target.value as TrialService | "")}
                >
                  <option value="">請選擇體驗項目</option>
                  {serviceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {errors.service ? <p className="trialBookingFieldError">{errors.service}</p> : null}
              </div>

              <div className="trialBookingField">
                <label className="trialBookingLabel" htmlFor="trial-preferred-time">方便預約時段</label>
                <select
                  id="trial-preferred-time"
                  className="trialBookingInput trialBookingSelect"
                  value={formData.preferredTime}
                  onChange={(event) => updateField("preferredTime", event.target.value as PreferredTime | "")}
                >
                  <option value="">請選擇方便預約時段</option>
                  {preferredTimeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {errors.preferredTime ? <p className="trialBookingFieldError">{errors.preferredTime}</p> : null}
              </div>

              <fieldset className="trialBookingFieldset">
                <legend className="trialBookingLegend">付款方式</legend>
                <div className="trialBookingRadioGroup">
                  {paymentMethodOptions.map((option) => (
                    <label
                      key={option.value}
                      className={`trialBookingRadioCard${formData.paymentMethod === option.value ? " is-selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="paymentMethod"
                        value={option.value}
                        checked={formData.paymentMethod === option.value}
                        onChange={(event) => updateField("paymentMethod", event.target.value as PaymentMethod)}
                      />
                      <span className="trialBookingRadioTitle">{option.label}</span>
                      <span className="trialBookingRadioDescription">{option.description}</span>
                    </label>
                  ))}
                </div>
                {errors.paymentMethod ? <p className="trialBookingFieldError">{errors.paymentMethod}</p> : null}
              </fieldset>

              <div className="trialBookingField">
                <label className="trialBookingLabel" htmlFor="trial-note">備註</label>
                <textarea
                  id="trial-note"
                  className="trialBookingInput trialBookingTextarea"
                  value={formData.note}
                  onChange={(event) => updateField("note", event.target.value)}
                  placeholder="例如想體驗的日期、運動經驗、特殊需求等"
                  rows={5}
                  maxLength={500}
                />
              </div>

              {submitError ? <div className="trialBookingError">{submitError}</div> : null}

              <button className="trialBookingSubmit" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "送出中..." : "送出預約資料"}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
