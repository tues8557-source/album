import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { safeFileName } from "@/lib/format";
import { activePhotosTag } from "@/lib/photo-assets";
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

  if (!classNo || !groupId || !(await canAccessGroup(classNo, groupId, access))) {
    return NextResponse.json({ error: "권한을 확인할 수 없습니다." }, { status: 403 });
  }

  const files = formData
    .getAll("photo")
    .filter((file): file is File => file instanceof File && file.size > 0);

  if (!files.length || files.some((file) => !isImageFile(file))) {
    return NextResponse.json({ error: "이미지 파일만 업로드할 수 있습니다." }, { status: 400 });
  }

  const supabase = createServiceSupabase();
  const rows = [];

  for (const file of files) {
    const fileName = safeFileName(file.name) || "photo";
    const storagePath = `${classNo}/${groupId}/${Date.now()}-${randomUUID()}-${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from("group-photos")
      .upload(storagePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    rows.push({
      group_id: groupId,
      storage_path: storagePath,
      original_name: file.name,
      mime_type: file.type || null,
      size: file.size,
    });
  }

  const { error } = await supabase.from("photos").insert(rows);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidateTag(activePhotosTag(groupId), "max");
  revalidatePath(`/classes/${classNo}/groups/${groupId}`);
  return NextResponse.json({ uploaded: rows.length });
}
