import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { safeFileName } from "@/lib/format";
import { activePhotosTag, deletedPhotosTag } from "@/lib/photo-assets";
import { hasValidGroupAccessToken, readSignedToken } from "@/lib/security";
import { createServiceSupabase } from "@/lib/supabase/server";

const ALLOWED_EXTENSIONS = /\.(jpe?g|png|gif|webp|heic|heif)$/i;

function isImageFile(file: File) {
  return file.type.startsWith("image/") || ALLOWED_EXTENSIONS.test(file.name);
}

async function canAccessGroup(classNo: number, groupId: string, access: string) {
  const supabase = createServiceSupabase();
  const { data: group, error } = await supabase
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .eq("class_no", classNo)
    .is("deleted_at", null)
    .single();

  if (error || !group) {
    return false;
  }

  const store = await cookies();
  const admin = readSignedToken(store.get("album_admin")?.value) === "admin";
  const groupSession = hasValidGroupAccessToken(access, groupId, group.access_nonce);
  return admin || !group.password_hash || groupSession;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const classNo = Number.parseInt(String(formData.get("classNo") ?? ""), 10);
  const groupId = String(formData.get("groupId") ?? "").trim();
  const access = String(formData.get("access") ?? "").trim();
  const photoId = String(formData.get("photoId") ?? "").trim();
  const file = formData.get("photo");

  if (!classNo || !groupId || !photoId || !(await canAccessGroup(classNo, groupId, access))) {
    return NextResponse.json({ error: "권한을 확인할 수 없습니다." }, { status: 403 });
  }

  if (!(file instanceof File) || file.size <= 0 || !isImageFile(file)) {
    return NextResponse.json({ error: "이미지 파일만 저장할 수 있습니다." }, { status: 400 });
  }

  const supabase = createServiceSupabase();
  const { data: photo, error: photoError } = await supabase
    .from("photos")
    .select("*")
    .eq("id", photoId)
    .eq("group_id", groupId)
    .is("deleted_at", null)
    .single();

  if (photoError || !photo?.storage_path) {
    return NextResponse.json({ error: "사진을 찾을 수 없습니다." }, { status: 404 });
  }

  const originalName = photo.original_name || file.name || `photo-${photoId}`;
  const cleanFileName = safeFileName(originalName) || "photo";
  const storagePath = `${classNo}/${groupId}/${Date.now()}-${randomUUID()}-${cleanFileName}`;

  const { error: uploadError } = await supabase.storage
    .from("group-photos")
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const favoriteRequested = Boolean((photo as { is_favorite?: boolean }).is_favorite);
  const { data: editedPhoto, error: insertError } = await supabase
    .from("photos")
    .insert({
      group_id: groupId,
      storage_path: storagePath,
      original_name: originalName,
      mime_type: file.type || null,
      size: file.size,
      created_at: photo.created_at,
    })
    .select("*")
    .single();

  if (insertError || !editedPhoto) {
    await supabase.storage.from("group-photos").remove([storagePath]);
    return NextResponse.json({ error: insertError?.message ?? "편집한 사진 기록 저장에 실패했습니다." }, { status: 500 });
  }

  let normalizedEditedPhoto = {
    ...editedPhoto,
    is_favorite: Boolean((editedPhoto as { is_favorite?: boolean }).is_favorite),
  };

  if (favoriteRequested) {
    const { error: favoriteError } = await supabase
      .from("photos")
      .update({ is_favorite: true })
      .eq("id", editedPhoto.id)
      .eq("group_id", groupId);

    if (favoriteError && favoriteError.code !== "42703") {
      await supabase.storage.from("group-photos").remove([storagePath]);
      await supabase.from("photos").delete().eq("id", editedPhoto.id).eq("group_id", groupId);
      return NextResponse.json({ error: favoriteError.message }, { status: 500 });
    }

    if (!favoriteError) {
      normalizedEditedPhoto = {
        ...normalizedEditedPhoto,
        is_favorite: true,
      };
    }
  }

  const deletedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("photos")
    .update({ deleted_at: deletedAt })
    .eq("id", photoId)
    .eq("group_id", groupId)
    .is("deleted_at", null);

  if (updateError) {
    await supabase.storage.from("group-photos").remove([storagePath]);
    await supabase.from("photos").delete().eq("id", editedPhoto.id).eq("group_id", groupId);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  revalidateTag(activePhotosTag(groupId), "max");
  revalidateTag(deletedPhotosTag(groupId), "max");
  revalidatePath(`/classes/${classNo}/groups/${groupId}`);
  revalidatePath(`/classes/${classNo}/groups/${groupId}/trash`);
  return NextResponse.json({ saved: true, photo: normalizedEditedPhoto });
}
