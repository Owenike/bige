import { NextResponse } from "next/server";
import { requireProfile } from "../../../lib/auth-context";
import { resolveBranchTherapists } from "../../../lib/therapist-scheduling";

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk", "coach", "member"], request);
  if (!auth.ok) return auth.response;
  const supabase = auth.supabase;
  const tenantId = auth.context.tenantId;
  if (!tenantId) return NextResponse.json({ items: [] });
  try {
    const items = await resolveBranchTherapists({
      supabase,
      tenantId,
      branchId: auth.context.branchId,
    });
    return NextResponse.json({
      items: items.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        branchId: row.primaryBranchId,
        branchIds: row.branchIds,
        role: row.role,
        isActive: row.isActive,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load therapists" }, { status: 500 });
  }
}
