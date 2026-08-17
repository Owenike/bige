import { NextResponse } from "next/server";
import { apiError, requireProfile } from "../../../../../lib/auth-context";
import { hasStaffPermission } from "../../../../../lib/staff-operation-permissions";
import { writeStaffAudit } from "../../../../../lib/staff-audit";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

export const runtime = "nodejs";

const STAFF_ROLES = [
  "platform_admin",
  "manager",
  "supervisor",
  "branch_manager",
  "store_owner",
  "store_manager",
  "frontdesk",
  "coach",
  "therapist",
  "sales",
] as const;

export async function GET(request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  const auth = await requireProfile([...STAFF_ROLES], request);
  if (!auth.ok) return auth.response;
  try {
    const { attachmentId } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) return apiError(400, "FORBIDDEN", "附件編號格式錯誤");
    const admin = createSupabaseAdminClient();
    const [profile, attachment] = await Promise.all([
      admin.from("profiles").select("id, tenant_id").eq("id", auth.context.userId).maybeSingle(),
      admin.from("staff_leave_attachments").select("id, tenant_id, employee_id, object_path, file_name").eq("id", attachmentId).maybeSingle(),
    ]);
    if (profile.error || attachment.error) throw new Error(profile.error?.message || attachment.error?.message || "讀取附件失敗");
    if (!profile.data || !attachment.data || profile.data.tenant_id !== attachment.data.tenant_id) return apiError(404, "FORBIDDEN", "找不到附件");
    const mayReview = await hasStaffPermission({ supabase: admin, tenantId: String(profile.data.tenant_id), employeeId: auth.context.userId, context: auth.context, permission: "review_leave_requests" });
    if (attachment.data.employee_id !== auth.context.userId && !mayReview) return apiError(403, "FORBIDDEN", "您沒有權限查看此附件");
    const signed = await admin.storage.from("staff-leave-proofs").createSignedUrl(String(attachment.data.object_path), 300, { download: false });
    if (signed.error) throw new Error(signed.error.message);
    await writeStaffAudit({
      supabase: admin,
      request,
      tenantId: String(profile.data.tenant_id),
      actorId: auth.context.userId,
      action: "staff_leave_proof_viewed",
      targetType: "staff_leave_attachment",
      targetId: attachmentId,
      payload: { employeeId: attachment.data.employee_id, fileName: attachment.data.file_name },
    });
    return NextResponse.redirect(signed.data.signedUrl, { status: 302 });
  } catch (error) {
    return apiError(400, "FORBIDDEN", error instanceof Error ? error.message : "無法開啟附件");
  }
}
