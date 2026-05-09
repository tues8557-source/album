"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loginGroup } from "@/app/actions";
import { genderClass, groupName } from "@/lib/format";
import {
  measureTabStripPages,
  pageIndexForItemIndex,
  pageIndexForScrollLeft,
  tabStripPagesEqual,
  type TabStripPage,
} from "@/lib/tab-strip-pages";
import { useHorizontalDragScroll } from "@/lib/use-horizontal-drag-scroll";
import type { Group, GroupMember } from "@/lib/types";

type ClassData = {
  classNo: number;
  groups: Group[];
  members: GroupMember[];
};

export function ClassGroupTabs({
  classData,
  initialClassNo,
  errorGroupId,
  rateLimitedGroupId,
  staleGroupId,
}: {
  classData: ClassData[];
  initialClassNo: number;
  errorGroupId?: string;
  rateLimitedGroupId?: string;
  staleGroupId?: string;
}) {
  const [activeClassNo, setActiveClassNo] = useState<number>(initialClassNo);
  const [visiblePasswordGroups, setVisiblePasswordGroups] = useState<Set<string>>(new Set());
  const tabsRef = useRef<HTMLElement | null>(null);
  const { dragHandlers, dragging } = useHorizontalDragScroll(tabsRef);
  const [pages, setPages] = useState<TabStripPage[]>([
    { endIndex: classData.length, scrollLeft: 0, startIndex: 0 },
  ]);
  const [visiblePageIndex, setVisiblePageIndex] = useState(0);
  const activeClass = classData.find((item) => item.classNo === activeClassNo) ?? classData[0];
  const useCompactMobileTabs = classData.length <= 7;

  const measurePages = useCallback(() => {
    const container = tabsRef.current;

    if (!container || container.clientWidth <= 0) {
      return;
    }

    const nextPages = measureTabStripPages(container);

    setPages((current) => (tabStripPagesEqual(current, nextPages) ? current : nextPages));
    setVisiblePageIndex((current) => {
      const nextPageIndex = pageIndexForScrollLeft(
        nextPages,
        container.scrollLeft,
        Math.max(0, container.scrollWidth - container.clientWidth),
      );
      return current === nextPageIndex ? current : nextPageIndex;
    });
  }, []);

  function syncVisiblePageFromScroll(container: HTMLElement | null = tabsRef.current) {
    if (!container || !pages.length) {
      return;
    }

    const nextPageIndex = pageIndexForScrollLeft(
      pages,
      container.scrollLeft,
      Math.max(0, container.scrollWidth - container.clientWidth),
    );
    setVisiblePageIndex((current) => (current === nextPageIndex ? current : nextPageIndex));
  }

  function scrollTabsToPage(pageIndex: number, behavior: ScrollBehavior) {
    const container = tabsRef.current;
    const page = pages[pageIndex];

    if (!container || !page) {
      return;
    }

    container.scrollTo({ left: page.scrollLeft, behavior });
    setVisiblePageIndex((current) => (current === pageIndex ? current : pageIndex));
  }

  useEffect(() => {
    window.addEventListener("resize", measurePages);
    return () => window.removeEventListener("resize", measurePages);
  }, [measurePages]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(measurePages);
    return () => window.cancelAnimationFrame(frame);
  }, [classData.length, measurePages]);

  useEffect(() => {
    const activeClassIndex = Math.max(
      0,
      classData.findIndex((item) => item.classNo === activeClassNo),
    );
    const targetPageIndex = pageIndexForItemIndex(pages, activeClassIndex);
    const frame = window.requestAnimationFrame(() => {
      const container = tabsRef.current;
      const targetPage = pages[targetPageIndex];

      if (!container || !targetPage) {
        return;
      }

      container.scrollTo({ left: targetPage.scrollLeft, behavior: "auto" });
      setVisiblePageIndex((current) => (current === targetPageIndex ? current : targetPageIndex));
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeClassNo, classData, pages]);

  return (
    <div className="grid min-w-0 gap-4">
      {useCompactMobileTabs ? (
        <div
          className="grid overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm sm:hidden"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, classData.length)}, minmax(0, 1fr))` }}
        >
          {classData.map(({ classNo }, index) => (
            <button
              key={`mobile-${classNo}`}
              type="button"
              onClick={() => setActiveClassNo(classNo)}
              className={`min-h-11 border-r border-zinc-200 px-1 py-2 text-center text-[11px] font-semibold last:border-r-0 ${
                index === classData.length - 1 ? "border-r-0" : ""
              } ${
                classNo === activeClassNo
                  ? "bg-zinc-900 text-white"
                  : "bg-white text-zinc-700"
              }`}
            >
              {classNo}반
            </button>
          ))}
        </div>
      ) : null}

      <nav
        ref={tabsRef}
        onScroll={() => syncVisiblePageFromScroll()}
        {...dragHandlers}
        className={`${useCompactMobileTabs ? "hidden sm:flex" : "flex"} w-full min-w-0 max-w-full overflow-x-auto overscroll-contain rounded-lg border border-zinc-200 bg-white shadow-sm ${
          dragging ? "cursor-grabbing select-none" : "cursor-grab"
        }`}
      >
        {classData.map(({ classNo }) => (
          <button
            key={classNo}
            data-class-no={classNo}
            type="button"
            onClick={() => setActiveClassNo(classNo)}
            className={`min-h-12 min-w-16 shrink-0 border-r border-zinc-200 px-3 py-2 text-center text-sm font-semibold last:border-r-0 sm:min-w-20 ${
              classNo === activeClassNo
                ? "bg-zinc-900 text-white"
                : "bg-white text-zinc-700 hover:bg-zinc-50"
            }`}
          >
            {classNo}반
          </button>
        ))}
      </nav>

      {pages.length > 1 && !useCompactMobileTabs ? (
        <div className="flex justify-center">
          <div className="flex max-w-full gap-2 overflow-x-auto px-1 py-1">
            {pages.map((page, index) => {
              const firstClass = classData[page.startIndex]?.classNo ?? 1;
              const lastClass = classData[Math.max(page.endIndex - 1, page.startIndex)]?.classNo ?? firstClass;
              const active = index === visiblePageIndex;

              return (
                <button
                  key={index}
                  type="button"
                  title={`${firstClass}반 ~ ${lastClass}반`}
                  aria-label={`${firstClass}반부터 ${lastClass}반까지 보기`}
                  onClick={() => scrollTabsToPage(index, "smooth")}
                  className={`h-2.5 w-2.5 shrink-0 rounded-full transition ${
                    active ? "bg-zinc-900" : "bg-zinc-300 hover:bg-zinc-500"
                  }`}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold">{activeClass.classNo}반</h2>
          <span className="text-sm text-zinc-500">{activeClass.groups.length}개 그룹</span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {activeClass.groups.map((group) => {
            const members = activeClass.members.filter((member) => member.group_id === group.id);
            const label = groupName(activeClass.classNo, Math.max(0, group.sort_order - 1));
            const hasPassword = group.has_password ?? Boolean(group.password_hash);
            const passwordVisible = visiblePasswordGroups.has(group.id);

            return (
              <article key={group.id} className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-lg font-bold">{label}</p>
                  <span className="text-sm text-zinc-500">{members.length}명</span>
                </div>
                {staleGroupId === group.id ? (
                  <p className="mt-2 text-sm text-amber-700">비밀번호가 변경되어 다시 입장해야 합니다.</p>
                ) : null}
                {staleGroupId !== group.id && rateLimitedGroupId === group.id ? (
                  <p className="mt-2 text-sm text-amber-700">시도가 너무 많아 잠시 후 다시 시도해야 합니다.</p>
                ) : null}
                {staleGroupId !== group.id && errorGroupId === group.id ? (
                  <p className="mt-2 text-sm text-red-600">그룹 비밀번호를 확인하세요.</p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {members.length ? (
                    members.map((member) =>
                      member.students ? (
                        <span
                          key={member.id}
                          className={`rounded-md px-2.5 py-1 text-sm font-semibold ring-1 ${genderClass(
                            member.students.gender,
                          )}`}
                        >
                          {member.students.name}
                        </span>
                      ) : null,
                    )
                  ) : (
                    <span className="text-sm text-zinc-500">학생 미배정</span>
                  )}
                </div>
                <form
                  action={loginGroup}
                  autoComplete="off"
                  className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-2"
                  suppressHydrationWarning
                >
                  <input type="hidden" name="classNo" value={activeClass.classNo} />
                  <input type="hidden" name="groupId" value={group.id} />
                  <div
                    className={`flex min-w-0 items-stretch rounded-md border ${
                      hasPassword
                        ? "border-zinc-300 bg-white focus-within:border-teal-500"
                        : "border-zinc-300 bg-zinc-100"
                    }`}
                  >
                    <input
                      id={`group-password-${group.id}`}
                      name={`password-${group.id}`}
                      type={passwordVisible ? "text" : "password"}
                      autoComplete="new-password"
                      data-1p-ignore="true"
                      data-lpignore="true"
                      disabled={!hasPassword}
                      placeholder={hasPassword ? "그룹 비밀번호" : "비밀번호 없음"}
                      className="min-h-11 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none disabled:text-zinc-400"
                      suppressHydrationWarning
                    />
                    <button
                      type="button"
                      title={passwordVisible ? "비밀번호 숨기기" : "비밀번호 보기"}
                      aria-label={passwordVisible ? "비밀번호 숨기기" : "비밀번호 보기"}
                      disabled={!hasPassword}
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
                      className="grid min-h-11 w-10 shrink-0 place-items-center text-zinc-700 disabled:cursor-not-allowed disabled:text-zinc-400"
                    >
                      {passwordVisible ? <EyeIcon /> : <EyeOffIcon />}
                    </button>
                  </div>
                  <button className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">
                    입장
                  </button>
                </form>
              </article>
            );
          })}
        </div>

        {!activeClass.groups.length ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
            아직 생성된 그룹이 없습니다.
          </p>
        ) : null}
      </section>
    </div>
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
