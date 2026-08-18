"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StudentCheckInHistory } from "../../../../components/student-checkin-history";
import { StudentCheckInLockerKeyDialog } from "../../../../components/student-checkin-locker-key-dialog";
import {
  studentDropInActivityInterestLabel,
  studentDropInGenderLabel,
  type StudentDropInActivityInterest,
  type StudentDropInGender,
} from "../../../../lib/student-drop-in-registration";
import { userFacingErrorMessage } from "../../../../lib/user-facing-error";
import {
  STUDENT_CHECKIN_ADMIN_PENDING_EVENT,
  studentCheckInAdminDecisionRequest,
  type StudentCheckInLockerKeySelection,
} from "../../../../lib/student-checkin-entry";
import {
  studentDropInPlanDetails,
  type StudentDropInEntryPlan,
} from "../../../../lib/student-drop-in-plan";

type DropInProfile = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  birth_date: string | null;
  photo_url: string | null;
  review_photo_url: string | null;
  review_photo_uploaded_at: string | null;
  invoice_carrier: string | null;
  gender: StudentDropInGender | null;
  activity_interest: StudentDropInActivityInterest | null;
  discovery_source: string | null;
  terms_version: string | null;
  terms_accepted_at: string | null;
  drop_in_total_uses: number;
  drop_in_used_uses: number;
  drop_in_remaining_uses: number | null;
  drop_in_entry_plan: StudentDropInEntryPlan;
  drop_in_price_twd: number;
  drop_in_review_photo_required: boolean;
  drop_in_unlimited_uses: boolean;
  autonomous_access_status: "blocked" | "formal_member" | "non_member";
};

type DropInPendingRequest = {
  id: string;
  auth_method: "phone" | "passkey";
  requested_at: string;
  student_profile_id: string;
  profile: DropInProfile;
};

type DropInRow = {
  id: string;
  student_profile_id: string;
  full_name: string;
  phone: string;
  birth_date: string | null;
  photo_url: string | null;
  review_photo_url: string | null;
  checked_in_at: string;
  local_date: string;
  use_sequence: number;
  remaining_uses: number | null;
  price_twd: number;
  entry_plan: StudentDropInEntryPlan;
};

type DropInAdminResponse = {
  ok?: boolean;
  dropInCheckInUrl?: string;
  dropInPending?: DropInPendingRequest[];
  pending?: unknown[];
  dropInToday?: DropInRow[];
  students?: DropInProfile[];
  error?: string;
};

type CapturedPhoto = { requestId: string; file: File; preview: string };
type DropInRejectionAction = "general" | "data_correction";

const ADMIN_PATH = "/admin/student-check-ins/drop-in";
const DROP_IN_LOAD_ERROR = "50 元入場資料暫時無法載入，系統會自動重試。";

function formatEntryAccess(status: DropInProfile["autonomous_access_status"] | undefined) {
  if (status === "blocked") return "禁止入場（內部）";
  if (status === "formal_member") return "可使用訪客入場・正式學員";
  if (status === "non_member") return "可使用訪客入場・非正式學員";
  return "無法確認";
}

function redirectToAdminLogin() {
  const loginUrl = new URL("/admin/student-check-ins/login", window.location.origin);
  loginUrl.searchParams.set("returnTo", ADMIN_PATH);
  window.location.replace(loginUrl.toString());
}

function handleAdminAuthFailure(response: Response) {
  if (response.status !== 401) return false;
  redirectToAdminLogin();
  return true;
}

function todayDateInputValue() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatTaipeiDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatBirthday(value: string | null) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return `${year}/${month}/${day}`;
}

async function compressPhoto(file: File, kind: "profile" | "review") {
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("照片讀取失敗"));
      element.src = imageUrl;
    });
    const maxSide = kind === "review" ? 1600 : 1200;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("照片處理失敗");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const quality = kind === "review" ? 0.9 : 0.82;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("照片處理失敗");
    return new File([blob], kind === "review" ? "five-star-review.jpg" : "student-photo.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export default function StudentDropInAdminPage() {
  const [date, setDate] = useState(todayDateInputValue());
  const [checkInUrl, setCheckInUrl] = useState("");
  const [pending, setPending] = useState<DropInPendingRequest[]>([]);
  const [today, setToday] = useState<DropInRow[]>([]);
  const [students, setStudents] = useState<DropInProfile[]>([]);
  const [selectedCheckIn, setSelectedCheckIn] = useState<DropInRow | null>(null);
  const [capturedProfilePhoto, setCapturedProfilePhoto] = useState<CapturedPhoto | null>(null);
  const [capturedReviewPhoto, setCapturedReviewPhoto] = useState<CapturedPhoto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeciding, setIsDeciding] = useState(false);
  const [lockerPromptRequestId, setLockerPromptRequestId] = useState("");
  const [rejectOptionsRequestId, setRejectOptionsRequestId] = useState("");
  const [uploadingKind, setUploadingKind] = useState<"profile" | "review" | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const hasLoadedCheckInsRef = useRef(false);
  const profilePhotoInputRef = useRef<HTMLInputElement>(null);
  const reviewPhotoInputRef = useRef<HTMLInputElement>(null);

  const activeRequest = pending[0] || null;
  const studentsById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const selectedStudent = selectedCheckIn ? studentsById.get(selectedCheckIn.student_profile_id) || null : null;
  const qrUrl = useMemo(() => {
    if (!checkInUrl) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=12&data=${encodeURIComponent(checkInUrl)}`;
  }, [checkInUrl]);

  const loadCheckIns = useCallback(async (quiet = false) => {
    if (!quiet) setIsLoading(true);
    if (!quiet) setError("");
    try {
      const response = await fetch(`/api/admin/student-check-ins?date=${encodeURIComponent(date)}`, { cache: "no-store" });
      if (handleAdminAuthFailure(response)) return;
      const payload = (await response.json().catch(() => null)) as DropInAdminResponse | null;
      if (!response.ok || !payload?.ok) {
        if (!quiet || !hasLoadedCheckInsRef.current) {
          setError(response.status === 403
            ? "此帳號沒有報到管理權限。"
            : userFacingErrorMessage(payload?.error, DROP_IN_LOAD_ERROR));
        }
        if (!quiet) {
          setPending([]);
          setToday([]);
        }
        return;
      }
      setCheckInUrl(payload.dropInCheckInUrl || "");
      setPending(payload.dropInPending || []);
      window.dispatchEvent(new CustomEvent(STUDENT_CHECKIN_ADMIN_PENDING_EVENT, { detail: payload }));
      setToday(payload.dropInToday || []);
      setStudents(payload.students || []);
      hasLoadedCheckInsRef.current = true;
      setError("");
    } catch {
      if (!quiet || !hasLoadedCheckInsRef.current) setError(DROP_IN_LOAD_ERROR);
    } finally {
      setIsLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void loadCheckIns();
    const timer = window.setInterval(() => void loadCheckIns(true), 5000);
    return () => window.clearInterval(timer);
  }, [loadCheckIns]);

  useEffect(() => () => {
    if (capturedProfilePhoto?.preview) URL.revokeObjectURL(capturedProfilePhoto.preview);
  }, [capturedProfilePhoto]);

  useEffect(() => () => {
    if (capturedReviewPhoto?.preview) URL.revokeObjectURL(capturedReviewPhoto.preview);
  }, [capturedReviewPhoto]);

  useEffect(() => {
    if (!selectedCheckIn) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedCheckIn(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedCheckIn]);

  async function selectPhoto(event: ChangeEvent<HTMLInputElement>, kind: "profile" | "review") {
    const selected = event.target.files?.[0];
    const requestId = activeRequest?.id;
    event.target.value = "";
    if (!selected || !requestId) return;
    setError("");
    try {
      const compressed = await compressPhoto(selected, kind);
      const captured = { requestId, file: compressed, preview: URL.createObjectURL(compressed) };
      if (kind === "profile") setCapturedProfilePhoto(captured);
      else setCapturedReviewPhoto(captured);
    } catch {
      setError("照片無法讀取，請重新選擇。");
    }
  }

  async function uploadPhoto(kind: "profile" | "review") {
    const captured = kind === "profile" ? capturedProfilePhoto : capturedReviewPhoto;
    if (!activeRequest || captured?.requestId !== activeRequest.id) return;
    setUploadingKind(kind);
    setError("");
    setNotice("");
    const form = new FormData();
    form.set("photo", captured.file);
    const suffix = kind === "profile" ? "photo" : "review-photo";
    const response = await fetch(`/api/admin/student-check-ins/drop-in/${activeRequest.id}/${suffix}`, {
      method: "POST",
      body: form,
    });
    if (handleAdminAuthFailure(response)) return;
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      photoUrl?: string;
      reviewPhotoUrl?: string;
      error?: string;
    } | null;
    const photoUrl = kind === "profile" ? payload?.photoUrl : payload?.reviewPhotoUrl;
    if (!response.ok || !payload?.ok || !photoUrl) {
      setError(payload?.error || "照片上傳失敗，請重新選擇。");
      setUploadingKind("");
      return;
    }
    setPending((current) => current.map((item) => (
      item.id === activeRequest.id
        ? {
            ...item,
            profile: kind === "profile"
              ? { ...item.profile, photo_url: photoUrl }
              : { ...item.profile, review_photo_url: photoUrl, review_photo_uploaded_at: new Date().toISOString() },
          }
        : item
    )));
    setStudents((current) => current.map((student) => (
      student.id === activeRequest.profile.id
        ? kind === "profile"
          ? { ...student, photo_url: photoUrl }
          : { ...student, review_photo_url: photoUrl, review_photo_uploaded_at: new Date().toISOString() }
        : student
    )));
    if (kind === "profile") setCapturedProfilePhoto(null);
    else setCapturedReviewPhoto(null);
    setNotice(kind === "profile" ? "本人照片已儲存，兩個簽到區會共用這張照片。" : "五星好評照片已儲存，可進行放行。" );
    setUploadingKind("");
  }

  async function decide(
    requestId: string,
    decision: "approved" | "rejected",
    rejectionAction?: DropInRejectionAction,
    lockerKey?: StudentCheckInLockerKeySelection,
  ) {
    setIsDeciding(true);
    setError("");
    setNotice("");
    const decisionRequest = studentCheckInAdminDecisionRequest("drop_in", requestId, decision, rejectionAction, lockerKey);
    const response = await fetch(decisionRequest.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(decisionRequest.body),
    });
    if (handleAdminAuthFailure(response)) {
      setIsDeciding(false);
      return;
    }
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !payload?.ok) {
      setError(payload?.error || "無法更新 50 元入場狀態。");
      setIsDeciding(false);
      return;
    }
    setPending((current) => current.filter((item) => item.id !== requestId));
    setCapturedProfilePhoto(null);
    setCapturedReviewPhoto(null);
    setLockerPromptRequestId("");
    setRejectOptionsRequestId("");
    setIsDeciding(false);
    await loadCheckIns(true);
    if (decision === "rejected") {
      setNotice(
        rejectionAction === "data_correction"
          ? "已拒絕並要求對方重新確認及更正第一頁資料。"
          : "已一般拒絕；對方可直接重新送出入場申請。",
      );
    }
  }

  const activeProfilePreview = capturedProfilePhoto && activeRequest && capturedProfilePhoto.requestId === activeRequest.id
    ? capturedProfilePhoto.preview
    : "";
  const activeReviewPreview = capturedReviewPhoto && activeRequest && capturedReviewPhoto.requestId === activeRequest.id
    ? capturedReviewPhoto.preview
    : "";
  const activeEntryPlan = activeRequest?.profile.drop_in_entry_plan || "review_50";
  const activePlan = studentDropInPlanDetails(activeEntryPlan);
  const canApprove = Boolean(
    activeRequest?.profile.photo_url
      && (!activePlan.reviewPhotoRequired || activeRequest.profile.review_photo_url),
  );

  return (
    <main className="studentCheckInsAdminPage">
      <section className="studentCheckInsAdminShell">
        <header className="studentCheckInsAdminHeader">
          <div>
            <p className="studentCheckInEyebrow">BIGE CHECK-IN</p>
            <h1>50 元入場</h1>
            <p>每位會員共 10 次；核對本人與五星好評照片後放行，成功放行才扣 1 次。</p>
          </div>
          <div className="studentCheckInsHeaderActions">
            <span className={pending.length > 0 ? "studentCheckInsPendingBadge is-active" : "studentCheckInsPendingBadge"}>待確認 {pending.length}</span>
            <button className="studentCheckInsAdminButton" type="button" onClick={() => void loadCheckIns()} disabled={isLoading}>{isLoading ? "更新中" : "重新整理"}</button>
          </div>
        </header>

        <nav className="studentCheckInsModeTabs" aria-label="報到類型">
          <Link href="/admin/student-check-ins">自主運動</Link>
          <Link className="is-active" href="/admin/student-check-ins/drop-in">50 元入場</Link>
        </nav>

        <section className="studentCheckInsAdminGrid">
          <article className="studentCheckInsQrCard">
            <div>
              <p className="studentCheckInEyebrow">SCAN</p>
              <h2>50 元入場專用 QR Code</h2>
              <p>訪客掃描並登入後，只會送出 50 元入場申請，不會進入學生自主訓練。</p>
            </div>
            {qrUrl ? <img src={qrUrl} alt="BigE 50 元入場 QR Code" /> : <div className="studentCheckInsQrEmpty">準備 QR Code</div>}
            <p className="studentCheckInsUrl">{checkInUrl || "-"}</p>
          </article>
          <article className="studentCheckInsSummaryCard">
            <p className="studentCheckInEyebrow">TODAY</p>
            <strong>{today.length}</strong>
            <span>所選日期已放行的 50 元入場</span>
          </article>
        </section>

        <section className="studentCheckInsAdminToolbar">
          <label><span>查詢日期</span><span className="studentCheckInsDateField"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></span></label>
        </section>

        {error ? <div className="studentCheckInsAdminError">{error}</div> : null}
        {notice ? <div className="studentCheckInsAdminNotice">{notice}</div> : null}

        <section className="studentCheckInsTableCard">
          <h2>今日 50 元入場</h2>
          <div className="studentCheckInsRecentList studentDropInRecentList">
            {today.length === 0 ? <p className="studentCheckInsEmpty">{isLoading ? "正在載入報到資料" : "所選日期尚無 50 元入場紀錄。"}</p> : null}
            {today.map((item) => (
              <article key={item.id}>
                {item.photo_url ? (
                  <button className="studentCheckInsRecentPhotoButton" type="button" onClick={() => setSelectedCheckIn(item)} aria-label={`查看 ${item.full_name} 的資料`}>
                    <img src={item.photo_url} alt={`${item.full_name} 的本人照片`} />
                  </button>
                ) : <div className="studentCheckInsRecentPhotoEmpty">無照片</div>}
                <div className="studentCheckInsRecentInfo">
                  <strong>{item.full_name}</strong>
                  <span>{formatTaipeiDateTime(item.checked_in_at)}</span>
                  <span>{item.phone}・生日 {formatBirthday(item.birth_date)}・NT${item.price_twd}・第 {item.use_sequence} 次使用</span>
                </div>
                <div className="studentDropInRemaining"><span>剩餘次數</span><strong>{item.entry_plan === "standard_100" ? "不限" : item.remaining_uses}</strong>{item.entry_plan === "review_50" ? <em>／10</em> : null}</div>
              </article>
            ))}
          </div>
        </section>
      </section>

      {activeRequest && lockerPromptRequestId !== activeRequest.id ? (
        <div className="studentCheckInsApprovalBackdrop" role="presentation">
          <section className="studentCheckInsApprovalDialog studentDropInApprovalDialog" role="dialog" aria-modal="true" aria-labelledby="drop-in-approval-title">
            <div className={activePlan.reviewPhotoRequired ? "studentDropInEvidenceGrid" : "studentDropInEvidenceGrid is-single-evidence"}>
              <div className="studentDropInEvidenceCard">
                <span>本人照片</span>
                {activeRequest.profile.photo_url ? <img src={activeRequest.profile.photo_url} alt={`${activeRequest.profile.full_name} 的本人照片`} /> : activeProfilePreview ? (
                  <div className="studentCheckInsPhotoPreview">
                    <img src={activeProfilePreview} alt="尚未確認的本人照片" />
                    <div className="studentCheckInsPhotoActions">
                      <button type="button" disabled={Boolean(uploadingKind)} onClick={() => void uploadPhoto("profile")}>{uploadingKind === "profile" ? "上傳中" : "使用這張照片"}</button>
                      <button type="button" disabled={Boolean(uploadingKind)} onClick={() => profilePhotoInputRef.current?.click()}>重新拍攝</button>
                    </div>
                  </div>
                ) : <button className="studentCheckInsPhotoCapture" type="button" onClick={() => profilePhotoInputRef.current?.click()}><strong>拍攝本人照片</strong><span>會與自主運動簽到共用</span></button>}
                <input ref={profilePhotoInputRef} className="studentCheckInsPhotoInput" type="file" accept="image/*" capture="environment" onChange={(event) => void selectPhoto(event, "profile")} />
              </div>
              {activePlan.reviewPhotoRequired ? <div className="studentDropInEvidenceCard">
                <span>五星好評照片</span>
                {activeRequest.profile.review_photo_url ? <img src={activeRequest.profile.review_photo_url} alt={`${activeRequest.profile.full_name} 的五星好評照片`} /> : activeReviewPreview ? (
                  <div className="studentCheckInsPhotoPreview">
                    <img src={activeReviewPreview} alt="尚未確認的五星好評照片" />
                    <div className="studentCheckInsPhotoActions">
                      <button type="button" disabled={Boolean(uploadingKind)} onClick={() => void uploadPhoto("review")}>{uploadingKind === "review" ? "上傳中" : "使用這張照片"}</button>
                      <button type="button" disabled={Boolean(uploadingKind)} onClick={() => reviewPhotoInputRef.current?.click()}>重新選擇</button>
                    </div>
                  </div>
                ) : <button className="studentCheckInsPhotoCapture" type="button" onClick={() => reviewPhotoInputRef.current?.click()}><strong>上傳五星好評照片</strong><span>上傳後 10 次入場共用</span></button>}
                <input ref={reviewPhotoInputRef} className="studentCheckInsPhotoInput" type="file" accept="image/*" onChange={(event) => void selectPhoto(event, "review")} />
              </div> : null}
            </div>
            <div className="studentCheckInsApprovalInfo">
              <p className="studentCheckInEyebrow">NT${activePlan.priceTwd} DROP-IN REQUEST</p>
              <h2 id="drop-in-approval-title">{activeRequest.profile.full_name}</h2>
              {activeEntryPlan === "standard_100" ? (
                <div className="studentDropInPlanNotice is-standard-100" role="note">
                  <strong>現場收費 NT$100</strong>
                  <span>已有本人照片・未完成五星好評・免上傳五星好評照片・放行不限次數</span>
                </div>
              ) : null}
              <dl>
                <div><dt>電話</dt><dd>{activeRequest.profile.phone}</dd></div>
                <div><dt>Email</dt><dd>{activeRequest.profile.email || "-"}</dd></div>
                <div><dt>生日</dt><dd>{formatBirthday(activeRequest.profile.birth_date)}</dd></div>
                <div><dt>入場資格</dt><dd>{formatEntryAccess(activeRequest.profile.autonomous_access_status)}</dd></div>
                <div><dt>性別</dt><dd>{studentDropInGenderLabel(activeRequest.profile.gender)}</dd></div>
                <div><dt>發票載具</dt><dd>{activeRequest.profile.invoice_carrier || "-"}</dd></div>
                <div><dt>感興趣項目</dt><dd>{studentDropInActivityInterestLabel(activeRequest.profile.activity_interest)}</dd></div>
                <div><dt>得知來源</dt><dd>{activeRequest.profile.discovery_source || "-"}</dd></div>
                <div><dt>會員條款</dt><dd>{activeRequest.profile.terms_accepted_at ? `${formatTaipeiDateTime(activeRequest.profile.terms_accepted_at)} 已同意` : "尚未同意"}</dd></div>
                <div><dt>送出時間</dt><dd>{formatTaipeiDateTime(activeRequest.requested_at)}</dd></div>
                <div><dt>本次費用</dt><dd>NT${activePlan.priceTwd}</dd></div>
                <div><dt>剩餘次數</dt><dd>{activePlan.unlimitedUses ? "不限次數" : `${activeRequest.profile.drop_in_remaining_uses}／${activeRequest.profile.drop_in_total_uses}`}</dd></div>
              </dl>
              <p className="studentCheckInsApprovalHint">{activePlan.reviewPhotoRequired
                ? canApprove ? "兩張照片皆已備妥，請核對現場本人與五星好評後再放行。" : "必須先備妥本人照片與五星好評照片，才能放行。"
                : canApprove ? "請核對本人照片並收取 NT$100 後放行；不需五星好評照片。" : "請先備妥本人照片；不需五星好評照片。"}</p>
              {rejectOptionsRequestId === activeRequest.id ? (
                <div className="studentDropInRejectOptions" role="group" aria-label="選擇拒絕方式">
                  <strong>請選擇拒絕方式</strong>
                  <p>兩種拒絕都不會扣除入場次數。</p>
                  <button className="studentCheckInsRejectButton" type="button" disabled={isDeciding} onClick={() => void decide(activeRequest.id, "rejected", "general")}>
                    {isDeciding ? "處理中" : "一般拒絕"}
                  </button>
                  <button className="studentCheckInsRejectButton studentDropInCorrectionRejectButton" type="button" disabled={isDeciding} onClick={() => void decide(activeRequest.id, "rejected", "data_correction")}>
                    {isDeciding ? "處理中" : "拒絕並要求更正資料"}
                  </button>
                  <button className="studentCheckInTextButton" type="button" disabled={isDeciding} onClick={() => setRejectOptionsRequestId("")}>取消</button>
                </div>
              ) : (
                <div className="studentCheckInsApprovalActions">
                  <button className="studentCheckInsRejectButton" type="button" disabled={isDeciding || Boolean(uploadingKind)} onClick={() => setRejectOptionsRequestId(activeRequest.id)}>拒絕</button>
                  <button className="studentCheckInsApproveButton" type="button" disabled={isDeciding || Boolean(uploadingKind) || !canApprove} onClick={() => { setError(""); setLockerPromptRequestId(activeRequest.id); }}>{activePlan.unlimitedUses ? "收 NT$100 後放行" : "放行並扣 1 次"}</button>
                </div>
              )}
              {pending.length > 1 ? <p className="studentCheckInsQueueNote">後面還有 {pending.length - 1} 位等待確認</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {activeRequest && lockerPromptRequestId === activeRequest.id ? (
        <StudentCheckInLockerKeyDialog
          key={activeRequest.id}
          isSubmitting={isDeciding}
          error={error}
          onConfirm={(lockerKey) => void decide(activeRequest.id, "approved", undefined, lockerKey)}
        />
      ) : null}

      {selectedCheckIn?.photo_url ? (
        <div className="studentCheckInsProfileBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedCheckIn(null); }}>
          <section className="studentCheckInsProfileDialog studentDropInProfileDialog" role="dialog" aria-modal="true" aria-labelledby="drop-in-profile-title">
            <button className="studentCheckInsProfileClose" type="button" aria-label="關閉會員資料" title="關閉" onClick={() => setSelectedCheckIn(null)}>×</button>
            <div className="studentDropInProfilePhotos">
              <figure><img src={selectedCheckIn.photo_url} alt={`${selectedCheckIn.full_name} 的本人照片`} /><figcaption>本人照片</figcaption></figure>
              {selectedCheckIn.review_photo_url ? <figure><img src={selectedCheckIn.review_photo_url} alt={`${selectedCheckIn.full_name} 的五星好評照片`} /><figcaption>五星好評照片</figcaption></figure> : null}
            </div>
            <div className="studentCheckInsProfileInfo">
              <p className="studentCheckInEyebrow">NT${selectedCheckIn.price_twd} DROP-IN PROFILE</p>
              <h2 id="drop-in-profile-title">{selectedCheckIn.full_name}</h2>
              <dl>
                <div><dt>電話</dt><dd>{selectedCheckIn.phone}</dd></div>
                <div><dt>Email</dt><dd>{selectedStudent?.email || "-"}</dd></div>
                <div><dt>生日</dt><dd>{formatBirthday(selectedCheckIn.birth_date)}</dd></div>
                <div><dt>入場資格</dt><dd>{formatEntryAccess(selectedStudent?.autonomous_access_status)}</dd></div>
                <div><dt>性別</dt><dd>{studentDropInGenderLabel(selectedStudent?.gender)}</dd></div>
                <div><dt>發票載具</dt><dd>{selectedStudent?.invoice_carrier || "-"}</dd></div>
                <div><dt>感興趣項目</dt><dd>{studentDropInActivityInterestLabel(selectedStudent?.activity_interest)}</dd></div>
                <div><dt>得知來源</dt><dd>{selectedStudent?.discovery_source || "-"}</dd></div>
                <div><dt>會員條款</dt><dd>{selectedStudent?.terms_accepted_at ? `${formatTaipeiDateTime(selectedStudent.terms_accepted_at)} 已同意` : "尚未同意"}</dd></div>
                <div><dt>報到時間</dt><dd>{formatTaipeiDateTime(selectedCheckIn.checked_in_at)}</dd></div>
                <div><dt>本次費用</dt><dd>NT${selectedCheckIn.price_twd}</dd></div>
                <div><dt>使用進度</dt><dd>{selectedCheckIn.entry_plan === "standard_100" ? `第 ${selectedCheckIn.use_sequence} 次，不限次數` : `第 ${selectedCheckIn.use_sequence} 次，剩餘 ${selectedCheckIn.remaining_uses} 次`}</dd></div>
              </dl>
              <StudentCheckInHistory
                key={selectedCheckIn.student_profile_id}
                mode="drop_in"
                studentId={selectedCheckIn.student_profile_id}
                returnTo={ADMIN_PATH}
              />
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
