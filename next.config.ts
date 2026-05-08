import type { NextConfig } from "next";

function normalizeAllowedOrigin(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).host;
  } catch {
    return trimmed.replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null;
  }
}

const serverActionAllowedOrigins = [
  process.env.NEXT_PUBLIC_SITE_URL,
  process.env.VERCEL_URL,
  process.env.SERVER_ACTION_ALLOWED_ORIGINS,
  process.env.NODE_ENV === "development"
    ? [
        "localhost:3000",
        "127.0.0.1:3000",
        "*.app.github.dev",
        "*.githubpreview.dev",
        "*.ngrok-free.app",
      ].join(",")
    : undefined,
]
  .flatMap((value) => value?.split(",") ?? [])
  .map(normalizeAllowedOrigin)
  .filter((value): value is string => Boolean(value));

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
      ...(serverActionAllowedOrigins.length
        ? { allowedOrigins: Array.from(new Set(serverActionAllowedOrigins)) }
        : {}),
    },
  },
};

export default nextConfig;
