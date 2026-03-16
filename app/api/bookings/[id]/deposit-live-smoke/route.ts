import { apiError, apiSuccess, requireOpenShift, requireProfile } from "../../../../../lib/auth-context";
import {
  listBookingDepositLiveSmokeEvidence,
  persistBookingDepositLiveSmokeEvidence,
} from "../../../../../lib/booking-deposit-payments";
import type {
  BookingDepositLiveSmokeEvidenceInput,
  BookingDepositLiveSmokeResult,
  BookingDepositLiveSmokeSource,
  BookingDepositLiveSmokeStepResults,
} from "../../../../../types/booking-management";

function defaultSmokeSteps(): BookingDepositLiveSmokeStepResults {
  return {
    paymentLinkObtained: false,
    callbackReceived: false,
    managerDetailVerified: false,
    bookingStateVerified: false,
    notificationsVerified: false,
    reportsVerified: false,
  };
}

function normalizeEvidenceInput(body: unknown): BookingDepositLiveSmokeEvidenceInput | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const source = (typeof value.source === "string" ? value.source : "manual") as BookingDepositLiveSmokeSource;
  const smokeResult = (typeof value.smokeResult === "string" ? value.smokeResult : "partial") as BookingDepositLiveSmokeResult;
  if (!["manual", "replay", "live"].includes(source)) return null;
  if (!["pass", "fail", "partial"].includes(smokeResult)) return null;

  const stepsValue = value.smokeSteps && typeof value.smokeSteps === "object" ? (value.smokeSteps as Record<string, unknown>) : {};
  const defaults = defaultSmokeSteps();

  return {
    source,
    smokeResult,
    notes: typeof value.notes === "string" ? value.notes : "",
    compareResultSummary: typeof value.compareResultSummary === "string" ? value.compareResultSummary : "",
    rawEvidencePayload: typeof value.rawEvidencePayload === "string" ? value.rawEvidencePayload : "",
    smokeSteps: {
      paymentLinkObtained: typeof stepsValue.paymentLinkObtained === "boolean" ? stepsValue.paymentLinkObtained : defaults.paymentLinkObtained,
      callbackReceived: typeof stepsValue.callbackReceived === "boolean" ? stepsValue.callbackReceived : defaults.callbackReceived,
      managerDetailVerified:
        typeof stepsValue.managerDetailVerified === "boolean" ? stepsValue.managerDetailVerified : defaults.managerDetailVerified,
      bookingStateVerified:
        typeof stepsValue.bookingStateVerified === "boolean" ? stepsValue.bookingStateVerified : defaults.bookingStateVerified,
      notificationsVerified:
        typeof stepsValue.notificationsVerified === "boolean" ? stepsValue.notificationsVerified : defaults.notificationsVerified,
      reportsVerified: typeof stepsValue.reportsVerified === "boolean" ? stepsValue.reportsVerified : defaults.reportsVerified,
    },
  } satisfies BookingDepositLiveSmokeEvidenceInput;
}

async function getScopedBooking(params: {
  supabase: any;
  tenantId: string;
  branchId: string | null;
  bookingId: string;
}) {
  let query = params.supabase
    .from("bookings")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.bookingId);

  if (params.branchId) {
    query = query.eq("branch_id", params.branchId);
  }

  const result = await query.maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data ? { id: result.data.id as string } : null;
}

async function loadPerformedByName(params: { supabase: any; tenantId: string; actorId: string }) {
  const result = await params.supabase
    .from("profiles")
    .select("id, display_name")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.actorId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data?.display_name as string | null | undefined) || params.actorId;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(403, "FORBIDDEN", "Missing tenant context");

  const { id } = await context.params;
  try {
    const scopedBooking = await getScopedBooking({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      branchId: auth.context.branchId,
      bookingId: id,
    });
    if (!scopedBooking) return apiError(404, "FORBIDDEN", "Booking not found");

    const evidence = await listBookingDepositLiveSmokeEvidence({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      bookingId: id,
      limit: 10,
    });

    return apiSuccess(evidence);
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Failed to load booking deposit live smoke evidence");
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(403, "FORBIDDEN", "Missing tenant context");

  const shiftGuard = await requireOpenShift({ supabase: auth.supabase, context: auth.context });
  if (!shiftGuard.ok) return shiftGuard.response;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const input = normalizeEvidenceInput(body);
  if (!input) {
    return apiError(400, "FORBIDDEN", "Invalid live smoke evidence payload");
  }

  try {
    const scopedBooking = await getScopedBooking({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      branchId: auth.context.branchId,
      bookingId: id,
    });
    if (!scopedBooking) return apiError(404, "FORBIDDEN", "Booking not found");

    const performedByName = await loadPerformedByName({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      actorId: auth.context.userId,
    });

    const saved = await persistBookingDepositLiveSmokeEvidence({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      bookingId: id,
      actorId: auth.context.userId,
      performedByName,
      input,
    });
    const evidence = await listBookingDepositLiveSmokeEvidence({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      bookingId: id,
      limit: 10,
    });

    return apiSuccess({
      saved,
      latest: evidence.latest,
      history: evidence.history,
    });
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Failed to save booking deposit live smoke evidence");
  }
}
