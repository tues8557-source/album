import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PhotoGallery } from "@/app/classes/[classNo]/groups/[groupId]/photo-gallery";
import { PhotoUploadForm } from "@/app/classes/[classNo]/groups/[groupId]/photo-upload-form";
import { getClassGroups, getGroup, getGroupMembers, getPhotos } from "@/lib/data";
import { genderClass, groupName } from "@/lib/format";
import { readSignedToken } from "@/lib/security";

export const dynamic = "force-dynamic";

async function hasGroupAccess(groupId: string, passwordHash: string | null, access: string) {
  if (!passwordHash) {
    return true;
  }

  const store = await cookies();
  const admin = readSignedToken(store.get("album_admin")?.value) === "admin";
  const group = readSignedToken(access) === `group:${groupId}`;
  return admin || group;
}

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ classNo: string; groupId: string }>;
  searchParams: Promise<{ error?: string; access?: string }>;
}) {
  const { classNo: classNoParam, groupId } = await params;
  const { error, access = "" } = await searchParams;
  const classNo = Number.parseInt(classNoParam, 10);
  const group = await getGroup(groupId);

  if (!group || group.class_no !== classNo) {
    notFound();
  }

  const { groups } = await getClassGroups(classNo);
  const currentGroup = groups.find((item) => item.id === groupId);
  const label = currentGroup ? groupName(classNo, Math.max(0, currentGroup.sort_order - 1)) : "그룹";
  const canView = await hasGroupAccess(groupId, group.password_hash, access);

  if (!canView) {
    return (
      <main className="min-h-screen bg-stone-50 px-4 py-8 text-zinc-950">
        <section className="mx-auto max-w-sm rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <Link href={`/?classNo=${classNo}`} className="text-sm font-medium text-teal-700">
            홈으로
          </Link>
          <h1 className="mt-2 text-2xl font-bold">
            {label}
          </h1>
          {error ? <p className="mt-2 text-sm text-red-600">그룹 비밀번호를 확인하세요.</p> : null}
          <Link
            href={`/?classNo=${classNo}&errorGroupId=${groupId}`}
            className="mt-5 block rounded-md bg-zinc-900 px-4 py-3 text-center text-sm font-semibold text-white"
          >
            비밀번호 입력하기
          </Link>
        </section>
      </main>
    );
  }

  const [members, photos] = await Promise.all([getGroupMembers(groupId), getPhotos(groupId, false)]);

  return (
    <main className="min-h-screen overflow-x-hidden bg-stone-50 px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto grid w-full min-w-0 max-w-5xl gap-5">
        <header className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/?classNo=${classNo}`} className="text-sm font-medium text-teal-700">
              홈으로
            </Link>
            <h1 className="mt-1 text-3xl font-bold">
              {label}
            </h1>
            <div className="mt-3 flex flex-wrap gap-2">
              {members.map((member) =>
                member.students ? (
                  <span
                    key={member.id}
                    className={`rounded-md px-2.5 py-1 text-sm font-semibold ring-1 ${genderClass(
                      member.students.gender,
                    )}`}
                  >
                    {member.students.name}
                  </span>
                ) : null,
              )}
            </div>
          </div>
          <Link
            href={`/classes/${classNo}/groups/${groupId}/trash?access=${encodeURIComponent(access)}`}
            className="shrink-0 whitespace-nowrap rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            휴지통
          </Link>
        </header>

        <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-xl font-bold">사진 올리기</h2>
          {error === "bad-photo" ? (
            <p className="mt-2 text-sm text-red-600">이미지 파일만 업로드할 수 있습니다.</p>
          ) : null}
          <PhotoUploadForm classNo={classNo} groupId={groupId} access={access} />
        </section>

        {photos.length ? (
          <PhotoGallery classNo={classNo} groupId={groupId} access={access} photos={photos} />
        ) : (
          <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-5 text-center text-sm text-zinc-500">
            아직 사진이 없습니다.
          </p>
        )}
      </div>
    </main>
  );
}
