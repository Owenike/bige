"use client";

import Image from "next/image";
import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

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
  birthday: string;
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
  amount: number | null;
  currency: string;
};

type BirthdayCalendarCell = {
  key: string;
  day: number | null;
  value: string;
  isToday: boolean;
  isSelected: boolean;
  isDisabled: boolean;
};

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
  {
    value: "online_payment",
    label: "線上付款",
    description: "可線上完成付款，預約送出後將進入 ACPay 安全付款頁。",
  },
];

const initialFormData: TrialBookingFormData = {
  name: "",
  phone: "",
  birthday: "",
  lineName: "",
  service: "",
  preferredTime: "",
  paymentMethod: "cash_on_site",
  note: "",
};

const BIGE_HOME_URL = "/";
const BIGE_COURSE_URL = "/training/pilates";
const BIGE_LINE_URL = "https://lin.ee/0GWm0oZ";
const PAYMENT_PREVIEW_TOKEN = "bige-acpay-preview";
const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BIRTHDAY_START_YEAR = 1920;

function getTodayDateInputValue() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function padDatePart(value: string) {
  return value.padStart(2, "0");
}

function getDaysInMonth(year: string, month: string) {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  if (!numericYear || !numericMonth) return 31;
  return new Date(numericYear, numericMonth, 0).getDate();
}

function buildBirthdayValue(year: string, month: string, day: string) {
  return `${year}-${padDatePart(month)}-${padDatePart(day)}`;
}

function buildBirthdayValueFromNumbers(year: number, month: number, day: number) {
  return buildBirthdayValue(String(year), String(month), String(day));
}

function splitBirthdayValue(value: string) {
  if (!DATE_INPUT_PATTERN.test(value)) {
    return { year: "", month: "", day: "" };
  }
  const [year, month, day] = value.split("-");
  return {
    year,
    month: String(Number(month)),
    day: String(Number(day)),
  };
}

function getBirthdayCalendarBase(value: string, fallback: string) {
  const parts = splitBirthdayValue(value || fallback);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
  };
}

function getServiceLabel(value: TrialService | "") {
  return serviceOptions.find((option) => option.value === value)?.label ?? "-";
}

function getPreferredTimeLabel(value: PreferredTime | "") {
  return preferredTimeOptions.find((option) => option.value === value)?.label ?? "-";
}

function getPaymentMethodLabel(value: PaymentMethod | "") {
  return paymentMethodOptions.find((option) => option.value === value)?.label ?? "-";
}

function RequiredBadge() {
  return <span className="trialBookingRequiredBadge">必填</span>;
}

function getPaymentStatusText(value: PaymentStatus) {
  if (value === "pending_cash") {
    return "現場付款，待 BigE 團隊確認體驗時段。";
  }
  return "付款完成後，BigE 團隊將協助確認體驗時段。";
}

export default function TrialBookingPage() {
  const [formData, setFormData] = useState<TrialBookingFormData>(initialFormData);
  const [errors, setErrors] = useState<TrialBookingErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acpayLoading, setAcpayLoading] = useState(false);
  const [acpayError, setAcpayError] = useState("");
  const [isPaymentPreviewMode, setIsPaymentPreviewMode] = useState(false);
  const [submittedBooking, setSubmittedBooking] = useState<TrialBookingSuccess | null>(null);
  const [isBirthdayPickerOpen, setIsBirthdayPickerOpen] = useState(false);
  const [isBirthdayYearPanelOpen, setIsBirthdayYearPanelOpen] = useState(false);
  const [draftSelectedBirthday, setDraftSelectedBirthday] = useState("");
  const [birthdayPickerError, setBirthdayPickerError] = useState("");
  const birthdayPickerRef = useRef<HTMLDivElement>(null);
  const maxBirthday = useMemo(() => getTodayDateInputValue(), []);
  const currentYear = Number(maxBirthday.slice(0, 4));
  const currentMonth = Number(maxBirthday.slice(5, 7));
  const birthdayCalendarInitial = getBirthdayCalendarBase(formData.birthday, maxBirthday);
  const [birthdayCalendarYear, setBirthdayCalendarYear] = useState(birthdayCalendarInitial.year);
  const [birthdayCalendarMonth, setBirthdayCalendarMonth] = useState(birthdayCalendarInitial.month);
  const birthdayCalendarCells = useMemo<BirthdayCalendarCell[]>(() => {
    const firstDayOfWeek = new Date(birthdayCalendarYear, birthdayCalendarMonth - 1, 1).getDay();
    const daysInMonth = getDaysInMonth(String(birthdayCalendarYear), String(birthdayCalendarMonth));
    return [
      ...Array.from({ length: firstDayOfWeek }, (_, index) => ({
        key: `blank-${index}`,
        day: null,
        value: "",
        isToday: false,
        isSelected: false,
        isDisabled: true,
      })),
      ...Array.from({ length: daysInMonth }, (_, index) => {
        const day = index + 1;
        const value = buildBirthdayValueFromNumbers(birthdayCalendarYear, birthdayCalendarMonth, day);
        return {
          key: value,
          day,
          value,
          isToday: value === maxBirthday,
          isSelected: value === draftSelectedBirthday,
          isDisabled: value > maxBirthday,
        };
      }),
    ];
  }, [birthdayCalendarMonth, birthdayCalendarYear, draftSelectedBirthday, maxBirthday]);
  const canGoToNextBirthdayMonth =
    birthdayCalendarYear < currentYear ||
    (birthdayCalendarYear === currentYear && birthdayCalendarMonth < currentMonth);
  const birthdayYearOptions = useMemo(
    () =>
      Array.from({ length: currentYear - BIRTHDAY_START_YEAR + 1 }, (_, index) => currentYear - index),
    [currentYear],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setIsPaymentPreviewMode(
      params.get("paymentPreview") === "1" && params.get("token") === PAYMENT_PREVIEW_TOKEN,
    );
  }, []);

  useEffect(() => {
    if (isPaymentPreviewMode) return;
    setFormData((current) =>
      current.paymentMethod === "online_payment" ? { ...current, paymentMethod: "cash_on_site" } : current,
    );
    setAcpayError("");
  }, [isPaymentPreviewMode]);

  useEffect(() => {
    if (!isBirthdayPickerOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!birthdayPickerRef.current?.contains(event.target as Node)) {
        setIsBirthdayPickerOpen(false);
        setIsBirthdayYearPanelOpen(false);
        setBirthdayPickerError("");
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isBirthdayPickerOpen]);

  const visiblePaymentMethodOptions = useMemo(
    () => paymentMethodOptions.filter((option) => isPaymentPreviewMode || option.value !== "online_payment"),
    [isPaymentPreviewMode],
  );

  const successPaymentMethodLabel = submittedBooking
    ? getPaymentMethodLabel(submittedBooking.paymentMethod)
    : "";

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

  function openBirthdayPicker() {
    const base = getBirthdayCalendarBase(formData.birthday, maxBirthday);
    setBirthdayCalendarYear(base.year);
    setBirthdayCalendarMonth(base.month);
    setDraftSelectedBirthday(formData.birthday);
    setBirthdayPickerError("");
    setIsBirthdayYearPanelOpen(false);
    setIsBirthdayPickerOpen(true);
  }

  function selectBirthdayCalendarYear(year: number) {
    if (year < BIRTHDAY_START_YEAR || year > currentYear) return;
    setBirthdayCalendarYear(year);
    setBirthdayCalendarMonth((current) =>
      year === currentYear && current > currentMonth ? currentMonth : current,
    );
    setIsBirthdayYearPanelOpen(false);
    setBirthdayPickerError("");
  }

  function moveBirthdayCalendarMonth(direction: -1 | 1) {
    let nextMonth = birthdayCalendarMonth + direction;
    let nextYear = birthdayCalendarYear;
    if (nextMonth < 1) {
      nextMonth = 12;
      nextYear -= 1;
    } else if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }

    if (nextYear < BIRTHDAY_START_YEAR) return;
    if (nextYear > currentYear || (nextYear === currentYear && nextMonth > currentMonth)) return;

    setBirthdayCalendarYear(nextYear);
    setBirthdayCalendarMonth(nextMonth);
    setIsBirthdayYearPanelOpen(false);
    setBirthdayPickerError("");
  }

  function selectDraftBirthday(value: string, isDisabled?: boolean) {
    if (isDisabled) return;
    setDraftSelectedBirthday(value);
    setBirthdayPickerError("");
  }

  function confirmBirthday() {
    if (!draftSelectedBirthday) {
      setBirthdayPickerError("請選擇生日");
      return;
    }

    if (!DATE_INPUT_PATTERN.test(draftSelectedBirthday) || draftSelectedBirthday > maxBirthday) {
      setBirthdayPickerError("請選擇有效生日");
      return;
    }

    updateField("birthday", draftSelectedBirthday);
    setBirthdayPickerError("");
    setIsBirthdayYearPanelOpen(false);
    setIsBirthdayPickerOpen(false);
  }

  function clearBirthday() {
    setDraftSelectedBirthday("");
    updateField("birthday", "");
    setBirthdayPickerError("");
    setIsBirthdayYearPanelOpen(false);
    setIsBirthdayPickerOpen(false);
  }

  function cancelBirthdayPicker() {
    setDraftSelectedBirthday(formData.birthday);
    setBirthdayPickerError("");
    setIsBirthdayYearPanelOpen(false);
    setIsBirthdayPickerOpen(false);
  }

  function validate(data: TrialBookingFormData) {
    const nextErrors: TrialBookingErrors = {};

    if (!data.name.trim()) nextErrors.name = "請填寫姓名";
    if (!data.phone.trim()) nextErrors.phone = "請填寫電話";
    if (!data.birthday.trim()) {
      nextErrors.birthday = "請選擇生日";
    } else if (!DATE_INPUT_PATTERN.test(data.birthday) || data.birthday > getTodayDateInputValue()) {
      nextErrors.birthday = "請選擇有效生日";
    }
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
          birthday: formData.birthday,
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

      if (payload.booking.paymentMethod === "online_payment") {
        await handleAcpayPayment(payload.booking);
        return;
      }

      setSubmittedBooking(payload.booking);
    } catch {
      setSubmitError("預約送出失敗，請稍後再試或直接聯繫 BigE 團隊。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAcpayPayment(booking: TrialBookingSuccess) {
    if (acpayLoading) return;

    setAcpayError("");
    setAcpayLoading(true);

    try {
      const response = await fetch("/api/acpay/create-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bookingId: booking.id,
          amount: booking.amount,
        }),
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
                  <dt>生日</dt>
                  <dd>{formData.birthday}</dd>
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

              <div className="trialBookingSuccessCopy">
                <p>您好，已成功收到您的體驗課程預約！</p>
                <p>付款方式為「{successPaymentMethodLabel}」。</p>
                <p>
                  為了確保課程品質，教練會為您預留約 1.5～2 小時的完整體驗時段。
                  若您臨時有事需要調整時間，請務必於 24 小時前告知我們取消或改期。
                </p>
              </div>

              <div className="trialBookingSuccessNotice">
                <strong>🔔 提醒您：</strong>
                <p>
                  若預約後未提前通知而未到場，我們將視為無故取消，並可能會影響您後續的預約資格（包含列入黑名單）。
                </p>
              </div>

              <div className="trialBookingSuccessCopy">
                <p>✨ 非常期待與您見面，一起開始更健康的生活步調！</p>
                <p>
                  若有任何問題，都歡迎透過官方 LINE 與我們聯繫，我們將會盡快請專人協助確認可預約時段。
                </p>
              </div>

              <a
                className="trialBookingLineCta"
                href={BIGE_LINE_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                聯絡官方 LINE
              </a>

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
                    <h2 id="trial-service-heading">
                      選擇體驗項目
                      <RequiredBadge />
                    </h2>
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
                    <h2 id="trial-time-heading">
                      選擇方便時段
                      <RequiredBadge />
                    </h2>
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
                    <label className="trialBookingLabel" htmlFor="trial-name">
                      姓名
                      <RequiredBadge />
                    </label>
                    <input
                      id="trial-name"
                      className="trialBookingInput"
                      value={formData.name}
                      onChange={(event) => updateField("name", event.target.value)}
                      placeholder="請輸入姓名"
                      autoComplete="name"
                      maxLength={50}
                      required
                      aria-required="true"
                    />
                    {errors.name ? <p className="trialBookingFieldError">{errors.name}</p> : null}
                  </div>

                  <div className="trialBookingField">
                    <label className="trialBookingLabel" htmlFor="trial-phone">
                      電話
                      <RequiredBadge />
                    </label>
                    <input
                      id="trial-phone"
                      className="trialBookingInput"
                      value={formData.phone}
                      onChange={(event) => updateField("phone", event.target.value)}
                      placeholder="請輸入手機號碼"
                      autoComplete="tel"
                      inputMode="tel"
                      maxLength={30}
                      required
                      aria-required="true"
                    />
                    {errors.phone ? <p className="trialBookingFieldError">{errors.phone}</p> : null}
                  </div>

                  <div className="trialBookingField trialBookingFieldWide" ref={birthdayPickerRef}>
                    <label className="trialBookingLabel" htmlFor="trial-birthday">
                      生日
                      <RequiredBadge />
                    </label>
                    <button
                      id="trial-birthday"
                      className={`trialBookingBirthdayTrigger${formData.birthday ? " has-value" : ""}`}
                      type="button"
                      onClick={openBirthdayPicker}
                      aria-expanded={isBirthdayPickerOpen}
                      aria-controls="trial-birthday-picker"
                      aria-describedby={errors.birthday ? "trial-birthday-error" : undefined}
                    >
                      <span>{formData.birthday || "請選擇生日"}</span>
                      <span aria-hidden="true">選擇</span>
                    </button>
                    {isBirthdayPickerOpen ? (
                      <div className="trialBookingBirthdayPicker" id="trial-birthday-picker">
                        <div className="trialBookingBirthdayHeader">
                          <button
                            type="button"
                            onClick={() => moveBirthdayCalendarMonth(-1)}
                            disabled={
                              birthdayCalendarYear === BIRTHDAY_START_YEAR && birthdayCalendarMonth === 1
                            }
                            aria-label="上一月"
                          >
                            ‹
                          </button>
                          <div className="trialBookingBirthdayMonthTitle" aria-live="polite">
                            <strong>
                              {birthdayCalendarYear} 年 {birthdayCalendarMonth} 月
                            </strong>
                            <div className="trialBookingBirthdayYearControl">
                              <button
                                type="button"
                                className="trialBookingBirthdayYearToggle"
                                onClick={() => setIsBirthdayYearPanelOpen((current) => !current)}
                                aria-expanded={isBirthdayYearPanelOpen}
                                aria-controls="trial-birthday-year-panel"
                              >
                                選擇年份
                              </button>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => moveBirthdayCalendarMonth(1)}
                            disabled={!canGoToNextBirthdayMonth}
                            aria-label="下一月"
                          >
                            ›
                          </button>
                        </div>
                        {isBirthdayYearPanelOpen ? (
                          <div
                            className="trialBookingBirthdayYearPanel"
                            id="trial-birthday-year-panel"
                            aria-label="年份選擇"
                          >
                            {birthdayYearOptions.map((year) => (
                              <button
                                key={year}
                                type="button"
                                className={year === birthdayCalendarYear ? "is-selected" : undefined}
                                onClick={() => selectBirthdayCalendarYear(year)}
                                aria-pressed={year === birthdayCalendarYear}
                              >
                                {year}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        <div className="trialBookingBirthdayWeekdays" aria-hidden="true">
                          {["日", "一", "二", "三", "四", "五", "六"].map((weekday) => (
                            <span key={weekday}>{weekday}</span>
                          ))}
                        </div>
                        <div className="trialBookingBirthdayCalendar" aria-label="生日月曆">
                          {birthdayCalendarCells.map((cell) =>
                            cell.day ? (
                              <button
                                key={cell.key}
                                type="button"
                                className={[
                                  cell.isToday ? "is-today" : "",
                                  cell.isSelected ? "is-selected" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                onClick={() => selectDraftBirthday(cell.value, cell.isDisabled)}
                                disabled={cell.isDisabled}
                                aria-pressed={cell.isSelected}
                              >
                                <span>{cell.day}</span>
                              </button>
                            ) : (
                              <span key={cell.key} aria-hidden="true" />
                            ),
                          )}
                        </div>
                        {birthdayPickerError ? (
                          <p className="trialBookingFieldError">{birthdayPickerError}</p>
                        ) : null}
                        <div className="trialBookingBirthdayActions">
                          <button type="button" onClick={cancelBirthdayPicker}>
                            取消
                          </button>
                          <button type="button" onClick={clearBirthday}>
                            清除
                          </button>
                          <button type="button" onClick={confirmBirthday}>
                            確認
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {errors.birthday ? (
                      <p className="trialBookingFieldError" id="trial-birthday-error">
                        {errors.birthday}
                      </p>
                    ) : null}
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
                  <legend className="trialBookingLegend">
                    付款方式
                    <RequiredBadge />
                  </legend>
                  <div className="trialBookingRadioGroup">
                    {visiblePaymentMethodOptions.map((option) => (
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
                          required
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

              {isPaymentPreviewMode && formData.paymentMethod === "online_payment" ? (
                <div className="trialBookingAcpayBox">
                  <button
                    className="trialBookingAcpayButton"
                    type="submit"
                    disabled={acpayLoading}
                  >
                    {acpayLoading ? "正在建立付款連結..." : "前往 ACPay 安全付款"}
                  </button>
                  <p className="trialBookingAcpayHint">
                    付款完成後，BigE 團隊將協助確認體驗時段。若付款未完成，預約不會成立。
                  </p>
                  {acpayError ? <div className="trialBookingError">{acpayError}</div> : null}
                </div>
              ) : (
                <button className="trialBookingSubmit" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "送出中..." : "送出首次體驗預約"}
                </button>
              )}
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
