import {
  SHORTCUT_NAME_MAX_LENGTH,
  SHORTCUT_PAGE_SIZE,
  DEFAULT_SHORTCUT_GRID,
  SHORTCUT_GRID_MAX_DIMENSION,
  SHORTCUT_LIMIT,
  CATEGORY_NAME_MAX_LENGTH,
  STATES_PATH,
} from "../profiles/profile-defaults.js";
import { normalizeIcon, normalizeIconColor } from "../utils/icons.js";
import { isRegistryShortcut } from "../registry/registry-view.js";
import { newId } from "../utils/ids.js";
import { currentPageUrl } from "../utils/urls.js";
import { createProfileValidation, validShortcutGrid } from "../profiles/profile-validation.js";
import { createItemFeedback } from "../ui/item-feedback.ts";
import {
  createEditableListUi,
  createManagementRow,
  overflowButton,
  moveActions,
  moveById,
} from "../ui/editable-list.js";
import { LONG_PRESS_DURATION, LONG_PRESS_TOLERANCE } from "../ui/reorder.ts";
import { clamp } from "../utils/numbers.js";
import { textLength, truncateText } from "../utils/text.js";
import {
  eligibleShortcutFilters,
  filterLabel,
  filterIcon,
  resolveShortcutFilter,
} from "../registry/filter-definitions.js";
import { formattedEntityName } from "../entities/entity-formatting.js";
import {
  upsertShortcut,
  reorderEnabledShortcuts,
  transferCategoryShortcuts,
} from "./shortcut-order.js";

const SHORTCUT_TYPE_ICONS = {
  external: "mdi:open-in-new",
  scene: "mdi:palette",
  "saved-filter": "mdi:filter",
  "quick-devices": "mdi:devices",
  "quick-states": "mdi:format-list-bulleted",
};

export function createShortcutUi({
  l10n,
  ui,
  forms,
  host,
  getConfig,
  getHass,
  toast,
  profileSession,
  profileUi,
  isEnabled,
  switchView,
  clearStorageError,
  navigationChanged,
  commitNavigation,
}) {
  const t = l10n.message;
  const {
    node,
    icon,
    iconButton,
    button,
    coloredIcon,
    tabButton,
    setTabActive,
    errorMessage,
    focusedElement,
    focusWhenReady,
    replaceLocalizedChildren,
    createEditorDialog,
    showDialogElement,
    cleanupDialogElement,
  } = ui;
  const {
    input,
    select,
    iconPickerField,
    iconColorField,
    fieldValidation,
    validateFields,
    currentUrlCard,
    searchField,
    helpControl,
  } = forms;
  const { categoryNameError, shortcutNameError, shortcutPathError } = createProfileValidation(l10n);
  const { currentProfile, saveSettings, mutateProfile } = profileSession;
  const {
    trackProfileDraft,
    confirmAction,
    showMutationError,
    afterDiscardingProfileChanges,
    openActionMenu,
    quotaMessage,
  } = profileUi;
  const feedback = createItemFeedback((id) =>
    [...(host.shell?.querySelectorAll(".qap-edit-item") || [])].find(
      (row) => row.dataset.id === id,
    ),
  );
  let feedbackContext = null;
  function prepareView(view) {
    const profileId = currentProfile()?.id;
    if (
      !feedbackContext ||
      feedbackContext.dialog !== host.dialog ||
      feedbackContext.profileId !== profileId ||
      feedbackContext.view !== view
    )
      feedback.clear();
    feedbackContext = { dialog: host.dialog, profileId, view };
  }
  function disposeView() {
    feedback.dispose();
    feedbackContext = null;
  }
  function shortcutPosition(id) {
    const links = getConfig().links;
    const ordered = currentProfile().categories.flatMap((category) =>
      links.filter((link) => link.group === category.id),
    );
    return ordered.findIndex((link) => link.id === id);
  }
  function revealShortcut(id) {
    const position = shortcutPosition(id);
    if (position < 0) return;
    shortcutPage = Math.floor(position / SHORTCUT_PAGE_SIZE);
    feedback.show(id, true);
  }
  let activeTab = "favorites";
  let homePage = 0;
  let shortcutSearch = "";
  let shortcutSearchVisible = false;
  let shortcutPage = 0;
  let categoryEditor = null;
  let categoryNavigation = null;
  let createInlineCategory = null;
  let categoryOpenShortcut = null;
  let editSettingsCategory = null;
  const SHORTCUT_TYPES = [
    ["internal", t("shortcuts.internal_path")],
    ["quick-states", t("shortcuts.entity_explorer")],
    ["quick-devices", t("shortcuts.device_explorer")],
    ["saved-filter", t("shortcuts.saved_filter")],
    ["scene", t("shortcuts.scene")],
    ["external", t("shortcuts.external_url")],
  ];
  function groupLabel(group) {
    return group === "favorites"
      ? t("common.favorites")
      : (currentProfile()?.categories.find((category) => category.id === group)?.name ??
          t("common.favorites"));
  }

  /** `parent` stacks an editor above a category editor that keeps its draft. */
  function openShortcutEditor({
    id = null,
    category = "favorites",
    path = "",
    returnView = host.currentView,
    parent = null,
  } = {}) {
    if (!host.dialog || profileSession.profileSaving || profileUi.profileDialog) return;
    let trigger = parent?.trigger;
    if (trigger == null) {
      if (id)
        trigger = [...host.shell.querySelectorAll(".qap-shortcut-row")].find(
          (item) => item.dataset.shortcutId === id,
        );
      else
        trigger = host.dialog.querySelector(
          returnView === "home" ? ".qap-save-current-page" : ".qap-add-shortcut",
        );
    }
    const editor = profileUi.createProfileDialog(
      t(id ? "shortcuts.edit" : "shortcuts.create"),
      t("common.close"),
      "qap-shortcut-editor",
      trigger,
      parent
        ? {
            key: `shortcut:${id || "new"}:${category}:group`,
            above: "category",
            open: () => categoryOpenShortcut?.(id),
          }
        : {
            key: `shortcut:${id || "new"}:${category}:${path}`,
            open: () => openShortcutEditor({ id, category, path, returnView }),
          },
      !parent,
      Boolean(parent),
    );
    renderShortcutEditor(editor, { id, category, path, parent });
    profileUi.showProfileStatus();
    commitNavigation();
  }

  function shortcutTile(link, { preview = false, hideName = false } = {}) {
    const registryShortcut = isRegistryShortcut(link.type);
    const actionShortcut = registryShortcut || link.type === "scene";
    const tile = node(actionShortcut ? "button" : "a", "qap-tile");
    if (actionShortcut) tile.type = "button";
    let externalUrl = null;
    if (link.type === "external") {
      try {
        externalUrl = new URL(link.path);
      } catch {
        // A browser's IDNA rules can reject an address accepted by the server.
        tile.setAttribute("aria-disabled", "true");
      }
    }
    if (preview) {
      tile.inert = true;
      tile.tabIndex = -1;
    } else if (link.type === "scene") {
      tile.addEventListener("click", async () => {
        if (!isEnabled() || tile.disabled) return;
        const hass = getHass();
        const scene = hass?.states?.[link.path];
        if (!scene || scene.state === "unavailable") {
          toast(t("shortcuts.scene_unavailable"));
          return;
        }
        tile.disabled = true;
        try {
          await hass.callService("scene", "turn_on", { entity_id: link.path });
        } catch {
          if (
            tile.isConnected &&
            isEnabled() &&
            getHass()?.connection === hass.connection &&
            getHass()?.user?.id === hass.user?.id
          )
            toast(t("shortcuts.scene_activation_failed"));
        } finally {
          tile.disabled = false;
        }
      });
    } else if (registryShortcut) {
      const profileId = currentProfile()?.id;
      tile.addEventListener("click", () => {
        if (link.type !== "saved-filter") {
          switchView(link.type === "quick-devices" ? "devices" : "states");
          return;
        }
        const profile = currentProfile();
        const current =
          profile?.id === profileId && profile.settings.links.find((item) => item.id === link.id);
        if (!current || !resolveShortcutFilter(profile, current)) {
          confirmAction(
            {
              title: t("shortcuts.filter_unavailable"),
              description: t("shortcuts.filter_unavailable_description"),
              confirmLabel: t("shortcuts.edit"),
              id: "qap-unavailable-filter",
            },
            tile,
            () => openShortcutEditor({ id: link.id, returnView: "home" }),
          );
          return;
        }
        switchView(current.filterKind, current.filterId);
      });
    } else {
      if (link.type === "external") {
        if (externalUrl) tile.href = externalUrl.href;
        tile.target = "_blank";
        tile.rel = "noopener noreferrer";
      } else {
        tile.href = link.path;
      }
      // Leave native anchor click untouched so HA can guard dirty editors.
    }
    const tileIcon = node(
      "div",
      `qap-tile-icon qap-icon-${link.icon.replace(/[^a-z0-9-]/gi, "-")}`,
    );
    tileIcon.append(coloredIcon(link));
    tile.append(tileIcon);
    tile.title = link.name;
    if (hideName) {
      tile.setAttribute("aria-label", link.name);
    } else tile.append(node("span", "qap-tile-name", link.name));
    const typeIcon = SHORTCUT_TYPE_ICONS[link.type];
    if (typeIcon) {
      const badge = icon(typeIcon, "qap-tile-badge");
      badge.classList.toggle("qap-tile-external", link.type === "external");
      badge.classList.toggle("qap-tile-http", externalUrl?.protocol === "http:");
      tile.append(badge);
    }
    return tile;
  }

  function applyShortcutGrid(tiles, grid) {
    tiles.classList.toggle("qap-custom-grid", Boolean(grid));
    if (grid) tiles.style.setProperty("--qap-grid-columns", grid.columns);
    else tiles.style.removeProperty("--qap-grid-columns");
  }

  function categoryGridFields(category, links, { onAdd = null, onEdit = null } = {}) {
    const grid = category?.grid ?? DEFAULT_SHORTCUT_GRID;
    const properties = { min: 1, max: SHORTCUT_GRID_MAX_DIMENSION, step: 1, required: true };
    const columns = input(t("grid.columns"), "number", String(grid.columns), properties);
    const rows = input(t("grid.rows"), "number", String(grid.rows), properties);
    // The existing schema has exactly two modes: optional boolean hideNames.
    const labels = node("qap-checkbox", "qap-grid-labels");
    l10n.property(labels, "label", t("grid.show_names"));
    labels.checked = !grid.hideNames;
    const readGrid = () => ({
      columns: Number(columns.value),
      rows: Number(rows.value),
      ...(!labels.checked ? { hideNames: true } : {}),
    });
    const dimensionError = (field) => {
      const value = Number(field.value);
      return Number.isInteger(value) && value >= 1 && value <= SHORTCUT_GRID_MAX_DIMENSION
        ? ""
        : t("grid.invalid_dimension", { limit: SHORTCUT_GRID_MAX_DIMENSION });
    };
    const element = node("section", "qap-group-grid");
    const settings = node("div", "qap-grid-settings");
    settings.id = newId();
    // Collapsed by default; an invalid dimension expands it so focus can reach the field.
    const layoutHeading = node("div", "qap-arrangement-heading qap-grid-layout-heading");
    const layoutTitle = node("h3", "qap-section-title");
    const layoutToggle = node("button", "qap-grid-layout-toggle");
    layoutToggle.type = "button";
    layoutToggle.setAttribute("aria-controls", settings.id);
    layoutToggle.append(
      node("span", "", t("grid.layout")),
      icon("mdi:chevron-down", "qap-grid-layout-chevron"),
    );
    layoutTitle.append(layoutToggle);
    layoutHeading.append(layoutTitle);
    const setExpanded = (expanded) => {
      settings.hidden = !expanded;
      layoutToggle.setAttribute("aria-expanded", String(expanded));
      layoutHeading.classList.toggle("is-expanded", expanded);
    };
    layoutToggle.addEventListener("click", () => setExpanded(settings.hidden));
    setExpanded(false);
    const validations = [columns, rows].map((field) => {
      const validation = fieldValidation(field, () => dimensionError(field));
      return {
        ...validation,
        validate: () => {
          const valid = validation.validate();
          if (!valid) setExpanded(true);
          return valid;
        },
      };
    });
    const fields = node("div", "qap-grid-fields");
    for (const [field, dimension] of [
      [columns, "columns"],
      [rows, "rows"],
    ]) {
      const stepper = node("div", "qap-grid-stepper");
      stepper.dataset.dimension = dimension;
      const step = (amount) => {
        field.value = String(
          clamp((Number(field.value) || 1) + amount, 1, SHORTCUT_GRID_MAX_DIMENSION),
        );
        field.control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      };
      const decrease = iconButton(
        "mdi:minus",
        t(`grid.decrease_${dimension}`),
        () => step(-1),
        "qap-grid-decrease",
      );
      const increase = iconButton(
        "mdi:plus",
        t(`grid.increase_${dimension}`),
        () => step(1),
        "qap-grid-increase",
      );
      const updateButtons = () => {
        decrease.disabled = Number(field.value) <= 1;
        increase.disabled = Number(field.value) >= SHORTCUT_GRID_MAX_DIMENSION;
      };
      field.onChange(updateButtons);
      updateButtons();
      stepper.append(field.element, decrease, increase);
      fields.append(stepper);
    }
    settings.append(fields, labels);
    element.append(layoutHeading, settings);
    let orderedIds = links.filter((link) => !link.hidden).map((link) => link.id);
    // The persisted enabled order. A draft whose order matches it is clean,
    // including after an independently saved shortcut extends both.
    let baseOrder = orderedIds;
    const items = new Map();
    const renderItems = (list) => {
      const ordered = orderedIds.map((id) => items.get(id));
      if (
        list.children.length !== ordered.length ||
        ordered.some((item, index) => item !== list.children[index])
      ) {
        replaceLocalizedChildren(list, ...ordered);
      }
    };
    const disabled = links.filter((link) => link.hidden);
    const surface = node("div", "qap-arrangement");
    const rules = node("style");
    let displayedGrid;
    const arrangement = createEditableListUi({
      l10n,
      ui,
      isSaving: () => profileSession.profileSaving,
      isActive: () => Boolean(surface.isConnected && isEnabled()),
      move: async (from, to, list) => {
        if (
          !Number.isInteger(from) ||
          !Number.isInteger(to) ||
          from < 0 ||
          to < 0 ||
          from >= orderedIds.length ||
          to >= orderedIds.length
        )
          return false;
        const next = [...orderedIds];
        next.splice(to, 0, next.splice(from, 1)[0]);
        orderedIds = next;
        // Pointer gestures have already moved the DOM; compatibility events may not have.
        renderItems(list);
        profileUi.updateDialogDismissal();
        return true;
      },
    });
    const { list: preview, element: control } = arrangement.createList({
      className: "qap-tiles qap-custom-grid qap-arrangement-enabled",
      scrollContainer: surface,
      columns: () => displayedGrid?.columns ?? grid.columns,
      renderItems,
    });
    const empty = node(
      "p",
      "qap-muted qap-arrangement-empty",
      t(category ? "grid.empty" : "grid.empty_unsaved"),
    );
    // A separate control in the first free cell: never sortable, persisted or inert.
    const addRow = node("div", "qap-tiles qap-custom-grid qap-arrangement-add-row");
    const addTile = node("button", "qap-arrangement-add");
    addTile.type = "button";
    l10n.attribute(addTile, "aria-label", t("shortcuts.add"));
    l10n.attribute(addTile, "data-page-label", t("grid.page"));
    const addLabel = node("span", "qap-tile-name", t("common.add"));
    addTile.append(icon("mdi:plus"), addLabel);
    // Add answers taps only: a press held or dragged like a sortable tile is
    // released without opening the editor. Keyboard activation (detail 0) is unaffected.
    let addPress;
    const endAddPress = () => {
      clearTimeout(addPress?.timer);
      addPress = undefined;
      addTile.classList.remove("qap-press-ignored");
    };
    const ignoreAddPress = () => {
      if (addPress) {
        addPress.ignored = true;
        addTile.classList.add("qap-press-ignored");
      }
    };
    addTile.addEventListener("pointerdown", (event) => {
      endAddPress();
      if (event.button !== 0 || event.isPrimary === false) return;
      addPress = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        ignored: false,
        timer: setTimeout(ignoreAddPress, LONG_PRESS_DURATION),
      };
    });
    addTile.addEventListener("pointermove", (event) => {
      if (
        addPress?.id === event.pointerId &&
        !addPress.ignored &&
        Math.hypot(event.clientX - addPress.x, event.clientY - addPress.y) > LONG_PRESS_TOLERANCE
      )
        ignoreAddPress();
    });
    addTile.addEventListener("pointerup", (event) => {
      if (addPress?.id === event.pointerId) clearTimeout(addPress.timer);
    });
    addTile.addEventListener("pointercancel", endAddPress);
    addTile.addEventListener("contextmenu", (event) => {
      if (addPress) event.preventDefault();
    });
    addTile.addEventListener("click", (event) => {
      const ignored = Boolean(addPress?.ignored) && event.detail !== 0;
      endAddPress();
      if (!ignored && onAdd && !addTile.disabled) onAdd();
    });
    addRow.append(addTile);
    addRow.hidden = !onAdd;
    const updateAddAvailability = () => {
      addTile.disabled = getConfig().links.length >= SHORTCUT_LIMIT;
      if (addTile.disabled)
        l10n.attribute(addTile, "title", t("shortcuts.limit", { limit: SHORTCUT_LIMIT }));
      else addTile.removeAttribute("title");
    };
    updateAddAvailability();
    const placeholders = node("div", "qap-tiles qap-custom-grid qap-arrangement-placeholders");
    placeholders.setAttribute("aria-hidden", "true");
    placeholders.inert = true;
    const pages = node("div", "qap-arrangement-pages");
    pages.append(control, addRow, placeholders);
    surface.append(rules, pages, empty);
    const heading = node("div", "qap-arrangement-heading");
    const tooltip = node("qap-tooltip");
    tooltip.append(node("p", "", t("sorting.keyboard_help_grid")));
    // Same presentation as the display rules' URL paths help.
    const help = button("", () => {}, "qap-linkish qap-arrangement-help");
    help.id = newId();
    help.append(
      ui.leadingIcon("mdi:information-outline"),
      node("span", "", t("common.learn_more")),
    );
    heading.append(node("h3", "qap-section-title", t("grid.arrange")), helpControl(help, tooltip));
    element.append(heading, surface);
    if (disabled.length) {
      const disabledField = select(
        t("grid.disabled_shortcuts", { count: disabled.length }),
        disabled.map((link) => [link.id, link.name]),
        disabled[0].id,
      );
      disabledField.element.classList.add("qap-arrangement-disabled");
      element.append(disabledField.element);
    }
    function appendItem(link, hideName) {
      const item = arrangement.createItem({
        id: link.id,
        name: link.name,
        content: shortcutTile(link, { preview: true, hideName }),
        container: preview,
        groups: surface,
      });
      item.classList.add("qap-arrangement-item");
      l10n.attribute(item, "data-page-label", t("grid.page"));
      item.setAttribute(
        "aria-keyshortcuts",
        "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight",
      );
      l10n.attribute(item, "aria-description", t("sorting.keyboard_help_grid"));
      if (onEdit) {
        // A tap edits. The reorder controller swallows the click that ends a long press or drag.
        item.addEventListener("click", () => onEdit(link.id));
        item.addEventListener("keydown", (event) => {
          if (
            event.isComposing ||
            event.repeat ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            !["Enter", " "].includes(event.key)
          )
            return;
          event.preventDefault();
          if (!surface.classList.contains("qap-reordering")) onEdit(link.id);
        });
      }
      items.set(link.id, item);
      preview.append(item);
    }
    for (const link of links.filter((link) => !link.hidden)) appendItem(link, grid.hideNames);
    let displayedLayout;
    function layout(selected) {
      const count = orderedIds.length;
      const key = `${selected.columns}x${selected.rows}:${count}`;
      if (key === displayedLayout) return;
      displayedLayout = key;
      // CSS page labels follow DOM positions during dragging; they never enter
      // the sortable sequence or require tile rendering on pointer movement.
      const capacity = selected.rows * selected.columns;
      const addPageStart = Boolean(onAdd) && count % capacity === 0;
      rules.textContent = `${Array.from(
        { length: selected.columns },
        (_, column) => `.qap-arrangement-enabled > :nth-child(${capacity}n + ${column + 1})`,
      ).join(",")} { margin-top: var(--qap-page-label-space); }
        ${Array.from(
          { length: Math.ceil(count / capacity) },
          (_, page) =>
            `.qap-arrangement-enabled > :nth-child(${page * capacity + 1})::before { content: attr(data-page-label) " ${page + 1}"; }`,
        ).join("\n")}
        ${addPageStart ? `.qap-arrangement-add::before { content: attr(data-page-label) " ${count / capacity + 1}"; }` : ""}`;
      preview.style.setProperty("--qap-grid-columns", selected.columns);
      // Add takes the first free cell, opening the next page after a full one.
      const slots = count + (onAdd ? 1 : 0);
      addRow.style.setProperty("--qap-grid-columns", selected.columns);
      addRow.classList.toggle("qap-partial-row", count % selected.columns > 0);
      addRow.classList.toggle("qap-page-start", addPageStart);
      addTile.style.gridColumn = String((count % selected.columns) + 1);
      // Fill only the last logical page, outside the sortable sequence.
      const missing = slots ? (capacity - (slots % capacity)) % capacity : 0;
      const remainder = slots % selected.columns;
      placeholders.style.setProperty("--qap-grid-columns", selected.columns);
      placeholders.classList.toggle("qap-partial-row", remainder > 0);
      replaceLocalizedChildren(
        placeholders,
        ...Array.from({ length: missing }, (_, index) => {
          const placeholder = node("div", "qap-grid-placeholder");
          if (index === 0) placeholder.style.gridColumn = String(remainder + 1);
          return placeholder;
        }),
      );
      placeholders.hidden = !missing;
      empty.hidden = count > 0 || Boolean(onAdd);
    }
    function updatePreview() {
      const selected = readGrid();
      if (!validShortcutGrid(selected)) return;
      layout(selected);
      const labelsChanged =
        displayedGrid && Boolean(selected.hideNames) !== Boolean(displayedGrid.hideNames);
      displayedGrid = selected;
      addLabel.hidden = Boolean(selected.hideNames);
      if (!labelsChanged) return;
      for (const tile of preview.querySelectorAll(".qap-tile")) {
        if (selected.hideNames) {
          ui.removeLocalizedElement(tile.querySelector(".qap-tile-name"));
          tile.setAttribute("aria-label", tile.title);
        } else if (!tile.querySelector(".qap-tile-name")) {
          tile.append(node("span", "qap-tile-name", tile.title));
          tile.removeAttribute("aria-label");
        }
      }
    }
    columns.onChange(updatePreview);
    rows.onChange(updatePreview);
    labels.addEventListener("change", updatePreview);
    updatePreview();
    /**
     * Adopt one acknowledged shortcut write `id`: new enabled IDs follow the
     * draft order, an edited tile is refreshed in place, and only that shortcut
     * may leave the draft (a confirmed transfer or a deletion).
     */
    function rebase(categoryLinks, id) {
      const enabled = categoryLinks.filter((link) => !link.hidden);
      const known = new Set(enabled.map((link) => link.id));
      if (orderedIds.some((item) => item !== id && !known.has(item))) return null;
      const position = known.has(id) ? -1 : orderedIds.indexOf(id);
      const edited = enabled.find((link) => link.id === id && items.has(id));
      if (edited) {
        const item = items.get(id);
        l10n.attribute(item, "aria-label", edited.name);
        replaceLocalizedChildren(
          item,
          shortcutTile(edited, { preview: true, hideName: !labels.checked }),
        );
      }
      if (position >= 0) items.delete(id);
      const added = enabled.filter((link) => !items.has(link.id));
      for (const link of added) appendItem(link, !labels.checked);
      orderedIds = [
        ...orderedIds.filter((item) => known.has(item)),
        ...added.map((link) => link.id),
      ];
      baseOrder = enabled.map((link) => link.id);
      renderItems(preview);
      layout(displayedGrid);
      updateAddAvailability();
      return {
        added: added.map((link) => link.id),
        // The tile now in a departed shortcut's place, for focus.
        next: position >= 0 ? (items.get(orderedIds[position]) ?? addTile) : null,
      };
    }
    return {
      element,
      validations,
      readGrid,
      readOrder: () => orderedIds,
      dispose: arrangement.dispose,
      rebase,
      addTile,
      item: (id) => items.get(id),
      highlight: (id) => arrangement.highlight(id, true),
      readDraft: () => [
        columns.value,
        rows.value,
        labels.checked,
        orderedIds.length === baseOrder.length &&
        orderedIds.every((id, index) => id === baseOrder[index])
          ? null
          : orderedIds,
      ],
    };
  }

  function resetShortcutSearch() {
    shortcutSearch = "";
    shortcutSearchVisible = false;
    homePage = 0;
  }

  function toggleShortcutSearch() {
    const search = host.dialog?.querySelector(".qap-home")?.querySelector(".qap-search");
    if (!search) return;
    shortcutSearchVisible = !shortcutSearchVisible;
    if (!shortcutSearchVisible && search.contains(document.activeElement)) focusedElement()?.blur();
    search.hidden = !shortcutSearchVisible;
  }

  function renderHome(body) {
    const root = node("div", "qap-home");
    const search = searchField(t("shortcuts.search"), shortcutSearch, (value) => {
      shortcutSearch = value;
      homePage = 0;
      updateTiles();
    });
    search.id = "qap-shortcut-search";
    search.hidden = !shortcutSearchVisible;
    const pagination = shortcutPagination((page) => {
      homePage = page;
      updateTiles();
    });
    const tabs = node("div", "qap-tabs");
    tabs.setAttribute("role", "group");
    l10n.attribute(tabs, "aria-label", t("categories.title"));
    const tiles = node("div", "qap-tiles");
    function updateTabUI() {
      for (const b of tabs.children) {
        setTabActive(b, b.dataset.tab === activeTab);
      }
    }
    for (const { id: key, name: label } of currentProfile().categories) {
      const tab = tabButton(key, label, () => {
        activeTab = key;
        homePage = 0;
        updateTabUI();
        updateTiles();
      });
      tab.dataset.tab = key;
      tabs.append(tab);
    }
    root.append(search, tabs, tiles, pagination.element);
    body.append(root);
    updateTabUI();
    updateTiles();
    function updateTiles() {
      replaceLocalizedChildren(tiles);
      const grid = currentProfile().categories.find((category) => category.id === activeTab)?.grid;
      const pageSize = grid ? grid.rows * grid.columns : SHORTCUT_PAGE_SIZE;
      applyShortcutGrid(tiles, grid);
      const query = shortcutSearch.trim().toLocaleLowerCase();
      tabs.hidden = Boolean(query);
      const links = getConfig().links.filter(
        (link) =>
          !link.hidden &&
          (query
            ? [link.name, link.path, String(groupLabel(link.group))].some((value) =>
                value.toLocaleLowerCase().includes(query),
              )
            : link.group === activeTab),
      );
      homePage = pagination.update(links.length, homePage, pageSize);
      if (!links.length) {
        const empty = node("div", "qap-empty");
        if (query) {
          empty.setAttribute("role", "status");
          empty.append(icon("mdi:magnify"), node("strong", "", t("shortcuts.no_matches")));
          tiles.append(empty);
          return;
        }
        empty.append(icon("mdi:plus"), node("strong", "", t("shortcuts.empty")));
        empty.append(node("p", "", t("shortcuts.empty_category")));
        empty.append(
          button(
            t("shortcuts.add"),
            () => openShortcutEditor({ category: activeTab }),
            "qap-button-primary",
          ),
        );
        tiles.append(empty);
        return;
      }
      const start = homePage * pageSize;
      for (const link of links.slice(start, start + pageSize)) {
        const categoryGrid = currentProfile().categories.find(
          (category) => category.id === link.group,
        )?.grid;
        tiles.append(shortcutTile(link, { hideName: categoryGrid?.hideNames }));
      }
    }
  }
  function renderShortcutsSettings(body) {
    const content = node("div", "qap-settings");
    const groups = node("div", "qap-shortcut-groups");
    const pagination = shortcutPagination((page) => {
      shortcutPage = page;
      render();
    });
    content.append(groups, pagination.element);
    render();
    body.append(content);
    feedback.refresh();

    function render() {
      replaceLocalizedChildren(groups);
      shortcutPage = pagination.update(getConfig().links.length, shortcutPage);
      const start = shortcutPage * SHORTCUT_PAGE_SIZE;
      const end = start + SHORTCUT_PAGE_SIZE;
      const grouped = new Map(currentProfile().categories.map((category) => [category.id, []]));
      for (const link of getConfig().links) grouped.get(link.group).push(link);
      let position = 0;
      for (const category of currentProfile().categories) {
        const links = grouped.get(category.id);
        const offset = Math.min(links.length, Math.max(0, start - position));
        const visible = links.slice(offset, Math.max(offset, end - position));
        position += links.length;
        const section = node("section", "qap-shortcut-category");
        section.dataset.group = category.id;
        const heading = node("div", "qap-section-line");
        heading.append(
          node("h3", "qap-shortcut-category-title", groupLabel(category.id)),
          node("small", "qap-count", t("common.total", { count: links.length })),
        );
        const list = node("div", "qap-shortcut-list");
        list.dataset.group = category.id;
        section.append(heading, list);
        for (const link of visible) {
          const overflow = overflowButton(
            ui,
            t("shortcuts.manage_named", { name: link.name }),
            (trigger, last) => openShortcutMenu(link.id, trigger, last),
            "qap-shortcut-overflow",
          );
          overflow.dataset.shortcutId = link.id;
          let description;
          switch (link.type) {
            case "saved-filter":
              description = t("shortcuts.saved_filter");
              break;
            case "quick-states":
              description = t("shortcuts.entity_explorer");
              break;
            case "quick-devices":
              description = t("shortcuts.device_explorer");
              break;
            default:
              description = link.path;
          }
          const { row, content } = createManagementRow(ui, l10n, {
            id: link.id,
            contentClass: "qap-shortcut-row",
            symbol: coloredIcon(link),
            name: link.name,
            description,
            onClick: () => openShortcutEditor({ id: link.id }),
            actions: [overflow],
          });
          content.dataset.shortcutId = link.id;
          row.classList.toggle("qap-shortcut-hidden", Boolean(link.hidden));
          list.append(row);
        }
        if (!visible.length)
          section.append(
            node(
              "p",
              "qap-muted",
              t(links.length ? "shortcuts.none_on_page" : "shortcuts.none_added"),
            ),
          );
        groups.append(section);
      }
    }
    function shortcutTrigger(id) {
      return [...groups.querySelectorAll(".qap-shortcut-row")].find(
        (item) => item.dataset.shortcutId === id,
      );
    }
    async function saveLinks(links, focusId, created = false) {
      if (!content.isConnected || profileSession.profileSaving) return;
      if (!(await saveSettings({ ...getConfig(), links }))) return;
      clearStorageError();
      if (!content.isConnected) return;
      if (created) revealShortcut(focusId);
      render();
      feedback.refresh();
      focusWhenReady(shortcutTrigger(focusId) || host.dialog?.querySelector(".qap-add-shortcut"));
    }
    function openShortcutMenu(id, trigger, last = false) {
      const link = getConfig().links.find((item) => item.id === id);
      if (!link || !content.isConnected) return;
      openActionMenu(
        trigger,
        [
          {
            value: "visibility",
            label: t(link.hidden ? "common.enable" : "common.disable"),
            symbol: link.hidden ? "mdi:eye-outline" : "mdi:eye-off-outline",
            className: "qap-visibility-shortcut",
            run: () =>
              saveLinks(upsertShortcut(getConfig().links, { ...link, hidden: !link.hidden }), id),
          },
          {
            value: "duplicate",
            label: t("common.duplicate"),
            symbol: "mdi:content-copy",
            className: "qap-duplicate-shortcut",
            run: () => {
              const overhead = textLength(String(t("shortcuts.copy_name", { name: "" })));
              const copy = {
                ...link,
                id: newId(),
                name: String(
                  t("shortcuts.copy_name", {
                    name: truncateText(link.name, SHORTCUT_NAME_MAX_LENGTH - overhead),
                  }),
                ),
              };
              return saveLinks(upsertShortcut(getConfig().links, copy), copy.id, true);
            },
          },
          {
            value: "delete",
            label: t("common.delete"),
            symbol: "mdi:delete-outline",
            className: "qap-delete-shortcut",
            separator: true,
            danger: true,
            run: () =>
              confirmAction(
                {
                  title: t("shortcuts.confirm_delete"),
                  description: t("shortcuts.delete_confirmation", { name: link.name }),
                  confirmLabel: t("common.delete"),
                  id: "qap-delete",
                },
                trigger,
                () => saveLinks(getConfig().links.filter((item) => item.id !== id)),
              ),
          },
        ],
        t("shortcuts.manage_named", { name: link.name }),
        last,
        {
          navigation: {
            key: "shortcut:" + id,
            open: () =>
              [...(host.dialog?.querySelectorAll(".qap-shortcut-overflow") || [])]
                .find((item) => item.dataset.shortcutId === id)
                ?.click(),
          },
        },
      );
    }
  }

  function shortcutPagination(onChange) {
    const element = node("nav", "qap-pagination");
    l10n.attribute(element, "aria-label", t("shortcuts.pages"));
    let page = 0;
    const previous = button(
      t("shortcuts.previous_page"),
      () => {
        if (!profileSession.profileSaving && !previous.disabled) onChange(page - 1);
      },
      "qap-page-previous",
    );
    const status = node("span", "qap-count");
    status.setAttribute("role", "status");
    const next = button(
      t("shortcuts.next_page"),
      () => {
        if (!profileSession.profileSaving && !next.disabled) onChange(page + 1);
      },
      "qap-page-next",
    );
    element.append(previous, status, next);
    return {
      element,
      update(total, requestedPage, pageSize = SHORTCUT_PAGE_SIZE) {
        const pages = Math.max(1, Math.ceil(total / pageSize));
        page = clamp(requestedPage, 0, pages - 1);
        element.hidden = pages === 1;
        previous.disabled = page === 0;
        next.disabled = page === pages - 1;
        l10n.text(status, t("shortcuts.page", { page: page + 1, pages }));
        return page;
      },
    };
  }

  /** `onDelete(trigger, closeEditor)` replaces Cancel with Delete for an existing removable group. */
  function categoryForm(category, onSaved, onCancel, reopen, { onDelete = null } = {}) {
    closeCategoryEditor();
    // Rebased only onto this editor's own acknowledged shortcut creations.
    let snapshot = currentProfile();
    let expectedRevision = profileSession.baseData.revision;
    const parent = host.dialog;
    const owner = profileUi.profileDialog;
    const {
      modal,
      content,
      body: fields,
    } = createEditorDialog(
      t(category ? "categories.edit" : "categories.add"),
      t("common.close"),
      () => cancel(),
      "qap-category-modal",
    );
    const form = content;
    form.classList.add("qap-category-form");
    const protectedName = category?.id === "favorites";
    const name = input(
      t("categories.name"),
      "text",
      protectedName ? String(t("common.favorites")) : category?.name || "",
      { maxlength: CATEGORY_NAME_MAX_LENGTH, autocomplete: "off", disabled: protectedName },
      protectedName ? t("categories.protected_name") : undefined,
    );
    // Only a persisted group can receive shortcuts; a new one must be saved first.
    const gridFields = categoryGridFields(
      category,
      snapshot.settings.links.filter((link) => link.group === category?.id),
      {
        onAdd: category ? () => openShortcut() : null,
        onEdit: category ? (shortcutId) => openShortcut(shortcutId) : null,
      },
    );
    modal.addEventListener("closed", gridFields.dispose, { once: true });
    const nameValidation = fieldValidation(name, () =>
      categoryNameError(name.value, currentProfile()?.categories ?? [], category?.id),
    );
    const error = errorMessage();
    const editing = () =>
      categoryEditor === modal && host.dialog === parent && currentProfile()?.id === snapshot.id;
    /** Add (no `shortcutId`) or edit a shortcut above this draft. */
    function openShortcut(shortcutId = null) {
      if (!editing() || profileSession.profileSaving || profileUi.profileDialog) return;
      const trigger = shortcutId ? gridFields.item(shortcutId) : gridFields.addTile;
      if (!trigger || (shortcutId && !getConfig().links.some((link) => link.id === shortcutId)))
        return;
      if (
        !currentProfile(profileSession.serverData)?.categories.some(
          (item) => item.id === category.id,
        )
      ) {
        l10n.text(error, t("categories.deleted"));
        return;
      }
      openShortcutEditor({
        id: shortcutId,
        category: category.id,
        parent: { trigger, revision: () => expectedRevision, saved },
      });
    }
    /**
     * Runs after the shortcut's own write of `shortcutId` (`deleted` when it
     * was removed); `editor` is the closing shortcut dialog. Returns focus.
     */
    function saved(shortcutId, editor, deleted = false) {
      const acknowledged = currentProfile();
      const reconciled =
        editing() &&
        acknowledged?.categories.some((item) => item.id === category.id) &&
        acknowledged.settings.links.some((item) => item.id === shortcutId) !== deleted &&
        gridFields.rebase(
          acknowledged.settings.links.filter((item) => item.group === category.id),
          shortcutId,
        );
      if (!reconciled) {
        // The old base stays; a later group Save conflicts rather than overwriting.
        if (categoryEditor === modal) l10n.text(error, t("profiles.errors.conflict"));
        return null;
      }
      // mutateProfile made the acknowledged write the base. Its revision covers
      // only this editor's snapshot plus the shortcut write, never remote changes.
      snapshot = acknowledged;
      expectedRevision = profileSession.baseData.revision;
      if (!reconciled.added.includes(shortcutId))
        return gridFields.item(shortcutId) ?? reconciled.next ?? gridFields.addTile;
      const reveal = () => {
        if (categoryEditor === modal) gridFields.highlight(shortcutId);
      };
      if (editor?.open) editor.addEventListener("closed", reveal, { once: true });
      else reveal();
      return gridFields.item(shortcutId);
    }
    const finished = (action) => {
      gridFields.dispose();
      categoryEditor = categoryNavigation = categoryOpenShortcut = null;
      profileUi.untrackProfileDraft(form);
      const target = action();
      const restore = () =>
        focusWhenReady(
          target,
          () =>
            host.dialog === parent &&
            parent.open &&
            profileUi.profileDialog === owner &&
            !categoryEditor,
        );
      const waitForClose = modal.open;
      if (waitForClose) modal.addEventListener("closed", restore, { once: true });
      cleanupDialogElement(modal);
      navigationChanged();
      if (!waitForClose) restore();
    };
    const cancel = () => {
      if (categoryEditor !== modal) return;
      return afterDiscardingProfileChanges(() => finished(onCancel), modal);
    };
    categoryEditor = modal;
    categoryOpenShortcut = category ? openShortcut : null;
    categoryNavigation = {
      key: `${host.currentView === "categories" ? "settings" : "inline"}:${category?.id || "new"}`,
      open: reopen,
    };
    trackProfileDraft(
      form,
      () => [name.value, ...gridFields.readDraft()],
      profileUi.profileDialog || host.dialog,
    );
    // Keep the ID across failed writes, including a lost acknowledgement.
    const id = category?.id || newId();
    const save = button(
      t("common.save"),
      async () => {
        const profile = snapshot;
        if (!profile || profileSession.profileSaving || categoryEditor !== modal) return;
        if (
          category &&
          !currentProfile(profileSession.serverData)?.categories.some(
            (item) => item.id === category.id,
          )
        ) {
          l10n.text(error, t("categories.deleted"));
          return;
        }
        l10n.text(error, "");
        if (
          !validateFields([...(protectedName ? [] : [nameValidation]), ...gridFields.validations])
        )
          return;
        if (
          !category &&
          profile.categories.length >= profileSession.serverData.limits.max_categories
        ) {
          l10n.text(error, quotaMessage("categories"));
          error.dataset.quotaError = "category_limit";
          return;
        }
        const grid = gridFields.readGrid();
        const nameChanged = !category || (!protectedName && name.value.trim() !== category.name);
        const originalGrid = category?.grid ?? DEFAULT_SHORTCUT_GRID;
        const gridChanged =
          grid.rows !== originalGrid.rows ||
          grid.columns !== originalGrid.columns ||
          Boolean(grid.hideNames) !== Boolean(originalGrid.hideNames);
        const changed = {
          ...category,
          id,
          name: nameChanged ? name.value.trim() : category.name,
          ...(!category || gridChanged ? { grid } : {}),
        };
        const categories = category
          ? profile.categories.map((item) => (item.id === id ? changed : item))
          : [...profile.categories, changed];
        const links = reorderEnabledShortcuts(profile.settings.links, id, gridFields.readOrder());
        if (
          !(await mutateProfile(
            "update",
            {
              ...profile,
              categories,
              ...(links !== profile.settings.links
                ? { settings: { ...profile.settings, links } }
                : {}),
            },
            { expectedRevision },
          ))
        ) {
          showMutationError(error);
          return;
        }
        if (categoryEditor === modal) finished(() => onSaved(changed));
      },
      "qap-button-primary qap-category-submit",
    );
    fields.classList.add("qap-form-body");
    fields.append(name.element, gridFields.element, error);
    const actions = node("div", "qap-form-actions");
    const remove =
      category && !protectedName && onDelete
        ? button(
            t("common.delete"),
            () => {
              if (categoryEditor !== modal || profileSession.profileSaving) return;
              onDelete(remove, () => {
                if (categoryEditor === modal) finished(onCancel);
              });
            },
            "qap-button-danger qap-category-delete",
          )
        : null;
    actions.append(remove ?? button(t("common.cancel"), cancel, "qap-category-cancel"), save);
    form.append(actions);
    form.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
      if (
        event.key === "Enter" &&
        !event.isComposing &&
        fields.contains(event.target) &&
        !event
          .composedPath()
          .some(
            (target) =>
              target.classList?.contains("qap-arrangement") ||
              target.classList?.contains("qap-arrangement-disabled"),
          )
      ) {
        event.preventDefault();
        save.click();
      }
    });
    showDialogElement(modal, () => {
      if (categoryEditor === modal) return cancel();
    });
    commitNavigation();
    profileUi.showProfileStatus();
    // The dialog's own initial focus applies; no field is focused on open.
    return { element: form };
  }

  function closeCategoryEditor() {
    if (!categoryEditor) return;
    const modal = categoryEditor;
    categoryEditor = categoryNavigation = categoryOpenShortcut = null;
    profileUi.untrackProfileDraft(modal.querySelector(".qap-category-form"));
    cleanupDialogElement(modal);
    navigationChanged();
  }

  function categoryDropdown(initialValue, { allowCreate = true } = {}) {
    let value = initialValue;
    const host = node("div", "qap-category-dropdown");
    const options = () => [
      ...currentProfile().categories.map((category) => [
        `category:${category.id}`,
        groupLabel(category.id),
      ]),
      ...(allowCreate ? [["add-category", t("categories.add_new")]] : []),
    ];
    const field = select(t("categories.category"), options(), `category:${value}`);
    host.append(field.element);
    const refresh = () => {
      if (!currentProfile().categories.some((category) => category.id === value))
        value = "favorites";
      field.setOptions(options());
      field.value = `category:${value}`;
    };
    const showCreate = () => {
      categoryForm(
        null,
        (category) => {
          value = category.id;
          refresh();
          return field.control;
        },
        () => field.control,
        () => createInlineCategory?.(),
      );
    };
    if (allowCreate) createInlineCategory = showCreate;
    field.onChange(() => {
      if (allowCreate && field.value === "add-category") {
        field.value = `category:${value}`;
        showCreate();
        return;
      }
      const category = currentProfile().categories.find(
        (category) => `category:${category.id}` === field.value,
      );
      if (category) value = category.id;
      refresh();
    });
    refresh();
    return {
      element: host,
      get value() {
        return value;
      },
    };
  }

  function renderCategoriesSettings(body) {
    const section = node("section", "qap-categories-manager");
    const browser = node("div", "qap-category-browser qap-settings");
    const list = node("div", "qap-category-list");
    browser.append(list);
    section.append(browser);
    body.append(section);
    const addTrigger = () => host.dialog?.querySelector(".qap-create-category");
    const categoryTrigger = (id, selector = ".qap-category-overflow") =>
      [...list.children].find((row) => row.dataset.id === id)?.querySelector(selector);
    const editTrigger = (id) => categoryTrigger(id, ".qap-category-edit");
    editSettingsCategory = (id) => {
      const category = currentProfile().categories.find((item) => item.id === id);
      if (id && !category) return;
      edit(category, category ? editTrigger(id) : addTrigger());
    };
    function edit(category, trigger) {
      if (!section.isConnected || profileSession.profileSaving) return;
      categoryForm(
        category,
        (saved) => {
          render();
          if (!category && section.isConnected) feedback.show(saved.id, true);
          return editTrigger(category?.id) || addTrigger();
        },
        () => (trigger?.isConnected ? trigger : editTrigger(category?.id) || addTrigger()),
        () => editSettingsCategory?.(category?.id),
        {
          onDelete: category
            ? (deleteTrigger, closeEditor) => deleteCategory(category, deleteTrigger, closeEditor)
            : null,
        },
      );
    }
    async function moveCategory(id, offset) {
      const categories = moveById(currentProfile().categories, id, offset);
      // Indexes come from the current profile, never from the rendered menu.
      if (!categories || !(await saveCategories(categories))) {
        focusWhenReady(categoryTrigger(id), () => section.isConnected);
        return;
      }
      if (!section.isConnected) return;
      render();
      feedback.show(id, true);
      focusWhenReady(categoryTrigger(id) || editTrigger(id), () => section.isConnected);
    }
    function categoryActions(category, trigger) {
      const actions = moveActions(
        t,
        currentProfile().categories,
        category.id,
        "category",
        moveCategory,
      );
      if (category.id !== "favorites")
        actions.push({
          value: "delete",
          label: t("common.delete"),
          symbol: "mdi:delete-outline",
          className: "qap-delete-category",
          separator: actions.length > 0,
          danger: true,
          run: () => deleteCategory(category, trigger),
        });
      return actions;
    }
    async function saveCategories(categories, links = getConfig().links) {
      const profile = currentProfile();
      if (!section.isConnected || !profile || profileSession.profileSaving) return false;
      return mutateProfile("update", {
        ...profile,
        categories,
        settings: { ...profile.settings, links },
      });
    }
    function openCategoryMenu(id, trigger, last = false) {
      const category = currentProfile().categories.find((item) => item.id === id);
      if (!category || !section.isConnected) return;
      openActionMenu(
        trigger,
        categoryActions(category, trigger),
        t("categories.manage_named", { name: category.name }),
        last,
        { navigation: { key: "category:" + id, open: () => categoryTrigger(id)?.click() } },
      );
    }
    function deleteCategory(category, trigger, afterDelete = null) {
      if (category.id === "favorites") return;
      const snapshot = currentProfile();
      const expectedRevision = profileSession.baseData.revision;
      const contained = snapshot.settings.links.filter((link) => link.group === category.id);
      let choice;
      let destination;
      confirmAction(
        {
          title: t("categories.confirm_delete"),
          id: "qap-delete-category",
          awaitConfirmation: true,
          closeButton: true,
          description: contained.length
            ? t("categories.delete_contents", {
                name: category.name,
                count: contained.length,
                disabled: contained.filter((link) => link.hidden).length,
              })
            : t("categories.delete_empty", { name: category.name }),
          confirmLabel: t("categories.delete_action"),
          configure: contained.length
            ? (body, confirm) => {
                choice = select(
                  t("categories.delete_behavior"),
                  [
                    ["move", t("categories.move_shortcuts")],
                    ["delete", t("categories.delete_shortcuts")],
                  ],
                  "move",
                );
                choice.element.classList.add("qap-category-delete-choice");
                destination = select(
                  t("categories.move_destination"),
                  snapshot.categories
                    .filter((item) => item.id !== category.id)
                    .map((item) => [item.id, groupLabel(item.id)]),
                  "favorites",
                );
                destination.element.classList.add("qap-category-delete-destination");
                const update = () => {
                  destination.element.hidden = choice.value === "delete";
                  l10n.text(
                    confirm,
                    t(
                      choice.value === "delete"
                        ? "categories.delete_shortcuts_action"
                        : "categories.delete_action",
                    ),
                  );
                  confirm.classList.toggle("qap-button-danger", choice.value === "delete");
                  confirm.classList.toggle("qap-button-primary", choice.value !== "delete");
                  confirm.setAttribute("variant", choice.value === "delete" ? "danger" : "brand");
                  confirm.setAttribute(
                    "appearance",
                    choice.value === "delete" ? "outlined" : "accent",
                  );
                };
                choice.onChange(update);
                body.append(
                  choice.element,
                  destination.element,
                  node("p", "qap-muted", t("categories.delete_scope")),
                );
                update();
              }
            : undefined,
        },
        trigger,
        async () => {
          if (
            contained.length &&
            choice.value === "move" &&
            (destination.value === category.id ||
              !snapshot.categories.some((item) => item.id === destination.value))
          )
            return false;
          let links = snapshot.settings.links;
          if (contained.length) {
            if (choice.value === "delete")
              links = links.filter((link) => link.group !== category.id);
            else links = transferCategoryShortcuts(links, category.id, destination.value);
          }
          if (
            !(await mutateProfile(
              "update",
              {
                ...snapshot,
                categories: snapshot.categories.filter((item) => item.id !== category.id),
                settings: { ...snapshot.settings, links },
              },
              { expectedRevision },
            ))
          )
            return false;
          if (section.isConnected) render();
          afterDelete?.();
          profileUi.confirmationDialog?.addEventListener(
            "closed",
            () => focusWhenReady(addTrigger()),
            { once: true },
          );
          return true;
        },
      );
    }
    function contentsSummary(categoryId) {
      const links = getConfig().links.filter((link) => link.group === categoryId);
      const filters = links.filter((link) => link.type === "saved-filter").length;
      const parts = [
        t("shortcuts.count", { count: links.length - filters }),
        ...(filters ? [t("filters.count", { count: filters })] : []),
      ];
      // A localized value: re-rendered when the language changes.
      return () => parts.map(String).join(", ");
    }
    function render() {
      replaceLocalizedChildren(list);
      for (const category of currentProfile().categories) {
        const name = groupLabel(category.id);
        // A lone Favorites group has no secondary actions to offer.
        const actions = categoryActions(category).length
          ? [
              overflowButton(
                ui,
                t("categories.manage_named", { name }),
                (trigger, last) => openCategoryMenu(category.id, trigger, last),
                "qap-category-overflow",
              ),
            ]
          : [];
        const { row, content } = createManagementRow(ui, l10n, {
          id: category.id,
          className: "qap-category-row",
          contentClass: "qap-category-edit",
          name,
          description: contentsSummary(category.id),
          hint: t("categories.edit"),
          onClick: () => {
            const current = currentProfile().categories.find((item) => item.id === category.id);
            if (current) edit(current, content);
          },
          actions,
        });
        list.append(row);
      }
      feedback.refresh();
    }
    render();
    feedback.refresh();
  }

  function renderShortcutEditor({ modal, content, body, dismiss }, { id, category, path, parent }) {
    const existing = getConfig().links.find((l) => l.id === id);
    // One ID per create editor, so a retried write cannot add a second copy.
    const createdId = newId();
    const type = select(t("shortcuts.type"), SHORTCUT_TYPES, existing?.type ?? "internal");
    const name = input(t("common.name"), "text", existing?.name ?? "", {
      placeholder: t("shortcuts.name_example"),
      maxlength: SHORTCUT_NAME_MAX_LENGTH,
    });
    const ic = iconPickerField(
      t("common.icon"),
      existing?.icon ?? "mdi:format-list-bulleted",
      updatePreview,
    );
    let colorCustomized = Boolean(existing);
    const color = iconColorField(existing?.color, () => {
      colorCustomized = true;
      updatePreview();
    });
    const route = input(t("shortcuts.url_path"), "text", existing?.path ?? path, {
      autocomplete: "off",
      spellcheck: false,
    });
    // A nested editor cannot replace the group editor beneath it with a new one.
    const group = categoryDropdown(existing?.group ?? category, { allowCreate: !parent });
    content.classList.add("qap-shortcut-form");
    body.classList.add("qap-form-body");
    const wrap = body;
    const preview = node("div", "qap-tiles qap-shortcut-preview");
    preview.setAttribute("role", "img");
    function updatePreview() {
      const title =
        truncateText(name.value.trim(), SHORTCUT_NAME_MAX_LENGTH) || t("shortcuts.name");
      l10n.attribute(preview, "aria-label", t("shortcuts.preview", { name: title }));
      replaceLocalizedChildren(
        preview,
        shortcutTile(
          {
            name: title,
            icon: normalizeIcon(ic.value),
            color: normalizeIconColor(color.value),
            type: type.value,
            path: route.value.trim(),
          },
          { preview: true },
        ),
      );
    }
    name.onChange(updatePreview);
    type.onChange(updatePreview);
    route.onChange(updatePreview);
    updatePreview();
    wrap.append(preview);
    wrap.append(name.element);
    wrap.append(ic.element);
    wrap.append(color.element);
    wrap.append(type.element);
    const filterFields = node("div", "qap-shortcut-filters");
    const eligible = (kind) => eligibleShortcutFilters(currentProfile(), kind);
    const initialKind =
      existing?.filterKind ||
      (eligible("states").length || !eligible("devices").length ? "states" : "devices");
    const filterKind = select(
      t("shortcuts.filter_type"),
      [
        ["states", t("entities.filters")],
        ["devices", t("devices.filters")],
      ],
      initialKind,
    );
    const filterChoice = node("div");
    const filterNote = node("p", "qap-muted");
    let filter = null;
    let nameCustomized = Boolean(existing);
    let iconCustomized = Boolean(existing);
    name.onChange(() => {
      nameCustomized = true;
    });
    ic.onChange(() => {
      iconCustomized = true;
    });
    const sceneFields = node("div", "qap-shortcut-scenes");
    const hass = getHass();
    const scenes = Object.values(hass?.states || {}).filter((state) =>
      state.entity_id.startsWith("scene."),
    );
    const sceneOptions = scenes
      .map((state) => [state.entity_id, `${formattedEntityName(state, hass)} (${state.entity_id})`])
      .sort((a, b) => a[1].localeCompare(b[1]));
    const sceneId = existing?.type === "scene" ? existing.path : "";
    if (sceneId && !scenes.some((state) => state.entity_id === sceneId))
      sceneOptions.unshift([sceneId, sceneId]);
    const scene = select(t("shortcuts.scene"), sceneOptions, sceneId || sceneOptions[0]?.[0] || "");
    sceneFields.append(scene.element);
    if (!scenes.length) sceneFields.append(node("p", "qap-muted", t("shortcuts.no_scenes")));
    function updateSaveState() {
      save.disabled =
        type.value === "saved-filter"
          ? !resolveShortcutFilter(currentProfile(), {
              filterKind: filterKind.value,
              filterId: filter.value,
            })
          : type.value === "scene" && !getHass()?.states?.[scene.value];
    }
    function populateScene() {
      updateSaveState();
      const selected = getHass()?.states?.[scene.value];
      if (selected) {
        if (!nameCustomized) name.value = formattedEntityName(selected, getHass());
        if (!iconCustomized) ic.value = normalizeIcon(selected.attributes?.icon, "mdi:palette");
      }
      updatePreview();
    }
    scene.onChange(populateScene);
    wrap.append(sceneFields);
    function populateFilter() {
      const selected = resolveShortcutFilter(currentProfile(), {
        filterKind: filterKind.value,
        filterId: filter?.value,
      });
      updateSaveState();
      if (selected) {
        if (!nameCustomized) name.value = String(filterLabel(selected, filterKind.value, t));
        if (!iconCustomized) ic.value = filterIcon(selected);
        if (!colorCustomized) color.value = selected.color;
      }
      updatePreview();
    }
    function renderFilterChoice(selectedId = null) {
      replaceLocalizedChildren(filterChoice);
      const entries = eligible(filterKind.value);
      const options = entries.map((item) => [
        item.id,
        filterLabel(item, filterKind.value, t),
        t(item.hidden ? "shortcuts.hidden_filters" : "shortcuts.active_filters"),
      ]);
      // Existing hidden system references remain editable; they are never offered for new shortcuts.
      if (selectedId && !entries.some((item) => item.id === selectedId)) {
        const selected = resolveShortcutFilter(currentProfile(), {
          filterKind: filterKind.value,
          filterId: selectedId,
        });
        options.unshift([
          selectedId,
          selected ? filterLabel(selected, filterKind.value, t) : t("shortcuts.filter_unavailable"),
        ]);
      }
      filter = select(t("shortcuts.filter"), options, selectedId || entries[0]?.id || "");
      filter.onChange(populateFilter);
      filterChoice.append(filter.element);
      l10n.text(filterNote, entries.length || selectedId ? "" : t("shortcuts.no_filters"));
      updateSaveState();
      if (type.value === "saved-filter") populateFilter();
    }
    filterKind.onChange(() => {
      const other = filterKind.value === "states" ? "devices" : "states";
      if (!eligible(filterKind.value).length && eligible(other).length) filterKind.value = other;
      renderFilterChoice();
    });
    filterFields.append(filterKind.element, filterChoice, filterNote);
    wrap.append(filterFields);
    const routeField = route.element;
    const currentPath = window.location.pathname;
    const currentUrl = node("div", "qap-field qap-current-url");
    const fullUrl = currentPageUrl();
    let currentUrlAvailable = true;
    // Hide the suggestions once one of them is already in the path field.
    const updateCurrentUrl = () => {
      const value = route.value.trim();
      currentUrl.hidden = !currentUrlAvailable || value === currentPath || value === fullUrl;
    };
    const useCurrentUrl = (value) => () => {
      route.value = value;
      routeValidation.revalidate();
      updatePreview();
      updateCurrentUrl();
    };
    currentUrl.append(
      currentUrlCard(
        currentPath,
        t("common.add"),
        useCurrentUrl(currentPath),
        t("shortcuts.add_current_url"),
      ).element,
    );
    if (fullUrl !== currentPath)
      currentUrl.append(
        currentUrlCard(
          fullUrl,
          t("common.add"),
          useCurrentUrl(fullUrl),
          t("visibility.current_full_url"),
        ).element,
      );
    route.onChange(updateCurrentUrl);
    wrap.append(routeField, currentUrl);
    const routeValidation = fieldValidation(route, () =>
      isRegistryShortcut(type.value) || type.value === "scene"
        ? ""
        : shortcutPathError(type.value, route.value.trim()),
    );
    const validations = [
      fieldValidation(name, () => shortcutNameError(name.value)),
      fieldValidation(ic, () => (normalizeIcon(ic.value, "") ? "" : t("shortcuts.invalid_icon"))),
      routeValidation,
    ];
    const toggleRoute = () => {
      l10n.property(
        route.control,
        "placeholder",
        type.value === "external" ? "https://example.com" : STATES_PATH,
      );
      routeField.hidden = isRegistryShortcut(type.value) || type.value === "scene";
      currentUrlAvailable = !existing && !routeField.hidden;
      updateCurrentUrl();
      filterFields.hidden = type.value !== "saved-filter";
      sceneFields.hidden = type.value !== "scene";
      routeValidation.revalidate();
    };
    type.onChange(toggleRoute);
    toggleRoute();
    wrap.append(group.element);
    const error = errorMessage();
    wrap.append(error);
    const actions = node("div", "qap-form-actions");
    const save = button(
      t("common.save"),
      async () => {
        if (profileSession.profileSaving || profileUi.profileDialog !== modal) return;
        const title = name.value.trim();
        const chosen = type.value;
        const url = route.value.trim();
        const iconValue = normalizeIcon(ic.value, "");
        l10n.text(error, "");
        if (!validateFields(validations)) return;
        if (
          chosen === "saved-filter" &&
          !resolveShortcutFilter(currentProfile(), {
            filterKind: filterKind.value,
            filterId: filter.value,
          })
        ) {
          l10n.text(error, t("shortcuts.filter_unavailable"));
          return;
        }
        if (chosen === "scene" && !getHass()?.states?.[scene.value]) {
          l10n.text(error, t("shortcuts.scene_unavailable"));
          return;
        }
        if (stale()) return;
        let shortcutPath = url;
        if (chosen === "scene") shortcutPath = scene.value;
        else if (isRegistryShortcut(chosen)) shortcutPath = "";
        const changed = {
          id: existing?.id ?? createdId,
          name: truncateText(title, SHORTCUT_NAME_MAX_LENGTH),
          icon: iconValue,
          color: normalizeIconColor(color.value),
          type: chosen,
          path: shortcutPath,
          group: group.value,
          ...(existing && "hidden" in existing ? { hidden: existing.hidden } : {}),
          ...(chosen === "saved-filter"
            ? { filterId: filter.value, filterKind: filterKind.value }
            : {}),
        };
        // Category IDs, not names: a transfer is confirmed once the form is valid.
        if (existing && changed.group !== existing.group) {
          confirmAction(
            {
              title: t("shortcuts.confirm_move"),
              description: t("shortcuts.move_confirmation", {
                name: changed.name,
                source: groupLabel(existing.group),
                destination: groupLabel(changed.group),
              }),
              confirmLabel: t("shortcuts.move_action"),
              id: "qap-move-shortcut",
              configure: (body, confirm) => {
                body.append(node("p", "qap-muted", t("shortcuts.move_explanation")));
                confirm.classList.remove("qap-button-danger");
                confirm.classList.add("qap-button-primary");
                confirm.setAttribute("variant", "brand");
                confirm.setAttribute("appearance", "accent");
              },
            },
            save,
            () => commit(changed),
          );
          return;
        }
        await commit(changed);
      },
      "qap-button-primary",
    );
    // The group editor's base must be the one this write extends.
    function stale() {
      if (!parent || profileSession.baseData?.revision === parent.revision()) return false;
      l10n.text(error, t("profiles.errors.conflict"));
      return true;
    }
    async function commit(changed) {
      if (profileSession.profileSaving || profileUi.profileDialog !== modal || stale()) return;
      // upsertShortcut appends a transfer to its destination's enabled or disabled section.
      const links = upsertShortcut(getConfig().links, changed);
      if (
        !(await saveSettings(
          { ...getConfig(), links },
          parent ? { expectedRevision: parent.revision() } : undefined,
        ))
      ) {
        showMutationError(error);
        return;
      }
      if (profileUi.profileDialog !== modal) return;
      markSaved();
      if (parent) {
        // Only the shortcut was written; return to the same group draft.
        profileUi.closeProfileDialog(true, false, parent.saved(changed.id, modal));
        return;
      }
      if ((!existing || changed.group !== existing.group) && host.currentView === "shortcuts")
        revealShortcut(changed.id);
      profileUi.closeProfileDialog(true, true);
      feedback.refresh();
    }
    renderFilterChoice(existing?.type === "saved-filter" ? existing.filterId : null);
    type.onChange(() => {
      updateSaveState();
      if (type.value === "saved-filter") populateFilter();
      if (type.value === "scene") populateScene();
    });
    const markSaved = trackProfileDraft(wrap, () => [
      name.value,
      ic.value,
      color.value,
      type.value,
      route.value,
      group.value,
      ...(type.value === "saved-filter" ? [filterKind.value, filter.value] : []),
      ...(type.value === "scene" ? [scene.value] : []),
    ]);
    const remove = existing
      ? button(
          t("common.delete"),
          () =>
            confirmAction(
              {
                title: t("shortcuts.confirm_delete"),
                description: t("shortcuts.delete_confirmation", { name: existing.name }),
                confirmLabel: t("common.delete"),
                id: "qap-delete",
                awaitConfirmation: true,
              },
              remove,
              async () => {
                if (stale()) return false;
                if (
                  !(await saveSettings(
                    {
                      ...getConfig(),
                      links: getConfig().links.filter((link) => link.id !== id),
                    },
                    parent ? { expectedRevision: parent.revision() } : undefined,
                  ))
                )
                  return false;
                markSaved();
                if (profileUi.profileDialog !== modal) return true;
                // A deletion above Edit Group leaves only that tile's draft position.
                if (parent)
                  profileUi.closeProfileDialog(true, false, parent.saved(id, modal, true));
                else profileUi.closeProfileDialog(true, true);
                return true;
              },
            ),
          "qap-button-danger qap-delete-shortcut",
        )
      : null;
    actions.append(remove ?? button(t("common.cancel"), dismiss, "qap-cancel-shortcut"), save);
    content.append(actions);
  }

  return {
    prepareView,
    disposeView,
    renderHome,
    toggleShortcutSearch,
    resetShortcutSearch,
    renderShortcutsSettings,
    renderCategoriesSettings,
    openShortcutEditor,
    closeCategoryEditor,
    createCategory: () => editSettingsCategory?.(),
    get categoryRoot() {
      return categoryEditor?.isConnected ? categoryEditor : null;
    },
    get categoryNavigation() {
      return categoryEditor?.isConnected ? categoryNavigation : null;
    },
    get activeTab() {
      return activeTab;
    },
    set activeTab(value) {
      activeTab = value;
    },
    get shortcutSearchVisible() {
      return shortcutSearchVisible;
    },
    get shortcutPage() {
      return shortcutPage;
    },
    set shortcutPage(value) {
      shortcutPage = value;
    },
  };
}
