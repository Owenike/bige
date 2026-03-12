"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchApiJson } from "../../../lib/notification-productization-ui";

type JobType = "notification_sweep" | "opportunity_sweep" | "delivery_dispatch" | "reminder_bundle";
type JobTriggerMode = "scheduled" | "manual" | "api" | "inline";
type JobStatus = "running" | "success" | "failed" | "partial";

type JobRunItem = {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  branchId: string | null;
  branchName: string | null;
  jobType: JobType;
  triggerMode: JobTriggerMode;
  status: JobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  affectedCount: number;
  errorCount: number;
  errorSummary: string | null;
  initiatedBy: string | null;
  createdAt: string;
};

type JobRunsResponse = {
  items: JobRunItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const JOB_TYPE_OPTIONS: Array<JobType | "all"> = ["all", "notification_sweep", "opportunity_sweep", "delivery_dispatch", "reminder_bundle"];
const TRIGGER_MODE_OPTIONS: Array<JobTriggerMode | "all"> = ["all", "scheduled", "manual", "api", "inline"];
const STATUS_OPTIONS: Array<JobStatus | "all"> = ["all", "running", "success", "failed", "partial"];
const PAGE_SIZE_OPTIONS = [20, 30, 50, 100];

function toLocalDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function toDurationLabel(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  if (value < 1000) return `${value}ms`;
  const sec = Math.round((value / 1000) * 10) / 10;
  return `${sec}s`;
}

function toDateTimeLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromDateTimeLocalInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export default function PlatformJobsPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<JobRunItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [tenantId, setTenantId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [jobType, setJobType] = useState<JobType | "all">("all");
  const [triggerMode, setTriggerMode] = useState<JobTriggerMode | "all">("all");
  const [status, setStatus] = useState<JobStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [pageSize, setPageSize] = useState(30);

  async function load(nextPage?: number) {
    const targetPage = Math.max(1, nextPage || page);
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("page", String(targetPage));
    params.set("pageSize", String(pageSize));
    if (tenantId.trim()) params.set("tenantId", tenantId.trim());
    if (branchId.trim()) params.set("branchId", branchId.trim());
    if (jobType !== "all") params.set("jobType", jobType);
    if (triggerMode !== "all") params.set("triggerMode", triggerMode);
    if (status !== "all") params.set("status", status);
    if (search.trim()) params.set("search", search.trim());
    const fromIso = fromDateTimeLocalInput(fromInput);
    const toIso = fromDateTimeLocalInput(toInput);
    if (fromIso) params.set("from", fromIso);
    if (toIso) params.set("to", toIso);

    const result = await fetchApiJson<JobRunsResponse>(`/api/platform/jobs/runs?${params.toString()}`, {
      cache: "no-store",
    });
    if (!result.ok) {
      setError(result.message);
      setLoading(false);
      return;
    }

    setRows(result.data.items || []);
    setTotal(result.data.total || 0);
    setPage(result.data.page || targetPage);
    setTotalPages(result.data.totalPages || 1);
    setLoading(false);

    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
  }

  function applyFilters() {
    void load(1);
  }

  function resetFilters() {
    setTenantId("");
    setBranchId("");
    setJobType("all");
    setTriggerMode("all");
    setStatus("all");
    setSearch("");
    setFromInput("");
    setToInput("");
    setPageSize(30);
    setPage(1);
    setTotalPages(1);
    void load(1);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextTenantId = params.get("tenantId") || "";
    const nextBranchId = params.get("branchId") || "";
    const nextJobType = params.get("jobType") || "all";
    const nextTrigger = params.get("triggerMode") || "all";
    const nextStatus = params.get("status") || "all";
    const nextSearch = params.get("search") || "";
    const nextFrom = toDateTimeLocalInput(params.get("from"));
    const nextTo = toDateTimeLocalInput(params.get("to"));
    const nextPage = Number(params.get("page") || 1);
    const nextSize = Number(params.get("pageSize") || 30);

    setTenantId(nextTenantId);
    setBranchId(nextBranchId);
    setJobType(JOB_TYPE_OPTIONS.includes(nextJobType as JobType | "all") ? (nextJobType as JobType | "all") : "all");
    setTriggerMode(TRIGGER_MODE_OPTIONS.includes(nextTrigger as JobTriggerMode | "all") ? (nextTrigger as JobTriggerMode | "all") : "all");
    setStatus(STATUS_OPTIONS.includes(nextStatus as JobStatus | "all") ? (nextStatus as JobStatus | "all") : "all");
    setSearch(nextSearch);
    setFromInput(nextFrom);
    setToInput(nextTo);
    setPage(Number.isFinite(nextPage) && nextPage > 0 ? Math.floor(nextPage) : 1);
    setPageSize(PAGE_SIZE_OPTIONS.includes(nextSize) ? nextSize : 30);

    void load(Number.isFinite(nextPage) && nextPage > 0 ? Math.floor(nextPage) : 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">PLATFORM JOBS</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
              Scheduled Jobs Monitor
            </h1>
            <p className="fdGlassText">
              Read-only monitoring for `notification_job_runs` with tenant and branch dimensions.
            </p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href="/platform-admin">
                Back
              </Link>
              <Link className="fdPillBtn" href="/platform-admin/jobs/settings">
                Settings
              </Link>
              <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void load(page)} disabled={loading}>
                {loading ? "Loading..." : "Refresh"}
              </button>
            </div>
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">Filters</h2>
          <div className="fdThreeCol" style={{ gap: 10, marginTop: 8 }}>
            <input className="input" value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder="tenantId" />
            <input className="input" value={branchId} onChange={(event) => setBranchId(event.target.value)} placeholder="branchId" />
            <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="search status/type/error/id" />
          </div>
          <div className="fdThreeCol" style={{ gap: 10, marginTop: 8 }}>
            <select className="input" value={jobType} onChange={(event) => setJobType(event.target.value as JobType | "all")}>
              {JOB_TYPE_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  job_type: {item}
                </option>
              ))}
            </select>
            <select className="input" value={triggerMode} onChange={(event) => setTriggerMode(event.target.value as JobTriggerMode | "all")}>
              {TRIGGER_MODE_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  trigger_mode: {item}
                </option>
              ))}
            </select>
            <select className="input" value={status} onChange={(event) => setStatus(event.target.value as JobStatus | "all")}>
              {STATUS_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  status: {item}
                </option>
              ))}
            </select>
          </div>
          <div className="fdThreeCol" style={{ gap: 10, marginTop: 8 }}>
            <label className="sub">
              from
              <input className="input" type="datetime-local" value={fromInput} onChange={(event) => setFromInput(event.target.value)} />
            </label>
            <label className="sub">
              to
              <input className="input" type="datetime-local" value={toInput} onChange={(event) => setToInput(event.target.value)} />
            </label>
            <select className="input" value={String(pageSize)} onChange={(event) => setPageSize(Number(event.target.value) || 30)}>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  pageSize: {size}
                </option>
              ))}
            </select>
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={applyFilters} disabled={loading}>
              Apply
            </button>
            <button type="button" className="fdPillBtn" onClick={resetFilters} disabled={loading}>
              Reset
            </button>
          </div>
        </section>

        {error ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <div className="error">{error}</div>
          </section>
        ) : null}

        <section className="fdInventorySummary" style={{ marginBottom: 14 }}>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">Total Runs</div>
            <strong className="fdInventorySummaryValue">{total}</strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">Page</div>
            <strong className="fdInventorySummaryValue">
              {page}/{totalPages}
            </strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">Sample Size</div>
            <strong className="fdInventorySummaryValue">{rows.length}</strong>
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14 }}>
          <h2 className="sectionTitle">Job Runs</h2>
          {loading ? <p className="fdGlassText">Loading...</p> : null}
          {!loading && rows.length === 0 ? <p className="fdGlassText">No runs found in current scope.</p> : null}
          {rows.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>created_at</th>
                    <th>job_type</th>
                    <th>trigger_mode</th>
                    <th>status</th>
                    <th>tenant</th>
                    <th>branch</th>
                    <th>affected</th>
                    <th>errors</th>
                    <th>duration</th>
                    <th>error_summary</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => (
                    <tr key={item.id}>
                      <td>{toLocalDateTime(item.createdAt)}</td>
                      <td>{item.jobType}</td>
                      <td>{item.triggerMode}</td>
                      <td>{item.status}</td>
                      <td>{item.tenantName || item.tenantId || "-"}</td>
                      <td>{item.branchName || item.branchId || "-"}</td>
                      <td>{item.affectedCount}</td>
                      <td>{item.errorCount}</td>
                      <td>{toDurationLabel(item.durationMs)}</td>
                      <td>{item.errorSummary || "-"}</td>
                      <td>
                        <Link className="fdPillBtn" href={`/platform-admin/jobs/${item.id}`}>
                          Detail
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="actions" style={{ marginTop: 10 }}>
            <button type="button" className="fdPillBtn" disabled={loading || page <= 1} onClick={() => void load(page - 1)}>
              Prev
            </button>
            <button type="button" className="fdPillBtn" disabled={loading || page >= totalPages} onClick={() => void load(page + 1)}>
              Next
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}
