import { createReorderController } from "./reorder.ts";

/** Draggable arrangement tiles; owners retain ordering and persistence. */
export function createEditableListUi({ l10n, ui, isSaving, isActive, move, feedback }) {
  const { node } = ui;
  const gestureEvents = new WeakSet();
  const reorder = createReorderController({
    isSaving,
    isActive,
    feedback,
    move: (from, to, target) => {
      // Preserve HA sortable's notification contract without applying the same
      // move twice through the compatibility event listeners below.
      const event = new CustomEvent("item-moved", {
        bubbles: true,
        composed: true,
        detail: { oldIndex: from, newIndex: to },
      });
      gestureEvents.add(event);
      target.parentElement.dispatchEvent(event);
      return move(from, to, target);
    },
    announce: (list, item, position) => {
      list.parentElement.announcement = String(
        l10n.message("sorting.position", {
          name: item.getAttribute("aria-label"),
          position: position + 1,
          count: list.children.length,
        }),
      );
    },
  });

  function createList({ className, renderItems, scrollContainer, columns }) {
    const list = node("div", `qap-reorder-list ${className}`);
    (scrollContainer ?? list).classList.add("qap-reorder-scroller");
    reorder.registerList(list, scrollContainer, columns);
    list.addEventListener(
      "touchstart",
      (event) => {
        // Keep reorder gestures out of the surrounding dialog's sheet recognizer.
        if (event.composedPath().some((target) => target.classList?.contains("qap-edit-item")))
          event.stopPropagation();
      },
      { passive: true },
    );
    const control = node("qap-sortable", "qap-sortable");
    control.append(list);
    control.addEventListener("item-moved", async (event) => {
      event.stopPropagation();
      if (gestureEvents.has(event)) return;
      if (!control.isConnected || isSaving() || !isActive()) return;
      const movedId = list.children[event.detail?.newIndex]?.dataset.id;
      if (!(await move(event.detail?.oldIndex, event.detail?.newIndex, list))) {
        if (list.isConnected) renderItems(list);
      } else if (control.isConnected && isActive()) {
        if (movedId) reorder.highlight(movedId);
      }
    });
    return { list, element: control };
  }

  function createItem({ id, name, content, container, groups }) {
    // Inert preview tiles use button semantics; the tile itself is never a target.
    const item = node("div", "qap-edit-item");
    item.dataset.id = id;
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.setAttribute("aria-pressed", "false");
    l10n.attribute(item, "aria-label", name);
    reorder.bindHandle(item, item, container, groups);
    item.append(content);
    return item;
  }

  return {
    createList,
    createItem,
    highlight: reorder.highlight,
    reset: reorder.reset,
    dispose: reorder.dispose,
  };
}

/** Management row with optional editing and separate sibling actions. */
export function createManagementRow(
  { node },
  l10n,
  {
    id,
    className = "",
    contentClass = "",
    symbol,
    name,
    description,
    details,
    hint,
    onClick,
    actions = [],
  },
) {
  const row = node("div", `qap-edit-item ${className}`.trim());
  row.dataset.id = id;
  const content = node(onClick ? "button" : "div", `qap-edit-content ${contentClass}`.trim());
  if (onClick) {
    content.type = "button";
    content.addEventListener("click", onClick);
  }
  if (hint) l10n.attribute(content, "aria-description", hint);
  if (symbol) {
    const emblem = node("span", "qap-edit-symbol");
    emblem.append(symbol);
    content.append(emblem);
  }
  let texts = details;
  if (!texts) {
    texts = node("span", "qap-edit-texts");
    texts.append(name?.nodeType ? name : node("strong", "", name));
    if (description !== undefined) texts.append(node("small", "", description));
  }
  content.append(texts);
  row.append(content, ...actions);
  return { row, content };
}

/** Overflow trigger; Up and Down open its menu at the last or first action. */
export function overflowButton(ui, label, open, className) {
  const trigger = ui.iconButton(
    "mdi:dots-vertical",
    label,
    () => open(trigger),
    `qap-edit-action ${className}`,
  );
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    open(trigger, event.key === "ArrowUp");
  });
  return trigger;
}

/** Move Up/Down menu entries for one item of the owner's canonical collection. */
export function moveActions(t, items, id, suffix, move) {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return [];
  return [
    ...(index > 0
      ? [
          {
            value: "move-up",
            label: t("common.move_up"),
            symbol: "mdi:arrow-up",
            className: `qap-move-up-${suffix}`,
            run: () => move(id, -1),
          },
        ]
      : []),
    ...(index < items.length - 1
      ? [
          {
            value: "move-down",
            label: t("common.move_down"),
            symbol: "mdi:arrow-down",
            className: `qap-move-down-${suffix}`,
            run: () => move(id, 1),
          },
        ]
      : []),
  ];
}

/** Swap an item with its neighbour; null when it would leave the collection. */
export function moveById(items, id, offset) {
  const from = items.findIndex((item) => item.id === id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= items.length) return null;
  const next = [...items];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
