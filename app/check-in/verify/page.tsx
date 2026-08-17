"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  isStudentCheckInEntryMode,
  studentCheckInEntryLabel,
  studentCheckInPath,
  type StudentCheckInEntryMode,
} from "../../../lib/student-checkin-entry";

type VerifyState = "verifying" | "success" | "error";

export default function StudentCheckInEmailVerifyPage() {
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<VerifyState>("verifying");
  const [message, setMessage] = useState("正在驗證 Email 並建立會員資料。");
  const [returnMode, setReturnMode] = useState<StudentCheckInEntryMode>("autonomous");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const search = new URLSearchParams(window.location.search);
    const token = search.get("token")?.trim() || "";
    const requestedEntry = search.get("entry");
    const fallbackMode = isStudentCheckInEntryMode(requestedEntry) ? requestedEntry : "autonomous";
    setReturnMode(fallbackMode);
    if (!token) {
      setState("error");
      setMessage("驗證連結缺少必要資料，請回到報到頁重新寄送驗證信。");
      return;
    }

    let redirectTimer: number | null = null;
    void fetch("/api/student-checkin/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as { ok?: boolean; entryMode?: unknown; error?: string } | null;
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Email 驗證失敗。");
        const entryMode = isStudentCheckInEntryMode(payload.entryMode) ? payload.entryMode : fallbackMode;
        setReturnMode(entryMode);
        window.history.replaceState({}, "", "/check-in/verify");
        setState("success");
        setMessage(`Email 已驗證。正在開啟${studentCheckInEntryLabel(entryMode)}入口…`);
        redirectTimer = window.setTimeout(() => router.replace(studentCheckInPath(entryMode)), 900);
      })
      .catch((error) => {
        setState("error");
        setMessage(error instanceof Error ? error.message : "Email 驗證失敗，請稍後再試。");
      });

    return () => {
      if (redirectTimer !== null) window.clearTimeout(redirectTimer);
    };
  }, [router]);

  return (
    <main className="studentCheckInPage">
      <section className="studentCheckInCard">
        <p className="studentCheckInEyebrow">BIGE EMAIL VERIFICATION</p>
        <div className="studentCheckInCentered">
          {state === "verifying" ? <div className="studentCheckInSpinner" aria-hidden="true" /> : null}
          {state === "success" ? <div className="studentCheckInApprovedMark" aria-hidden="true">✓</div> : null}
          {state === "error" ? <div className="studentCheckInExpiredMark" aria-hidden="true">!</div> : null}
          <h1>{state === "success" ? "驗證完成" : state === "error" ? "無法完成驗證" : "正在驗證 Email"}</h1>
          <p className={state === "error" ? "studentCheckInError" : "studentCheckInLead"}>{message}</p>
          {state === "error" ? <Link className="studentCheckInPrimary" href={studentCheckInPath(returnMode)}>返回會員報到</Link> : null}
        </div>
      </section>
    </main>
  );
}
