"use server";

import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { activePhotosTag, deletedPhotosTag } from "@/lib/photo-assets";
import { createServiceSupabase } from "@/lib/supabase/server";
import { compactClassGroupSortOrders, normalizeClassGroupSortOrders } from "@/lib/data";
import { groupName, isClassNumber, safeFileName } from "@/lib/format";
import type { Group } from "@/lib/types";
import {
  createSignedToken,
  createGroupAccessToken,
  isAdminPassword,
  hasValidGroupAccessToken,
  readSignedToken,
  verifyPassword,
} from "@/lib/security";

const ADMIN_COOKIE = "album_admin";

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

function adminPath(classNo?: number) {
  return isClassNumber(classNo ?? 0) ? `/admin?classNo=${classNo}` : "/admin";
}

function adminErrorPath(error: string, classNo?: number) {
  const separator = isClassNumber(classNo ?? 0) ? "&" : "?";
  return `${adminPath(classNo)}${separator}error=${error}`;
}

function homePathForGroup(
  classNo: number,
  {
    errorGroupId,
    staleGroupId,
  }: {
    errorGroupId?: string;
    staleGroupId?: string;
  },
) {
  const params = new URLSearchParams({ classNo: String(classNo) });

  if (errorGroupId) {
    params.set("errorGroupId", errorGroupId);
  }

  if (staleGroupId) {
    params.set("staleGroupId", staleGroupId);
  }

  return `/?${params.toString()}`;
}

function returnClassNo(formData: FormData, fallback?: number) {
  const classNo = numberValue(formData, "returnClassNo");
  return isClassNumber(classNo) ? classNo : fallback;
}

async function hasAdminSession() {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  return readSignedToken(token) === "admin";
}

async function requireAdmin() {
  if (!(await hasAdminSession())) {
    redirect("/admin");
  }
}

async function activeGroupsForClass(classNo: number) {
  const { data, error } = await createServiceSupabase()
    .from("groups")
    .select("*")
    .eq("class_no", classNo)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as Group[];
}

async function requireGroupAccess(groupId: string, classNo: number, accessToken: string) {
  if (await hasAdminSession()) {
    return;
  }

  const { data: group, error } = await createServiceSupabase()
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .eq("class_no", classNo)
    .is("deleted_at", null)
    .single();

  if (error || !group) {
    redirect(`/classes/${classNo}/groups/${groupId}`);
  }

  if (!group.password_hash) {
    return;
  }

  if (!accessToken) {
    redirect(`/classes/${classNo}/groups/${groupId}`);
  }

  if (!hasValidGroupAccessToken(accessToken, groupId, group.access_nonce)) {
    redirect(homePathForGroup(classNo, { staleGroupId: groupId }));
  }
}

export async function loginAdmin(formData: FormData) {
  if (!isAdminPassword(text(formData, "password"))) {
    redirect("/admin?error=bad-password");
  }

  (await cookies()).set(ADMIN_COOKIE, createSignedToken("admin"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect("/admin");
}

export async function logoutAdmin() {
  (await cookies()).delete(ADMIN_COOKIE);
  redirect("/");
}

export async function loginGroup(formData: FormData) {
  const groupId = text(formData, "groupId");
  const classNo = numberValue(formData, "classNo");
  const password = text(formData, `password-${groupId}`) || text(formData, "password");
  const admin = await hasAdminSession();
  const supabase = createServiceSupabase();

  const { data: group, error } = await supabase
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .eq("class_no", classNo)
    .is("deleted_at", null)
    .single();

  if (error || !group || (group.password_hash && !admin && !verifyPassword(password, group.password_hash))) {
    redirect(homePathForGroup(classNo, { errorGroupId: groupId }));
  }

  const access = encodeURIComponent(createGroupAccessToken(groupId, group.access_nonce));
  redirect(`/classes/${classNo}/groups/${groupId}?access=${access}`);
}

export async function createStudent(formData: FormData) {
  await requireAdmin();
  const classNo = numberValue(formData, "classNo");
  const name = text(formData, "name");
  const gender = nullableGender(text(formData, "gender"));

  if (!isClassNumber(classNo) || !name) {
    redirect(adminErrorPath("bad-student", returnClassNo(formData)));
  }

  const supabase = createServiceSupabase();
  const { data: last } = await supabase
    .from("students")
    .select("sort_order")
    .eq("class_no", classNo)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("students").insert({
    class_no: classNo,
    name,
    gender,
    sort_order: (last?.sort_order ?? 0) + 1,
  });

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

  if (!isClassNumber(classNo)) {
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
  const { data: last } = await supabase
    .from("students")
    .select("sort_order")
    .eq("class_no", classNo)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const startOrder = last?.sort_order ?? 0;
  const { error } = await supabase.from("students").insert(
    rows.map((student, index) => ({
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

  if (!isClassNumber(classNo)) {
    redirect(adminErrorPath("bad-student", returnClassNo(formData)));
  }

  const studentIds = formData.getAll("studentId").map((value) => String(value).trim());
  const rowKeys = formData.getAll("studentRowKey").map((value) => String(value).trim());
  const names = formData.getAll("studentName").map((value) => String(value).trim());
  const genders = formData.getAll("studentGender").map((value) => String(value).trim());
  const groupIds = formData.getAll("studentGroupId").map((value) => String(value).trim());
  const deleted = formData.getAll("studentDeleted").map((value) => String(value).trim() === "1");
  const supabase = createServiceSupabase();

  const [
    { data: existingStudents, error: studentsError },
    { data: classGroups, error: groupsError },
  ] = await Promise.all([
    supabase.from("students").select("id").eq("class_no", classNo),
    supabase.from("groups").select("id").eq("class_no", classNo).is("deleted_at", null),
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

      const { error } = await supabase.from("students").delete().eq("id", id).eq("class_no", classNo);
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
      const { error } = await supabase
        .from("students")
        .update({ name, gender, sort_order: nextSortOrder })
        .eq("id", id)
        .eq("class_no", classNo);
      if (error) {
        if (gender === null && isStudentGenderConstraintError(error)) {
          blankGenderNeedsSchemaUpdate = true;
          const { error: fallbackError } = await supabase
            .from("students")
            .update({ name, sort_order: nextSortOrder })
            .eq("id", id)
            .eq("class_no", classNo);

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
        .insert({ class_no: classNo, name, gender, sort_order: nextSortOrder })
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

    const { error } = await supabase
      .from("students")
      .update({ sort_order: nextSortOrder })
      .eq("id", id)
      .eq("class_no", classNo);
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

  if (!id || !isClassNumber(classNo) || !name) {
    redirect(adminErrorPath("bad-student", returnClassNo(formData, classNo)));
  }

  const { error } = await createServiceSupabase()
    .from("students")
    .update({ class_no: classNo, name, gender, sort_order: sortOrder || 0 })
    .eq("id", id);

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

  if (!studentId || !isClassNumber(classNo)) {
    throw new Error("Invalid student group update.");
  }

  const supabase = createServiceSupabase();
  const [
    { data: student, error: studentError },
    { data: classGroups, error: groupsError },
  ] = await Promise.all([
    supabase.from("students").select("id").eq("id", studentId).eq("class_no", classNo).single(),
    supabase.from("groups").select("id").eq("class_no", classNo).is("deleted_at", null),
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

  if (!isClassNumber(classNo)) {
    throw new Error("Invalid class number.");
  }

  const supabase = createServiceSupabase();
  const { data: groups, error } = await supabase
    .from("groups")
    .select("id")
    .eq("class_no", classNo)
    .is("deleted_at", null);

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

  const { error } = await createServiceSupabase().from("students").delete().eq("id", id);
  if (error) {
    throw error;
  }

  revalidatePath("/admin");
  redirect(adminPath(returnClassNo(formData)));
}

export async function deleteClassStudents(formData: FormData) {
  await requireAdmin();
  const classNo = numberValue(formData, "classNo");

  if (!isClassNumber(classNo)) {
    redirect(adminErrorPath("bad-student", returnClassNo(formData)));
  }

  const supabase = createServiceSupabase();
  const { data: students, error: studentsError } = await supabase
    .from("students")
    .select("id, sort_order")
    .eq("class_no", classNo);

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

    const { error: deleteError } = await supabase
      .from("students")
      .delete()
      .eq("class_no", classNo);

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

  if (!isClassNumber(classNo)) {
    redirect(adminErrorPath("bad-group", returnClassNo(formData)));
  }

  const supabase = createServiceSupabase();
  const { data: last } = await supabase
    .from("groups")
    .select("sort_order")
    .eq("class_no", classNo)
    .is("deleted_at", null)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("groups").insert({
    class_no: classNo,
    sort_order: (last?.sort_order ?? 0) + 1,
    password_hash: password || null,
  });

  if (error) {
    throw error;
  }

  revalidatePath("/admin");
  revalidatePath("/");
  redirect(adminPath(returnClassNo(formData, classNo)));
}

export async function setClassGroupCount(formData: FormData) {
  await requireAdmin();
  const classNo = numberValue(formData, "classNo");
  const targetCount = Math.max(0, Math.min(26, numberValue(formData, "groupCount") || 0));

  if (!isClassNumber(classNo)) {
    throw new Error("Invalid class number.");
  }

  const supabase = createServiceSupabase();
  await normalizeClassGroupSortOrders(classNo);
  const { data: groups, error } = await supabase
    .from("groups")
    .select("id, sort_order, created_at")
    .eq("class_no", classNo)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

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

  await normalizeClassGroupSortOrders(classNo);

  revalidatePath("/admin");
  revalidatePath("/");
  return { groups: await activeGroupsForClass(classNo) };
}

export async function compactClassGroupNames(formData: FormData) {
  await requireAdmin();
  const classNo = numberValue(formData, "classNo");

  if (!isClassNumber(classNo)) {
    throw new Error("Invalid class number.");
  }

  await compactClassGroupSortOrders(classNo);

  revalidatePath("/admin");
  revalidatePath("/");
  return { groups: await activeGroupsForClass(classNo) };
}

export async function deleteEmptyGroups(formData: FormData) {
  await requireAdmin();
  const classNo = numberValue(formData, "classNo");

  if (!isClassNumber(classNo)) {
    throw new Error("Invalid class number.");
  }

  const supabase = createServiceSupabase();
  const { data: groups, error } = await supabase
    .from("groups")
    .select("id, sort_order")
    .eq("class_no", classNo)
    .is("deleted_at", null);

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

  revalidatePath("/admin");
  revalidatePath("/");
  return { groups: await activeGroupsForClass(classNo) };
}

export async function updateGroupPassword(formData: FormData) {
  await requireAdmin();
  const groupId = text(formData, "groupId");
  const password = text(formData, `password-${groupId}`) || text(formData, "password");
  const nextAccessNonce = randomUUID();

  if (!groupId) {
    throw new Error("Invalid group.");
  }

  const supabase = createServiceSupabase();
  let result = await supabase
    .from("groups")
    .update({ password_hash: password || null, access_nonce: nextAccessNonce })
    .eq("id", groupId)
    .select("*")
    .single();

  if (result.error?.code === "42703") {
    result = await supabase
      .from("groups")
      .update({ password_hash: password || null })
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
}

export async function moveGroup(formData: FormData) {
  await requireAdmin();
  const groupId = text(formData, "groupId");
  const direction = text(formData, "direction");
  const supabase = createServiceSupabase();

  const { data: group, error } = await supabase
    .from("groups")
    .select("id, class_no, sort_order")
    .eq("id", groupId)
    .single();

  if (error || !group) {
    redirect(adminErrorPath("bad-group", returnClassNo(formData)));
  }

  const operator = direction === "up" ? "lt" : "gt";
  const ascending = direction !== "up";
  const { data: neighbor, error: neighborError } = await supabase
    .from("groups")
    .select("id, sort_order")
    .eq("class_no", group.class_no)
    .is("deleted_at", null)
    .filter("sort_order", operator, group.sort_order)
    .order("sort_order", { ascending })
    .limit(1)
    .maybeSingle();

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
  const access = text(formData, "access");
  await requireGroupAccess(groupId, classNo, access);

  const files = formData
    .getAll("photo")
    .filter((file): file is File => file instanceof File && file.size > 0);

  if (!files.length || files.some((file) => !file.type.startsWith("image/"))) {
    redirect(`/classes/${classNo}/groups/${groupId}?error=bad-photo&access=${encodeURIComponent(access)}`);
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
  redirect(`/classes/${classNo}/groups/${groupId}?access=${encodeURIComponent(access)}`);
}

export async function softDeletePhoto(formData: FormData) {
  const groupId = text(formData, "groupId");
  const classNo = numberValue(formData, "classNo");
  const photoId = text(formData, "photoId");
  const access = text(formData, "access");
  await requireGroupAccess(groupId, classNo, access);

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
  redirect(`/classes/${classNo}/groups/${groupId}?access=${encodeURIComponent(access)}`);
}

export async function softDeletePhotos(formData: FormData) {
  const groupId = text(formData, "groupId");
  const classNo = numberValue(formData, "classNo");
  const access = text(formData, "access");
  const photoIds = Array.from(
    new Set(formData.getAll("photoId").map((value) => String(value).trim()).filter(Boolean)),
  );
  await requireGroupAccess(groupId, classNo, access);

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
  redirect(`/classes/${classNo}/groups/${groupId}?access=${encodeURIComponent(access)}`);
}

export async function restorePhoto(formData: FormData) {
  const groupId = text(formData, "groupId");
  const classNo = numberValue(formData, "classNo");
  const photoId = text(formData, "photoId");
  const access = text(formData, "access");
  await requireGroupAccess(groupId, classNo, access);

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
  redirect(`/classes/${classNo}/groups/${groupId}/trash?access=${encodeURIComponent(access)}`);
}

export async function emptyPhotoTrash(formData: FormData) {
  const groupId = text(formData, "groupId");
  const classNo = numberValue(formData, "classNo");
  const access = text(formData, "access");
  await requireGroupAccess(groupId, classNo, access);

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
  redirect(`/classes/${classNo}/groups/${groupId}/trash?access=${encodeURIComponent(access)}`);
}

export async function getGroupDisplayLabel(classNo: number, groupId: string) {
  const { data, error } = await createServiceSupabase()
    .from("groups")
    .select("id, sort_order")
    .eq("class_no", classNo)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw error;
  }

  const group = (data ?? []).find((item) => item.id === groupId);
  return group ? groupName(classNo, Math.max(0, (group.sort_order as number) - 1)) : "그룹";
}
