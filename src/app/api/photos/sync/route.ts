import { cookies } from "next/headers";
import { NextResponse } from "next/server";
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const classNo = Number.parseInt(searchParams.get("classNo") ?? "", 10);
  const groupId = String(searchParams.get("groupId") ?? "").trim();
  const access = String(searchParams.get("access") ?? "").trim();

  if (!classNo || !groupId || !(await canAccessGroup(classNo, groupId, access))) {
    return NextResponse.json({ error: "권한을 확인할 수 없습니다." }, { status: 403 });
  }

  const { data, error } = await createServiceSupabase()
    .from("photos")
    .select("id, group_id, storage_path, original_name, mime_type, size, is_favorite, created_at, deleted_at")
    .eq("group_id", groupId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    photos: (data ?? []).map((photo) => ({
      ...photo,
      is_favorite: Boolean(photo.is_favorite),
    })),
  }, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}
