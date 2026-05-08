"use client";

export function DeleteConfirmDialog({
  title,
  formId,
  onCancel,
  onConfirm,
  confirmDisabled = false,
}: {
  title: string;
  formId?: string;
  onCancel: () => void;
  onConfirm?: () => void | Promise<void>;
  confirmDisabled?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 px-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${formId}-title`}
        className="w-full max-w-xs rounded-lg bg-white p-5 text-zinc-950 shadow-xl"
      >
        <h2 id={`${formId}-title`} className="text-lg font-bold">
          {title}
        </h2>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type={onConfirm ? "button" : "submit"}
            form={onConfirm ? undefined : formId}
            onClick={onConfirm ? () => void onConfirm() : undefined}
            disabled={confirmDisabled}
            className="rounded-md bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-red-300"
          >
            확인
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
