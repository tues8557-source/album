import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readSignedToken } from "@/lib/security";
import { createServiceSupabase } from "@/lib/supabase/server";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

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
    return { allowed: false, publicCache: false };
  }

  const store = await cookies();
  const admin = readSignedToken(store.get("album_admin")?.value) === "admin";
  const groupSession = readSignedToken(access) === `group:${groupId}`;
  return {
    allowed: admin || !group.password_hash || groupSession,
    publicCache: !group.password_hash || groupSession,
  };
}

function transformForVariant(variant: string) {
  if (variant === "gallery") {
    return {
      width: 480,
      height: 480,
      resize: "cover" as const,
      quality: 64,
    };
  }

  if (variant === "viewer") {
    return {
      width: 2048,
      height: 2048,
      resize: "contain" as const,
      quality: 82,
    };
  }

  return undefined;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const classNo = Number.parseInt(String(searchParams.get("classNo") ?? ""), 10);
  const groupId = String(searchParams.get("groupId") ?? "").trim();
  const photoId = String(searchParams.get("photoId") ?? "").trim();
  const access = String(searchParams.get("access") ?? "").trim();
  const variant = String(searchParams.get("variant") ?? "full").trim();

  if (!classNo || !groupId || !photoId || !["gallery", "viewer", "full"].includes(variant)) {
    return errorResponse("이미지 요청 정보를 확인할 수 없습니다.");
  }

  const accessState = await canAccessGroup(classNo, groupId, access);
  if (!accessState.allowed) {
    return errorResponse("권한을 확인할 수 없습니다.", 403);
  }

  const supabase = createServiceSupabase();
  const { data: photo, error: photoError } = await supabase
    .from("photos")
    .select("id, storage_path, mime_type")
    .eq("id", photoId)
    .eq("group_id", groupId)
    .single();

  if (photoError || !photo?.storage_path) {
    return errorResponse("사진을 찾을 수 없습니다.", 404);
  }

  const transform = transformForVariant(variant);
  const { data, error } = await supabase.storage
    .from("group-photos")
    .download(photo.storage_path, transform ? { transform } : undefined);

  if (error || !data) {
    return errorResponse(error?.message ?? "이미지를 불러오지 못했습니다.", 404);
  }

  return new Response(data, {
    headers: {
      "Cache-Control": accessState.publicCache
        ? "public, max-age=31536000, immutable"
        : "private, max-age=31536000, immutable",
      "Content-Length": String(data.size),
      "Content-Type": data.type || photo.mime_type || "application/octet-stream",
      ETag: `"${photo.id}-${variant}"`,
      ...(accessState.publicCache ? {} : { Vary: "Cookie" }),
    },
  });
}
