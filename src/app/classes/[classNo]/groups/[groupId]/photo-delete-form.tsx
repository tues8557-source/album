"use client";

import { useRef } from "react";
import { softDeletePhoto } from "@/app/actions";
import { useConfirmDialog } from "@/lib/use-confirm-dialog";

export function PhotoDeleteForm({
  classNo,
  groupId,
  photoId,
}: {
  classNo: number;
  groupId: string;
  photoId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  async function handleDeleteClick() {
    const confirmed = await confirm({
      title: "이 사진을 삭제할까요?",
      confirmLabel: "삭제",
      tone: "danger",
    });

    if (!confirmed) {
      return;
    }

    formRef.current?.requestSubmit();
  }

  return (
    <>
      <form
        ref={formRef}
        action={softDeletePhoto}
        suppressHydrationWarning
      >
        <input type="hidden" name="classNo" value={classNo} />
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="photoId" value={photoId} />
        <button
          type="button"
          onClick={() => void handleDeleteClick()}
          className="w-full rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
        >
          삭제
        </button>
      </form>
      {confirmDialog}
    </>
  );
}
