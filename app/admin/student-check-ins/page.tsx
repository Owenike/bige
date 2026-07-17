"use client";

/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type StudentProfile = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  birth_date: string;
  photo_url: string | null;
};

type PendingRequest = {
  id: string;
  auth_method: "line" | "phone";
  requested_at: string;
  profile: StudentProfile;
};

type StudentCheckInRow = {
  id: string;
  full_name: string;
  phone: string;
  birth_date: string | null;
  photo_url: string | null;
  checked_in_at: string;
  local_date: string;
  local_month: string;
  month_sequence: number;
};

type StudentCheckInsResponse = {
  ok?: boolean;
  checkInUrl?: string;
  date?: string;
  pending?: PendingRequest[];
  today?: StudentCheckInRow[];
  recent?: StudentCheckInRow[];
  error?: string;
};

const STUDENT_CHECK_INS_ADMIN_PATH = "/admin/student-check-ins";

function redirectToStaffLogin() {
  const loginUrl = new URL("/login", window.location.origin);
  loginUrl.searchParams.set("tab", "staff");
  loginUrl.searchParams.set("returnTo", STUDENT_CHECK_INS_ADMIN_PATH);
  window.location.replace(loginUrl.toString());
}

function handleAdminAuthFailure(response: Response) {
  if (response.status !== 401) return false;
  redirectToStaffLogin();
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

async function compressPhoto(file: File) {
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("照片讀取失敗"));
      element.src = imageUrl;
    });
    const maxSide = 1200;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("照片處理失敗");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) throw new Error("照片處理失敗");
    return new File([blob], "student-photo.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export default function StudentCheckInsAdminPage() {
  const [date, setDate] = useState(todayDateInputValue());
  const [checkInUrl, setCheckInUrl] = useState("");
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [today, setToday] = useState<StudentCheckInRow[]>([]);
  const [recent, setRecent] = useState<StudentCheckInRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeciding, setIsDeciding] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<{ requestId: string; file: File; preview: string } | null>(null);
  const [error, setError] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);

  const activeRequest = pending[0] || null;
  const activePhotoPreview = capturedPhoto && activeRequest && capturedPhoto.requestId === activeRequest.id
    ? capturedPhoto.preview
    : "";
  const capturedPhotoPreview = capturedPhoto?.preview || "";
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
      const payload = (await response.json().catch(() => null)) as StudentCheckInsResponse | null;
      if (!response.ok || !payload?.ok) {
        setError(response.status === 403 ? "此帳號沒有報到管理權限。" : payload?.error || "無法載入報到資料。");
        if (!quiet) {
          setPending([]);
          setToday([]);
          setRecent([]);
        }
        return;
      }
      setCheckInUrl(payload.checkInUrl || "");
      setPending(payload.pending || []);
      setToday(payload.today || []);
      setRecent(payload.recent || []);
    } catch {
      setError("網路連線不穩定，系統會自動重新取得報到資料。");
    } finally {
      setIsLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void loadCheckIns();
    const timer = window.setInterval(() => void loadCheckIns(true), 3000);
    return () => window.clearInterval(timer);
  }, [loadCheckIns]);

  useEffect(() => {
    return () => {
      if (capturedPhotoPreview) URL.revokeObjectURL(capturedPhotoPreview);
    };
  }, [capturedPhotoPreview]);

  async function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    const requestId = activeRequest?.id;
    event.target.value = "";
    if (!selected || !requestId) return;
    setError("");
    try {
      const compressed = await compressPhoto(selected);
      setCapturedPhoto({ requestId, file: compressed, preview: URL.createObjectURL(compressed) });
    } catch {
      setError("照片無法讀取，請重新拍攝。");
    }
  }

  async function uploadPhoto() {
    if (!activeRequest || capturedPhoto?.requestId !== activeRequest.id) return;
    setIsUploadingPhoto(true);
    setError("");
    const form = new FormData();
    form.set("photo", capturedPhoto.file);
    const response = await fetch(`/api/admin/student-check-ins/${activeRequest.id}/photo`, { method: "POST", body: form });
    if (handleAdminAuthFailure(response)) return;
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; photoUrl?: string; error?: string } | null;
    if (!response.ok || !payload?.ok || !payload.photoUrl) {
      setError(payload?.error || "照片上傳失敗，請重新拍攝。");
      setIsUploadingPhoto(false);
      return;
    }
    setPending((current) => current.map((item) => (
      item.id === activeRequest.id
        ? { ...item, profile: { ...item.profile, photo_url: payload.photoUrl || null } }
        : item
    )));
    setCapturedPhoto(null);
    setIsUploadingPhoto(false);
  }

  async function decide(requestId: string, decision: "approved" | "rejected") {
    setIsDeciding(true);
    setError("");
    const response = await fetch(`/api/admin/student-check-ins/${requestId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (handleAdminAuthFailure(response)) return;
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !payload?.ok) {
      setError(payload?.error || "無法更新報到狀態。");
      setIsDeciding(false);
      return;
    }
    setPending((current) => current.filter((item) => item.id !== requestId));
    setIsDeciding(false);
    await loadCheckIns(true);
  }

  return (
    <main className="studentCheckInsAdminPage">
      <section className="studentCheckInsAdminShell">
        <header className="studentCheckInsAdminHeader">
          <div>
            <p className="studentCheckInEyebrow">BIGE CHECK-IN</p>
            <h1>自主運動報到</h1>
            <p>登入後會送到這裡等待核對，按下放行才會正式完成報到。</p>
          </div>
          <div className="studentCheckInsHeaderActions">
            <span className={pending.length > 0 ? "studentCheckInsPendingBadge is-active" : "studentCheckInsPendingBadge"}>
              待確認 {pending.length}
            </span>
            <button className="studentCheckInsAdminButton" type="button" onClick={() => void loadCheckIns()} disabled={isLoading}>
              {isLoading ? "更新中" : "重新整理"}
            </button>
          </div>
        </header>

        <section className="studentCheckInsAdminGrid">
          <article className="studentCheckInsQrCard">
            <div>
              <p className="studentCheckInEyebrow">SCAN</p>
              <h2>現場報到 QR Code</h2>
              <p>學員掃描後，可選擇 LINE 或手機密碼登入，並由現場人員核對放行。</p>
            </div>
            {qrUrl ? <img src={qrUrl} alt="BigE 自主運動報到 QR Code" /> : <div className="studentCheckInsQrEmpty">準備 QR Code</div>}
            <p className="studentCheckInsUrl">{checkInUrl || "-"}</p>
          </article>

          <article className="studentCheckInsSummaryCard">
            <p className="studentCheckInEyebrow">TODAY</p>
            <strong>{today.length}</strong>
            <span>今日已放行報到</span>
          </article>
        </section>

        <section className="studentCheckInsAdminToolbar">
          <label><span>查看日期</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        </section>

        {error ? <div className="studentCheckInsAdminError">{error}</div> : null}

        <section className="studentCheckInsTableCard">
          <h2>已完成報到</h2>
          {today.length === 0 ? (
            <p className="studentCheckInsEmpty">{isLoading ? "正在載入報到資料" : "這個日期還沒有完成報到的學員。"}</p>
          ) : (
            <div className="studentCheckInsTableWrap">
              <table className="studentCheckInsTable">
                <thead><tr><th>照片</th><th>時間</th><th>姓名</th><th>電話</th><th>生日</th><th>本月次數</th></tr></thead>
                <tbody>
                  {today.map((item) => (
                    <tr key={item.id}>
                      <td>{item.photo_url ? <a href={item.photo_url} target="_blank" rel="noreferrer"><img className="studentCheckInsTablePhoto" src={item.photo_url} alt={`${item.full_name} 的本人照片`} /></a> : "-"}</td>
                      <td>{formatTaipeiDateTime(item.checked_in_at)}</td>
                      <td>{item.full_name}</td>
                      <td>{item.phone}</td>
                      <td>{formatBirthday(item.birth_date)}</td>
                      <td>第 {item.month_sequence} 次</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="studentCheckInsTableCard">
          <h2>最近報到</h2>
          <div className="studentCheckInsRecentList">
            {recent.length === 0 ? <p className="studentCheckInsEmpty">尚無報到紀錄。</p> : null}
            {recent.map((item) => (
              <article key={item.id}>
                {item.photo_url ? <img src={item.photo_url} alt={`${item.full_name} 的本人照片`} /> : null}
                <div><strong>{item.full_name}</strong><span>{formatTaipeiDateTime(item.checked_in_at)}</span><span>{item.phone}・生日 {formatBirthday(item.birth_date)}・本月第 {item.month_sequence} 次</span></div>
              </article>
            ))}
          </div>
        </section>
      </section>

      {activeRequest ? (
        <div className="studentCheckInsApprovalBackdrop" role="presentation">
          <section className="studentCheckInsApprovalDialog" role="dialog" aria-modal="true" aria-labelledby="student-approval-title">
            <div className="studentCheckInsApprovalPhoto">
              {activeRequest.profile.photo_url ? (
                <img src={activeRequest.profile.photo_url} alt={`${activeRequest.profile.full_name} 的本人照片`} />
              ) : activePhotoPreview ? (
                <div className="studentCheckInsPhotoPreview">
                  <img src={activePhotoPreview} alt={`${activeRequest.profile.full_name} 尚未確認的本人照片`} />
                  <div className="studentCheckInsPhotoActions">
                    <button type="button" disabled={isUploadingPhoto} onClick={() => void uploadPhoto()}>
                      {isUploadingPhoto ? "上傳中" : "使用這張照片"}
                    </button>
                    <button type="button" disabled={isUploadingPhoto} onClick={() => photoInputRef.current?.click()}>重新拍攝</button>
                  </div>
                </div>
              ) : (
                <button className="studentCheckInsPhotoCapture" type="button" onClick={() => photoInputRef.current?.click()}>
                  <strong>拍攝本人照片</strong>
                  <span>照片確認後將永久鎖定</span>
                </button>
              )}
              <input ref={photoInputRef} className="studentCheckInsPhotoInput" type="file" accept="image/*" capture="user" onChange={selectPhoto} />
            </div>
            <div className="studentCheckInsApprovalInfo">
              <p className="studentCheckInEyebrow">CHECK-IN REQUEST</p>
              <h2 id="student-approval-title">{activeRequest.profile.full_name}</h2>
              <dl>
                <div><dt>電話</dt><dd>{activeRequest.profile.phone}</dd></div>
                <div><dt>Email</dt><dd>{activeRequest.profile.email || "-"}</dd></div>
                <div><dt>生日</dt><dd>{formatBirthday(activeRequest.profile.birth_date)}</dd></div>
                <div><dt>登入方式</dt><dd>{activeRequest.auth_method === "line" ? "LINE" : "手機與密碼"}</dd></div>
                <div><dt>送出時間</dt><dd>{formatTaipeiDateTime(activeRequest.requested_at)}</dd></div>
              </dl>
              <p className="studentCheckInsApprovalHint">
                {activeRequest.profile.photo_url ? "請核對現場本人與照片相符後再放行。" : "請先拍攝並確認本人照片，才能放行。"}
              </p>
              <div className="studentCheckInsApprovalActions">
                <button className="studentCheckInsRejectButton" type="button" disabled={isDeciding || isUploadingPhoto} onClick={() => void decide(activeRequest.id, "rejected")}>拒絕</button>
                <button className="studentCheckInsApproveButton" type="button" disabled={isDeciding || isUploadingPhoto || !activeRequest.profile.photo_url} onClick={() => void decide(activeRequest.id, "approved")}>{isDeciding ? "處理中" : "放行"}</button>
              </div>
              {pending.length > 1 ? <p className="studentCheckInsQueueNote">後面還有 {pending.length - 1} 位等待確認</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
