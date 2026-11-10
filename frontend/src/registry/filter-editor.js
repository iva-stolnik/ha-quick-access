import { profilesByName } from "../profiles/profile-order.ts";
import { newId } from "../utils/ids.js";
import {
  FILTER_LIMIT,
  CONDITION_LIMIT,
  FILTER_DEPTH_LIMIT,
  FILTER_NAME_LIMIT,
  SYSTEM_FILTERS,
  fieldOperators,
  FILTER_VALUE_LIMIT,
  ENTITY_FIELDS,
  DEVICE_FIELDS,
  SMART_FILTERS,
  group,
  rule,
  profileFilters,
  filterTemplates,
  filterLabel,
  filterIcon,
  validCondition,
  validFilters,
} from "./filter-definitions.js";
import { createFilterValueSource } from "./filter-values.js";
import { createFilterValueControl } from "./filter-value-control.js";
import { createItemFeedback } from "../ui/item-feedback.ts";
import { createManagementRow, overflowButton, moveActions, moveById } from "../ui/editable-list.js";
import { conditionSummary, conditionIcon } from "./filter-presentation.js";
import { createEntitySelectorSource } from "../entities/entity-selector.ts";
import { DEFAULT_LOW_BATTERY_THRESHOLD } from "../entities/entity-search.js";

const LINKED_SHORTCUT_PREVIEW_LIMIT = 3;
// UI choice only; persisted device entity conditions use type: "entities".
const DEVICE_ENTITIES_CONDITION = "entities";
const createEntitiesCondition = () => ({
  type: "entities",
  quantifier: "any",
  condition: group([rule()]),
});

/** Small declarative builder using Quick Access's public form controls and guards. */
export function createFilterEditor({
  kind,
  view,
  host,
  parentDialog,
  l10n,
  ui,
  forms,
  profileUi,
  getFilters,
  getProfiles = () => [],
  saveFilters,
  getLinkedShortcuts = () => [],
  getValueContext,
  apply,
  preview,
  renderMatches,
  changed,
}) {
  const t = l10n.message;
  const {
    node,
    button,
    icon,
    coloredIcon,
    leadingIcon,
    iconButton,
    replaceLocalizedChildren,
    focusWhenReady,
    createDialogElement,
    createEditorDialog,
    showDialogElement,
    cleanupDialogElement,
  } = ui;
  let modal = null;
  let title = null;
  let create = null;
  let mode = null;
  let editingId = null;
  let draft = null;
  let previewLabel = null;
  let note = null;
  let matches = null;
  let previewAction = null;
  let matchesOpen = false;
  let expandedCondition = null;
  let treeState = new WeakMap();
  const ruleViews = new Map();
  const groupViews = new Map();
  let busy = false;
  let showValidationErrors = false;
  let reuseDialog = null;
  let reuseTrigger = null;
  let reuseFilter = null;
  const valueSource = createFilterValueSource(getValueContext);
  // All entity fields share one derived search index and the mounted list's data.
  const entitySource = createEntitySelectorSource(() => getValueContext("id", "states"));
  const valueControls = new Set();
  const label = (filter) => filterLabel(filter, kind, t);
  const collection = () => getFilters()[kind];
  const feedback = createItemFeedback((id) =>
    mode === "choose"
      ? [...host.querySelectorAll(".qap-edit-item")].find((row) => row.dataset.id === id)
      : undefined,
  );
  const guard = (action) => profileUi.afterDiscardingProfileChanges(action, modal || host);
  function dismiss() {
    if (busy) return false;
    if (mode !== "edit" && mode !== "duplicate") return guard(close);
    // Leaving a form returns to the filter list it was opened from.
    const id = mode === "edit" ? editingId : null;
    return guard(() => {
      show("choose", null);
      const trigger = id && filterTrigger(id);
      if (trigger) focusWhenReady(trigger, () => mode === "choose");
    });
  }
  function ensureModal() {
    if (modal) return;
    const {
      modal: active,
      content,
      body,
    } = createEditorDialog(t("filters.title"), t("common.close"), dismiss, "qap-filter-modal");
    active.classList.add("qap-state-modal");
    const heading = content.querySelector(".qap-head");
    title = heading.querySelector(".qap-title");
    title.id = newId();
    active.setAttribute("aria-labelledby", title.id);
    create = iconButton("mdi:plus", t("filters.create"), () => open("edit"), "qap-create-filter");
    heading.querySelector(".qap-editor-close").classList.add("qap-filter-close");
    heading.insertBefore(create, heading.querySelector(".qap-editor-close"));
    body.classList.add("qap-filter-body");
    body.append(host);
    modal = active;
    showDialogElement(active, () => {
      if (modal === active) return dismiss();
    });
  }
  function clear() {
    showValidationErrors = false;
    closeReusePicker(false);
    reuseTrigger = reuseFilter = null;
    if (modal?.contains(profileUi.profileMenu)) profileUi.closeProfileMenu(false);
    valueControls.clear();
    ruleViews.clear();
    groupViews.clear();
    treeState = new WeakMap();
    expandedCondition = null;
    matches = previewAction = null;
    matchesOpen = false;
    globalThis.visualViewport?.removeEventListener("resize", resizeEditor);
    profileUi.untrackProfileDraft(host);
    replaceLocalizedChildren(host);
    previewLabel = note = null;
  }
  function close() {
    const active = modal;
    feedback.clear();
    clear();
    mode = null;
    draft = null;
    host.hidden = true;
    modal = title = create = null;
    if (active) {
      const trigger = parentDialog.querySelector(".qap-filter-action");
      const restoreFocus = () => {
        if (!modal && parentDialog.isConnected && trigger?.isConnected)
          trigger.focus({ preventScroll: true });
      };
      const waitForClose = active.open;
      if (waitForClose) active.addEventListener("closed", restoreFocus, { once: true });
      cleanupDialogElement(active);
      host.remove();
      if (!waitForClose) restoreFocus();
    }
    profileUi.updateDialogDismissal();
    changed();
  }
  async function persist(entries, defaults = getFilters().defaults, deletedId = null) {
    if (busy) return false;
    const value = { ...getFilters(), [kind]: entries };
    if (defaults) {
      value.defaults = { ...defaults };
      if (
        defaults[kind] &&
        !entries.some((filter) => filter.id === defaults[kind] && !filter.hidden)
      )
        value.defaults[kind] = "all";
    }
    const displayedNames = entries.map((filter) => String(label(filter)).toLocaleLowerCase());
    if (!validFilters(value) || new Set(displayedNames).size !== displayedNames.length) {
      if (note) l10n.text(note, t("filters.invalid"));
      return false;
    }
    busy = true;
    host.inert = true;
    create.disabled = true;
    let saved;
    try {
      saved = await saveFilters(value, deletedId);
    } finally {
      busy = false;
      host.inert = false;
      if (create) create.disabled = false;
    }
    if (!saved && note) l10n.text(note, t("filters.save_failed"));
    return saved;
  }
  function open(nextMode = "choose", id = null) {
    guard(() => show(nextMode, id));
  }
  function show(nextMode, id) {
    clear();
    ensureModal();
    host.hidden = false;
    host.scrollTop = 0;
    mode = nextMode;
    modal.classList.toggle("qap-state-modal", mode === "choose");
    host.classList.toggle("is-editing", mode === "edit" || mode === "duplicate");
    editingId = id;
    draft = null;
    let headingKey = "filters.title";
    if (mode === "duplicate") headingKey = "filters.duplicate";
    else if (mode === "edit") headingKey = id ? "filters.edit" : "filters.create";
    const heading = t(headingKey);
    l10n.text(title, heading);
    create.hidden = mode !== "choose";
    l10n.attribute(modal, "aria-label", heading);
    if ("accessibleLabel" in modal) l10n.property(modal, "accessibleLabel", heading);
    note = node("div", "qap-error");
    note.setAttribute("role", "alert");
    host.append(note);
    if (mode === "edit" || mode === "duplicate") renderEditor(id);
    else {
      const list = node("div", "qap-filter-list");
      host.append(list);
      renderFilters(list);
      if (view.temporary)
        host.append(button(t("filters.temporary"), () => open("edit", "temporary"), "qap-linkish"));
    }
    changed();
    // Editors never open with a field focused; the list focuses its first control.
    focusWhenReady(
      mode === "choose"
        ? host.querySelector("button, qap-icon-button, qap-button, input, qap-input")
        : modal.querySelector(".qap-filter-close"),
      () => !host.hidden,
    );
  }
  function renderFilters(list) {
    replaceLocalizedChildren(list);
    for (const filter of collection()) {
      const name = label(filter);
      const editable = !SYSTEM_FILTERS.includes(filter.id);
      const applyFilter = () => {
        if (!busy && !filter.hidden) {
          apply(filter.id);
          close();
        }
      };
      const use = ui.button(
        t("filters.apply"),
        applyFilter,
        "qap-linkish qap-edit-primary-action qap-filter-apply",
      );
      l10n.attribute(use, "aria-label", t("filters.apply_named", { name }));
      use.disabled = filter.hidden;
      const actions = [use];
      actions.push(
        overflowButton(
          ui,
          t("filters.manage_named", { name }),
          (trigger, last) => openFilterMenu(filter.id, trigger, last),
          "qap-filter-overflow",
        ),
      );
      const { row } = createManagementRow(ui, l10n, {
        id: filter.id,
        contentClass: editable ? "qap-filter-edit" : "",
        symbol: coloredIcon({ ...filter, icon: filterIcon(filter) }),
        name: node("strong", "qap-filter-name", name),
        description: getFilters().defaults?.[kind] === filter.id ? t("common.default") : undefined,
        hint: editable ? t("filters.edit") : undefined,
        onClick: editable
          ? () => {
              if (!busy && mode === "choose") open("edit", filter.id);
            }
          : undefined,
        actions,
      });
      row.classList.toggle("qap-filter-hidden", filter.hidden);
      list.append(row);
    }
    feedback.refresh();
  }
  async function moveFilter(id, offset) {
    const entries = moveById(collection(), id, offset);
    // Positions come from the saved collection, never from the rendered menu.
    if (!entries || busy || mode !== "choose" || !(await persist(entries))) {
      focusWhenReady(filterTrigger(id));
      return;
    }
    apply();
    const list = mode === "choose" && host.querySelector(".qap-filter-list");
    if (!list) return;
    renderFilters(list);
    feedback.show(id, true);
    focusWhenReady(filterTrigger(id), () => mode === "choose");
  }
  function openFilterMenu(id, trigger, last = false) {
    const filter = collection().find((item) => item.id === id);
    if (!filter || busy || mode !== "choose") return;
    const actions = moveActions(t, collection(), id, "filter", moveFilter);
    const isDefault = getFilters().defaults?.[kind] === id;
    actions.push({
      value: "default",
      label: t(isDefault ? "common.default" : "common.set_default"),
      symbol: isDefault ? "mdi:check" : "mdi:star-outline",
      className: "qap-default-filter",
      run: async () => {
        if (isDefault && !filter.hidden) return;
        if (
          await persist(
            collection().map((item) => (item.id === id ? { ...item, hidden: false } : item)),
            { ...getFilters().defaults, [kind]: id },
          )
        ) {
          apply();
          show("choose", null);
          focusWhenReady(filterTrigger(id));
        }
      },
    });
    if (!SYSTEM_FILTERS.includes(id))
      actions.push({
        value: "duplicate",
        label: t("common.duplicate"),
        symbol: "mdi:content-copy",
        className: "qap-duplicate-filter",
        run: () => open("duplicate", id),
      });
    // "All" is every list's fallback, so it can never be disabled.
    if (id !== "all")
      actions.push({
        value: "visibility",
        label: t(filter.hidden ? "common.enable" : "common.disable"),
        symbol: filter.hidden ? "mdi:eye-outline" : "mdi:eye-off-outline",
        className: "qap-visibility-filter",
        run: async () => {
          if (
            await persist(
              collection().map((item) =>
                item.id === id ? { ...item, hidden: !item.hidden } : item,
              ),
            )
          ) {
            apply();
            show("choose", null);
            focusWhenReady(filterTrigger(id));
          }
        },
      });
    if (!SYSTEM_FILTERS.includes(id))
      actions.push({
        value: "delete",
        label: t("common.delete"),
        symbol: "mdi:delete-outline",
        className: "qap-delete-filter",
        separator: true,
        danger: true,
        run: () => confirmDelete(id, trigger),
      });
    profileUi.openActionMenu(
      trigger,
      actions,
      t("filters.manage_named", { name: label(filter) }),
      last,
      {
        dialog: modal,
        shell: modal.querySelector(".qap-shell"),
        navigation: {
          key: `filter:${kind}:${id}`,
          open: () => {
            filterTrigger(id)?.click();
          },
        },
      },
    );
  }
  /** Shared by the list menu and the editor; a deletion returns to the list. */
  function confirmDelete(id, trigger) {
    if (busy || SYSTEM_FILTERS.includes(id)) return;
    const linked = getLinkedShortcuts(id);
    const names = linked
      .slice(0, LINKED_SHORTCUT_PREVIEW_LIMIT)
      .map((link) => link.name)
      .join(", ");
    const remaining = linked.length - Math.min(linked.length, LINKED_SHORTCUT_PREVIEW_LIMIT);
    let description = t("filters.delete_confirmation");
    if (linked.length) {
      const key = remaining
        ? "filters.delete_linked_confirmation_more"
        : "filters.delete_linked_confirmation";
      description = t(key, { count: linked.length, names, remaining });
    }
    profileUi.confirmAction(
      {
        title: t("filters.delete"),
        description,
        confirmLabel: t(linked.length ? "filters.delete_linked" : "common.delete"),
        id: "qap-delete-filter",
      },
      trigger,
      async () => {
        if (
          await persist(
            collection().filter((item) => item.id !== id),
            getFilters().defaults,
            id,
          )
        ) {
          apply();
          show("choose", null);
        }
      },
    );
  }
  function filterTrigger(id) {
    return [...host.querySelectorAll(".qap-edit-item")]
      .find((item) => item.dataset.id === id)
      ?.querySelector(".qap-filter-overflow");
  }
  function closeReusePicker(restore = true) {
    const active = reuseDialog;
    if (!active) return;
    const trigger = reuseTrigger;
    reuseDialog = null;
    const restoreFocus = () => {
      if (restore && !reuseDialog && trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
    const waitForClose = active.open;
    if (waitForClose) active.addEventListener("closed", restoreFocus, { once: true });
    cleanupDialogElement(active);
    if (!waitForClose) restoreFocus();
    changed();
  }
  function openReusePicker() {
    if (busy || reuseDialog || !reuseTrigger?.isConnected) return;
    const active = createDialogElement(t("filters.template"));
    active.classList.add("qap-state-modal", "qap-filter-reuse-modal");
    const content = node("div", "qap-shell");
    const heading = node("div", "qap-state-modal-head");
    const title = node("h2", "qap-title", t("filters.template"));
    title.id = newId();
    active.setAttribute("aria-labelledby", title.id);
    heading.append(
      iconButton(
        "mdi:arrow-left",
        t("common.back"),
        () => closeReusePicker(),
        "qap-filter-reuse-back",
      ),
      title,
    );
    const body = node("div", "qap-state-modal-body");
    let count = 0;
    for (const profile of profilesByName(getProfiles())) {
      const filters = profileFilters(profile)[kind].filter(
        (filter) => !SYSTEM_FILTERS.includes(filter.id),
      );
      if (!filters.length) continue;
      const section = node("details", "qap-filter-reuse-profile");
      const profileHeading = node("summary", "qap-filter-reuse-heading");
      const avatar = node("span", "qap-profile-avatar");
      avatar.append(coloredIcon(profile));
      const name = node("h3", "", t("filters.profile_filters", { name: profile.name }));
      name.id = newId();
      section.setAttribute("aria-labelledby", name.id);
      section.dataset.profile = profile.id;
      profileHeading.append(avatar, name, icon("mdi:chevron-down", "qap-filter-reuse-toggle"));
      section.append(profileHeading);
      for (const filter of filters) {
        const choose = button(
          label(filter),
          () => {
            if (reuseDialog !== active) return;
            reuseFilter(filter);
            closeReusePicker();
          },
          "qap-filter-reuse-option",
        );
        choose.setAttribute("appearance", "plain");
        choose.setAttribute("variant", "neutral");
        const symbol = coloredIcon({ ...filter, icon: filterIcon(filter) });
        symbol.slot = "start";
        choose.prepend(symbol);
        const arrow = icon("mdi:chevron-right", "qap-filter-reuse-arrow");
        arrow.slot = "end";
        choose.append(arrow);
        choose.dataset.id = filter.id;
        section.append(choose);
        count++;
      }
      body.append(section);
    }
    if (!count) body.append(node("p", "qap-muted", t("filters.reuse_empty")));
    content.append(heading, body);
    active.append(content);
    reuseDialog = active;
    showDialogElement(active, () => {
      if (reuseDialog === active) closeReusePicker();
    });
    changed();
    focusWhenReady(
      body.querySelector("summary") || heading.querySelector("button, qap-icon-button"),
      () => reuseDialog === active,
    );
  }
  function renderEditor(id) {
    const original =
      id === "temporary" ? view.temporary : collection().find((item) => item.id === id);
    if (original && SYSTEM_FILTERS.includes(original.id)) {
      show("choose", null);
      return;
    }
    draft = JSON.parse(
      JSON.stringify(
        original || {
          id: newId(),
          name: "",
          hidden: false,
          condition: group([rule(kind === "devices" ? "name" : "state")]),
        },
      ),
    );
    if (mode === "duplicate" && original) {
      draft.id = newId();
      draft.hidden = false;
      const overhead = Array.from(String(t("filters.copy_name", { name: "" }))).length;
      draft.name = String(
        t("filters.copy_name", {
          name: Array.from(String(label(original)))
            .slice(0, FILTER_NAME_LIMIT - overhead)
            .join(""),
        }),
      );
    }
    let canonicalName = draft.name;
    let displayedName = "";
    if (mode === "duplicate") displayedName = draft.name;
    else if (original) displayedName = String(label(original));
    const name = forms.input(t("filters.name"), "text", displayedName, {
      maxlength: FILTER_NAME_LIMIT,
      autocomplete: "off",
    });
    name.onChange(() => {
      draft.name = name.value === displayedName ? canonicalName : name.value;
      refreshPreview();
    });
    const metadata = node("div", "qap-filter-metadata");
    metadata.append(name.element);
    host.append(metadata);
    const iconField = forms.iconPickerField(t("common.icon"), filterIcon(draft), () => {
      draft.icon = iconField.value;
      refreshPreview();
    });
    metadata.append(iconField.element);
    const colorField = forms.iconColorField(draft.color, () => {
      draft.color = colorField.value;
      refreshPreview();
    });
    host.append(colorField.element);
    if (!original) {
      reuseTrigger = button(
        t("filters.reuse_choose"),
        openReusePicker,
        "qap-control qap-filter-reuse",
      );
      reuseTrigger.setAttribute("aria-haspopup", "dialog");
      host.append(forms.fieldLabel(t("filters.template"), reuseTrigger));
      reuseFilter = (filter) => {
        const copied = JSON.parse(JSON.stringify(filter));
        const names = new Set(collection().map((item) => String(label(item)).toLocaleLowerCase()));
        let nextName = String(label(filter));
        let copy = 0;
        while (names.has(nextName.toLocaleLowerCase())) {
          copy++;
          const suffix = copy > 1 ? ` ${copy}` : "";
          const overhead = Array.from(String(t("filters.copy_name", { name: "" })) + suffix).length;
          nextName =
            String(
              t("filters.copy_name", {
                name: Array.from(String(label(filter)))
                  .slice(0, FILTER_NAME_LIMIT - overhead)
                  .join(""),
              }),
            ) + suffix;
        }
        draft = { ...copied, id: draft.id, name: copy ? nextName : copied.name, hidden: false };
        if (!draft.templateId && filterTemplates(kind).some((item) => item.id === copied.id))
          draft.templateId = copied.id;
        canonicalName = draft.name;
        displayedName = name.value = nextName;
        iconField.value = filterIcon(draft);
        colorField.value = draft.color;
        l10n.text(reuseTrigger, label(filter));
        renderConditions();
        refreshPreview();
      };
    }
    const conditions = node("div", "qap-filter-conditions");
    const renderConditions = () => {
      valueControls.clear();
      ruleViews.clear();
      groupViews.clear();
      replaceLocalizedChildren(conditions);
      conditions.append(renderGroup(draft.condition, kind, 0, renderConditions));
    };
    host.append(conditions);
    renderConditions();
    host.append(node("p", "qap-muted", t("filters.limits")));
    previewLabel = node("span", "qap-count qap-filter-preview");
    previewLabel.setAttribute("role", "status");
    matches = node("div", "qap-filter-matches");
    matches.id = newId();
    matches.hidden = true;
    previewAction = button(
      "",
      () => {
        matchesOpen = !matchesOpen;
        refreshPreview();
      },
      "qap-linkish qap-filter-preview-action",
    );
    previewAction.setAttribute("aria-controls", matches.id);
    previewAction.append(
      leadingIcon("mdi:format-list-bulleted"),
      previewLabel,
      icon("mdi:chevron-down"),
    );
    host.append(previewAction, matches);
    const markSaved = profileUi.trackProfileDraft(host, () => draft, parentDialog);
    const actions = node("div", "qap-form-actions qap-filter-actions");
    const save = async () => {
      showValidationErrors = true;
      refreshPreview();
      draft.name = draft.name.trim();
      const next = { ...draft, id: draft.id === "temporary" ? newId() : draft.id };
      const entries = [...collection()];
      const index = entries.findIndex((item) => item.id === next.id);
      if (index === -1) {
        if (entries.filter((item) => !SYSTEM_FILTERS.includes(item.id)).length >= FILTER_LIMIT) {
          l10n.text(note, t("filters.limit"));
          return;
        }
        entries.push(next);
      } else entries[index] = next;
      if (!(await persist(entries))) return;
      markSaved();
      apply(next.id);
      close();
      if (index === -1 && parentDialog.isConnected) feedback.show(next.id, true);
    };
    // Editing a saved filter offers Delete; creating, duplicating and the temporary filter keep Cancel.
    const savedId = mode === "edit" && original && original.id !== "temporary" ? original.id : null;
    const remove = savedId
      ? button(
          t("common.delete"),
          () => confirmDelete(savedId, remove),
          "qap-button-danger qap-filter-delete",
        )
      : null;
    actions.append(
      remove ?? button(t("common.cancel"), dismiss, "qap-filter-cancel"),
      button(t("filters.apply_temporary"), () => {
        showValidationErrors = true;
        refreshPreview();
        if (!validCondition(draft.condition, kind)) {
          l10n.text(note, t("filters.invalid"));
          return;
        }
        view.temporary = JSON.parse(JSON.stringify({ ...draft, id: "temporary", hidden: false }));
        markSaved();
        apply("temporary");
        close();
      }),
      button(t("common.save"), save, "qap-button-primary"),
    );
    const editorBody = node("div", "qap-filter-editor-body");
    editorBody.append(...host.children);
    host.append(editorBody, actions);
    globalThis.visualViewport?.addEventListener("resize", resizeEditor);
    resizeEditor();
    refreshPreview();
  }
  function resizeEditor() {
    if (!modal || !draft) return;
    if (globalThis.visualViewport)
      modal.style.setProperty(
        "--qap-editor-viewport-height",
        `${globalThis.visualViewport.height}px`,
      );
    let active = ui.focusedElement?.();
    while (active && !host.contains(active)) active = active.getRootNode?.().host;
    active?.scrollIntoView?.({ block: "nearest" });
  }
  function stateFor(condition) {
    if (!treeState.has(condition)) treeState.set(condition, { collapsed: false });
    return treeState.get(condition);
  }
  function expandRule(condition, focus = false) {
    expandedCondition = expandedCondition === condition ? null : condition;
    for (const view of ruleViews.values()) view.sync();
    if (focus && expandedCondition) {
      const view = ruleViews.get(condition);
      view.row.scrollIntoView?.({ block: "nearest" });
      focusWhenReady(
        view.row.querySelector("select, qap-select, input, qap-input"),
        () => expandedCondition === condition,
      );
    }
  }
  function leafCount(item) {
    if (item.type === "rule") return 1;
    if (item.type === "entities") return leafCount(item.condition);
    return item.conditions.reduce((sum, child) => sum + leafCount(child), 0);
  }
  function renderGroup(condition, scope, depth, rerender, remove = null) {
    const box = node("section", "qap-filter-group");
    box.dataset.depth = String(depth);
    box.setAttribute("role", "group");
    const state = stateFor(condition);
    const header = node("div", "qap-filter-group-header");
    const contents = node("div", "qap-filter-group-contents");
    contents.id = newId();
    const groupLabel = t(depth === 0 ? "filters.root_group" : "filters.group");
    const toggle = button(
      "",
      () => {
        state.collapsed = !state.collapsed;
        sync();
      },
      "qap-linkish qap-filter-group-toggle",
    );
    const chevron = leadingIcon("mdi:chevron-down");
    const openLogicMenu = (last = false) => {
      if (busy) return;
      profileUi.openActionMenu(
        badge,
        ["and", "or", "not"].map((value) => ({
          value,
          label: t(`filters.logic_${value}`),
          symbol: condition.operator === value ? "mdi:check" : undefined,
          className: `qap-filter-logic-${value}`,
          run: () => {
            condition.operator = value;
            sync();
            refreshPreview();
            focusWhenReady(badge, () => box.isConnected);
          },
        })),
        t("filters.match"),
        last,
        {
          dialog: modal,
          shell: modal.querySelector(".qap-shell"),
          className: "qap-filter-logic-menu",
          navigation: {
            key: `filter-logic:${kind}:${contents.id}`,
            open: () => {
              if (box.isConnected) badge.click();
            },
          },
        },
      );
    };
    const badge = button("", () => openLogicMenu(), "qap-linkish qap-filter-logic");
    badge.setAttribute("aria-haspopup", "menu");
    badge.setAttribute("aria-expanded", "false");
    badge.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      openLogicMenu(event.key === "ArrowUp");
    });
    toggle.append(chevron, node("span", "qap-filter-group-label", groupLabel));
    toggle.setAttribute("aria-controls", contents.id);
    l10n.attribute(box, "aria-label", groupLabel);
    header.append(toggle, badge);
    const sync = () => {
      contents.hidden = state.collapsed;
      toggle.setAttribute("aria-expanded", String(!state.collapsed));
      chevron.setAttribute("icon", state.collapsed ? "mdi:chevron-right" : "mdi:chevron-down");
      box.dataset.operator = condition.operator;
      l10n.text(badge, t(`filters.logic_${condition.operator}`));
      l10n.attribute(
        badge,
        "aria-label",
        () => `${t("filters.match")}: ${t(`filters.logic_${condition.operator}`)}`,
      );
      l10n.attribute(
        toggle,
        "aria-label",
        () => `${groupLabel} ${t(`filters.logic_${condition.operator}`)}`,
      );
    };
    groupViews.set(condition, { box });
    const children = node("div", "qap-filter-children");
    condition.conditions.forEach((child, index) => {
      const row = node("div", "qap-filter-condition");
      const removeChild = () => {
        condition.conditions.splice(index, 1);
        rerender();
        refreshPreview();
        focusWhenReady(groupViews.get(condition).box.querySelector(".qap-filter-add-condition"));
      };
      const replaceChild = (next) => {
        condition.conditions[index] = next;
        expandedCondition = next.type === "rule" ? next : next.condition.conditions[0];
        rerender();
        refreshPreview();
        const nextRow = groupViews.get(condition).box.querySelector(".qap-filter-children")
          .children[index];
        nextRow.scrollIntoView?.({ block: "nearest" });
        focusWhenReady(nextRow.querySelector("select, qap-select"), () => nextRow.isConnected);
      };
      if (child.type === "group")
        row.append(renderGroup(child, scope, depth + 1, rerender, removeChild));
      else if (child.type === "entities") {
        const field = conditionField(child, scope, depth);
        field.onChange(() => {
          if (field.value === DEVICE_ENTITIES_CONDITION) return;
          replaceChild(
            rule(field.value, "equals", field.value === "smart" ? SMART_FILTERS[scope][0] : ""),
          );
        });
        const quantifier = forms.select(
          t("filters.entities"),
          [
            ["any", t("filters.any_entity")],
            ["all", t("filters.all_entities")],
          ],
          child.quantifier,
        );
        quantifier.onChange(() => {
          child.quantifier = quantifier.value;
          refreshPreview();
        });
        row.append(
          field.element,
          quantifier.element,
          renderGroup(child.condition, "states", depth + 1, rerender, removeChild),
          node("small", "qap-muted", t("filters.empty_devices")),
        );
      } else row.append(renderRule(child, scope, depth, removeChild, replaceChild));
      children.append(row);
    });
    const add = (title, symbol, make, className) => {
      const action = iconButton(
        symbol,
        t(title),
        () => {
          const child = make();
          condition.conditions.push(child);
          state.collapsed = false;
          if (child.type === "rule") expandedCondition = child;
          else if (child.type === "entities") expandedCondition = child.condition.conditions[0];
          else expandedCondition = child.conditions[0];
          rerender();
          refreshPreview();
          const view = ruleViews.get(expandedCondition);
          view.row.scrollIntoView?.({ block: "nearest" });
          focusWhenReady(view.row.querySelector("select, qap-select"));
        },
        className,
      );
      action.disabled =
        leafCount(draft.condition) >= CONDITION_LIMIT ||
        condition.conditions.length >= CONDITION_LIMIT;
      header.append(action);
    };
    add(
      "filters.add_condition",
      "mdi:plus",
      () => rule(scope === "devices" ? "name" : "state"),
      "qap-filter-add-condition",
    );
    if (depth < FILTER_DEPTH_LIMIT) {
      add(
        "filters.add_group",
        "mdi:format-list-group-plus",
        () => group([rule(scope === "devices" ? "name" : "state")]),
        "qap-filter-add-group",
      );
      if (scope === "devices")
        add(
          "filters.add_entities",
          "mdi:devices",
          createEntitiesCondition,
          "qap-filter-add-entities",
        );
    }
    if (remove)
      header.append(
        iconButton("mdi:delete-outline", t("filters.remove_group"), remove, "qap-filter-remove"),
      );
    if (!condition.conditions.length)
      children.append(node("p", "qap-muted", t("filters.empty_group")));
    contents.append(children);
    box.append(header, contents);
    sync();
    return box;
  }
  function renderRule(condition, scope, depth, remove, replace) {
    const row = node("div", "qap-filter-rule");
    const summary = node("div", "qap-filter-rule-summary");
    const toggle = button("", () => expandRule(condition), "qap-linkish qap-filter-rule-toggle");
    const symbol = leadingIcon(conditionIcon(condition));
    const description = node("span", "qap-filter-rule-description");
    const fieldText = node("strong");
    const operatorText = node("span", "qap-filter-rule-operator");
    const valueText = node("span", "qap-filter-rule-value");
    description.append(fieldText, operatorText, valueText);
    toggle.append(symbol, description);
    const edit = iconButton(
      "mdi:pencil-outline",
      t("filters.edit_condition"),
      () => expandRule(condition, true),
      "qap-filter-edit-condition",
    );
    summary.append(
      toggle,
      edit,
      iconButton("mdi:close", t("filters.remove_condition"), remove, "qap-filter-remove"),
    );
    const fields = node("div", "qap-filter-rule-fields");
    fields.id = newId();
    toggle.setAttribute("aria-controls", fields.id);
    edit.setAttribute("aria-controls", fields.id);
    const error = node("p", "qap-field-error", t("filters.invalid_condition"));
    error.id = newId();
    row.append(summary, fields, error);
    const sync = () => {
      const expanded = expandedCondition === condition;
      fields.hidden = !expanded;
      row.classList.toggle("is-expanded", expanded);
      toggle.setAttribute("aria-expanded", String(expanded));
      edit.setAttribute("aria-expanded", String(expanded));
      const text = conditionSummary(condition, t);
      l10n.text(fieldText, () => conditionSummary(condition, t).field);
      l10n.text(operatorText, () => conditionSummary(condition, t).operator);
      l10n.text(valueText, text.value);
      l10n.property(toggle, "title", () => conditionSummary(condition, t).text);
      l10n.attribute(toggle, "aria-label", () => conditionSummary(condition, t).text);
      symbol.setAttribute("icon", conditionIcon(condition));
      const invalid = showValidationErrors && !validCondition(group([condition]), scope);
      error.hidden = !invalid;
      toggle.setAttribute("aria-invalid", String(invalid));
      if (invalid) toggle.setAttribute("aria-describedby", error.id);
      else toggle.removeAttribute("aria-describedby");
    };
    const rerender = (focusLabel) => {
      for (const control of valueControls)
        if (fields.contains(control.element)) valueControls.delete(control);
      replaceLocalizedChildren(fields);
      const controls = renderRuleFields(condition, scope, depth, fields, rerender, replace);
      sync();
      if (focusLabel && expandedCondition === condition) {
        focusWhenReady(controls[focusLabel].control, () => expandedCondition === condition);
      }
    };
    ruleViews.set(condition, { row, sync });
    rerender();
    return row;
  }
  function conditionField(condition, scope, depth) {
    const options = (scope === "devices" ? DEVICE_FIELDS : ENTITY_FIELDS).map((value) => [
      value,
      t(`filters.field_${value}`),
    ]);
    if (scope === "devices" && (depth < FILTER_DEPTH_LIMIT || condition.type === "entities"))
      options.push([DEVICE_ENTITIES_CONDITION, t("filters.entities")]);
    return forms.select(
      t("filters.field"),
      options,
      condition.type === "entities" ? DEVICE_ENTITIES_CONDITION : condition.field,
    );
  }
  function renderRuleFields(condition, scope, depth, row, rerender, replace) {
    const field = conditionField(condition, scope, depth);
    field.onChange(() => {
      if (field.value === DEVICE_ENTITIES_CONDITION) {
        if (scope === "devices" && depth < FILTER_DEPTH_LIMIT) replace(createEntitiesCondition());
        return;
      }
      condition.field = field.value;
      delete condition.attribute;
      delete condition.threshold;
      condition.operator = "equals";
      condition.value = condition.field === "smart" ? SMART_FILTERS[scope][0] : "";
      if (condition.field === "attribute") condition.attribute = "";
      rerender("field");
      refreshPreview();
    });
    row.append(field.element);
    if (condition.field === "attribute") {
      const attribute = forms.input(t("filters.attribute"), "text", condition.attribute, {
        maxlength: 100,
      });
      attribute.onChange(() => {
        condition.attribute = attribute.value;
        refreshPreview();
      });
      row.append(attribute.element);
    }
    const operators = fieldOperators(condition.field);
    // Retain v1 saved operators until the user changes this rule.
    if (!operators.includes(condition.operator)) operators.push(condition.operator);
    const operator = forms.select(
      t("filters.operator"),
      operators.map((value) => [value, t(`filters.op_${value}`)]),
      condition.operator,
    );
    operator.onChange(() => {
      condition.operator = operator.value;
      if (operator.value === "exists") condition.value = true;
      else if (operator.value === "any_of") condition.value = [];
      else if (["greater_than", "less_than"].includes(operator.value)) condition.value = 0;
      else condition.value = "";
      rerender("operator");
      refreshPreview();
    });
    if (condition.field !== "smart") row.append(operator.element);
    if (condition.operator !== "exists") {
      const numeric = ["greater_than", "less_than"].includes(condition.operator);
      if (condition.field === "id" && scope === "states" && condition.operator !== "contains") {
        const multiple = condition.operator === "any_of";
        entitySource.refresh();
        const value = forms.selectorField(
          t("filters.value"),
          { entity: { multiple } },
          condition.value,
          multiple ? t("filters.values_hint") : undefined,
          entitySource,
        );
        valueControls.add(value);
        value.onChange(() => {
          const next = value.value;
          if (
            multiple
              ? !Array.isArray(next) ||
                next.length > FILTER_VALUE_LIMIT ||
                next.some((item) => typeof item !== "string" || item.length > 256)
              : typeof next !== "string" || next.length > 256
          ) {
            value.value = condition.value;
            return;
          }
          condition.value = next;
          refreshPreview();
        });
        row.append(value.element);
        return { field, operator };
      }
      if (!numeric && condition.operator !== "contains" && valueSource(condition.field, scope)) {
        const value = createFilterValueControl({
          title: t("filters.value"),
          value: condition.value,
          multiple: condition.operator === "any_of",
          getData: () => valueSource(condition.field, scope),
          onChange: (value) => {
            condition.value = value;
            refreshPreview();
          },
          ui,
          forms,
          l10n,
        });
        valueControls.add(value);
        row.append(value.element);
        return { field, operator };
      }
      let value;
      if (condition.field === "smart") {
        value = forms.select(
          t("filters.value"),
          filterTemplates(scope)
            .filter((filter) => SMART_FILTERS[scope].includes(filter.id))
            .map((filter) => [filter.id, filterLabel(filter, scope, t)]),
          condition.value,
        );
      } else {
        value = forms.input(
          t("filters.value"),
          numeric ? "number" : "text",
          Array.isArray(condition.value) ? condition.value.join(", ") : String(condition.value),
          { maxlength: condition.operator === "any_of" ? 1000 : 256 },
          condition.operator === "any_of" ? t("filters.values_hint") : undefined,
        );
      }
      value.onChange(() => {
        if (numeric) condition.value = value.value.trim() ? Number(value.value) : null;
        else if (condition.operator === "any_of")
          condition.value = value.value.split(",").map((item) => item.trim());
        else {
          const smartChanged = condition.field === "smart" && condition.value !== value.value;
          condition.value = value.value;
          if (smartChanged) {
            delete condition.threshold;
            rerender("value");
          }
        }
        refreshPreview();
      });
      row.append(value.element);
      if (condition.field === "smart" && condition.value === "low_battery") {
        const threshold = forms.input(
          t("filters.battery_threshold"),
          "number",
          String(
            condition.threshold === undefined
              ? DEFAULT_LOW_BATTERY_THRESHOLD
              : (condition.threshold ?? ""),
          ),
          { min: "0", max: "100", step: "any", required: true },
        );
        threshold.onChange(() => {
          condition.threshold = threshold.value.trim() ? Number(threshold.value) : null;
          refreshPreview();
        });
        row.append(threshold.element);
      }
      return { field, operator, value };
    }
    return { field, operator };
  }
  function refreshPreview() {
    if (!draft || !previewLabel) return;
    if (host.querySelector("qap-entity-selector")) entitySource.refresh();
    for (const control of valueControls) control.refresh();
    for (const view of ruleViews.values()) view.sync();
    const valid = validCondition(draft.condition, kind);
    let previewMessage = "";
    if (valid) previewMessage = t(`filters.preview_${kind}`, { count: preview(draft.condition) });
    else if (showValidationErrors) previewMessage = t("filters.invalid");
    l10n.text(previewLabel, previewMessage);
    previewAction.hidden = !valid && !showValidationErrors;
    previewAction.disabled = !valid || !renderMatches;
    previewAction.setAttribute("aria-expanded", String(matchesOpen && valid));
    matches.hidden = !matchesOpen || !valid;
    if (!matches.hidden) renderMatches(matches, draft.condition);
    profileUi.updateDialogDismissal();
  }
  return {
    open,
    close,
    dispose() {
      close();
      feedback.dispose();
    },
    refreshPreview,
    openReusePicker,
    closeReusePicker,
    get active() {
      return mode !== null;
    },
    get reuseNavigation() {
      return reuseDialog ? { key: `${kind}:reuse` } : null;
    },
    get navigation() {
      return mode ? { key: `${kind}:${mode}:${editingId || ""}`, mode, id: editingId } : null;
    },
  };
}
