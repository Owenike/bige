import StaffScheduleSelfService from "../../../components/staff-schedule-self-service";

export const metadata = {
  title: "我的班表｜巨挺健身館",
};

export default async function StaffSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const query = await searchParams;
  const initialMonth = /^\d{4}-\d{2}$/.test(query.month || "") ? query.month : undefined;
  return <StaffScheduleSelfService initialMonth={initialMonth} />;
}
