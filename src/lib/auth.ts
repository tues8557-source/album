import "server-only";

import { cookies } from "next/headers";
import {
  ADMIN_COOKIE,
  createGroupAccessToken,
  createSignedToken,
  groupAccessCookieName,
  hasValidGroupAccessToken,
  hashPassword,
  isPlaintextStoredPassword,
  readSignedToken,
} from "./security";
import { createServiceSupabase } from "./supabase/server";
import type { Group } from "./types";

const SECURE_COOKIE = process.env.NODE_ENV === "production";

type GroupAccessState = {
  group: Group | null;
  admin: boolean;
  allowed: boolean;
  prompt: boolean;
  stale: boolean;
  publicCache: boolean;
};

async function upgradePlaintextGroupPassword(group: Group, supabase = createServiceSupabase()) {
  if (!isPlaintextStoredPassword(group.password_hash)) {
    return group;
  }

  const plaintextPassword = group.password_hash;
  if (!plaintextPassword) {
    return group;
  }

  const secureHash = hashPassword(plaintextPassword);
  const { data, error } = await supabase
    .from("groups")
    .update({ password_hash: secureHash })
    .eq("id", group.id)
    .select("*")
    .single();

  if (error || !data) {
    return group;
  }

  return {
    ...(data as Group),
    has_password: Boolean((data as Group).password_hash),
  };
}

export async function sanitizeClientGroups(groups: Group[]) {
  const supabase = createServiceSupabase();
  const normalizedGroups = await Promise.all(
    groups.map((group) => upgradePlaintextGroupPassword(group, supabase)),
  );

  return normalizedGroups.map((group) => ({
    ...group,
    access_nonce: null,
    has_password: Boolean(group.password_hash ?? group.has_password),
    password_hash: null,
  }));
}

export async function getGroupRecord(classNo: number, groupId: string) {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .eq("class_no", classNo)
    .is("deleted_at", null)
    .single();

  if (error || !data) {
    return null;
  }

  return upgradePlaintextGroupPassword({
    ...(data as Group),
    has_password: Boolean((data as Group).password_hash),
  }, supabase);
}

export async function hasAdminSession() {
  return readSignedToken((await cookies()).get(ADMIN_COOKIE)?.value) === "admin";
}

export async function setAdminSession() {
  (await cookies()).set(ADMIN_COOKIE, createSignedToken("admin"), {
    httpOnly: true,
    sameSite: "lax",
    secure: SECURE_COOKIE,
    path: "/",
  });
}

export async function clearAdminSession() {
  (await cookies()).delete(ADMIN_COOKIE);
}

export async function setGroupAccessSession(groupId: string, accessNonce?: string | null) {
  (await cookies()).set(groupAccessCookieName(groupId), createGroupAccessToken(groupId, accessNonce), {
    httpOnly: true,
    sameSite: "lax",
    secure: SECURE_COOKIE,
    path: "/",
  });
}

export async function clearGroupAccessSession(groupId: string) {
  (await cookies()).delete(groupAccessCookieName(groupId));
}

export async function getGroupAccessState(classNo: number, groupId: string): Promise<GroupAccessState> {
  const group = await getGroupRecord(classNo, groupId);

  if (!group) {
    return {
      group: null,
      admin: false,
      allowed: false,
      prompt: false,
      stale: false,
      publicCache: false,
    };
  }

  const admin = await hasAdminSession();
  const passwordProtected = Boolean(group.password_hash);
  const sessionCookie = (await cookies()).get(groupAccessCookieName(groupId))?.value;
  const sessionValid = hasValidGroupAccessToken(sessionCookie, groupId, group.access_nonce);

  return {
    group,
    admin,
    allowed: admin || !passwordProtected || sessionValid,
    prompt: passwordProtected && !admin && !sessionCookie,
    stale: passwordProtected && !admin && Boolean(sessionCookie) && !sessionValid,
    publicCache: !passwordProtected,
  };
}
