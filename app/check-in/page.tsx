"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";

type CheckinRequest = {
  id: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
};

type CheckinPayload = {
  ok?: boolean;
  authenticated?: boolean;
  needsProfile?: boolean;
  authMethod?: "line" | "phone";
  lineDisplayName?: string | null;
  profile?: { id: string; fullName: string } | null;
  request?: CheckinRequest | null;
  checkIn?: { checked_in_at: string; month_sequence: number } | null;
  encouragement?: string | null;
  error?: string;
};

type View = "loading" | "login" | "register" | "pending" | "success" | "rejected" | "error";

function formatTaipeiTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) throw new Error("照片處理失敗");
    return new File([blob], "check-in-photo.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export default function StudentCheckInPage() {
  const [view, setView] = useState<View>("loading");
  const [authMethod, setAuthMethod] = useState<"line" | "phone">("phone");
  const [lineDisplayName, setLineDisplayName] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [password, setPassword] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoConfirmed, setPhotoConfirmed] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [success, setSuccess] = useState<CheckinPayload | null>(null);
  const [error, setError] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);

  const applyRequest = useCallback((payload: CheckinPayload) => {
    if (payload.profile?.fullName) setFullName(payload.profile.fullName);
    if (!payload.request) return false;
    setRequestId(payload.request.id);
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

  const createRequest = useCallback(async () => {
    const response = await fetch("/api/student-checkin/request", { method: "POST" });
    const payload = (await response.json().catch(() => null)) as CheckinPayload | null;
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || "無法送出報到申請。");
    applyRequest(payload);
  }, [applyRequest]);

  useEffect(() => {
    let active = true;
    async function load() {
      const urlError = new URLSearchParams(window.location.search).get("error");
      if (urlError) {
        setError("LINE 登入未完成，請再試一次或改用手機登入。");
        setView("login");
        return;
      }
      const response = await fetch("/api/student-checkin/session", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as CheckinPayload | null;
      if (!active) return;
      if (!payload?.authenticated) {
        setView("login");
        return;
      }
      if (payload.needsProfile) {
        setAuthMethod("line");
        setLineDisplayName(payload.lineDisplayName || null);
        setView("register");
        return;
      }
      setAuthMethod(payload.authMethod || "phone");
      if (applyRequest(payload)) {
        if (payload.request?.status === "approved") {
          const statusResponse = await fetch("/api/student-checkin/request", { cache: "no-store" });
          const statusPayload = (await statusResponse.json().catch(() => null)) as CheckinPayload | null;
          if (statusPayload?.ok) applyRequest(statusPayload);
        }
        return;
      }
      await createRequest();
    }
    void load().catch((caught) => {
      if (!active) return;
      setError(caught instanceof Error ? caught.message : "報到頁面暫時無法使用。");
      setView("error");
    });
    return () => {
      active = false;
    };
  }, [applyRequest, createRequest]);

  useEffect(() => {
    if (view !== "pending" || !requestId) return;
    const timer = window.setInterval(async () => {
      const response = await fetch("/api/student-checkin/request", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as CheckinPayload | null;
      if (response.ok && payload?.ok) applyRequest(payload);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [applyRequest, requestId, view]);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

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
      setAuthMethod("phone");
      setView("register");
      return;
    }
    if (!response.ok || !payload?.ok) {
      setError(payload?.error || "手機號碼或密碼不正確。");
      setView("login");
      return;
    }
    applyRequest(payload);
  }

  async function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setError("");
    try {
      const compressed = await compressPhoto(selected);
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhoto(compressed);
      setPhotoPreview(URL.createObjectURL(compressed));
      setPhotoConfirmed(false);
    } catch {
      setError("照片無法讀取，請重新拍攝。");
    }
  }

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!photo || !photoConfirmed) {
      setError("請先拍照並按下「使用這張照片」。");
      return;
    }
    setError("");
    setView("loading");
    const form = new FormData();
    form.set("fullName", fullName);
    form.set("phone", phone);
    form.set("birthDate", birthDate);
    form.set("password", password);
    form.set("photo", photo);
    const response = await fetch("/api/student-checkin/register", { method: "POST", body: form });
    const payload = (await response.json().catch(() => null)) as CheckinPayload | null;
    if (!response.ok || !payload?.ok) {
      setError(payload?.error || "學員資料建立失敗。");
      setView("register");
      return;
    }
    applyRequest(payload);
  }

  async function returnToLogin() {
    await fetch("/api/student-checkin/logout", { method: "POST" });
    setRequestId("");
    setSuccess(null);
    setError("");
    setView("login");
  }

  return (
    <main className="studentCheckInPage">
      <section className="studentCheckInCard">
        <p className="studentCheckInEyebrow">BIGE CHECK-IN</p>

        {view === "loading" ? (
          <div className="studentCheckInCentered">
            <div className="studentCheckInSpinner" aria-hidden="true" />
            <h1>正在準備報到</h1>
          </div>
        ) : null}

        {view === "login" ? (
          <>
            <h1>自主運動報到</h1>
            <p className="studentCheckInLead">選擇 LINE，或使用手機號碼與密碼登入。</p>
            {error ? <p className="studentCheckInError">{error}</p> : null}
            <a className="studentCheckInLineButton" href="/api/student-checkin/line/start">使用 LINE 登入</a>
            <div className="studentCheckInDivider"><span>或</span></div>
            <form className="studentCheckInForm" onSubmit={submitPhoneLogin}>
              <label>
                <span>手機號碼</span>
                <input value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" required />
              </label>
              <label>
                <span>密碼</span>
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={6} required />
              </label>
              <button className="studentCheckInPrimary" type="submit">登入並報到</button>
              <button className="studentCheckInTextButton" type="button" onClick={() => { setAuthMethod("phone"); setError(""); setView("register"); }}>
                第一次使用，建立學員資料
              </button>
            </form>
          </>
        ) : null}

        {view === "register" ? (
          <>
            <h1>第一次報到</h1>
            <p className="studentCheckInLead">
              {authMethod === "line" && lineDisplayName ? `${lineDisplayName}，` : ""}請建立本人資料。之後可直接用 {authMethod === "line" ? "LINE 或手機密碼" : "手機與密碼"} 報到。
            </p>
            <form className="studentCheckInForm" onSubmit={submitRegistration}>
              <div className="studentCheckInFormGrid">
                <label><span>真實姓名</span><input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required /></label>
                <label><span>手機號碼</span><input value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" required /></label>
                <label><span>生日</span><input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} required /></label>
                <label><span>密碼（至少 6 碼）</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={6} required /></label>
              </div>
              <div className="studentCheckInPhotoField">
                <span>本人照片</span>
                {!photoPreview ? (
                  <button className="studentCheckInCameraButton" type="button" onClick={() => photoInputRef.current?.click()}>開啟相機拍照</button>
                ) : (
                  <div className="studentCheckInPhotoPreview">
                    <img src={photoPreview} alt="即將使用的本人照片" />
                    {photoConfirmed ? (
                      <p>照片已確認</p>
                    ) : (
                      <div className="studentCheckInPhotoActions">
                        <button type="button" onClick={() => setPhotoConfirmed(true)}>使用這張照片</button>
                        <button type="button" onClick={() => photoInputRef.current?.click()}>重新拍攝</button>
                      </div>
                    )}
                  </div>
                )}
                <input ref={photoInputRef} className="studentCheckInFileInput" type="file" accept="image/*" capture="user" onChange={selectPhoto} />
              </div>
              {error ? <p className="studentCheckInError">{error}</p> : null}
              <button className="studentCheckInPrimary" type="submit">建立資料並送出報到</button>
              <button className="studentCheckInTextButton" type="button" onClick={() => void returnToLogin()}>返回登入</button>
            </form>
          </>
        ) : null}

        {view === "pending" ? (
          <div className="studentCheckInCentered">
            <div className="studentCheckInPendingMark" aria-hidden="true">✓</div>
            <h1>已通知櫃檯</h1>
            <p className="studentCheckInPraise">{fullName ? `${fullName}，` : ""}請稍候現場人員確認本人資料。</p>
            <p className="studentCheckInLead">此頁會自動更新，通過後就能開始運動。</p>
          </div>
        ) : null}

        {view === "success" && success?.checkIn ? (
          <div className="studentCheckInCentered">
            <div className="studentCheckInApprovedMark" aria-hidden="true">✓</div>
            <h1>報到完成</h1>
            <p className="studentCheckInTime">放行時間 {formatTaipeiTime(success.checkIn.checked_in_at)}</p>
            <p className="studentCheckInPraise">{success.encouragement}</p>
            <p className="studentCheckInCount">本月第 {success.checkIn.month_sequence} 次自主運動</p>
            <Link className="studentCheckInPrimary" href="/">開始運動！GO</Link>
          </div>
        ) : null}

        {view === "rejected" ? (
          <div className="studentCheckInCentered">
            <h1>請洽現場人員</h1>
            <p className="studentCheckInLead">這次報到尚未通過，請由櫃檯協助確認資料。</p>
            <button className="studentCheckInPrimary" type="button" onClick={() => void returnToLogin()}>重新登入</button>
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
    </main>
  );
}
