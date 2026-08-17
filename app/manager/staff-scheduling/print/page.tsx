import StaffSchedulePrint from "../../../../components/staff-schedule-print";

export const metadata = { title: "列印班表｜巨挺健身館" };

export default async function StaffSchedulePrintPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const query = await searchParams;
  return <StaffSchedulePrint month={/^\d{4}-\d{2}$/.test(query.month || "") ? String(query.month) : new Date().toISOString().slice(0, 7)} />;
}
