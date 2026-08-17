import { createSupabaseAdminClient } from "./supabase/admin";
import { toTaipeiDateString } from "./bige-fitness";

export type BigeBusinessDaySetting = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  business_date: string;
  is_closed: boolean;
  closure_label: string | null;
  frontdesk_name: string | null;
  source: string;
};

export async function resolveDefaultBigeTenantId() {
  const admin = createSupabaseAdminClient();
  const result = await admin
    .from("tenants")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data?.id ? String(result.data.id) : null;
}

export async function loadBigeBusinessDaySetting(input: {
  tenantId: string;
  businessDate?: string;
}) {
  const admin = createSupabaseAdminClient();
  const businessDate = input.businessDate || toTaipeiDateString();
  const result = await admin
    .from("bige_business_day_settings")
    .select(
      "id, tenant_id, branch_id, business_date, is_closed, closure_label, frontdesk_name, source",
    )
    .eq("tenant_id", input.tenantId)
    .eq("business_date", businessDate)
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return (result.data as BigeBusinessDaySetting | null) || null;
}

export async function isBigeFacilityClosed(input: {
  tenantId?: string | null;
  businessDate?: string;
}) {
  const tenantId = input.tenantId || (await resolveDefaultBigeTenantId());
  if (!tenantId) return { closed: false, setting: null, tenantId: null };
  const setting = await loadBigeBusinessDaySetting({
    tenantId,
    businessDate: input.businessDate,
  });
  return { closed: Boolean(setting?.is_closed), setting, tenantId };
}

export function bigeFacilityClosedMessage(setting: BigeBusinessDaySetting | null) {
  return setting?.closure_label || "今日館休，暫停營業。";
}
