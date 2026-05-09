"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";

export function AdminHeaderWithHomeManagement({
  children,
  logoutAction,
}: {
  children: ReactNode;
  logoutAction: (formData: FormData) => void | Promise<void>;
}) {
  const [homeManagementOpen, setHomeManagementOpen] = useState(false);

  return (
    <>
      <header className="flex items-center justify-between gap-3">
        <div>
          <Link href="/" className="text-sm font-medium text-teal-700">
            홈으로
          </Link>
          <h1 className="mt-1 text-3xl font-bold">관리자</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-expanded={homeManagementOpen}
            onClick={() => setHomeManagementOpen((current) => !current)}
            className={`rounded-md px-3 py-2 text-sm font-semibold ${
              homeManagementOpen
                ? "bg-zinc-900 text-white"
                : "border border-zinc-300 bg-white text-zinc-900"
            }`}
          >
            홈 관리
          </button>
          <form action={logoutAction}>
            <button className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold">
              로그아웃
            </button>
          </form>
        </div>
      </header>

      {homeManagementOpen ? children : null}
    </>
  );
}
