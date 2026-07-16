import { NextResponse } from "next/server";
import { z } from "zod";
import {
  encouragementFor,
  normalizePhone,
  readStudentLineSession,
  recordStudentCheckin,
  upsertStudentProfile,
} from "../../../../lib/student-checkin";

const bindSchema = z.object({
  fullName: z.string().trim().min(2).max(40),
  phone: z.string().trim().min(8).max(20),
});

export async function POST(request: Request) {
  const session = await readStudentLineSession();
  if (!session) return NextResponse.json({ ok: false, error: "LINE_LOGIN_REQUIRED" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = bindSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "請填寫真實姓名與電話。" }, { status: 400 });
  }

  const phone = normalizePhone(parsed.data.phone);
  if (phone.length < 8) {
    return NextResponse.json({ ok: false, error: "電話格式不完整。" }, { status: 400 });
  }

  const profile = await upsertStudentProfile({
    lineUserId: session.lineUserId,
    lineDisplayName: session.lineDisplayName,
    fullName: parsed.data.fullName,
    phone,
  });
  const result = await recordStudentCheckin({ profile, request });

  return NextResponse.json({
    ok: true,
    profile: result.profile,
    checkIn: result.checkIn,
    reused: result.reused,
    encouragement: encouragementFor(result.profile.full_name, result.checkIn.month_sequence),
  });
}
