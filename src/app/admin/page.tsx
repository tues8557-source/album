import { cookies } from "next/headers";
import Link from "next/link";
import {
  clearClassGroupAssignments,
  compactClassGroupNames,
  deleteEmptyGroups,
  deleteClassStudents,
  loginAdmin,
  logoutAdmin,
  saveClassRoster,
  setClassGroupCount,
  updateGroupPassword,
  updateStudentGroup,
} from "@/app/actions";
import { StudentSpreadsheet } from "@/app/admin/student-spreadsheet";
import { ensureInitialClassGroups, getAdminData } from "@/lib/data";
import { isClassNumber } from "@/lib/format";
import { readSignedToken } from "@/lib/security";
import { isMissingSchemaError, SetupError } from "@/lib/setup-error";
import { CLASS_NUMBERS, type ClassNumber } from "@/lib/types";

export const dynamic = "force-dynamic";

async function isAdmin() {
  return readSignedToken((await cookies()).get("album_admin")?.value) === "admin";
}

function Field({
  name,
  placeholder,
  type = "text",
}: {
  name: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      name={name}
      placeholder={placeholder}
      type={type}
      className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-teal-500"
    />
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ classNo?: string; error?: string }>;
}) {
  const params = await searchParams;
  const requestedClassNo = Number.parseInt(params.classNo ?? "", 10);
  const currentClassNo = isClassNumber(requestedClassNo) ? requestedClassNo : 1;

  if (!(await isAdmin())) {
    return (
      <main className="min-h-screen bg-stone-50 px-4 py-8 text-zinc-950">
        <section className="mx-auto max-w-sm rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-bold">관리자 로그인</h1>
          {params.error ? <p className="mt-2 text-sm text-red-600">비밀번호를 확인하세요.</p> : null}
          <form action={loginAdmin} className="mt-5 grid gap-3">
            <Field name="password" type="password" placeholder="관리자 비밀번호" />
            <button className="min-h-11 rounded-md bg-zinc-900 px-4 text-sm font-semibold text-white">
              로그인
            </button>
          </form>
        </section>
      </main>
    );
  }

  let adminData;

  try {
    await ensureInitialClassGroups(6);
    adminData = await getAdminData();
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return <SetupError />;
    }

    throw error;
  }

  const { students, groups, members } = adminData;
  const classGroups = groups.filter((group) => group.class_no === currentClassNo);

  const classStudents = students.filter((student) => student.class_no === currentClassNo);
  const classGroupIds = new Set(classGroups.map((group) => group.id));
  const classMembers = members.filter((member) => classGroupIds.has(member.group_id));
  const classStudentCounts = CLASS_NUMBERS.reduce(
    (counts, classNo) => ({
      ...counts,
      [classNo]: students.filter((student) => student.class_no === classNo).length,
    }),
    {} as Record<ClassNumber, number>,
  );

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto grid max-w-6xl gap-5">
        <header className="flex items-center justify-between gap-3">
          <div>
            <Link href="/" className="text-sm font-medium text-teal-700">
              홈으로
            </Link>
            <h1 className="mt-1 text-3xl font-bold">관리자</h1>
          </div>
          <form action={logoutAdmin}>
            <button className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold">
              로그아웃
            </button>
          </form>
        </header>

        {params.error === "bad-student" ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            학생 이름과 성별을 확인하세요.
          </p>
        ) : null}

        <StudentSpreadsheet
          key={`${currentClassNo}-${classGroups.map((group) => group.id).join("-")}`}
          action={saveClassRoster}
          groupCountAction={setClassGroupCount}
          deleteEmptyGroupsAction={deleteEmptyGroups}
          compactGroupNamesAction={compactClassGroupNames}
          clearClassGroupAssignmentsAction={clearClassGroupAssignments}
          deleteClassStudentsAction={deleteClassStudents}
          passwordAction={updateGroupPassword}
          updateStudentGroupAction={updateStudentGroup}
          classNo={currentClassNo}
          classStudentCounts={classStudentCounts}
          students={classStudents}
          groups={classGroups}
          members={classMembers}
        />
      </div>
    </main>
  );
}
