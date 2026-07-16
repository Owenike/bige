"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";

type StudentCheckInRow = {
  id: string;
  full_name: string;
  phone: string;
  checked_in_at: string;
  local_date: string;
  local_month: string;
  month_sequence: number;
};

type StudentCheckInsResponse = {
  ok?: boolean;
  checkInUrl?: string;
  date?: string;
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

function maskPhone(phone: string) {
  if (phone.length <= 6) return phone;
  return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}

export default function StudentCheckInsAdminPage() {
  const [date, setDate] = useState(todayDateInputValue());
  const [checkInUrl, setCheckInUrl] = useState("");
  const [today, setToday] = useState<StudentCheckInRow[]>([]);
  const [recent, setRecent] = useState<StudentCheckInRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const qrUrl = useMemo(() => {
    if (!checkInUrl) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=12&data=${encodeURIComponent(checkInUrl)}`;
  }, [checkInUrl]);

  const loadCheckIns = useCallback(async () => {
    setIsLoading(true);
    setError("");
    const response = await fetch(`/api/admin/student-check-ins?date=${encodeURIComponent(date)}`, { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as StudentCheckInsResponse | null;
    if (!response.ok || !payload?.ok) {
      setError(payload?.error || "無法讀取自主運動報到資料。");
      setToday([]);
      setRecent([]);
      setIsLoading(false);
      return;
    }
    setCheckInUrl(payload.checkInUrl || "");
    setToday(payload.today || []);
    setRecent(payload.recent || []);
    setIsLoading(false);
  }, [date]);

  useEffect(() => {
    void loadCheckIns();
    const timer = window.setInterval(() => {
      void loadCheckIns();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [loadCheckIns]);

  return (
    <main className="studentCheckInsAdminPage">
      <section className="studentCheckInsAdminShell">
        <header className="studentCheckInsAdminHeader">
          <div>
            <p className="studentCheckInEyebrow">BIGE CHECK-IN</p>
            <h1>自主運動報到看板</h1>
            <p>學生掃描 QR Code 後使用 LINE 登入，報到紀錄會顯示在這裡。</p>
          </div>
          <button className="studentCheckInsAdminButton" type="button" onClick={() => void loadCheckIns()} disabled={isLoading}>
            {isLoading ? "更新中" : "重新整理"}
          </button>
        </header>

        <section className="studentCheckInsAdminGrid">
          <article className="studentCheckInsQrCard">
            <div>
              <p className="studentCheckInEyebrow">SCAN</p>
              <h2>學生報到 QR Code</h2>
              <p>把這張 QR Code 放在櫃檯或入口，學生掃描後即可用 LINE 報到。</p>
            </div>
            {qrUrl ? <img src={qrUrl} alt="BigE 自主運動報到 QR Code" /> : <div className="studentCheckInsQrEmpty">產生 QR Code 中</div>}
            <p className="studentCheckInsUrl">{checkInUrl || "-"}</p>
          </article>

          <article className="studentCheckInsSummaryCard">
            <p className="studentCheckInEyebrow">TODAY</p>
            <strong>{today.length}</strong>
            <span>今日報到人次</span>
          </article>
        </section>

        <section className="studentCheckInsAdminToolbar">
          <label>
            <span>查詢日期</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
        </section>

        {error ? <div className="studentCheckInsAdminError">{error}</div> : null}

        <section className="studentCheckInsTableCard">
          <h2>當日報到</h2>
          {today.length === 0 ? (
            <p className="studentCheckInsEmpty">{isLoading ? "正在讀取報到紀錄。" : "目前尚無報到紀錄。"}</p>
          ) : (
            <div className="studentCheckInsTableWrap">
              <table className="studentCheckInsTable">
                <thead>
                  <tr>
                    <th>時間</th>
                    <th>姓名</th>
                    <th>電話</th>
                    <th>本月次數</th>
                  </tr>
                </thead>
                <tbody>
                  {today.map((item) => (
                    <tr key={item.id}>
                      <td>{formatTaipeiDateTime(item.checked_in_at)}</td>
                      <td>{item.full_name}</td>
                      <td>{maskPhone(item.phone)}</td>
                      <td>第 {item.month_sequence} 次</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="studentCheckInsTableCard">
          <h2>近期報到</h2>
          <div className="studentCheckInsRecentList">
            {recent.map((item) => (
              <article key={item.id}>
                <strong>{item.full_name}</strong>
                <span>{formatTaipeiDateTime(item.checked_in_at)}</span>
                <span>{maskPhone(item.phone)}｜本月第 {item.month_sequence} 次</span>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
