"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionStatusButton } from "@/app/ui/action-status-button";
import { useConfirmDialog } from "@/lib/use-confirm-dialog";

const MIN_HOME_COUNT = 1;

type HomeTitleRow = {
  line1: string;
  line2: string;
};

type HomePackage = {
  id?: string;
  line1: string;
  line2: string;
  classCount: number;
  rows: HomeTitleRow[];
  selectedIndex: number;
};

type EditableHomePackage = {
  packageKey: string;
  id?: string;
  line1: string;
  line2: string;
};

type HomeManagementSaveResult = {
  packages?: HomePackage[];
  activeIndex?: number;
};

function createHomePackage(index: number, homePackage?: Partial<HomePackage>): EditableHomePackage {
  return {
    packageKey: `home-package-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    id: homePackage?.id,
    line1: homePackage?.line1 ?? "",
    line2: homePackage?.line2 ?? "",
  };
}

function buildPackages(packages: HomePackage[], padToMinimum = false) {
  const source = packages.length
    ? packages
    : [{ id: undefined, line1: "", line2: "", classCount: 1, rows: [{ line1: "", line2: "" }], selectedIndex: 0 }];
  const nextPackages = source.map((homePackage, index) => createHomePackage(index, homePackage));

  while (padToMinimum && nextPackages.length < MIN_HOME_COUNT) {
    nextPackages.push(createHomePackage(nextPackages.length));
  }

  return nextPackages;
}

function stripEditablePackages(packages: EditableHomePackage[]): HomePackage[] {
  return packages.map((homePackage) => ({
    id: homePackage.id,
    line1: homePackage.line1,
    line2: homePackage.line2,
    classCount: 1,
    rows: [{ line1: homePackage.line1, line2: homePackage.line2 }],
    selectedIndex: 0,
  }));
}

export function HomeManagementSettings({
  initialPackages,
  initialActiveIndex,
  action,
}: {
  initialPackages: HomePackage[];
  initialActiveIndex: number;
  action: (formData: FormData) => Promise<HomeManagementSaveResult | void>;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirmDialog();
  const doneTimerRef = useRef<number | null>(null);
  const [packages, setPackages] = useState(() => buildPackages(initialPackages, true));
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.min(Math.max(0, initialActiveIndex), Math.max(0, buildPackages(initialPackages, true).length - 1)),
  );
  const [selectedRowIndex, setSelectedRowIndex] = useState(() =>
    Math.min(Math.max(0, initialActiveIndex), Math.max(0, buildPackages(initialPackages, true).length - 1)),
  );
  const [saveState, setSaveState] = useState<"idle" | "pending" | "done">("idle");
  const [saveRowIndex, setSaveRowIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    return () => {
      if (doneTimerRef.current !== null) {
        window.clearTimeout(doneTimerRef.current);
      }
    };
  }, []);

  function isPackageEmpty(homePackage: EditableHomePackage) {
    return !homePackage.line1.trim() && !homePackage.line2.trim();
  }

  function updatePackage(index: number, next: Partial<EditableHomePackage>) {
    setPackages((current) =>
      current.map((homePackage, packageIndex) =>
        packageIndex === index ? { ...homePackage, ...next } : homePackage,
      ),
    );
  }

  async function addHomePackage() {
    const confirmed = await confirm({
      title: "새로운 홈을 생성하시겠습니까?",
      confirmLabel: "생성",
    });

    if (!confirmed) {
      return;
    }

    setPackages((current) => [...current, createHomePackage(current.length)]);
  }

  async function persistPackages(
    nextPackages: EditableHomePackage[],
    nextActiveIndex: number,
    nextSelectedRowIndex: number,
    saveTargetIndex: number | null,
  ) {
    if (doneTimerRef.current !== null) {
      window.clearTimeout(doneTimerRef.current);
      doneTimerRef.current = null;
    }

    setSaveState("pending");
    setSaveRowIndex(saveTargetIndex);
    setNotice("");

    try {
      const formData = new FormData();
      formData.set("packages", JSON.stringify(stripEditablePackages(nextPackages)));
      formData.set("activeIndex", String(Math.min(Math.max(0, nextActiveIndex), nextPackages.length - 1)));
      const result = await action(formData);
      const normalizedPackages = buildPackages(result?.packages ?? stripEditablePackages(nextPackages));

      setPackages(normalizedPackages);
      setActiveIndex(
        Math.min(Math.max(0, result?.activeIndex ?? nextActiveIndex), Math.max(0, normalizedPackages.length - 1)),
      );
      setSelectedRowIndex(
        Math.min(Math.max(0, nextSelectedRowIndex), Math.max(0, normalizedPackages.length - 1)),
      );
      setSaveState("done");
      router.refresh();
      doneTimerRef.current = window.setTimeout(() => {
        setSaveState("idle");
        setSaveRowIndex(null);
        doneTimerRef.current = null;
      }, 1200);
    } catch (error) {
      setSaveState("idle");
      setSaveRowIndex(null);
      setNotice(error instanceof Error ? error.message : "홈 관리를 저장하지 못했습니다.");
    }
  }

  async function saveHomeTitle(index: number) {
    await persistPackages(packages, activeIndex, selectedRowIndex, index);
  }

  async function switchHome(index: number) {
    if (index === activeIndex) {
      return;
    }

    const confirmed = await confirm({
      title: "홈을 전환하시겠습니까?",
      confirmLabel: "전환",
    });

    if (!confirmed) {
      return;
    }

    await persistPackages(packages, index, selectedRowIndex, null);
  }

  async function removeSelectedHomePackage() {
    const safeSelectedRowIndex = Math.min(Math.max(0, selectedRowIndex), Math.max(0, packages.length - 1));
    const safeActiveIndex = Math.min(Math.max(0, activeIndex), Math.max(0, packages.length - 1));

    if (packages.length <= 1) {
      return;
    }

    if (!isPackageEmpty(packages[safeSelectedRowIndex] ?? createHomePackage(safeSelectedRowIndex))) {
      const confirmed = await confirm({
        title: "선택된 홈을 삭제하시겠습니까?",
        description: "모든 데이터가 삭제되며 복구할 수 없습니다.\n삭제를 진행하려면 '홈 삭제'라고 입력하세요.",
        requiredText: "홈 삭제",
        inputLabel: null,
        inputPlaceholder: "홈 삭제",
        confirmLabel: "삭제",
        tone: "danger",
      });

      if (!confirmed) {
        return;
      }
    }

    const nextPackages = packages.filter((_, packageIndex) => packageIndex !== safeSelectedRowIndex);
    const nextSelectedRowIndex = Math.min(safeSelectedRowIndex, Math.max(0, nextPackages.length - 1));
    const nextActiveIndex = Math.min(
      Math.max(
        0,
        safeSelectedRowIndex < safeActiveIndex
          ? safeActiveIndex - 1
          : safeSelectedRowIndex === safeActiveIndex
            ? safeActiveIndex
            : safeActiveIndex,
      ),
      Math.max(0, nextPackages.length - 1),
    );

    await persistPackages(nextPackages, nextActiveIndex, nextSelectedRowIndex, null);
  }

  return (
    <>
      <section className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">홈 관리</h2>
            <p className="mt-1 text-sm text-zinc-500 sm:hidden">여러 홈을 관리합니다.</p>
            <p className="mt-1 hidden text-sm text-zinc-500 sm:block">여러 홈페이지를 한 번에 관리합니다.</p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
            <button
              type="button"
              onClick={addHomePackage}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800"
            >
              홈 추가
            </button>
            <button
              type="button"
              disabled={packages.length <= 1 || selectedRowIndex === activeIndex}
              onClick={() => void removeSelectedHomePackage()}
              className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="sm:hidden">선택 홈 삭제</span>
              <span className="hidden sm:inline">선택된 홈 삭제</span>
            </button>
          </div>
        </div>

        {notice ? (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
            {notice}
          </p>
        ) : null}

        <div className="mt-4 space-y-3 sm:hidden">
          {packages.map((homePackage, index) => (
            <div
              key={`${homePackage.packageKey}-mobile`}
              className={`rounded-lg border p-3 ${
                selectedRowIndex === index ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 bg-white"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-600">
                  {index + 1}번
                </span>
                {activeIndex === index ? (
                  <span className="rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-white">
                    현재 홈
                  </span>
                ) : null}
                <label className="ml-auto flex items-center gap-2 text-xs font-semibold text-zinc-600">
                  선택
                  <input
                    type="radio"
                    name="selectedHomeRowMobile"
                    checked={selectedRowIndex === index}
                    onChange={() => setSelectedRowIndex(index)}
                    className="h-4 w-4 accent-zinc-900"
                  />
                </label>
              </div>

              <div className="mt-3 grid gap-2">
                <input
                  aria-label={`홈 ${index + 1} 홈 제목 첫째 열 모바일`}
                  value={homePackage.line1}
                  onChange={(event) => updatePackage(index, { line1: event.target.value })}
                  placeholder="홈 제목 첫째 열"
                  className="min-h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-teal-700 outline-none focus:border-teal-500"
                />
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <input
                    aria-label={`홈 ${index + 1} 홈 제목 둘째 열 모바일`}
                    value={homePackage.line2}
                    onChange={(event) => updatePackage(index, { line2: event.target.value })}
                    placeholder="홈 제목 둘째 열"
                    className="min-h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-base font-bold text-zinc-950 outline-none focus:border-teal-500"
                  />
                  <ActionStatusButton
                    disabled={saveState === "pending"}
                    onClick={() => void saveHomeTitle(index)}
                    label="저장"
                    display={saveState === "done" && saveRowIndex === index ? "완료" : "저장"}
                  />
                </div>
              </div>

              <div className="mt-3">
                {activeIndex === index ? (
                  <div className="flex min-h-10 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-sm font-semibold text-zinc-600">
                    현재 홈
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={saveState === "pending"}
                    onClick={() => void switchHome(index)}
                    aria-label={`${index + 1}번 전환 모바일`}
                    className="flex min-h-10 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-2 text-sm font-semibold text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    전환
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 hidden overflow-x-auto rounded-md border border-zinc-300 bg-white sm:block">
          <div className="min-w-[740px]">
            <div className="grid grid-cols-[56px_minmax(180px,1fr)_minmax(200px,1.2fr)_108px_104px_72px] bg-zinc-100 text-xs font-semibold text-zinc-600">
              <div className="border-r border-zinc-300 px-2 py-2 text-center">번호</div>
              <div className="col-span-3 border-r border-zinc-300 px-3 py-2 text-center">제목</div>
              <div className="border-r border-zinc-300 px-2 py-2 text-center">전환</div>
              <div className="px-2 py-2 text-center">선택</div>
            </div>

            {packages.map((homePackage, index) => (
              <div
                key={homePackage.packageKey}
                className="grid grid-cols-[56px_minmax(180px,1fr)_minmax(200px,1.2fr)_108px_104px_72px] border-t border-zinc-200"
              >
                <div className="border-r border-zinc-200 px-2 py-2 text-center text-sm font-medium text-zinc-500">
                  {index + 1}
                </div>
                <div className="col-span-3 border-r border-zinc-200 p-2">
                  <div className="grid grid-cols-[minmax(180px,1fr)_minmax(200px,1.2fr)_auto] items-center gap-2">
                    <input
                      aria-label={`홈 ${index + 1} 홈 제목 첫째 열`}
                      value={homePackage.line1}
                      onChange={(event) => updatePackage(index, { line1: event.target.value })}
                      placeholder="홈 제목 첫째 열"
                      className="min-h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-teal-700 outline-none focus:border-teal-500"
                    />
                    <input
                      aria-label={`홈 ${index + 1} 홈 제목 둘째 열`}
                      value={homePackage.line2}
                      onChange={(event) => updatePackage(index, { line2: event.target.value })}
                      placeholder="홈 제목 둘째 열"
                      className="min-h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-base font-bold text-zinc-950 outline-none focus:border-teal-500"
                    />
                    <ActionStatusButton
                      disabled={saveState === "pending"}
                      onClick={() => void saveHomeTitle(index)}
                      label="저장"
                      display={saveState === "done" && saveRowIndex === index ? "완료" : "저장"}
                    />
                  </div>
                </div>
                <div className="border-r border-zinc-200 px-2 py-2">
                  {activeIndex === index ? (
                    <div className="flex min-h-10 items-center justify-center text-sm font-semibold text-zinc-700">
                      현재 홈
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={saveState === "pending"}
                      onClick={() => void switchHome(index)}
                      aria-label={`${index + 1}번 전환`}
                      className="flex min-h-10 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-2 text-sm font-semibold text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      전환
                    </button>
                  )}
                </div>
                <div className="px-2 py-2">
                  <label className="flex min-h-10 cursor-pointer items-center justify-center">
                    <input
                      type="radio"
                      name="selectedHomeRowDesktop"
                      checked={selectedRowIndex === index}
                      onChange={() => setSelectedRowIndex(index)}
                      className="h-4 w-4 accent-zinc-900"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      {confirmDialog}
    </>
  );
}

export const HomeTitleSettings = HomeManagementSettings;
