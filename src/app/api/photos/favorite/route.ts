import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { getGroupAccessState } from "@/lib/auth";
import { activePhotosTag } from "@/lib/photo-assets";
import { createServiceSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const classNo = Number.parseInt(String(body?.classNo ?? ""), 10);
  const groupId = String(body?.groupId ?? "").trim();
  const photoId = String(body?.photoId ?? "").trim();
  const favorite = Boolean(body?.favorite);

  if (!classNo || !groupId || !photoId || !(await getGroupAccessState(classNo, groupId)).allowed) {
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
