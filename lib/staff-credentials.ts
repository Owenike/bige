export const STAFF_PLACEHOLDER_EMAIL_DOMAIN = "staff.bigefitness.invalid";
export const CUSTOM_EMPLOYEE_NUMBER_MANAGER = "E000001";
export const STAFF_ACCOUNT_SETTINGS_EXCLUDED = "E000006";
export const BIGE_CONTRACT_CREATION_EXCLUDED = "E000006";
export const STAFF_NOTIFICATION_CENTER_EXCLUDED = "E000006";

export function normalizeEmployeeNumber(value: unknown) {
  if (typeof value !== "string") return "";

  const normalized = value.trim().toUpperCase();
  if (/^\d{1,6}$/.test(normalized)) {
    return `E${normalized.padStart(6, "0")}`;
  }

  return normalized;
}

export function isEmployeeNumber(value: string) {
  return /^E\d{6}$/.test(value);
}

export function canChooseStaffEmployeeNumber(value: unknown) {
  return normalizeEmployeeNumber(value) === CUSTOM_EMPLOYEE_NUMBER_MANAGER;
}

export function canUseStaffAccountSettings(value: unknown) {
  const employeeNumber = normalizeEmployeeNumber(value);
  return isEmployeeNumber(employeeNumber) && employeeNumber !== STAFF_ACCOUNT_SETTINGS_EXCLUDED;
}

export function canCreateBigeContract(value: unknown) {
  const employeeNumber = normalizeEmployeeNumber(value);
  return (
    isEmployeeNumber(employeeNumber) &&
    employeeNumber !== BIGE_CONTRACT_CREATION_EXCLUDED
  );
}

export function canUseStaffNotificationCenter(value: unknown) {
  return normalizeEmployeeNumber(value) !== STAFF_NOTIFICATION_CENTER_EXCLUDED;
}

export function staffPlaceholderEmail(employeeNumber: string) {
  return `${employeeNumber.toLowerCase()}@${STAFF_PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isStaffPlaceholderEmail(value: string | null | undefined) {
  return String(value || "").toLowerCase().endsWith(`@${STAFF_PLACEHOLDER_EMAIL_DOMAIN}`);
}
