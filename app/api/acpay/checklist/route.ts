import { NextResponse } from "next/server";
import { getAcpayChecklistSnapshot } from "../../../../lib/acpay-checklist";
import { getAcpayConfigSummary, getAcpayServerConfig, isAuthorizedAcpayTestRequest } from "../../../../lib/acpay-server";

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(request: Request) {
  const config = getAcpayServerConfig();
  const { searchParams } = new URL(request.url);
  const outTradeNo = searchParams.get("out_trade_no")?.trim() || searchParams.get("outTradeNo")?.trim() || undefined;

  if (config.acpayEnv !== "test") {
    return jsonError(403, "ACpay checklist diagnostics are only available when ACPAY_ENV=test.");
  }

  if (!isAuthorizedAcpayTestRequest(request, config.testActionToken)) {
    console.warn("[acpay] checklist rejected: invalid test token", {
      hasTestActionToken: Boolean(config.testActionToken),
    });
    return jsonError(401, "Unauthorized ACpay checklist diagnostics.");
  }

  return NextResponse.json({
    ok: true,
    config: getAcpayConfigSummary(config),
    checklist: getAcpayChecklistSnapshot(outTradeNo),
    outTradeNo: outTradeNo || null,
    note: "This in-memory snapshot is best-effort in serverless runtimes. Use Vercel structured logs as the source of truth for checklist evidence.",
  });
}
