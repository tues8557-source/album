export function classTabPageSizeForWidth(width: number) {
  if (width < 640) {
    return 5;
  }

  if (width < 1024) {
    return 9;
  }

  return 14;
}

export function classPageCount(classCount: number, pageSize: number) {
  return Math.max(1, Math.ceil(classCount / Math.max(1, pageSize)));
}

export function classPageIndexForClass(classNo: number, pageSize: number) {
  if (classNo <= 1) {
    return 0;
  }

  return Math.max(0, Math.floor((classNo - 1) / Math.max(1, pageSize)));
}

export function classRangeForPage(pageIndex: number, pageSize: number, classCount: number) {
  const safePageSize = Math.max(1, pageSize);
  const start = pageIndex * safePageSize;
  const end = Math.min(classCount, start + safePageSize);
  return { start, end };
}
