import "server-only";

import { unstable_cache } from "next/cache";
import { createServiceSupabase } from "./supabase/server";
import { activePhotosTag, deletedPhotosTag } from "./photo-assets";
import { CLASS_NUMBERS } from "./types";
import type { Group, GroupMember, Photo, Student } from "./types";

function normalizePhotoRecord(record: Record<string, unknown>) {
  return {
    ...record,
    is_favorite: Boolean(record.is_favorite),
  } as Photo;
}

export async function ensureInitialClassGroups(targetCount = 6) {
  const supabase = createServiceSupabase();

  const { data: existingGroups, error } = await supabase
    .from("groups")
    .select("class_no")
    .in("class_no", CLASS_NUMBERS);

  if (error) {
    throw error;
  }

  const initializedClassNos = new Set((existingGroups ?? []).map((group) => group.class_no as number));
  const rows = CLASS_NUMBERS.flatMap((classNo) => {
    if (initializedClassNos.has(classNo)) {
      return [];
    }

    return Array.from({ length: targetCount }, (_, index) => ({
      class_no: classNo,
      sort_order: index + 1,
      password_hash: null,
    }));
  });

  if (!rows.length) {
    await normalizeClassGroupSortOrders();
    return;
  }

  const { error: insertError } = await supabase.from("groups").insert(rows);

  if (insertError) {
    throw insertError;
  }

  await normalizeClassGroupSortOrders();
}

export async function normalizeClassGroupSortOrders(classNo?: number) {
  const supabase = createServiceSupabase();
  let query = supabase
    .from("groups")
    .select("id, class_no, sort_order, created_at")
    .is("deleted_at", null)
    .order("class_no", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (classNo) {
    query = query.eq("class_no", classNo);
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

  const { data: groups, error: groupsError } = await supabase
    .from("groups")
    .select("*")
    .eq("class_no", classNo)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

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

  return {
    groups: (groups ?? []) as Group[],
    members: (members ?? []) as unknown as GroupMember[],
  };
}

export async function getAdminData() {
  const supabase = createServiceSupabase();

  const [{ data: students, error: studentsError }, { data: groups, error }] =
    await Promise.all([
      supabase
        .from("students")
        .select("*")
        .order("class_no", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("groups")
        .select("*")
        .is("deleted_at", null)
        .order("class_no", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
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

  return {
    students: (students ?? []) as Student[],
    groups: (groups ?? []) as Group[],
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
