"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";

type StudentProfile = {
  id: string;
  full_name: string;
  phone: string;
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

export default function StudentCheckInsAdminPage() {
  const [date, setDate] = useState(todayDateInputValue());
  const [checkInUrl, setCheckInUrl] = useState("");
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [today, setToday] = useState<StudentCheckInRow[]>([]);
  const [recent, setRecent] = useState<StudentCheckInRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeciding, setIsDeciding] = useState(false);
  const [error, setError] = useState("");

  const activeRequest = pending[0] || null;
  const qrUrl = useMemo(() => {
    if (!checkInUrl) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=12&data=${encodeURIComponent(checkInUrl)}`;
  }, [checkInUrl]);

  const loadCheckIns = useCallback(async (quiet = false) => {
    if (!quiet) setIsLoading(true);
    setError("");
    const response = await fetch(`/api/admin/student-check-ins?date=${encodeURIComponent(date)}`, { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as StudentCheckInsResponse | null;
    if (!response.ok || !payload?.ok) {
      setError(payload?.error || "無法載入報到資料。");
      if (!quiet) {
        setPending([]);
        setToday([]);
        setRecent([]);
      }
      setIsLoading(false);
      return;
    }
    setCheckInUrl(payload.checkInUrl || "");
    setPending(payload.pending || []);
    setToday(payload.today || []);
    setRecent(payload.recent || []);
    setIsLoading(false);
  }, [date]);

  useEffect(() => {
    void loadCheckIns();
    const timer = window.setInterval(() => void loadCheckIns(true), 3000);
    return () => window.clearInterval(timer);
  }, [loadCheckIns]);

  async function decide(requestId: string, decision: "approved" | "rejected") {
    setIsDeciding(true);
    setError("");
    const response = await fetch(`/api/admin/student-check-ins/${requestId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
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
              {activeRequest.profile.photo_url ? <img src={activeRequest.profile.photo_url} alt={`${activeRequest.profile.full_name} 的本人照片`} /> : <div>沒有照片</div>}
            </div>
            <div className="studentCheckInsApprovalInfo">
              <p className="studentCheckInEyebrow">CHECK-IN REQUEST</p>
              <h2 id="student-approval-title">{activeRequest.profile.full_name}</h2>
              <dl>
                <div><dt>電話</dt><dd>{activeRequest.profile.phone}</dd></div>
                <div><dt>生日</dt><dd>{formatBirthday(activeRequest.profile.birth_date)}</dd></div>
                <div><dt>登入方式</dt><dd>{activeRequest.auth_method === "line" ? "LINE" : "手機與密碼"}</dd></div>
                <div><dt>送出時間</dt><dd>{formatTaipeiDateTime(activeRequest.requested_at)}</dd></div>
              </dl>
              <p className="studentCheckInsApprovalHint">請核對現場本人與照片相符後再放行。</p>
              <div className="studentCheckInsApprovalActions">
                <button className="studentCheckInsRejectButton" type="button" disabled={isDeciding} onClick={() => void decide(activeRequest.id, "rejected")}>拒絕</button>
                <button className="studentCheckInsApproveButton" type="button" disabled={isDeciding} onClick={() => void decide(activeRequest.id, "approved")}>{isDeciding ? "處理中" : "放行"}</button>
              </div>
              {pending.length > 1 ? <p className="studentCheckInsQueueNote">後面還有 {pending.length - 1} 位等待確認</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
