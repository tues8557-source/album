import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { activePhotosTag } from "@/lib/photo-assets";
import { hasValidGroupAccessToken, readSignedToken } from "@/lib/security";
import { createServiceSupabase } from "@/lib/supabase/server";

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
  const body = await request.json().catch(() => null);
  const classNo = Number.parseInt(String(body?.classNo ?? ""), 10);
  const groupId = String(body?.groupId ?? "").trim();
  const access = String(body?.access ?? "").trim();
  const photoId = String(body?.photoId ?? "").trim();
  const favorite = Boolean(body?.favorite);

  if (!classNo || !groupId || !photoId || !(await canAccessGroup(classNo, groupId, access))) {
    return NextResponse.json({ error: "권한을 확인할 수 없습니다." }, { status: 403 });
  }

  const { error } = await createServiceSupabase()
    .from("photos")
    .update({ is_favorite: favorite })
    .eq("id", photoId)
    .eq("group_id", groupId)
    .is("deleted_at", null);

  if (error) {
    const message = error.code === "42703"
      ? "즐겨찾기 기능을 사용하려면 photos 테이블에 is_favorite 컬럼을 추가해야 합니다."
      : error.message;
    return NextResponse.json({ error: message }, { status: 500 });
  }

  revalidateTag(activePhotosTag(groupId), "max");
  revalidatePath(`/classes/${classNo}/groups/${groupId}`);

  return NextResponse.json({ saved: true, favorite });
}
