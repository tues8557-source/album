"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import {
  CLASS_NUMBERS,
  type ClassNumber,
  type Group,
  type GroupMember,
  type Student,
} from "@/lib/types";
import { genderClass, groupName } from "@/lib/format";

type Gender = "" | "male" | "female";

type StudentRow = {
  rowKey: string;
  id: string;
  name: string;
  gender: Gender;
  groupId: string;
  deleted: boolean;
};

type SaveResult = {
  savedStudentIds?: Record<string, string>;
};

type PickerPosition = {
  left: number;
  top: number;
  width: number;
};

const DEFAULT_GROUP_COUNT = 6;
const INITIAL_ROW_COUNT = 25;
const AUTO_SAVE_DELAY = 700;
const PICKER_MARGIN = 8;
const PICKER_HEADER_HEIGHT = 52;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function blankRow(rowKey: string): StudentRow {
  return { rowKey, id: "", name: "", gender: "", groupId: "", deleted: false };
}

function blankRows(count: number, startIndex = 0): StudentRow[] {
  return Array.from({ length: count }, (_, index) => blankRow(`blank-${startIndex + index}`));
}

function newBlankRows(count: number): StudentRow[] {
  return Array.from({ length: count }, (_, index) => blankRow(`new-${Date.now()}-${index}`));
}

function normalizeGender(value: string): Gender {
  const normalized = value.trim().toLowerCase();

  if (["female", "f", "girl", "woman", "w", "2"].includes(normalized) || normalized.includes("여")) {
    return "female";
  }

  return "male";
}

function groupIdFromText(value: string, groups: Group[]) {
  const normalized = value.trim().toUpperCase();
  const index = normalized.length === 1 ? normalized.charCodeAt(0) - 65 : -1;

  if (index >= 0 && index < groups.length) {
    return groups[index].id;
  }

  return groups.find((group) => group.id === value.trim())?.id ?? "";
}

function visiblePassword(value: string | null) {
  if (!value) {
    return "";
  }

  return /^[a-f0-9]{64}$/i.test(value) ? "" : value;
}

function groupDisplayName(classNo: number, group: Group) {
  return groupName(classNo, Math.max(0, group.sort_order - 1));
}

function initialRows(students: Student[], groups: Group[], members: GroupMember[]) {
  const groupByStudent = new Map(
    members
      .filter((member) => groups.some((group) => group.id === member.group_id))
      .map((member) => [member.student_id, member.group_id]),
  );

  const studentRows = students.map((student) => ({
    rowKey: student.id,
    id: student.id,
    name: student.name,
    gender: student.gender,
    groupId: groupByStudent.get(student.id) ?? "",
    deleted: false,
  }));

  return [
    ...studentRows,
    ...blankRows(Math.max(0, INITIAL_ROW_COUNT - studentRows.length), studentRows.length),
  ];
}

function parseSpreadsheetText(text: string, groups: Group[]): Partial<StudentRow>[] {
  return text
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => {
      const cells = line.includes("\t") ? line.split("\t") : line.split(",");
      return {
        name: String(cells[0] ?? "").trim(),
        gender: cells[1] ? normalizeGender(String(cells[1])) : undefined,
        groupId: cells[2] ? groupIdFromText(String(cells[2]), groups) : undefined,
        deleted: false,
      };
    })
    .filter((row) => row.name);
}

export function StudentSpreadsheet({
  action,
  groupCountAction,
  deleteEmptyGroupsAction,
  compactGroupNamesAction,
  clearClassGroupAssignmentsAction,
  deleteClassStudentsAction,
  passwordAction,
  updateStudentGroupAction,
  classNo,
  classStudentCounts,
  students,
  groups,
  members,
}: {
  action: (formData: FormData) => SaveResult | void | Promise<SaveResult | void>;
  groupCountAction: (formData: FormData) => void | Promise<void>;
  deleteEmptyGroupsAction: (formData: FormData) => void | Promise<void>;
  compactGroupNamesAction: (formData: FormData) => void | Promise<void>;
  clearClassGroupAssignmentsAction: (formData: FormData) => void | Promise<void>;
  deleteClassStudentsAction: (formData: FormData) => void | Promise<void>;
  passwordAction: (formData: FormData) => void | Promise<void>;
  updateStudentGroupAction: (formData: FormData) => void | Promise<void>;
  classNo: number;
  classStudentCounts: Record<ClassNumber, number>;
  students: Student[];
  groups: Group[];
  members: GroupMember[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const saveTimerRef = useRef<number | null>(null);
  const [rows, setRows] = useState(() => initialRows(students, groups, members));
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [visiblePasswordGroups, setVisiblePasswordGroups] = useState<Set<string>>(new Set());
  const [copyMessageVisible, setCopyMessageVisible] = useState(false);
  const [groupCountWarning, setGroupCountWarning] = useState("");
  const activeRows = useMemo(
    () => rows.filter((row) => row.name.trim() && !row.deleted),
    [rows],
  );

  function scheduleSave() {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      formRef.current?.requestSubmit();
    }, AUTO_SAVE_DELAY);
  }

  function updateRow(index: number, next: Partial<StudentRow>, autosave = true) {
    setRows((current) => {
      let changed = false;
      const nextRows = current.map((row, rowIndex) => {
        if (rowIndex !== index) {
          return row;
        }

        const nextRow = { ...row, ...next };

        if (
          nextRow.id === row.id &&
          nextRow.name === row.name &&
          nextRow.gender === row.gender &&
          nextRow.groupId === row.groupId &&
          nextRow.deleted === row.deleted
        ) {
          return row;
        }

        changed = true;
        return nextRow;
      });

      return changed ? nextRows : current;
    });
    if (autosave) {
      scheduleSave();
    }
  }

  function pasteRows(index: number, text: string) {
    const pastedRows = parseSpreadsheetText(text, groups);

    if (!pastedRows.length) {
      return;
    }

    setRows((current) => {
      const next = [...current];
      const requiredLength = index + pastedRows.length;

      while (next.length < requiredLength) {
        next.push(blankRow(`new-${Date.now()}-${next.length}`));
      }

      pastedRows.forEach((row, offset) => {
        const previous = next[index + offset] ?? blankRow(`new-${Date.now()}-${index + offset}`);
        next[index + offset] = {
          ...previous,
          ...row,
          id: previous.id,
          deleted: false,
        };
      });

      return next;
    });
    scheduleSave();
  }

  function deleteRow(index: number) {
    setRows((current) =>
      current.map((row, rowIndex) => {
        if (rowIndex !== index) {
          return row;
        }

        if (!row.id && !row.name) {
          return row;
        }

        return row.id ? { ...row, deleted: true, name: "" } : blankRow(row.rowKey);
      }),
    );
    scheduleSave();
  }

  async function saveRows(formData: FormData) {
    const result = await action(formData);

    if (!result?.savedStudentIds || !Object.keys(result.savedStudentIds).length) {
      return;
    }

    setRows((current) =>
      current.map((row) => {
        const savedId = result.savedStudentIds?.[row.rowKey];
        return savedId ? { ...row, id: savedId, rowKey: savedId } : row;
      }),
    );
  }

  async function moveStudent(rowIndex: number, groupId: string) {
    const row = rows[rowIndex];
    if (!row?.name.trim()) {
      updateRow(rowIndex, { groupId: "" }, false);
      setSelectedRowIndex(null);
      return;
    }

    const previousGroupId = row?.groupId ?? "";
    updateRow(rowIndex, { groupId }, !row?.id);
    setSelectedRowIndex(null);

    if (row?.id) {
      const formData = new FormData();
      formData.set("classNo", String(classNo));
      formData.set("studentId", row.id);
      formData.set("groupId", groupId);
      try {
        await updateStudentGroupAction(formData);
      } catch (error) {
        updateRow(rowIndex, { groupId: previousGroupId }, false);
        console.error(error);
      }
    }
  }

  function handleDrop(event: DragEvent, groupId: string) {
    event.preventDefault();
    const rowIndex = Number.parseInt(event.dataTransfer.getData("text/plain"), 10);

    if (Number.isInteger(rowIndex)) {
      void moveStudent(rowIndex, groupId);
    }
  }

  async function copyGroupPasswords() {
    const text = groups
      .map((group) => {
        const password = visiblePassword(group.password_hash) || "(없음)";
        return `${groupDisplayName(classNo, group)} 그룹 비밀번호: ${password}`;
      })
      .join("\n");

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopyMessageVisible(true);
    window.setTimeout(() => setCopyMessageVisible(false), 1800);
  }

  function showGroupCountWarning(message: string) {
    setGroupCountWarning(message);
    window.setTimeout(() => setGroupCountWarning(""), 2200);
  }

  async function clearAllGroupAssignments() {
    if (!window.confirm(`${classNo}반 전체 학생을 미지정 그룹으로 변경할까요?`)) {
      return;
    }

    const previousRows = rows;
    const hasUnsavedRows = rows.some((row) => row.name.trim() && !row.deleted && !row.id && row.groupId);

    setRows((current) =>
      current.map((row) =>
        row.name.trim() && !row.deleted && row.groupId ? { ...row, groupId: "" } : row,
      ),
    );
    setSelectedRowIndex(null);

    try {
      const formData = new FormData();
      formData.set("classNo", String(classNo));
      await clearClassGroupAssignmentsAction(formData);
      if (hasUnsavedRows) {
        scheduleSave();
      }
    } catch (error) {
      setRows(previousRows);
      console.error(error);
    }
  }

  const activeCount = activeRows.length;

  return (
    <div className="grid gap-5">
      <nav className="grid grid-cols-7 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        {CLASS_NUMBERS.map((itemClassNo) => {
          const active = itemClassNo === classNo;
          const count = active ? activeCount : classStudentCounts[itemClassNo];

          return (
            <Link
              key={itemClassNo}
              href={`/admin?classNo=${itemClassNo}`}
              className={`min-h-12 border-r border-zinc-200 px-2 py-2 text-center text-sm font-semibold last:border-r-0 ${
                active ? "bg-zinc-900 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <span className="block">{itemClassNo}반</span>
              <span className={`text-xs ${active ? "text-zinc-300" : "text-zinc-400"}`}>
                {count}명
              </span>
            </Link>
          );
        })}
      </nav>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">그룹</h2>
            <p className="mt-1 text-sm text-zinc-500">{activeCount}명</p>
          </div>
          <form
            action={groupCountAction}
            className="relative flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
              if (submitter?.dataset.skipCountValidation === "1") {
                return;
              }

              const formData = new FormData(event.currentTarget);
              const targetCount = Number.parseInt(String(formData.get("groupCount") ?? ""), 10) || 0;
              const groupIdSet = new Set(groups.map((group) => group.id));
              const occupiedGroupCount = new Set(
                activeRows
                  .map((row) => row.groupId)
                  .filter((groupId) => groupId && groupIdSet.has(groupId)),
              ).size;

              if (targetCount < occupiedGroupCount) {
                event.preventDefault();
                showGroupCountWarning(
                  `학생이 배정된 그룹이 ${occupiedGroupCount}개 있어 그보다 적게 줄일 수 없습니다.`,
                );
              }
            }}
            suppressHydrationWarning
          >
            <input type="hidden" name="classNo" value={classNo} />
            <input type="hidden" name="returnClassNo" value={classNo} />
            <label className="text-sm font-semibold text-zinc-700" htmlFor="groupCount">
              그룹 개수
            </label>
            <input
              id="groupCount"
              name="groupCount"
              type="number"
              min={0}
              max={26}
              defaultValue={groups.length || DEFAULT_GROUP_COUNT}
              className="min-h-10 w-20 rounded-md border border-zinc-300 bg-white px-3 text-sm"
            />
            <button className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white">
              저장
            </button>
            <button
              data-skip-count-validation="1"
              formAction={deleteEmptyGroupsAction}
              className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700"
            >
              빈 그룹 삭제
            </button>
            <button
              data-skip-count-validation="1"
              formAction={compactGroupNamesAction}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800"
            >
              그룹명 재정렬
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => void copyGroupPasswords()}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800"
              >
                그룹비밀번호 복사
              </button>
              {copyMessageVisible ? (
                <p className="absolute right-0 top-full z-20 mt-2 w-64 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-800 shadow-sm">
                  학급 그룹들의 비밀번호가 클립보드에 복사되었습니다.
                </p>
              ) : null}
            </div>
            {groupCountWarning ? (
              <p className="absolute right-0 top-full z-20 mt-2 w-72 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 shadow-sm">
                {groupCountWarning}
              </p>
            ) : null}
          </form>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <GroupDropZone
            title="미지정 그룹"
            count={activeRows.filter((row) => !row.groupId).length}
            onDrop={(event) => handleDrop(event, "")}
          >
            <div className="flex min-h-14 flex-wrap content-start gap-2">
              {activeRows.some((row) => !row.groupId) ? (
                rows.map((row, rowIndex) =>
                  row.name.trim() && !row.deleted && !row.groupId ? (
                    <StudentChip
                      key={`${row.id || "new"}-${rowIndex}`}
                      row={row}
                      rowIndex={rowIndex}
                      classNo={classNo}
                      groups={groups}
                      selected={selectedRowIndex === rowIndex}
                      onSelect={() => setSelectedRowIndex(rowIndex)}
                      onClose={() => setSelectedRowIndex(null)}
                      onMove={(groupId) => void moveStudent(rowIndex, groupId)}
                    />
                  ) : null,
                )
              ) : (
                <EmptyGroupMessage />
              )}
            </div>
          </GroupDropZone>

          {groups.map((group) => {
            const groupRows = rows
              .map((row, rowIndex) => ({ row, rowIndex }))
              .filter(({ row }) => row.name.trim() && !row.deleted && row.groupId === group.id);

            return (
              <GroupDropZone
                key={group.id}
                title={groupDisplayName(classNo, group)}
                count={groupRows.length}
                onDrop={(event) => handleDrop(event, group.id)}
              >
                <div className="flex min-h-14 flex-wrap content-start gap-2">
                  {groupRows.length ? (
                    groupRows.map(({ row, rowIndex }) => (
                      <StudentChip
                        key={`${row.id || "new"}-${rowIndex}`}
                        row={row}
                        rowIndex={rowIndex}
                        classNo={classNo}
                        groups={groups}
                      selected={selectedRowIndex === rowIndex}
                      onSelect={() => setSelectedRowIndex(rowIndex)}
                      onClose={() => setSelectedRowIndex(null)}
                      onMove={(groupId) => void moveStudent(rowIndex, groupId)}
                    />
                    ))
                  ) : (
                    <EmptyGroupMessage />
                  )}
                </div>
                <form action={passwordAction} className="mt-3 grid grid-cols-[1fr_auto_auto] gap-2" suppressHydrationWarning>
                  <input type="hidden" name="groupId" value={group.id} />
                  <input type="hidden" name="returnClassNo" value={classNo} />
                  <input
                    name={`password-${group.id}`}
                    type={visiblePasswordGroups.has(group.id) ? "text" : "password"}
                    autoComplete="new-password"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    defaultValue={visiblePassword(group.password_hash)}
                    placeholder={`${groupDisplayName(classNo, group)} 비밀번호`}
                    className="min-h-10 min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-teal-500"
                  />
                  <button
                    type="button"
                    title={visiblePasswordGroups.has(group.id) ? "비밀번호 숨기기" : "비밀번호 보기"}
                    aria-label={visiblePasswordGroups.has(group.id) ? "비밀번호 숨기기" : "비밀번호 보기"}
                    onClick={() =>
                      setVisiblePasswordGroups((current) => {
                        const next = new Set(current);
                        if (next.has(group.id)) {
                          next.delete(group.id);
                        } else {
                          next.add(group.id);
                        }
                        return next;
                      })
                    }
                    className="flex min-h-10 w-10 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700"
                  >
                    {visiblePasswordGroups.has(group.id) ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                  <button className="rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white">
                    설정
                  </button>
                </form>
              </GroupDropZone>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">{classNo}반 학생명단</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void clearAllGroupAssignments()}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800"
            >
              전체 미지정
            </button>
            <form
              action={deleteClassStudentsAction}
              onSubmit={(event) => {
                if (!window.confirm(`${classNo}반 전체 학생을 정말로 삭제할까요?`)) {
                  event.preventDefault();
                }
              }}
              suppressHydrationWarning
            >
              <input type="hidden" name="classNo" value={classNo} />
              <input type="hidden" name="returnClassNo" value={classNo} />
              <button className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700">
                전체 삭제
              </button>
            </form>
          </div>
        </div>

        <form ref={formRef} action={saveRows} className="mt-3 grid gap-3" suppressHydrationWarning>
          <input type="hidden" name="classNo" value={classNo} />
          <input type="hidden" name="returnClassNo" value={classNo} />
          <input type="hidden" name="autoSave" value="1" />

          <div className="overflow-x-auto rounded-md border border-zinc-300 bg-white">
            <div className="min-w-[320px] sm:min-w-[720px]">
              <div className="grid grid-cols-[30px_minmax(90px,1fr)_48px_86px_42px] bg-zinc-100 text-xs font-semibold text-zinc-600 sm:grid-cols-[52px_minmax(220px,1fr)_120px_140px_88px]">
                <div className="border-r border-zinc-300 px-1 py-2 text-center sm:px-2">#</div>
                <div className="border-r border-zinc-300 px-2 py-2 sm:px-3">학생명</div>
                <div className="border-r border-zinc-300 px-2 py-2 sm:px-3">성별</div>
                <div className="border-r border-zinc-300 px-2 py-2 sm:px-3">그룹</div>
                <div className="px-1 py-2 text-center sm:px-3">삭제</div>
              </div>

              {rows.map((row, index) => {
                if (row.deleted) {
                  return (
                    <div key={`deleted-${row.id || "new"}-${index}`} className="hidden">
                      <input type="hidden" name="studentId" value={row.id} />
                      <input type="hidden" name="studentRowKey" value={row.rowKey} />
                      <input type="hidden" name="studentDeleted" value="1" />
                      <input type="hidden" name="studentName" value={row.name} />
                      <input type="hidden" name="studentGender" value={row.gender} />
                      <input type="hidden" name="studentGroupId" value={row.groupId} />
                    </div>
                  );
                }

                const visibleIndex = rows.slice(0, index + 1).filter((item) => !item.deleted).length;

                return (
                  <div
                    key={`${row.id || "new"}-${index}`}
                    className="grid grid-cols-[30px_minmax(90px,1fr)_48px_86px_42px] border-t border-zinc-200 sm:grid-cols-[52px_minmax(220px,1fr)_120px_140px_88px]"
                  >
                    <input type="hidden" name="studentId" value={row.id} />
                    <input type="hidden" name="studentRowKey" value={row.rowKey} />
                    <input type="hidden" name="studentDeleted" value="0" />
                    <div className="border-r border-zinc-200 bg-zinc-50 px-1 py-2 text-center text-xs text-zinc-500 sm:px-2">
                      {visibleIndex}
                    </div>
                    <input
                      name="studentName"
                      value={row.name}
                      onChange={(event) => {
                        const name = event.target.value;
                        updateRow(
                          index,
                          name.trim() ? { name } : { name, gender: "", groupId: "" },
                        );
                      }}
                      onPaste={(event) => {
                        const text = event.clipboardData.getData("text/plain");
                        if (text.includes("\t") || text.includes("\n")) {
                          event.preventDefault();
                          pasteRows(index, text);
                        }
                      }}
                      className="min-h-10 min-w-0 border-r border-zinc-200 bg-transparent px-2 text-sm outline-none focus:bg-teal-50 sm:px-3"
                    />
                    <select
                      name="studentGender"
                      value={row.gender}
                      onChange={(event) =>
                        updateRow(
                          index,
                          row.name.trim() ? { gender: event.target.value as Gender } : { gender: "" },
                        )
                      }
                      className="min-h-10 min-w-0 border-r border-zinc-200 bg-transparent px-1 text-sm outline-none focus:bg-teal-50 sm:px-3"
                    >
                      <option value="">-</option>
                      <option value="male">남</option>
                      <option value="female">여</option>
                    </select>
                    <select
                      name="studentGroupId"
                      value={row.groupId}
                      onChange={(event) => void moveStudent(index, event.target.value)}
                      className="min-h-10 min-w-0 border-r border-zinc-200 bg-transparent px-1 text-sm outline-none focus:bg-teal-50 sm:px-3"
                    >
                      <option value="">미지정</option>
                      {groups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {groupDisplayName(classNo, group)}
                        </option>
                      ))}
                    </select>
                    <div className="flex min-h-10 items-center justify-center px-1 sm:px-2">
                      <button
                        type="button"
                        title="삭제"
                        aria-label="삭제"
                        disabled={!row.id && !row.name}
                        onClick={() => deleteRow(index)}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-white text-red-700 disabled:cursor-not-allowed disabled:opacity-40 max-[380px]:h-7 max-[380px]:w-7"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setRows((current) => [...current, ...newBlankRows(5)])}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold"
            >
              5행 추가
            </button>
            <span className="text-sm text-zinc-500">{activeCount}명</span>
          </div>
        </form>
      </section>
    </div>
  );
}

function GroupDropZone({
  title,
  count,
  children,
  onDrop,
}: {
  title: string;
  count: number;
  children: ReactNode;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <section
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className="min-h-36 rounded-lg border border-zinc-200 bg-zinc-50 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-bold">{title}</h3>
        <span className="text-xs text-zinc-500">{count}명</span>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function EmptyGroupMessage() {
  return (
    <p className="rounded-md border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500">
      배정된 학생이 없습니다.
    </p>
  );
}

function StudentChip({
  row,
  rowIndex,
  classNo,
  groups,
  selected,
  onSelect,
  onClose,
  onMove,
}: {
  row: StudentRow;
  rowIndex: number;
  classNo: number;
  groups: Group[];
  selected: boolean;
  onSelect: () => void;
  onClose: () => void;
  onMove: (groupId: string) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [pickerPosition, setPickerPosition] = useState<PickerPosition | null>(null);
  const currentGroup = groups.find((group) => group.id === row.groupId) ?? null;
  const currentGroupLabel = currentGroup ? groupDisplayName(classNo, currentGroup) : "미지정";

  useEffect(() => {
    if (!selected) {
      return;
    }

    function updatePickerPosition() {
      const button = buttonRef.current;

      if (!button) {
        return;
      }

      const rect = button.getBoundingClientRect();
      const compact = window.innerWidth < 640;
      const width = Math.min(compact ? 224 : 256, window.innerWidth - PICKER_MARGIN * 2);
      const columnCount = compact ? 3 : 4;
      const rowCount = Math.ceil((groups.length + 1) / columnCount);
      const estimatedHeight = rowCount * 36 + PICKER_HEADER_HEIGHT + 16;
      const centeredLeft = rect.left + rect.width / 2 - width / 2;
      const left = clamp(centeredLeft, PICKER_MARGIN, window.innerWidth - width - PICKER_MARGIN);
      const belowTop = rect.bottom + PICKER_MARGIN;
      const aboveTop = rect.top - PICKER_MARGIN - estimatedHeight;
      const top =
        belowTop + estimatedHeight <= window.innerHeight - PICKER_MARGIN
          ? belowTop
          : Math.max(PICKER_MARGIN, aboveTop);

      setPickerPosition({ left, top, width });
    }

    const frame = window.requestAnimationFrame(updatePickerPosition);
    window.addEventListener("resize", updatePickerPosition);
    window.addEventListener("scroll", updatePickerPosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePickerPosition);
      window.removeEventListener("scroll", updatePickerPosition, true);
    };
  }, [groups.length, selected]);

  return (
    <span className="relative inline-flex">
      {selected ? <button type="button" aria-label="그룹 선택 닫기" className="fixed inset-0 z-20 cursor-default bg-transparent" onClick={onClose} /> : null}
      <button
        ref={buttonRef}
        type="button"
        draggable
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", String(rowIndex));
          event.dataTransfer.effectAllowed = "move";
        }}
        className={`cursor-grab rounded-md px-2.5 py-1 text-sm font-semibold ring-1 active:cursor-grabbing ${
          selected ? "relative z-30 ring-2 ring-zinc-900 ring-offset-2 ring-offset-white shadow-sm" : ""
        } ${genderClass(row.gender)}`}
      >
        {row.name}
      </button>
      {selected && pickerPosition ? (
        <div
          className="group-picker-pop fixed z-30 grid grid-cols-3 gap-1 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg sm:grid-cols-4"
          style={{
            left: pickerPosition.left,
            top: pickerPosition.top,
            width: pickerPosition.width,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="col-span-full flex items-center justify-between rounded-md bg-zinc-50 px-2.5 py-2">
            <span className={`inline-flex min-w-0 items-center rounded-md px-2 py-1 text-sm font-semibold ring-1 ${genderClass(row.gender)}`}>
              <span className="truncate">{row.name}</span>
            </span>
            <span className="ml-2 shrink-0 text-xs font-medium text-zinc-500">
              현재 {currentGroupLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onMove("")}
            className={`flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-bold ${
              row.groupId ? "bg-zinc-100 text-zinc-700 hover:bg-teal-50" : "bg-zinc-900 text-white"
            }`}
          >
            미
          </button>
          {groups.map((group) => {
            const active = row.groupId === group.id;

            return (
              <button
                key={group.id}
                type="button"
                onClick={() => onMove(group.id)}
                className={`flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-bold ${
                  active ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-teal-50"
                }`}
              >
                {groupDisplayName(classNo, group)}
              </button>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m3 3 18 18" />
      <path d="M10.6 10.6a3 3 0 0 0 4 4" />
      <path d="M9.9 5.4A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a18.6 18.6 0 0 1-3.1 4.1" />
      <path d="M6.6 6.6C3.7 8.5 2 12 2 12s3.5 7 10 7a10.9 10.9 0 0 0 4.1-.8" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
      <path d="M10 10v6" />
      <path d="M14 10v6" />
    </svg>
  );
}
