export type PhotoAssetVariant = "gallery" | "viewer" | "editor" | "full";

export function photoAssetUrl({
  classNo,
  groupId,
  photoId,
  variant,
}: {
  classNo: number;
  groupId: string;
  photoId: string;
  variant: PhotoAssetVariant;
}) {
  const params = new URLSearchParams({
    classNo: String(classNo),
    groupId,
    photoId,
    variant,
  });

  return `/api/photos/file?${params.toString()}`;
}

export function activePhotosTag(groupId: string) {
  return `photos:${groupId}:active`;
}

export function deletedPhotosTag(groupId: string) {
  return `photos:${groupId}:deleted`;
}
