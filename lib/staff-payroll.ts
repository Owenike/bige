export type PayrollEmployment = {
  employeeId: string;
  employmentType: "full_time" | "part_time";
  payBasis: "monthly" | "hourly";
  monthlySalary: number;
  hourlyRate: number;
};

export type PayrollLeave = {
  leaveType: "annual" | "sick" | "personal" | "family_care" | "marriage" | "bereavement" | "official" | "other";
  minutes: number;
};

export type PayrollOvertime = {
  minutes: number;
  dayType: "regular_workday" | "rest_day" | "national_holiday";
};

export type PayrollCalculation = {
  regularMinutes: number;
  overtimeMinutes: number;
  basePay: number;
  paidLeavePay: number;
  overtimePay: number;
  leaveDeduction: number;
  grossPay: number;
  lineItems: Array<{
    itemType: "earning" | "deduction";
    code: string;
    label: string;
    quantity: number;
    rate: number;
    amount: number;
    details?: Record<string, unknown>;
  }>;
};

export type InsuranceEnrollmentInput = {
  insuranceType: "labor" | "employment" | "occupational_accident" | "health" | "pension";
  status: string;
  insuredSalary: number;
  dependents?: number;
  voluntaryPensionRate?: number;
};

export type StatutoryRateInput = {
  rateType: "labor_insurance" | "health_insurance" | "pension";
  configuration: {
    employeeRate?: number;
    employeeShareRate?: number;
    fixedEmployeeAmount?: number;
    employeeAmountBySalary?: Record<string, number>;
    maxDependents?: number;
  };
};

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function leavePayRatio(leaveType: PayrollLeave["leaveType"]) {
  if (leaveType === "sick") return 0.5;
  if (leaveType === "personal" || leaveType === "family_care" || leaveType === "other") return 0;
  return 1;
}

export function calculateOvertimePay(hourlyBase: number, overtime: PayrollOvertime[]) {
  let total = 0;
  const items: PayrollCalculation["lineItems"] = [];
  for (const row of overtime) {
    let remaining = Math.max(0, row.minutes);
    let amount = 0;
    const tiers = row.dayType === "rest_day"
      ? [
          { minutes: 120, multiplier: 4 / 3 },
          { minutes: 360, multiplier: 5 / 3 },
          { minutes: 240, multiplier: 8 / 3 },
        ]
      : row.dayType === "national_holiday"
        ? [{ minutes: 480, multiplier: 1 }]
        : [
            { minutes: 120, multiplier: 4 / 3 },
            { minutes: 120, multiplier: 5 / 3 },
          ];
    for (const tier of tiers) {
      if (remaining <= 0) break;
      const minutes = Math.min(remaining, tier.minutes);
      amount += hourlyBase * (minutes / 60) * tier.multiplier;
      remaining -= minutes;
    }
    if (remaining > 0) amount += hourlyBase * (remaining / 60) * (8 / 3);
    amount = money(amount);
    total += amount;
    items.push({
      itemType: "earning",
      code: `overtime_${row.dayType}`,
      label: row.dayType === "rest_day" ? "休息日加班費" : row.dayType === "national_holiday" ? "國定假日出勤加給" : "平日加班費",
      quantity: row.minutes,
      rate: hourlyBase,
      amount,
      details: { dayType: row.dayType, calculatedToMinute: true },
    });
  }
  return { amount: money(total), items };
}

export function calculateEmployeePayroll(params: {
  employment: PayrollEmployment;
  regularMinutes: number;
  leaves?: PayrollLeave[];
  overtime?: PayrollOvertime[];
}) {
  const employment = params.employment;
  const regularMinutes = Math.max(0, Math.round(params.regularMinutes));
  const hourlyBase = employment.payBasis === "monthly" ? employment.monthlySalary / 30 / 8 : employment.hourlyRate;
  const basePay = employment.payBasis === "monthly"
    ? money(employment.monthlySalary)
    : money((regularMinutes / 60) * employment.hourlyRate);
  let paidLeavePay = 0;
  let leaveDeduction = 0;
  const lineItems: PayrollCalculation["lineItems"] = [{
    itemType: "earning",
    code: employment.payBasis === "monthly" ? "monthly_base" : "hourly_regular",
    label: employment.payBasis === "monthly" ? "本月底薪" : "一般工時薪資",
    quantity: employment.payBasis === "monthly" ? 1 : regularMinutes,
    rate: employment.payBasis === "monthly" ? employment.monthlySalary : employment.hourlyRate,
    amount: basePay,
    details: employment.payBasis === "hourly" ? { unit: "minute", displayedHours: regularMinutes / 60 } : undefined,
  }];

  for (const leave of params.leaves || []) {
    const minutes = Math.max(0, Math.round(leave.minutes));
    const ratio = leavePayRatio(leave.leaveType);
    if (employment.payBasis === "monthly") {
      const deduction = money(hourlyBase * (minutes / 60) * (1 - ratio));
      if (deduction > 0) {
        leaveDeduction += deduction;
        lineItems.push({ itemType: "deduction", code: `leave_${leave.leaveType}`, label: "請假薪資扣除", quantity: minutes, rate: hourlyBase, amount: deduction, details: { leaveType: leave.leaveType, payRatio: ratio } });
      }
    } else if (ratio > 0) {
      const paid = money(employment.hourlyRate * (minutes / 60) * ratio);
      paidLeavePay += paid;
      lineItems.push({ itemType: "earning", code: `paid_leave_${leave.leaveType}`, label: "有薪假薪資", quantity: minutes, rate: employment.hourlyRate, amount: paid, details: { leaveType: leave.leaveType, payRatio: ratio } });
    }
  }
  const overtime = calculateOvertimePay(hourlyBase, params.overtime || []);
  lineItems.push(...overtime.items);
  const grossPay = money(basePay + paidLeavePay + overtime.amount - leaveDeduction);
  return {
    regularMinutes,
    overtimeMinutes: (params.overtime || []).reduce((sum, item) => sum + Math.max(0, Math.round(item.minutes)), 0),
    basePay,
    paidLeavePay: money(paidLeavePay),
    overtimePay: overtime.amount,
    leaveDeduction: money(leaveDeduction),
    grossPay,
    lineItems,
  } satisfies PayrollCalculation;
}

export function calculateStatutoryDeductions(params: {
  enrollments: InsuranceEnrollmentInput[];
  rates: StatutoryRateInput[];
}) {
  const active = new Map(params.enrollments.filter((row) => row.status === "active").map((row) => [row.insuranceType, row]));
  const rates = new Map(params.rates.map((row) => [row.rateType, row.configuration]));
  const warnings: string[] = [];
  const amount = (type: "labor" | "health") => {
    const enrollment = active.get(type);
    const config = rates.get(type === "labor" ? "labor_insurance" : "health_insurance");
    if (!enrollment?.insuredSalary) {
      warnings.push(type === "labor" ? "勞保投保級距待補" : "健保投保級距待補");
      return 0;
    }
    if (!config) {
      warnings.push(type === "labor" ? "勞保費率待補" : "健保費率待補");
      return 0;
    }
    const employeeAmountBySalary = config.employeeAmountBySalary;
    if (employeeAmountBySalary && typeof employeeAmountBySalary === "object" && !Array.isArray(employeeAmountBySalary)) {
      const configuredAmount = Number((employeeAmountBySalary as Record<string, unknown>)[String(enrollment.insuredSalary)]);
      if (Number.isFinite(configuredAmount) && configuredAmount >= 0) {
        const dependents = type === "health" ? Math.min(Math.max(0, enrollment.dependents || 0), Number(config.maxDependents ?? 3)) : 0;
        return money(configuredAmount * (1 + dependents));
      }
    }
    if (Number.isFinite(Number(config.fixedEmployeeAmount))) return money(Number(config.fixedEmployeeAmount));
    const employeeRate = Number(config.employeeRate ?? config.employeeShareRate);
    if (!Number.isFinite(employeeRate) || employeeRate < 0) {
      warnings.push(type === "labor" ? "勞保員工負擔率待補" : "健保員工負擔率待補");
      return 0;
    }
    const insuredUnits = type === "health"
      ? 1 + Math.min(Math.max(0, Math.floor(Number(enrollment.dependents || 0))), Math.max(0, Math.floor(Number(config.maxDependents ?? 3))))
      : 1;
    return money(enrollment.insuredSalary * employeeRate * insuredUnits);
  };
  const laborInsuranceEmployee = amount("labor");
  const healthInsuranceEmployee = amount("health");
  const pension = active.get("pension");
  const pensionEmployee = pension?.insuredSalary
    ? money(pension.insuredSalary * Math.min(0.06, Math.max(0, Number(pension.voluntaryPensionRate || 0))))
    : 0;
  if (!pension?.insuredSalary) warnings.push("勞退提繳級距待補");
  return {
    laborInsuranceEmployee,
    healthInsuranceEmployee,
    pensionEmployee,
    total: money(laborInsuranceEmployee + healthInsuranceEmployee + pensionEmployee),
    ready: warnings.length === 0,
    warnings,
  };
}

export function regularMinutesFromPunches(params: {
  workDate: string;
  scheduledStartsAt: string;
  scheduledEndsAt: string;
  firstPunchAt: string | null;
  lastPunchAt: string | null;
  breakMinutes: number;
  paidBreak: boolean;
  crossesMidnight?: boolean;
}) {
  if (!params.firstPunchAt || !params.lastPunchAt) return null;
  const scheduledStart = new Date(`${params.workDate}T${params.scheduledStartsAt}:00+08:00`);
  const scheduledEnd = new Date(`${params.workDate}T${params.scheduledEndsAt}:00+08:00`);
  if (params.crossesMidnight || scheduledEnd <= scheduledStart) scheduledEnd.setUTCDate(scheduledEnd.getUTCDate() + 1);
  const firstPunch = new Date(params.firstPunchAt);
  const lastPunch = new Date(params.lastPunchAt);
  if (![scheduledStart, scheduledEnd, firstPunch, lastPunch].every((date) => Number.isFinite(date.getTime()))) return null;
  const effectiveStart = Math.max(scheduledStart.getTime(), firstPunch.getTime());
  const effectiveEnd = Math.min(scheduledEnd.getTime(), lastPunch.getTime());
  const spanMinutes = Math.max(0, Math.round((effectiveEnd - effectiveStart) / 60_000));
  return Math.max(0, spanMinutes - (params.paidBreak ? 0 : Math.max(0, Math.round(params.breakMinutes))));
}

export function nextMonthPayDates(monthStart: string) {
  const match = /^(\d{4})-(\d{2})-01$/.exec(monthStart);
  if (!match) throw new Error("Invalid payroll month");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  date.setUTCMonth(date.getUTCMonth() + 1);
  const prefix = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  return { basePayDate: `${prefix}-10`, bonusPayDate: `${prefix}-25` };
}
