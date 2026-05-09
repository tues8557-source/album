"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { ActionStatusButton } from "@/app/ui/action-status-button";
import { TrashIcon } from "@/app/ui/icons";
import { useHorizontalDragScroll } from "@/lib/use-horizontal-drag-scroll";
import { useConfirmDialog } from "@/lib/use-confirm-dialog";
import {
  measureTabStripPages,
  pageIndexForItemIndex,
  pageIndexForScrollLeft,
  tabStripPagesEqual,
  type TabStripPage,
} from "@/lib/tab-strip-pages";
import {
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
  warning?: string;
};

type GroupActionResult = {
  groups?: Group[];
};

type GroupPasswordActionResult = {
  group?: Group | null;
};

type ClassCountActionResult = {
  classCount?: number;
  classNumbers?: number[];
  currentClassNo?: number;
  minimumClassCount?: number;
};

type PickerPosition = {
  left: number;
  top: number;
  width: number;
};

type ActionFeedbackState = "idle" | "pending" | "done";

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

function groupDisplayName(classNo: number, group: Group) {
  return groupName(classNo, Math.max(0, group.sort_order - 1));
}

function groupHasPassword(group: Group) {
  return group.has_password ?? Boolean(group.password_hash);
}

function initialRows(students: Student[], groups: Group[], members: GroupMember[]) {
  const groupByStudent = new Map(
    members
      .filter((member) => groups.some((group) => group.id === member.group_id))
      .map((member) => [member.student_id, member.group_id]),
  );

  const studentRows: StudentRow[] = students.map((student) => ({
    rowKey: student.id,
    id: student.id,
    name: student.name,
    gender: (student.gender ?? "") as Gender,
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

function StableButtonLabel({
  label,
  display,
}: {
  label: string;
  display: string;
}) {
  return (
    <span className="relative inline-grid items-center justify-items-center whitespace-nowrap">
      <span className="invisible">{label}</span>
      <span className="absolute inset-0 flex items-center justify-center whitespace-nowrap">
        {display}
      </span>
    </span>
  );
}

export function StudentSpreadsheet({
  action,
  classCountAction,
  groupCountAction,
  deleteEmptyGroupsAction,
  clearClassGroupAssignmentsAction,
  deleteClassStudentsAction,
  bulkPasswordAction,
  passwordAction,
  updateStudentGroupAction,
  classNo,
  classNumbers,
  classStudentCounts,
  students,
  groups,
  members,
}: {
  action: (formData: FormData) => SaveResult | void | Promise<SaveResult | void>;
  classCountAction: (formData: FormData) => ClassCountActionResult | void | Promise<ClassCountActionResult | void>;
  groupCountAction: (formData: FormData) => GroupActionResult | void | Promise<GroupActionResult | void>;
  deleteEmptyGroupsAction: (formData: FormData) => GroupActionResult | void | Promise<GroupActionResult | void>;
  clearClassGroupAssignmentsAction: (formData: FormData) => void | Promise<void>;
  deleteClassStudentsAction: (formData: FormData) => void | Promise<void>;
  bulkPasswordAction: (formData: FormData) => GroupActionResult | void | Promise<GroupActionResult | void>;
  passwordAction: (formData: FormData) => GroupPasswordActionResult | void | Promise<GroupPasswordActionResult | void>;
  updateStudentGroupAction: (formData: FormData) => void | Promise<void>;
  classNo: number;
  classNumbers: number[];
  classStudentCounts: Record<number, number>;
  students: Student[];
  groups: Group[];
  members: GroupMember[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const deleteStudentsFormRef = useRef<HTMLFormElement>(null);
  const classTabsRef = useRef<HTMLElement | null>(null);
  const { dragHandlers: classTabDragHandlers, dragging: classTabsDragging } = useHorizontalDragScroll(classTabsRef);
  const { confirm, confirmDialog } = useConfirmDialog();
  const saveTimerRef = useRef<number | null>(null);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const saveNoticeTimerRef = useRef<number | null>(null);
  const warningTimerRef = useRef<number | null>(null);
  const actionFeedbackTimersRef = useRef<Record<string, number>>({});
  const rowDeleteTimersRef = useRef<Record<string, number>>({});
  const groupCountButtonRef = useRef<HTMLButtonElement | null>(null);
  const [rows, setRows] = useState(() => initialRows(students, groups, members));
  const [groupsState, setGroupsState] = useState(groups);
  const [classNumbersState, setClassNumbersState] = useState(classNumbers);
  const [classStudentCountsState, setClassStudentCountsState] = useState(classStudentCounts);
  const [classCountInput, setClassCountInput] = useState(() => String(classNumbers.length));
  const [classTabPages, setClassTabPages] = useState<TabStripPage[]>([
    { endIndex: classNumbers.length, scrollLeft: 0, startIndex: 0 },
  ]);
  const [visibleClassPageIndex, setVisibleClassPageIndex] = useState(0);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [visiblePasswordGroups, setVisiblePasswordGroups] = useState<Set<string>>(new Set());
  const [bulkPasswordVisible, setBulkPasswordVisible] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<Record<string, ActionFeedbackState>>({});
  const [deletingRowKeys, setDeletingRowKeys] = useState<Set<string>>(new Set());
  const [groupCountPickerOpen, setGroupCountPickerOpen] = useState(false);
  const [groupCountPickerPosition, setGroupCountPickerPosition] = useState<PickerPosition | null>(null);
  const [classCountWarning, setClassCountWarning] = useState("");
  const [groupCountWarning, setGroupCountWarning] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [hasPendingSave, setHasPendingSave] = useState(false);
  const activeRows = useMemo(
    () => rows.filter((row) => row.name.trim() && !row.deleted),
    [rows],
  );
  const activeCount = activeRows.length;
  const measureClassTabPages = useCallback(() => {
    const container = classTabsRef.current;

    if (!container) {
      return;
    }

    const nextPages = measureTabStripPages(container);

    setClassTabPages((current) => (tabStripPagesEqual(current, nextPages) ? current : nextPages));
    setVisibleClassPageIndex((current) => {
      const nextPageIndex = pageIndexForScrollLeft(
        nextPages,
        container.scrollLeft,
        Math.max(0, container.scrollWidth - container.clientWidth),
      );
      return current === nextPageIndex ? current : nextPageIndex;
    });
  }, []);

  function syncVisibleClassPageFromScroll(container: HTMLElement | null = classTabsRef.current) {
    if (!container || !classTabPages.length) {
      return;
    }

    const nextPageIndex = pageIndexForScrollLeft(
      classTabPages,
      container.scrollLeft,
      Math.max(0, container.scrollWidth - container.clientWidth),
    );
    setVisibleClassPageIndex((current) => (current === nextPageIndex ? current : nextPageIndex));
  }

  function scrollClassTabsToPage(pageIndex: number, behavior: ScrollBehavior) {
    const container = classTabsRef.current;
    const page = classTabPages[pageIndex];

    if (!container || !page) {
      return;
    }

    container.scrollTo({ left: page.scrollLeft, behavior });
    setVisibleClassPageIndex((current) => (current === pageIndex ? current : pageIndex));
  }

  useEffect(() => {
    window.addEventListener("resize", measureClassTabPages);
    return () => window.removeEventListener("resize", measureClassTabPages);
  }, [measureClassTabPages]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(measureClassTabPages);
    return () => window.cancelAnimationFrame(frame);
  }, [activeCount, classNo, classNumbersState, classStudentCountsState, measureClassTabPages]);

  useEffect(() => {
    const classIndex = Math.max(0, classNumbersState.findIndex((itemClassNo) => itemClassNo === classNo));
    const targetPageIndex = pageIndexForItemIndex(classTabPages, classIndex);
    const frame = window.requestAnimationFrame(() => {
      const container = classTabsRef.current;
      const targetPage = classTabPages[targetPageIndex];

      if (!container || !targetPage) {
        return;
      }

      container.scrollTo({ left: targetPage.scrollLeft, behavior: "auto" });
      setVisibleClassPageIndex((current) => (current === targetPageIndex ? current : targetPageIndex));
    });

    return () => window.cancelAnimationFrame(frame);
  }, [classNo, classNumbersState, classTabPages]);

  useEffect(() => {
    if (!groupCountPickerOpen) {
      return;
    }

    function updatePickerPosition() {
      const button = groupCountButtonRef.current;

      if (!button) {
        return;
      }

      const rect = button.getBoundingClientRect();
      const compact = window.innerWidth < 640;
      const width = Math.min(compact ? 264 : 320, window.innerWidth - PICKER_MARGIN * 2);
      const columnCount = compact ? 4 : 5;
      const rowCount = Math.ceil(27 / columnCount);
      const estimatedHeight = rowCount * 36 + PICKER_HEADER_HEIGHT + 16;
      const centeredLeft = rect.left + rect.width / 2 - width / 2;
      const left = clamp(centeredLeft, PICKER_MARGIN, window.innerWidth - width - PICKER_MARGIN);
      const belowTop = rect.bottom + PICKER_MARGIN;
      const aboveTop = rect.top - PICKER_MARGIN - estimatedHeight;
      const top =
        belowTop + estimatedHeight <= window.innerHeight - PICKER_MARGIN
          ? belowTop
          : Math.max(PICKER_MARGIN, aboveTop);

      setGroupCountPickerPosition({ left, top, width });
    }

    const frame = window.requestAnimationFrame(updatePickerPosition);
    window.addEventListener("resize", updatePickerPosition);
    window.addEventListener("scroll", updatePickerPosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePickerPosition);
      window.removeEventListener("scroll", updatePickerPosition, true);
    };
  }, [groupCountPickerOpen]);

  useEffect(() => {
    const actionFeedbackTimers = actionFeedbackTimersRef.current;
    const rowDeleteTimers = rowDeleteTimersRef.current;

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (saveNoticeTimerRef.current !== null) {
        window.clearTimeout(saveNoticeTimerRef.current);
      }
      if (warningTimerRef.current !== null) {
        window.clearTimeout(warningTimerRef.current);
      }
      Object.values(actionFeedbackTimers).forEach((timer) => window.clearTimeout(timer));
      Object.values(rowDeleteTimers).forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  function actionLabel(key: string, label: string) {
    return actionFeedback[key] === "done" ? "완료" : label;
  }

  function showSaveNotice(message: string) {
    if (saveNoticeTimerRef.current !== null) {
      window.clearTimeout(saveNoticeTimerRef.current);
      saveNoticeTimerRef.current = null;
    }

    setSaveNotice(message);

    if (!message) {
      return;
    }

    saveNoticeTimerRef.current = window.setTimeout(() => {
      setSaveNotice("");
      saveNoticeTimerRef.current = null;
    }, 3200);
  }

  function saveErrorMessage(error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23502"
    ) {
      return "성별 빈칸 저장을 위해 DB 업데이트가 필요합니다.";
    }

    return "학생 명단 저장 중 오류가 발생했습니다.";
  }

  function actionErrorMessage(error: unknown, fallback: string) {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return fallback;
  }

  function clearActionFeedbackTimer(key: string) {
    const timer = actionFeedbackTimersRef.current[key];

    if (timer) {
      window.clearTimeout(timer);
      delete actionFeedbackTimersRef.current[key];
    }
  }

  function clearActionFeedback(key: string) {
    clearActionFeedbackTimer(key);
    setActionFeedback((current) => {
      if (!(key in current)) {
        return current;
      }

      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function markActionDone(key: string) {
    clearActionFeedbackTimer(key);
    setActionFeedback((current) => ({ ...current, [key]: "done" }));
    actionFeedbackTimersRef.current[key] = window.setTimeout(() => {
      setActionFeedback((current) => {
        if (current[key] !== "done") {
          return current;
        }

        const next = { ...current };
        delete next[key];
        return next;
      });
      delete actionFeedbackTimersRef.current[key];
    }, 1200);
  }

  async function runActionWithFeedback<T>(key: string, operation: () => T | Promise<T>) {
    if (actionFeedback[key] === "pending") {
      return undefined;
    }

    clearActionFeedbackTimer(key);
    setActionFeedback((current) => ({ ...current, [key]: "pending" }));

    try {
      const result = await operation();
      markActionDone(key);
      return result;
    } catch (error) {
      clearActionFeedback(key);
      throw error;
    }
  }

  function applyGroupsUpdate(nextGroups: Group[]) {
    setGroupsState(nextGroups);
    const validGroupIds = new Set(nextGroups.map((group) => group.id));
    setVisiblePasswordGroups((current) => new Set([...current].filter((groupId) => validGroupIds.has(groupId))));
  }

  function scheduleSave() {
    setHasPendingSave(true);
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      formRef.current?.requestSubmit();
    }, AUTO_SAVE_DELAY);
  }

  async function flushPendingSave() {
    const shouldSave = hasPendingSave || saveTimerRef.current !== null;

    if (savePromiseRef.current) {
      await savePromiseRef.current;
      return;
    }

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (!shouldSave || !formRef.current) {
      return;
    }

    await saveRows(new FormData(formRef.current));
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
    const pastedRows = parseSpreadsheetText(text, groupsState);

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

  function deleteRowByKey(rowKey: string) {
    setRows((current) =>
      current.map((row) => {
        if (row.rowKey !== rowKey) {
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
    const saveWork = (async () => {
      try {
        const result = await action(formData);
        setHasPendingSave(false);
        showSaveNotice(result?.warning ?? "");

        if (!result?.savedStudentIds || !Object.keys(result.savedStudentIds).length) {
          return;
        }

        setRows((current) =>
          current.map((row) => {
            const savedId = result.savedStudentIds?.[row.rowKey];
            return savedId ? { ...row, id: savedId, rowKey: savedId } : row;
          }),
        );
      } catch (error) {
        setHasPendingSave(false);
        showSaveNotice(saveErrorMessage(error));
        console.error(error);
        return;
      }
    })();

    savePromiseRef.current = saveWork;

    try {
      await saveWork;
    } finally {
      if (savePromiseRef.current === saveWork) {
        savePromiseRef.current = null;
      }
    }
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

  function showGroupCountWarning(message: string) {
    if (warningTimerRef.current !== null) {
      window.clearTimeout(warningTimerRef.current);
    }

    setClassCountWarning("");
    setGroupCountWarning(message);
    warningTimerRef.current = window.setTimeout(() => {
      setGroupCountWarning("");
      warningTimerRef.current = null;
    }, 2200);
  }

  function showClassCountWarning(message: string) {
    if (warningTimerRef.current !== null) {
      window.clearTimeout(warningTimerRef.current);
    }

    setGroupCountWarning("");
    setClassCountWarning(message);
    warningTimerRef.current = window.setTimeout(() => {
      setClassCountWarning("");
      warningTimerRef.current = null;
    }, 2600);
  }

  function beginDeleteRow(rowKey: string) {
    setDeletingRowKeys((current) => {
      if (current.has(rowKey)) {
        return current;
      }

      return new Set(current).add(rowKey);
    });

    if (rowDeleteTimersRef.current[rowKey]) {
      window.clearTimeout(rowDeleteTimersRef.current[rowKey]);
    }

    rowDeleteTimersRef.current[rowKey] = window.setTimeout(() => {
      setDeletingRowKeys((current) => {
        const next = new Set(current);
        next.delete(rowKey);
        return next;
      });
      delete rowDeleteTimersRef.current[rowKey];
      deleteRowByKey(rowKey);
    }, 900);
  }

  async function handleClassCountSubmit() {
    const parsedValue = Number.parseInt(classCountInput.trim(), 10);

    if (!Number.isInteger(parsedValue) || String(parsedValue) !== classCountInput.trim()) {
      showClassCountWarning("학급 수는 숫자로 입력해야 합니다.");
      return;
    }

    if (parsedValue < 1) {
      showClassCountWarning("학급 수는 1 이상이어야 합니다.");
      return;
    }

    if (parsedValue === classNumbersState.length) {
      return;
    }

    const confirmed = await confirm({
      title: `학급 수를 ${parsedValue}개로 변경할까요?`,
      confirmLabel: "변경",
    });

    if (!confirmed) {
      return;
    }

    try {
      await flushPendingSave();
      const formData = new FormData();
      formData.set("classCount", String(parsedValue));
      formData.set("returnClassNo", String(classNo));
      const result = await runActionWithFeedback("class-count", () => classCountAction(formData));

      if (!result?.classNumbers || !result.classCount) {
        return;
      }

      setClassNumbersState(result.classNumbers);
      setClassStudentCountsState((current) => {
        const next: Record<number, number> = {};

        for (const itemClassNo of result.classNumbers ?? []) {
          next[itemClassNo] = current[itemClassNo] ?? 0;
        }

        return next;
      });
      setClassCountInput(String(result.classCount));

      if (classNo > result.classCount) {
        router.replace(`/admin?classNo=${result.currentClassNo ?? result.classCount}`);
        return;
      }

      showSaveNotice("");
    } catch (error) {
      console.error(error);
      showClassCountWarning(actionErrorMessage(error, "학급 수를 변경하지 못했습니다."));
    }
  }

  async function handleGroupCountSelect(targetCount: number) {
    setGroupCountPickerOpen(false);

    if (targetCount === groupsState.length) {
      return;
    }

    const groupIdSet = new Set(groupsState.map((group) => group.id));
    const occupiedGroupCount = new Set(
      activeRows
        .map((row) => row.groupId)
        .filter((groupId) => groupId && groupIdSet.has(groupId)),
    ).size;

    if (targetCount < occupiedGroupCount) {
      showGroupCountWarning(
        `학생이 배정된 그룹이 ${occupiedGroupCount}개 있어 그보다 적게 줄일 수 없습니다.`,
      );
      return;
    }

    try {
      await flushPendingSave();
      const formData = new FormData();
      formData.set("classNo", String(classNo));
      formData.set("returnClassNo", String(classNo));
      formData.set("groupCount", String(targetCount));
      const result = await runActionWithFeedback("group-count", () => groupCountAction(formData));

      if (result?.groups) {
        applyGroupsUpdate(result.groups);
      }
    } catch (error) {
      console.error(error);
      showGroupCountWarning("그룹 수를 변경하지 못했습니다.");
    }
  }

  async function handleDeleteEmptyGroups() {
    try {
      await flushPendingSave();
      const formData = new FormData();
      formData.set("classNo", String(classNo));
      formData.set("returnClassNo", String(classNo));
      const result = await runActionWithFeedback("delete-empty-groups", () =>
        deleteEmptyGroupsAction(formData),
      );

      if (result?.groups) {
        applyGroupsUpdate(result.groups);
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function handleGroupPasswordSubmit(form: HTMLFormElement, groupId: string, clearPassword = false) {
    const formData = new FormData(form);
    const password = String(formData.get(`password-${groupId}`) ?? "").trim();
    formData.set("clearPassword", clearPassword ? "1" : "0");

    if (!clearPassword && !password) {
      showSaveNotice("새 그룹 비밀번호를 입력하세요.");
      return;
    }

    try {
      const result = await runActionWithFeedback(`group-password-${groupId}`, () => passwordAction(formData));
      if (result?.group) {
        setGroupsState((current) =>
          current.map((group) =>
            group.id === groupId ? result.group! : group,
          ),
        );
      } else if (clearPassword) {
        setGroupsState((current) =>
          current.map((group) =>
            group.id === groupId ? { ...group, password_hash: null, has_password: false } : group,
          ),
        );
      }
      form.reset();
    } catch (error) {
      console.error(error);
    }
  }

  async function handleBulkPasswordSubmit(form: HTMLFormElement, clearPassword = false) {
    const formData = new FormData(form);
    const password = String(formData.get("password") ?? "").trim();
    formData.set("clearPassword", clearPassword ? "1" : "0");

    if (!groupsState.length) {
      showSaveNotice("먼저 그룹을 만들어야 합니다.");
      return;
    }

    if (!clearPassword && !password) {
      showSaveNotice("반 전체에 적용할 비밀번호를 입력하세요.");
      return;
    }

    if (clearPassword) {
      const confirmed = await confirm({
        title: `${classNo}반 모든 그룹의 비밀번호를 해제할까요?`,
        confirmLabel: "해제",
        tone: "danger",
      });

      if (!confirmed) {
        return;
      }
    }

    try {
      const feedbackKey = clearPassword ? "bulk-class-password-clear" : "bulk-class-password";
      const result = await runActionWithFeedback(feedbackKey, () => bulkPasswordAction(formData));
      if (result?.groups) {
        applyGroupsUpdate(result.groups);
      }
      form.reset();
      setBulkPasswordVisible(false);
    } catch (error) {
      console.error(error);
      showSaveNotice(
        actionErrorMessage(
          error,
          clearPassword ? "반 전체 비밀번호를 해제하지 못했습니다." : "반 전체 비밀번호를 설정하지 못했습니다.",
        ),
      );
    }
  }

  async function clearAllGroupAssignments() {
    const confirmed = await confirm({
      title: `${classNo}반 전체 학생을 미지정으로 변경할까요?`,
      confirmLabel: "변경",
    });

    if (!confirmed) {
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

  async function handleDeleteClassStudents() {
    const confirmed = await confirm({
      title: `${classNo}반 전체 학생을 정말로 삭제할까요?`,
      confirmLabel: "삭제",
      tone: "danger",
    });

    if (!confirmed) {
      return;
    }

    deleteStudentsFormRef.current?.requestSubmit();
  }

  return (
    <div className="grid min-w-0 gap-5">
      <section className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">학급</h2>
            <p className="mt-1 text-sm text-zinc-500">현재 {classNumbersState.length}개 반</p>
          </div>
          <div className="relative flex flex-wrap items-center gap-2">
            <label className="text-sm font-semibold text-zinc-700" htmlFor="classCount">
              학급 수
            </label>
            <input
              id="classCount"
              type="number"
              min="1"
              inputMode="numeric"
              value={classCountInput}
              disabled={actionFeedback["class-count"] === "pending"}
              onChange={(event) => setClassCountInput(event.target.value)}
              className="min-h-10 w-24 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800 outline-none focus:border-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <ActionStatusButton
              disabled={actionFeedback["class-count"] === "pending"}
              onClick={() => void handleClassCountSubmit()}
              label="저장"
              display={actionLabel("class-count", "저장")}
            />
            {classCountWarning ? (
              <p className="absolute right-0 top-full z-20 mt-2 w-72 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 shadow-sm">
                {classCountWarning}
              </p>
            ) : null}
          </div>
        </div>

        <nav
          ref={classTabsRef}
          onScroll={() => syncVisibleClassPageFromScroll()}
          {...classTabDragHandlers}
          className={`mt-4 flex w-full min-w-0 max-w-full overflow-x-auto overscroll-contain rounded-lg border border-zinc-200 bg-white ${
            classTabsDragging ? "cursor-grabbing select-none" : "cursor-grab"
          }`}
        >
          {classNumbersState.map((itemClassNo) => {
            const active = itemClassNo === classNo;
            const count = active ? activeCount : classStudentCountsState[itemClassNo] ?? 0;

            return (
              <Link
                key={itemClassNo}
                data-class-no={itemClassNo}
                href={`/admin?classNo=${itemClassNo}`}
                className={`min-h-12 min-w-16 shrink-0 border-r border-zinc-200 px-3 py-2 text-center text-sm font-semibold last:border-r-0 sm:min-w-20 ${
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

        {classTabPages.length > 1 ? (
          <div className="mt-3 flex justify-center">
            <div className="flex max-w-full gap-2 overflow-x-auto px-1 py-1">
              {classTabPages.map((page, index) => {
                const firstClass = classNumbersState[page.startIndex] ?? 1;
                const lastClass = classNumbersState[Math.max(page.endIndex - 1, page.startIndex)] ?? firstClass;
                const active = index === visibleClassPageIndex;

                return (
                  <button
                    key={index}
                    type="button"
                    title={`${firstClass}반 ~ ${lastClass}반`}
                    aria-label={`${firstClass}반부터 ${lastClass}반까지 보기`}
                    onClick={() => scrollClassTabsToPage(index, "smooth")}
                    className={`h-2.5 w-2.5 shrink-0 rounded-full transition ${
                      active ? "bg-zinc-900" : "bg-zinc-300 hover:bg-zinc-500"
                    }`}
                  />
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{classNo}반 그룹</h2>
          </div>
          <div className="relative flex flex-wrap items-center gap-2">
            <label className="text-base font-medium text-zinc-700" htmlFor="groupCount">
              그룹 수
            </label>
            {groupCountPickerOpen ? (
              <button
                type="button"
                aria-label="그룹 수 선택 닫기"
                className="fixed inset-0 z-20 cursor-default bg-transparent"
                onClick={() => setGroupCountPickerOpen(false)}
              />
            ) : null}
            <button
              id="groupCount"
              ref={groupCountButtonRef}
              type="button"
              disabled={actionFeedback["group-count"] === "pending"}
              onClick={() => setGroupCountPickerOpen((current) => !current)}
              className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <StableButtonLabel
                label={`${groupsState.length}개`}
                display={actionLabel("group-count", `${groupsState.length}개`)}
              />
            </button>
            {groupCountPickerOpen && groupCountPickerPosition ? (
              <div
                className="fixed z-30 grid grid-cols-4 gap-1 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg sm:grid-cols-5"
                style={{
                  left: groupCountPickerPosition.left,
                  top: groupCountPickerPosition.top,
                  width: groupCountPickerPosition.width,
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="col-span-full flex items-center justify-between rounded-md bg-zinc-50 px-2.5 py-2">
                  <span className="text-sm font-semibold text-zinc-800">그룹 수 선택</span>
                  <span className="text-xs font-medium text-zinc-500">현재 {groupsState.length}개</span>
                </div>
                {Array.from({ length: 27 }, (_, count) => {
                  const active = count === groupsState.length;

                  return (
                    <button
                      key={count}
                      type="button"
                      onClick={() => void handleGroupCountSelect(count)}
                      className={`flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-bold ${
                        active ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-teal-50"
                      }`}
                    >
                      {count}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <button
              type="button"
              disabled={actionFeedback["delete-empty-groups"] === "pending"}
              onClick={() => void handleDeleteEmptyGroups()}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <StableButtonLabel
                label="빈 그룹 삭제"
                display={actionLabel("delete-empty-groups", "빈 그룹 삭제")}
              />
            </button>
            {groupCountWarning ? (
              <p className="absolute right-0 top-full z-20 mt-2 w-72 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 shadow-sm">
                {groupCountWarning}
              </p>
            ) : null}
          </div>
        </div>

        <form
          className="mt-4 grid gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleBulkPasswordSubmit(event.currentTarget);
          }}
        >
          <input type="hidden" name="classNo" value={classNo} />
          <input type="hidden" name="returnClassNo" value={classNo} />
          <p className="text-lg font-semibold text-zinc-800">전체 그룹 비밀번호</p>
          <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-2">
            <div className="flex min-w-0 items-stretch rounded-md border border-zinc-300 bg-white focus-within:border-teal-500">
              <input
                name="password"
                type={bulkPasswordVisible ? "text" : "password"}
                autoComplete="new-password"
                data-1p-ignore="true"
                data-lpignore="true"
                placeholder="일괄 비밀번호"
                className="min-h-10 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
              />
              <button
                type="button"
                title={bulkPasswordVisible ? "비밀번호 숨기기" : "비밀번호 보기"}
                aria-label={bulkPasswordVisible ? "비밀번호 숨기기" : "비밀번호 보기"}
                onClick={() => setBulkPasswordVisible((current) => !current)}
                className="flex min-h-10 w-10 shrink-0 items-center justify-center text-zinc-700"
              >
                {bulkPasswordVisible ? <EyeIcon /> : <EyeOffIcon />}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={actionFeedback["bulk-class-password-clear"] === "pending" || !groupsState.length}
                onClick={(event) => {
                  const form = event.currentTarget.form;

                  if (form) {
                    void handleBulkPasswordSubmit(form, true);
                  }
                }}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <StableButtonLabel
                  label="해제"
                  display={actionLabel("bulk-class-password-clear", "해제")}
                />
              </button>
              <button
                disabled={actionFeedback["bulk-class-password"] === "pending" || !groupsState.length}
                className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <StableButtonLabel
                  label="설정"
                  display={actionLabel("bulk-class-password", "설정")}
                />
              </button>
            </div>
          </div>
        </form>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <GroupDropZone
            title="미지정"
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
                      groups={groupsState}
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

          {groupsState.map((group) => {
            const groupRows = rows
              .map((row, rowIndex) => ({ row, rowIndex }))
              .filter(({ row }) => row.name.trim() && !row.deleted && row.groupId === group.id);
            const hasPassword = groupHasPassword(group);

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
                        groups={groupsState}
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
                <form
                  className="mt-3 grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleGroupPasswordSubmit(event.currentTarget, group.id);
                  }}
                >
                  <input type="hidden" name="groupId" value={group.id} />
                  <input type="hidden" name="returnClassNo" value={classNo} />
                  <p className="text-xs font-medium text-zinc-500">
                    {hasPassword ? "비밀번호 설정됨" : "비밀번호 없음"}
                  </p>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <div className="flex min-w-0 items-stretch rounded-md border border-zinc-300 bg-white focus-within:border-teal-500">
                    <input
                      name={`password-${group.id}`}
                      type={visiblePasswordGroups.has(group.id) ? "text" : "password"}
                      autoComplete="new-password"
                      data-1p-ignore="true"
                      data-lpignore="true"
                      defaultValue=""
                      placeholder={hasPassword ? `${groupDisplayName(classNo, group)} 새 비밀번호` : `${groupDisplayName(classNo, group)} 비밀번호 설정`}
                      className="min-h-10 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
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
                      className="flex min-h-10 w-10 shrink-0 items-center justify-center text-zinc-700"
                    >
                      {visiblePasswordGroups.has(group.id) ? <EyeIcon /> : <EyeOffIcon />}
                    </button>
                  </div>
                    <div className="flex items-center gap-2">
                      {hasPassword ? (
                        <button
                          type="button"
                          disabled={actionFeedback[`group-password-${group.id}`] === "pending"}
                          onClick={(event) => {
                            const form = event.currentTarget.form;
                            if (form) {
                              void handleGroupPasswordSubmit(form, group.id, true);
                            }
                          }}
                          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          해제
                        </button>
                      ) : null}
                      <button
                        disabled={actionFeedback[`group-password-${group.id}`] === "pending"}
                        className="rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <StableButtonLabel
                          label="설정"
                          display={actionLabel(`group-password-${group.id}`, "설정")}
                        />
                      </button>
                    </div>
                  </div>
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
              ref={deleteStudentsFormRef}
              action={deleteClassStudentsAction}
              suppressHydrationWarning
            >
              <input type="hidden" name="classNo" value={classNo} />
              <input type="hidden" name="returnClassNo" value={classNo} />
              <button
                type="button"
                onClick={() => void handleDeleteClassStudents()}
                className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700"
              >
                전체 삭제
              </button>
            </form>
          </div>
        </div>

        {saveNotice ? (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
            {saveNotice}
          </p>
        ) : null}

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
                const deleting = deletingRowKeys.has(row.rowKey);

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
                      disabled={deleting}
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
                      className="min-h-10 min-w-0 border-r border-zinc-200 bg-transparent px-2 text-sm outline-none focus:bg-teal-50 disabled:bg-zinc-50 disabled:text-zinc-400 sm:px-3"
                    />
                    <select
                      name="studentGender"
                      value={row.gender}
                      disabled={deleting}
                      onChange={(event) =>
                        updateRow(
                          index,
                          row.name.trim() ? { gender: event.target.value as Gender } : { gender: "" },
                        )
                      }
                      className="min-h-10 min-w-0 border-r border-zinc-200 bg-transparent px-1 text-sm outline-none focus:bg-teal-50 sm:px-3"
                    >
                      <option value=""> </option>
                      <option value="male">남</option>
                      <option value="female">여</option>
                    </select>
                    <select
                      name="studentGroupId"
                      value={row.groupId}
                      disabled={deleting}
                      onChange={(event) => void moveStudent(index, event.target.value)}
                      className="min-h-10 min-w-0 border-r border-zinc-200 bg-transparent px-1 text-sm outline-none focus:bg-teal-50 sm:px-3"
                    >
                      <option value="">미지정</option>
                      {groupsState.map((group) => (
                        <option key={group.id} value={group.id}>
                          {groupDisplayName(classNo, group)}
                        </option>
                      ))}
                    </select>
                    <div className="flex min-h-10 items-center justify-center px-1 sm:px-2">
                      {deleting ? (
                        <span className="flex h-8 w-8 items-center justify-center text-[10px] font-semibold leading-none text-teal-700 max-[380px]:h-7 max-[380px]:w-7">
                          완료
                        </span>
                      ) : (
                        <button
                          type="button"
                          title="삭제"
                          aria-label="삭제"
                          disabled={!row.id && !row.name}
                          onClick={() => beginDeleteRow(row.rowKey)}
                          className="flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-white text-red-700 disabled:cursor-not-allowed disabled:opacity-40 max-[380px]:h-7 max-[380px]:w-7"
                        >
                          <TrashIcon />
                        </button>
                      )}
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
      {confirmDialog}
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
