import { DEFAULT_CLASS_COUNT } from "./types";

export function isClassNumber(value: number, classCount = DEFAULT_CLASS_COUNT): boolean {
  return Number.isInteger(value) && value >= 1 && value <= classCount;
}

export function groupLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

export function groupName(classNo: number, index: number): string {
  return `${classNo}${groupLetter(index)}`;
}

export function safeFileName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

export function genderClass(gender: string | null | undefined): string {
  if (gender === "female") {
    return "bg-pink-100 text-pink-950 ring-pink-200";
  }

  if (gender === "male") {
    return "bg-sky-100 text-sky-950 ring-sky-200";
  }

  return "bg-white text-zinc-700 ring-zinc-300";
}

export function koDate(value: string): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(value));
  const valueFor = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number.parseInt(valueFor("hour"), 10);
  const rawDayPeriod = valueFor("dayPeriod");
  const dayPeriod = rawDayPeriod === "PM" || rawDayPeriod === "오후" ? "오후" : "오전";

  return `${valueFor("month")}월 ${valueFor("day")}일 ${dayPeriod} ${hour}:${valueFor("minute")}`;
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) {
    return "용량 정보 없음";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}
