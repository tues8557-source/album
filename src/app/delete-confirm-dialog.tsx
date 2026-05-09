"use client";

import { useId, useState } from "react";

export type ConfirmDialogTone = "danger" | "default";

type ConfirmDialogProps = {
  title: string;
  description?: string;
  formId?: string;
  onCancel: () => void;
  onConfirm?: () => void | Promise<void>;
  confirmDisabled?: boolean;
  requiredText?: string;
  inputLabel?: string | null;
  inputPlaceholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmDialogTone;
};

export function ConfirmDialog({
  title,
  description,
  formId,
  onCancel,
  onConfirm,
  confirmDisabled = false,
  requiredText,
  inputLabel = "확인 문구 입력",
  inputPlaceholder,
  confirmLabel = "확인",
  cancelLabel = "취소",
  tone = "default",
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const [inputValue, setInputValue] = useState("");
  const confirmButtonClass =
    tone === "danger"
      ? "bg-red-600 text-white disabled:bg-red-300"
      : "bg-zinc-900 text-white disabled:bg-zinc-300";
  const matchRequired = typeof requiredText === "string" && requiredText.length > 0;
  const isConfirmDisabled = confirmDisabled || (matchRequired && inputValue !== requiredText);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 px-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="w-full max-w-xs rounded-lg bg-white p-5 text-zinc-950 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-bold">
          {title}
        </h2>
        {description ? (
          <p id={descriptionId} className="mt-2 whitespace-pre-line text-sm text-zinc-600">
            {description}
          </p>
        ) : null}
        {matchRequired ? (
          <div className="mt-4">
            {inputLabel ? (
              <label htmlFor={inputId} className="mb-2 block text-sm font-semibold text-zinc-700">
                {inputLabel}
              </label>
            ) : null}
            <input
              id={inputId}
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder={inputPlaceholder ?? requiredText}
              className="min-h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-500"
            />
          </div>
        ) : null}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type={onConfirm ? "button" : "submit"}
            form={onConfirm ? undefined : formId}
            onClick={onConfirm ? () => void onConfirm() : undefined}
            disabled={isConfirmDisabled}
            className={`rounded-md px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed ${confirmButtonClass}`}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeleteConfirmDialog(props: Omit<ConfirmDialogProps, "tone">) {
  return <ConfirmDialog {...props} tone="danger" />;
}
