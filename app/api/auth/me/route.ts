import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

export async function GET(request: Request) {
  const auth = await requireProfile(undefined, request);
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    userId: auth.context.userId,
    role: auth.context.role,
    tenantId: auth.context.tenantId,
    branchId: auth.context.branchId,
  });
}
