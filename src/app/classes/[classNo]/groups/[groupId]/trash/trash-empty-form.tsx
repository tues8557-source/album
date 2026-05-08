"use client";

import { useState } from "react";
import { emptyPhotoTrash } from "@/app/actions";
import { DeleteConfirmDialog } from "@/app/delete-confirm-dialog";

export function TrashEmptyForm({
  classNo,
  groupId,
  access,
}: {
  classNo: number;
  groupId: string;
  access: string;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const formId = `trash-empty-${groupId}`;

  return (
    <>
      <form
        id={formId}
        action={emptyPhotoTrash}
        suppressHydrationWarning
      >
        <input type="hidden" name="classNo" value={classNo} />
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="access" value={access} />
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="whitespace-nowrap rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
        >
          휴지통 비우기
        </button>
      </form>
      {dialogOpen ? (
        <DeleteConfirmDialog
          title="휴지통의 모든 사진을 영구 삭제할까요?"
          formId={formId}
          onCancel={() => setDialogOpen(false)}
        />
      ) : null}
    </>
  );
}
