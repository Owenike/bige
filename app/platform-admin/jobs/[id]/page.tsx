"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fetchApiJson } from "../../../../lib/notification-productization-ui";

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
  payload: Record<string, unknown>;
  initiatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type JobRunDetailResponse = {
  item: JobRunItem;
  related: JobRunItem[];
};

type RerunDryRunResponse = {
  mode: "dry_run";
  executeEnabled: boolean;
  target: {
    type: "job_run";
    jobRunId: string;
    tenantId: string | null;
    branchId: string | null;
    jobType: JobType;
    triggerMode: JobTriggerMode;
    status: JobStatus;
    createdAt: string;
    errorCount: number;
  };
  failedOnly: true;
  planned: Array<{
    plannedUnit: "job_run";
    sourceJobRunId: string;
    tenantId: string;
    jobType: JobType;
    windowStartAt: string;
    windowEndAt: string;
    scopeKey: string;
    estimatedAffectedCount: number;
    estimatedErrorCount: number;
  }>;
  skipped: Array<{
    sourceJobRunId: string;
    reasonCode: string;
    reason: string;
  }>;
  lockConflicts: Array<{
    scopeKey: string;
    acquiredAt: string;
    expiresAt: string;
    acquiredBy: string | null;
  }>;
  dedupeSignals: Array<{
    code: string;
    message: string;
  }>;
  riskHints: string[];
  warnings: string[];
  guidance: Array<{
    jobType: JobType;
    recommendedUnit: "job_run" | "job_type" | "tenant" | "item_level";
    reason: string;
  }>;
};

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

export default function PlatformJobRunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = useMemo(() => String(params?.id || "").trim(), [params]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobRunDetailResponse | null>(null);
  const [rerunLoading, setRerunLoading] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [rerunPlan, setRerunPlan] = useState<RerunDryRunResponse | null>(null);

  async function runDryRun() {
    if (!detail?.item?.id) return;
    setRerunLoading(true);
    setRerunError(null);
    const result = await fetchApiJson<RerunDryRunResponse>("/api/platform/jobs/rerun", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "dry_run",
        failedOnly: true,
        target: {
          type: "job_run",
          id: detail.item.id,
        },
      }),
    });
    if (!result.ok) {
      setRerunError(result.message);
      setRerunLoading(false);
      return;
    }
    setRerunPlan(result.data);
    setRerunLoading(false);
  }

  useEffect(() => {
    if (!runId) return;
    let active = true;
    setLoading(true);
    setError(null);
    void fetchApiJson<JobRunDetailResponse>(`/api/platform/jobs/runs/${encodeURIComponent(runId)}`, {
      cache: "no-store",
    }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setError(result.message);
        setLoading(false);
        return;
      }
      setDetail(result.data);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [runId]);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">PLATFORM JOBS</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
              Job Run Detail
            </h1>
            <p className="fdGlassText">Read-only detail with sanitized payload for safe observability.</p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href="/platform-admin/jobs">
                Back to Jobs
              </Link>
            </div>
          </div>
        </section>

        {error ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <div className="error">{error}</div>
          </section>
        ) : null}

        {loading && !detail ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <p className="fdGlassText">Loading...</p>
          </section>
        ) : null}

        {detail?.item ? (
          <>
            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
              <h2 className="sectionTitle">Run Metadata</h2>
              <div className="fdDataGrid" style={{ marginTop: 8 }}>
                <p className="sub" style={{ marginTop: 0 }}>
                  id: {detail.item.id}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  job_type: {detail.item.jobType}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  trigger_mode: {detail.item.triggerMode}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  status: {detail.item.status}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  tenant: {detail.item.tenantName || detail.item.tenantId || "-"}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  branch: {detail.item.branchName || detail.item.branchId || "-"}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  created_at: {toLocalDateTime(detail.item.createdAt)}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  started_at: {toLocalDateTime(detail.item.startedAt)}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  finished_at: {toLocalDateTime(detail.item.finishedAt)}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  duration: {toDurationLabel(detail.item.durationMs)}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  affected_count: {detail.item.affectedCount}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  error_count: {detail.item.errorCount}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  error_summary: {detail.item.errorSummary || "-"}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  initiated_by: {detail.item.initiatedBy || "-"}
                </p>
              </div>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
              <h2 className="sectionTitle">Payload (Sanitized)</h2>
              <pre
                style={{
                  marginTop: 8,
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  background: "rgba(255, 255, 255, 0.55)",
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                {JSON.stringify(detail.item.payload || {}, null, 2)}
              </pre>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
              <h2 className="sectionTitle">Rerun Dry-run Preview (Phase 2-1)</h2>
              <p className="fdGlassText" style={{ marginTop: 8 }}>
                Dry-run first, failed-only, platform_admin scope. Execute remains API-gated with confirmation + lock.
              </p>
              <div className="actions" style={{ marginTop: 8 }}>
                <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void runDryRun()} disabled={rerunLoading}>
                  {rerunLoading ? "Previewing..." : "Run Dry-run Preview"}
                </button>
              </div>
              {rerunError ? <div className="error" style={{ marginTop: 8 }}>{rerunError}</div> : null}
              {rerunPlan ? (
                <div className="fdDataGrid" style={{ marginTop: 10 }}>
                  <p className="sub" style={{ marginTop: 0 }}>
                    planned: {rerunPlan.planned.length} | skipped: {rerunPlan.skipped.length} | lock conflicts: {rerunPlan.lockConflicts.length}
                  </p>
                  <p className="sub" style={{ marginTop: 0 }}>
                    dedupe signals: {rerunPlan.dedupeSignals.length} | warnings: {rerunPlan.warnings.length}
                  </p>
                  {rerunPlan.planned.map((item) => (
                    <p key={item.scopeKey} className="sub" style={{ marginTop: 0 }}>
                      planned {item.jobType} | tenant {item.tenantId} | window {toLocalDateTime(item.windowStartAt)} ~ {toLocalDateTime(item.windowEndAt)}
                    </p>
                  ))}
                  {rerunPlan.skipped.map((item) => (
                    <p key={`${item.sourceJobRunId}:${item.reasonCode}`} className="sub" style={{ marginTop: 0 }}>
                      skipped {item.reasonCode}: {item.reason}
                    </p>
                  ))}
                  {rerunPlan.lockConflicts.map((item) => (
                    <p key={item.scopeKey} className="sub" style={{ marginTop: 0 }}>
                      lock conflict {item.scopeKey} | acquired {toLocalDateTime(item.acquiredAt)} | expires {toLocalDateTime(item.expiresAt)}
                    </p>
                  ))}
                  {rerunPlan.dedupeSignals.map((item) => (
                    <p key={item.code + item.message} className="sub" style={{ marginTop: 0 }}>
                      dedupe {item.code}: {item.message}
                    </p>
                  ))}
                  {rerunPlan.riskHints.map((item) => (
                    <p key={item} className="sub" style={{ marginTop: 0 }}>
                      risk: {item}
                    </p>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14 }}>
              <h2 className="sectionTitle">Recent Runs In Same Tenant Scope</h2>
              {detail.related.length === 0 ? <p className="fdGlassText">No related runs found.</p> : null}
              {detail.related.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>created_at</th>
                        <th>job_type</th>
                        <th>trigger_mode</th>
                        <th>status</th>
                        <th>errors</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {detail.related.map((item) => (
                        <tr key={item.id}>
                          <td>{toLocalDateTime(item.createdAt)}</td>
                          <td>{item.jobType}</td>
                          <td>{item.triggerMode}</td>
                          <td>{item.status}</td>
                          <td>{item.errorCount}</td>
                          <td>
                            <Link className="fdPillBtn" href={`/platform-admin/jobs/${item.id}`}>
                              Open
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
