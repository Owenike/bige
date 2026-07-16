import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireProfile } from "../../../../../../lib/auth-context";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";
import { STUDENT_PHOTO_BUCKET } from "../../../../../../lib/student-checkin";

const acceptedPhotoTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function authFailureResponse(status: number) {
  if (status === 401) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (status === 403) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ok: false, error: "Unable to verify access" }, { status: status || 500 });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk"], request);
  if (!auth.ok) return authFailureResponse(auth.response.status);

  const form = await request.formData().catch(() => null);
  const photo = form?.get("photo");
  if (!(photo instanceof File) || photo.size === 0) {
    return NextResponse.json({ ok: false, error: "請拍攝本人照片。" }, { status: 400 });
  }
  const extension = acceptedPhotoTypes.get(photo.type);
  if (!extension || photo.size > 2 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "照片需為 JPG、PNG 或 WebP，且不可超過 2MB。" }, { status: 400 });
  }

  const { id } = await context.params;
  const admin = createSupabaseAdminClient();
  const requestRow = await admin
    .from("student_checkin_requests")
    .select("student_profile_id")
    .eq("id", id)
    .eq("status", "pending")
    .maybeSingle();
  if (requestRow.error || !requestRow.data) {
    return NextResponse.json({ ok: false, error: "這筆報到已處理或不存在。" }, { status: 409 });
  }

  const profileId = requestRow.data.student_profile_id;
  const photoPath = `${profileId}/${crypto.randomUUID()}.${extension}`;
  const upload = await admin.storage.from(STUDENT_PHOTO_BUCKET).upload(photoPath, photo, {
    contentType: photo.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (upload.error) {
    return NextResponse.json({ ok: false, error: "照片上傳失敗，請重新拍攝。" }, { status: 500 });
  }

  const saved = await admin
    .from("student_line_profiles")
    .update({ photo_path: photoPath, updated_at: new Date().toISOString() })
    .eq("id", profileId)
    .is("photo_path", null)
    .select("id")
    .maybeSingle();
  if (saved.error || !saved.data) {
    await admin.storage.from(STUDENT_PHOTO_BUCKET).remove([photoPath]);
    return NextResponse.json({ ok: false, error: "照片已建立，確認後不能再更換。" }, { status: 409 });
  }

  const signed = await admin.storage.from(STUDENT_PHOTO_BUCKET).createSignedUrl(photoPath, 10 * 60);
  if (signed.error || !signed.data?.signedUrl) {
    return NextResponse.json({ ok: false, error: "照片已儲存，請重新整理後繼續。" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, photoUrl: signed.data.signedUrl });
}
