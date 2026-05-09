"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog, type ConfirmDialogTone } from "@/app/delete-confirm-dialog";

type ConfirmOptions = {
  title: string;
  description?: string;
  requiredText?: string;
  inputLabel?: string | null;
  inputPlaceholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmDialogTone;
};

export function useConfirmDialog() {
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);

  const close = useCallback((confirmed: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    resolver?.(confirmed);
  }, []);

  const confirm = useCallback((nextOptions: ConfirmOptions) => {
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }

    setOptions(nextOptions);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (resolverRef.current) {
        resolverRef.current(false);
        resolverRef.current = null;
      }
    };
  }, []);

  return {
    confirm,
    confirmDialog: options ? (
      <ConfirmDialog
        key={`${options.title}-${options.description ?? ""}-${options.requiredText ?? ""}`}
        title={options.title}
        description={options.description}
        requiredText={options.requiredText}
        inputLabel={options.inputLabel}
        inputPlaceholder={options.inputPlaceholder}
        confirmLabel={options.confirmLabel}
        cancelLabel={options.cancelLabel}
        tone={options.tone}
        onCancel={() => close(false)}
        onConfirm={() => close(true)}
      />
    ) : null,
  };
}
