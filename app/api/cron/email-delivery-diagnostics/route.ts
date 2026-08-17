import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { collectResendDeliveryDiagnostics } from "../../../../lib/resend-delivery-diagnostics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(request: Request) {
  const expected = process.env.CRON_SECRET || "";
  const authorization = request.headers.get("authorization") || "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1] || "";
  const actual = request.headers.get("x-cron-secret") || bearer;
  return Boolean(expected && actual && safeEquals(actual, expected));
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const diagnostics = await collectResendDeliveryDiagnostics();
    return NextResponse.json({ ok: true, diagnostics }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email delivery diagnostics failed";
    console.error(JSON.stringify({
      level: "error",
      message: "email_delivery_diagnostics_failed",
      error: message,
    }));
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
