"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

const ALLOWED_EXTENSIONS = /\.(jpe?g|png|gif|webp|heic|heif)$/i;

type UploadState = "idle" | "uploading" | "done" | "error";
type UploadUrlResponse = {
  signedUrl: string;
  storagePath: string;
};

function isImageFile(file: File) {
  return file.type.startsWith("image/") || ALLOWED_EXTENSIONS.test(file.name);
}

function sizeLabel(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }

  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }

  return `${bytes}B`;
}

async function readErrorMessage(response: Response, fallback: string) {
  const text = await response.text();

  if (!text) {
    return `${fallback} (HTTP ${response.status})`;
  }

  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return `${parsed.error || parsed.message || fallback} (HTTP ${response.status})`;
  } catch {
    return `${fallback}: ${text.slice(0, 180)} (HTTP ${response.status})`;
  }
}

async function prepareUpload({
  classNo,
  groupId,
  access,
  file,
}: {
  classNo: number;
  groupId: string;
  access: string;
  file: File;
}) {
  const response = await fetch("/api/photos/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      classNo,
      groupId,
      access,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `${file.name} 업로드 준비 실패`));
  }

  return (await response.json()) as UploadUrlResponse;
}

async function recordUpload({
  classNo,
  groupId,
  access,
  file,
  storagePath,
}: {
  classNo: number;
  groupId: string;
  access: string;
  file: File;
  storagePath: string;
}) {
  const response = await fetch("/api/photos/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      classNo,
      groupId,
      access,
      photo: {
        storagePath,
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `${file.name} 사진 기록 저장 실패`));
  }
}

function uploadFileToSignedUrl({
  file,
  signedUrl,
  uploadedBytes,
  totalBytes,
  onProgress,
}: {
  file: File;
  signedUrl: string;
  uploadedBytes: number;
  totalBytes: number;
  onProgress: (progress: number) => void;
}) {
  return new Promise<void>((resolve, reject) => {
    const formData = new FormData();
    formData.append("cacheControl", "3600");
    formData.append("", file);

    const request = new XMLHttpRequest();
    request.open("PUT", signedUrl);
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || !totalBytes) {
        return;
      }

      const fileProgress = Math.min(1, event.loaded / event.total);
      onProgress(Math.round(((uploadedBytes + file.size * fileProgress) / totalBytes) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(Math.round(((uploadedBytes + file.size) / totalBytes) * 100));
        resolve();
        return;
      }

      try {
        const parsed = JSON.parse(request.responseText) as { error?: string; message?: string };
        reject(new Error(`${parsed.error || parsed.message || "스토리지 업로드 실패"} (HTTP ${request.status})`));
      } catch {
        reject(new Error(`스토리지 업로드 실패: ${request.responseText.slice(0, 180) || "응답 없음"} (HTTP ${request.status})`));
      }
    };
    request.onerror = () => reject(new Error("업로드 중 네트워크 오류가 발생했습니다."));
    request.send(formData);
  });
}

export function PhotoUploadForm({
  classNo,
  groupId,
  access,
}: {
  classNo: number;
  groupId: string;
  access: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const inputId = `photo-upload-${groupId}`;

  function selectedFilesLabel(files: File[]) {
    if (!files.length) {
      return "선택한 파일 없음";
    }

    if (files.length === 1) {
      return files[0].name;
    }

    return `${files[0].name} 외 ${files.length - 1}개`;
  }

  function handleFileChange() {
    const files = Array.from(inputRef.current?.files ?? []);
    setSelectedFiles(files);

    if (uploadState !== "idle") {
      setUploadState("idle");
      setMessage("");
      setProgress(0);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const files = Array.from(inputRef.current?.files ?? []);
    if (!files.length) {
      setUploadState("error");
      setMessage("업로드할 사진을 선택하세요.");
      return;
    }

    if (files.some((file) => !isImageFile(file))) {
      setUploadState("error");
      setMessage("이미지 파일만 업로드할 수 있습니다.");
      return;
    }

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    let uploadedBytes = 0;
    let uploadedCount = 0;

    setUploadState("uploading");
    setProgress(0);
    setMessage(`0/${files.length}개 업로드 중 (${sizeLabel(totalBytes)})`);

    try {
      for (const file of files) {
        setMessage(`${uploadedCount}/${files.length}개 업로드 중: ${file.name} (${sizeLabel(file.size)})`);
        const { signedUrl, storagePath } = await prepareUpload({
          classNo,
          groupId,
          access,
          file,
        });
        await uploadFileToSignedUrl({
          file,
          signedUrl,
          uploadedBytes,
          totalBytes,
          onProgress: setProgress,
        });
        await recordUpload({
          classNo,
          groupId,
          access,
          file,
          storagePath,
        });
        uploadedBytes += file.size;
        uploadedCount += 1;
      }

      setUploadState("done");
      setProgress(100);
      setMessage(`${files.length}개 사진 업로드 완료`);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
      setSelectedFiles([]);
      router.refresh();
    } catch (error) {
      setUploadState("error");
      setMessage(
        `${uploadedCount}/${files.length}개 업로드 후 실패: ${
          error instanceof Error ? error.message : "알 수 없는 오류"
        }`,
      );
    }
  }

  const isUploading = uploadState === "uploading";

  return (
    <form onSubmit={handleSubmit} className="mt-3 grid gap-3" suppressHydrationWarning>
      <input
        id={inputId}
        ref={inputRef}
        name="photo"
        type="file"
        accept=".jpg,.jpeg,.png,.gif,.webp,.heic,.heif,image/*"
        multiple
        disabled={isUploading}
        onChange={handleFileChange}
        className="sr-only"
      />
      <div className={`flex min-h-11 w-full min-w-0 items-center gap-4 rounded-md border border-zinc-300 bg-white px-3 py-2 ${
        isUploading ? "bg-zinc-100" : ""
      }`}>
        <label
          htmlFor={inputId}
          className={`inline-flex shrink-0 cursor-pointer items-center rounded-md border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-sm font-medium text-zinc-800 ${
            isUploading ? "pointer-events-none opacity-55" : ""
          }`}
        >
          파일 선택
        </label>
        <p className={`min-w-0 truncate text-sm ${selectedFiles.length ? "text-zinc-700" : "text-zinc-500"}`}>
          {selectedFilesLabel(selectedFiles)}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full bg-teal-600 transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <button
          disabled={isUploading}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {isUploading ? "업로드 중" : "업로드"}
        </button>
      </div>
      {message ? (
        <p className={`text-sm ${uploadState === "error" ? "text-red-600" : "text-zinc-600"}`}>
          {message}
        </p>
      ) : null}
    </form>
  );
}
