"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../app/manager/staff-permissions/page.module.css";

type Permission = { allowed: boolean; defaultAllowed: boolean; override: boolean | null; reason: string | null; updatedAt: string | null };
type Employee = { id: string; display_name: string | null; english_name: string | null; employee_number: string | null; role: string; position: string | null; department: string | null; is_active: boolean; permissions: Record<string, Permission> };
type State = { permissionKeys: string[]; employees: Employee[] };

const LABELS: Record<string, string> = {
  create_employee: "建立員工",
  edit_employee: "修改員工",
  suspend_employee: "停用員工",
  manage_schedule: "編排班表",
  publish_schedule: "終審發布班表",
  review_leave_requests: "覆核請假",
  manage_attendance: "匯入及處理打卡",
  view_team_schedule: "查看全員班表",
  view_team_salary: "查看全員薪資",
  calculate_payroll: "產生薪資試算",
  close_payroll: "薪資關帳與更正",
  manage_insurance: "設定勞健保",
  assign_supervisor: "指派主管",
  manage_permissions: "管理帳號權限",
  export_schedule: "匯出班表",
  allocate_sales_performance: "分配教練業績",
  approve_sales_performance: "覆核教練業績",
  manage_epo: "提出／分配 EPO",
  confirm_daily_sales_report: "確認每日業績報表",
};

async function parse(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.message || payload?.error?.message || "操作失敗");
  return payload.data as State;
}

export default function StaffPermissionsManager() {
  const [data, setData] = useState<State | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setError("");
    try { setData(await parse(await fetch("/api/staff-permissions", { cache: "no-store" }))); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "讀取失敗"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const employees = useMemo(() => (data?.employees || []).filter((employee) => {
    const text = `${employee.display_name || ""} ${employee.english_name || ""} ${employee.employee_number || ""}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  }), [data?.employees, query]);

  async function update(employee: Employee, permissionKey: string, override: boolean | null) {
    const current = employee.permissions[permissionKey];
    if (current.override === override) return;
    const reason = override === null ? "恢復職務預設權限" : window.prompt(`${override ? "允許" : "禁止"}「${LABELS[permissionKey] || permissionKey}」的理由（必填）`, "") || "";
    if (override !== null && reason.trim().length < 3) return;
    if (!window.confirm(`確認將 ${employee.display_name || employee.employee_number || "此員工"} 的「${LABELS[permissionKey] || permissionKey}」設為${override === null ? "職務預設" : override ? "允許" : "禁止"}？`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      setData(await parse(await fetch("/api/staff-permissions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ employeeId: employee.id, permissionKey, override, reason }) })));
      setNotice("權限已更新，並保留操作者、時間與理由。重新登入後也會套用。 ");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "更新失敗"); }
    finally { setBusy(false); }
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><p>巨挺健身館 · 帳號安全</p><h1>員工帳號權限</h1><span>每一格可沿用職務預設，也可針對單一帳號明確允許或禁止；所有調整都有稽核紀錄。</span></div>
      <div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋姓名或員工編號" /><a href="/manager/staff-scheduling">返回班表</a></div>
    </header>
    {error ? <div className={styles.error}>{error}</div> : null}
    {notice ? <div className={styles.notice}>{notice}</div> : null}
    {!data ? <div className={styles.empty}>正在讀取權限…</div> : <div className={styles.scroller}><table><thead><tr><th>員工</th>{data.permissionKeys.map((key) => <th key={key}>{LABELS[key] || key}</th>)}</tr></thead><tbody>{employees.map((employee) => <tr key={employee.id}><th><strong>{employee.display_name || employee.english_name || "未命名"}</strong><small>{employee.employee_number || "無編號"} · {employee.position || employee.role}{employee.is_active ? "" : " · 已停用"}</small></th>{data.permissionKeys.map((key) => { const permission = employee.permissions[key]; return <td key={key}><select disabled={busy} value={permission.override === null ? "default" : permission.override ? "allow" : "deny"} onChange={(event) => void update(employee, key, event.target.value === "default" ? null : event.target.value === "allow")} title={permission.reason || "沿用職務預設"}><option value="default">預設：{permission.defaultAllowed ? "允許" : "禁止"}</option><option value="allow">個別允許</option><option value="deny">個別禁止</option></select><small className={permission.allowed ? styles.allowed : styles.denied}>{permission.allowed ? "目前可用" : "目前不可用"}</small></td>; })}</tr>)}</tbody></table></div>}
  </main>;
}
