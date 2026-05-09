import Link from "next/link";
import { logoutAdmin } from "@/app/actions";
import { ClassGroupTabs } from "@/app/class-group-tabs";
import { hasAdminSession } from "@/lib/auth";
import {
  ensureInitialClassGroups,
  getClassGroups,
  getConfiguredClassCount,
  getConfiguredHomeManagement,
} from "@/lib/data";
import { isClassNumber } from "@/lib/format";
import { isMissingSchemaError, SetupError } from "@/lib/setup-error";
import { buildClassNumbers } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ classNo?: string; errorGroupId?: string; rateLimitedGroupId?: string; staleGroupId?: string }>;
}) {
  const params = await searchParams;
  const requestedClassNo = Number.parseInt(params.classNo ?? "", 10);
  const admin = await hasAdminSession();
  let classData;
  let classCount = 1;
  let homeManagement = { titleLine1: "", titleLine2: "" };

  try {
    classCount = await getConfiguredClassCount();
    const classNumbers = buildClassNumbers(classCount);
    await ensureInitialClassGroups(6, classCount);
    homeManagement = await getConfiguredHomeManagement();
    classData = await Promise.all(
      classNumbers.map(async (classNo) => ({
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

  const initialClassNo = isClassNumber(requestedClassNo, classCount)
    ? requestedClassNo
    : classData[0]?.classNo ?? 1;

  return (
    <main className="min-h-screen overflow-x-hidden bg-stone-50 text-zinc-950">
      <section className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-6 px-4 py-5 sm:px-6 sm:py-8">
        <header className="flex items-end justify-between gap-4">
          <div>
            {homeManagement.titleLine1 ? (
              <p className="text-sm font-medium text-teal-700">{homeManagement.titleLine1}</p>
            ) : null}
            {homeManagement.titleLine2 ? (
              <h1 className={`${homeManagement.titleLine1 ? "mt-1 " : ""}text-2xl font-bold tracking-normal`}>
                {homeManagement.titleLine2}
              </h1>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Link
              href="/admin"
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-900 px-3 py-2 text-base font-semibold leading-none text-white"
            >
              관리자
            </Link>
            {admin ? (
              <form action={logoutAdmin} suppressHydrationWarning>
                <button className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold leading-none">
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
          rateLimitedGroupId={params.rateLimitedGroupId}
          staleGroupId={params.staleGroupId}
        />
      </section>
    </main>
  );
}
