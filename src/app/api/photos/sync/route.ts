import { NextResponse } from "next/server";
import { getGroupAccessState } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const classNo = Number.parseInt(searchParams.get("classNo") ?? "", 10);
  const groupId = String(searchParams.get("groupId") ?? "").trim();

  if (!classNo || !groupId || !(await getGroupAccessState(classNo, groupId)).allowed) {
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
