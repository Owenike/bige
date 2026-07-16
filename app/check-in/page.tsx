"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type StudentProfile = {
  full_name: string;
  phone: string;
};

type CheckinSuccess = {
  profile: StudentProfile;
  checkIn: {
    checked_in_at: string;
    month_sequence: number;
  };
  encouragement: string;
};

type SessionResponse = {
  ok?: boolean;
  authenticated?: boolean;
  lineDisplayName?: string | null;
  profile?: StudentProfile | null;
};

type CheckinResponse = CheckinSuccess & {
  ok?: boolean;
  needsProfile?: boolean;
  lineDisplayName?: string | null;
  error?: string;
};

function formatTaipeiTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function StudentCheckInPage() {
  const [status, setStatus] = useState<"loading" | "login" | "binding" | "checking" | "success" | "error">("loading");
  const [lineDisplayName, setLineDisplayName] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [success, setSuccess] = useState<CheckinSuccess | null>(null);
  const [error, setError] = useState("");
  const didCheckIn = useRef(false);

  async function runCheckIn() {
    if (didCheckIn.current) return;
    didCheckIn.current = true;
    setStatus("checking");
    const response = await fetch("/api/student-checkin/check-in", { method: "POST" });
    const payload = (await response.json().catch(() => null)) as CheckinResponse | null;
    if (!response.ok || !payload?.ok) {
      setError(payload?.error || "報到失敗，請重新掃描 QR Code。");
      setStatus(response.status === 401 ? "login" : "error");
      return;
    }
    if (payload.needsProfile) {
      setLineDisplayName(payload.lineDisplayName || null);
      setStatus("binding");
      return;
    }
    setSuccess(payload);
    setStatus("success");
  }

  useEffect(() => {
    let alive = true;
    async function loadSession() {
      const urlError = new URLSearchParams(window.location.search).get("error");
      if (urlError) {
        setError(urlError === "line_env" ? "LINE Login 尚未完成設定，請洽 BigE 工作人員。" : "LINE 登入沒有完成，請再試一次。");
        setStatus(urlError === "line_env" ? "error" : "login");
        return;
      }
      const response = await fetch("/api/student-checkin/session", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as SessionResponse | null;
      if (!alive) return;
      if (!payload?.authenticated) {
        setStatus("login");
        return;
      }
      setLineDisplayName(payload.lineDisplayName || null);
      if (!payload.profile) {
        setStatus("binding");
        return;
      }
      void runCheckIn();
    }
    void loadSession();
    return () => {
      alive = false;
    };
  }, []);

  async function submitBinding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("checking");
    const response = await fetch("/api/student-checkin/bind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, phone }),
    });
    const payload = (await response.json().catch(() => null)) as CheckinResponse | null;
    if (!response.ok || !payload?.ok) {
      setError(payload?.error || "綁定失敗，請確認資料後再試一次。");
      setStatus("binding");
      return;
    }
    setSuccess(payload);
    setStatus("success");
  }

  return (
    <main className="studentCheckInPage">
      <section className="studentCheckInCard">
        <p className="studentCheckInEyebrow">BIGE CHECK-IN</p>

        {status === "loading" ? (
          <>
            <h1>準備報到中</h1>
            <p className="studentCheckInLead">正在確認你的 LINE 身分，稍等一下。</p>
          </>
        ) : null}

        {status === "login" ? (
          <>
            <h1>自主運動報到</h1>
            <p className="studentCheckInLead">先用 LINE 登入確認是本人，第一次會再請你填姓名與電話完成綁定。</p>
            {error ? <p className="studentCheckInError">{error}</p> : null}
            <a className="studentCheckInPrimary" href="/api/student-checkin/line/start">
              使用 LINE 登入報到
            </a>
          </>
        ) : null}

        {status === "binding" ? (
          <>
            <h1>第一次報到綁定</h1>
            <p className="studentCheckInLead">
              {lineDisplayName ? `${lineDisplayName}，` : ""}請填寫真實姓名與電話。之後掃 QR Code 用 LINE 登入就能直接完成報到。
            </p>
            <form className="studentCheckInForm" onSubmit={submitBinding}>
              <label>
                <span>真實姓名</span>
                <input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required />
              </label>
              <label>
                <span>電話</span>
                <input value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" required />
              </label>
              {error ? <p className="studentCheckInError">{error}</p> : null}
              <button className="studentCheckInPrimary" type="submit">
                完成綁定並報到
              </button>
            </form>
          </>
        ) : null}

        {status === "checking" ? (
          <>
            <h1>報到中</h1>
            <p className="studentCheckInLead">正在替你記錄今天的自主運動。</p>
          </>
        ) : null}

        {status === "success" && success ? (
          <>
            <h1>{success.profile.full_name}，報到完成</h1>
            <p className="studentCheckInTime">今天 {formatTaipeiTime(success.checkIn.checked_in_at)}</p>
            <p className="studentCheckInPraise">{success.encouragement}</p>
            <p className="studentCheckInCount">本月第 {success.checkIn.month_sequence} 次自主運動</p>
            <Link className="studentCheckInPrimary" href="/">
              開始運動！GO
            </Link>
          </>
        ) : null}

        {status === "error" ? (
          <>
            <h1>報到沒有完成</h1>
            <p className="studentCheckInError">{error}</p>
            <a className="studentCheckInPrimary" href="/api/student-checkin/line/start">
              重新用 LINE 登入
            </a>
          </>
        ) : null}
      </section>
    </main>
  );
}
