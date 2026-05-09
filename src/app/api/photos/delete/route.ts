import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { getGroupAccessState } from "@/lib/auth";
import { activePhotosTag, deletedPhotosTag } from "@/lib/photo-assets";
import { createServiceSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const classNo = Number.parseInt(String(body?.classNo ?? ""), 10);
  const groupId = String(body?.groupId ?? "").trim();
  const photoId = String(body?.photoId ?? "").trim();

  if (!classNo || !groupId || !photoId || !(await getGroupAccessState(classNo, groupId)).allowed) {
    return NextResponse.json({ error: "권한을 확인할 수 없습니다." }, { status: 403 });
  }

  const { error } = await createServiceSupabase()
    .from("photos")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", photoId)
    .eq("group_id", groupId)
    .is("deleted_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidateTag(activePhotosTag(groupId), "max");
  revalidateTag(deletedPhotosTag(groupId), "max");
  revalidatePath(`/classes/${classNo}/groups/${groupId}`);
  revalidatePath(`/classes/${classNo}/groups/${groupId}/trash`);

  return NextResponse.json({ deleted: true });
}
