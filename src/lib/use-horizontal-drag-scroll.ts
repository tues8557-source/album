"use client";

import { useEffect, useRef, useState } from "react";
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from "react";

type DragState = {
  moved: boolean;
  scrollLeft: number;
  startX: number;
};

export function useHorizontalDragScroll<T extends HTMLElement>(ref: RefObject<T | null>) {
  const dragStateRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const wheelContainer = ref.current;

    if (!wheelContainer) {
      return;
    }

    const element = wheelContainer;

    function handleWheel(event: WheelEvent) {
      const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);

      if (maxScrollLeft <= 0) {
        return;
      }

      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

      if (!delta) {
        return;
      }

      const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, element.scrollLeft + delta));

      event.preventDefault();

      if (nextScrollLeft === element.scrollLeft) {
        return;
      }

      element.scrollLeft = nextScrollLeft;
    }

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [ref]);

  useEffect(() => {
    function finishDrag() {
      if (!dragStateRef.current) {
        return;
      }

      dragStateRef.current = null;
      setDragging(false);
    }

    function handleMouseMove(event: MouseEvent) {
      const dragState = dragStateRef.current;
      const container = ref.current;

      if (!dragState || !container) {
        return;
      }

      const deltaX = event.clientX - dragState.startX;

      if (!dragState.moved && Math.abs(deltaX) > 4) {
        dragState.moved = true;
        suppressClickRef.current = true;
      }

      if (!dragState.moved) {
        return;
      }

      container.scrollLeft = dragState.scrollLeft - deltaX;
      event.preventDefault();
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", finishDrag);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", finishDrag);
    };
  }, [ref]);

  function onMouseDown(event: ReactMouseEvent<T>) {
    if (event.button !== 0) {
      return;
    }

    const container = ref.current;

    if (!container) {
      return;
    }

    dragStateRef.current = {
      moved: false,
      scrollLeft: container.scrollLeft,
      startX: event.clientX,
    };
    suppressClickRef.current = false;
    setDragging(true);
  }

  function onDragStart(event: ReactDragEvent<T>) {
    if (!dragStateRef.current?.moved) {
      return;
    }

    event.preventDefault();
  }

  function onClickCapture(event: ReactMouseEvent<T>) {
    if (!suppressClickRef.current) {
      return;
    }

    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return {
    dragging,
    dragHandlers: {
      onClickCapture,
      onDragStart,
      onMouseDown,
    },
  };
}
