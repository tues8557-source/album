import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getGroupAccessState } from "@/lib/auth";
import { safeFileName } from "@/lib/format";
import { createServiceSupabase } from "@/lib/supabase/server";

const ALLOWED_EXTENSIONS = /\.(jpe?g|png|gif|webp|heic|heif)$/i;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function isImageFile(fileName: string, mimeType: string) {
  return mimeType.startsWith("image/") || ALLOWED_EXTENSIONS.test(fileName);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const classNo = Number.parseInt(String(body.classNo ?? ""), 10);
    const groupId = String(body.groupId ?? "").trim();
    const fileName = String(body.fileName ?? "").trim();
    const mimeType = String(body.mimeType ?? "").trim();

    if (!classNo || !groupId || !(await getGroupAccessState(classNo, groupId)).allowed) {
      return jsonError("그룹 접근 권한을 확인할 수 없습니다.", 403);
    }

    if (!fileName || !isImageFile(fileName, mimeType)) {
      return jsonError(`${fileName || "선택한 파일"}은 이미지 파일이 아닙니다.`);
    }

    const cleanFileName = safeFileName(fileName) || "photo";
    const storagePath = `${classNo}/${groupId}/${Date.now()}-${randomUUID()}-${cleanFileName}`;
    const { data, error } = await createServiceSupabase()
      .storage
      .from("group-photos")
      .createSignedUploadUrl(storagePath);

    if (error || !data?.signedUrl) {
      return jsonError(`업로드 주소를 만들 수 없습니다: ${error?.message ?? "알 수 없는 오류"}`, 500);
    }

    return NextResponse.json({
      signedUrl: data.signedUrl,
      storagePath,
    });
  } catch (error) {
    return jsonError(
      `업로드 준비 중 오류가 발생했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
      500,
    );
  }
}
