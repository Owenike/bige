import { NextResponse } from "next/server";
import { dispatchPendingBigeLineScheduleNotifications } from "../../../../lib/bige-line-schedule";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await dispatchPendingBigeLineScheduleNotifications({ limit: 200 });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
