import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { activePhotosTag, deletedPhotosTag } from "@/lib/photo-assets";
import { readSignedToken } from "@/lib/security";
import { createServiceSupabase } from "@/lib/supabase/server";

async function canAccessGroup(classNo: number, groupId: string, access: string) {
  const supabase = createServiceSupabase();
  const { data: group, error } = await supabase
    .from("groups")
    .select("password_hash")
    .eq("id", groupId)
    .eq("class_no", classNo)
    .is("deleted_at", null)
    .single();

  if (error || !group) {
    return false;
  }

  const store = await cookies();
  const admin = readSignedToken(store.get("album_admin")?.value) === "admin";
  const groupSession = readSignedToken(access) === `group:${groupId}`;
  return admin || !group.password_hash || groupSession;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const classNo = Number.parseInt(String(body?.classNo ?? ""), 10);
  const groupId = String(body?.groupId ?? "").trim();
  const access = String(body?.access ?? "").trim();
  const photoId = String(body?.photoId ?? "").trim();

  if (!classNo || !groupId || !photoId || !(await canAccessGroup(classNo, groupId, access))) {
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
