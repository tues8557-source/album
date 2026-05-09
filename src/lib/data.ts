import "server-only";

import { unstable_cache } from "next/cache";
import { sanitizeClientGroups } from "./auth";
import { createServiceSupabase } from "./supabase/server";
import { activePhotosTag, deletedPhotosTag } from "./photo-assets";
import { buildClassNumbers, clampClassCount, DEFAULT_CLASS_COUNT } from "./types";
import type { Group, GroupMember, Home, Photo, Student } from "./types";

const DEFAULT_GROUP_COUNT = 6;
export const DEFAULT_HOME_TITLE_LINE1 = "매안초 졸업앨범 촬영 준비";
export const DEFAULT_HOME_TITLE_LINE2 = "학교배경 컨셉사진";
export const MIN_HOME_TITLE_ROW_COUNT = 5;

export type HomeTitleRow = {
  line1: string;
  line2: string;
};

export type HomePackage = {
  id?: string;
  line1: string;
  line2: string;
  classCount: number;
  rows: HomeTitleRow[];
  selectedIndex: number;
};

export type HomeManagementSettings = {
  packages: HomePackage[];
  activeIndex: number;
  activePackage: HomePackage;
  titleLine1: string;
  titleLine2: string;
};

type AppSettingsRow = {
  active_home_id?: unknown;
  active_home_index?: unknown;
  class_count?: unknown;
  home_packages?: unknown;
  home_title_line1?: unknown;
  home_title_line2?: unknown;
  home_title_rows?: unknown;
  home_title_selected_index?: unknown;
};

function normalizeHomeTitleRows(input: unknown, fallbackLine1 = "", fallbackLine2 = "") {
  const rows = Array.isArray(input)
    ? input.map((item) => ({
        line1: typeof item?.line1 === "string" ? item.line1 : "",
        line2: typeof item?.line2 === "string" ? item.line2 : "",
      }))
    : [];

  return rows.length ? rows : [{ line1: fallbackLine1, line2: fallbackLine2 }];
}

export function createDefaultHomePackage(
  line1 = DEFAULT_HOME_TITLE_LINE1,
  line2 = DEFAULT_HOME_TITLE_LINE2,
): HomePackage {
  return {
    id: undefined,
    line1,
    line2,
    classCount: 1,
    rows: [{ line1, line2 }],
    selectedIndex: 0,
  };
}

function normalizeHomePackage(input: unknown, fallback?: Partial<HomePackage>): HomePackage {
  const nextId =
    typeof (input as { id?: unknown } | null)?.id === "string"
      ? ((input as { id: string }).id ?? "")
      : (fallback?.id ?? undefined);
  const nextLine1 = typeof (input as { line1?: unknown } | null)?.line1 === "string"
    ? ((input as { line1: string }).line1 ?? "")
    : (fallback?.line1 ?? "");
  const nextLine2 = typeof (input as { line2?: unknown } | null)?.line2 === "string"
    ? ((input as { line2: string }).line2 ?? "")
    : (fallback?.line2 ?? "");
  const nextClassCount = clampClassCount(
    typeof (input as { classCount?: unknown } | null)?.classCount === "number"
      ? ((input as { classCount: number }).classCount ?? 1)
      : (fallback?.classCount ?? 1),
  );
  const rows = normalizeHomeTitleRows(
    (input as { rows?: unknown } | null)?.rows,
    nextLine1,
    nextLine2,
  );
  const selectedIndex = Math.min(
    Math.max(
      0,
      typeof (input as { selectedIndex?: unknown } | null)?.selectedIndex === "number"
        ? ((input as { selectedIndex: number }).selectedIndex ?? 0)
        : (fallback?.selectedIndex ?? 0),
    ),
    rows.length - 1,
  );

  return {
    id: nextId || undefined,
    line1: nextLine1,
    line2: nextLine2,
    classCount: nextClassCount,
    rows,
    selectedIndex,
  };
}

export function normalizeHomePackages(input: unknown) {
  const packages = Array.isArray(input)
    ? input.map((item) => normalizeHomePackage(item))
    : [];

  return packages.length ? packages : [createDefaultHomePackage()];
}

function buildHomeManagementSettings(packages: HomePackage[], activeIndexInput: unknown): HomeManagementSettings {
  const normalizedPackages = packages.length ? packages : [createDefaultHomePackage()];
  const activeIndex = Math.min(
    Math.max(0, typeof activeIndexInput === "number" ? activeIndexInput : 0),
    normalizedPackages.length - 1,
  );
  const activePackage = normalizedPackages[activeIndex] ?? normalizedPackages[0] ?? createDefaultHomePackage();

  return {
    packages: normalizedPackages,
    activeIndex,
    activePackage,
    titleLine1: activePackage.line1,
    titleLine2: activePackage.line2,
  };
}

function buildLegacyHomePackage(row?: {
  class_count?: unknown;
  home_title_line1?: unknown;
  home_title_line2?: unknown;
  home_title_rows?: unknown;
  home_title_selected_index?: unknown;
}) {
  const line1 =
    typeof row?.home_title_line1 === "string" ? row.home_title_line1 : DEFAULT_HOME_TITLE_LINE1;
  const line2 =
    typeof row?.home_title_line2 === "string" ? row.home_title_line2 : DEFAULT_HOME_TITLE_LINE2;
  const rows = normalizeHomeTitleRows(row?.home_title_rows, line1, line2);
  const selectedIndex = Math.min(
    Math.max(0, typeof row?.home_title_selected_index === "number" ? row.home_title_selected_index : 0),
    rows.length - 1,
  );

  return {
    id: undefined,
    line1,
    line2,
    classCount: clampClassCount(typeof row?.class_count === "number" ? row.class_count : 1),
    rows,
    selectedIndex,
  };
}

export type HomeTitleSettings = {
  rows: HomeTitleRow[];
  selectedIndex: number;
  titleLine1: string;
  titleLine2: string;
};

function isMissingAppSettingsTableError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: string }).code === "42P01" || (error as { code?: string }).code === "42703")
  );
}

function homeFromRow(row: Home): HomePackage {
  return {
    id: row.id,
    line1: row.title_line1 ?? "",
    line2: row.title_line2 ?? "",
    classCount: clampClassCount(row.class_count),
    rows: [{ line1: row.title_line1 ?? "", line2: row.title_line2 ?? "" }],
    selectedIndex: 0,
  };
}

async function getAppSettingsRow() {
  const supabase = createServiceSupabase();
  const result = await supabase
    .from("app_settings")
    .select(
      "active_home_id, active_home_index, class_count, home_packages, home_title_line1, home_title_line2, home_title_rows, home_title_selected_index",
    )
    .limit(1);

  if (result.error) {
    if (isMissingAppSettingsTableError(result.error)) {
      return null;
    }

    throw result.error;
  }

  return (result.data?.[0] ?? null) as AppSettingsRow | null;
}

async function getConfiguredHomes() {
  const supabase = createServiceSupabase();
  const result = await supabase
    .from("homes")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (result.error) {
    if (result.error.code === "42P01" || result.error.code === "42703") {
      return null;
    }

    throw result.error;
  }

  return (result.data ?? []) as Home[];
}

function resolveActiveIndex(packages: HomePackage[], settingsRow: AppSettingsRow | null) {
  if (!packages.length) {
    return 0;
  }

  const activeHomeId =
    typeof settingsRow?.active_home_id === "string" ? settingsRow.active_home_id : "";
  const activeById = activeHomeId
    ? packages.findIndex((homePackage) => homePackage.id === activeHomeId)
    : -1;

  if (activeById >= 0) {
    return activeById;
  }

  return Math.min(
    Math.max(0, typeof settingsRow?.active_home_index === "number" ? settingsRow.active_home_index : 0),
    packages.length - 1,
  );
}

async function ensureAppSettingsRow() {
  const supabase = createServiceSupabase();
  const result = await supabase
    .from("app_settings")
    .upsert({ id: true, class_count: DEFAULT_CLASS_COUNT }, { onConflict: "id" })
    .select("class_count")
    .single();

  if (result.error) {
    throw result.error;
  }

  return clampClassCount(result.data.class_count as number);
}

export async function getConfiguredClassCount() {
  const [homes, settingsRow] = await Promise.all([getConfiguredHomes(), getAppSettingsRow()]);

  if (homes?.length) {
    return homes[resolveActiveIndex(homes.map(homeFromRow), settingsRow)]?.class_count ?? 1;
  }

  if (!settingsRow) {
    try {
      return await ensureAppSettingsRow();
    } catch (error) {
      if (isMissingAppSettingsTableError(error)) {
        return DEFAULT_CLASS_COUNT;
      }

      throw error;
    }
  }

  return clampClassCount(typeof settingsRow.class_count === "number" ? settingsRow.class_count : DEFAULT_CLASS_COUNT);
}

export async function getConfiguredHomeManagement(): Promise<HomeManagementSettings> {
  const [homes, settingsRow] = await Promise.all([getConfiguredHomes(), getAppSettingsRow()]);

  if (homes?.length) {
    return buildHomeManagementSettings(homes.map(homeFromRow), resolveActiveIndex(homes.map(homeFromRow), settingsRow));
  }

  if (!settingsRow) {
    return buildHomeManagementSettings([createDefaultHomePackage()], 0);
  }

  const packages = Array.isArray(settingsRow.home_packages)
    ? normalizeHomePackages(settingsRow.home_packages)
    : [buildLegacyHomePackage(settingsRow)];

  return buildHomeManagementSettings(packages, settingsRow.active_home_index);
}

export async function getConfiguredHomeTitle(): Promise<HomeTitleSettings> {
  const homeManagement = await getConfiguredHomeManagement();

  return {
    rows: homeManagement.activePackage.rows,
    selectedIndex: homeManagement.activePackage.selectedIndex,
    titleLine1: homeManagement.titleLine1,
    titleLine2: homeManagement.titleLine2,
  };
}

export async function getConfiguredActiveHomeId() {
  const homeManagement = await getConfiguredHomeManagement();
  return homeManagement.activePackage.id ?? null;
}

export async function getConfiguredClassNumbers() {
  return buildClassNumbers(await getConfiguredClassCount());
}

export async function getMinimumConfiguredClassCount() {
  const supabase = createServiceSupabase();
  const activeHomeId = await getConfiguredActiveHomeId();
  let studentsQuery = supabase.from("students").select("class_no");
  let groupsQuery = supabase
    .from("groups")
    .select("id, class_no, password_hash")
    .is("deleted_at", null);

  if (activeHomeId) {
    studentsQuery = studentsQuery.eq("home_id", activeHomeId);
    groupsQuery = groupsQuery.eq("home_id", activeHomeId);
  }

  const [{ data: students, error: studentsError }, { data: groups, error: groupsError }] = await Promise.all([
    studentsQuery,
    groupsQuery,
  ]);

  if (studentsError) {
    throw studentsError;
  }

  if (groupsError) {
    throw groupsError;
  }

  const classNosWithData = new Set<number>();

  for (const student of students ?? []) {
    if (typeof student.class_no === "number" && student.class_no > 0) {
      classNosWithData.add(student.class_no);
    }
  }

  const activeGroups = (groups ?? []) as Array<Pick<Group, "id" | "class_no" | "password_hash">>;
  const groupClassById = new Map(activeGroups.map((group) => [group.id, group.class_no]));

  for (const group of activeGroups) {
    if (group.password_hash && group.class_no > 0) {
      classNosWithData.add(group.class_no);
    }
  }

  const activeGroupIds = activeGroups.map((group) => group.id);

  if (activeGroupIds.length) {
    const [{ data: members, error: membersError }, { data: photos, error: photosError }] = await Promise.all([
      supabase.from("group_members").select("group_id").in("group_id", activeGroupIds),
      supabase.from("photos").select("group_id").in("group_id", activeGroupIds),
    ]);

    if (membersError) {
      throw membersError;
    }

    if (photosError) {
      throw photosError;
    }

    for (const member of members ?? []) {
      const classNo = groupClassById.get(member.group_id as string);
      if (typeof classNo === "number" && classNo > 0) {
        classNosWithData.add(classNo);
      }
    }

    for (const photo of photos ?? []) {
      const classNo = groupClassById.get(photo.group_id as string);
      if (typeof classNo === "number" && classNo > 0) {
        classNosWithData.add(classNo);
      }
    }
  }

  return classNosWithData.size ? Math.max(...classNosWithData) : 1;
}

function normalizePhotoRecord(record: Record<string, unknown>) {
  return {
    ...record,
    is_favorite: Boolean(record.is_favorite),
  } as Photo;
}

export async function ensureInitialClassGroups(targetCount = DEFAULT_GROUP_COUNT, classCount?: number, homeId?: string | null) {
  const supabase = createServiceSupabase();
  const activeHomeId = homeId ?? await getConfiguredActiveHomeId();
  const classNumbers = buildClassNumbers(classCount ?? await getConfiguredClassCount());
  let query = supabase
    .from("groups")
    .select("class_no")
    .in("class_no", classNumbers)
    .is("deleted_at", null);

  if (activeHomeId) {
    query = query.eq("home_id", activeHomeId);
  }

  const { data: existingGroups, error } = await query;

  if (error) {
    throw error;
  }

  const initializedClassNos = new Set((existingGroups ?? []).map((group) => group.class_no as number));
  const rows = classNumbers.flatMap((classNo) => {
    if (initializedClassNos.has(classNo)) {
      return [];
    }

    return Array.from({ length: targetCount }, (_, index) => ({
      ...(activeHomeId ? { home_id: activeHomeId } : {}),
      class_no: classNo,
      sort_order: index + 1,
      password_hash: null,
    }));
  });

  if (!rows.length) {
    await normalizeClassGroupSortOrders(undefined, activeHomeId);
    return;
  }

  const { error: insertError } = await supabase.from("groups").insert(rows);

  if (insertError) {
    throw insertError;
  }

  await normalizeClassGroupSortOrders(undefined, activeHomeId);
}

export async function normalizeClassGroupSortOrders(classNo?: number, homeId?: string | null) {
  const supabase = createServiceSupabase();
  const activeHomeId = homeId ?? await getConfiguredActiveHomeId();
  let query = supabase
    .from("groups")
    .select("id, home_id, class_no, sort_order, created_at")
    .is("deleted_at", null)
    .order("class_no", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (classNo) {
    query = query.eq("class_no", classNo);
  }

  if (activeHomeId) {
    query = query.eq("home_id", activeHomeId);
  }

  const { data: groups, error } = await query;

  if (error) {
    throw error;
  }

  const updates = [];
  const usedOrdersByClass = new Map<number, Set<number>>();
  const nextOrderByClass = new Map<number, number>();

  for (const group of groups ?? []) {
    const groupClassNo = group.class_no as number;
    const usedOrders = usedOrdersByClass.get(groupClassNo) ?? new Set<number>();
    usedOrdersByClass.set(groupClassNo, usedOrders);

    if (group.sort_order > 0 && !usedOrders.has(group.sort_order)) {
      usedOrders.add(group.sort_order);
      nextOrderByClass.set(groupClassNo, Math.max(nextOrderByClass.get(groupClassNo) ?? 1, group.sort_order + 1));
      continue;
    }

    let nextSortOrder = nextOrderByClass.get(groupClassNo) ?? 1;
    while (usedOrders.has(nextSortOrder)) {
      nextSortOrder += 1;
    }
    usedOrders.add(nextSortOrder);
    nextOrderByClass.set(groupClassNo, nextSortOrder + 1);

    if (group.sort_order !== nextSortOrder) {
      updates.push(
        supabase
          .from("groups")
          .update({ sort_order: nextSortOrder })
          .eq("id", group.id),
      );
    }
  }

  const results = await Promise.all(updates);
  const updateError = results.find((result) => result.error)?.error;

  if (updateError) {
    throw updateError;
  }
}

export async function compactClassGroupSortOrders(classNo: number) {
  const supabase = createServiceSupabase();
  const activeHomeId = await getConfiguredActiveHomeId();
  let query = supabase
    .from("groups")
    .select("id, sort_order, created_at")
    .eq("class_no", classNo)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (activeHomeId) {
    query = query.eq("home_id", activeHomeId);
  }

  const { data: groups, error } = await query;

  if (error) {
    throw error;
  }

  const results = await Promise.all(
    (groups ?? []).map((group, index) =>
      group.sort_order === index + 1
        ? Promise.resolve({ error: null })
        : supabase.from("groups").update({ sort_order: index + 1 }).eq("id", group.id),
    ),
  );
  const updateError = results.find((result) => result.error)?.error;

  if (updateError) {
    throw updateError;
  }
}

export async function getClassGroups(classNo: number) {
  const supabase = createServiceSupabase();
  const activeHomeId = await getConfiguredActiveHomeId();
  let groupsQuery = supabase
    .from("groups")
    .select("*")
    .eq("class_no", classNo)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (activeHomeId) {
    groupsQuery = groupsQuery.eq("home_id", activeHomeId);
  }

  const { data: groups, error: groupsError } = await groupsQuery;

  if (groupsError) {
    throw groupsError;
  }

  const groupIds = (groups ?? []).map((group) => group.id);
  const { data: members, error: membersError } = groupIds.length
    ? await supabase
        .from("group_members")
        .select("id, group_id, student_id, students(*)")
        .in("group_id", groupIds)
        .order("created_at", { ascending: true })
    : { data: [], error: null };

  if (membersError) {
    throw membersError;
  }

  const sanitizedGroups = await sanitizeClientGroups((groups ?? []) as Group[]);

  return {
    groups: sanitizedGroups,
    members: (members ?? []) as unknown as GroupMember[],
  };
}

export async function getAdminData() {
  const supabase = createServiceSupabase();
  const activeHomeId = await getConfiguredActiveHomeId();
  let studentsQuery = supabase
    .from("students")
    .select("*")
    .order("class_no", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  let groupsQuery = supabase
    .from("groups")
    .select("*")
    .is("deleted_at", null)
    .order("class_no", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (activeHomeId) {
    studentsQuery = studentsQuery.eq("home_id", activeHomeId);
    groupsQuery = groupsQuery.eq("home_id", activeHomeId);
  }

  const [{ data: students, error: studentsError }, { data: groups, error }] =
    await Promise.all([
      studentsQuery,
      groupsQuery,
    ]);

  if (studentsError) {
    throw studentsError;
  }
  if (error) {
    throw error;
  }

  const groupIds = (groups ?? []).map((group) => group.id);
  const { data: members, error: membersError } = groupIds.length
    ? await supabase
        .from("group_members")
        .select("id, group_id, student_id, students(*)")
        .in("group_id", groupIds)
        .order("created_at", { ascending: true })
    : { data: [], error: null };

  if (membersError) {
    throw membersError;
  }

  const sanitizedGroups = await sanitizeClientGroups((groups ?? []) as Group[]);

  return {
    students: (students ?? []) as Student[],
    groups: sanitizedGroups,
    members: (members ?? []) as unknown as GroupMember[],
  };
}

export async function getGroup(groupId: string) {
  const { data, error } = await createServiceSupabase()
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .is("deleted_at", null)
    .single();

  if (error) {
    return null;
  }

  return data as Group;
}

export async function getGroupMembers(groupId: string) {
  const { data, error } = await createServiceSupabase()
    .from("group_members")
    .select("id, group_id, student_id, students(*)")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as GroupMember[];
}

export async function getPhotos(groupId: string, deleted: boolean) {
  return unstable_cache(
    async () => {
      const query = createServiceSupabase()
        .from("photos")
        .select("*")
        .eq("group_id", groupId)
        .order("created_at", { ascending: false });

      const { data, error } = deleted
        ? await query.not("deleted_at", "is", null)
        : await query.is("deleted_at", null);

      if (error) {
        throw error;
      }

      return (data ?? []).map((photo) => normalizePhotoRecord(photo as Record<string, unknown>));
    },
    ["photos", groupId, deleted ? "deleted" : "active"],
    { tags: [deleted ? deletedPhotosTag(groupId) : activePhotosTag(groupId)] },
  )();
}

export async function getPhotoUrls(photos: Photo[]) {
  const supabase = createServiceSupabase();

  return Promise.all(
    photos.map(async (photo) => {
      const { data } = await supabase.storage
        .from("group-photos")
        .createSignedUrl(photo.storage_path, 60 * 10);

      return {
        ...normalizePhotoRecord(photo as unknown as Record<string, unknown>),
        url: data?.signedUrl ?? "",
      };
    }),
  );
}
