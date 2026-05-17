import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";

const WAITLIST_SELECT = [
  "id",
  "tenant_id",
  "branch_id",
  "contact_name",
  "contact_phone",
  "note",
  "status",
  "created_at",
].join(", ");

const waitlistStatuses = new Set(["pending", "contacted", "booked", "cancelled"]);

type BookingWaitlistRow = {
  id: string;
  tenant_id: string | null;
  branch_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  note: string | null;
  status: string | null;
  created_at: string | null;
};

function isMissingWaitlistTable(message: string) {
  return (
    message.includes('relation "booking_waitlist" does not exist') ||
    message.includes("Could not find the table 'public.booking_waitlist' in the schema cache")
  );
}

function normalizeStatus(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return waitlistStatuses.has(trimmed) ? trimmed : null;
}

function responseStatus(value: string | null) {
  return value === "notified" ? "contacted" : value;
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  let query = auth.supabase.from("booking_waitlist").select(WAITLIST_SELECT).order("created_at", { ascending: false }).limit(100);

  if (auth.context.role !== "platform_admin") {
    if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");
    query = query.eq("tenant_id", auth.context.tenantId);
  }
  if (auth.context.role === "frontdesk" && auth.context.branchId) {
    query = query.eq("branch_id", auth.context.branchId);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingWaitlistTable(error.message)) {
      return apiSuccess({ items: [], warning: "booking_waitlist table missing" });
    }
    return apiError(500, "INTERNAL_ERROR", error.message);
  }

  return apiSuccess({
    items: ((data || []) as BookingWaitlistRow[]).map((item) => ({
      id: item.id,
      tenantId: item.tenant_id,
      branchId: item.branch_id,
      contactName: item.contact_name,
      contactPhone: item.contact_phone,
      note: item.note,
      status: responseStatus(item.status),
      createdAt: item.created_at,
    })),
  });
}

export async function PATCH(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const status = normalizeStatus(body?.status);

  if (!id) return apiError(400, "FORBIDDEN", "id is required");
  if (!status) return apiError(400, "FORBIDDEN", "invalid status");

  let query = auth.supabase.from("booking_waitlist").update({ status }).eq("id", id);

  if (auth.context.role !== "platform_admin") {
    if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");
    query = query.eq("tenant_id", auth.context.tenantId);
  }
  if (auth.context.role === "frontdesk" && auth.context.branchId) {
    query = query.eq("branch_id", auth.context.branchId);
  }

  const { data, error } = await query.select(WAITLIST_SELECT).maybeSingle();
  if (error) {
    if (isMissingWaitlistTable(error.message)) {
      return apiError(409, "FORBIDDEN", "booking_waitlist table missing");
    }
    return apiError(500, "INTERNAL_ERROR", error.message);
  }
  if (!data) return apiError(404, "FORBIDDEN", "booking_waitlist item not found");

  return apiSuccess({
    item: {
      id: data.id,
      tenantId: data.tenant_id,
      branchId: data.branch_id,
      contactName: data.contact_name,
      contactPhone: data.contact_phone,
      note: data.note,
      status: responseStatus(data.status),
      createdAt: data.created_at,
    },
  });
}
