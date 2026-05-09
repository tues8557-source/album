"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { activePhotosTag, deletedPhotosTag } from "@/lib/photo-assets";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  compactClassGroupSortOrders,
  createDefaultHomePackage,
  ensureInitialClassGroups,
  getConfiguredActiveHomeId,
  getConfiguredClassCount,
  getMinimumConfiguredClassCount,
  normalizeHomePackages,
  normalizeClassGroupSortOrders,
} from "@/lib/data";
import {
  clearAdminSession,
  clearGroupAccessSession,
  getGroupAccessState,
  getGroupRecord,
  hasAdminSession,
  sanitizeClientGroups,
  setAdminSession,
  setGroupAccessSession,
} from "@/lib/auth";
import { groupName, isClassNumber, safeFileName } from "@/lib/format";
import { clearRateLimit, isRateLimited, rateLimitKey, recordRateLimitFailure } from "@/lib/rate-limit";
import { buildClassNumbers, clampClassCount } from "@/lib/types";
import type { Group, Home } from "@/lib/types";
import {
  hashPassword,
  isAdminPassword,
  needsPasswordRehash,
  verifyPassword,
} from "@/lib/security";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function numberValue(formData: FormData, key: string) {
  return Number.parseInt(text(formData, key), 10);
}

function nullableGender(value: string) {
  if (value === "female") {
    return "female";
  }

  if (value === "male") {
    return "male";
  }

  return null;
}

function isStudentGenderConstraintError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  };
  const combined = `${candidate.message ?? ""} ${candidate.details ?? ""} ${candidate.hint ?? ""}`;

  return (candidate.code === "23502" || candidate.code === "23514") && /gender/i.test(combined);
}

function isRouteClassNo(value: number | undefined) {
  return Number.isInteger(value) && (value ?? 0) > 0;
}

function adminPath(classNo?: number) {
  return isRouteClassNo(classNo) ? `/admin?classNo=${classNo}` : "/admin";
}

function adminErrorPath(error: string, classNo?: number) {
  const separator = isRouteClassNo(classNo) ? "&" : "?";
  return `${adminPath(classNo)}${separator}error=${error}`;
}

function homePathForGroup(
  classNo: number,
  {
    errorGroupId,
    rateLimitedGroupId,
    staleGroupId,
  }: {
    errorGroupId?: string;
    rateLimitedGroupId?: string;
    staleGroupId?: string;
  },
) {
  const params = new URLSearchParams({ classNo: String(classNo) });

  if (errorGroupId) {
    params.set("errorGroupId", errorGroupId);
  }

  if (rateLimitedGroupId) {
    params.set("rateLimitedGroupId", rateLimitedGroupId);
  }

  if (staleGroupId) {
    params.set("staleGroupId", staleGroupId);
  }

  return `/?${params.toString()}`;
}

function groupPath(classNo: number, groupId: string) {
  return `/classes/${classNo}/groups/${groupId}`;
}

function groupTrashPath(classNo: number, groupId: string) {
  return `${groupPath(classNo, groupId)}/trash`;
}

function returnClassNo(formData: FormData, fallback?: number) {
  const classNo = numberValue(formData, "returnClassNo");
  return isRouteClassNo(classNo) ? classNo : fallback;
}

async function isConfiguredClassNo(classNo: number) {
  return isClassNumber(classNo, await getConfiguredClassCount());
}

async function requireAdmin() {
  if (!(await hasAdminSession())) {
    redirect("/admin");
  }
}

async function getScopedHomeId() {
  return await getConfiguredActiveHomeId();
}

async function deleteHomesAndRelatedData(homeIds: string[]) {
  const uniqueHomeIds = Array.from(new Set(homeIds.filter(Boolean)));

  if (!uniqueHomeIds.length) {
    return;
  }

  const supabase = createServiceSupabase();
  const { data: groups, error: groupsError } = await supabase
    .from("groups")
    .select("id, class_no")
    .in("home_id", uniqueHomeIds);

  if (groupsError) {
    throw groupsError;
  }

  const scopedGroups = (groups ?? []) as Array<{ id: string; class_no: number }>;
  const groupIds = scopedGroups.map((group) => group.id);

  if (groupIds.length) {
    const { data: photos, error: photosError } = await supabase
      .from("photos")
      .select("id, storage_path, group_id")
      .in("group_id", groupIds);

    if (photosError) {
      throw photosError;
    }

    const storagePaths = Array.from(
      new Set(
        (photos ?? [])
          .map((photo) => String(photo.storage_path ?? "").trim())
          .filter(Boolean),
      ),
    );

    if (storagePaths.length) {
      const { error: storageError } = await supabase.storage
        .from("group-photos")
        .remove(storagePaths);

      if (storageError) {
        throw storageError;
      }
    }

    const { error: membersDeleteError } = await supabase
      .from("group_members")
      .delete()
      .in("group_id", groupIds);

    if (membersDeleteError) {
      throw membersDeleteError;
    }

    const { error: photosDeleteError } = await supabase
      .from("photos")
      .delete()
      .in("group_id", groupIds);

    if (photosDeleteError) {
      throw photosDeleteError;
    }

    const { error: groupsDeleteError } = await supabase
      .from("groups")
      .delete()
      .in("id", groupIds);

    if (groupsDeleteError) {
      throw groupsDeleteError;
    }
  }

  const { error: studentsDeleteError } = await supabase
    .from("students")
    .delete()
    .in("home_id", uniqueHomeIds);

  if (studentsDeleteError) {
    throw studentsDeleteError;
  }

  const { error: homesDeleteError } = await supabase
    .from("homes")
    .delete()
    .in("id", uniqueHomeIds);

  if (homesDeleteError) {
    throw homesDeleteError;
  }

  for (const group of scopedGroups) {
    revalidateTag(activePhotosTag(group.id), "max");
    revalidateTag(deletedPhotosTag(group.id), "max");
    revalidatePath(groupPath(group.class_no, group.id));
    revalidatePath(groupTrashPath(group.class_no, group.id));
  }
}

async function activeGroupsForClass(classNo: number) {
  const activeHomeId = await getScopedHomeId();
  let query = createServiceSupabase()
    .from("groups")
    .select("*")
    .eq("class_no", classNo)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (activeHomeId) {
    query = query.eq("home_id", activeHomeId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []) as Group[];
}

async function requireGroupAccess(groupId: string, classNo: number) {
  const accessState = await getGroupAccessState(classNo, groupId);

  if (!accessState.group) {
    redirect(groupPath(classNo, groupId));
  }

  if (accessState.allowed) {
    return accessState.group;
  }

  if (accessState.stale) {
    redirect(homePathForGroup(classNo, { staleGroupId: groupId }));
  }

  redirect(groupPath(classNo, groupId));
}

export async function loginAdmin(formData: FormData) {
  const limiterKey = await rateLimitKey("admin");
  if (isRateLimited("admin-login", limiterKey).limited) {
    redirect("/admin?error=too-many-requests");
  }

  if (!isAdminPassword(text(formData, "password"))) {
    const result = recordRateLimitFailure("admin-login", limiterKey);
    redirect(result.limited ? "/admin?error=too-many-requests" : "/admin?error=bad-password");
  }

  clearRateLimit("admin-login", limiterKey);
  await setAdminSession();
  redirect("/admin");
}

export async function logoutAdmin() {
  await clearAdminSession();
  redirect("/");
}

export async function loginGroup(formData: FormData) {
  const groupId = text(formData, "groupId");
  const classNo = numberValue(formData, "classNo");
  const password = text(formData, `password-${groupId}`) || text(formData, "password");

  if (!groupId || !(await isConfiguredClassNo(classNo))) {
    redirect("/");
  }

  const admin = await hasAdminSession();
  const limiterKey = await rateLimitKey(groupId);

  if (isRateLimited("group-login", limiterKey, { maxAttempts: 8 }).limited) {
    redirect(homePathForGroup(classNo, { rateLimitedGroupId: groupId }));
  }

  const group = await getGroupRecord(classNo, groupId);

  if (
    !group ||
    (group.password_hash && !admin && !verifyPassword(password, group.password_hash))
  ) {
    const result = recordRateLimitFailure("group-login", limiterKey, { maxAttempts: 8 });
    redirect(
      result.limited
        ? homePathForGroup(classNo, { rateLimitedGroupId: groupId })
        : homePathForGroup(classNo, { errorGroupId: groupId }),
    );
  }

  const supabase = createServiceSupabase();
  clearRateLimit("group-login", limiterKey);

  if (!admin && group.password_hash && needsPasswordRehash(group.password_hash)) {
    await supabase
      .from("groups")
      .update({ password_hash: hashPassword(password) })
      .eq("id", groupId)
      .eq("class_no", classNo);
  }

  if (!group.password_hash) {
    await clearGroupAccessSession(groupId);
    redirect(groupPath(classNo, groupId));
  }

  if (!admin) {
    await setGroupAccessSession(groupId, group.access_nonce);
  }

  redirect(groupPath(classNo, groupId));
}

export async function createStudent(formData: FormData) {
  await requireAdmin();
  const classNo = numberValue(formData, "classNo");
  const name = text(formData, "name");
  const gender = nullableGender(text(formData, "gender"));

  if (!(await isConfiguredClassNo(classNo)) || !name) {
    redirect(adminErrorPath("bad-student", returnClassNo(formData)));
  }

  const supabase = createServiceSupabase();
  const activeHomeId = await getScopedHomeId();
  let lastQuery = supabase
    .from("students")
    .select("sort_order")
    .eq("class_no", classNo)
    .order("sort_order", { ascending: false })
    .limit(1);

  if (activeHomeId) {
    lastQuery = lastQuery.eq("home_id", activeHomeId);
  }

  const { data: last } = await lastQuery.maybeSingle();
  const insertRow = {
    ...(activeHomeId ? { home_id: activeHomeId } : {}),
    class_no: classNo,
    name,
    gender,
    sort_order: (last?.sort_order ?? 0) + 1,
  };
  const { error } = await supabase.from("students").insert(insertRow);

  if (error) {
    throw error;
  }

  revalidatePath("/admin");
  redirect(adminPath(returnClassNo(formData, classNo)));
}

export async function createStudents(formData: FormData) {
  await requireAdmin();
  const classNo = numberValue(formData, "classNo");
  const names = formData.getAll("studentName").map((value) => String(value).trim());
  const genders = formData.getAll("studentGender").map((value) => String(value).trim());

  if (!(await isConfiguredClassNo(classNo))) {
    redirect("/admin?error=bad-student");
  }

  const rows = names
    .map((name, index) => ({
      name,
      gender: nullableGender(genders[index] ?? ""),
    }))
    .filter((student) => student.name);

  if (!rows.length) {
    redirect(adminErrorPath("bad-student", returnClassNo(formData, classNo)));
  }

  const supabase = createServiceSupabase();
  const activeHomeId = await getScopedHomeId();
  let lastQuery = supabase
    .from("students")
    .select("sort_order")
    .eq("class_no", classNo)
    .order("sort_order", { ascending: false })
    .limit(1);

  if (activeHomeId) {
    lastQuery = lastQuery.eq("home_id", activeHomeId);
  }

  const { data: last } = await lastQuery.maybeSingle();

  const startOrder = last?.sort_order ?? 0;
  const { error } = await supabase.from("students").insert(
    rows.map((student, index) => ({
      ...(activeHomeId ? { home_id: activeHomeId } : {}),
      class_no: classNo,
      name: student.name,
      gender: student.gender,
      sort_order: startOrder + index + 1,
    })),
  );

  if (error) {
    throw error;
  }

  revalidatePath("/admin");
  redirect(adminPath(returnClassNo(formData, classNo)));
}

export async function saveClassRoster(formData: FormData) {
  await requireAdmin();
  const classNo = numberValue(formData, "classNo");
  const autoSave = text(formData, "autoSave") === "1";

  if (!(await isConfiguredClassNo(classNo))) {
    redirect(adminErrorPath("bad-student", returnClassNo(formData)));
  }

  const studentIds = formData.getAll("studentId").map((value) => String(value).trim());
  const rowKeys = formData.getAll("studentRowKey").map((value) => String(value).trim());
  const names = formData.getAll("studentName").map((value) => String(value).trim());
  const genders = formData.getAll("studentGender").map((value) => String(value).trim());
  const groupIds = formData.getAll("studentGroupId").map((value) => String(value).trim());
  const deleted = formData.getAll("studentDeleted").map((value) => String(value).trim() === "1");
  const supabase = createServiceSupabase();
  const activeHomeId = await getScopedHomeId();
  let studentsQuery = supabase.from("students").select("id").eq("class_no", classNo);
  let groupsQuery = supabase.from("groups").select("id").eq("class_no", classNo).is("deleted_at", null);

  if (activeHomeId) {
    studentsQuery = studentsQuery.eq("home_id", activeHomeId);
    groupsQuery = groupsQuery.eq("home_id", activeHomeId);
  }

  const [
    { data: existingStudents, error: studentsError },
    { data: classGroups, error: groupsError },
  ] = await Promise.all([
    studentsQuery,
    groupsQuery,
  ]);

  if (studentsError || groupsError) {
    throw studentsError ?? groupsError;
  }

  const existingIds = new Set((existingStudents ?? []).map((student) => student.id as string));
  const classGroupIds = (classGroups ?? []).map((group) => group.id as string);
  const classGroupIdSet = new Set(classGroupIds);
  const handledExistingIds = new Set<string>();
  const savedStudentIds: Record<string, string> = {};
  let blankGenderNeedsSchemaUpdate = false;
  let nextSortOrder = 1;

  for (const [index, name] of names.entries()) {
    const id = studentIds[index] ?? "";
    const rowKey = rowKeys[index] ?? "";
    const gender = nullableGender(genders[index] ?? "");
    const groupId = groupIds[index] ?? "";
    const shouldDelete = deleted[index] || !name;

    if (id && !existingIds.has(id)) {
      continue;
    }

    if (id && shouldDelete) {
      const { error: memberError } = await supabase.from("group_members").delete().eq("student_id", id);
      if (memberError) {
        throw memberError;
      }

      let deleteQuery = supabase.from("students").delete().eq("id", id).eq("class_no", classNo);
      if (activeHomeId) {
        deleteQuery = deleteQuery.eq("home_id", activeHomeId);
      }
      const { error } = await deleteQuery;
      if (error) {
        throw error;
      }
      handledExistingIds.add(id);
      continue;
    }

    if (shouldDelete) {
      continue;
    }

    if (!name) {
      continue;
    }

    let savedStudentId = id;
    let isNewStudent = false;

    if (id) {
      let updateQuery = supabase
        .from("students")
        .update({ name, gender, sort_order: nextSortOrder })
        .eq("id", id)
        .eq("class_no", classNo);
      if (activeHomeId) {
        updateQuery = updateQuery.eq("home_id", activeHomeId);
      }
      const { error } = await updateQuery;
      if (error) {
        if (gender === null && isStudentGenderConstraintError(error)) {
          blankGenderNeedsSchemaUpdate = true;
          let fallbackQuery = supabase
            .from("students")
            .update({ name, sort_order: nextSortOrder })
            .eq("id", id)
            .eq("class_no", classNo);
          if (activeHomeId) {
            fallbackQuery = fallbackQuery.eq("home_id", activeHomeId);
          }
          const { error: fallbackError } = await fallbackQuery;

          if (fallbackError) {
            throw fallbackError;
          }
        } else {
          throw error;
        }
      }
      handledExistingIds.add(id);
    } else {
      const { data, error } = await supabase
        .from("students")
        .insert({
          ...(activeHomeId ? { home_id: activeHomeId } : {}),
          class_no: classNo,
          name,
          gender,
          sort_order: nextSortOrder,
        })
        .select("id")
        .single();
      if (error) {
        if (gender === null && isStudentGenderConstraintError(error)) {
          blankGenderNeedsSchemaUpdate = true;
          continue;
        }

        throw error;
      }
      savedStudentId = data.id as string;
      isNewStudent = true;
      if (rowKey) {
        savedStudentIds[rowKey] = savedStudentId;
      }
    }

    if (isNewStudent && classGroupIds.length) {
      const { error: removeError } = await supabase
        .from("group_members")
        .delete()
        .eq("student_id", savedStudentId)
        .in("group_id", classGroupIds);
      if (removeError) {
        throw removeError;
      }

      if (classGroupIdSet.has(groupId)) {
        const { error: addError } = await supabase
          .from("group_members")
          .upsert(
            { group_id: groupId, student_id: savedStudentId },
            { onConflict: "group_id,student_id" },
          );
        if (addError) {
          throw addError;
        }
      }
    }

    nextSortOrder += 1;
  }

  for (const id of existingIds) {
    if (handledExistingIds.has(id) || studentIds.includes(id)) {
      continue;
    }

    let reorderQuery = supabase
      .from("students")
      .update({ sort_order: nextSortOrder })
      .eq("id", id)
      .eq("class_no", classNo);
    if (activeHomeId) {
      reorderQuery = reorderQuery.eq("home_id", activeHomeId);
    }
    const { error } = await reorderQuery;
    if (error) {
      throw error;
    }
    nextSortOrder += 1;
  }

  revalidatePath("/admin");
  revalidatePath("/");
  if (autoSave) {
    return {
      savedStudentIds,
      warning: blankGenderNeedsSchemaUpdate
        ? "성별 빈칸 저장을 위해 DB 업데이트가 필요합니다."
        : undefined,
    };
  }
  redirect(adminPath(returnClassNo(formData, classNo)));
}

export async function updateStudent(formData: FormData) {
  await requireAdmin();
  const id = text(formData, "studentId");
  const classNo = numberValue(formData, "classNo");
  const name = text(formData, "name");
  const gender = nullableGender(text(formData, "gender"));
  const sortOrder = numberValue(formData, "sortOrder");

  if (!id || !(await isConfiguredClassNo(classNo)) || !name) {
    redirect(adminErrorPath("bad-student", returnClassNo(formData, classNo)));
  }

  const activeHomeId = await getScopedHomeId();
  const updateValues = {
    ...(activeHomeId ? { home_id: activeHomeId } : {}),
    class_no: classNo,
    name,
    gender,
    sort_order: sortOrder || 0,
  };
  let query = createServiceSupabase()
    .from("students")
    .update(updateValues)
    .eq("id", id);

  if (activeHomeId) {
    query = query.eq("home_id", activeHomeId);
  }

  const { error } = await query;

  if (error) {
    throw error;
  }

  revalidatePath("/admin");
  redirect(adminPath(returnClassNo(formData, classNo)));
}

export async function updateStudentGroup(formData: FormData) {
  await requireAdmin();
  const studentId = text(formData, "studentId");
  const groupId = text(formData, "groupId");
  const classNo = numberValue(formData, "classNo");

  if (!studentId || !(await isConfiguredClassNo(classNo))) {
    throw new Error("Invalid student group update.");
  }

  const supabase = createServiceSupabase();
  const activeHomeId = await getScopedHomeId();
  let studentQuery = supabase.from("students").select("id").eq("id", studentId).eq("class_no", classNo);
  let groupsQuery = supabase.from("groups").select("id").eq("class_no", classNo).is("deleted_at", null);

  if (activeHomeId) {
    studentQuery = studentQuery.eq("home_id", activeHomeId);
    groupsQuery = groupsQuery.eq("home_id", activeHomeId);
  }

  const [
    { data: student, error: studentError },
    { data: classGroups, error: groupsError },
  ] = await Promise.all([
    studentQuery.single(),
    groupsQuery,
  ]);

  if (studentError || groupsError || !student) {
    throw studentError ?? groupsError ?? new Error("Student not found.");
  }

  const classGroupIds = (classGroups ?? []).map((group) => group.id as string);
  const classGroupIdSet = new Set(classGroupIds);

  if (groupId && !classGroupIdSet.has(groupId)) {
    throw new Error("Group does not belong to this class.");
  }

  if (classGroupIds.length) {
    const { error: removeError } = await supabase
      .from("group_members")
      .delete()
      .eq("student_id", studentId)
      .in("group_id", classGroupIds);

    if (removeError) {
      throw removeError;
    }
  }

  if (groupId) {
    const { error: addError } = await supabase
      .from("group_members")
      .upsert({ group_id: groupId, student_id: studentId }, { onConflict: "group_id,student_id" });

    if (addError) {
      throw addError;
    }
  }

  revalidatePath("/admin");
  revalidatePath("/");
}

export async function clearClassGroupAssignments(formData: FormData) {
  await requireAdmin();
  const classNo = numberValue(formData, "classNo");

  if (!(await isConfiguredClassNo(classNo))) {
    throw new Error("Invalid class number.");
  }

  const supabase = createServiceSupabase();
  const activeHomeId = await getScopedHomeId();
  let query = supabase
    .from("groups")
    .select("id")
    .eq("class_no", classNo)
    .is("deleted_at", null);

  if (activeHomeId) {
    query = query.eq("home_id", activeHomeId);
  }

  const { data: groups, error } = await query;

  if (error) {
    throw error;
  }

  const groupIds = (groups ?? []).map((group) => group.id as string);

  if (groupIds.length) {
    const { error: deleteError } = await supabase
      .from("group_members")
      .delete()
      .in("group_id", groupIds);

    if (deleteError) {
      throw deleteError;
    }
  }

  revalidatePath("/admin");
  revalidatePath("/");
}

export async function deleteStudent(formData: FormData) {
  await requireAdmin();
  const id = text(formData, "studentId");
  const activeHomeId = await getScopedHomeId();
  let query = createServiceSupabase().from("students").delete().eq("id", id);
  if (activeHomeId) {
    query = query.eq("home_id", activeHomeId);
  }
  const { error } = await query;
  if (error) {
    throw error;
  }

  revalidatePath("/admin");
  redirect(adminPath(returnClassNo(formData)));
}

export async function deleteClassStudents(formData: FormData) {
  await requireAdmin();
  const classNo = numberValue(formData, "classNo");

  if (!(await isConfiguredClassNo(classNo))) {
    redirect(adminErrorPath("bad-student", returnClassNo(formData)));
  }

  const supabase = createServiceSupabase();
  const activeHomeId = await getScopedHomeId();
  let query = supabase
    .from("students")
    .select("id, sort_order")
    .eq("class_no", classNo);

  if (activeHomeId) {
    query = query.eq("home_id", activeHomeId);
  }

  const { data: students, error: studentsError } = await query;

  if (studentsError) {
    throw studentsError;
  }

  const studentIds = (students ?? []).map((student) => student.id as string);

  if (studentIds.length) {
    const { error: memberError } = await supabase
      .from("group_members")
      .delete()
      .in("student_id", studentIds);

    if (memberError) {
      throw memberError;
    }

    let deleteQuery = supabase
      .from("students")
      .delete()
      .eq("class_no", classNo);

    if (activeHomeId) {
      deleteQuery = deleteQuery.eq("home_id", activeHomeId);
    }

    const { error: deleteError } = await deleteQuery;

    if (deleteError) {
      throw deleteError;
    }
  }

  revalidatePath("/admin");
  revalidatePath("/");
  redirect(adminPath(returnClassNo(formData, classNo)));
}

export async function createGroup(formData: FormData) {
  await requireAdmin();
  const classNo = numberValue(formData, "classNo");
  const password = text(formData, "password");

  if (!(await isConfiguredClassNo(classNo))) {
    redirect(adminErrorPath("bad-group", returnClassNo(formData)));
  }

  const supabase = createServiceSupabase();
  const activeHomeId = await getScopedHomeId();
  let lastQuery = supabase
    .from("groups")
    .select("sort_order")
    .eq("class_no", classNo)
    .is("deleted_at", null)
    .order("sort_order", { ascending: false })
    .limit(1);

  if (activeHomeId) {
    lastQuery = lastQuery.eq("home_id", activeHomeId);
  }

  const { data: last } = await lastQuery.maybeSingle();

  const { error } = await supabase.from("groups").insert({
    ...(activeHomeId ? { home_id: activeHomeId } : {}),
    class_no: classNo,
    sort_order: (last?.sort_order ?? 0) + 1,
    password_hash: password ? hashPassword(password) : null,
  });

  if (error) {
    throw error;
  }

  revalidatePath("/admin");
  revalidatePath("/");
  redirect(adminPath(returnClassNo(formData, classNo)));
}

export async function setClassCount(formData: FormData) {
  await requireAdmin();
  const targetCount = clampClassCount(numberValue(formData, "classCount") || 0);
  const currentCount = await getConfiguredClassCount();
  const minimumCount = await getMinimumConfiguredClassCount();
  const activeHomeId = await getScopedHomeId();

  if (targetCount < minimumCount) {
    throw new Error(`현재 데이터가 있는 학급이 ${minimumCount}개 있어 더 줄일 수 없습니다.`);
  }

  const supabase = createServiceSupabase();
  const settingsProbe = activeHomeId
    ? await supabase
        .from("homes")
        .select("class_count")
        .eq("id", activeHomeId)
        .single()
    : await supabase
        .from("app_settings")
        .upsert({ id: true, class_count: currentCount }, { onConflict: "id" })
        .select("class_count")
        .single();

  if (settingsProbe.error) {
    if (settingsProbe.error.code === "42P01" || settingsProbe.error.code === "42703") {
      throw new Error("학급 수 저장을 위해 DB 업데이트가 필요합니다.");
    }

    throw settingsProbe.error;
  }

  if (targetCount > currentCount) {
    await ensureInitialClassGroups(6, targetCount, activeHomeId);
  }

  if (targetCount < currentCount) {
    let groupsQuery = supabase
      .from("groups")
      .select("id")
      .gt("class_no", targetCount)
      .is("deleted_at", null);

    if (activeHomeId) {
      groupsQuery = groupsQuery.eq("home_id", activeHomeId);
    }

    const { data: removableGroups, error: groupsError } = await groupsQuery;

    if (groupsError) {
      throw groupsError;
    }

    const removableGroupIds = (removableGroups ?? []).map((group) => group.id as string);

    if (removableGroupIds.length) {
      const { error: memberError } = await supabase
        .from("group_members")
        .delete()
        .in("group_id", removableGroupIds);

      if (memberError) {
        throw memberError;
      }

      const { error: deleteError } = await supabase
        .from("groups")
        .update({ deleted_at: new Date().toISOString() })
        .in("id", removableGroupIds);

      if (deleteError) {
        throw deleteError;
      }
    }
  }

  const settingsResult = activeHomeId
    ? await supabase
        .from("homes")
        .update({ class_count: targetCount })
        .eq("id", activeHomeId)
        .select("class_count")
        .single()
    : await supabase
        .from("app_settings")
        .upsert({ id: true, class_count: targetCount }, { onConflict: "id" })
        .select("class_count")
        .single();

  if (settingsResult.error) {
    if (settingsResult.error.code === "42P01" || settingsResult.error.code === "42703") {
      throw new Error("학급 수 저장을 위해 DB 업데이트가 필요합니다.");
    }

    throw settingsResult.error;
  }

  revalidatePath("/admin");
  revalidatePath("/");

  const nextClassCount = clampClassCount(settingsResult.data.class_count as number);

  return {
    classCount: nextClassCount,
    classNumbers: buildClassNumbers(nextClassCount),
    currentClassNo: Math.min(returnClassNo(formData, 1) ?? 1, nextClassCount),
    minimumClassCount: minimumCount,
  };
}

export async function updateHomeManagementSettings(formData: FormData) {
  await requireAdmin();
  const packagesInput = String(formData.get("packages") ?? "[]");
  const activeIndexInput = numberValue(formData, "activeIndex");
  let packages = [createDefaultHomePackage()];

  try {
    packages = normalizeHomePackages(JSON.parse(packagesInput)).map((homePackage) => ({
      id: homePackage.id,
      line1: homePackage.line1.trim(),
      line2: homePackage.line2.trim(),
      classCount: clampClassCount(homePackage.classCount || 1),
      selectedIndex: 0,
      rows: [{
        line1: homePackage.line1.trim(),
        line2: homePackage.line2.trim(),
      }],
    }));
  } catch {
    throw new Error("홈 관리 데이터 형식이 올바르지 않습니다.");
  }

  const activeIndex = Math.min(
    Math.max(0, Number.isInteger(activeIndexInput) ? activeIndexInput : 0),
    packages.length - 1,
  );
  const supabase = createServiceSupabase();
  const existingHomesResult = await supabase
    .from("homes")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (existingHomesResult.error) {
    if (existingHomesResult.error.code === "42P01" || existingHomesResult.error.code === "42703") {
      throw new Error("홈 관리 저장을 위해 DB 업데이트가 필요합니다.");
    }

    throw existingHomesResult.error;
  }

  const existingHomes = (existingHomesResult.data ?? []) as Home[];
  const existingHomeById = new Map(existingHomes.map((home) => [home.id, home]));
  const submittedIds = new Set(
    packages
      .map((homePackage) => homePackage.id)
      .filter((homeId): homeId is string => Boolean(homeId)),
  );

  for (const [index, homePackage] of packages.entries()) {
    const sortOrder = index + 1;
    if (homePackage.id && existingHomeById.has(homePackage.id)) {
      const existingHome = existingHomeById.get(homePackage.id)!;
      const titleChanged =
        existingHome.title_line1 !== homePackage.line1 ||
        existingHome.title_line2 !== homePackage.line2 ||
        existingHome.sort_order !== sortOrder;

      if (titleChanged) {
        const { error } = await supabase
          .from("homes")
          .update({
            sort_order: sortOrder,
            title_line1: homePackage.line1,
            title_line2: homePackage.line2,
          })
          .eq("id", homePackage.id);

        if (error) {
          throw error;
        }
      }

      continue;
    }

    const { data: insertedHome, error: insertError } = await supabase
      .from("homes")
      .insert({
        sort_order: sortOrder,
        title_line1: homePackage.line1,
        title_line2: homePackage.line2,
        class_count: 1,
      })
      .select("*")
      .single();

    if (insertError) {
      throw insertError;
    }

    await ensureInitialClassGroups(6, 1, insertedHome.id as string);
  }

  const removedHomeIds = existingHomes
    .filter((home) => !submittedIds.has(home.id))
    .map((home) => home.id);

  if (removedHomeIds.length) {
    await deleteHomesAndRelatedData(removedHomeIds);
  }

  const finalHomesResult = await supabase
    .from("homes")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (finalHomesResult.error) {
    throw finalHomesResult.error;
  }

  const finalHomes = (finalHomesResult.data ?? []) as Home[];
  const safeActiveIndex = Math.min(Math.max(0, activeIndex), Math.max(0, finalHomes.length - 1));
  const activeHome = finalHomes[safeActiveIndex] ?? finalHomes[0] ?? null;
  const normalizedPackages = finalHomes.map((home) => ({
    id: home.id,
    line1: home.title_line1,
    line2: home.title_line2,
    classCount: clampClassCount(home.class_count),
    rows: [{ line1: home.title_line1, line2: home.title_line2 }],
    selectedIndex: 0,
  }));

  const settingsResult = await supabase
    .from("app_settings")
    .upsert(
      {
        id: true,
        class_count: activeHome?.class_count ?? 1,
        active_home_id: activeHome?.id ?? null,
        home_packages: normalizedPackages,
        active_home_index: safeActiveIndex,
        home_title_line1: activeHome?.title_line1 ?? "",
        home_title_line2: activeHome?.title_line2 ?? "",
        home_title_rows: [{ line1: activeHome?.title_line1 ?? "", line2: activeHome?.title_line2 ?? "" }],
        home_title_selected_index: 0,
      },
      { onConflict: "id" },
    )
    .select("active_home_index")
    .single();

  if (settingsResult.error) {
    throw settingsResult.error;
  }

  revalidatePath("/");
  revalidatePath("/admin");

  return {
    packages: normalizedPackages,
    activeIndex:
      typeof settingsResult.data.active_home_index === "number"
        ? settingsResult.data.active_home_index
        : safeActiveIndex,
  };
}

export const updateHomeTitleSettings = updateHomeManagementSettings;

export async function updateClassGroupPasswords(formData: FormData) {
  await requireAdmin();
  const classNo = numberValue(formData, "classNo");
  const password = text(formData, "password");
  const clearPassword = text(formData, "clearPassword") === "1";

  if (!(await isConfiguredClassNo(classNo))) {
    throw new Error("Invalid class number.");
  }

  if (!clearPassword && !password) {
    throw new Error("비밀번호를 입력하세요.");
  }

  const supabase = createServiceSupabase();
  const activeHomeId = await getScopedHomeId();
  let query = supabase
    .from("groups")
    .select("id")
    .eq("class_no", classNo)
    .is("deleted_at", null);

  if (activeHomeId) {
    query = query.eq("home_id", activeHomeId);
  }

  const { data: groups, error: groupsError } = await query;

  if (groupsError) {
    throw groupsError;
  }

  const activeGroupIds = (groups ?? []).map((group) => group.id as string);
  const nextPasswordHash = clearPassword ? null : hashPassword(password);

  await Promise.all(
    activeGroupIds.map(async (groupId) => {
      const { error } = await supabase
        .from("groups")
        .update({ password_hash: nextPasswordHash, access_nonce: randomUUID() })
        .eq("id", groupId);

      if (error?.code === "42703") {
        const fallback = await supabase
          .from("groups")
          .update({ password_hash: nextPasswordHash })
          .eq("id", groupId);

        if (fallback.error) {
          throw fallback.error;
        }

        return;
      }

      if (error) {
        throw error;
      }
    }),
  );

  for (const groupId of activeGroupIds) {
    revalidatePath(`/classes/${classNo}/groups/${groupId}`);
    revalidatePath(`/classes/${classNo}/groups/${groupId}/trash`);
  }

  revalidatePath("/admin");
  revalidatePath("/");

  return { groups: await sanitizeClientGroups(await activeGroupsForClass(classNo)) };
}

export async function setClassGroupCount(formData: FormData) {
  await requireAdmin();
  const classNo = numberValue(formData, "classNo");
  const targetCount = Math.max(0, Math.min(26, numberValue(formData, "groupCount") || 0));

  if (!(await isConfiguredClassNo(classNo))) {
    throw new Error("Invalid class number.");
  }

  const supabase = createServiceSupabase();
  const activeHomeId = await getScopedHomeId();
  await normalizeClassGroupSortOrders(classNo, activeHomeId);
  let groupsQuery = supabase
    .from("groups")
    .select("id, sort_order, created_at")
    .eq("class_no", classNo)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (activeHomeId) {
    groupsQuery = groupsQuery.eq("home_id", activeHomeId);
  }

  const { data: groups, error } = await groupsQuery;

  if (error) {
    throw error;
  }

  const activeGroups = groups ?? [];
  const groupIds = activeGroups.map((group) => group.id as string);
  const { data: members, error: membersError } = groupIds.length
    ? await supabase.from("group_members").select("group_id").in("group_id", groupIds)
    : { data: [], error: null };

  if (membersError) {
    throw membersError;
  }

  const occupiedGroupIds = new Set((members ?? []).map((member) => member.group_id as string));

  if (targetCount < occupiedGroupIds.size) {
    throw new Error("Group count is lower than the number of occupied groups.");
  }

  if (targetCount > activeGroups.length) {
    const usedSortOrders = new Set(activeGroups.map((group) => group.sort_order as number));
    const sortedOrders = [...usedSortOrders].sort((a, b) => a - b);
    const minSortOrder = sortedOrders[0] ?? 1;
    let nextSortOrder = sortedOrders.at(-1) ?? 0;
    const sortOrdersToAdd: number[] = [];

    for (let order = minSortOrder; order <= nextSortOrder; order += 1) {
      if (!usedSortOrders.has(order)) {
        sortOrdersToAdd.push(order);
      }
      if (activeGroups.length + sortOrdersToAdd.length >= targetCount) {
        break;
      }
    }

    while (activeGroups.length + sortOrdersToAdd.length < targetCount) {
      nextSortOrder += 1;
      if (!usedSortOrders.has(nextSortOrder)) {
        sortOrdersToAdd.push(nextSortOrder);
      }
    }

    const rows = sortOrdersToAdd.map((sortOrder) => ({
      ...(activeHomeId ? { home_id: activeHomeId } : {}),
      class_no: classNo,
      sort_order: sortOrder,
      password_hash: null,
    }));
    const { error: insertError } = await supabase.from("groups").insert(rows);
    if (insertError) {
      throw insertError;
    }
  }

  if (targetCount < activeGroups.length) {
    const removeCount = activeGroups.length - targetCount;
    const removedGroupIds = activeGroups
      .filter((group) => !occupiedGroupIds.has(group.id as string))
      .sort((a, b) => (b.sort_order as number) - (a.sort_order as number))
      .slice(0, removeCount)
      .map((group) => group.id as string);

    if (removedGroupIds.length) {
      const { error: memberError } = await supabase
        .from("group_members")
        .delete()
        .in("group_id", removedGroupIds);
      if (memberError) {
        throw memberError;
      }

      const { error: deleteError } = await supabase
        .from("groups")
        .update({ deleted_at: new Date().toISOString() })
        .in("id", removedGroupIds);
      if (deleteError) {
        throw deleteError;
      }
    }
  }

  await normalizeClassGroupSortOrders(classNo, activeHomeId);

  revalidatePath("/admin");
  revalidatePath("/");
  return { groups: await sanitizeClientGroups(await activeGroupsForClass(classNo)) };
}

export async function compactClassGroupNames(formData: FormData) {
  await requireAdmin();
  const classNo = numberValue(formData, "classNo");

  if (!(await isConfiguredClassNo(classNo))) {
    throw new Error("Invalid class number.");
  }

  await compactClassGroupSortOrders(classNo);

  revalidatePath("/admin");
  revalidatePath("/");
  return { groups: await sanitizeClientGroups(await activeGroupsForClass(classNo)) };
}

export async function deleteEmptyGroups(formData: FormData) {
  await requireAdmin();
  const classNo = numberValue(formData, "classNo");

  if (!(await isConfiguredClassNo(classNo))) {
    throw new Error("Invalid class number.");
  }

  const supabase = createServiceSupabase();
  const activeHomeId = await getScopedHomeId();
  let query = supabase
    .from("groups")
    .select("id, sort_order")
    .eq("class_no", classNo)
    .is("deleted_at", null);

  if (activeHomeId) {
    query = query.eq("home_id", activeHomeId);
  }

  const { data: groups, error } = await query;

  if (error) {
    throw error;
  }

  const groupIds = (groups ?? []).map((group) => group.id as string);

  if (groupIds.length) {
    const { data: members, error: membersError } = await supabase
      .from("group_members")
      .select("group_id")
      .in("group_id", groupIds);

    if (membersError) {
      throw membersError;
    }

    const occupiedGroupIds = new Set((members ?? []).map((member) => member.group_id as string));
    const emptyGroupIds = groupIds.filter((groupId) => !occupiedGroupIds.has(groupId));

    if (emptyGroupIds.length) {
      const { error: deleteError } = await supabase
        .from("groups")
        .update({ deleted_at: new Date().toISOString() })
        .in("id", emptyGroupIds);

      if (deleteError) {
        throw deleteError;
      }
    }
  }

  await compactClassGroupSortOrders(classNo);

  revalidatePath("/admin");
  revalidatePath("/");
  return { groups: await sanitizeClientGroups(await activeGroupsForClass(classNo)) };
}

export async function updateGroupPassword(formData: FormData) {
  await requireAdmin();
  const groupId = text(formData, "groupId");
  const password = text(formData, `password-${groupId}`) || text(formData, "password");
  const clearPassword = text(formData, "clearPassword") === "1";
  const nextAccessNonce = randomUUID();

  if (!groupId) {
    throw new Error("Invalid group.");
  }

  if (!clearPassword && !password) {
    return { group: null };
  }

  const nextPasswordHash = clearPassword ? null : hashPassword(password);

  const supabase = createServiceSupabase();
  let result = await supabase
    .from("groups")
    .update({ password_hash: nextPasswordHash, access_nonce: nextAccessNonce })
    .eq("id", groupId)
    .select("*")
    .single();

  if (result.error?.code === "42703") {
    result = await supabase
      .from("groups")
      .update({ password_hash: nextPasswordHash })
      .eq("id", groupId)
      .select("*")
      .single();
  }

  if (result.error) {
    throw result.error;
  }

  const group = result.data as Group | null;

  if (group?.class_no) {
    revalidatePath(`/classes/${group.class_no}/groups/${groupId}`);
    revalidatePath(`/classes/${group.class_no}/groups/${groupId}/trash`);
  }

  revalidatePath("/admin");
  revalidatePath("/");

  return {
    group: group
      ? (await sanitizeClientGroups([{
          ...group,
          has_password: Boolean(group.password_hash),
        } as Group]))[0] ?? null
      : null,
  };
}

export async function moveGroup(formData: FormData) {
  await requireAdmin();
  const groupId = text(formData, "groupId");
  const direction = text(formData, "direction");
  const supabase = createServiceSupabase();
  const activeHomeId = await getScopedHomeId();

  const { data: group, error } = await supabase
    .from("groups")
    .select("id, home_id, class_no, sort_order")
    .eq("id", groupId)
    .single();

  if (error || !group) {
    redirect(adminErrorPath("bad-group", returnClassNo(formData)));
  }

  const operator = direction === "up" ? "lt" : "gt";
  const ascending = direction !== "up";
  let neighborQuery = supabase
    .from("groups")
    .select("id, sort_order")
    .eq("class_no", group.class_no)
    .is("deleted_at", null)
    .filter("sort_order", operator, group.sort_order)
    .order("sort_order", { ascending })
    .limit(1);

  if (activeHomeId) {
    neighborQuery = neighborQuery.eq("home_id", activeHomeId);
  }

  const { data: neighbor, error: neighborError } = await neighborQuery.maybeSingle();

  if (neighborError) {
    throw neighborError;
  }

  if (neighbor) {
    const [{ error: a }, { error: b }] = await Promise.all([
      supabase.from("groups").update({ sort_order: neighbor.sort_order }).eq("id", group.id),
      supabase.from("groups").update({ sort_order: group.sort_order }).eq("id", neighbor.id),
    ]);
    if (a || b) {
      throw a ?? b;
    }
  }

  revalidatePath("/admin");
  revalidatePath("/");
  redirect(adminPath(returnClassNo(formData, group.class_no)));
}

export async function deleteGroup(formData: FormData) {
  await requireAdmin();
  const groupId = text(formData, "groupId");

  const { error } = await createServiceSupabase()
    .from("groups")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", groupId);

  if (error) {
    throw error;
  }

  revalidatePath("/admin");
  revalidatePath("/");
  redirect(adminPath(returnClassNo(formData)));
}

export async function addGroupMember(formData: FormData) {
  await requireAdmin();
  const groupId = text(formData, "groupId");
  const studentId = text(formData, "studentId");

  const { error } = await createServiceSupabase()
    .from("group_members")
    .upsert({ group_id: groupId, student_id: studentId }, { onConflict: "group_id,student_id" });

  if (error) {
    throw error;
  }

  revalidatePath("/admin");
  redirect(adminPath(returnClassNo(formData)));
}

export async function removeGroupMember(formData: FormData) {
  await requireAdmin();
  const memberId = text(formData, "memberId");

  const { error } = await createServiceSupabase()
    .from("group_members")
    .delete()
    .eq("id", memberId);

  if (error) {
    throw error;
  }

  revalidatePath("/admin");
  redirect(adminPath(returnClassNo(formData)));
}

export async function uploadPhoto(formData: FormData) {
  const groupId = text(formData, "groupId");
  const classNo = numberValue(formData, "classNo");
  await requireGroupAccess(groupId, classNo);

  const files = formData
    .getAll("photo")
    .filter((file): file is File => file instanceof File && file.size > 0);

  if (!files.length || files.some((file) => !file.type.startsWith("image/"))) {
    redirect(`${groupPath(classNo, groupId)}?error=bad-photo`);
  }

  const supabase = createServiceSupabase();
  const rows = [];

  for (const file of files) {
    const fileName = safeFileName(file.name) || "photo";
    const storagePath = `${classNo}/${groupId}/${Date.now()}-${randomUUID()}-${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from("group-photos")
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      throw uploadError;
    }

    rows.push({
      group_id: groupId,
      storage_path: storagePath,
      original_name: file.name,
      mime_type: file.type,
      size: file.size,
    });
  }

  const { error } = await supabase.from("photos").insert(rows);

  if (error) {
    throw error;
  }

  revalidateTag(activePhotosTag(groupId), "max");
  revalidatePath(`/classes/${classNo}/groups/${groupId}`);
  redirect(groupPath(classNo, groupId));
}

export async function softDeletePhoto(formData: FormData) {
  const groupId = text(formData, "groupId");
  const classNo = numberValue(formData, "classNo");
  const photoId = text(formData, "photoId");
  await requireGroupAccess(groupId, classNo);

  const { error } = await createServiceSupabase()
    .from("photos")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", photoId)
    .eq("group_id", groupId);

  if (error) {
    throw error;
  }

  revalidateTag(activePhotosTag(groupId), "max");
  revalidateTag(deletedPhotosTag(groupId), "max");
  revalidatePath(`/classes/${classNo}/groups/${groupId}`);
  redirect(groupPath(classNo, groupId));
}

export async function softDeletePhotos(formData: FormData) {
  const groupId = text(formData, "groupId");
  const classNo = numberValue(formData, "classNo");
  const photoIds = Array.from(
    new Set(formData.getAll("photoId").map((value) => String(value).trim()).filter(Boolean)),
  );
  await requireGroupAccess(groupId, classNo);

  if (photoIds.length) {
    const { error } = await createServiceSupabase()
      .from("photos")
      .update({ deleted_at: new Date().toISOString() })
      .eq("group_id", groupId)
      .in("id", photoIds);

    if (error) {
      throw error;
    }
  }

  revalidateTag(activePhotosTag(groupId), "max");
  revalidateTag(deletedPhotosTag(groupId), "max");
  revalidatePath(`/classes/${classNo}/groups/${groupId}`);
  revalidatePath(`/classes/${classNo}/groups/${groupId}/trash`);
  redirect(groupPath(classNo, groupId));
}

export async function restorePhoto(formData: FormData) {
  const groupId = text(formData, "groupId");
  const classNo = numberValue(formData, "classNo");
  const photoId = text(formData, "photoId");
  await requireGroupAccess(groupId, classNo);

  const { error } = await createServiceSupabase()
    .from("photos")
    .update({ deleted_at: null })
    .eq("id", photoId)
    .eq("group_id", groupId);

  if (error) {
    throw error;
  }

  revalidateTag(activePhotosTag(groupId), "max");
  revalidateTag(deletedPhotosTag(groupId), "max");
  revalidatePath(`/classes/${classNo}/groups/${groupId}`);
  revalidatePath(`/classes/${classNo}/groups/${groupId}/trash`);
  redirect(groupTrashPath(classNo, groupId));
}

export async function emptyPhotoTrash(formData: FormData) {
  const groupId = text(formData, "groupId");
  const classNo = numberValue(formData, "classNo");
  await requireGroupAccess(groupId, classNo);

  const supabase = createServiceSupabase();
  const { data: photos, error: photoError } = await supabase
    .from("photos")
    .select("id, storage_path")
    .eq("group_id", groupId)
    .not("deleted_at", "is", null);

  if (photoError) {
    throw photoError;
  }

  const photoIds = (photos ?? []).map((photo) => photo.id as string);
  const storagePaths = (photos ?? []).map((photo) => photo.storage_path as string).filter(Boolean);

  if (storagePaths.length) {
    const { error: storageError } = await supabase.storage
      .from("group-photos")
      .remove(storagePaths);

    if (storageError) {
      throw storageError;
    }
  }

  if (photoIds.length) {
    const { error: deleteError } = await supabase
      .from("photos")
      .delete()
      .in("id", photoIds)
      .eq("group_id", groupId);

    if (deleteError) {
      throw deleteError;
    }
  }

  revalidateTag(activePhotosTag(groupId), "max");
  revalidateTag(deletedPhotosTag(groupId), "max");
  revalidatePath(`/classes/${classNo}/groups/${groupId}`);
  revalidatePath(`/classes/${classNo}/groups/${groupId}/trash`);
  redirect(groupTrashPath(classNo, groupId));
}

export async function getGroupDisplayLabel(classNo: number, groupId: string) {
  const { data, error } = await createServiceSupabase()
    .from("groups")
    .select("id, sort_order")
    .eq("id", groupId)
    .eq("class_no", classNo)
    .is("deleted_at", null)
    .single();

  if (error) {
    throw error;
  }

  return data ? groupName(classNo, Math.max(0, (data.sort_order as number) - 1)) : "그룹";
}
