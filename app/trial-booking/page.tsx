"use client";

import Image from "next/image";
import Link from "next/link";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";

type TrialService = "weight_training" | "pilates" | "sports_massage";

type PreferredTime =
  | "weekday_afternoon"
  | "weekday_evening"
  | "weekend_afternoon"
  | "weekend_evening";

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

const isAcpayTrialPaymentEnabled = process.env.NEXT_PUBLIC_ACPAY_TRIAL_PAYMENT_ENABLED === "true";

const serviceOptions: Array<{
  value: TrialService;
  label: string;
  description: string;
  price: string;
  imageSrc: string;
  imageAlt: string;
}> = [
  {
    value: "weight_training",
    label: "重量訓練",
    description: "建立肌力、體態與動作品質，適合想改善身形、增加肌力或重新開始訓練的人。",
    price: "首次體驗 NT$880",
    imageSrc: "/home-images/bige-weight-training-chest-press.png",
    imageAlt: "BigE 重量訓練胸推器械",
  },
  {
    value: "pilates",
    label: "器械皮拉提斯",
    description: "透過器械輔助建立核心控制、線條雕塑與姿勢調整，適合想提升體態與身體覺察的人。",
    price: "首次體驗 NT$880",
    imageSrc: "/home-images/bige-reformer-pilates.png",
    imageAlt: "BigE 器械皮拉提斯",
  },
  {
    value: "sports_massage",
    label: "運動按摩",
    description: "針對疲勞緊繃與身體放鬆需求，協助釋放壓力、恢復狀態與提升活動舒適度。",
    price: "首次體驗 NT$1,500",
    imageSrc: "/home-images/bige-sports-massage-recovery.png",
    imageAlt: "BigE 運動按摩恢復",
  },
];

const preferredTimeOptions: Array<{ value: PreferredTime; label: string }> = [
  { value: "weekday_afternoon", label: "平日下午" },
  { value: "weekday_evening", label: "平日晚上" },
  { value: "weekend_afternoon", label: "假日下午" },
  { value: "weekend_evening", label: "假日晚上" },
];

const paymentMethodOptions: Array<{
  value: PaymentMethod;
  label: string;
  description: string;
}> = [
  {
    value: "cash_on_site",
    label: "現場付款",
    description: "送出預約後，由專人協助確認時段，體驗當天現場付款。",
  },
];

const initialFormData: TrialBookingFormData = {
  name: "",
  phone: "",
  lineName: "",
  service: "",
  preferredTime: "",
  paymentMethod: "cash_on_site",
  note: "",
};

const BIGE_HOME_URL = "/";
const BIGE_COURSE_URL = "/training/pilates";
const BIGE_LINE_URL = "https://lin.ee/0GWm0oZ";

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
    return "現場付款，待 BigE 團隊確認體驗時段。";
  }
  return "線上付款待確認，BigE 團隊將協助完成付款與預約安排。";
}

export default function TrialBookingPage() {
  const [formData, setFormData] = useState<TrialBookingFormData>(initialFormData);
  const [errors, setErrors] = useState<TrialBookingErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acpayLoading, setAcpayLoading] = useState(false);
  const [acpayError, setAcpayError] = useState("");
  const [submittedBooking, setSubmittedBooking] = useState<TrialBookingSuccess | null>(null);

  const successMessage = useMemo(() => {
    if (!submittedBooking) return "";
    return submittedBooking.paymentMethod === "cash_on_site"
      ? "我們已收到您的首次體驗預約需求。付款方式為「現場付款」，後續將由專人協助確認可預約時段。"
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

    if (!data.name.trim()) nextErrors.name = "請填寫姓名";
    if (!data.phone.trim()) nextErrors.phone = "請填寫電話";
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
      setSubmitError("請確認必填欄位已完成，再送出預約。");
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
          lineName: "",
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
        setSubmitError(payload?.error || "建立首次體驗預約失敗，請稍後再試。");
        return;
      }

      setSubmittedBooking(payload.booking);
    } catch {
      setSubmitError("預約送出失敗，請稍後再試或直接聯繫 BigE 團隊。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAcpayPayment() {
    if (acpayLoading) return;

    setAcpayError("");
    setAcpayLoading(true);

    try {
      const amount = formData.service === "sports_massage" ? 1500 : 880;
      const response = await fetch("/api/acpay/create-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            codeUrl?: string;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.ok || !payload.codeUrl) {
        setAcpayError(payload?.error || "線上付款連結建立失敗，請稍後再試。");
        return;
      }

      window.location.href = payload.codeUrl;
    } catch {
      setAcpayError("目前無法建立付款連結，請稍後再試或改用現場付款。");
    } finally {
      setAcpayLoading(false);
    }
  }

  function handleReset() {
    setFormData(initialFormData);
    setErrors({});
    setSubmitError("");
    setAcpayError("");
    setSubmittedBooking(null);
    setIsSubmitting(false);
    setAcpayLoading(false);
  }

  return (
    <main className="trialBookingPage">
      <header className="trialBookingHeader">
        <Link className="trialBookingBrand" href={BIGE_HOME_URL} aria-label="BIGE home">
          <span>BIGE</span>
          <small>仁武質感健身體驗</small>
        </Link>
        <nav className="trialBookingNav" aria-label="BigE trial booking navigation">
          <Link href={BIGE_COURSE_URL}>課程介紹</Link>
          <a href={BIGE_LINE_URL} target="_blank" rel="noreferrer">
            LINE 諮詢
          </a>
        </nav>
      </header>

      <section className="trialBookingShell">
        <div className="trialBookingIntro">
          <p className="trialBookingEyebrow">BIGE TRIAL</p>
          <h1 className="trialBookingTitle">開始你的第一次 BigE 體驗</h1>
          <p className="trialBookingLead">
            選擇想體驗的項目與方便時段，BigE 團隊將協助安排適合的教練，帶你從第一次體驗開始建立身體改變。
          </p>
        </div>

        <div className="trialBookingCard" id="trial-booking-form">
          {submittedBooking ? (
            <section className="trialBookingSuccessCard" aria-live="polite">
              <p className="trialBookingSuccessBadge">預約成功</p>
              <h2>預約資料已送出</h2>
              <p className="trialBookingSuccessText">{successMessage}</p>

              <dl className="trialBookingSummary">
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
                <Link className="trialBookingBtn trialBookingBtnPrimary" href={BIGE_HOME_URL}>
                  回到首頁
                </Link>
                <button className="trialBookingBtn trialBookingBtnSecondary" type="button" onClick={handleReset}>
                  再填一筆
                </button>
              </div>
            </section>
          ) : (
            <form className="trialBookingForm" onSubmit={handleSubmit} noValidate>
              <section className="trialBookingStep" aria-labelledby="trial-service-heading">
                <div className="trialBookingStepHead">
                  <span>01</span>
                  <div>
                    <h2 id="trial-service-heading">選擇體驗項目</h2>
                    <p>先選擇你想開始的方向，我們會依照你的目標與需求，協助安排合適的體驗內容。</p>
                  </div>
                </div>
                <div className="trialBookingServiceGrid">
                  {serviceOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`trialBookingServiceCard${formData.service === option.value ? " is-selected" : ""}`}
                      onClick={() => updateField("service", option.value)}
                      aria-pressed={formData.service === option.value}
                    >
                      <span className="trialBookingServiceImage">
                        <Image src={option.imageSrc} alt={option.imageAlt} width={640} height={400} />
                      </span>
                      <span className="trialBookingServiceCopy">
                        <span className="trialBookingServiceTitle">{option.label}</span>
                        <span className="trialBookingServiceDescription">{option.description}</span>
                        <span className="trialBookingServicePrice">{option.price}</span>
                        <span className="trialBookingSelectedText">
                          {formData.service === option.value ? "已選擇" : "選擇"}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                {errors.service ? <p className="trialBookingFieldError">{errors.service}</p> : null}
              </section>

              <section className="trialBookingStep" aria-labelledby="trial-time-heading">
                <div className="trialBookingStepHead">
                  <span>02</span>
                  <div>
                    <h2 id="trial-time-heading">選擇方便時段</h2>
                    <p>先選擇你方便聯繫與安排的時段，實際課程時間將由專人再與你確認。</p>
                  </div>
                </div>
                <div className="trialBookingChipGroup" role="group" aria-label="方便預約時段">
                  {preferredTimeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`trialBookingChip${formData.preferredTime === option.value ? " is-selected" : ""}`}
                      onClick={() => updateField("preferredTime", option.value)}
                      aria-pressed={formData.preferredTime === option.value}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {errors.preferredTime ? <p className="trialBookingFieldError">{errors.preferredTime}</p> : null}
              </section>

              <section className="trialBookingStep" aria-labelledby="trial-contact-heading">
                <div className="trialBookingStepHead">
                  <span>03</span>
                  <div>
                    <h2 id="trial-contact-heading">留下聯絡方式</h2>
                    <p>留下基本聯絡資訊後，BigE 團隊將協助確認體驗項目、時段與付款方式。</p>
                  </div>
                </div>
                <div className="trialBookingContactGrid">
                  <div className="trialBookingField">
                    <label className="trialBookingLabel" htmlFor="trial-name">姓名</label>
                    <input
                      id="trial-name"
                      className="trialBookingInput"
                      value={formData.name}
                      onChange={(event) => updateField("name", event.target.value)}
                      placeholder="請輸入姓名"
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
                      placeholder="請輸入手機號碼"
                      autoComplete="tel"
                      inputMode="tel"
                      maxLength={30}
                    />
                    {errors.phone ? <p className="trialBookingFieldError">{errors.phone}</p> : null}
                  </div>

                  <div className="trialBookingField trialBookingFieldWide">
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
                </div>
              </section>

              <section className="trialBookingStep" aria-labelledby="trial-confirm-heading">
                <div className="trialBookingStepHead">
                  <span>04</span>
                  <div>
                    <h2 id="trial-confirm-heading">確認並送出</h2>
                    <p>首次體驗費用：重量訓練與器械皮拉提斯為 NT$880，運動按摩為 NT$1,500。送出後，BigE 團隊將與你確認實際體驗時段與付款方式。</p>
                  </div>
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
              </section>

              {submitError ? <div className="trialBookingError">{submitError}</div> : null}

              <button className="trialBookingSubmit" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "送出中..." : "送出首次體驗預約"}
              </button>
              {isAcpayTrialPaymentEnabled ? (
                <div className="trialBookingAcpayBox">
                  <button
                    className="trialBookingAcpayButton"
                    type="button"
                    onClick={handleAcpayPayment}
                    disabled={acpayLoading}
                  >
                    {acpayLoading ? "正在建立付款連結..." : "線上付款預約體驗"}
                  </button>
                  <p className="trialBookingAcpayHint">
                    將開啟 ACpay 測試付款頁；付款結果仍以系統通知確認為準。
                  </p>
                  {acpayError ? <div className="trialBookingError">{acpayError}</div> : null}
                </div>
              ) : null}
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
