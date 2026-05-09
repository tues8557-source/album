/* eslint-disable @next/next/no-img-element */
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { restorePhoto } from "@/app/actions";
import { TrashEmptyForm } from "@/app/classes/[classNo]/groups/[groupId]/trash/trash-empty-form";
import { getClassGroups, getGroup, getPhotos } from "@/lib/data";
import { groupName, koDate } from "@/lib/format";
import { photoAssetUrl } from "@/lib/photo-assets";
import { hasValidGroupAccessToken, readSignedToken } from "@/lib/security";

export const dynamic = "force-dynamic";

function staleGroupHomePath(classNo: number, groupId: string) {
  const params = new URLSearchParams({
    classNo: String(classNo),
    staleGroupId: groupId,
  });

  return `/?${params.toString()}`;
}

async function getGroupAccessState(
  groupId: string,
  passwordHash: string | null,
  accessNonce: string | null,
  access: string,
) {
  if (!passwordHash) {
    return "granted" as const;
  }

  const store = await cookies();
  const admin = readSignedToken(store.get("album_admin")?.value) === "admin";
  if (admin) {
    return "granted" as const;
  }

  if (!access) {
    return "prompt" as const;
  }

  return hasValidGroupAccessToken(access, groupId, accessNonce)
    ? "granted" as const
    : "stale" as const;
}

export default async function TrashPage({
  params,
  searchParams,
}: {
  params: Promise<{ classNo: string; groupId: string }>;
  searchParams: Promise<{ access?: string }>;
}) {
  const { classNo: classNoParam, groupId } = await params;
  const { access = "" } = await searchParams;
  const classNo = Number.parseInt(classNoParam, 10);
  const group = await getGroup(groupId);

  if (!group || group.class_no !== classNo) {
    notFound();
  }

  const accessState = await getGroupAccessState(
    groupId,
    group.password_hash,
    group.access_nonce,
    access,
  );

  if (accessState === "stale") {
    redirect(staleGroupHomePath(classNo, groupId));
  }

  if (accessState === "prompt") {
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
            <Link href={`/classes/${classNo}/groups/${groupId}?access=${encodeURIComponent(access)}`} className="text-sm font-medium text-teal-700">
              앨범으로
            </Link>
            <h1 className="mt-1 text-3xl font-bold">
              {label} 휴지통
            </h1>
          </div>
          {photos.length ? (
            <TrashEmptyForm classNo={classNo} groupId={groupId} access={access} />
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
                    access,
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
                  <input type="hidden" name="access" value={access} />
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
