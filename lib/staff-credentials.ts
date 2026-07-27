export const INITIAL_STAFF_PASSWORD = "88888888";
export const STAFF_PLACEHOLDER_EMAIL_DOMAIN = "staff.bigefitness.invalid";

export function normalizeEmployeeNumber(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function isEmployeeNumber(value: string) {
  return /^E\d{6}$/.test(value);
}

export function staffPlaceholderEmail(employeeNumber: string) {
  return `${employeeNumber.toLowerCase()}@${STAFF_PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isStaffPlaceholderEmail(value: string | null | undefined) {
  return String(value || "").toLowerCase().endsWith(`@${STAFF_PLACEHOLDER_EMAIL_DOMAIN}`);
}
