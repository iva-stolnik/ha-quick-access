import { createItemFeedback } from "./item-feedback";

const DRAG_SCROLL_EDGE = 48;
const DRAG_SCROLL_STEP = 12;
const REORDER_DURATION = 240;
const REORDER_EASING = "cubic-bezier(.22, 1, .36, 1)";
const POINTER_CENTER_TOLERANCE = 1;
export const LONG_PRESS_DURATION = 400;
export const LONG_PRESS_TOLERANCE = 8;

interface ReorderOptions {
  isSaving: () => boolean;
  isActive: () => boolean;
  move: (from: number, to: number, target: HTMLElement) => Promise<boolean>;
  feedback?: ReturnType<typeof createItemFeedback>;
  announce: (list: HTMLElement, item: HTMLElement, position: number) => void;
}
interface ListOptions {
  scroller?: HTMLElement;
  columns?: () => number;
}
type Snapshot = [HTMLElement, Element[]][];

/** Gesture state is local to one editable-list owner, never shared with HA. */
export function createReorderController({
  isSaving,
  isActive,
  move,
  announce,
  feedback,
}: ReorderOptions) {
  const lists = new Map<HTMLElement, ListOptions>();
  const guardedGroups = new WeakSet<HTMLElement>();
  let pending = false;
  let disposed = false;
  let cancelDrag: (() => void) | undefined;
  const animations = new Map<Element, Animation>();
  const itemFeedback =
    feedback ??
    createItemFeedback((id) =>
      [...lists.keys()]
        .flatMap((list) => [...list.children])
        .find((row): row is HTMLElement => (row as HTMLElement).dataset.id === id),
    );
  const available = () => !disposed && !pending && !isSaving() && isActive();

  function restore(snapshot: Snapshot) {
    for (const [list, children] of snapshot) if (list.isConnected) list.append(...children);
  }

  function animateOrder(targets: HTMLElement[], change: () => void) {
    const rows = targets.flatMap((list) => [...list.children]);
    const positions = new Map(rows.map((row) => [row, row.getBoundingClientRect?.()]));
    for (const row of rows) {
      animations.get(row)?.cancel();
      animations.delete(row);
    }
    change();
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    for (const row of rows) {
      const before = positions.get(row);
      if (!before || !row.animate) continue;
      const after = row.getBoundingClientRect();
      const x = before.left - after.left,
        y = before.top - after.top;
      if (x || y) {
        const animation = row.animate(
          [{ transform: `translate(${x}px, ${y}px)` }, { transform: "none" }],
          { duration: REORDER_DURATION, easing: REORDER_EASING },
        );
        animations.set(row, animation);
        animation.onfinish = () => {
          if (animations.get(row) === animation) animations.delete(row);
        };
      }
    }
  }

  function bindHandle(
    handle: HTMLElement,
    item: HTMLElement,
    container: HTMLElement,
    groups: HTMLElement,
  ) {
    let drag:
      | { id: number; x: number; y: number; offsetX: number; offsetY: number; snapshot: Snapshot }
      | undefined;
    let press: { id: number; x: number; y: number } | undefined;
    let pressTimer: ReturnType<typeof setTimeout> | undefined;
    let preview: HTMLElement | undefined;
    let origin: HTMLElement | undefined;
    let frame: number | undefined;
    let suppressClick = false;
    const targets = () => [container];
    const focusItem = (target: HTMLElement, reveal = false) => {
      const row = [...target.querySelectorAll<HTMLElement>(".qap-edit-item")].find(
        (row) => row.dataset.id === item.dataset.id,
      );
      row?.focus({ preventScroll: true });
      if (reveal) row?.scrollIntoView({ block: "nearest" });
    };
    const commit = async (
      from: number,
      to: number,
      target: HTMLElement,
      snapshot: Snapshot,
      keyboard = false,
    ) => {
      if (!available() || !target.isConnected || !container.isConnected) {
        restore(snapshot);
        return;
      }
      pending = true;
      try {
        if (!(await move(from, to, target))) {
          restore(snapshot);
          focusItem(container);
          return;
        }
        if (target.isConnected && !disposed) {
          focusItem(target, keyboard);
          const current = [...target.children].find(
            (row): row is HTMLElement => (row as HTMLElement).dataset.id === item.dataset.id,
          );
          if (current) announce(target, current, to);
          if (isActive()) itemFeedback.show(item.dataset.id!);
        }
      } catch (error) {
        restore(snapshot);
        focusItem(container);
        console.warn("[Quick Access] Could not reorder items.", error);
      } finally {
        pending = false;
      }
    };

    function reorderAtPointer() {
      if (!drag) return;
      if (lists.get(container)?.columns) {
        // Use both axes, including gaps and the empty cells of the last row.
        // Page headings are CSS presentation, never children of this list.
        const bounds = container.getBoundingClientRect();
        const scroller = lists.get(container)?.scroller;
        const viewport = scroller?.getBoundingClientRect() ?? bounds;
        if (
          drag.x < viewport.left ||
          drag.x > viewport.right ||
          drag.y < viewport.top ||
          drag.y > viewport.bottom
        )
          return;
        const siblings = [...container.children] as HTMLElement[];
        let candidate: HTMLElement | undefined;
        let distance = Infinity;
        for (const sibling of siblings) {
          const rect = sibling.getBoundingClientRect();
          // Hit test layout positions, not the in-flight FLIP transforms.
          const left = animations.has(sibling) ? bounds.left + sibling.offsetLeft : rect.left;
          const top = animations.has(sibling) ? bounds.top + sibling.offsetTop : rect.top;
          const dx = drag.x - (left + rect.width / 2);
          const dy = drag.y - (top + rect.height / 2);
          const next = dx * dx + dy * dy;
          if (next < distance) {
            distance = next;
            candidate = sibling;
          }
        }
        if (!candidate || candidate === item) return;
        const from = siblings.indexOf(item),
          to = siblings.indexOf(candidate);
        animateOrder([container], () => {
          if (to > from) candidate.after(item);
          else candidate.before(item);
        });
        handle.setPointerCapture(drag.id);
        return;
      }
      const hit = document
        .elementFromPoint(drag.x, drag.y)
        ?.closest<HTMLElement>(".qap-edit-item, .qap-reorder-list");
      const candidate = hit?.classList.contains("qap-edit-item") ? hit : undefined;
      const target =
        candidate?.parentElement ?? (hit?.classList.contains("qap-reorder-list") ? hit : undefined);
      if (target !== container || candidate === item) return;
      const rect = candidate?.getBoundingClientRect?.();
      const movingDown =
        [...target.children].indexOf(item) < [...target.children].indexOf(candidate!);
      const midpoint = rect ? (rect.top + rect.bottom) / 2 : undefined;
      // A handle is centered in its row. At that exact boundary, keep the
      // movement direction rather than depending on subpixel rounding.
      let after = movingDown;
      if (midpoint !== undefined && rect?.height) {
        if (Math.abs(drag.y - midpoint) <= POINTER_CENTER_TOLERANCE) after = movingDown;
        else after = drag.y > midpoint;
      }
      if (
        candidate &&
        (after ? candidate.nextElementSibling === item : candidate.previousElementSibling === item)
      )
        return;
      animateOrder([target], () => {
        if (!candidate) target.append(item);
        else if (after) candidate.after(item);
        else candidate.before(item);
      });
      // Reparenting can release capture; reacquire it before the next event.
      handle.setPointerCapture(drag.id);
    }

    function scrollAtPointer() {
      frame = undefined;
      if (!drag) return;
      if (!item.isConnected || !available()) {
        finish(true);
        return;
      }
      const scroller = lists.get(container)?.scroller;
      if (scroller && scroller.scrollHeight > scroller.clientHeight) {
        const rect = scroller.getBoundingClientRect();
        if (drag.x >= rect.left && drag.x <= rect.right) {
          const edge = Math.min(DRAG_SCROLL_EDGE, rect.height / 2);
          let direction = 0;
          if (drag.y < rect.top + edge) direction = -1;
          else if (drag.y > rect.bottom - edge) direction = 1;
          const previous = scroller.scrollTop;
          scroller.scrollTop = Math.max(
            0,
            Math.min(
              scroller.scrollHeight - scroller.clientHeight,
              previous + direction * DRAG_SCROLL_STEP,
            ),
          );
          if (previous !== scroller.scrollTop) reorderAtPointer();
        }
      }
      frame = requestAnimationFrame(scrollAtPointer);
    }

    function finish(cancelled: boolean) {
      clearTimeout(pressTimer);
      pressTimer = undefined;
      press = undefined;
      cancelDrag = undefined;
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pagehide", cancel);
      document.removeEventListener("pointermove", pointerMove, true);
      document.removeEventListener("pointerup", pointerUp, true);
      document.removeEventListener("pointercancel", pointerCancel, true);
      document.removeEventListener("touchmove", touchMove, true);
      document.removeEventListener("touchstart", additionalTouch, true);
      if (!drag) return;
      const { id, snapshot } = drag;
      drag = undefined;
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      groups.classList.remove("qap-reordering");
      preview?.remove();
      preview = undefined;
      origin?.remove();
      origin = undefined;
      item.classList.remove("qap-dragging");
      if (handle.getAttribute("role") === "button") handle.setAttribute("aria-pressed", "false");
      if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
      if (cancelled || !item.isConnected || !available()) {
        for (const row of container.children) {
          animations.get(row)?.cancel();
          animations.delete(row);
        }
        restore(snapshot);
        if (container.isConnected) focusItem(container);
        return;
      }
      const from = snapshot.find(([list]) => list === container)?.[1].indexOf(item) ?? -1;
      const target = item.parentElement;
      if (target !== container) {
        restore(snapshot);
        return;
      }
      const to = [...target.children].indexOf(item);
      if (from !== to) void commit(from, to, target, snapshot);
    }
    const cancel = () => finish(true);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    };
    handle.addEventListener(
      "click",
      (event) => {
        if (!suppressClick) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClick = false;
      },
      true,
    );
    // Actions elsewhere in the same owner cannot discard an in-flight drag.
    if (!guardedGroups.has(groups)) {
      guardedGroups.add(groups);
      groups.addEventListener(
        "click",
        (event) => {
          if (!cancelDrag) return;
          event.preventDefault();
          event.stopImmediatePropagation();
        },
        true,
      );
    }
    function activate(id: number, x: number, y: number) {
      press = undefined;
      pressTimer = undefined;
      if (!available() || !item.isConnected) {
        cancel();
        return;
      }
      itemFeedback.clear();
      suppressClick = true;
      const rect = item.getBoundingClientRect();
      drag = {
        id,
        x,
        y,
        offsetX: x - rect.left,
        offsetY: y - rect.top,
        snapshot: targets().map((list) => [list, [...list.children]]),
      };
      cancelDrag = cancel;
      item.classList.add("qap-dragging");
      groups.classList.add("qap-reordering");
      if (handle.getAttribute("role") === "button") handle.setAttribute("aria-pressed", "true");
      handle.focus({ preventScroll: true });
      handle.setPointerCapture(id);
      document.addEventListener("keydown", escape, true);
      window.addEventListener("blur", cancel);
      window.addEventListener("pagehide", cancel);
      {
        const scroller = lists.get(container)?.scroller ?? groups;
        origin = document.createElement("div");
        origin.className = "qap-drag-origin";
        origin.setAttribute("aria-hidden", "true");
        const bounds = scroller.getBoundingClientRect();
        Object.assign(origin.style, {
          left: `${rect.left - bounds.left + scroller.scrollLeft}px`,
          top: `${rect.top - bounds.top + scroller.scrollTop}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
        const tile = item.querySelector<HTMLElement>(".qap-tile");
        origin.style.borderRadius = getComputedStyle(tile ?? item).borderRadius;
        scroller.append(origin);
      }
      updatePointer();
      frame = requestAnimationFrame(scrollAtPointer);
    }
    function updatePointer() {
      if (!drag) return;
      if (!preview && item.cloneNode) {
        const rect = item.getBoundingClientRect();
        preview = item.cloneNode(true) as HTMLElement;
        preview.classList.remove("qap-edit-item", "qap-dragging");
        preview.classList.add("qap-drag-preview");
        preview.removeAttribute("id");
        preview.removeAttribute("data-id");
        preview.setAttribute("aria-hidden", "true");
        preview.inert = true;
        preview.style.width = `${rect.width}px`;
        preview.style.height = `${rect.height}px`;
        if (lists.get(container)?.columns) {
          // The floating copy is outside the grid's query container.
          const tile = item.querySelector<HTMLElement>(".qap-tile");
          preview.classList.add("qap-custom-grid");
          if (tile)
            preview
              .querySelector<HTMLElement>(".qap-tile")
              ?.style.setProperty(
                "--qap-grid-tile-size",
                `${tile.getBoundingClientRect().height}px`,
              );
        }
        groups.append(preview);
      }
      if (preview) {
        const origin = preview.offsetParent?.getBoundingClientRect();
        preview.style.left = `${drag.x - drag.offsetX - (origin?.left ?? 0)}px`;
        preview.style.top = `${drag.y - drag.offsetY - (origin?.top ?? 0)}px`;
      }
      reorderAtPointer();
    }
    function pointerMove(event: PointerEvent) {
      if (press && event.pointerId === press.id) {
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_TOLERANCE) {
          // A moved press is a gesture, not a tap: its trailing mouse click is swallowed too.
          suppressClick = true;
          cancel();
        }
        return;
      }
      if (!drag || event.pointerId !== drag.id) return;
      event.preventDefault();
      event.stopPropagation();
      drag.x = event.clientX;
      drag.y = event.clientY;
      updatePointer();
    }
    const pointerUp = (event: PointerEvent) => {
      if (event.pointerId === (drag?.id ?? press?.id)) finish(false);
    };
    const pointerCancel = (event: PointerEvent) => {
      if (event.pointerId === (drag?.id ?? press?.id)) cancel();
    };
    const touchMove = (event: TouchEvent) => {
      // touch-action remains auto for ordinary scrolling. A non-passive listener
      // installed on press cancels the first native scroll only after activation.
      if (drag && event.cancelable) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const additionalTouch = (event: TouchEvent) => {
      if (event.touches.length > 1) cancel();
    };
    function isInteractive(event: Event) {
      const path = event.composedPath();
      return path
        .slice(0, path.indexOf(handle))
        .some((target) =>
          (target as Element).matches?.(
            "button, a, input, select, textarea, [role='button'], [contenteditable], qap-button, qap-icon-button, qap-input, qap-select",
          ),
        );
    }
    handle.addEventListener("pointerdown", (event) => {
      if (isInteractive(event)) return;
      if (event.button !== 0 || event.isPrimary === false || !available() || !container.isConnected)
        return;
      cancelDrag?.();
      suppressClick = false;
      press = { id: event.pointerId, x: event.clientX, y: event.clientY };
      cancelDrag = cancel;
      pressTimer = setTimeout(() => {
        if (press) activate(press.id, press.x, press.y);
      }, LONG_PRESS_DURATION);
      document.addEventListener("pointermove", pointerMove, true);
      document.addEventListener("pointerup", pointerUp, true);
      document.addEventListener("pointercancel", pointerCancel, true);
      document.addEventListener("touchmove", touchMove, { capture: true, passive: false });
      document.addEventListener("touchstart", additionalTouch, true);
      document.addEventListener("keydown", escape, true);
      window.addEventListener("blur", cancel);
      window.addEventListener("pagehide", cancel);
    });
    handle.addEventListener("pointerleave", () => {
      if (press) cancel();
    });
    handle.addEventListener("contextmenu", (event) => {
      if (press || drag) event.preventDefault();
    });
    handle.addEventListener("lostpointercapture", () => {
      if (drag && !handle.hasPointerCapture(drag.id)) cancel();
    });
    handle.addEventListener("keydown", async (event) => {
      if (isInteractive(event)) return;
      if (
        event.isComposing ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
      )
        return;
      const columns = lists.get(container)?.columns?.();
      const horizontal = ["ArrowLeft", "ArrowRight"].includes(event.key);
      if (horizontal && !columns) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
      if (press) cancel();
      if (drag || !available() || !item.isConnected) return;
      const from = [...container.children].indexOf(item);
      const all = targets();
      const target = container;
      const direction = ["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1;
      const to = from + direction * (columns && !horizontal ? columns : 1);
      if (from < 0 || to < 0 || to >= target.children.length) return;
      itemFeedback.clear();
      const snapshot: Snapshot = all.map((list) => [list, [...list.children]]);
      animateOrder([container], () => {
        const siblings = [...target.children].filter((child) => child !== item);
        target.insertBefore(item, siblings[to] ?? null);
      });
      await commit(from, to, target, snapshot, true);
    });
  }

  function reset() {
    cancelDrag?.();
    lists.clear();
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
    if (!feedback) itemFeedback.clear();
  }

  return {
    registerList: (list: HTMLElement, scroller?: HTMLElement, columns?: () => number) =>
      lists.set(list, { scroller, columns }),
    bindHandle,
    highlight: itemFeedback.show,
    reset,
    dispose: () => {
      disposed = true;
      reset();
    },
  };
}
