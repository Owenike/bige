import { NextResponse } from "next/server";
import { dispatchPendingBigeLineScheduleNotifications } from "../../../../lib/bige-line-schedule";

function authorized(request: Request) {
  const authorization = request.headers.get("authorization");
  const acceptedSecrets = [
    process.env.BIGE_LINE_SCHEDULE_CRON_SECRET,
    process.env.CRON_SECRET,
  ].filter((value): value is string => Boolean(value));
  return acceptedSecrets.some((secret) => authorization === `Bearer ${secret}`);
}

async function run(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await dispatchPendingBigeLineScheduleNotifications({ limit: 200 });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
