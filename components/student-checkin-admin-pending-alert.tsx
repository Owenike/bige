"use client";

/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { StudentCheckInLockerKeyDialog } from "./student-checkin-locker-key-dialog";
import {
  STUDENT_CHECKIN_ADMIN_PENDING_EVENT,
  sortStudentCheckInPendingQueue,
  studentCheckInAdminAlertScope,
  studentCheckInAdminDecisionRequest,
  type StudentCheckInAdminDecision,
  type StudentCheckInEntryMode,
  type StudentCheckInLockerKeySelection,
  type StudentDropInRejectionAction,
} from "../lib/student-checkin-entry";
import { userFacingErrorMessage } from "../lib/user-facing-error";
import {
  studentDropInPlanDetails,
  type StudentDropInEntryPlan,
} from "../lib/student-drop-in-plan";

type PendingProfile = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  birth_date: string | null;
  membership_starts_on: string | null;
  membership_expires_on: string | null;
  photo_url: string | null;
  review_photo_url: string | null;
  drop_in_total_uses: number;
  drop_in_remaining_uses: number | null;
  drop_in_entry_plan: StudentDropInEntryPlan;
  drop_in_price_twd: number;
  drop_in_review_photo_required: boolean;
  drop_in_unlimited_uses: boolean;
};

type PendingRequest = {
  id: string;
  auth_method: "line" | "phone" | "passkey";
  requested_at: string;
  student_profile_id: string;
  profile: PendingProfile;
  mode: StudentCheckInEntryMode;
};

type PendingResponse = {
  ok?: boolean;
  pending?: Omit<PendingRequest, "mode">[];
  dropInPending?: Omit<PendingRequest, "mode">[];
  error?: string;
};

type CapturedPhoto = { requestId: string; file: File; preview: string };
type PhotoKind = "profile" | "review";

function redirectToAdminLogin() {
  const loginUrl = new URL("/admin/student-check-ins/login", window.location.origin);
  loginUrl.searchParams.set("returnTo", window.location.pathname);
  window.location.replace(loginUrl.toString());
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

function formatDate(value: string | null) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return `${year}/${month}/${day}`;
}

async function compressPhoto(file: File, kind: PhotoKind) {
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
    const blob = await new Promise<Blob | null>((resolve) => (
      canvas.toBlob(resolve, "image/jpeg", kind === "review" ? 0.9 : 0.82)
    ));
    if (!blob) throw new Error("照片處理失敗");
    return new File(
      [blob],
      kind === "review" ? "five-star-review.jpg" : "student-photo.jpg",
      { type: "image/jpeg" },
    );
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export function StudentCheckInAdminPendingAlert() {
  const pathname = usePathname();
  const pageHandlesPendingQueue = pathname === "/admin/student-check-ins"
    || pathname === "/admin/student-check-ins/drop-in";
  const isEnabled = pathname !== "/admin/student-check-ins/login";
  const shouldPoll = isEnabled && !pageHandlesPendingQueue;
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [capturedProfilePhoto, setCapturedProfilePhoto] = useState<CapturedPhoto | null>(null);
  const [capturedReviewPhoto, setCapturedReviewPhoto] = useState<CapturedPhoto | null>(null);
  const [uploadingKind, setUploadingKind] = useState<PhotoKind | "">("");
  const [isDeciding, setIsDeciding] = useState(false);
  const [lockerPromptRequestId, setLockerPromptRequestId] = useState("");
  const [rejectOptionsRequestId, setRejectOptionsRequestId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const profilePhotoInputRef = useRef<HTMLInputElement>(null);
  const reviewPhotoInputRef = useRef<HTMLInputElement>(null);

  const activeRequest = pending[0] || null;
  const activeProfilePreview = capturedProfilePhoto && activeRequest && capturedProfilePhoto.requestId === activeRequest.id
    ? capturedProfilePhoto.preview
    : "";
  const activeReviewPreview = capturedReviewPhoto && activeRequest && capturedReviewPhoto.requestId === activeRequest.id
    ? capturedReviewPhoto.preview
    : "";
  const isDropIn = activeRequest?.mode === "drop_in";
  const activeEntryPlan = activeRequest?.profile.drop_in_entry_plan || "review_50";
  const activePlan = studentDropInPlanDetails(activeEntryPlan);
  const canApprove = Boolean(
    activeRequest?.profile.photo_url
      && (!isDropIn || !activePlan.reviewPhotoRequired || activeRequest.profile.review_photo_url),
  );

  const applyPendingPayload = useCallback((payload: PendingResponse) => {
    const autonomous = (payload.pending || []).map((item) => ({ ...item, mode: "autonomous" as const }));
    const dropIn = (payload.dropInPending || []).map((item) => ({ ...item, mode: "drop_in" as const }));
    const scope = studentCheckInAdminAlertScope(pathname, autonomous.length, dropIn.length);
    const queue = scope === "all"
      ? [...autonomous, ...dropIn]
      : scope === "autonomous"
        ? autonomous
        : scope === "drop_in"
          ? dropIn
          : [];
    setPending(sortStudentCheckInPendingQueue(queue));
    setError("");
  }, [pathname]);

  const loadPending = useCallback(async () => {
    if (!shouldPoll) return;
    try {
      const response = await fetch("/api/admin/student-check-ins", { cache: "no-store" });
      if (response.status === 401) {
        redirectToAdminLogin();
        return;
      }
      const payload = (await response.json().catch(() => null)) as PendingResponse | null;
      if (!response.ok || !payload?.ok) {
        setError(response.status === 403
          ? "此帳號沒有報到管理權限。"
          : userFacingErrorMessage(payload?.error, "待放行資料暫時無法載入，系統會自動重試。"));
        return;
      }
      applyPendingPayload(payload);
    } catch {
      setError("網路連線不穩定，系統會自動重新取得待放行資料。");
    }
  }, [applyPendingPayload, shouldPoll]);

  useEffect(() => {
    if (!shouldPoll) return;
    void loadPending();
    const timer = window.setInterval(() => void loadPending(), 2000);
    return () => window.clearInterval(timer);
  }, [loadPending, shouldPoll]);

  useEffect(() => {
    if (!isEnabled) return;
    function receivePending(event: Event) {
      const payload = (event as CustomEvent<PendingResponse>).detail;
      if (payload?.ok) applyPendingPayload(payload);
    }
    window.addEventListener(STUDENT_CHECKIN_ADMIN_PENDING_EVENT, receivePending);
    return () => window.removeEventListener(STUDENT_CHECKIN_ADMIN_PENDING_EVENT, receivePending);
  }, [applyPendingPayload, isEnabled]);

  useEffect(() => {
    setPending([]);
  }, [pathname]);

  useEffect(() => () => {
    if (capturedProfilePhoto?.preview) URL.revokeObjectURL(capturedProfilePhoto.preview);
  }, [capturedProfilePhoto]);

  useEffect(() => () => {
    if (capturedReviewPhoto?.preview) URL.revokeObjectURL(capturedReviewPhoto.preview);
  }, [capturedReviewPhoto]);

  async function selectPhoto(event: ChangeEvent<HTMLInputElement>, kind: PhotoKind) {
    const selected = event.target.files?.[0];
    const requestId = activeRequest?.id;
    event.target.value = "";
    if (!selected || !requestId) return;
    setError("");
    setNotice("");
    try {
      const file = await compressPhoto(selected, kind);
      const captured = { requestId, file, preview: URL.createObjectURL(file) };
      if (kind === "profile") setCapturedProfilePhoto(captured);
      else setCapturedReviewPhoto(captured);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "照片無法讀取，請重新選擇。");
    }
  }

  async function uploadPhoto(kind: PhotoKind) {
    if (!activeRequest || (kind === "review" && activeRequest.mode !== "drop_in")) return;
    const captured = kind === "profile" ? capturedProfilePhoto : capturedReviewPhoto;
    if (!captured || captured.requestId !== activeRequest.id) return;
    setUploadingKind(kind);
    setError("");
    setNotice("");
    const form = new FormData();
    form.set("photo", captured.file);
    const endpoint = activeRequest.mode === "drop_in"
      ? `/api/admin/student-check-ins/drop-in/${activeRequest.id}/${kind === "profile" ? "photo" : "review-photo"}`
      : `/api/admin/student-check-ins/${activeRequest.id}/photo`;
    try {
      const response = await fetch(endpoint, { method: "POST", body: form });
      if (response.status === 401) {
        redirectToAdminLogin();
        return;
      }
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        photoUrl?: string;
        reviewPhotoUrl?: string;
        error?: string;
      } | null;
      const photoUrl = kind === "profile" ? payload?.photoUrl : payload?.reviewPhotoUrl;
      if (!response.ok || !payload?.ok || !photoUrl) {
        setError(payload?.error || "照片上傳失敗，請重新選擇。");
        return;
      }
      const profileId = activeRequest.profile.id;
      setPending((current) => current.map((item) => (
        item.profile.id !== profileId
          ? item
          : {
              ...item,
              profile: kind === "profile"
                ? { ...item.profile, photo_url: photoUrl }
                : { ...item.profile, review_photo_url: photoUrl },
            }
      )));
      if (kind === "profile") setCapturedProfilePhoto(null);
      else setCapturedReviewPhoto(null);
      setNotice(kind === "profile"
        ? "本人照片已儲存，兩個入場區會共用這張照片。"
        : "五星好評照片已儲存，可進行放行。"
      );
      window.dispatchEvent(new Event("student-checkin-admin-updated"));
    } finally {
      setUploadingKind("");
    }
  }

  async function decide(
    decision: StudentCheckInAdminDecision,
    rejectionAction?: StudentDropInRejectionAction,
    lockerKey?: StudentCheckInLockerKeySelection,
  ) {
    if (!activeRequest) return;
    setIsDeciding(true);
    setError("");
    setNotice("");
    try {
      const decisionRequest = studentCheckInAdminDecisionRequest(
        activeRequest.mode,
        activeRequest.id,
        decision,
        rejectionAction,
        lockerKey,
      );
      const response = await fetch(decisionRequest.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(decisionRequest.body),
      });
      if (response.status === 401) {
        redirectToAdminLogin();
        return;
      }
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "無法更新報到狀態。");
        return;
      }
      setPending((current) => current.filter((item) => item.id !== activeRequest.id || item.mode !== activeRequest.mode));
      setCapturedProfilePhoto(null);
      setCapturedReviewPhoto(null);
      setLockerPromptRequestId("");
      setRejectOptionsRequestId("");
      if (decision === "rejected") {
        setNotice(
          rejectionAction === "data_correction"
            ? "已拒絕並要求對方更正入場資料。"
            : "已一般拒絕；對方可直接重新送出入場申請。",
        );
      }
      window.dispatchEvent(new Event("student-checkin-admin-updated"));
      await loadPending();
    } catch (caught) {
      setError(caught instanceof Error && caught.message !== "DROP_IN_REJECTION_ACTION_REQUIRED"
        ? caught.message
        : "請選擇一般拒絕或拒絕並要求更正資料。"
      );
    } finally {
      setIsDeciding(false);
    }
  }

  const queueSummary = useMemo(() => {
    const autonomous = pending.filter((item) => item.mode === "autonomous").length;
    const dropIn = pending.length - autonomous;
    return `自主訓練 ${autonomous} 位・訪客入場 ${dropIn} 位`;
  }, [pending]);

  if (!isEnabled || !activeRequest) return null;

  if (lockerPromptRequestId === activeRequest.id) {
    return (
      <StudentCheckInLockerKeyDialog
        key={activeRequest.id}
        memberName={activeRequest.profile.full_name}
        isSubmitting={isDeciding}
        error={error}
        onCancel={() => { setError(""); setLockerPromptRequestId(""); }}
        onConfirm={(lockerKey) => void decide("approved", undefined, lockerKey)}
      />
    );
  }

  return (
    <div className="studentCheckInsApprovalBackdrop studentCheckInsGlobalApprovalBackdrop" role="presentation">
      <section
        className={isDropIn ? "studentCheckInsApprovalDialog studentDropInApprovalDialog" : "studentCheckInsApprovalDialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-student-approval-title"
      >
        {isDropIn ? (
          <div className={activePlan.reviewPhotoRequired ? "studentDropInEvidenceGrid" : "studentDropInEvidenceGrid is-single-evidence"}>
            <div className="studentDropInEvidenceCard">
              <span>本人照片</span>
              {activeRequest.profile.photo_url ? (
                <img src={activeRequest.profile.photo_url} alt={`${activeRequest.profile.full_name} 的本人照片`} />
              ) : activeProfilePreview ? (
                <div className="studentCheckInsPhotoPreview">
                  <img src={activeProfilePreview} alt="尚未確認的本人照片" />
                  <div className="studentCheckInsPhotoActions">
                    <button type="button" disabled={Boolean(uploadingKind)} onClick={() => void uploadPhoto("profile")}>{uploadingKind === "profile" ? "上傳中" : "使用這張照片"}</button>
                    <button type="button" disabled={Boolean(uploadingKind)} onClick={() => profilePhotoInputRef.current?.click()}>重新拍攝</button>
                  </div>
                </div>
              ) : (
                <button className="studentCheckInsPhotoCapture" type="button" onClick={() => profilePhotoInputRef.current?.click()}><strong>拍攝本人照片</strong><span>會與自主訓練簽到共用</span></button>
              )}
              <input ref={profilePhotoInputRef} className="studentCheckInsPhotoInput" type="file" accept="image/*" capture="environment" onChange={(event) => void selectPhoto(event, "profile")} />
            </div>
            {activePlan.reviewPhotoRequired ? <div className="studentDropInEvidenceCard">
              <span>五星好評照片</span>
              {activeRequest.profile.review_photo_url ? (
                <img src={activeRequest.profile.review_photo_url} alt={`${activeRequest.profile.full_name} 的五星好評照片`} />
              ) : activeReviewPreview ? (
                <div className="studentCheckInsPhotoPreview">
                  <img src={activeReviewPreview} alt="尚未確認的五星好評照片" />
                  <div className="studentCheckInsPhotoActions">
                    <button type="button" disabled={Boolean(uploadingKind)} onClick={() => void uploadPhoto("review")}>{uploadingKind === "review" ? "上傳中" : "使用這張照片"}</button>
                    <button type="button" disabled={Boolean(uploadingKind)} onClick={() => reviewPhotoInputRef.current?.click()}>重新選擇</button>
                  </div>
                </div>
              ) : (
                <button className="studentCheckInsPhotoCapture" type="button" onClick={() => reviewPhotoInputRef.current?.click()}><strong>上傳五星好評照片</strong><span>上傳後 10 次入場共用</span></button>
              )}
              <input ref={reviewPhotoInputRef} className="studentCheckInsPhotoInput" type="file" accept="image/*" onChange={(event) => void selectPhoto(event, "review")} />
            </div> : null}
          </div>
        ) : (
          <div className="studentCheckInsApprovalPhoto">
            {activeRequest.profile.photo_url ? (
              <img src={activeRequest.profile.photo_url} alt={`${activeRequest.profile.full_name} 的本人照片`} />
            ) : activeProfilePreview ? (
              <div className="studentCheckInsPhotoPreview">
                <img src={activeProfilePreview} alt="尚未確認的本人照片" />
                <div className="studentCheckInsPhotoActions">
                  <button type="button" disabled={Boolean(uploadingKind)} onClick={() => void uploadPhoto("profile")}>{uploadingKind === "profile" ? "上傳中" : "使用這張照片"}</button>
                  <button type="button" disabled={Boolean(uploadingKind)} onClick={() => profilePhotoInputRef.current?.click()}>重新拍攝</button>
                </div>
              </div>
            ) : (
              <button className="studentCheckInsPhotoCapture" type="button" onClick={() => profilePhotoInputRef.current?.click()}><strong>拍攝本人照片</strong><span>照片確認後將永久鎖定</span></button>
            )}
            <input ref={profilePhotoInputRef} className="studentCheckInsPhotoInput" type="file" accept="image/*" capture="environment" onChange={(event) => void selectPhoto(event, "profile")} />
          </div>
        )}

        <div className="studentCheckInsApprovalInfo">
          <p className="studentCheckInEyebrow">{isDropIn ? `NT$${activePlan.priceTwd} DROP-IN REQUEST` : "AUTONOMOUS TRAINING REQUEST"}</p>
          <span className={isDropIn ? "studentCheckInsRequestMode is-drop-in" : "studentCheckInsRequestMode"}>{isDropIn ? activePlan.label : "學生自主訓練"}</span>
          <h2 id="global-student-approval-title">{activeRequest.profile.full_name}</h2>
          {isDropIn && activeEntryPlan === "standard_100" ? (
            <div className="studentDropInPlanNotice is-standard-100" role="note">
              <strong>現場收費 NT$100</strong>
              <span>已有本人照片・未完成五星好評・免上傳五星好評照片・放行不限次數</span>
            </div>
          ) : null}
          <dl>
            <div><dt>電話</dt><dd>{activeRequest.profile.phone}</dd></div>
            <div><dt>Email</dt><dd>{activeRequest.profile.email || "-"}</dd></div>
            <div><dt>生日</dt><dd>{formatDate(activeRequest.profile.birth_date)}</dd></div>
            <div><dt>送出時間</dt><dd>{formatTaipeiDateTime(activeRequest.requested_at)}</dd></div>
            {isDropIn ? (
              <>
                <div><dt>本次費用</dt><dd>NT${activePlan.priceTwd}</dd></div>
                <div><dt>剩餘次數</dt><dd>{activePlan.unlimitedUses ? "不限次數" : `${activeRequest.profile.drop_in_remaining_uses}／${activeRequest.profile.drop_in_total_uses}`}</dd></div>
              </>
            ) : (
              <>
                <div><dt>開始日期</dt><dd>{formatDate(activeRequest.profile.membership_starts_on)}</dd></div>
                <div><dt>結束日期</dt><dd>{formatDate(activeRequest.profile.membership_expires_on)}</dd></div>
              </>
            )}
          </dl>
          {error ? <div className="studentCheckInsAdminError">{error}</div> : null}
          {notice ? <div className="studentCheckInsAdminNotice">{notice}</div> : null}
          <p className="studentCheckInsApprovalHint">
            {isDropIn && !activePlan.reviewPhotoRequired
              ? canApprove ? "請核對本人照片並收取 NT$100 後放行；不需五星好評照片。" : "請先備妥本人照片；不需五星好評照片。"
              : canApprove
                ? isDropIn ? "兩張照片皆已備妥，請核對現場本人與五星好評後再放行。" : "請核對現場本人與照片相符後再放行。"
                : isDropIn ? "必須先備妥本人照片與五星好評照片，才能放行。" : "請先拍攝並確認本人照片，才能放行。"}
          </p>
          {isDropIn && rejectOptionsRequestId === activeRequest.id ? (
            <div className="studentDropInRejectOptions" role="group" aria-label="選擇拒絕方式">
              <strong>請選擇拒絕方式</strong>
              <p>兩種拒絕都不會扣除入場次數。</p>
              <button className="studentCheckInsRejectButton" type="button" disabled={isDeciding || Boolean(uploadingKind)} onClick={() => void decide("rejected", "general")}>
                {isDeciding ? "處理中" : "一般拒絕"}
              </button>
              <button className="studentCheckInsRejectButton studentDropInCorrectionRejectButton" type="button" disabled={isDeciding || Boolean(uploadingKind)} onClick={() => void decide("rejected", "data_correction")}>
                {isDeciding ? "處理中" : "拒絕並要求更正資料"}
              </button>
              <button className="studentCheckInTextButton" type="button" disabled={isDeciding} onClick={() => setRejectOptionsRequestId("")}>取消</button>
            </div>
          ) : (
            <div className="studentCheckInsApprovalActions">
              <button
                className="studentCheckInsRejectButton"
                type="button"
                disabled={isDeciding || Boolean(uploadingKind)}
                onClick={() => {
                  if (isDropIn) setRejectOptionsRequestId(activeRequest.id);
                  else void decide("rejected");
                }}
              >拒絕</button>
              <button className="studentCheckInsApproveButton" type="button" disabled={isDeciding || Boolean(uploadingKind) || !canApprove} onClick={() => { setError(""); setLockerPromptRequestId(activeRequest.id); }}>{isDropIn ? activePlan.unlimitedUses ? "收 NT$100 後放行" : "放行並扣 1 次" : "放行"}</button>
            </div>
          )}
          <p className="studentCheckInsQueueNote">全部待確認：{queueSummary}{pending.length > 1 ? `，後面還有 ${pending.length - 1} 位` : ""}</p>
        </div>
      </section>
    </div>
  );
}
