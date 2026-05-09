export type TabStripPage = {
  endIndex: number;
  scrollLeft: number;
  startIndex: number;
};

function firstVisibleTabIndexAt(tabs: HTMLElement[], scrollLeft: number) {
  let visibleIndex = 0;

  for (let index = 0; index < tabs.length; index += 1) {
    if (tabs[index].offsetLeft <= scrollLeft + 1) {
      visibleIndex = index;
    } else {
      break;
    }
  }

  return visibleIndex;
}

function lastVisibleTabIndexAt(tabs: HTMLElement[], rightEdge: number) {
  let visibleIndex = 0;

  for (let index = 0; index < tabs.length; index += 1) {
    if (tabs[index].offsetLeft < rightEdge - 1) {
      visibleIndex = index;
    } else {
      break;
    }
  }

  return visibleIndex;
}

function firstPartiallyHiddenTabIndexAt(tabs: HTMLElement[], rightEdge: number, startIndex: number) {
  for (let index = startIndex; index < tabs.length; index += 1) {
    const tab = tabs[index];

    if (tab.offsetLeft + tab.offsetWidth > rightEdge - 1) {
      return index;
    }
  }

  return -1;
}

export function measureTabStripPages(container: HTMLElement, tabSelector = "[data-class-no]") {
  const tabs = Array.from(container.querySelectorAll<HTMLElement>(tabSelector));

  if (!tabs.length) {
    return [{ endIndex: 0, scrollLeft: 0, startIndex: 0 }];
  }

  const viewportWidth = Math.max(1, container.clientWidth);
  const maxScrollLeft = Math.max(0, container.scrollWidth - viewportWidth);
  const rawPages: Array<{ scrollLeft: number; startIndex: number }> = [];
  let scrollLeft = 0;
  let remaining = tabs.length + 1;

  while (remaining > 0) {
    remaining -= 1;
    const startIndex = firstVisibleTabIndexAt(tabs, scrollLeft);

    rawPages.push({ scrollLeft, startIndex });

    if (scrollLeft >= maxScrollLeft - 1 || startIndex >= tabs.length - 1) {
      break;
    }

    const rightEdge = scrollLeft + viewportWidth;
    let nextStartIndex = firstPartiallyHiddenTabIndexAt(tabs, rightEdge, startIndex);

    if (nextStartIndex === -1) {
      const lastStartIndex = firstVisibleTabIndexAt(tabs, maxScrollLeft);

      if (lastStartIndex !== startIndex || Math.abs(maxScrollLeft - scrollLeft) > 1) {
        rawPages.push({ scrollLeft: maxScrollLeft, startIndex: lastStartIndex });
      }
      break;
    }

    if (nextStartIndex <= startIndex) {
      nextStartIndex = Math.min(tabs.length - 1, startIndex + 1);
    }

    const nextScrollLeft = Math.min(maxScrollLeft, tabs[nextStartIndex].offsetLeft);

    if (nextScrollLeft <= scrollLeft + 1) {
      const lastStartIndex = firstVisibleTabIndexAt(tabs, maxScrollLeft);

      if (lastStartIndex !== startIndex || Math.abs(maxScrollLeft - scrollLeft) > 1) {
        rawPages.push({ scrollLeft: maxScrollLeft, startIndex: lastStartIndex });
      }
      break;
    }

    scrollLeft = nextScrollLeft;
  }

  return rawPages.map((page, index) => {
    const endIndex =
      index < rawPages.length - 1
        ? rawPages[index + 1].startIndex
        : Math.min(tabs.length, lastVisibleTabIndexAt(tabs, page.scrollLeft + viewportWidth) + 1);

    return {
      endIndex: Math.max(page.startIndex + 1, endIndex),
      scrollLeft: page.scrollLeft,
      startIndex: page.startIndex,
    };
  });
}

export function pageIndexForItemIndex(pages: TabStripPage[], itemIndex: number) {
  let pageIndex = 0;

  for (let index = 1; index < pages.length; index += 1) {
    if (itemIndex >= pages[index].startIndex) {
      pageIndex = index;
    } else {
      break;
    }
  }

  return pageIndex;
}

export function pageIndexForScrollLeft(pages: TabStripPage[], scrollLeft: number, maxScrollLeft: number) {
  if (pages.length <= 1) {
    return 0;
  }

  if (scrollLeft <= 12) {
    return 0;
  }

  if (scrollLeft >= maxScrollLeft - 12) {
    return pages.length - 1;
  }

  let pageIndex = 0;

  for (let index = 1; index < pages.length; index += 1) {
    if (scrollLeft + 12 >= pages[index].scrollLeft) {
      pageIndex = index;
    } else {
      break;
    }
  }

  return pageIndex;
}

export function tabStripPagesEqual(left: TabStripPage[], right: TabStripPage[]) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftPage = left[index];
    const rightPage = right[index];

    if (
      leftPage.startIndex !== rightPage.startIndex ||
      leftPage.endIndex !== rightPage.endIndex ||
      leftPage.scrollLeft !== rightPage.scrollLeft
    ) {
      return false;
    }
  }

  return true;
}
