import { apiError, requireProfile } from "./auth-context";

export async function requireTrialBookingAdmin(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk"], request);
  if (!auth.ok) return auth;

  if (
    auth.context.role !== "frontdesk" ||
    auth.context.authCapabilities?.includes("trial_booking_admin")
  ) {
    return auth;
  }

  return {
    ok: false as const,
    response: apiError(403, "FORBIDDEN", "Trial booking administration permission is required"),
  };
}
