import StaffPerformanceDashboard from "../../../components/staff-performance-dashboard";
import { requireProfile } from "../../../lib/auth-context";
import { performanceMonthRange, taiwanBusinessDate } from "../../../lib/staff-performance";
import { getStaffPerformanceState, staffPerformanceUserFromContext } from "../../../lib/staff-performance-read";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

export const metadata = { title: "每日業績與 EPO｜巨挺健身館" };

export default async function StaffPerformanceManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; date?: string }>;
}) {
  const requested = await searchParams;
  const today = taiwanBusinessDate(new Date());
  let month = /^\d{4}-\d{2}$/.test(requested.month || "") ? requested.month! : today.slice(0, 7);
  let date = /^\d{4}-\d{2}-\d{2}$/.test(requested.date || "") ? requested.date! : today;
  try {
    performanceMonthRange(month);
    if (!date.startsWith(month)) throw new Error("日期不在所選月份");
  } catch {
    month = today.slice(0, 7);
    date = today;
  }

  let initialData = null;
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager"]);
  if (auth.ok) {
    try {
      const admin = createSupabaseAdminClient();
      initialData = await getStaffPerformanceState(
        admin,
        staffPerformanceUserFromContext(auth.context),
        auth.context,
        month,
        date,
        "daily",
      );
    } catch (error) {
      console.error("[staff-performance] server preload failed", error);
    }
  }

  return <StaffPerformanceDashboard managerMode initialData={initialData} initialMonth={month} initialDate={date} />;
}
