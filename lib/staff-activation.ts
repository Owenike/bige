import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";

export const STAFF_ACTIVATION_CODE_DIGITS = 8;
export const STAFF_ACTIVATION_TTL_HOURS = 24;
export const STAFF_ACTIVATION_MAX_ATTEMPTS = 5;

export const STAFF_ACTIVATION_STATUSES = [
  "pending_identity",
  "identity_confirmed",
  "denied",
  "locked",
  "completed",
] as const;

export type StaffActivationStatus = (typeof STAFF_ACTIVATION_STATUSES)[number];

export function isStaffActivationStatus(value: unknown): value is StaffActivationStatus {
  return (
    typeof value === "string" &&
    STAFF_ACTIVATION_STATUSES.includes(value as StaffActivationStatus)
  );
}

export function isStaffActivationComplete(value: unknown) {
  return value === "completed";
}

export function normalizeStaffActivationCode(value: unknown) {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

export function isStaffActivationCode(value: string) {
  return new RegExp(`^\\d{${STAFF_ACTIVATION_CODE_DIGITS}}$`).test(value);
}

export function generateStaffActivationCode() {
  const upperBound = 10 ** STAFF_ACTIVATION_CODE_DIGITS;
  return randomInt(0, upperBound).toString().padStart(STAFF_ACTIVATION_CODE_DIGITS, "0");
}

export function staffActivationCodeHash(code: string, secret: string) {
  if (!secret) throw new Error("Staff activation secret is missing");
  return createHmac("sha256", secret).update(code).digest("hex");
}

export function matchesStaffActivationCode(params: {
  code: string;
  expectedHash: string;
  secret: string;
}) {
  const actual = Buffer.from(staffActivationCodeHash(params.code, params.secret), "hex");
  const expected = Buffer.from(params.expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function staffActivationSecret() {
  const secret =
    process.env.STAFF_ACTIVATION_PEPPER ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  if (!secret) throw new Error("STAFF_ACTIVATION_PEPPER or SUPABASE_SERVICE_ROLE_KEY is required");
  return secret;
}

export function staffActivationExpiresAt(now = new Date()) {
  return new Date(now.getTime() + STAFF_ACTIVATION_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

export function generateInternalStaffPassword() {
  return `${randomBytes(32).toString("base64url")}Aa1!`;
}

export function staffActivationStatusLabel(status: StaffActivationStatus | null | undefined) {
  if (status === "pending_identity") return "待本人啟用";
  if (status === "identity_confirmed") return "本人已確認";
  if (status === "denied") return "本人否認，待主管處理";
  if (status === "locked") return "啟用碼已鎖定";
  return "啟用完成";
}
