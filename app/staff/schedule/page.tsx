import StaffScheduleSelfService from "../../../components/staff-schedule-self-service";

export const metadata = {
  title: "整月課表｜巨挺健身館",
};

function validMonth(value: string | string[] | undefined) {
  const month = Array.isArray(value) ? value[0] : value;
  return month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined;
}

export default async function StaffSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const query = await searchParams;
  return <StaffScheduleSelfService initialMonth={validMonth(query.month)} />;
}
