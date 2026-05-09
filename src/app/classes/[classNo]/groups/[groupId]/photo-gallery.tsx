"use client";

/* eslint-disable @next/next/no-img-element */
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { softDeletePhotos } from "@/app/actions";
import { DeleteConfirmDialog } from "@/app/delete-confirm-dialog";
import { DownloadIcon, HeartIcon, RotateIcon, TrashIcon } from "@/app/ui/icons";
import { formatFileSize, koDate } from "@/lib/format";
import { photoAssetUrl, type PhotoAssetVariant } from "@/lib/photo-assets";
import type { Photo } from "@/lib/types";

type PhotoWithUrl = Photo & {
  url?: string;
};

type EditedPhotoResponse = {
  saved?: boolean;
  photo?: Photo;
  error?: string;
};

type DeletePhotoResponse = {
  deleted?: boolean;
  error?: string;
};

type FavoritePhotoResponse = {
  saved?: boolean;
  favorite?: boolean;
  error?: string;
};

type SyncPhotosResponse = {
  photos?: Photo[];
  error?: string;
};

type ViewerHistoryState = {
  __albumViewer?: {
    key: string;
    index: number;
  };
};

type ViewerTransform = {
  scale: number;
  x: number;
  y: number;
};

type PointerPoint = {
  x: number;
  y: number;
};

type MobileArrowSide = "left" | "right" | null;

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CropHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

type Size = {
  width: number;
  height: number;
};

type ImageBounds = Size & {
  x: number;
  y: number;
  renderedRatio: number;
};

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const MIN_CROP_SIZE = 56;
const MOBILE_ARROW_HIDE_DELAY = 2000;
const PHOTOS_PER_PAGE = 20;
const MAX_EDIT_DIMENSION = 2560;
const MAX_EDIT_PIXELS = 6_500_000;
const PHOTO_SYNC_INTERVAL = 2000;
const viewerPrefetchCache = new Map<string, Promise<void>>();

type NetworkInfo = {
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
  };
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function blobType(mimeType: string | null) {
  if (mimeType === "image/png" || mimeType === "image/webp") {
    return mimeType;
  }

  return "image/jpeg";
}

async function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string | null) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("이미지를 저장할 수 없습니다."));
        }
      },
      blobType(mimeType),
      0.92,
    );
  });
}

function drawCoverImage(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  source: { x: number; y: number; width: number; height: number },
  outputWidth: number,
  outputHeight: number,
) {
  context.drawImage(
    image,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    outputWidth,
    outputHeight,
  );
}

function fitSizeWithinLimit(width: number, height: number) {
  let scale = 1;
  const longestSide = Math.max(width, height);

  if (longestSide > MAX_EDIT_DIMENSION) {
    scale = Math.min(scale, MAX_EDIT_DIMENSION / longestSide);
  }

  const scaledPixels = width * height * scale * scale;
  if (scaledPixels > MAX_EDIT_PIXELS) {
    scale = Math.min(scale, Math.sqrt(MAX_EDIT_PIXELS / (width * height)));
  }

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function prepareCanvasContext(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  mimeType: string | null,
) {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  if (blobType(mimeType) === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    return;
  }

  context.clearRect(0, 0, width, height);
}

function canvasLooksUniform(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context || !canvas.width || !canvas.height) {
    return true;
  }

  const samplePoints = [
    [0.15, 0.15],
    [0.5, 0.15],
    [0.85, 0.15],
    [0.15, 0.5],
    [0.5, 0.5],
    [0.85, 0.5],
    [0.15, 0.85],
    [0.5, 0.85],
    [0.85, 0.85],
  ] as const;

  let firstSample = "";

  for (const [xRatio, yRatio] of samplePoints) {
    const x = Math.max(0, Math.min(canvas.width - 1, Math.round((canvas.width - 1) * xRatio)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.round((canvas.height - 1) * yRatio)));
    const data = context.getImageData(x, y, 1, 1).data;
    const sample = `${data[0]}-${data[1]}-${data[2]}-${data[3]}`;

    if (!firstSample) {
      firstSample = sample;
      continue;
    }

    if (sample !== firstSample) {
      return false;
    }
  }

  return true;
}

function sortPhotosLatestFirst<T extends Photo>(photos: T[]) {
  return [...photos].sort(
    (first, second) =>
      new Date(second.created_at).getTime() - new Date(first.created_at).getTime(),
  );
}

function isFavoritePhoto(photo: { is_favorite?: boolean | null }) {
  return Boolean(photo.is_favorite);
}

function staleGroupHomePath(classNo: number, groupId: string) {
  const params = new URLSearchParams({
    classNo: String(classNo),
    staleGroupId: groupId,
  });

  return `/?${params.toString()}`;
}

function viewerHistoryKeyForGroup(classNo: number, groupId: string) {
  return `album-viewer:${classNo}:${groupId}`;
}

function readViewerHistoryState(state: unknown) {
  if (!state || typeof state !== "object") {
    return null;
  }

  const candidate = state as ViewerHistoryState;
  if (!candidate.__albumViewer) {
    return null;
  }

  return candidate.__albumViewer;
}

function normalizePhotoPayload(photo: Partial<Photo> & Record<string, unknown>) {
  const numericSize = typeof photo.size === "number"
    ? photo.size
    : typeof photo.size === "string"
      ? Number(photo.size)
      : null;

  return {
    id: String(photo.id ?? ""),
    group_id: String(photo.group_id ?? ""),
    storage_path: String(photo.storage_path ?? ""),
    original_name: typeof photo.original_name === "string" ? photo.original_name : null,
    mime_type: typeof photo.mime_type === "string" ? photo.mime_type : null,
    size: numericSize !== null && Number.isFinite(numericSize) ? numericSize : null,
    is_favorite: Boolean(photo.is_favorite),
    created_at: typeof photo.created_at === "string" ? photo.created_at : new Date(0).toISOString(),
    deleted_at: typeof photo.deleted_at === "string"
      ? photo.deleted_at
      : photo.deleted_at == null
        ? null
        : String(photo.deleted_at),
  } satisfies Photo;
}

function CropIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.1">
      <path d="M6 3v13.2a1.8 1.8 0 0 0 1.8 1.8H21" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 21V7.8A1.8 1.8 0 0 0 16.2 6H3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M5.2 4.8h11l2.8 2.8v11.2a1.4 1.4 0 0 1-1.4 1.4H6.6a1.4 1.4 0 0 1-1.4-1.4V6.2a1.4 1.4 0 0 1 1.4-1.4Z" strokeLinejoin="round" />
      <path d="M8.2 4.8v5.1h7.1V4.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.8 20.2v-5.4h6.4v5.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.1">
      <path d="M18 6 6 18" strokeLinecap="round" />
      <path d="m6 6 12 12" strokeLinecap="round" />
    </svg>
  );
}

function ViewerPrevIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.25">
      <path d="m14.8 5.8-6.2 6.2 6.2 6.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ViewerNextIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.25">
      <path d="m9.2 5.8 6.2 6.2-6.2 6.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SelectionCheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.6">
      <path d="m3.2 8.2 2.6 2.6 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function imageRouteForPhoto(
  classNo: number,
  groupId: string,
  photoId: string,
  access: string,
  variant: PhotoAssetVariant,
) {
  return photoAssetUrl({
    classNo,
    groupId,
    photoId,
    access,
    variant,
  });
}

function prefetchViewerImage(url: string) {
  if (!url) {
    return Promise.resolve();
  }
  const pending = viewerPrefetchCache.get(url);
  if (pending) {
    return pending;
  }

  const promise = loadImageElement(url)
    .then(() => undefined)
    .finally(() => {
      viewerPrefetchCache.delete(url);
    });

  viewerPrefetchCache.set(url, promise);
  return promise;
}

function loadImageElement(
  url: string,
  signal?: AbortSignal,
) {
  if (!url) {
    return Promise.reject(new Error("이미지 주소가 없습니다."));
  }
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    let settled = false;

    function cleanup() {
      image.onload = null;
      image.onerror = null;
      if (signal) {
        signal.removeEventListener("abort", handleAbort);
      }
    }

    function succeed() {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(image);
    }

    function fail(error: Error) {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    }

    function handleAbort() {
      fail(new DOMException("이미지 요청이 취소되었습니다.", "AbortError"));
    }

    image.onload = () => succeed();
    image.onerror = () => fail(new Error("이미지를 표시할 수 없습니다."));

    if (signal) {
      if (signal.aborted) {
        handleAbort();
        return;
      }

      signal.addEventListener("abort", handleAbort, { once: true });
    }

    image.decoding = "async";
    image.src = url;

    if (image.complete && image.naturalWidth && image.naturalHeight) {
      succeed();
      return;
    }

    if (typeof image.decode === "function") {
      void image.decode().then(() => {
        if (image.naturalWidth && image.naturalHeight) {
          succeed();
        }
      }).catch(() => undefined);
    }
  });
}

function layerStylesFor(
  imageSize: Size | null,
  stageSize: Size | null,
  rotation: number,
  transform: ViewerTransform,
) {
  if (!imageSize || !stageSize?.width || !stageSize.height) {
    return null;
  }

  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const rotatedImageSize =
    normalizedRotation === 90 || normalizedRotation === 270
      ? { width: imageSize.height, height: imageSize.width }
      : imageSize;

  const ratio = Math.min(stageSize.width / rotatedImageSize.width, stageSize.height / rotatedImageSize.height);
  const width = rotatedImageSize.width * ratio;
  const height = rotatedImageSize.height * ratio;

  return {
    containerStyle: {
      width,
      height,
      transform: `translate(-50%, -50%) translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
    },
    imageStyle: {
      width: normalizedRotation === 90 || normalizedRotation === 270 ? height : width,
      height: normalizedRotation === 90 || normalizedRotation === 270 ? width : height,
      transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
    },
  };
}

function shouldPrefetchViewerImages() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const connection = (navigator as Navigator & NetworkInfo).connection;
  if (!connection) {
    return true;
  }

  return !connection.saveData && !String(connection.effectiveType ?? "").includes("2g");
}

function shouldPreferNativePhotoShare() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.matchMedia("(pointer: coarse)").matches;
}

function dataUrlToFile(dataUrl: string, fileName: string) {
  const [header, payload = ""] = dataUrl.split(",");
  const mimeMatch = /data:([^;]+)/.exec(header ?? "");
  const mimeType = mimeMatch?.[1] ?? "application/octet-stream";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], fileName, { type: mimeType });
}

function downloadNameForPhoto(originalName: string | null, index: number, mimeType: string | null) {
  const fallbackExtension =
    mimeType === "image/png"
      ? "png"
      : mimeType === "image/webp"
        ? "webp"
        : "jpg";
  const fallbackName = `photo-${index + 1}.${fallbackExtension}`;

  if (!originalName?.trim()) {
    return fallbackName;
  }

  return originalName.replace(/[\\/:*?"<>|]+/g, "-");
}

function isMobileViewerArrowMode() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.matchMedia("(max-width: 639px)").matches;
}

export function PhotoGallery({
  classNo,
  groupId,
  access,
  photos,
}: {
  classNo: number;
  groupId: string;
  access: string;
  photos: Photo[];
}) {
  const router = useRouter();
  const localPreviewUrls = useRef<Map<string, string>>(new Map());
  const pendingFavoriteValues = useRef<Map<string, boolean>>(new Map());
  const handlingViewerPopState = useRef(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(() => new Set());
  const [pendingFavoritePhotoIds, setPendingFavoritePhotoIds] = useState<Set<string>>(() => new Set());
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [displayPhotos, setDisplayPhotos] = useState<PhotoWithUrl[]>(() =>
    sortPhotosLatestFirst(photos.map((photo) => normalizePhotoPayload(photo))),
  );
  const [pageIndex, setPageIndex] = useState(0);
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);
  const selectedCount = selectedPhotoIds.size;
  const batchFormId = `photo-delete-${groupId}`;
  const totalSize = displayPhotos.reduce((sum, photo) => sum + (photo.size ?? 0), 0);
  const pageCount = Math.max(1, Math.ceil(displayPhotos.length / PHOTOS_PER_PAGE));
  const currentPageIndex = Math.min(pageIndex, pageCount - 1);
  const pageStart = currentPageIndex * PHOTOS_PER_PAGE;
  const visiblePhotos = displayPhotos.slice(pageStart, pageStart + PHOTOS_PER_PAGE);
  const viewerHistoryKey = viewerHistoryKeyForGroup(classNo, groupId);
  const viewerIndexRef = useRef<number | null>(viewerIndex);

  useEffect(() => {
    viewerIndexRef.current = viewerIndex;
  }, [viewerIndex]);

  const syncDisplayPhotos = useCallback((nextPhotos: Photo[]) => {
    setDisplayPhotos((current) => {
      const currentById = new Map(current.map((photo) => [photo.id, photo]));
      const photoIds = new Set(nextPhotos.map((photo) => photo.id));

      for (const [photoId, previewUrl] of localPreviewUrls.current) {
        if (!photoIds.has(photoId)) {
          URL.revokeObjectURL(previewUrl);
          localPreviewUrls.current.delete(photoId);
        }
      }

      return sortPhotosLatestFirst(nextPhotos.map((photo) => {
        const previewUrl = localPreviewUrls.current.get(photo.id);
        const currentPhoto = currentById.get(photo.id);
        const pendingFavorite = pendingFavoriteValues.current.get(photo.id);
        const favorite = pendingFavorite ?? isFavoritePhoto(photo);

        return previewUrl
          ? {
              ...photo,
              mime_type: currentPhoto?.mime_type ?? photo.mime_type,
              size: currentPhoto?.size ?? photo.size,
              is_favorite: favorite,
              url: previewUrl,
            }
          : {
              ...photo,
              is_favorite: favorite,
            };
      }));
    });
  }, []);

  const syncPhotosFromServer = useCallback(async () => {
    const params = new URLSearchParams({
      classNo: String(classNo),
      groupId,
      access,
    });

    const response = await fetch(`/api/photos/sync?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });

    if (response.status === 403) {
      window.location.replace(staleGroupHomePath(classNo, groupId));
      return;
    }

    if (!response.ok) {
      return;
    }

    const body = (await response.json().catch(() => null)) as SyncPhotosResponse | null;
    if (!Array.isArray(body?.photos)) {
      return;
    }

    syncDisplayPhotos(body.photos.map((photo) => normalizePhotoPayload(photo)));
  }, [access, classNo, groupId, syncDisplayPhotos]);

  useEffect(() => {
    syncDisplayPhotos(photos.map((photo) => normalizePhotoPayload(photo)));
  }, [photos, syncDisplayPhotos]);

  useEffect(() => {
    let cancelled = false;
    let timerId: number | null = null;

    function clearTimer() {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
    }

    function schedule(delay = PHOTO_SYNC_INTERVAL) {
      clearTimer();
      timerId = window.setTimeout(() => {
        void tick();
      }, delay);
    }

    async function tick() {
      if (cancelled) {
        return;
      }

      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        schedule();
        return;
      }

      try {
        await syncPhotosFromServer();
      } finally {
        schedule();
      }
    }

    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void syncPhotosFromServer();
      }
    };

    void tick();
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleVisible);
    window.addEventListener("pageshow", handleVisible);

    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleVisible);
      window.removeEventListener("pageshow", handleVisible);
    };
  }, [syncPhotosFromServer]);

  useEffect(() => {
    const previewUrls = localPreviewUrls.current;

    return () => {
      for (const previewUrl of previewUrls.values()) {
        URL.revokeObjectURL(previewUrl);
      }
      previewUrls.clear();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function handlePopState(event: PopStateEvent) {
      const viewerState = readViewerHistoryState(event.state);
      handlingViewerPopState.current = true;

      if (viewerState?.key === viewerHistoryKey && displayPhotos.length) {
        const nextIndex = clamp(viewerState.index, 0, displayPhotos.length - 1);
        setViewerIndex(nextIndex);
      } else {
        setViewerIndex(null);
      }

      window.setTimeout(() => {
        handlingViewerPopState.current = false;
      }, 0);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [displayPhotos.length, viewerHistoryKey]);

  useEffect(() => {
    if (typeof window === "undefined" || handlingViewerPopState.current) {
      return;
    }

    if (viewerIndex === null) {
      return;
    }

    const currentState = readViewerHistoryState(window.history.state);
    const nextState = {
      ...(window.history.state ?? {}),
      __albumViewer: {
        key: viewerHistoryKey,
        index: viewerIndex,
      },
    } satisfies ViewerHistoryState;

    if (currentState?.key === viewerHistoryKey) {
      if (currentState.index !== viewerIndex) {
        window.history.replaceState(nextState, "", window.location.href);
      }
      return;
    }

    window.history.pushState(nextState, "", window.location.href);
  }, [viewerHistoryKey, viewerIndex]);

  const closeViewer = useCallback(() => {
    if (typeof window !== "undefined") {
      const currentState = readViewerHistoryState(window.history.state);
      if (viewerIndexRef.current !== null && currentState?.key === viewerHistoryKey) {
        window.history.back();
        return;
      }
    }

    setViewerIndex(null);
  }, [viewerHistoryKey]);

  function handlePhotoEdited(previousPhotoId: string, editedPhoto: Photo, blob: Blob) {
    const previousUrl = localPreviewUrls.current.get(previousPhotoId);
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
      localPreviewUrls.current.delete(previousPhotoId);
    }

    const previewUrl = URL.createObjectURL(blob);
    localPreviewUrls.current.set(editedPhoto.id, previewUrl);
    setDisplayPhotos((current) =>
      sortPhotosLatestFirst(current.map((photo) =>
        photo.id === previousPhotoId
          ? {
              ...normalizePhotoPayload(editedPhoto),
              is_favorite: isFavoritePhoto(editedPhoto),
              url: previewUrl,
            }
          : photo,
      )),
    );
    router.refresh();
  }

  function updatePhotoFavoriteLocally(photoId: string, favorite: boolean) {
    setDisplayPhotos((current) =>
      current.map((photo) =>
        photo.id === photoId
          ? {
              ...photo,
              is_favorite: favorite,
            }
          : photo,
      ),
    );
  }

  function handlePhotoDeleted(photoId: string) {
    const previewUrl = localPreviewUrls.current.get(photoId);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      localPreviewUrls.current.delete(photoId);
    }

    const deletedIndex = displayPhotos.findIndex((candidate) => candidate.id === photoId);
    if (deletedIndex === -1) {
      return;
    }

    const nextPhotos = displayPhotos.filter((candidate) => candidate.id !== photoId);
    setDisplayPhotos(nextPhotos);
    setSelectedPhotoIds((current) => {
      const next = new Set(current);
      next.delete(photoId);
      return next;
    });
    setPendingFavoritePhotoIds((current) => {
      const next = new Set(current);
      next.delete(photoId);
      return next;
    });
    pendingFavoriteValues.current.delete(photoId);

    if (viewerIndex !== null) {
      if (!nextPhotos.length) {
        closeViewer();
      } else if (viewerIndex > deletedIndex) {
        setViewerIndex(viewerIndex - 1);
      } else if (viewerIndex === deletedIndex) {
        setViewerIndex(Math.min(deletedIndex, nextPhotos.length - 1));
      }
    }

    router.refresh();
  }

  async function setPhotoFavorite(photoId: string, favorite: boolean) {
    if (pendingFavoriteValues.current.has(photoId)) {
      return;
    }

    const currentPhoto = displayPhotos.find((photo) => photo.id === photoId);
    if (!currentPhoto) {
      return;
    }

    const previousFavorite = isFavoritePhoto(currentPhoto);
    updatePhotoFavoriteLocally(photoId, favorite);
    pendingFavoriteValues.current.set(photoId, favorite);
    setPendingFavoritePhotoIds((current) => new Set(current).add(photoId));

    try {
      const response = await fetch("/api/photos/favorite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          classNo,
          groupId,
          access,
          photoId,
          favorite,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as FavoritePhotoResponse | null;
        if (response.status === 403) {
          window.location.replace(staleGroupHomePath(classNo, groupId));
          return;
        }
        throw new Error(body?.error ?? "즐겨찾기 저장에 실패했습니다.");
      }

      const body = (await response.json().catch(() => null)) as FavoritePhotoResponse | null;
      updatePhotoFavoriteLocally(photoId, body?.favorite ?? favorite);
    } catch (error) {
      updatePhotoFavoriteLocally(photoId, previousFavorite);
      window.alert(error instanceof Error ? error.message : "즐겨찾기 저장에 실패했습니다.");
    } finally {
      pendingFavoriteValues.current.delete(photoId);
      setPendingFavoritePhotoIds((current) => {
        const next = new Set(current);
        next.delete(photoId);
        return next;
      });
    }
  }

  function toggleSelectionMode() {
    setSelectionMode((current) => {
      if (current) {
        setSelectedPhotoIds(new Set());
      }
      return !current;
    });
  }

  function togglePhoto(photoId: string) {
    setSelectedPhotoIds((current) => {
      const next = new Set(current);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  }

  function openPhoto(index: number) {
    if (selectionMode) {
      togglePhoto(displayPhotos[index].id);
      return;
    }

    const preloadIndexes = new Set<number>([
      index,
      (index + 1) % displayPhotos.length,
      (index + 2) % displayPhotos.length,
      (index - 1 + displayPhotos.length) % displayPhotos.length,
    ]);

    for (const preloadIndex of preloadIndexes) {
      const targetPhoto = displayPhotos[preloadIndex];
      if (!targetPhoto?.id || targetPhoto.url) {
        continue;
      }

      void prefetchViewerImage(
        imageRouteForPhoto(classNo, groupId, targetPhoto.id, access, "viewer"),
      ).catch(() => null);
    }

    setViewerIndex(index);
  }

  return (
    <div className="grid w-full min-w-0 max-w-full gap-3">
      <form
        id={batchFormId}
        action={softDeletePhotos}
        onSubmit={(event) => {
          if (!selectedCount) {
            event.preventDefault();
          }
        }}
        suppressHydrationWarning
      >
        <input type="hidden" name="classNo" value={classNo} />
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="access" value={access} />
        {[...selectedPhotoIds].map((photoId) => (
          <input key={photoId} type="hidden" name="photoId" value={photoId} />
        ))}
      </form>

      <div className="flex w-full min-w-0 max-w-full items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-zinc-600">
          {`사진 ${displayPhotos.length}장 · ${formatFileSize(totalSize)}`}
        </p>
        {!selectionMode ? (
          <button
            type="button"
            onClick={toggleSelectionMode}
            className="shrink-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800"
          >
            선택
          </button>
        ) : null}
      </div>

      <section className="grid w-full min-w-0 max-w-full grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {visiblePhotos.map((photo, index) => {
          const selected = selectedPhotoIds.has(photo.id);
          const favorite = isFavoritePhoto(photo);
          const favoritePending = pendingFavoritePhotoIds.has(photo.id);

          return (
            <article
              key={photo.id}
              className={`relative min-w-0 overflow-hidden rounded-lg border bg-white shadow-sm ${
                selected ? "border-teal-500 ring-2 ring-teal-200" : "border-zinc-200"
              }`}
            >
              <div className="relative aspect-square w-full overflow-hidden">
                <button
                  type="button"
                  onClick={() => openPhoto(pageStart + index)}
                  className={`group absolute inset-0 block text-left ${
                    selectionMode ? "cursor-pointer" : "cursor-zoom-in"
                  }`}
                >
                  <img
                    src={photo.url || imageRouteForPhoto(classNo, groupId, photo.id, access, "gallery")}
                    alt={photo.original_name ?? "group photo"}
                    loading="lazy"
                    decoding="async"
                    sizes="(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 22vw"
                    className="block h-full w-full bg-zinc-100 object-cover"
                  />
                  {selectionMode ? (
                    <span
                      className={`absolute right-2.5 top-2.5 z-10 grid h-6 w-6 place-items-center rounded-full shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.98),0_1px_3px_rgba(0,0,0,0.18)] transition ${
                        selected
                          ? "bg-teal-600 text-white"
                          : "bg-white/96 text-transparent"
                      }`}
                      aria-hidden="true"
                    >
                      <SelectionCheckIcon />
                    </span>
                  ) : null}
                </button>
                <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-start p-2">
                  <button
                    type="button"
                    aria-label={favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                    aria-pressed={favorite}
                    disabled={selectionMode || favoritePending}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (selectionMode) {
                        return;
                      }
                      void setPhotoFavorite(photo.id, !favorite);
                    }}
                    className={`pointer-events-auto inline-flex h-8 w-8 touch-manipulation items-center justify-center rounded-full border border-white/80 bg-white/96 shadow-[0_1px_4px_rgba(0,0,0,0.22)] transition ${
                      favorite
                        ? "text-red-600"
                        : "text-zinc-700"
                    } disabled:cursor-default disabled:opacity-70 sm:h-9 sm:w-9`}
                  >
                    <HeartIcon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" filled={favorite} />
                  </button>
                </div>
              </div>
              <div className="grid gap-1 p-3">
                <p className="truncate text-sm font-semibold">{photo.original_name ?? "사진"}</p>
                <p className="text-xs text-zinc-500">{koDate(photo.created_at)}</p>
                <p className="text-xs text-zinc-500">{formatFileSize(photo.size)}</p>
              </div>
            </article>
          );
        })}
      </section>

      {pageCount > 1 ? (
        <nav className="flex flex-wrap items-center justify-center gap-2" aria-label="사진 페이지">
          <button
            type="button"
            disabled={currentPageIndex === 0}
            onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            이전
          </button>
          <span className="text-sm font-medium text-zinc-600">
            {currentPageIndex + 1} / {pageCount}
          </span>
          <button
            type="button"
            disabled={currentPageIndex >= pageCount - 1}
            onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            다음
          </button>
        </nav>
      ) : null}
      {selectionMode ? <div className="h-28" aria-hidden="true" /> : null}
      {selectionMode && typeof document !== "undefined"
        ? createPortal(
            <div
              className="pointer-events-none fixed left-3 right-3 z-[80] sm:left-6 sm:right-6"
              style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
            >
              <div className="pointer-events-auto mx-auto flex w-full max-w-5xl items-center justify-between gap-3 rounded-2xl border border-zinc-300 bg-zinc-100/95 px-4 py-3 shadow-xl backdrop-blur">
                <p className="min-w-0 truncate text-sm font-semibold text-zinc-700">
                  {selectedCount}장 선택됨
                </p>
                <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                  <button
                    type="button"
                    disabled={!selectedCount}
                    onClick={() => setBatchDeleteDialogOpen(true)}
                    className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
                  >
                    삭제
                  </button>
                  <button
                    type="button"
                    onClick={toggleSelectionMode}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800"
                  >
                    선택 종료
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {viewerIndex !== null && displayPhotos[viewerIndex] ? (
        <PhotoViewer
          classNo={classNo}
          groupId={groupId}
          access={access}
          photos={displayPhotos}
          onPhotoEdited={handlePhotoEdited}
          onPhotoDeleted={handlePhotoDeleted}
          onPhotoFavoriteChange={setPhotoFavorite}
          favoritePending={pendingFavoritePhotoIds.has(displayPhotos[viewerIndex].id)}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={closeViewer}
        />
      ) : null}
      {batchDeleteDialogOpen ? (
        <DeleteConfirmDialog
          title="선택한 파일을 삭제할까요?"
          formId={batchFormId}
          onCancel={() => setBatchDeleteDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}

function PhotoViewer({
  classNo,
  groupId,
  access,
  photos,
  onPhotoEdited,
  onPhotoDeleted,
  onPhotoFavoriteChange,
  favoritePending,
  index,
  onIndexChange,
  onClose,
}: {
  classNo: number;
  groupId: string;
  access: string;
  photos: PhotoWithUrl[];
  onPhotoEdited: (previousPhotoId: string, editedPhoto: Photo, blob: Blob) => void;
  onPhotoDeleted: (photoId: string) => void;
  onPhotoFavoriteChange: (photoId: string, favorite: boolean) => Promise<void>;
  favoritePending: boolean;
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const photo = photos[index]!;
  const currentLabel = `${index + 1} / ${photos.length}`;
  const displayName = photo.original_name ?? "사진";
  const displaySize = formatFileSize(photo.size);
  const viewerPhotoUrl = photo.url || imageRouteForPhoto(classNo, groupId, photo.id, access, "viewer");
  const fullPhotoUrl = photo.url || imageRouteForPhoto(classNo, groupId, photo.id, access, "full");
  const editorPhotoUrl = photo.url || imageRouteForPhoto(classNo, groupId, photo.id, access, "editor");

  const imageRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mobileArrowHideTimeoutRef = useRef<number | null>(null);
  const activePointers = useRef<Map<number, PointerPoint>>(new Map());
  const dragStart = useRef<{ pointerId: number; point: PointerPoint; transform: ViewerTransform } | null>(null);
  const pinchStart = useRef<{ distance: number; center: PointerPoint; transform: ViewerTransform } | null>(null);
  const pinchInProgress = useRef(false);
  const touchStart = useRef<PointerPoint | null>(null);
  const suppressNavigationClick = useRef(false);
  const cropInteraction = useRef<{
    pointerId: number;
    mode: "move" | "resize";
    handle?: CropHandle;
    startPoint: PointerPoint;
    startRect: CropRect;
  } | null>(null);
  const [transform, setTransform] = useState<ViewerTransform>({ scale: 1, x: 0, y: 0 });
  const [cropMode, setCropMode] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [rotation, setRotation] = useState(0);
  const [loadedImage, setLoadedImage] = useState<(Size & { photoId: string }) | null>(null);
  const [stageSize, setStageSize] = useState<Size | null>(null);
  const [saving, setSaving] = useState<"rotate" | "crop" | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [mobileArrowSide, setMobileArrowSide] = useState<MobileArrowSide>(null);
  const [viewerImage, setViewerImage] = useState<{ photoId: string; src: string }>({
    photoId: photo.id,
    src: viewerPhotoUrl,
  });
  const [viewerImageState, setViewerImageState] = useState<"loading" | "loaded" | "error">("loading");
  const imageSize = loadedImage;
  const favorite = isFavoritePhoto(photo);

  const canMove = photos.length > 1;
  const viewerReady = viewerImage.photoId === photo.id && viewerImageState === "loaded";
  const savingMessage =
    saving === "rotate"
      ? "회전한 사진을 저장하는 중입니다."
      : saving === "crop"
        ? "자른 사진을 저장하는 중입니다."
        : "";

  const clearMobileArrowHideTimeout = useCallback(() => {
    if (mobileArrowHideTimeoutRef.current !== null) {
      window.clearTimeout(mobileArrowHideTimeoutRef.current);
      mobileArrowHideTimeoutRef.current = null;
    }
  }, []);

  const scheduleMobileArrowHide = useCallback(() => {
    if (!isMobileViewerArrowMode()) {
      return;
    }

    clearMobileArrowHideTimeout();
    mobileArrowHideTimeoutRef.current = window.setTimeout(() => {
      setMobileArrowSide(null);
      mobileArrowHideTimeoutRef.current = null;
    }, MOBILE_ARROW_HIDE_DELAY);
  }, [clearMobileArrowHideTimeout]);

  const updateMobileArrowSide = useCallback((clientX: number) => {
    if (!isMobileViewerArrowMode()) {
      setMobileArrowSide(null);
      return false;
    }

    const stage = stageRef.current;
    if (!stage) {
      return false;
    }

    const rect = stage.getBoundingClientRect();
    const leftZoneEnd = rect.left + rect.width / 3;
    const rightZoneStart = rect.right - rect.width / 3;

    if (clientX <= leftZoneEnd) {
      setMobileArrowSide("left");
      scheduleMobileArrowHide();
      return true;
    }

    if (clientX >= rightZoneStart) {
      setMobileArrowSide("right");
      scheduleMobileArrowHide();
      return true;
    }

    clearMobileArrowHideTimeout();
    setMobileArrowSide(null);
    return false;
  }, [clearMobileArrowHideTimeout, scheduleMobileArrowHide]);

  const showMobileNavigationArrow = useCallback((direction: "prev" | "next") => {
    if (!isMobileViewerArrowMode()) {
      return;
    }

    setMobileArrowSide(direction === "prev" ? "left" : "right");
    scheduleMobileArrowHide();
  }, [scheduleMobileArrowHide]);

  const resetView = useCallback(() => {
    setTransform({ scale: 1, x: 0, y: 0 });
    setCropMode(false);
    setCropRect(null);
    setRotation(0);
    activePointers.current.clear();
    dragStart.current = null;
    pinchStart.current = null;
    pinchInProgress.current = false;
    touchStart.current = null;
    cropInteraction.current = null;
    clearMobileArrowHideTimeout();
    setMobileArrowSide(null);
  }, [clearMobileArrowHideTimeout]);

  const movePhoto = useCallback(
    (direction: "prev" | "next") => {
      if (!canMove || deleting || Boolean(saving)) {
        return;
      }

      const nextIndex =
        direction === "next"
          ? (index + 1) % photos.length
          : (index - 1 + photos.length) % photos.length;

      resetView();
      setDeleteDialogOpen(false);
      onIndexChange(nextIndex);
    },
    [
      canMove,
      deleting,
      index,
      onIndexChange,
      photos,
      resetView,
      saving,
    ],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (deleteDialogOpen) {
        if (event.key === "Escape") {
          setDeleteDialogOpen(false);
        }
        return;
      }

      if (event.key === "Escape") {
        onClose();
      }
      if (event.key === "ArrowRight") {
        void movePhoto("next");
      }
      if (event.key === "ArrowLeft") {
        void movePhoto("prev");
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [deleteDialogOpen, movePhoto, onClose]);

  useEffect(() => {
    return () => {
      clearMobileArrowHideTimeout();
    };
  }, [clearMobileArrowHideTimeout]);

  useEffect(() => {
    const stage = stageRef.current;

    if (!stage) {
      return;
    }

    const currentStage = stage;

    function updateStageSize() {
      setStageSize({ width: currentStage.clientWidth, height: currentStage.clientHeight });
    }

    updateStageSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateStageSize);
      return () => window.removeEventListener("resize", updateStageSize);
    }

    const observer = new ResizeObserver(updateStageSize);
    observer.observe(currentStage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    let cancelled = false;

    async function startLoadingCurrentPhoto() {
      if (!viewerPhotoUrl) {
        setLoadedImage(null);
        setViewerImage({ photoId: photo.id, src: "" });
        setViewerImageState("error");
        return;
      }

      if (viewerImage.photoId === photo.id && viewerImage.src === viewerPhotoUrl) {
        setViewerImageState((current) => (current === "loaded" ? current : "loading"));
        return;
      }

      setViewerImageState("loading");

      try {
        const image = await loadImageElement(viewerPhotoUrl, abortController.signal);

        if (!cancelled) {
          setLoadedImage({
            photoId: photo.id,
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
          setViewerImage({ photoId: photo.id, src: viewerPhotoUrl });
          setViewerImageState("loaded");
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (!cancelled) {
          setLoadedImage(null);
          setViewerImage({ photoId: photo.id, src: "" });
          setViewerImageState("error");
        }
      }
    }

    void Promise.resolve().then(startLoadingCurrentPhoto);

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [photo.id, viewerImage.photoId, viewerImage.src, viewerPhotoUrl]);

  useEffect(() => {
    if (!shouldPrefetchViewerImages() || photos.length < 2) {
      return;
    }

    const prefetchIndexes = new Set<number>([
      (index + 1) % photos.length,
      (index + 2) % photos.length,
      (index - 1 + photos.length) % photos.length,
    ]);

    for (const targetIndex of prefetchIndexes) {
      const targetPhoto = photos[targetIndex];
      if (!targetPhoto || targetPhoto.id === photo.id || targetPhoto.url) {
        continue;
      }

      void prefetchViewerImage(
        imageRouteForPhoto(classNo, groupId, targetPhoto.id, access, "viewer"),
      ).catch(() => null);
    }
  }, [access, classNo, groupId, index, photo.id, photos]);

  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const rotatedImageSize = useMemo(() => {
    if (!imageSize) {
      return null;
    }

    return normalizedRotation === 90 || normalizedRotation === 270
      ? { width: imageSize.height, height: imageSize.width }
      : { width: imageSize.width, height: imageSize.height };
  }, [imageSize, normalizedRotation]);
  const hasPendingEdit = cropMode || rotation % 360 !== 0;
  const currentLayerStyles = useMemo(
    () =>
      layerStylesFor(
        imageSize,
        stageSize,
        viewerImage.photoId === photo.id ? rotation : 0,
        viewerImage.photoId === photo.id ? transform : { scale: 1, x: 0, y: 0 },
      ),
    [imageSize, photo.id, rotation, stageSize, transform, viewerImage.photoId],
  );

  function zoomAt(clientX: number, clientY: number, nextScale: number) {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const rect = stage.getBoundingClientRect();
    const pointX = clientX - rect.left - rect.width / 2;
    const pointY = clientY - rect.top - rect.height / 2;
    const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    const ratio = scale / transform.scale;

    setTransform({
      scale,
      x: scale === 1 ? 0 : pointX - (pointX - transform.x) * ratio,
      y: scale === 1 ? 0 : pointY - (pointY - transform.y) * ratio,
    });
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.88 : 1.12;
    zoomAt(event.clientX, event.clientY, transform.scale * delta);
  }

  function pointerDistance(points: PointerPoint[]) {
    const [first, second] = points;
    if (!first || !second) {
      return 0;
    }

    return Math.hypot(first.x - second.x, first.y - second.y);
  }

  function pointerCenter(points: PointerPoint[]) {
    const [first, second] = points;
    if (!first || !second) {
      return { x: 0, y: 0 };
    }

    return {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (cropMode) {
      return;
    }

    updateMobileArrowSide(event.clientX);

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      return;
    }

    const point = { x: event.clientX, y: event.clientY };
    activePointers.current.set(event.pointerId, point);

    if (activePointers.current.size === 1) {
      touchStart.current = point;
      dragStart.current = {
        pointerId: event.pointerId,
        point,
        transform,
      };
    }

    if (activePointers.current.size === 2) {
      const points = [...activePointers.current.values()];
      pinchInProgress.current = true;
      touchStart.current = null;
      dragStart.current = null;
      pinchStart.current = {
        distance: pointerDistance(points),
        center: pointerCenter(points),
        transform,
      };
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (cropMode || !activePointers.current.has(event.pointerId)) {
      return;
    }

    if (mobileArrowSide) {
      scheduleMobileArrowHide();
    }

    const point = { x: event.clientX, y: event.clientY };
    activePointers.current.set(event.pointerId, point);

    if (activePointers.current.size >= 2 && pinchStart.current) {
      const points = [...activePointers.current.values()];
      const distance = pointerDistance(points);
      const start = pinchStart.current;

      if (!distance || !start.distance) {
        return;
      }

      const center = pointerCenter(points);
      const nextScale = clamp(start.transform.scale * (distance / start.distance), MIN_SCALE, MAX_SCALE);

      setTransform({
        scale: nextScale,
        x: nextScale === 1 ? 0 : start.transform.x + center.x - start.center.x,
        y: nextScale === 1 ? 0 : start.transform.y + center.y - start.center.y,
      });
      return;
    }

    if (transform.scale > 1 && dragStart.current?.pointerId === event.pointerId) {
      setTransform({
        scale: transform.scale,
        x: dragStart.current.transform.x + point.x - dragStart.current.point.x,
        y: dragStart.current.transform.y + point.y - dragStart.current.point.y,
      });
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = touchStart.current;
    const end = { x: event.clientX, y: event.clientY };
    const wasPinching = pinchInProgress.current;
    const mobileArrowMode = isMobileViewerArrowMode();

    activePointers.current.delete(event.pointerId);
    dragStart.current = null;
    if (activePointers.current.size < 2) {
      pinchStart.current = null;
    }
    if (activePointers.current.size === 0) {
      pinchInProgress.current = false;
    }

    if (start && !wasPinching && !cropMode) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;

      if (transform.scale === 1 && Math.abs(dx) > 72 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        suppressNavigationClick.current = true;
        const direction = dx < 0 ? "next" : "prev";
        void movePhoto(direction);
        showMobileNavigationArrow(direction);
        window.setTimeout(() => {
          suppressNavigationClick.current = false;
        }, 250);
        touchStart.current = null;
        return;
      }

      if (canMove && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
        const stage = stageRef.current;

        if (stage) {
          const rect = stage.getBoundingClientRect();
          const direction = mobileArrowMode
            ? end.x <= rect.left + rect.width / 3
              ? "prev"
              : end.x >= rect.right - rect.width / 3
                ? "next"
                : null
            : end.x <= rect.left + rect.width * 0.22
              ? "prev"
              : end.x >= rect.right - rect.width * 0.22
                ? "next"
                : null;

          if (direction) {
            suppressNavigationClick.current = true;
            void movePhoto(direction);
            showMobileNavigationArrow(direction);
            window.setTimeout(() => {
              suppressNavigationClick.current = false;
            }, 250);
            touchStart.current = null;
            return;
          }
        }
      }
    }

    if (mobileArrowSide) {
      scheduleMobileArrowHide();
    }

    touchStart.current = null;
  }

  function imageBoundsForSize(size: Size): ImageBounds | null {
    const stage = stageRef.current;

    if (!stage) {
      return null;
    }

    const rect = stage.getBoundingClientRect();
    const renderedRatio = Math.min(rect.width / size.width, rect.height / size.height);
    const width = size.width * renderedRatio;
    const height = size.height * renderedRatio;

    return {
      x: (rect.width - width) / 2,
      y: (rect.height - height) / 2,
      width,
      height,
      renderedRatio,
    };
  }

  function getImageBounds() {
    return rotatedImageSize ? imageBoundsForSize(rotatedImageSize) : null;
  }

  function rotateCropRectCounterClockwise(rect: CropRect, oldBounds: ImageBounds, nextBounds: ImageBounds): CropRect {
    const left = clamp((rect.x - oldBounds.x) / oldBounds.width, 0, 1);
    const top = clamp((rect.y - oldBounds.y) / oldBounds.height, 0, 1);
    const right = clamp((rect.x + rect.width - oldBounds.x) / oldBounds.width, 0, 1);
    const bottom = clamp((rect.y + rect.height - oldBounds.y) / oldBounds.height, 0, 1);
    const nextLeft = top;
    const nextTop = 1 - right;
    const nextRight = bottom;
    const nextBottom = 1 - left;
    const width = Math.min(nextBounds.width, Math.max(MIN_CROP_SIZE, (nextRight - nextLeft) * nextBounds.width));
    const height = Math.min(nextBounds.height, Math.max(MIN_CROP_SIZE, (nextBottom - nextTop) * nextBounds.height));

    return {
      x: clamp(nextBounds.x + nextLeft * nextBounds.width, nextBounds.x, nextBounds.x + nextBounds.width - width),
      y: clamp(nextBounds.y + nextTop * nextBounds.height, nextBounds.y, nextBounds.y + nextBounds.height - height),
      width,
      height,
    };
  }

  function initialCropRect() {
    const bounds = getImageBounds();

    if (!bounds) {
      return null;
    }

    const width = Math.max(MIN_CROP_SIZE, bounds.width * 0.72);
    const height = Math.max(MIN_CROP_SIZE, bounds.height * 0.72);

    return {
      x: bounds.x + (bounds.width - width) / 2,
      y: bounds.y + (bounds.height - height) / 2,
      width,
      height,
    };
  }

  function resetCropSelection() {
    setCropRect(initialCropRect());
  }

  useEffect(() => {
    if (cropMode && !cropRect) {
      window.requestAnimationFrame(resetCropSelection);
    }
  });

  function startCropMode() {
    setTransform({ scale: 1, x: 0, y: 0 });
    activePointers.current.clear();
    dragStart.current = null;
    pinchStart.current = null;
    touchStart.current = null;
    setCropMode(true);
    window.requestAnimationFrame(resetCropSelection);
  }

  function rotateCounterClockwise() {
    const oldBounds = getImageBounds();
    const nextRotatedImageSize = rotatedImageSize
      ? { width: rotatedImageSize.height, height: rotatedImageSize.width }
      : null;
    const nextBounds = nextRotatedImageSize ? imageBoundsForSize(nextRotatedImageSize) : null;

    setTransform({ scale: 1, x: 0, y: 0 });
    cropInteraction.current = null;
    setRotation((current) => current - 90);
    if (cropMode && cropRect && oldBounds && nextBounds) {
      setCropRect(rotateCropRectCounterClockwise(cropRect, oldBounds, nextBounds));
    } else if (cropMode) {
      window.requestAnimationFrame(resetCropSelection);
    }
  }

  function cancelPendingEdit() {
    setTransform({ scale: 1, x: 0, y: 0 });
    activePointers.current.clear();
    dragStart.current = null;
    pinchStart.current = null;
    pinchInProgress.current = false;
    touchStart.current = null;
    cropInteraction.current = null;

    if (cropMode) {
      setCropMode(false);
      setCropRect(null);
      return;
    }

    setRotation(0);
  }

  function cropPointer(event: ReactPointerEvent<HTMLElement>) {
    const stage = stageRef.current;

    if (!stage) {
      return { x: event.clientX, y: event.clientY };
    }

    const rect = stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function handleCropPointerDown(
    event: ReactPointerEvent<HTMLElement>,
    mode: "move" | "resize",
    handle?: CropHandle,
  ) {
    if (!cropRect) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    cropInteraction.current = {
      pointerId: event.pointerId,
      mode,
      handle,
      startPoint: cropPointer(event),
      startRect: cropRect,
    };
  }

  function handleCropPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const interaction = cropInteraction.current;

    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const bounds = getImageBounds();
    const point = cropPointer(event);

    if (!bounds) {
      return;
    }

    const dx = point.x - interaction.startPoint.x;
    const dy = point.y - interaction.startPoint.y;
    const start = interaction.startRect;

    if (interaction.mode === "move") {
      setCropRect({
        ...start,
        x: clamp(start.x + dx, bounds.x, bounds.x + bounds.width - start.width),
        y: clamp(start.y + dy, bounds.y, bounds.y + bounds.height - start.height),
      });
      return;
    }

    const handle = interaction.handle ?? "se";
    let left = start.x;
    let top = start.y;
    let right = start.x + start.width;
    let bottom = start.y + start.height;

    if (handle.includes("w")) {
      left = clamp(start.x + dx, bounds.x, right - MIN_CROP_SIZE);
    }
    if (handle.includes("e")) {
      right = clamp(start.x + start.width + dx, left + MIN_CROP_SIZE, bounds.x + bounds.width);
    }
    if (handle.includes("n")) {
      top = clamp(start.y + dy, bounds.y, bottom - MIN_CROP_SIZE);
    }
    if (handle.includes("s")) {
      bottom = clamp(start.y + start.height + dy, top + MIN_CROP_SIZE, bounds.y + bounds.height);
    }

    setCropRect({ x: left, y: top, width: right - left, height: bottom - top });
  }

  function handleCropPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (cropInteraction.current?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      cropInteraction.current = null;
    }
  }

  async function uploadEditedPhoto(blob: Blob) {
    const formData = new FormData();
    formData.append("classNo", String(classNo));
    formData.append("groupId", groupId);
    formData.append("access", access);
    formData.append("photoId", photo.id);
    formData.append("photo", new File([blob], photo.original_name ?? `photo-${index + 1}`, { type: blob.type }));

    const response = await fetch("/api/photos/edit", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as EditedPhotoResponse | null;
      throw new Error(body?.error ?? "편집한 사진 저장에 실패했습니다.");
    }

    const body = (await response.json().catch(() => null)) as EditedPhotoResponse | null;
    if (!body?.photo) {
      throw new Error("편집한 사진 정보를 확인할 수 없습니다.");
    }

    onPhotoEdited(photo.id, body.photo, blob);
    setSaving(null);
    setCropMode(false);
    setCropRect(null);
    setRotation(0);
    setTransform({ scale: 1, x: 0, y: 0 });
  }

  async function createRotatedCanvas() {
    const sourceUrls = photo.url
      ? [photo.url]
      : [editorPhotoUrl, viewerPhotoUrl, fullPhotoUrl];

    let lastError: Error | null = null;

    for (const sourceUrl of sourceUrls) {
      try {
        const image = await loadImageElement(sourceUrl);
        const sourceSize = fitSizeWithinLimit(image.naturalWidth, image.naturalHeight);
        const canvas = document.createElement("canvas");

        if (normalizedRotation === 90 || normalizedRotation === 270) {
          canvas.width = sourceSize.height;
          canvas.height = sourceSize.width;
        } else {
          canvas.width = sourceSize.width;
          canvas.height = sourceSize.height;
        }

        const context = canvas.getContext("2d");

        if (!context) {
          throw new Error("사진을 편집할 수 없습니다.");
        }

        prepareCanvasContext(context, canvas.width, canvas.height, photo.mime_type);

        if (normalizedRotation === 90) {
          context.translate(canvas.width, 0);
          context.rotate(Math.PI / 2);
        } else if (normalizedRotation === 180) {
          context.translate(canvas.width, canvas.height);
          context.rotate(Math.PI);
        } else if (normalizedRotation === 270) {
          context.translate(0, canvas.height);
          context.rotate(-Math.PI / 2);
        }

        context.drawImage(image, 0, 0, sourceSize.width, sourceSize.height);

        if (
          canvasLooksUniform(canvas) &&
          sourceUrl !== sourceUrls[sourceUrls.length - 1]
        ) {
          lastError = new Error("편집용 이미지 렌더링이 비어 있습니다.");
          continue;
        }

        return canvas;
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error("사진을 편집할 수 없습니다.");
      }
    }

    throw lastError ?? new Error("사진을 편집할 수 없습니다.");
  }

  async function saveRotatedCounterClockwise() {
    try {
      setSaving("rotate");
      const canvas = await createRotatedCanvas();
      await uploadEditedPhoto(await canvasToBlob(canvas, photo.mime_type));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "사진 저장에 실패했습니다.");
      setSaving(null);
    }
  }

  async function saveCrop() {
    if (!cropMode) {
      startCropMode();
      return;
    }

    try {
      setSaving("crop");
      const stage = stageRef.current;

      if (!stage) {
        throw new Error("크롭 영역을 확인할 수 없습니다.");
      }

      const editedCanvas = await createRotatedCanvas();
      const bounds = imageBoundsForSize({
        width: editedCanvas.width,
        height: editedCanvas.height,
      });

      if (!bounds || !cropRect) {
        throw new Error("크롭 영역을 확인할 수 없습니다.");
      }

      const sourceX = clamp((cropRect.x - bounds.x) / bounds.renderedRatio, 0, editedCanvas.width);
      const sourceY = clamp((cropRect.y - bounds.y) / bounds.renderedRatio, 0, editedCanvas.height);
      const sourceWidth = clamp(cropRect.width / bounds.renderedRatio, 1, editedCanvas.width - sourceX);
      const sourceHeight = clamp(cropRect.height / bounds.renderedRatio, 1, editedCanvas.height - sourceY);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(sourceWidth);
      canvas.height = Math.round(sourceHeight);
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("사진을 편집할 수 없습니다.");
      }

      prepareCanvasContext(context, canvas.width, canvas.height, photo.mime_type);

      drawCoverImage(
        context,
        editedCanvas,
        { x: sourceX, y: sourceY, width: sourceWidth, height: sourceHeight },
        canvas.width,
        canvas.height,
      );

      await uploadEditedPhoto(await canvasToBlob(canvas, photo.mime_type));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "사진 저장에 실패했습니다.");
      setSaving(null);
    }
  }

  async function saveEdit() {
    if (cropMode) {
      await saveCrop();
      return;
    }

    if (rotation % 360 !== 0) {
      await saveRotatedCounterClockwise();
    }
  }

  async function downloadCurrentPhoto() {
    let objectUrl = "";

    try {
      setDownloading(true);
      const fileName = downloadNameForPhoto(photo.original_name, index, photo.mime_type);

      if (shouldPreferNativePhotoShare()) {
        const image = imageRef.current;

        if (
          image?.naturalWidth &&
          image.naturalHeight &&
          typeof navigator.share === "function"
        ) {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d");

          if (context) {
            prepareCanvasContext(context, canvas.width, canvas.height, photo.mime_type);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);

            const file = dataUrlToFile(
              canvas.toDataURL(blobType(photo.mime_type), 0.92),
              fileName,
            );
            const shareData = { files: [file], title: file.name };

            if (!navigator.canShare || navigator.canShare(shareData)) {
              try {
                await navigator.share(shareData);
                return;
              } catch (error) {
                if (error instanceof DOMException && error.name === "AbortError") {
                  return;
                }
              }
            }
          }
        }
      }

      const response = await fetch(fullPhotoUrl, {
        method: "GET",
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error("사진 내려받기에 실패했습니다.");
      }

      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = downloadNameForPhoto(photo.original_name, index, blob.type || photo.mime_type);
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "사진 내려받기에 실패했습니다.");
    } finally {
      setDownloading(false);

      if (objectUrl) {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    }
  }

  async function deleteCurrentPhoto() {
    try {
      setDeleting(true);

      const response = await fetch("/api/photos/delete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          classNo,
          groupId,
          access,
          photoId: photo.id,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as DeletePhotoResponse | null;
        throw new Error(body?.error ?? "사진 삭제에 실패했습니다.");
      }

      setDeleteDialogOpen(false);
      onPhotoDeleted(photo.id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "사진 삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid grid-rows-[auto_1fr_auto] bg-black text-white"
    >
      <header className="z-10 flex min-h-16 items-start justify-between gap-3 bg-black/88 px-4 py-3">
        <div className="min-w-0 pt-0.5">
          <p className="text-sm font-semibold">{currentLabel}</p>
          <p className="truncate text-sm text-zinc-300">{displayName} · {displaySize}</p>
          {savingMessage ? (
            <p className="mt-1 text-xs font-medium text-teal-300">{savingMessage}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          disabled={Boolean(saving) || deleting}
          className="mt-[1.35rem] shrink-0 px-1 text-[13px] font-medium leading-none text-zinc-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {savingMessage ? "저장 중" : "닫기"}
        </button>
      </header>

      <div
        ref={stageRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative min-h-0 overflow-hidden touch-none select-none bg-black"
      >
        {savingMessage ? (
          <div className="absolute inset-0 z-40 grid place-items-center bg-black/36 backdrop-blur-[1px]">
            <div className="rounded-xl border border-white/12 bg-black/84 px-4 py-3 text-center shadow-xl">
              <div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              <p className="mt-2 text-sm font-semibold text-white">저장 중</p>
              <p className="mt-1 text-xs text-zinc-300">{savingMessage} 잠시만 기다려 주세요.</p>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          aria-label="이전 사진"
          disabled={!canMove || cropMode || deleting || Boolean(saving)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            if (!cropMode && !suppressNavigationClick.current) {
              void movePhoto("prev");
            }
          }}
          className="absolute left-4 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 cursor-pointer appearance-none items-center justify-center rounded-full border border-white/18 bg-black/60 text-white shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-[2px] transition hover:bg-black/72 disabled:cursor-not-allowed disabled:opacity-35 sm:inline-flex"
        >
          <ViewerPrevIcon />
        </button>
        <button
          type="button"
          aria-label="다음 사진"
          disabled={!canMove || cropMode || deleting || Boolean(saving)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            if (!cropMode && !suppressNavigationClick.current) {
              void movePhoto("next");
            }
          }}
          className="absolute right-4 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 cursor-pointer appearance-none items-center justify-center rounded-full border border-white/18 bg-black/60 text-white shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-[2px] transition hover:bg-black/72 disabled:cursor-not-allowed disabled:opacity-35 sm:inline-flex"
        >
          <ViewerNextIcon />
        </button>
        <button
          type="button"
          aria-label="이전 사진"
          disabled={!canMove || cropMode || deleting || Boolean(saving)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            if (!cropMode && !suppressNavigationClick.current) {
              void movePhoto("prev");
            }
          }}
          className={`absolute left-3 top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 cursor-pointer appearance-none items-center justify-center rounded-full border border-white/18 bg-black/60 text-white shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-[2px] transition-[transform,opacity,background-color] duration-200 ease-out hover:bg-black/72 disabled:cursor-not-allowed disabled:opacity-35 sm:hidden ${
            mobileArrowSide === "left"
              ? "pointer-events-auto translate-x-0 opacity-100"
              : "-translate-x-[175%] opacity-0 pointer-events-none"
          }`}
        >
          <ViewerPrevIcon />
        </button>
        <button
          type="button"
          aria-label="다음 사진"
          disabled={!canMove || cropMode || deleting || Boolean(saving)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            if (!cropMode && !suppressNavigationClick.current) {
              void movePhoto("next");
            }
          }}
          className={`absolute right-3 top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 cursor-pointer appearance-none items-center justify-center rounded-full border border-white/18 bg-black/60 text-white shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-[2px] transition-[transform,opacity,background-color] duration-200 ease-out hover:bg-black/72 disabled:cursor-not-allowed disabled:opacity-35 sm:hidden ${
            mobileArrowSide === "right"
              ? "pointer-events-auto translate-x-0 opacity-100"
              : "translate-x-[175%] opacity-0 pointer-events-none"
          }`}
        >
          <ViewerNextIcon />
        </button>

        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 ${
            viewerImage.src && currentLayerStyles ? "opacity-100" : "opacity-0"
          }`}
        >
          <div
            className="absolute left-1/2 top-1/2 will-change-transform"
            style={currentLayerStyles?.containerStyle}
          >
            {viewerImage.src ? (
              <img
                ref={imageRef}
                src={viewerImage.src}
                alt=""
                loading="eager"
                decoding="async"
                fetchPriority="high"
                draggable={false}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (!image.naturalWidth || !image.naturalHeight) {
                    return;
                  }

                  setLoadedImage({
                    photoId: viewerImage.photoId,
                    width: image.naturalWidth,
                    height: image.naturalHeight,
                  });
                  setViewerImageState("loaded");
                }}
                onError={() => {
                  setViewerImageState("error");
                  setLoadedImage(null);
                  setViewerImage({ photoId: photo.id, src: "" });
                }}
                className="absolute left-1/2 top-1/2 max-w-none object-contain"
                style={currentLayerStyles?.imageStyle}
              />
            ) : null}
          </div>
        </div>

        {!viewerImage.src && viewerImageState === "error" ? (
          <div className="grid h-full place-items-center text-sm text-zinc-400">사진을 불러올 수 없습니다.</div>
        ) : (
          null
        )}

        {cropMode && cropRect ? (
          <div
            className="absolute inset-0 z-30 bg-black/22"
            onPointerMove={handleCropPointerMove}
            onPointerUp={handleCropPointerUp}
            onPointerCancel={handleCropPointerUp}
          >
            <div
              className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.38)]"
              style={{
                left: cropRect.x,
                top: cropRect.y,
                width: cropRect.width,
                height: cropRect.height,
              }}
            >
              <button
                type="button"
                aria-label="크롭 영역 이동"
                onPointerDown={(event) => handleCropPointerDown(event, "move")}
                className="absolute inset-0 cursor-move bg-transparent"
              />
              {(["nw", "ne", "sw", "se"] as const).map((handle) => (
                <button
                  key={handle}
                  type="button"
                  aria-label="크롭 영역 크기 조정"
                  onPointerDown={(event) => handleCropPointerDown(event, "resize", handle)}
                  className={`absolute h-5 w-5 rounded-full border-2 border-black bg-white shadow ${
                    handle === "nw"
                      ? "-left-3 -top-3 cursor-nw-resize"
                      : handle === "ne"
                        ? "-right-3 -top-3 cursor-ne-resize"
                        : handle === "sw"
                          ? "-bottom-3 -left-3 cursor-sw-resize"
                          : "-bottom-3 -right-3 cursor-se-resize"
                  }`}
                />
              ))}
              {(["n", "s", "w", "e"] as const).map((handle) => (
                <button
                  key={handle}
                  type="button"
                  aria-label="크롭 영역 크기 조정"
                  onPointerDown={(event) => handleCropPointerDown(event, "resize", handle)}
                  className={`absolute rounded-full bg-white/90 ${
                    handle === "n"
                      ? "-top-2 left-1/2 h-4 w-10 -translate-x-1/2 cursor-n-resize"
                      : handle === "s"
                        ? "-bottom-2 left-1/2 h-4 w-10 -translate-x-1/2 cursor-s-resize"
                        : handle === "w"
                          ? "-left-2 top-1/2 h-10 w-4 -translate-y-1/2 cursor-w-resize"
                          : "-right-2 top-1/2 h-10 w-4 -translate-y-1/2 cursor-e-resize"
                  }`}
                />
              ))}
            </div>
          </div>
        ) : null}

      </div>

      <footer className="z-10 min-h-16 w-full bg-black/88 px-3 py-3">
        <div className="flex min-w-0 flex-nowrap items-center gap-2 sm:hidden">
          <div className="shrink-0">
            <button
              type="button"
              aria-label={favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
              aria-pressed={favorite}
              disabled={Boolean(saving) || deleting || favoritePending}
              onClick={() => void onPhotoFavoriteChange(photo.id, !favorite)}
              className={`inline-flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 rounded-md border bg-white px-0 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/70 disabled:text-zinc-400 ${
                favorite
                  ? "border-red-200 text-red-600"
                  : "border-zinc-200 text-zinc-950"
              }`}
            >
              <HeartIcon filled={favorite} />
            </button>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <div className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto px-1">
              <button
                type="button"
                aria-label="회전"
                disabled={Boolean(saving) || deleting || !viewerReady}
                onClick={rotateCounterClockwise}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-0 text-sm font-semibold text-zinc-950 shadow-sm disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-white disabled:text-zinc-950 disabled:opacity-100"
              >
                <RotateIcon />
              </button>
              <button
                type="button"
                aria-label="자르기"
                disabled={Boolean(saving) || deleting || !viewerReady || cropMode}
                onClick={startCropMode}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-0 text-sm font-semibold text-zinc-950 shadow-sm disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-white disabled:text-zinc-950 disabled:opacity-100"
              >
                <CropIcon />
              </button>
              <button
                type="button"
                aria-label="취소"
                disabled={Boolean(saving) || deleting || !hasPendingEdit}
                onClick={cancelPendingEdit}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-0 text-sm font-semibold text-zinc-950 shadow-sm disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/70 disabled:text-zinc-400"
              >
                <CloseIcon />
              </button>
              <button
                type="button"
                aria-label={saving ? "저장 중" : "저장"}
                disabled={Boolean(saving) || deleting || favoritePending || !viewerReady || !hasPendingEdit}
                onClick={saveEdit}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-0 text-sm font-semibold text-zinc-950 shadow-sm disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/70 disabled:text-zinc-400"
              >
                <SaveIcon />
              </button>
              <button
                type="button"
                aria-label={downloading ? "내려받는 중" : "내려받기"}
                disabled={Boolean(saving) || downloading || deleting || !viewerReady}
                onClick={() => void downloadCurrentPhoto()}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-0 text-sm font-semibold text-zinc-950 shadow-sm disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/70 disabled:text-zinc-400"
              >
                <DownloadIcon />
              </button>
            </div>
          </div>
          <div className="shrink-0">
            <button
              type="button"
              aria-label="삭제"
              disabled={Boolean(saving) || deleting || favoritePending || !viewerReady}
              onClick={() => setDeleteDialogOpen(true)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-0 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:border-red-300 disabled:bg-red-50 disabled:text-red-700 disabled:opacity-100"
            >
              <TrashIcon />
            </button>
          </div>
        </div>

        <div className="hidden min-w-0 items-center gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="flex items-center justify-start">
            <button
              type="button"
              aria-label={favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
              aria-pressed={favorite}
              disabled={Boolean(saving) || deleting || favoritePending}
              onClick={() => void onPhotoFavoriteChange(photo.id, !favorite)}
              className={`inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md border bg-white px-3 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/70 disabled:text-zinc-400 ${
                favorite
                  ? "border-red-200 text-red-600"
                  : "border-zinc-200 text-zinc-950"
              }`}
            >
              <HeartIcon filled={favorite} />
              <span>즐겨찾기</span>
            </button>
          </div>

          <div className="flex min-w-0 items-center justify-center gap-2">
            <button
              type="button"
              aria-label="회전"
              disabled={Boolean(saving) || deleting || !viewerReady}
              onClick={rotateCounterClockwise}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-950 shadow-sm disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-white disabled:text-zinc-950 disabled:opacity-100"
            >
              <RotateIcon />
              <span>회전</span>
            </button>
            <button
              type="button"
              aria-label="자르기"
              disabled={Boolean(saving) || deleting || !viewerReady || cropMode}
              onClick={startCropMode}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-950 shadow-sm disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-white disabled:text-zinc-950 disabled:opacity-100"
            >
              <CropIcon />
              <span>자르기</span>
            </button>
            <button
              type="button"
              aria-label="취소"
              disabled={Boolean(saving) || deleting || !hasPendingEdit}
              onClick={cancelPendingEdit}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-950 shadow-sm disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/70 disabled:text-zinc-400"
            >
              <CloseIcon />
              <span>취소</span>
            </button>
            <button
              type="button"
              aria-label={saving ? "저장 중" : "저장"}
              disabled={Boolean(saving) || deleting || favoritePending || !viewerReady || !hasPendingEdit}
              onClick={saveEdit}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-950 shadow-sm disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/70 disabled:text-zinc-400"
            >
              <SaveIcon />
              <span>{saving ? "저장 중" : "저장"}</span>
            </button>
            <button
              type="button"
              aria-label={downloading ? "내려받는 중" : "내려받기"}
              disabled={Boolean(saving) || downloading || deleting || !viewerReady}
              onClick={() => void downloadCurrentPhoto()}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-950 shadow-sm disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/70 disabled:text-zinc-400"
            >
              <DownloadIcon />
              <span>{downloading ? "내려받는 중" : "내려받기"}</span>
            </button>
          </div>

          <div className="flex items-center justify-end">
            <button
              type="button"
              aria-label="삭제"
              disabled={Boolean(saving) || deleting || favoritePending || !viewerReady}
              onClick={() => setDeleteDialogOpen(true)}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-3 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:border-red-300 disabled:bg-red-50 disabled:text-red-700 disabled:opacity-100"
            >
              <TrashIcon />
              <span>삭제</span>
            </button>
          </div>
        </div>
      </footer>
      {deleteDialogOpen ? (
        <DeleteConfirmDialog
          title="이 파일을 삭제할까요?"
          onConfirm={deleteCurrentPhoto}
          confirmDisabled={deleting}
          onCancel={() => setDeleteDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}
