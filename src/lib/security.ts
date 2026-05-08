import "server-only";

import { createHmac, createHash, timingSafeEqual } from "crypto";

const SESSION_SECRET =
  process.env.ADMIN_PASSWORD ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "dev";

function sign(value: string): string {
  return createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

export function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

export function verifyPassword(password: string, hash: string | null): boolean {
  if (!hash) {
    return false;
  }

  if (password === hash) {
    return true;
  }

  const input = Buffer.from(hashPassword(password));
  const stored = Buffer.from(hash);
  return input.length === stored.length && timingSafeEqual(input, stored);
}

export function createSignedToken(value: string): string {
  return `${value}.${sign(value)}`;
}

export function readSignedToken(token: string | undefined): string | null {
  if (!token) {
    return null;
  }

  const separator = token.lastIndexOf(".");
  if (separator === -1) {
    return null;
  }

  const value = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = sign(value);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }

  return value;
}

export function isAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return false;
  }

  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
