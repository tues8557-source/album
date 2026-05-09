import "server-only";

import { headers } from "next/headers";

type RateLimitEntry = {
  count: number;
  resetAt: number;
  blockedUntil: number;
};

type RateLimitOptions = {
  windowMs: number;
  maxAttempts: number;
  blockMs: number;
};

const DEFAULT_OPTIONS: RateLimitOptions = {
  windowMs: 10 * 60 * 1000,
  maxAttempts: 10,
  blockMs: 15 * 60 * 1000,
};

const globalStore = globalThis as typeof globalThis & {
  __albumRateLimitStore?: Map<string, RateLimitEntry>;
};

function rateLimitStore() {
  if (!globalStore.__albumRateLimitStore) {
    globalStore.__albumRateLimitStore = new Map<string, RateLimitEntry>();
  }

  return globalStore.__albumRateLimitStore;
}

function entryKey(scope: string, key: string) {
  return `${scope}:${key}`;
}

function freshEntry(now: number, options: RateLimitOptions): RateLimitEntry {
  return {
    count: 0,
    resetAt: now + options.windowMs,
    blockedUntil: 0,
  };
}

function normalizeEntry(key: string, options: RateLimitOptions) {
  const now = Date.now();
  const store = rateLimitStore();
  const current = store.get(key);

  if (!current || current.resetAt <= now) {
    const next = freshEntry(now, options);
    store.set(key, next);
    return { entry: next, now };
  }

  return { entry: current, now };
}

export async function rateLimitKey(suffix = "") {
  const headerStore = await headers();
  const forwarded = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = headerStore.get("x-real-ip")?.trim();
  const ip = forwarded || realIp || "unknown";

  return suffix ? `${ip}:${suffix}` : ip;
}

export function isRateLimited(scope: string, key: string, options: Partial<RateLimitOptions> = {}) {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const storeKey = entryKey(scope, key);
  const { entry, now } = normalizeEntry(storeKey, resolved);

  if (entry.blockedUntil > now) {
    return {
      limited: true,
      retryAfterMs: entry.blockedUntil - now,
    };
  }

  return {
    limited: false,
    retryAfterMs: 0,
  };
}

export function recordRateLimitFailure(scope: string, key: string, options: Partial<RateLimitOptions> = {}) {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const storeKey = entryKey(scope, key);
  const { entry, now } = normalizeEntry(storeKey, resolved);

  if (entry.blockedUntil > now) {
    return {
      limited: true,
      retryAfterMs: entry.blockedUntil - now,
    };
  }

  entry.count += 1;

  if (entry.count >= resolved.maxAttempts) {
    entry.count = 0;
    entry.resetAt = now + resolved.windowMs;
    entry.blockedUntil = now + resolved.blockMs;
    rateLimitStore().set(storeKey, entry);

    return {
      limited: true,
      retryAfterMs: resolved.blockMs,
    };
  }

  rateLimitStore().set(storeKey, entry);

  return {
    limited: false,
    retryAfterMs: Math.max(0, entry.resetAt - now),
  };
}

export function clearRateLimit(scope: string, key: string) {
  rateLimitStore().delete(entryKey(scope, key));
}
