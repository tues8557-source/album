"use client";

import { softDeletePhoto } from "@/app/actions";

export function PhotoDeleteForm({
  classNo,
  groupId,
  photoId,
  access,
}: {
  classNo: number;
  groupId: string;
  photoId: string;
  access: string;
}) {
  return (
    <form
      action={softDeletePhoto}
      onSubmit={(event) => {
        if (!window.confirm("이 사진을 삭제할까요?")) {
          event.preventDefault();
        }
      }}
      suppressHydrationWarning
    >
      <input type="hidden" name="classNo" value={classNo} />
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="photoId" value={photoId} />
      <input type="hidden" name="access" value={access} />
      <button className="w-full rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
        삭제
      </button>
    </form>
  );
}
