"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "../../../i18n-provider";

type DetailPayload = {
  ok?: boolean;
  error?: string | { message?: string };
  data?: {
    member?: {
      id: string;
      fullName: string;
      phone: string | null;
      notes: string | null;
      photoUrl: string | null;
      storeId: string | null;
    };
    contracts?: Array<{
      id: string;
      planName: string | null;
      planCode: string | null;
      status: string;
      startsAt: string | null;
      endsAt: string | null;
      remainingUses: number | null;
      remainingSessions: number | null;
    }>;
    recentBookings?: Array<Record<string, unknown>>;
    recentOrders?: Array<Record<string, unknown>>;
    recentPayments?: Array<Record<string, unknown>>;
    adjustments?: Array<Record<string, unknown>>;
    eligibility?: {
      entry?: { eligible?: boolean; reasonCode?: string };
      booking?: { eligible?: boolean; reasonCode?: string };
      redemption?: { eligible?: boolean; reasonCode?: string };
      suggested?: {
        planName?: string | null;
        planCode?: string | null;
        contractId?: string | null;
      } | null;
    };
  };
};

function parseError(payload: DetailPayload | null, fallback: string) {
  if (!payload) return fallback;
  if (typeof payload.error === "string") return payload.error;
  if (payload.error && typeof payload.error.message === "string") return payload.error.message;
  return fallback;
}

function fmtDate(value: unknown) {
  if (typeof value !== "string" || !value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export default function ManagerMemberDetailPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const params = useParams<{ id: string }>();
  const memberId = String(params?.id || "");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<DetailPayload["data"] | null>(null);

  useEffect(() => {
    if (!memberId) return;
    const run = async () => {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/manager/members/${encodeURIComponent(memberId)}`);
      const data = (await res.json().catch(() => null)) as DetailPayload | null;
      if (!res.ok) {
        setError(parseError(data, zh ? "載入會員詳情失敗" : "Load member detail failed"));
        setPayload(null);
        setLoading(false);
        return;
      }
      setPayload(data?.data || null);
      setLoading(false);
    };
    void run();
  }, [memberId, zh]);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "會員詳情" : "MEMBER DETAIL"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {payload?.member?.fullName || (zh ? "會員" : "Member")}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "查看方案合約、近期預約、付款與權益調整紀錄。"
                : "Inspect contracts, bookings, payments, and entitlement adjustments."}
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <Link href="/manager/members">{zh ? "返回會員列表" : "Back to members"}</Link>
        </p>

        {error ? <div className="error">{error}</div> : null}
        {loading ? <p className="fdGlassText">{zh ? "載入中..." : "Loading..."}</p> : null}

        {payload?.member ? (
          <>
            <section className="fdGlassSubPanel" style={{ padding: 14 }}>
              <h2 className="sectionTitle">{zh ? "基本資料" : "Profile"}</h2>
              <p className="sub">{payload.member.fullName}</p>
              <p className="sub">{payload.member.phone || "-"}</p>
              <p className="sub">
                {zh ? "分館" : "Branch"}: {payload.member.storeId || "-"}
              </p>
              <p className="sub">
                {zh ? "備註" : "Notes"}: {payload.member.notes || "-"}
              </p>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
              <h2 className="sectionTitle">{zh ? "可用性判斷" : "Eligibility"}</h2>
              <div className="fdDataGrid">
                <p className="sub">
                  {zh ? "入場" : "Entry"}: {payload.eligibility?.entry?.eligible ? "OK" : "DENY"} |{" "}
                  {payload.eligibility?.entry?.reasonCode || "-"}
                </p>
                <p className="sub">
                  {zh ? "預約" : "Booking"}: {payload.eligibility?.booking?.eligible ? "OK" : "DENY"} |{" "}
                  {payload.eligibility?.booking?.reasonCode || "-"}
                </p>
                <p className="sub">
                  {zh ? "核銷" : "Redemption"}: {payload.eligibility?.redemption?.eligible ? "OK" : "DENY"} |{" "}
                  {payload.eligibility?.redemption?.reasonCode || "-"}
                </p>
                <p className="sub">
                  {zh ? "優先扣除" : "Next candidate"}:{" "}
                  {payload.eligibility?.suggested?.planName ||
                    payload.eligibility?.suggested?.planCode ||
                    payload.eligibility?.suggested?.contractId ||
                    "-"}
                </p>
              </div>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
              <h2 className="sectionTitle">{zh ? "方案 / 合約" : "Contracts"}</h2>
              <div className="fdDataGrid">
                {(payload.contracts || []).map((contract) => (
                  <div key={contract.id} className="fdGlassSubPanel" style={{ padding: 10 }}>
                    <p className="sub">
                      {contract.planName || contract.planCode || "-"} | {contract.status}
                    </p>
                    <p className="sub">
                      {zh ? "期間" : "Period"}: {fmtDate(contract.startsAt)} - {fmtDate(contract.endsAt)}
                    </p>
                    <p className="sub">
                      {zh ? "剩餘次數 / 堂數" : "Remaining uses / sessions"}: {contract.remainingUses ?? "-"} /{" "}
                      {contract.remainingSessions ?? "-"}
                    </p>
                  </div>
                ))}
                {(payload.contracts || []).length === 0 ? (
                  <p className="fdGlassText">{zh ? "尚無合約。" : "No contracts."}</p>
                ) : null}
              </div>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
              <h2 className="sectionTitle">{zh ? "近期活動" : "Recent Activity"}</h2>
              <div className="fdDataGrid">
                {(payload.recentBookings || []).slice(0, 5).map((row, idx) => (
                  <p key={`b-${idx}`} className="sub">
                    {zh ? "預約" : "Booking"}: {String(row.id || "-")} | {String(row.status || "-")} |{" "}
                    {fmtDate(row.starts_at)}
                  </p>
                ))}
                {(payload.recentOrders || []).slice(0, 5).map((row, idx) => (
                  <p key={`o-${idx}`} className="sub">
                    {zh ? "訂單" : "Order"}: {String(row.id || "-")} | {String(row.status || "-")} |{" "}
                    {String(row.amount || "-")}
                  </p>
                ))}
                {(payload.recentPayments || []).slice(0, 5).map((row, idx) => (
                  <p key={`p-${idx}`} className="sub">
                    {zh ? "付款" : "Payment"}: {String(row.id || "-")} | {String(row.status || "-")} |{" "}
                    {String(row.amount || "-")}
                  </p>
                ))}
                {(payload.adjustments || []).slice(0, 10).map((row, idx) => (
                  <p key={`a-${idx}`} className="sub">
                    {zh ? "調整" : "Adjustment"}: {String(row.source_type || "-")} |{" "}
                    {String(row.reason || "-")} | {fmtDate(row.created_at)}
                  </p>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
