import { cookies } from "next/headers";
import Link from "next/link";
import { logoutAdmin } from "@/app/actions";
import { ClassGroupTabs } from "@/app/class-group-tabs";
import { ensureInitialClassGroups, getClassGroups } from "@/lib/data";
import { isClassNumber } from "@/lib/format";
import { isMissingSchemaError, SetupError } from "@/lib/setup-error";
import { readSignedToken } from "@/lib/security";
import { CLASS_NUMBERS, type ClassNumber } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ classNo?: string; errorGroupId?: string }>;
}) {
  const params = await searchParams;
  const requestedClassNo = Number.parseInt(params.classNo ?? "", 10);
  const initialClassNo = (isClassNumber(requestedClassNo) ? requestedClassNo : 1) as ClassNumber;
  const admin = readSignedToken((await cookies()).get("album_admin")?.value) === "admin";
  let classData;

  try {
    await ensureInitialClassGroups(6);
    classData = await Promise.all(
      CLASS_NUMBERS.map(async (classNo) => ({
        classNo,
        ...(await getClassGroups(classNo)),
      })),
    );
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return <SetupError />;
    }

    throw error;
  }

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-5 sm:px-6 sm:py-8">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-teal-700">매안초 졸업앨범 촬영 준비</p>
            <h1 className="mt-1 text-2xl font-bold tracking-normal">학교배경 컨셉사진</h1>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Link
              href="/admin"
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm"
            >
              관리자
            </Link>
            {admin ? (
              <form action={logoutAdmin} suppressHydrationWarning>
                <button className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white shadow-sm">
                  로그아웃
                </button>
              </form>
            ) : null}
          </div>
        </header>

        <ClassGroupTabs
          classData={classData}
          initialClassNo={initialClassNo}
          errorGroupId={params.errorGroupId}
        />
      </section>
    </main>
  );
}
