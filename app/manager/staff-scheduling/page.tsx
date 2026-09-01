import StaffScheduleManager from "../../../components/staff-schedule-manager";

export const metadata = {
  title: "全員班表控制台｜巨挺健身館",
};

export default async function StaffSchedulingManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const query = await searchParams;
  const initialMonth = /^\d{4}-\d{2}$/.test(query.month || "") ? query.month : undefined;
  return <StaffScheduleManager initialMonth={initialMonth} />;
}
