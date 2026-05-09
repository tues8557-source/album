export const DEFAULT_CLASS_COUNT = 7;
export const MIN_CLASS_COUNT = 1;

export type ClassNumber = number;
export type Gender = "male" | "female";

export type Home = {
  id: string;
  sort_order: number;
  title_line1: string;
  title_line2: string;
  class_count: number;
  created_at: string;
  updated_at: string;
};

export function clampClassCount(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_CLASS_COUNT;
  }

  return Math.max(MIN_CLASS_COUNT, Math.trunc(value));
}

export function buildClassNumbers(classCount: number) {
  return Array.from({ length: clampClassCount(classCount) }, (_, index) => index + 1);
}

export type Student = {
  id: string;
  home_id: string | null;
  class_no: number;
  name: string;
  gender: Gender | null;
  sort_order: number;
};

export type Group = {
  id: string;
  home_id: string | null;
  class_no: number;
  sort_order: number;
  password_hash: string | null;
  has_password?: boolean;
  access_nonce: string | null;
  deleted_at: string | null;
};

export type GroupMember = {
  id: string;
  group_id: string;
  student_id: string;
  students: Student | null;
};

export type Photo = {
  id: string;
  group_id: string;
  storage_path: string;
  original_name: string | null;
  mime_type: string | null;
  size: number | null;
  is_favorite: boolean;
  created_at: string;
  deleted_at: string | null;
};
