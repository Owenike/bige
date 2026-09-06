type StaffScheduleResponseGuard = {
  requestedMonth: string;
  activeMonth: string;
  requestRevision: number;
  latestRequestRevision: number;
  responseMonthStart?: string | null;
};

export function staffScheduleMonthStart(month: string) {
  return `${month}-01`;
}

export function shouldApplyStaffScheduleResponse(params: StaffScheduleResponseGuard) {
  if (params.requestedMonth !== params.activeMonth) return false;
  if (params.requestRevision !== params.latestRequestRevision) return false;
  if (params.responseMonthStart === undefined) return true;
  return params.responseMonthStart === staffScheduleMonthStart(params.requestedMonth);
}
