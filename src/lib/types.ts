export const CLASS_NUMBERS = [1, 2, 3, 4, 5, 6, 7] as const;

export type ClassNumber = (typeof CLASS_NUMBERS)[number];
export type Gender = "male" | "female";

export type Student = {
  id: string;
  class_no: number;
  name: string;
  gender: Gender | null;
  sort_order: number;
};

export type Group = {
  id: string;
  class_no: number;
  sort_order: number;
  password_hash: string | null;
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
