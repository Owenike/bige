import crypto from "crypto";
import { NextResponse } from "next/server";
import { ensureStudentDropInEntitlement } from "../../../../../../../lib/student-drop-in";
import {
  requireStudentCheckinAdmin,
  studentCheckinAdminAuthFailure,
} from "../../../../../../../lib/student-checkin-admin-auth";
import { createSupabaseAdminClient } from "../../../../../../../lib/supabase/admin";
import { STUDENT_PHOTO_BUCKET } from "../../../../../../../lib/student-checkin";

const acceptedPhotoTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireStudentCheckinAdmin(request);
  if (!auth.ok) return studentCheckinAdminAuthFailure(auth.response.status);

  const form = await request.formData().catch(() => null);
  const photo = form?.get("photo");
  if (!(photo instanceof File) || photo.size === 0) {
    return NextResponse.json({ ok: false, error: "請上傳五星好評照片。" }, { status: 400 });
  }
  const extension = acceptedPhotoTypes.get(photo.type);
  if (!extension || photo.size > 2 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "照片需為 JPG、PNG 或 WebP，且不可超過 2MB。" }, { status: 400 });
  }

  const { id } = await context.params;
  const admin = createSupabaseAdminClient();
  const requestRow = await admin
    .from("student_drop_in_requests")
    .select("student_profile_id")
    .eq("id", id)
    .eq("status", "pending")
    .maybeSingle();
  if (requestRow.error || !requestRow.data) {
    return NextResponse.json({ ok: false, error: "這筆訪客入場申請已處理或不存在。" }, { status: 409 });
  }

  const profileId = requestRow.data.student_profile_id;
  const entitlement = await ensureStudentDropInEntitlement(profileId);
  if (entitlement.entry_plan === "standard_100") {
    return NextResponse.json({ ok: false, error: "此方案收費 NT$100，不需上傳五星好評照片。" }, { status: 409 });
  }
  if (entitlement.review_photo_path) {
    return NextResponse.json({ ok: false, error: "五星好評照片已存在；請重新整理後繼續。" }, { status: 409 });
  }

  const photoPath = `${profileId}/five-star-review/${crypto.randomUUID()}.${extension}`;
  const upload = await admin.storage.from(STUDENT_PHOTO_BUCKET).upload(photoPath, photo, {
    contentType: photo.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (upload.error) {
    return NextResponse.json({ ok: false, error: "五星好評照片上傳失敗，請重新選擇。" }, { status: 500 });
  }

  const now = new Date().toISOString();
  const saved = await admin
    .from("student_drop_in_entitlements")
    .update({
      review_photo_path: photoPath,
      review_photo_uploaded_at: now,
      review_photo_uploaded_by: auth.context.userId,
      updated_at: now,
    })
    .eq("student_profile_id", profileId)
    .is("review_photo_path", null)
    .select("student_profile_id")
    .maybeSingle();
  if (saved.error || !saved.data) {
    await admin.storage.from(STUDENT_PHOTO_BUCKET).remove([photoPath]);
    return NextResponse.json({ ok: false, error: "五星好評照片已存在；請重新整理後繼續。" }, { status: 409 });
  }

  const signed = await admin.storage.from(STUDENT_PHOTO_BUCKET).createSignedUrl(photoPath, 10 * 60);
  if (signed.error || !signed.data?.signedUrl) {
    return NextResponse.json({ ok: false, error: "五星好評照片已儲存，請重新整理後繼續。" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, reviewPhotoUrl: signed.data.signedUrl });
}
