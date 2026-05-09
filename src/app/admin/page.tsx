import {
  clearClassGroupAssignments,
  deleteEmptyGroups,
  deleteClassStudents,
  loginAdmin,
  logoutAdmin,
  saveClassRoster,
  setClassCount,
  setClassGroupCount,
  updateHomeManagementSettings,
  updateClassGroupPasswords,
  updateGroupPassword,
  updateStudentGroup,
} from "@/app/actions";
import { AdminHeaderWithHomeManagement } from "@/app/admin/admin-header-with-home-management";
import { HomeManagementSettings } from "@/app/admin/home-title-settings";
import { StudentSpreadsheet } from "@/app/admin/student-spreadsheet";
import { hasAdminSession } from "@/lib/auth";
import {
  ensureInitialClassGroups,
  getAdminData,
  getConfiguredClassCount,
  getConfiguredHomeManagement,
  type HomeManagementSettings as StoredHomeManagementSettings,
} from "@/lib/data";
import { isClassNumber } from "@/lib/format";
import { isMissingSchemaError, SetupError } from "@/lib/setup-error";
import { buildClassNumbers } from "@/lib/types";

export const dynamic = "force-dynamic";

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

  if (!(await hasAdminSession())) {
    return (
      <main className="min-h-screen bg-stone-50 px-4 py-8 text-zinc-950">
        <section className="mx-auto max-w-sm rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-bold">관리자 로그인</h1>
          {params.error === "too-many-requests" ? (
            <p className="mt-2 text-sm text-amber-700">시도가 너무 많아 잠시 후 다시 시도해야 합니다.</p>
          ) : params.error ? (
            <p className="mt-2 text-sm text-red-600">비밀번호를 확인하세요.</p>
          ) : null}
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
  let classCount = 1;
  let homeManagement: StoredHomeManagementSettings = {
    packages: [],
    activeIndex: 0,
    activePackage: { id: undefined, line1: "", line2: "", classCount: 1, rows: [{ line1: "", line2: "" }], selectedIndex: 0 },
    titleLine1: "",
    titleLine2: "",
  };

  try {
    classCount = await getConfiguredClassCount();
    await ensureInitialClassGroups(6, classCount);
    adminData = await getAdminData();
    homeManagement = await getConfiguredHomeManagement();
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return <SetupError />;
    }

    throw error;
  }

  const { students, groups, members } = adminData;
  const classNumbers = buildClassNumbers(classCount);
  const currentClassNo = isClassNumber(requestedClassNo, classCount) ? requestedClassNo : classNumbers[0] ?? 1;
  const classGroups = groups.filter((group) => group.class_no === currentClassNo);

  const classStudents = students.filter((student) => student.class_no === currentClassNo);
  const classGroupIds = new Set(classGroups.map((group) => group.id));
  const classMembers = members.filter((member) => classGroupIds.has(member.group_id));
  const classStudentCounts = classNumbers.reduce(
    (counts, classNo) => ({
      ...counts,
      [classNo]: students.filter((student) => student.class_no === classNo).length,
    }),
    {} as Record<number, number>,
  );

  return (
    <main className="min-h-screen overflow-x-hidden bg-stone-50 px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto grid min-w-0 max-w-6xl gap-5">
        <AdminHeaderWithHomeManagement logoutAction={logoutAdmin}>
          <HomeManagementSettings
            initialPackages={homeManagement.packages}
            initialActiveIndex={homeManagement.activeIndex}
            action={updateHomeManagementSettings}
          />
        </AdminHeaderWithHomeManagement>

        {params.error === "bad-student" ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            학생 이름과 성별을 확인하세요.
          </p>
        ) : null}

        <StudentSpreadsheet
          key={`${currentClassNo}-${classCount}-${classGroups.map((group) => group.id).join("-")}`}
          action={saveClassRoster}
          classCountAction={setClassCount}
          groupCountAction={setClassGroupCount}
          deleteEmptyGroupsAction={deleteEmptyGroups}
          clearClassGroupAssignmentsAction={clearClassGroupAssignments}
          deleteClassStudentsAction={deleteClassStudents}
          bulkPasswordAction={updateClassGroupPasswords}
          passwordAction={updateGroupPassword}
          updateStudentGroupAction={updateStudentGroup}
          classNo={currentClassNo}
          classNumbers={classNumbers}
          classStudentCounts={classStudentCounts}
          students={classStudents}
          groups={classGroups}
          members={classMembers}
        />
      </div>
    </main>
  );
}
