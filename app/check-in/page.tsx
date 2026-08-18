"use client";

import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  studentCheckInEntryLabel,
  type StudentCheckInEntryMode,
} from "../../lib/student-checkin-entry";
import {
  STUDENT_DROP_IN_TERMS_INTRO,
  STUDENT_DROP_IN_TERMS_SECTIONS,
  type StudentDropInActivityInterest,
  type StudentDropInGender,
} from "../../lib/student-drop-in-registration";
import {
  studentDropInPlanDetails,
  type StudentDropInEntryPlan,
} from "../../lib/student-drop-in-plan";

type CheckinRequest = {
  id: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
};

type DropInRegistrationPayload = {
  complete: boolean;
  invoiceCarrier: string;
  gender: StudentDropInGender | null;
  activityInterest: StudentDropInActivityInterest | null;
  discoverySource: string;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  correctionRequired: boolean;
  correctionRequestedAt: string | null;
};

type CheckinPayload = {
  ok?: boolean;
  authenticated?: boolean;
  needsProfile?: boolean;
  profile?: {
    id: string;
    fullName: string;
    phone?: string;
    email?: string | null;
    birthDate?: string | null;
  } | null;
  request?: CheckinRequest | null;
  checkIn?: { checked_in_at: string; daily_sequence: number; month_sequence: number } | null;
  dropInCheckIn?: {
    checked_in_at: string;
    use_sequence: number;
    remaining_uses: number | null;
    price_twd: number;
    entry_plan: StudentDropInEntryPlan;
  } | null;
  autonomous?: {
    eligible: boolean;
    accessCode?: string;
    periodStatus: "active" | "not_started" | "expired";
    startsOn: string | null;
    expiresOn: string | null;
    request: CheckinRequest | null;
  };
  dropIn?: {
    eligible?: boolean;
    accessCode?: string;
    totalUses: number;
    remainingUses: number | null;
    entryPlan: StudentDropInEntryPlan;
    priceTwd: number;
    reviewPhotoRequired: boolean;
    unlimitedUses: boolean;
    request: CheckinRequest | null;
    registration?: DropInRegistrationPayload;
  };
  registration?: DropInRegistrationPayload;
  totalUses?: number;
  remainingUses?: number | null;
  entryPlan?: StudentDropInEntryPlan;
  priceTwd?: number;
  reviewPhotoRequired?: boolean;
  unlimitedUses?: boolean;
  encouragement?: string | null;
  code?: string;
  startsOn?: string | null;
  expiresOn?: string | null;
  verificationRequired?: boolean;
  needsSecuritySetup?: boolean;
  securitySetup?: { email: string; expiresAt: string; status: "pending" | "verifying" } | null;
  email?: string;
  expiresAt?: string;
  error?: string;
};

type View =
  | "loading"
  | "login"
  | "register"
  | "dropInRegistration1"
  | "dropInRegistration2"
  | "confirmEmail"
  | "verifyEmail"
  | "securitySetup"
  | "confirmSecurityEmail"
  | "verifySecurityEmail"
  | "biometricOffer"
  | "pending"
  | "success"
  | "rejected"
  | "expired"
  | "exhausted"
  | "accountUnavailable"
  | "notOfficialMember"
  | "error";

function formatTaipeiTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}/${month}/${day}`;
}

export function StudentCheckInExperience({ entryMode }: { entryMode: StudentCheckInEntryMode }) {
  const entryLabel = studentCheckInEntryLabel(entryMode);
  const [view, setView] = useState<View>("loading");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [password, setPassword] = useState("");
  const [invoiceCarrier, setInvoiceCarrier] = useState("");
  const [gender, setGender] = useState<StudentDropInGender | "">("");
  const [activityInterest, setActivityInterest] = useState<StudentDropInActivityInterest | "">("");
  const [discoverySource, setDiscoverySource] = useState("");
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [dropInRegistrationBusy, setDropInRegistrationBusy] = useState(false);
  const [dropInCorrectionRequired, setDropInCorrectionRequired] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [activeMode, setActiveMode] = useState<StudentCheckInEntryMode>(entryMode);
  const [success, setSuccess] = useState<CheckinPayload | null>(null);
  const [, setAutonomousPeriodStatus] = useState<"active" | "not_started" | "expired">("active");
  const [, setDropInTotalUses] = useState(10);
  const [, setDropInRemainingUses] = useState<number | null>(10);
  const [dropInEntryPlan, setDropInEntryPlan] = useState<StudentDropInEntryPlan>("review_50");
  const [startsOn, setStartsOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [verificationExpiresAt, setVerificationExpiresAt] = useState("");
  const [securityEmail, setSecurityEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyProfileId, setPasskeyProfileId] = useState("");
  const [registrationOptions, setRegistrationOptions] = useState<PublicKeyCredentialCreationOptionsJSON | null>(null);
  const activeDropInPlan = studentDropInPlanDetails(dropInEntryPlan);

  const applyExpiryWarning = useCallback((payload: CheckinPayload | null) => {
    if (payload?.code !== "membership_expired" && payload?.code !== "membership_not_started") return false;
    setStartsOn(payload.startsOn || "");
    setExpiresOn(payload.expiresOn || "");
    setAutonomousPeriodStatus(payload.code === "membership_not_started" ? "not_started" : "expired");
    setActiveMode("autonomous");
    setError(payload.error || "目前不在自主運動有效期限內，請洽現場人員協助。");
    setView("expired");
    return true;
  }, []);

  const applyAccessFailure = useCallback((payload: CheckinPayload | null, mode: StudentCheckInEntryMode) => {
    if (payload?.code === "account_unavailable") {
      setActiveMode(mode);
      setError("此帳號目前無法使用入場服務，請洽現場人員協助確認。");
      setView("accountUnavailable");
      return true;
    }
    if (payload?.code === "not_official_member") {
      setActiveMode(mode);
      setError("此帳號目前不是本館正式學員，無法使用自主訓練入口。");
      setView("notOfficialMember");
      return true;
    }
    return false;
  }, []);

  const applyRequest = useCallback((payload: CheckinPayload, mode: StudentCheckInEntryMode) => {
    if (payload.profile?.fullName) setFullName(payload.profile.fullName);
    setActiveMode(mode);
    if (typeof payload.totalUses === "number") setDropInTotalUses(payload.totalUses);
    if (payload.remainingUses === null || typeof payload.remainingUses === "number") setDropInRemainingUses(payload.remainingUses);
    if (payload.entryPlan) setDropInEntryPlan(payload.entryPlan);
    if (!payload.request) return false;
    setRequestId(payload.request.id);
    if (mode === "drop_in" && payload.registration?.correctionRequired) {
      setInvoiceCarrier(payload.registration.invoiceCarrier || "");
      setGender(payload.registration.gender || "");
      setActivityInterest(payload.registration.activityInterest || "");
      setDiscoverySource(payload.registration.discoverySource || "");
      setDropInCorrectionRequired(true);
      setTermsAgreed(false);
      setNotice("櫃檯要求更正入場資料，請重新確認第一頁全部欄位。");
      setError("");
      setView("dropInRegistration1");
      return true;
    }
    if (payload.request.status === "approved") {
      setSuccess(payload);
      setView("success");
    } else if (payload.request.status === "rejected") {
      setView("rejected");
    } else {
      setView("pending");
    }
    return true;
  }, []);

  const createRequest = useCallback(async (mode: StudentCheckInEntryMode) => {
    const endpoint = mode === "autonomous"
      ? "/api/student-checkin/request"
      : "/api/student-checkin/drop-in/request";
    const response = await fetch(endpoint, { method: "POST" });
    const payload = (await response.json().catch(() => null)) as CheckinPayload | null;
    if (applyAccessFailure(payload, mode)) return;
    if (mode === "autonomous" && applyExpiryWarning(payload)) return;
    if (payload?.code === "drop_in_uses_exhausted") {
      setDropInRemainingUses(0);
      setError(payload.error || "10 次 50 元入場資格已全部使用完畢。");
      setView("exhausted");
      return;
    }
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || "無法送出報到申請。");
    applyRequest(payload, mode);
  }, [applyAccessFailure, applyExpiryWarning, applyRequest]);

  useEffect(() => {
    let active = true;
    async function detectPasskeySupport() {
      if (!browserSupportsWebAuthn()) return;
      const hasPlatformAuthenticator = await platformAuthenticatorIsAvailable().catch(() => false);
      if (active) setPasskeyAvailable(hasPlatformAuthenticator);
    }
    void detectPasskeySupport();
    return () => {
      active = false;
    };
  }, []);

  const applyAuthenticatedOptions = useCallback(async (payload: CheckinPayload) => {
    if (payload.profile) {
      if (payload.profile.fullName) setFullName(payload.profile.fullName);
      if (payload.profile.phone) setPhone(payload.profile.phone);
      if (payload.profile.email) setEmail(payload.profile.email);
      if (payload.profile.birthDate) setBirthDate(payload.profile.birthDate);
    }
    const autonomous = payload.autonomous;
    const dropIn = payload.dropIn;
    if (autonomous) {
      setAutonomousPeriodStatus(autonomous.periodStatus);
      setStartsOn(autonomous.startsOn || "");
      setExpiresOn(autonomous.expiresOn || "");
    }
    if (dropIn) {
      setDropInTotalUses(dropIn.totalUses);
      setDropInRemainingUses(dropIn.remainingUses);
      setDropInEntryPlan(dropIn.entryPlan);
      setInvoiceCarrier(dropIn.registration?.invoiceCarrier || "");
      setGender(dropIn.registration?.gender || "");
      setActivityInterest(dropIn.registration?.activityInterest || "");
      setDiscoverySource(dropIn.registration?.discoverySource || "");
      setDropInCorrectionRequired(dropIn.registration?.correctionRequired === true);
    }
    const selectedRequest = entryMode === "autonomous" ? autonomous?.request : dropIn?.request;
    const selectedAccessCode = entryMode === "autonomous" ? autonomous?.accessCode : dropIn?.accessCode;
    if (applyAccessFailure({ code: selectedAccessCode }, entryMode)) return;
    if (entryMode === "autonomous" && autonomous?.eligible === false) {
      setError("此帳號目前只有 50 元入場資格，無法使用學生自主訓練入口。請洽現場人員協助開通學生資格。");
      setView("error");
      return;
    }
    if (entryMode === "drop_in" && dropIn && dropIn.registration?.complete !== true) {
      setTermsAgreed(false);
      setError("");
      setNotice(
        dropIn.registration?.correctionRequired
          ? "櫃檯要求更正入場資料，請重新確認第一頁全部欄位。"
          : "",
      );
      setView("dropInRegistration1");
      return;
    }
    if (selectedRequest) {
      setActiveMode(entryMode);
      setRequestId(selectedRequest.id);
      setView("pending");
      return;
    }
    if (entryMode === "drop_in" && dropIn && dropIn.remainingUses !== null && dropIn.remainingUses <= 0) {
      setError("您的 10 次 50 元入場資格已使用完畢。");
      setView("exhausted");
      return;
    }
    setRequestId("");
    setSuccess(null);
    setActiveMode(entryMode);
    setView("loading");
    try {
      await createRequest(entryMode);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "無法送出報到申請。");
      setView("error");
    }
  }, [applyAccessFailure, createRequest, entryMode]);

  const loadAuthenticatedOptions = useCallback(async () => {
    const response = await fetch("/api/student-checkin/session", { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as CheckinPayload | null;
    if (!payload?.authenticated) return false;
    const accessCode = entryMode === "autonomous"
      ? payload.autonomous?.accessCode
      : payload.dropIn?.accessCode;
    if (applyAccessFailure({ code: accessCode }, entryMode)) return true;
    if (payload.needsProfile) {
      setView("register");
      return true;
    }
    if (payload.needsSecuritySetup) {
      if (payload.profile?.fullName) setFullName(payload.profile.fullName);
      setSecurityEmail(payload.securitySetup?.email || payload.profile?.email || "");
      if (payload.securitySetup?.email) {
        setVerificationEmail(payload.securitySetup.email);
        setVerificationExpiresAt(payload.securitySetup.expiresAt || "");
        setView("verifySecurityEmail");
      } else {
        setView("securitySetup");
      }
      return true;
    }
    await applyAuthenticatedOptions(payload);
    return true;
  }, [applyAccessFailure, applyAuthenticatedOptions, entryMode]);

  useEffect(() => {
    let active = true;
    async function load() {
      const authenticated = await loadAuthenticatedOptions();
      if (!active) return;
      if (!authenticated) {
        const pendingResponse = await fetch("/api/student-checkin/register/status", { cache: "no-store" });
        const pendingPayload = (await pendingResponse.json().catch(() => null)) as {
          pending?: boolean;
          email?: string;
          expiresAt?: string;
          entryMode?: StudentCheckInEntryMode;
        } | null;
        if (pendingResponse.ok && pendingPayload?.pending && pendingPayload.email && pendingPayload.entryMode === entryMode) {
          setVerificationEmail(pendingPayload.email);
          setVerificationExpiresAt(pendingPayload.expiresAt || "");
          setView("verifyEmail");
          return;
        }
        setView("login");
      }
    }
    void load().catch((caught) => {
      if (!active) return;
      setError(caught instanceof Error ? caught.message : "報到頁面暫時無法使用。");
      setView("error");
    });
    return () => {
      active = false;
    };
  }, [entryMode, loadAuthenticatedOptions]);

  useEffect(() => {
    if (view !== "pending" || !requestId) return;
    const timer = window.setInterval(async () => {
      const endpoint = activeMode === "autonomous"
        ? "/api/student-checkin/request"
        : "/api/student-checkin/drop-in/request";
      const response = await fetch(endpoint, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as CheckinPayload | null;
      if (applyAccessFailure(payload, activeMode)) return;
      if (activeMode === "autonomous" && applyExpiryWarning(payload)) return;
      if (response.ok && payload?.ok) applyRequest(payload, activeMode);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [activeMode, applyAccessFailure, applyExpiryWarning, applyRequest, requestId, view]);

  async function openCheckInChoices() {
    setView("loading");
    try {
      const authenticated = await loadAuthenticatedOptions();
      if (!authenticated) setView("login");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "無法載入報到選擇。");
      setView("error");
    }
  }

  async function fetchRegistrationOptions() {
    const response = await fetch("/api/student-checkin/passkey/register/options", { method: "POST" });
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      options?: PublicKeyCredentialCreationOptionsJSON;
      error?: string;
    } | null;
    if (!response.ok || !payload?.ok || !payload.options) {
      throw new Error(payload?.error || "目前無法啟用生物辨識。");
    }
    return payload.options;
  }

  async function preparePasskeyOffer(profileId: string) {
    if (!browserSupportsWebAuthn()) return false;
    const hasPlatformAuthenticator = await platformAuthenticatorIsAvailable().catch(() => false);
    setPasskeyAvailable(hasPlatformAuthenticator);
    if (!hasPlatformAuthenticator) return false;
    const deviceChoice = window.localStorage.getItem(`bige-passkey-choice:${profileId}`);
    if (deviceChoice === "bound" || deviceChoice === "dismissed") return false;
    try {
      const options = await fetchRegistrationOptions();
      setPasskeyProfileId(profileId);
      setRegistrationOptions(options);
      setError("");
      setView("biometricOffer");
      return true;
    } catch {
      return false;
    }
  }

  async function enablePasskey() {
    if (!registrationOptions || !passkeyProfileId) return;
    setPasskeyBusy(true);
    setError("");
    try {
      const credential = await startRegistration({ optionsJSON: registrationOptions });
      const response = await fetch("/api/student-checkin/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: credential }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "生物辨識綁定失敗，請再試一次。");
      window.localStorage.setItem(`bige-passkey-choice:${passkeyProfileId}`, "bound");
      setRegistrationOptions(null);
      await openCheckInChoices();
    } catch (caught) {
      const message = caught instanceof Error && caught.name !== "NotAllowedError"
        ? caught.message
        : "尚未完成生物辨識。您可以再試一次，或先略過並繼續報到。";
      setError(message);
      try {
        setRegistrationOptions(await fetchRegistrationOptions());
      } catch {
        setRegistrationOptions(null);
      }
      setView("biometricOffer");
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function skipPasskeyOffer() {
    if (passkeyProfileId) {
      window.localStorage.setItem(`bige-passkey-choice:${passkeyProfileId}`, "dismissed");
    }
    setRegistrationOptions(null);
    await openCheckInChoices();
  }

  async function authenticateWithPasskey() {
    setError("");
    setPasskeyBusy(true);
    try {
      const optionsResponse = await fetch("/api/student-checkin/passkey/authenticate/options", { method: "POST" });
      const optionsPayload = (await optionsResponse.json().catch(() => null)) as {
        ok?: boolean;
        options?: PublicKeyCredentialRequestOptionsJSON;
        error?: string;
      } | null;
      if (!optionsResponse.ok || !optionsPayload?.ok || !optionsPayload.options) {
        throw new Error(optionsPayload?.error || "目前無法使用生物辨識登入。");
      }
      const credential = await startAuthentication({ optionsJSON: optionsPayload.options });
      const verifyResponse = await fetch("/api/student-checkin/passkey/authenticate/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: credential }),
      });
      const payload = (await verifyResponse.json().catch(() => null)) as CheckinPayload | null;
      if (!verifyResponse.ok || !payload?.ok) {
        throw new Error(payload?.error || "生物辨識登入失敗，請改用手機與密碼登入。");
      }
      await openCheckInChoices();
    } catch (caught) {
      const message = caught instanceof Error && caught.name !== "NotAllowedError"
        ? caught.message
        : "未完成生物辨識，請再試一次或改用手機與密碼登入。";
      setError(message);
      setView("login");
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function submitPhoneLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setView("loading");
    const response = await fetch("/api/student-checkin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, password }),
    });
    const payload = (await response.json().catch(() => null)) as CheckinPayload | null;
    if (response.ok && payload?.needsProfile) {
      setView("register");
      return;
    }
    if (!response.ok || !payload?.ok) {
      setError(payload?.error || "手機號碼或密碼不正確。");
      setView("login");
      return;
    }
    if (payload.needsSecuritySetup) {
      if (payload.profile?.fullName) setFullName(payload.profile.fullName);
      setSecurityEmail(payload.profile?.email || "");
      setNewPassword("");
      setNewPasswordConfirmation("");
      setView("securitySetup");
      return;
    }
    if (payload.profile?.fullName) setFullName(payload.profile.fullName);
    if (payload.profile?.id && await preparePasskeyOffer(payload.profile.id)) return;
    await openCheckInChoices();
  }

  async function submitSecuritySetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (newPassword !== newPasswordConfirmation) {
      setError("兩次輸入的新密碼不一致。");
      return;
    }
    setView("confirmSecurityEmail");
  }

  async function sendSecuritySetup() {
    setError("");
    setNotice("");
    setView("loading");
    const response = await fetch("/api/student-checkin/security-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: securityEmail,
        password: newPassword,
        passwordConfirmation: newPasswordConfirmation,
        entryMode,
      }),
    });
    const payload = (await response.json().catch(() => null)) as CheckinPayload | null;
    if (!response.ok || !payload?.ok || !payload.verificationRequired || !payload.email) {
      setError(payload?.error || "帳號安全設定失敗，請稍後再試。");
      setView("securitySetup");
      return;
    }
    setVerificationEmail(payload.email);
    setVerificationExpiresAt(payload.expiresAt || "");
    setView("verifySecurityEmail");
  }

  async function resendSecuritySetupEmail() {
    setError("");
    setNotice("");
    const response = await fetch("/api/student-checkin/security-setup/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryMode }),
    });
    const payload = (await response.json().catch(() => null)) as CheckinPayload | null;
    if (!response.ok || !payload?.ok) {
      setError(payload?.error || "驗證信重新寄送失敗。");
      return;
    }
    if (payload.email) setVerificationEmail(payload.email);
    if (payload.expiresAt) setVerificationExpiresAt(payload.expiresAt);
    setNotice("新的驗證信已寄出，請以最新一封信中的連結完成驗證。");
  }

  async function editSecuritySetup() {
    await fetch("/api/student-checkin/security-setup", { method: "DELETE" });
    setSecurityEmail(verificationEmail || securityEmail);
    setVerificationEmail("");
    setVerificationExpiresAt("");
    setNotice("");
    setError("");
    setView("securitySetup");
  }

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setView("confirmEmail");
  }

  async function sendRegistration() {
    setError("");
    setNotice("");
    setView("loading");
    const form = new FormData();
    form.set("fullName", fullName);
    form.set("phone", phone);
    form.set("email", email);
    form.set("birthDate", birthDate);
    form.set("password", password);
    form.set("entryMode", entryMode);
    const response = await fetch("/api/student-checkin/register", { method: "POST", body: form });
    const payload = (await response.json().catch(() => null)) as CheckinPayload | null;
    if (!response.ok || !payload?.ok) {
      if (applyAccessFailure(payload, entryMode)) return;
      setError(payload?.error || "學員資料建立失敗。");
      setView("register");
      return;
    }
    if (!payload.verificationRequired || !payload.email) {
      setError("驗證信狀態不正確，請稍後再試。");
      setView("register");
      return;
    }
    setVerificationEmail(payload.email);
    setVerificationExpiresAt(payload.expiresAt || "");
    setView("verifyEmail");
  }

  async function resendVerificationEmail() {
    setError("");
    setNotice("");
    const response = await fetch("/api/student-checkin/register/resend", { method: "POST" });
    const payload = (await response.json().catch(() => null)) as CheckinPayload | null;
    if (!response.ok || !payload?.ok) {
      setError(payload?.error || "驗證信重新寄送失敗。");
      return;
    }
    if (payload.email) setVerificationEmail(payload.email);
    if (payload.expiresAt) setVerificationExpiresAt(payload.expiresAt);
    setNotice("新的驗證信已寄出，請以最新一封信中的連結完成驗證。");
  }

  async function editRegistration() {
    await fetch("/api/student-checkin/register/cancel", { method: "POST" });
    setVerificationEmail("");
    setVerificationExpiresAt("");
    setNotice("");
    setError("");
    setView("register");
  }

  async function submitDropInRegistrationPageOne(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!fullName.trim() || !birthDate || !invoiceCarrier.trim() || !gender || !activityInterest || !discoverySource.trim()) {
      setError("請完整填寫姓名、生日、載具、性別、感興趣的運動與得知來源。");
      return;
    }
    if (dropInCorrectionRequired) {
      await saveDropInRegistration(false);
      return;
    }
    setTermsAgreed(false);
    setView("dropInRegistration2");
  }

  async function saveDropInRegistration(termsAccepted: boolean) {
    setDropInRegistrationBusy(true);
    try {
      const response = await fetch("/api/student-checkin/drop-in/registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          birthDate,
          invoiceCarrier,
          gender,
          activityInterest,
          discoverySource,
          termsAccepted,
        }),
      });
      const payload = (await response.json().catch(() => null)) as CheckinPayload | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "50 元入場資料儲存失敗，請稍後再試。");
        return;
      }
      await createRequest("drop_in");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "50 元入場資料儲存失敗，請稍後再試。");
    } finally {
      setDropInRegistrationBusy(false);
    }
  }

  async function submitDropInRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!termsAgreed || !gender || !activityInterest) {
      setError("請閱讀並勾選同意會員條款。");
      return;
    }
    await saveDropInRegistration(true);
  }

  async function returnToLogin() {
    await Promise.all([
      fetch("/api/student-checkin/register/cancel", { method: "POST" }),
      fetch("/api/student-checkin/security-setup", { method: "DELETE" }),
    ]);
    await fetch("/api/student-checkin/logout", { method: "POST" });
    setRequestId("");
    setSuccess(null);
    setStartsOn("");
    setExpiresOn("");
    setAutonomousPeriodStatus("active");
    setDropInTotalUses(10);
    setDropInRemainingUses(10);
    setVerificationEmail("");
    setVerificationExpiresAt("");
    setSecurityEmail("");
    setNewPassword("");
    setNewPasswordConfirmation("");
    setInvoiceCarrier("");
    setGender("");
    setActivityInterest("");
    setDiscoverySource("");
    setTermsAgreed(false);
    setDropInRegistrationBusy(false);
    setDropInCorrectionRequired(false);
    setNotice("");
    setError("");
    setView("login");
  }

  return (
    <main className={view === "rejected" ? "studentCheckInPage studentCheckInPageCentered" : "studentCheckInPage"}>
      <section className="studentCheckInCard">
        <p className="studentCheckInEyebrow">BIGE {entryMode === "drop_in" ? "NT$50 DROP-IN" : "STUDENT CHECK-IN"}</p>

        {view === "loading" ? (
          <div className="studentCheckInCentered">
            <div className="studentCheckInSpinner" aria-hidden="true" />
            <h1>正在準備報到</h1>
          </div>
        ) : null}

        {view === "login" || view === "biometricOffer" || view === "pending" || view === "success" ? (
          <div className="studentCheckInLoginLayer" aria-hidden={view !== "login"}>
            <h1>{entryLabel}報到</h1>
            {error ? <p className="studentCheckInError">{error}</p> : null}
            <form className="studentCheckInForm" onSubmit={submitPhoneLogin}>
              <label>
                <span>手機號碼</span>
                <input value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" required />
              </label>
              <label>
                <span>密碼</span>
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={5} required />
              </label>
              <button className="studentCheckInPrimary" type="submit">登入並送出「{entryLabel}」申請</button>
              {passkeyAvailable ? (
                <button
                  className="studentCheckInBiometricLogin"
                  type="button"
                  disabled={passkeyBusy}
                  onClick={() => void authenticateWithPasskey()}
                >
                  <span aria-hidden="true">◎</span>
                  {passkeyBusy ? "正在確認生物辨識…" : "使用 Face ID／指紋登入"}
                </button>
              ) : null}
              <Link className="studentCheckInTextButton" href="/check-in/forgot-password">忘記密碼</Link>
              <button className="studentCheckInTextButton" type="button" onClick={() => { setError(""); setView("register"); }}>
                第一次使用，建立會員資料
              </button>
            </form>
          </div>
        ) : null}

        {view === "register" ? (
          <>
            <h1>第一次使用</h1>
            <p className="studentCheckInLead">請建立本人資料，完成 Email 驗證後會回到「{entryLabel}」入口。</p>
            <form className="studentCheckInForm" onSubmit={submitRegistration}>
              <div className="studentCheckInFormGrid">
                <label><span>真實姓名</span><input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required /></label>
                <label><span>手機號碼</span><input value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" required /></label>
                <label><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" required /></label>
                <label><span>生日</span><input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} required /></label>
                <label><span>密碼（至少 6 碼）</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={6} required /></label>
              </div>
              {error ? <p className="studentCheckInError">{error}</p> : null}
              <button className="studentCheckInPrimary" type="submit">建立會員資料</button>
              <button className="studentCheckInTextButton" type="button" onClick={() => void returnToLogin()}>返回登入</button>
            </form>
          </>
        ) : null}

        {view === "dropInRegistration1" ? (
          <>
            <div className="studentDropInRegistrationHeading">
              <div>
                <p className="studentCheckInEyebrow">
                  {dropInCorrectionRequired ? "NT$50 DROP-IN・資料更正" : "NT$50 DROP-IN・第 1 頁，共 2 頁"}
                </p>
                <h1>{dropInCorrectionRequired ? "更正 50 元入場資料" : "50 元入場資料"}</h1>
              </div>
              <span>{dropInCorrectionRequired ? "1 / 1" : "1 / 2"}</span>
            </div>
            <p className="studentCheckInLead">
              {dropInCorrectionRequired
                ? "請重新確認並更正全部申請資料；電話與 Email 為登入帳號資料，不會在此變更。原本同意的會員條款會直接沿用。"
                : "請確認本人資料並完成所有欄位。這份資料只需登記一次，之後 10 次入場會直接沿用。"}
            </p>
            {notice ? <p className="studentCheckInNotice">{notice}</p> : null}
            <form className="studentCheckInForm" onSubmit={submitDropInRegistrationPageOne}>
              <div className="studentCheckInFormGrid">
                <label>
                  <span>姓名 Name</span>
                  <input
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    readOnly={!dropInCorrectionRequired}
                    aria-readonly={!dropInCorrectionRequired}
                    autoComplete="name"
                    maxLength={100}
                    required
                  />
                </label>
                <label>
                  <span>聯絡電話 Phone number（帳號資料）</span>
                  <input value={phone} readOnly aria-readonly="true" />
                </label>
                <label className="studentDropInFullField">
                  <span>載具（請如實填寫，才能順利寄送電子發票給您喔😊）</span>
                  <input
                    value={invoiceCarrier}
                    onChange={(event) => setInvoiceCarrier(event.target.value)}
                    placeholder="請輸入手機條碼或發票載具"
                    autoComplete="off"
                    maxLength={80}
                    required
                  />
                </label>
              </div>

              <fieldset className="studentDropInChoiceFieldset">
                <legend>性別 Gender</legend>
                <div className="studentDropInChoiceOptions">
                  <label><input type="radio" name="drop-in-gender" value="male" checked={gender === "male"} onChange={() => setGender("male")} required /><span>男</span></label>
                  <label><input type="radio" name="drop-in-gender" value="female" checked={gender === "female"} onChange={() => setGender("female")} required /><span>女</span></label>
                </div>
              </fieldset>

              <div className="studentCheckInFormGrid">
                <label>
                  <span>生日 Birthday</span>
                  <input
                    type="date"
                    value={birthDate}
                    onChange={(event) => setBirthDate(event.target.value)}
                    readOnly={!dropInCorrectionRequired}
                    aria-readonly={!dropInCorrectionRequired}
                    required
                  />
                </label>
                <label>
                  <span>帳號 Email（已驗證）</span>
                  <input type="email" value={email} readOnly aria-readonly="true" />
                </label>
              </div>

              <fieldset className="studentDropInChoiceFieldset">
                <legend>對哪一項運動比較有興趣呢？</legend>
                <div className="studentDropInChoiceOptions is-stacked">
                  <label>
                    <input type="radio" name="drop-in-interest" value="weight_training" checked={activityInterest === "weight_training"} onChange={() => setActivityInterest("weight_training")} required />
                    <span>1️⃣重量訓練課程（增肌減脂、提高代謝🔥）</span>
                  </label>
                  <label>
                    <input type="radio" name="drop-in-interest" value="reformer_pilates" checked={activityInterest === "reformer_pilates"} onChange={() => setActivityInterest("reformer_pilates")} required />
                    <span>2️⃣器械皮拉提斯課（加強核心、美化線條😍）</span>
                  </label>
                </div>
              </fieldset>

              <label>
                <span>從哪裡知道我們</span>
                <input value={discoverySource} onChange={(event) => setDiscoverySource(event.target.value)} maxLength={200} required />
              </label>
              {error ? <p className="studentCheckInError">{error}</p> : null}
              <button className="studentCheckInPrimary" type="submit" disabled={dropInRegistrationBusy}>
                {dropInRegistrationBusy
                  ? "正在儲存…"
                  : dropInCorrectionRequired
                    ? "儲存更正並重新送出申請"
                    : "繼續閱讀會員條款"}
              </button>
              <button className="studentCheckInTextButton" type="button" onClick={() => void returnToLogin()}>取消並返回登入</button>
            </form>
          </>
        ) : null}

        {view === "dropInRegistration2" ? (
          <>
            <div className="studentDropInRegistrationHeading">
              <div>
                <p className="studentCheckInEyebrow">NT$50 DROP-IN・第 2 頁，共 2 頁</p>
                <h1>會員條款與同意事項</h1>
              </div>
              <span>2 / 2</span>
            </div>
            <p className="studentCheckInLead">{STUDENT_DROP_IN_TERMS_INTRO}</p>
            <form className="studentCheckInForm" onSubmit={submitDropInRegistration}>
              <article className="studentDropInTerms" tabIndex={0} aria-label="巨挺健身會員條款">
                {STUDENT_DROP_IN_TERMS_SECTIONS.map((section) => (
                  <section key={section.title}>
                    <h2>{section.title}</h2>
                    {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  </section>
                ))}
              </article>
              <label className="studentDropInTermsAgreement">
                <input type="checkbox" checked={termsAgreed} onChange={(event) => setTermsAgreed(event.target.checked)} required />
                <span>我已閱讀並同意會員條款</span>
              </label>
              {error ? <p className="studentCheckInError">{error}</p> : null}
              <button className="studentCheckInPrimary" type="submit" disabled={dropInRegistrationBusy || !termsAgreed}>
                {dropInRegistrationBusy ? "正在儲存…" : "同意並送出 50 元入場申請"}
              </button>
              <button className="studentCheckInTextButton" type="button" disabled={dropInRegistrationBusy} onClick={() => { setError(""); setView("dropInRegistration1"); }}>
                返回修改第 1 頁
              </button>
            </form>
          </>
        ) : null}

        {view === "confirmEmail" ? (
          <div className="studentCheckInCentered">
            <div className="studentCheckInEmailMark" aria-hidden="true">@</div>
            <h1>確認 Email 是否正確</h1>
            <p className="studentCheckInLead">現在要寄送驗證信。請逐字確認下方完整 Email；若填錯，請先返回修改。</p>
            <strong className="studentCheckInEmailAddress">{email}</strong>
            {error ? <p className="studentCheckInError">{error}</p> : null}
            <div className="studentCheckInEmailActions">
              <button className="studentCheckInPrimary" type="button" onClick={() => void sendRegistration()}>
                Email 正確，寄送驗證信
              </button>
              <button className="studentCheckInTextButton" type="button" onClick={() => setView("register")}>
                返回修改 Email
              </button>
            </div>
          </div>
        ) : null}

        {view === "verifyEmail" ? (
          <div className="studentCheckInCentered">
            <div className="studentCheckInEmailMark" aria-hidden="true">✓</div>
            <h1>驗證信已寄出</h1>
            <p className="studentCheckInLead">請到下方 Email 收信並點擊驗證連結。完成後會回到「{entryLabel}」入口。</p>
            <strong className="studentCheckInEmailAddress">{verificationEmail}</strong>
            {verificationExpiresAt ? <p className="studentCheckInEmailExpiry">驗證連結於寄出後 30 分鐘內有效</p> : null}
            {notice ? <p className="studentCheckInNotice">{notice}</p> : null}
            {error ? <p className="studentCheckInError">{error}</p> : null}
            <div className="studentCheckInEmailActions">
              <button className="studentCheckInPrimary" type="button" onClick={() => void resendVerificationEmail()}>
                重新寄送驗證信
              </button>
              <button className="studentCheckInTextButton" type="button" onClick={() => void editRegistration()}>
                Email 填錯，返回修改
              </button>
              <button className="studentCheckInTextButton" type="button" onClick={() => void returnToLogin()}>
                取消並返回登入
              </button>
            </div>
          </div>
        ) : null}

        {view === "securitySetup" ? (
          <>
            <h1>首次登入安全設定</h1>
            <p className="studentCheckInLead">
              {fullName ? `${fullName}，` : ""}請設定新的正式密碼與本人 Email。完成 Email 驗證後，新資料才會正式啟用。
            </p>
            <form className="studentCheckInForm" onSubmit={submitSecuritySetup}>
              <label>
                <span>本人 Email</span>
                <input
                  type="email"
                  value={securityEmail}
                  onChange={(event) => setSecurityEmail(event.target.value)}
                  autoComplete="email"
                  inputMode="email"
                  required
                />
              </label>
              <label>
                <span>新密碼（至少 6 碼）</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
              </label>
              <label>
                <span>再次輸入新密碼</span>
                <input
                  type="password"
                  value={newPasswordConfirmation}
                  onChange={(event) => setNewPasswordConfirmation(event.target.value)}
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
              </label>
              {error ? <p className="studentCheckInError">{error}</p> : null}
              <button className="studentCheckInPrimary" type="submit">繼續確認 Email</button>
              <button className="studentCheckInTextButton" type="button" onClick={() => void returnToLogin()}>取消並返回登入</button>
            </form>
          </>
        ) : null}

        {view === "confirmSecurityEmail" ? (
          <div className="studentCheckInCentered">
            <div className="studentCheckInEmailMark" aria-hidden="true">@</div>
            <h1>確認新 Email 是否正確</h1>
            <p className="studentCheckInLead">驗證信將寄到下方完整 Email。請逐字確認；若填錯，請先返回修改。</p>
            <strong className="studentCheckInEmailAddress">{securityEmail}</strong>
            {error ? <p className="studentCheckInError">{error}</p> : null}
            <div className="studentCheckInEmailActions">
              <button className="studentCheckInPrimary" type="button" onClick={() => void sendSecuritySetup()}>
                Email 正確，寄送驗證信
              </button>
              <button className="studentCheckInTextButton" type="button" onClick={() => setView("securitySetup")}>
                返回修改 Email
              </button>
            </div>
          </div>
        ) : null}

        {view === "verifySecurityEmail" ? (
          <div className="studentCheckInCentered">
            <div className="studentCheckInEmailMark" aria-hidden="true">✓</div>
            <h1>安全設定驗證信已寄出</h1>
            <p className="studentCheckInLead">
              請到下方 Email 收信並點擊驗證連結。驗證完成後，新 Email 與新密碼會正式啟用，再回到「{entryLabel}」入口。
            </p>
            <strong className="studentCheckInEmailAddress">{verificationEmail}</strong>
            {verificationExpiresAt ? <p className="studentCheckInEmailExpiry">驗證連結於寄出後 30 分鐘內有效</p> : null}
            {notice ? <p className="studentCheckInNotice">{notice}</p> : null}
            {error ? <p className="studentCheckInError">{error}</p> : null}
            <div className="studentCheckInEmailActions">
              <button className="studentCheckInPrimary" type="button" onClick={() => void resendSecuritySetupEmail()}>
                重新寄送驗證信
              </button>
              <button className="studentCheckInTextButton" type="button" onClick={() => void editSecuritySetup()}>
                Email 填錯，返回修改
              </button>
              <button className="studentCheckInTextButton" type="button" onClick={() => void returnToLogin()}>
                取消並返回登入
              </button>
            </div>
          </div>
        ) : null}

        {view === "rejected" ? (
          <div className="studentCheckInCentered">
            <h1>請洽現場人員</h1>
            <p className="studentCheckInLead">這次報到尚未通過，請由櫃檯協助確認資料。</p>
            <button className="studentCheckInPrimary" type="button" onClick={() => void returnToLogin()}>返回登入</button>
          </div>
        ) : null}

        {view === "expired" ? (
          <div className="studentCheckInCentered" role="alertdialog" aria-modal="true" aria-labelledby="student-expired-title">
            <div className="studentCheckInExpiredMark" aria-hidden="true">!</div>
            <h1 id="student-expired-title">目前無法自主運動報到</h1>
            {startsOn && expiresOn ? <p className="studentCheckInExpiryDate">有效期限 {formatDate(startsOn)} 至 {formatDate(expiresOn)}</p> : null}
            <p className="studentCheckInError">{error}</p>
            <p className="studentCheckInLead">自主訓練請洽櫃檯更新期限；如要使用 50 元入場，請掃描 50 元入場專用 QR Code。</p>
            <button className="studentCheckInPrimary" type="button" onClick={() => void returnToLogin()}>返回登入</button>
          </div>
        ) : null}

        {view === "exhausted" ? (
          <div className="studentCheckInCentered" role="alertdialog" aria-modal="true">
            <div className="studentCheckInExpiredMark" aria-hidden="true">!</div>
            <h1>50 元入場次數已用完</h1>
            <p className="studentCheckInError">{error}</p>
            <p className="studentCheckInLead">本入口已無可用次數，請洽現場人員協助。</p>
            <button className="studentCheckInPrimary" type="button" onClick={() => void returnToLogin()}>返回登入</button>
          </div>
        ) : null}

        {view === "accountUnavailable" ? (
          <div className="studentCheckInCentered" role="alertdialog" aria-modal="true">
            <div className="studentCheckInExpiredMark" aria-hidden="true">!</div>
            <h1>帳號狀態異常</h1>
            <p className="studentCheckInError">{error}</p>
            <button className="studentCheckInPrimary" type="button" onClick={() => void returnToLogin()}>返回登入</button>
          </div>
        ) : null}

        {view === "notOfficialMember" ? (
          <div className="studentCheckInCentered" role="alertdialog" aria-modal="true">
            <div className="studentCheckInExpiredMark" aria-hidden="true">!</div>
            <h1>非本館學員</h1>
            <p className="studentCheckInError">{error}</p>
            <p className="studentCheckInLead">
              請掃描「50 元入場」專用 QR Code，完成資料填寫與現場付款後，等待工作人員確認入場。
            </p>
            <Link className="studentCheckInPrimary" href="/check-in/drop-in">前往 50 元入場</Link>
            <button className="studentCheckInTextButton" type="button" onClick={() => void returnToLogin()}>返回登入</button>
          </div>
        ) : null}

        {view === "error" ? (
          <div className="studentCheckInCentered">
            <h1>暫時無法報到</h1>
            <p className="studentCheckInError">{error}</p>
            <button className="studentCheckInPrimary" type="button" onClick={() => window.location.reload()}>重新載入</button>
          </div>
        ) : null}
      </section>

      {view === "biometricOffer" ? (
        <div className="studentCheckInPendingBackdrop">
          <section
            className="studentCheckInPendingDialog studentCheckInBiometricDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="student-passkey-title"
            aria-describedby="student-passkey-description"
          >
            <div className="studentCheckInCentered">
              <div className="studentCheckInBiometricMark" aria-hidden="true">◎</div>
              <p className="studentCheckInEyebrow">快速安全報到</p>
              <h1 id="student-passkey-title">要在這台裝置啟用生物辨識嗎？</h1>
              <p id="student-passkey-description" className="studentCheckInPraise">
                下次可直接使用 Face ID、指紋或 Windows Hello 登入並送出「{entryLabel}」申請，不必輸入密碼。
              </p>
              <p className="studentCheckInLead">系統只保存裝置產生的公開金鑰，不會取得或保存您的臉部、指紋資料。</p>
              {error ? <p className="studentCheckInError">{error}</p> : null}
              <div className="studentCheckInBiometricActions">
                <button
                  className="studentCheckInPrimary"
                  type="button"
                  disabled={passkeyBusy || !registrationOptions}
                  onClick={() => void enablePasskey()}
                >
                  {passkeyBusy ? "正在啟用…" : `啟用並繼續${entryLabel}`}
                </button>
                <button
                  className="studentCheckInTextButton"
                  type="button"
                  disabled={passkeyBusy}
                  onClick={() => void skipPasskeyOffer()}
                >
                  暫不啟用，繼續報到
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {view === "pending" ? (
        <div className="studentCheckInPendingBackdrop">
          <section
            className="studentCheckInPendingDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="student-check-in-pending-title"
            aria-describedby="student-check-in-pending-description"
          >
            <div className="studentCheckInCentered">
              <div className="studentCheckInPendingMark" aria-hidden="true">✓</div>
              <h1 id="student-check-in-pending-title">已通知櫃檯</h1>
              <p id="student-check-in-pending-description" className="studentCheckInPraise">
                {fullName ? `${fullName}，` : ""}您的{activeMode === "autonomous" ? "學生自主簽到" : activeDropInPlan.label}申請已送出。
              </p>
              <p className="studentCheckInLead">
                {activeMode === "drop_in"
                  ? activeDropInPlan.reviewPhotoRequired
                    ? "請稍候工作人員確認本人照片與五星好評照片；此視窗會自動更新。"
                    : "請稍候工作人員確認本人照片與現場收取 NT$100；不需五星好評照片，此視窗會自動更新。"
                  : "請稍候現場人員確認本人資料；此視窗會自動更新。"}
              </p>
            </div>
          </section>
        </div>
      ) : null}

      {view === "success" && (success?.checkIn || success?.dropInCheckIn) ? (
        <div className="studentCheckInPendingBackdrop">
          <section
            className="studentCheckInPendingDialog studentCheckInSuccessDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="student-check-in-success-title"
            aria-describedby="student-check-in-success-description"
          >
            <div className="studentCheckInCentered">
              <div className="studentCheckInApprovedMark" aria-hidden="true">✓</div>
              <h1 id="student-check-in-success-title">報到完成</h1>
              <p className="studentCheckInTime">
                放行時間 {formatTaipeiTime((success.checkIn || success.dropInCheckIn)!.checked_in_at)}
              </p>
              {activeMode === "autonomous" && success.checkIn ? (
                <>
                  <p id="student-check-in-success-description" className="studentCheckInPraise">{success.encouragement}</p>
                  <p className="studentCheckInCount">今日第 {success.checkIn.daily_sequence} 次・本月第 {success.checkIn.month_sequence} 次自主運動</p>
                </>
              ) : success.dropInCheckIn ? (
                <>
                  <p id="student-check-in-success-description" className="studentCheckInPraise">{success.dropInCheckIn.price_twd} 元入場已放行，祝您今天運動順利！</p>
                  <p className="studentCheckInCount">本方案第 {success.dropInCheckIn.use_sequence} 次・{success.dropInCheckIn.remaining_uses === null ? "不限次數" : `剩餘 ${success.dropInCheckIn.remaining_uses} 次`}</p>
                </>
              ) : null}
              <Link className="studentCheckInPrimary" href="/">開始運動！GO</Link>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default function StudentCheckInPage() {
  return <StudentCheckInExperience entryMode="autonomous" />;
}
