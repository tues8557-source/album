import "server-only";

import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";

const PASSWORD_HASH_PREFIX = "scrypt";
const DEV_SESSION_SECRET = "album-dev-session-secret";

export const ADMIN_COOKIE = "album_admin";

const globalWarnings = globalThis as typeof globalThis & {
  __albumSessionSecretWarningShown?: boolean;
};

function warnSessionSecretFallback(message: string) {
  if (globalWarnings.__albumSessionSecretWarningShown) {
    return;
  }

  globalWarnings.__albumSessionSecretWarningShown = true;
  console.warn(message);
}

function sessionSecret() {
  const explicitSecret = process.env.SESSION_SECRET?.trim();
  if (explicitSecret) {
    return explicitSecret;
  }

  const compatibilitySecret =
    process.env.ADMIN_PASSWORD?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (compatibilitySecret) {
    warnSessionSecretFallback(
      "SESSION_SECRET is not set. Falling back to an existing environment secret. Set SESSION_SECRET explicitly.",
    );
    return compatibilitySecret;
  }

  if (process.env.NODE_ENV !== "production") {
    warnSessionSecretFallback(
      "SESSION_SECRET is not set. Using the development fallback secret. Set SESSION_SECRET explicitly.",
    );
    return DEV_SESSION_SECRET;
  }

  throw new Error("SESSION_SECRET environment variable is required.");
}

function sign(value: string): string {
  return createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

function legacyHashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");

  return `${PASSWORD_HASH_PREFIX}$${salt}$${derived}`;
}

export function isSecurePasswordHash(hash: string | null) {
  return Boolean(hash?.startsWith(`${PASSWORD_HASH_PREFIX}$`));
}

export function isLegacySha256PasswordHash(hash: string | null) {
  return Boolean(hash && /^[a-f0-9]{64}$/i.test(hash));
}

export function isPlaintextStoredPassword(hash: string | null) {
  return Boolean(hash && !isSecurePasswordHash(hash) && !isLegacySha256PasswordHash(hash));
}

export function needsPasswordRehash(hash: string | null) {
  return Boolean(hash) && !isSecurePasswordHash(hash);
}

function verifySecurePassword(password: string, hash: string) {
  const [, salt, storedHash] = hash.split("$");

  if (!salt || !storedHash) {
    return false;
  }

  const expected = Buffer.from(storedHash, "hex");
  const derived = scryptSync(password, salt, expected.length);

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function verifyPassword(password: string, hash: string | null): boolean {
  if (!hash) {
    return false;
  }

  if (isSecurePasswordHash(hash)) {
    return verifySecurePassword(password, hash);
  }

  if (password === hash) {
    return true;
  }

  const input = Buffer.from(legacyHashPassword(password));
  const stored = Buffer.from(hash);
  return input.length === stored.length && timingSafeEqual(input, stored);
}

export function createSignedToken(value: string): string {
  return `${value}.${sign(value)}`;
}

function groupAccessValue(groupId: string, accessNonce?: string | null) {
  return accessNonce ? `group:${groupId}:${accessNonce}` : `group:${groupId}`;
}

export function createGroupAccessToken(groupId: string, accessNonce?: string | null) {
  return createSignedToken(groupAccessValue(groupId, accessNonce));
}

export function groupAccessCookieName(groupId: string) {
  return `album_group_${groupId}`;
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

export function hasValidGroupAccessToken(
  token: string | undefined,
  groupId: string,
  accessNonce?: string | null,
) {
  return readSignedToken(token) === groupAccessValue(groupId, accessNonce);
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
