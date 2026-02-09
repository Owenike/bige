import { NextResponse } from "next/server";
import { getRequestId } from "../../../lib/observability";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  // Keep this endpoint fast and dependency-free. It indicates the server is up.
  const uptimeSec = typeof process !== "undefined" && typeof process.uptime === "function" ? Math.floor(process.uptime()) : null;

  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
    uptimeSec,
    requestId,
  });
}

