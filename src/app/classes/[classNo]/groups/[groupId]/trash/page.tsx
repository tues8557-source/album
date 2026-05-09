/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { restorePhoto } from "@/app/actions";
import { TrashEmptyForm } from "@/app/classes/[classNo]/groups/[groupId]/trash/trash-empty-form";
import { getGroupAccessState } from "@/lib/auth";
import { getClassGroups, getPhotos } from "@/lib/data";
import { groupName, koDate } from "@/lib/format";
import { photoAssetUrl } from "@/lib/photo-assets";

export const dynamic = "force-dynamic";

function staleGroupHomePath(classNo: number, groupId: string) {
  const params = new URLSearchParams({
    classNo: String(classNo),
    staleGroupId: groupId,
  });

  return `/?${params.toString()}`;
}

export default async function TrashPage({
  params,
}: {
  params: Promise<{ classNo: string; groupId: string }>;
}) {
  const { classNo: classNoParam, groupId } = await params;
  const classNo = Number.parseInt(classNoParam, 10);
  const accessState = await getGroupAccessState(classNo, groupId);
  const group = accessState.group;

  if (!group || group.class_no !== classNo) {
    notFound();
  }

  if (accessState.stale) {
    redirect(staleGroupHomePath(classNo, groupId));
  }

  if (accessState.prompt) {
    redirect(`/classes/${classNo}/groups/${groupId}`);
  }

  const [{ groups }, photos] = await Promise.all([
    getClassGroups(classNo),
    getPhotos(groupId, true),
  ]);
  const currentGroup = groups.find((item) => item.id === groupId);
  const label = currentGroup ? groupName(classNo, Math.max(0, currentGroup.sort_order - 1)) : "그룹";
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto grid max-w-5xl gap-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <Link href={`/classes/${classNo}/groups/${groupId}`} className="text-sm font-medium text-teal-700">
              앨범으로
            </Link>
            <h1 className="mt-1 text-3xl font-bold">
              {label} 휴지통
            </h1>
          </div>
          {photos.length ? (
            <TrashEmptyForm classNo={classNo} groupId={groupId} />
          ) : null}
        </header>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo) => (
            <article
              key={photo.id}
              className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm"
            >
              {photo.id ? (
                <img
                  src={photoAssetUrl({
                    classNo,
                    groupId,
                    photoId: photo.id,
                    variant: "gallery",
                  })}
                  alt={photo.original_name ?? "deleted photo"}
                  loading="lazy"
                  decoding="async"
                  className="aspect-square w-full object-cover opacity-70"
                />
              ) : (
                <div className="aspect-square bg-zinc-100" />
              )}
              <div className="grid gap-2 p-3">
                <p className="truncate text-sm font-semibold">{photo.original_name ?? "사진"}</p>
                <p className="text-xs text-zinc-500">삭제됨 {photo.deleted_at ? koDate(photo.deleted_at) : ""}</p>
                <form action={restorePhoto}>
                  <input type="hidden" name="classNo" value={classNo} />
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="photoId" value={photo.id} />
                  <button className="w-full rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white">
                    복구
                  </button>
                </form>
              </div>
            </article>
          ))}
        </section>

        {!photos.length ? (
          <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-5 text-center text-sm text-zinc-500">
            휴지통이 비어 있습니다.
          </p>
        ) : null}
      </div>
    </main>
  );
}
