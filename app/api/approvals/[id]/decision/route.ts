import { z } from "zod";
import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { executeOrderVoid, executePaymentRefund } from "../../../../../lib/high-risk-actions";
import { sendNotification } from "../../../../../lib/integrations/notify";
import { notifyApprovalDecision } from "../../../../../lib/in-app-notifications";
import { insertDeliveryRows } from "../../../../../lib/notification-ops";
import { requireAnyPermission } from "../../../../../lib/permissions";
import {
  canApproveDepartmentMoney,
  canDirectlyApproveBigeContractRisk,
  type StaffDepartment,
} from "../../../../../lib/staff-organization";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

type Decision = "approve" | "reject";
type ApprovalAction =
  | "order_void"
  | "payment_refund"
  | "bige_contract_payment_void"
  | "bige_contract_payment_refund"
  | "bige_contract_extension";

const extensionPayloadSchema = z.object({
  extensionDays: z.coerce.number().int().positive(),
  signaturePath: z.string().trim().min(1).max(1000),
  signatureStatement: z.string().trim().min(1).max(1000),
  signedMemberName: z.string().trim().min(1).max(80),
  signedAt: z.string().datetime({ offset: true }),
});

function isBigeApprovalAction(action: string): action is Exclude<ApprovalAction, "order_void" | "payment_refund"> {
  return action.startsWith("bige_contract_");
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["platform_admin", "manager", "branch_manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) {
    return apiError(400, "FORBIDDEN", "Invalid tenant context");
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const decision: Decision = body?.decision === "reject" ? "reject" : "approve";
  const decisionNote = typeof body?.decisionNote === "string" ? body.decisionNote.trim() : "";

  const { data: reqRow, error: reqError } = await auth.supabase
    .from("high_risk_action_requests")
    .select("id, action, target_type, target_id, owning_department, reason, payload, status, requested_by")
    .eq("id", id)
    .eq("tenant_id", auth.context.tenantId)
    .maybeSingle();

  if (reqError || !reqRow) return apiError(404, "FORBIDDEN", "Approval request not found");
  if (reqRow.status !== "pending") {
    return apiError(409, "FORBIDDEN", "This request is already being processed or resolved");
  }

  const action = String(reqRow.action) as ApprovalAction;
  if (isBigeApprovalAction(action)) {
    if (!canDirectlyApproveBigeContractRisk(auth.context)) {
      return apiError(403, "FORBIDDEN", "只有經理能覆核合約退款、作廢或延期");
    }
  } else {
    const requiredPermission = action === "payment_refund"
      ? "refunds.approve"
      : "orders.void.approve";
    const permission = requireAnyPermission(auth.context, [requiredPermission]);
    if (!permission.ok) return permission.response;
  }

  let owningDepartment: StaffDepartment = "coaching";
  if (action === "order_void") {
    const order = await auth.supabase
      .from("orders")
      .select("owning_department")
      .eq("tenant_id", auth.context.tenantId)
      .eq("id", reqRow.target_id)
      .maybeSingle();
    if (order.error || !order.data) return apiError(404, "FORBIDDEN", "Order not found");
    owningDepartment = (order.data.owning_department || "general_affairs") as StaffDepartment;
  } else if (action === "payment_refund") {
    const payment = await auth.supabase
      .from("payments")
      .select("owning_department, orders(owning_department)")
      .eq("tenant_id", auth.context.tenantId)
      .eq("id", reqRow.target_id)
      .maybeSingle();
    if (payment.error || !payment.data) return apiError(404, "FORBIDDEN", "Payment not found");
    const orderRelation = Array.isArray(payment.data.orders)
      ? payment.data.orders[0]
      : payment.data.orders;
    owningDepartment = (
      payment.data.owning_department || orderRelation?.owning_department || "general_affairs"
    ) as StaffDepartment;
  }
  if (!canApproveDepartmentMoney(auth.context, owningDepartment)) {
    return apiError(403, "FORBIDDEN", "This request belongs to another department");
  }

  if (decision === "reject") {
    const { data, error } = await auth.supabase
      .from("high_risk_action_requests")
      .update({
        status: "rejected",
        decision_note: decisionNote || null,
        resolved_by: auth.context.userId,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("tenant_id", auth.context.tenantId)
      .eq("status", "pending")
      .select("id, status, decision_note, resolved_at")
      .maybeSingle();
    if (error) return apiError(500, "INTERNAL_ERROR", error.message);
    if (!data) return apiError(409, "FORBIDDEN", "This request is already resolved");

    if (action === "bige_contract_extension") {
      const parsedPayload = extensionPayloadSchema.safeParse(reqRow.payload);
      if (parsedPayload.success) {
        await createSupabaseAdminClient().storage
          .from("bige-contract-signatures")
          .remove([parsedPayload.data.signaturePath])
          .catch(() => null);
      }
    }

    await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "high_risk_request_rejected",
      target_type: reqRow.target_type,
      target_id: reqRow.target_id,
      reason: reqRow.reason,
      payload: { requestId: id, action, decisionNote: decisionNote || null },
    });
    await notifyApprovalDecision({
      tenantId: auth.context.tenantId,
      requestId: id,
      decision: "rejected",
      action,
      targetType: reqRow.target_type,
      targetId: reqRow.target_id,
      requestedBy: typeof reqRow.requested_by === "string" ? reqRow.requested_by : null,
      resolvedBy: auth.context.userId,
    }).catch(() => null);
    return apiSuccess({ request: data, decision: "rejected" });
  }

  const claimed = await auth.supabase
    .from("high_risk_action_requests")
    .update({
      status: "processing",
      resolved_by: auth.context.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", auth.context.tenantId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claimed.error) return apiError(500, "INTERNAL_ERROR", claimed.error.message);
  if (!claimed.data) return apiError(409, "FORBIDDEN", "This request is already being processed");

  const restorePending = async () => {
    await auth.supabase
      .from("high_risk_action_requests")
      .update({ status: "pending", resolved_by: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("tenant_id", auth.context.tenantId)
      .eq("status", "processing");
  };

  if (action === "order_void") {
    const result = await executeOrderVoid({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      actorId: auth.context.userId,
      role: "manager",
      branchId: auth.context.branchId,
      orderId: reqRow.target_id,
      reason: reqRow.reason,
    });
    if (!result.ok) {
      await restorePending();
      return apiError(result.status, "FORBIDDEN", result.error);
    }
  } else if (action === "payment_refund") {
    const result = await executePaymentRefund({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      actorId: auth.context.userId,
      paymentId: reqRow.target_id,
      reason: reqRow.reason,
    });
    if (!result.ok) {
      await restorePending();
      return apiError(result.status, "FORBIDDEN", result.error);
    }
  } else if (action === "bige_contract_payment_void" || action === "bige_contract_payment_refund") {
    const result = await auth.supabase.rpc("bige_reverse_contract_payment", {
      p_payment_id: reqRow.target_id,
      p_action: action === "bige_contract_payment_refund" ? "refund" : "void",
      p_reason: reqRow.reason,
    });
    if (result.error) {
      await restorePending();
      return apiError(400, "FORBIDDEN", result.error.message);
    }
  } else if (action === "bige_contract_extension") {
    const parsedPayload = extensionPayloadSchema.safeParse(reqRow.payload);
    if (!parsedPayload.success) {
      await restorePending();
      return apiError(400, "FORBIDDEN", "延期申請資料不完整");
    }
    const extension = parsedPayload.data;
    const result = await auth.supabase.rpc("bige_extend_contract", {
      p_contract_id: reqRow.target_id,
      p_extension_days: extension.extensionDays,
      p_reason: reqRow.reason,
      p_signature_path: extension.signaturePath,
      p_signature_statement: extension.signatureStatement,
      p_signed_member_name: extension.signedMemberName,
      p_signed_at: extension.signedAt,
    });
    if (result.error) {
      await restorePending();
      return apiError(400, "FORBIDDEN", result.error.message);
    }

    const contractResult = await auth.supabase
      .from("member_plan_contracts")
      .select("member_id, branch_id")
      .eq("id", reqRow.target_id)
      .eq("tenant_id", auth.context.tenantId)
      .maybeSingle();
    if (contractResult.data?.member_id) {
      const memberResult = await auth.supabase
        .from("members")
        .select("full_name, email, email_unavailable")
        .eq("id", contractResult.data.member_id)
        .maybeSingle();
      if (memberResult.data?.email && !memberResult.data.email_unavailable) {
        const notifyResult = await sendNotification({
          channel: "email",
          target: memberResult.data.email,
          templateKey: "BIG E 合約延期完成通知",
          message: [
            `${memberResult.data.full_name} 您好：`,
            "",
            `您的課程合約已完成延期 ${extension.extensionDays} 天。`,
            `新的有效期限：${String((result.data as Record<string, unknown> | null)?.newEndsAt || "")}`,
            `辦理原因：${reqRow.reason}`,
            "",
            "本次延期已由您現場簽名確認。如內容有疑問，請洽 BIG E FITNESS 櫃台。",
          ].join("\n"),
        });
        await insertDeliveryRows({
          supabase: auth.supabase,
          rows: [{
            tenantId: auth.context.tenantId,
            branchId: contractResult.data.branch_id,
            memberId: contractResult.data.member_id,
            sourceRefType: "fitness_contract_extended",
            sourceRefId: reqRow.target_id,
            templateKey: "bige_contract_extended",
            recipientName: memberResult.data.full_name,
            recipientEmail: memberResult.data.email,
            channel: "email",
            status: notifyResult.ok ? "sent" : "retrying",
            attempts: 1,
            nextRetryAt: notifyResult.ok ? null : new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
            sentAt: notifyResult.ok ? new Date().toISOString() : null,
            lastAttemptAt: new Date().toISOString(),
            errorMessage: notifyResult.error,
            deliveryMode: "provider",
            dedupeKey: `bige-contract-extended:${String((result.data as Record<string, unknown> | null)?.extensionId || "")}`,
            payload: {
              eventType: "fitness_contract_extended",
              message: `${memberResult.data.full_name} 您好，您的 BIG E FITNESS 課程合約已完成延期 ${extension.extensionDays} 天。`,
              emailSubject: "BIG E 合約延期完成通知",
            },
            createdBy: auth.context.userId,
          }],
        }).catch(() => null);
      }
    }
  } else {
    await restorePending();
    return apiError(400, "FORBIDDEN", "Unsupported action type");
  }

  const { data, error } = await auth.supabase
    .from("high_risk_action_requests")
    .update({
      status: "approved",
      decision_note: decisionNote || null,
      resolved_by: auth.context.userId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", auth.context.tenantId)
    .eq("status", "processing")
    .select("id, status, decision_note, resolved_at")
    .maybeSingle();
  if (error) return apiError(500, "INTERNAL_ERROR", error.message);
  if (!data) return apiError(409, "FORBIDDEN", "Approval state changed unexpectedly");

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "high_risk_request_approved",
    target_type: reqRow.target_type,
    target_id: reqRow.target_id,
    reason: reqRow.reason,
    payload: { requestId: id, action, decisionNote: decisionNote || null },
  });
  await notifyApprovalDecision({
    tenantId: auth.context.tenantId,
    requestId: id,
    decision: "approved",
    action,
    targetType: reqRow.target_type,
    targetId: reqRow.target_id,
    requestedBy: typeof reqRow.requested_by === "string" ? reqRow.requested_by : null,
    resolvedBy: auth.context.userId,
  }).catch(() => null);

  return apiSuccess({ request: data, decision: "approved" });
}
