import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { getGroupAccessState } from "@/lib/auth";
import { activePhotosTag } from "@/lib/photo-assets";
import { createServiceSupabase } from "@/lib/supabase/server";

type UploadedPhoto = {
  storagePath: string;
  originalName: string;
  mimeType: string;
  size: number;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const classNo = Number.parseInt(String(body.classNo ?? ""), 10);
    const groupId = String(body.groupId ?? "").trim();
    const photo = body.photo as Partial<UploadedPhoto> | undefined;

    if (!classNo || !groupId || !(await getGroupAccessState(classNo, groupId)).allowed) {
      return jsonError("그룹 접근 권한을 확인할 수 없습니다.", 403);
    }

    if (!photo?.storagePath || !photo.originalName) {
      return jsonError("업로드된 사진 정보를 확인할 수 없습니다.");
    }

    const { error } = await createServiceSupabase()
      .from("photos")
      .insert({
        group_id: groupId,
        storage_path: photo.storagePath,
        original_name: photo.originalName,
        mime_type: photo.mimeType || null,
        size: photo.size || null,
      });

    if (error) {
      return jsonError(`사진 기록 저장 실패: ${error.message}`, 500);
    }

    revalidateTag(activePhotosTag(groupId), "max");
    revalidatePath(`/classes/${classNo}/groups/${groupId}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(
      `사진 기록 저장 중 오류가 발생했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
      500,
    );
  }
}
