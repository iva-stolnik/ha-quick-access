import { clamp } from "../utils/numbers.js";
import { createEntityStatesSource } from "../data/entity-states-source.js";
import { createDeviceRegistrySource } from "../data/device-registry-source.js";
import { createEntityPresentation } from "../entities/entity-presentation.js";
import { createDevicePresentation } from "../devices/device-presentation.js";
import { entityMatches } from "../entities/entity-search.js";
import { deviceMatches } from "../devices/device-search.js";
import { getDeviceName } from "../devices/device-formatting.js";
import { profileFilters, filterLabel } from "./filter-definitions.js";
import { compileFilter, entityDeviceIndex } from "./filter-evaluation.js";
import { createFilterEditor } from "./filter-editor.js";
const EMPTY_REGISTRY = Object.freeze({});
const FILTER_PREVIEW_PAGE_SIZE = 40;
import {
  normalizeStatesSearchHistory,
  STATES_SEARCH_MAX_LENGTH,
  STATES_SEARCH_DEBOUNCE_MS,
  STATES_UPDATE_BATCH_MS,
  STATES_FALLBACK_POLL_MS,
  STATES_OVERSCAN,
} from "./registry-view.js";

export function mountRegistryList(
  body,
  {
    kind,
    view,
    l10n,
    ui,
    getHass,
    getHaRoot,
    isEnabled,
    contextTarget,
    details,
    canSaveHistory,
    saveHistory,
    getFilters = () => profileFilters(),
    getProfiles,
    saveFilters,
    getLinkedShortcuts,
    forms,
    profileUi,
    parentDialog,
    navigationChanged = () => {},
  },
) {
  const t = l10n.message;

  const {
    node,
    icon,
    button,
    chipButton,
    tabButton,
    setTabActive,
    searchField,
    removeLocalizedElement,
    replaceLocalizedChildren,
  } = ui;
  let deviceRegistries = null;
  let statesRefresh = null;
  const { entityIcon, updateEntityRow } = createEntityPresentation({ l10n, ui, getHass });
  const { deviceIcon, updateDeviceRow } = createDevicePresentation({
    l10n,
    ui,
    getHass,
    getRegistries: () => deviceRegistries,
  });
  const devices = kind === "devices";
  const updateStateRow = devices ? updateDeviceRow : updateEntityRow;
  const labels = devices ? "devices" : "entities";
  const recordId = (record) => (devices ? record.id : record.entity_id);
  const records = () => (devices ? deviceRegistries?.devices || {} : getHass()?.states || {});
  const wrap = node("div", "qap-states");
  let disposed = false;
  let searchTimer = null;
  let appliedSearch = view.search;
  function applySearch() {
    clearTimeout(searchTimer);
    searchTimer = null;
    if (disposed) return;
    appliedSearch = view.search;
    pendingScroll = null;
    body.scrollTop = 0;
    updateList();
  }
  let searchInput;
  const search = searchField(
    t(`${labels}.search`),
    view.search,
    (value) => {
      view.search = value;
      clearTimeout(searchTimer);
      if (!value.trim()) applySearch();
      else searchTimer = setTimeout(applySearch, STATES_SEARCH_DEBOUNCE_MS);
    },
    (control) => {
      searchInput = control;
      control.maxLength = STATES_SEARCH_MAX_LENGTH;
      control.maxlength = STATES_SEARCH_MAX_LENGTH;
      // Ignore focus moving between a native search field's internal controls.
      control.addEventListener("focusout", (event) => {
        if (!control.contains(event.relatedTarget))
          rememberSearch(!wrap.contains(event.relatedTarget));
      });
      if (control.localName === "input") {
        control.addEventListener("blur", (event) =>
          rememberSearch(!wrap.contains(event.relatedTarget)),
        );
      }
      control.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) {
          event.preventDefault();
          applySearch();
          rememberSearch();
        }
      });
    },
  );
  const recent = node("div", "qap-recent-searches");
  recent.setAttribute("role", "group");
  l10n.attribute(recent, "aria-label", t(`${labels}.recent_searches_label`));
  let lastSavedSearch = view.search.trim();
  function rememberSearch(refreshRecent = true) {
    if (!canSaveHistory()) return;
    const term = view.search.trim();
    if (!term || term === lastSavedSearch) return;
    lastSavedSearch = term;
    view.history = normalizeStatesSearchHistory([term, ...view.history]);
    saveHistory(kind, view);
    if (refreshRecent) updateRecentSearches();
  }
  function updateRecentSearches() {
    replaceLocalizedChildren(recent);
    recent.hidden = view.history.length === 0;
    if (recent.hidden) return;
    const heading = node("div", "qap-recent-searches-head");
    heading.append(
      node("span", "", t("common.recent_searches")),
      button(
        t("common.clear"),
        () => {
          view.history = [];
          lastSavedSearch = view.search.trim();
          saveHistory(kind, view);
          updateRecentSearches();
          searchInput.focus();
        },
        "qap-linkish qap-clear-searches",
      ),
    );
    const chips = node("div", "qap-recent-searches-list");
    for (const term of view.history) {
      const chip = chipButton(
        term,
        () => {
          // Focus can sync HA's inner input; apply the selected text afterward.
          searchInput.focus();
          view.search = searchInput.value = term;
          lastSavedSearch = "";
          rememberSearch();
          applySearch();
        },
        "qap-recent-search",
      );
      l10n.property(chip, "title", term);
      chips.append(chip);
    }
    recent.append(heading, chips);
  }
  const filters = node("div", "qap-tabs qap-state-tabs");
  filters.setAttribute("role", "group");
  l10n.attribute(filters, "aria-label", t(`${labels}.filters`));
  const count = node("div", "qap-count");
  const list = node("div", "qap-state-list");
  list.setAttribute("role", "list");
  l10n.attribute(list, "aria-label", t(`${labels}.title`));
  function updateFilters() {
    const definitions = getFilters()[kind];
    if (
      view.filter !== "temporary" &&
      !definitions.some(
        (filter) =>
          filter.id === view.filter && (!filter.hidden || view.shortcutFilter === filter.id),
      )
    )
      view.filter = "all";
    if (view.shortcutFilter !== view.filter) view.shortcutFilter = null;
    if (view.filter === "temporary" && !view.temporary) view.filter = "all";
    const available = [
      ...definitions.filter(
        (filter) =>
          !filter.hidden || (filter.id === view.filter && view.shortcutFilter === filter.id),
      ),
      ...(view.temporary ? [view.temporary] : []),
    ];
    const signature = JSON.stringify(available.map(({ id, name }) => [id, name]));
    if (filters.dataset.definitions !== signature) {
      filters.dataset.definitions = signature;
      replaceLocalizedChildren(filters);
      for (const filter of available) {
        const chip = tabButton(
          filter.id,
          filter.id === "temporary" ? t("filters.temporary") : filterLabel(filter, kind, t),
          () => {
            view.filter = filter.id;
            view.shortcutFilter = null;
            updateFilters();
            applySearch();
            updateRecentSearches();
          },
          "qap-state-tab",
        );
        chip.dataset.domain = filter.id;
        filters.append(chip);
      }
    }
    for (const b of filters.children) {
      setTabActive(b, b.dataset.domain === view.filter);
    }
  }
  const topline = node("div", "qap-section-line");
  topline.append(node("span", "", t(`${labels}.current_states`)), count);
  const registryStatus = node("div", "qap-registry-status");
  registryStatus.setAttribute("role", "status");
  registryStatus.hidden = true;
  wrap.append(search, recent, filters, topline, registryStatus, list);
  const filterHost = node("section", "qap-filter-panel qap-state-modal-body");
  const filterPreviewRows = new WeakMap();
  filterHost.hidden = true;
  let editor = null;
  if (forms && profileUi) {
    editor = createFilterEditor({
      kind,
      view,
      host: filterHost,
      parentDialog,
      l10n,
      ui,
      forms,
      profileUi,
      getFilters,
      getProfiles,
      saveFilters,
      getLinkedShortcuts,
      getValueContext: (field, scope) => {
        if (field === "device_class") {
          if (devices) startStateSource();
        } else ensureFilterRegistries();
        if (field === "label") deviceRegistries.requireLabels();
        if (scope === "states" && (field === "hidden_by" || field === "id"))
          deviceRegistries.requireEntityMetadata();
        deviceRegistries?.refresh();
        return {
          ...filterContext(),
          states: currentEntityStates,
          labels: deviceRegistries?.labels || getHass()?.labels || EMPTY_REGISTRY,
          revision: deviceRegistries?.revision,
          registryStatus: deviceRegistries?.registryStatus,
        };
      },
      apply: (id) => {
        if (id) {
          view.filter = id;
          view.shortcutFilter = null;
        }
        updateFilters();
        applySearch();
      },
      preview: previewCount,
      renderMatches: renderFilterMatches,
      changed: navigationChanged,
    });
  }
  body.append(wrap);
  if (devices)
    deviceRegistries = createDeviceRegistrySource({
      getHass,
      getHaRoot,
      isEnabled,
      contextTarget,
      onChange: () => scheduleStateUpdate(records(), true),
    });
  updateRecentSearches();
  updateFilters();
  // Reuse rows by entity_id so state updates preserve focus and native badges.
  const rowsById = new Map();
  const knownStates = new Map();
  const matchingIds = new Set();
  const matchingEntities = new Map();
  const entityStates = new Map();
  let currentEntityStates = getHass()?.states || {};
  let indexRegistry = null;
  let indexRegistryRevision = null;
  let relationships = entityDeviceIndex();
  let compiled = null;
  let compiledKey = "";
  let compiledContext = [];
  let activeFilter = view.filter;
  let previewCache = null;
  const extraHeights = new Map();
  let rowOffsets = null;
  let explanationLayoutGeneration = 0;
  let renderedStates = {};
  let searchNames = new WeakMap();
  let nameContext = [];
  let updateTimer = null;
  let pendingStates = null;
  let refilterPending = false;
  let entitySource = null;
  let nativeStates = false;
  let emptyRow = null;
  let matches = [];
  let indexById = new Map();
  let rowHeight = 0;
  let rowGap = 0;
  let listOffset = 0;
  let viewportHeight = 0;
  let bottomPadding = 0;
  let frame = null;
  let layoutDirty = true;
  let measuredRow = null;
  let pendingScroll = view.scrollTop;
  // Set when pendingScroll keeps a row in place after the matching rows change.
  let membershipScroll = false;
  // The end of the list from the previous render, to keep following it while rows are measured.
  let lastMaxScroll = 0;
  const resizeObserver = new ResizeObserver((entries) => {
    // Observing a replacement sample sends an initial notification even when
    // its dimensions are unchanged. Do not render a second time for each scroll.
    if (
      entries.some(
        (entry) =>
          entry.target !== measuredRow || entry.borderBoxSize?.[0]?.blockSize !== rowHeight,
      )
    )
      scheduleRows(true);
  });
  resizeObserver.observe(body);
  // This includes history wrapping, delayed native controls and theme/font changes.
  resizeObserver.observe(wrap);
  body.addEventListener("scroll", onScroll, { passive: true });
  body.addEventListener("focusout", onFocusOut);
  window.addEventListener("resize", onResize);
  const dispose = () => {
    view.scrollTop = body.scrollTop;
    disposed = true;
    editor?.dispose();
    deviceRegistries?.dispose();
    deviceRegistries = null;
    clearTimeout(searchTimer);
    clearTimeout(updateTimer);
    entitySource?.dispose();
    if (frame !== null) cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    body.removeEventListener("scroll", onScroll);
    body.removeEventListener("focusout", onFocusOut);
    window.removeEventListener("resize", onResize);
    rowsById.clear();
    knownStates.clear();
    matchingIds.clear();
    matchingEntities.clear();
    entityStates.clear();
    extraHeights.clear();
    renderedStates = {};
    pendingStates = null;
    searchNames = new WeakMap();
    matches = [];
    indexById.clear();
    measuredRow = null;
  };
  updateList();
  const refresh = () => {
    updateFilters();
    updateList();
  };
  // Reuse the existing device fallback timer for state-dependent device filters.
  // Entities without HA's states provider retain their list polling fallback.
  if (devices) {
    statesRefresh = setInterval(() => {
      deviceRegistries.poll();
      if (
        entitySource &&
        !nativeStates &&
        (compiled?.usesEntities || previewCache?.compiled.usesEntities || editor?.active)
      ) {
        currentEntityStates = getHass()?.states || EMPTY_REGISTRY;
        updateList(true);
      }
    }, STATES_FALLBACK_POLL_MS);
    deviceRegistries.start();
  }
  // Share the existing HA states provider, including for cross-registry device
  // filters; no backend state subscription or new polling source is introduced.
  if (!devices) startStateSource();
  function startStateSource() {
    if (entitySource) return;
    entitySource = createEntityStatesSource({
      getHaRoot,
      contextTarget: wrap,
      poll: () => {
        currentEntityStates = getHass()?.states || EMPTY_REGISTRY;
        updateList();
      },
      pollInterval: devices ? null : STATES_FALLBACK_POLL_MS,
      onStates: (states) => {
        nativeStates = true;
        currentEntityStates = states;
        if (
          devices
            ? compiled?.usesEntities || previewCache?.compiled.usesEntities || editor?.active
            : states !== renderedStates
        ) {
          scheduleStateUpdate(devices ? records() : states);
        }
      },
    });
    entitySource.start();
  }
  // Naming also depends on registries and locale, which can change without
  // a state update. HA context notifications and the compatibility fallback
  // check these references without rebuilding an unchanged list.
  const refreshContext = () => {
    if (devices) deviceRegistries?.refresh();
    else deviceRegistries?.poll();
    if (getNameContext().some((value, index) => value !== nameContext[index])) {
      scheduleStateUpdate(pendingStates || records(), true);
    }
  };

  function getNameContext() {
    const hass = getHass();
    return [
      hass?.language,
      JSON.stringify(hass?.locale),
      hass?.formatEntityName,
      hass?.formatEntityState,
      hass?.localize,
      hass?.entities,
      hass?.devices,
      hass?.areas,
      hass?.labels,
      deviceRegistries?.devices,
      deviceRegistries?.areas,
      deviceRegistries?.entities,
      deviceRegistries?.status,
      deviceRegistries?.revision,
    ];
  }

  function ensureFilterRegistries() {
    if (devices) startStateSource();
    if (!deviceRegistries) {
      deviceRegistries = createDeviceRegistrySource({
        getHass,
        getHaRoot,
        isEnabled,
        contextTarget,
        includeEntities: true,
        onChange: () => scheduleStateUpdate(records(), true),
      });
      deviceRegistries.start();
    } else deviceRegistries.requireEntities();
  }
  function filterContext() {
    const hass = getHass();
    const entities = deviceRegistries?.entities || hass?.entities || EMPTY_REGISTRY;
    if (entities !== indexRegistry || deviceRegistries?.entityRevision !== indexRegistryRevision) {
      indexRegistry = entities;
      indexRegistryRevision = deviceRegistries?.entityRevision;
      relationships = entityDeviceIndex(entities);
    }
    return {
      hass,
      entities,
      devices: deviceRegistries?.devices || hass?.devices || EMPTY_REGISTRY,
      areas: deviceRegistries?.areas || hass?.areas || EMPTY_REGISTRY,
      ...relationships,
    };
  }
  function prepareFilter() {
    const definition =
      view.filter === "temporary"
        ? view.temporary
        : getFilters()[kind].find((item) => item.id === view.filter);
    if (definition?.condition) prepareConditionRegistries(definition.condition);
    const context = filterContext();
    const key = JSON.stringify([view.filter, definition?.condition]);
    const references = [
      context.entities,
      context.devices,
      context.areas,
      getHass()?.labels,
      getHass()?.language,
      getHass()?.formatEntityName,
      getHass()?.localize,
      getHass()?.locale,
      deviceRegistries?.revision,
    ];
    const changed =
      key !== compiledKey || references.some((value, index) => value !== compiledContext[index]);
    if (changed) {
      compiledKey = key;
      compiledContext = references;
      compiled = definition?.condition ? compileFilter(definition.condition, kind, context) : null;
      previewCache = null;
    }
    if (activeFilter !== view.filter) {
      activeFilter = view.filter;
      extraHeights.clear();
      rowOffsets = null;
      for (const entry of rowsById.values()) {
        entry.expanded = false;
        if (entry.explanation) {
          replaceLocalizedChildren(entry.explanation);
          delete entry.explanation.dataset.signature;
        }
      }
    }
    return changed;
  }
  function previewCount(condition) {
    prepareConditionRegistries(condition);
    const context = filterContext();
    const key = JSON.stringify(condition);
    if (!previewCache || previewCache.key !== key)
      previewCache = { key, compiled: compileFilter(condition, kind, context), results: new Map() };
    for (const record of Object.values(devices ? records() : renderedStates)) {
      const id = recordId(record);
      if (!previewCache.results.has(id))
        previewCache.results.set(
          id,
          previewCache.compiled.evaluate(record, currentEntityStates).match,
        );
    }
    return [...previewCache.results.values()].filter(Boolean).length;
  }

  function renderFilterMatches(container, condition) {
    previewCount(condition);
    const source = devices ? records() : renderedStates;
    const matching = [...previewCache.results]
      .filter(([id, match]) => match && source[id])
      .map(([id]) => id)
      .sort();
    const signature = JSON.stringify([condition, matching]);
    if (container.dataset.signature !== signature) container.dataset.page = "0";
    container.dataset.signature = signature;
    const page = Math.min(
      Number(container.dataset.page || 0),
      Math.max(0, Math.ceil(matching.length / FILTER_PREVIEW_PAGE_SIZE) - 1),
    );
    container.dataset.page = String(page);
    const visible = matching.slice(
      page * FILTER_PREVIEW_PAGE_SIZE,
      (page + 1) * FILTER_PREVIEW_PAGE_SIZE,
    );
    const previous = filterPreviewRows.get(container);
    const pageKey = JSON.stringify([page, matching]);
    // State updates refresh existing rows; keyboard focus and details triggers survive.
    if (previous?.key === pageKey) {
      for (const [id, entry] of previous.rows) updateStateRow(entry, source[id]);
      return;
    }
    const retainedFocus = container.contains(ui.focusedElement());
    replaceLocalizedChildren(container);
    const list = node("div", "qap-state-list");
    list.setAttribute("role", "list");
    l10n.attribute(list, "aria-label", t(`filters.preview_${kind}`, { count: matching.length }));
    const rows = new Map();
    for (const id of visible) {
      const entry = createStateRow(source[id], true);
      updateStateRow(entry, source[id]);
      list.append(entry.row);
      rows.set(id, entry);
    }
    filterPreviewRows.set(container, { key: pageKey, rows });
    container.append(list);
    if (!matching.length) container.append(node("p", "qap-muted", t(`${labels}.no_matches`)));
    const pages = node("div", "qap-filter-option-pages");
    const changePage = (offset) => {
      container.dataset.page = String(page + offset);
      renderFilterMatches(container, condition);
      ui.focusWhenReady(container.querySelector("button, qap-button"));
    };
    if (page > 0)
      pages.append(button(t("filters.previous_values"), () => changePage(-1), "qap-linkish"));
    if ((page + 1) * FILTER_PREVIEW_PAGE_SIZE < matching.length)
      pages.append(button(t("filters.next_values"), () => changePage(1), "qap-linkish"));
    container.append(pages);
    if (retainedFocus) ui.focusWhenReady(container.querySelector("button, qap-button"));
  }

  function prepareConditionRegistries(condition) {
    const needsRegistries = (item) =>
      item.type === "entities" ||
      (item.type === "group"
        ? item.conditions.some(needsRegistries)
        : !["id", "name", "domain", "state", "attribute", "device_class", "smart"].includes(
            item.field,
          ));
    const needsMetadata = (item, scope) => {
      if (item.type === "entities") return needsMetadata(item.condition, "states");
      if (item.type === "group")
        return item.conditions.some((child) => needsMetadata(child, scope));
      return scope === "states" && item.field === "hidden_by";
    };
    if (needsRegistries(condition)) ensureFilterRegistries();
    if (needsMetadata(condition, kind)) deviceRegistries.requireEntityMetadata();
  }

  function scheduleStateUpdate(states, refilter = false) {
    pendingStates = states;
    refilterPending ||= refilter;
    if (updateTimer !== null) return;
    updateTimer = setTimeout(() => {
      updateTimer = null;
      if (disposed) return;
      const nextStates = pendingStates;
      const incremental = !refilterPending;
      pendingStates = null;
      refilterPending = false;
      updateList(incremental, nextStates);
    }, STATES_UPDATE_BATCH_MS);
  }

  function onScroll() {
    scheduleRows();
  }
  function onResize() {
    scheduleRows(true);
  }
  function onFocusOut() {
    scheduleRows();
  }
  function scheduleRows(measure = false) {
    if (disposed) return;
    layoutDirty ||= measure;
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (disposed) return;
      if (layoutDirty) measureLayout();
      renderRows();
    });
  }

  function rowOffset(index) {
    const stride = rowHeight + rowGap;
    if (extraHeights.size && !rowOffsets) {
      let offset = 0;
      rowOffsets = matches.map((id) => {
        const top = offset;
        offset += stride + (extraHeights.get(id) || 0);
        return top;
      });
    }
    return rowOffsets?.[index] ?? index * stride;
  }
  function rowIndex(offset) {
    if (!extraHeights.size) return Math.floor(offset / (rowHeight + rowGap));
    let low = 0,
      high = matches.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (rowOffset(mid) <= offset) low = mid + 1;
      else high = mid;
    }
    return Math.max(0, low - 1);
  }

  function measureLayout() {
    explanationLayoutGeneration++;
    // Measure the shared summary separately from optional matching-entity details.
    const sample = rowsById.values().next().value?.row;
    const height = sample
      ? sample.getBoundingClientRect().height - (extraHeights.get(sample.dataset.id) || 0)
      : 0;
    const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    const offset =
      list.getBoundingClientRect().top -
      body.getBoundingClientRect().top +
      body.scrollTop -
      body.clientTop;
    const oldStride = rowHeight + rowGap;
    const anchorIndex = oldStride > 0 ? Math.max(0, rowIndex(body.scrollTop - listOffset)) : 0;
    const anchorFraction =
      oldStride > 0
        ? Math.max(0, body.scrollTop - listOffset - rowOffset(anchorIndex)) /
          (oldStride + (extraHeights.get(matches[anchorIndex]) || 0))
        : 0;
    if (height > 0) rowHeight = height;
    rowGap = gap;
    if (oldStride !== rowHeight + rowGap) rowOffsets = null;
    listOffset = offset;
    viewportHeight = body.clientHeight;
    bottomPadding = parseFloat(getComputedStyle(wrap).paddingBottom) || 0;
    // Keep the same entity at the viewport edge when fonts/zoom change height.
    if ((anchorIndex > 0 || anchorFraction > 0) && height > 0 && oldStride !== rowHeight + rowGap) {
      pendingScroll =
        listOffset +
        rowOffset(anchorIndex) +
        anchorFraction * (rowHeight + rowGap + (extraHeights.get(matches[anchorIndex]) || 0));
    }
    layoutDirty = false;
  }

  function renderRows() {
    if (disposed) return;
    const stride = rowHeight + rowGap;
    // Read before changing the list height: rows near the end can turn out taller once
    // measured, and a user who scrolled to the end should still see the last row. Unmeasured
    // rows can overflow the list, so the browser's end and the list's own end may differ.
    const stayAtEnd =
      rowHeight > 0 &&
      !membershipScroll &&
      body.scrollTop > 0 &&
      ((lastMaxScroll > 0 && body.scrollTop >= lastMaxScroll - 1) ||
        body.scrollTop >= body.scrollHeight - body.clientHeight - 1);
    const totalHeight = matches.length
      ? rowOffset(matches.length - 1) + stride + (extraHeights.get(matches.at(-1)) || 0) - rowGap
      : 0;
    const height = matches.length && rowHeight ? `${totalHeight}px` : "";
    if (list.style.height !== height) list.style.height = height;
    list.classList.toggle("qap-state-list-virtual", matches.length > 0);
    if (pendingScroll !== null && rowHeight) {
      body.scrollTop = pendingScroll;
      pendingScroll = null;
    }
    membershipScroll = false;
    // A membership change may shorten the list while the body is far down it.
    const maxScroll = Math.max(0, listOffset + totalHeight + bottomPadding - viewportHeight);
    if (rowHeight && (stayAtEnd || body.scrollTop > maxScroll)) body.scrollTop = maxScroll;
    lastMaxScroll = rowHeight ? maxScroll : 0;
    const start = rowHeight
      ? clamp(
          rowIndex(body.scrollTop - listOffset) - STATES_OVERSCAN,
          0,
          Math.max(0, matches.length - 1),
        )
      : 0;
    const end = rowHeight
      ? clamp(
          rowIndex(body.scrollTop + viewportHeight - listOffset) + 1 + STATES_OVERSCAN,
          start + 1,
          matches.length,
        )
      : Math.min(1, matches.length);
    const indices = new Set();
    for (let index = start; index < end; index++) indices.add(index);
    // Keep at most one extra row for native focus or the details return target.
    const focused = [...rowsById.values()].find((entry) =>
      entry.row.contains(document.activeElement),
    );
    const retainedId = detailsRowId() || focused?.row.dataset.id;
    const retainedIndex = indexById.get(retainedId);
    if (retainedIndex !== undefined) indices.add(retainedIndex);
    const ordered = [...indices].sort((a, b) => a - b);
    const wantedIds = new Set(ordered.map((index) => matches[index]));
    for (const [id, entry] of rowsById) {
      if (wantedIds.has(id)) continue;
      if (entry.row.contains(document.activeElement)) searchInput.focus({ preventScroll: true });
      removeLocalizedElement(entry.row);
      rowsById.delete(id);
      if (extraHeights.delete(id)) {
        rowOffsets = null;
        scheduleRows();
      }
    }
    for (let position = 0; position < ordered.length; position++) {
      const index = ordered[position];
      const state = renderedStates[matches[index]] || knownStates.get(matches[index]);
      let entry = rowsById.get(recordId(state));
      if (!entry) {
        entry = createStateRow(state);
        rowsById.set(recordId(state), entry);
      }
      updateStateRow(entry, state);
      if (devices) updateExplanation(entry, recordId(state));
      const top = `${rowOffset(index)}px`;
      if (entry.row.style.top !== top) entry.row.style.top = top;
      if (entry.index !== index) entry.row.setAttribute("aria-posinset", String(index + 1));
      if (entry.total !== matches.length)
        entry.row.setAttribute("aria-setsize", String(matches.length));
      entry.index = index;
      entry.total = matches.length;
      if (list.children[position] !== entry.row)
        list.insertBefore(entry.row, list.children[position] || null);
    }
    const sample = rowsById.values().next().value?.row;
    if (sample !== measuredRow) {
      if (measuredRow) resizeObserver.unobserve(measuredRow);
      measuredRow = sample;
      if (sample) resizeObserver.observe(sample);
    }
    if (details.active) {
      const previewRow = [...filterHost.querySelectorAll(".qap-state-row")].find(
        (row) => row.dataset.id === details.active.dataset.id,
      );
      details.returnFocus = editor?.active
        ? previewRow?.querySelector(".qap-state-summary") ||
          filterHost.querySelector(".qap-filter-preview-action")
        : detailsTrigger(details.active.dataset.id, details.active.dataset.kind) || searchInput;
    }
  }

  function lastRowControl(entry) {
    const matchingRows = entry.explanation?.children;
    if (!entry.explanation?.hidden && matchingRows?.length)
      return matchingRows[matchingRows.length - 1].querySelector(".qap-state-summary");
    return entry.explain && !entry.explain.hidden && !entry.explain.disabled
      ? entry.explain
      : entry.summary;
  }

  function createStateRow(state, preview = false, rowKind = kind) {
    const rowDevices = rowKind === "devices";
    const rowLabels = rowDevices ? "devices" : "entities";
    const id = rowDevices ? state.id : state.entity_id;
    const row = node("div", "qap-state-row");
    row.dataset.id = id;
    if (rowDevices) row.dataset.device = id;
    else row.dataset.entity = id;
    row.setAttribute("role", "listitem");
    const summary = node("button", "qap-state-summary");
    summary.type = "button";
    l10n.attribute(summary, "aria-label", t(`${rowLabels}.view_details`, { id }));
    summary.addEventListener("click", () => {
      if (!preview) {
        rememberSearch();
        updateRecentSearches();
      }
      openDetails(id, summary, rowKind);
    });
    const info = node("span", "qap-state-info");
    const name = node("span", "qap-state-name");
    const entityId = node("small", "qap-state-id", id);
    info.append(name, entityId);
    const stateIcon = rowDevices ? deviceIcon(state) : entityIcon(state);
    const value = node("span", "qap-state-value");
    summary.append(stateIcon, info, value, icon("mdi:chevron-right", "qap-expand-icon"));
    row.append(summary);
    const entry = {
      row,
      summary,
      name,
      entityId,
      value,
      stateIcon,
      lastName: null,
      lastValue: null,
      expanded: false,
    };
    if (devices && !preview) {
      entry.explanation = node("div", "qap-state-list qap-matching-entities");
      entry.explanation.setAttribute("role", "list");
      l10n.attribute(entry.explanation, "aria-label", t("entities.title"));
      entry.explanation.id = `qap-matches-${id}`;
      entry.explain = button(
        "",
        () => {
          entry.expanded = !entry.expanded;
          updateExplanation(entry, id);
          renderRows();
        },
        "qap-linkish qap-matching-count",
      );
      entry.explain.setAttribute("aria-controls", entry.explanation.id);
      row.append(entry.explain, entry.explanation);
    }
    if (!preview) {
      entry.onTab = (event) => {
        if (
          event.key !== "Tab" ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.defaultPrevented
        )
          return;
        // Let the browser move within a row and between adjacent mounted rows.
        if (event.currentTarget !== (event.shiftKey ? summary : lastRowControl(entry))) return;
        const currentIndex = indexById.get(id);
        if (currentIndex === undefined) return;
        const index = currentIndex + (event.shiftKey ? -1 : 1);
        if (index < 0 || index >= matches.length || rowsById.has(matches[index])) return;
        event.preventDefault();
        const top = listOffset + rowOffset(index);
        if (top < body.scrollTop) body.scrollTop = top;
        else if (top + rowHeight > body.scrollTop + viewportHeight)
          body.scrollTop = top + rowHeight - viewportHeight;
        renderRows();
        const target = rowsById.get(matches[index]);
        if (target)
          (event.shiftKey ? lastRowControl(target) : target.summary).focus({ preventScroll: true });
        scheduleRows();
      };
      summary.addEventListener("keydown", entry.onTab);
      entry.explain?.addEventListener("keydown", entry.onTab);
    }
    return entry;
  }

  function updateExplanation(entry, id) {
    const ids = matchingEntities.get(id) || new Set();
    entry.explain.hidden = !compiled?.usesEntities;
    entry.explain.disabled = !ids.size;
    entry.explain.setAttribute("aria-expanded", String(entry.expanded));
    const countLabel = t("filters.matching_entities", { count: ids.size });
    l10n.text(entry.explain, countLabel);
    entry.explanation.hidden = !entry.expanded || entry.explain.hidden;
    let contentChanged = false;
    if (entry.explanation.hidden) {
      if (entry.explanation.children.length) replaceLocalizedChildren(entry.explanation);
      delete entry.explanation.dataset.signature;
    } else {
      const signature = JSON.stringify(
        [...ids].map((entityId) => [
          entityId,
          currentEntityStates[entityId]?.state,
          currentEntityStates[entityId]?.attributes,
        ]),
      );
      if (entry.explanation.dataset.signature !== signature) {
        contentChanged = true;
        entry.explanation.dataset.signature = signature;
        replaceLocalizedChildren(entry.explanation);
        for (const entityId of ids) {
          const state = currentEntityStates[entityId];
          if (!state) continue;
          const matching = createStateRow(state, true, "states");
          matching.row.classList.add("qap-matching-entity");
          matching.summary.addEventListener("keydown", entry.onTab);
          updateEntityRow(matching, state);
          // Render only attributes referenced by the condition, not the full state.
          const attributes = new Set();
          const collect = (item) => {
            if (item.type === "group") item.conditions.forEach(collect);
            else if (item.type === "entities") collect(item.condition);
            else if (item.field === "attribute") attributes.add(item.attribute);
          };
          const definition =
            view.filter === "temporary"
              ? view.temporary
              : getFilters()[kind].find((item) => item.id === view.filter);
          if (definition?.condition) collect(definition.condition);
          for (const attribute of attributes)
            matching.name.parentElement.append(
              node(
                "small",
                "qap-matching-attribute",
                `${attribute}: ${JSON.stringify(state?.attributes?.[attribute]) ?? "—"}`,
              ),
            );
          entry.explanation.append(matching.row);
        }
      }
    }
    // Newly mounted counts are measured next frame. Stable collapsed rows do
    // no layout reads on scroll; resize and expansion invalidate this cache.
    if (entry.explain.hidden) {
      if (extraHeights.delete(id)) {
        rowOffsets = null;
        scheduleRows();
      }
      return;
    }
    if (!entry.row.isConnected) {
      scheduleRows();
      return;
    }
    const measurementKey = `${explanationLayoutGeneration}:${entry.explain.hidden}:${entry.expanded}:${String(countLabel)}`;
    if (entry.measurementKey === measurementKey && !contentChanged) return;
    entry.measurementKey = measurementKey;
    const extra =
      (entry.explain.hidden ? 0 : entry.explain.getBoundingClientRect().height) +
      (entry.explanation.hidden ? 0 : entry.explanation.getBoundingClientRect().height);
    if ((extraHeights.get(id) || 0) !== extra) {
      if (extra) extraHeights.set(id, extra);
      else extraHeights.delete(id);
      rowOffsets = null;
      scheduleRows();
    }
  }

  function updateList(incremental = false, nextStates = records()) {
    if (prepareFilter()) incremental = false;
    const affectedDevices = new Set();
    if (devices && (compiled?.usesEntities || previewCache?.compiled.usesEntities)) {
      for (const [id, state] of Object.entries(currentEntityStates)) {
        if (entityStates.get(id) !== state) {
          affectedDevices.add(relationships.entityDeviceIds.get(id));
          entityStates.set(id, state);
        }
      }
      for (const id of entityStates.keys())
        if (!currentEntityStates[id]) {
          affectedDevices.add(relationships.entityDeviceIds.get(id));
          entityStates.delete(id);
        }
    }
    if (devices) {
      const failed = deviceRegistries.status === "load_failed";
      registryStatus.hidden = !failed;
      l10n.text(registryStatus, failed ? t("devices.load_failed") : "");
    }
    const anchorIndex = rowHeight ? Math.max(0, rowIndex(body.scrollTop - listOffset)) : 0;
    const anchorId = matches[anchorIndex];
    const anchorOffset = rowHeight ? body.scrollTop - listOffset - rowOffset(anchorIndex) : 0;
    // HA names can change with translations or registry updates even when the
    // state object stays the same. Cache only within that naming context.
    const nextNameContext = getNameContext();
    if (nextNameContext.some((value, index) => value !== nameContext[index])) {
      searchNames = new WeakMap();
      nameContext = nextNameContext;
      incremental = false;
      previewCache = null;
    }
    renderedStates = nextStates;
    let membershipChanged = false;
    let visibleChanged = !incremental;
    let detailsChanged = !incremental || affectedDevices.has(detailsRowId());
    const searchTerm = appliedSearch.trim().toLocaleLowerCase();
    const matchesFilter = (state) => {
      if (compiled) {
        const result = compiled.evaluate(state, currentEntityStates);
        if (devices) matchingEntities.set(recordId(state), result.entities);
        if (!result.match) return false;
      }
      const searchView = compiled ? { ...view, filter: "all" } : view;
      if (devices) return deviceMatches(state, searchView, searchTerm, deviceRegistries);
      return entityMatches(state, searchView, searchTerm, searchNames, getHass());
    };
    // HA replaces changed state objects. Comparing references is cheap; only
    // those entities need filtering/formatting, even with thousands of states.
    for (const state of Object.values(nextStates)) {
      const id = recordId(state);
      if (incremental && knownStates.get(id) === state && !affectedDevices.has(id)) continue;
      previewCache?.results.delete(id);
      knownStates.set(id, state);
      const included = matchesFilter(state);
      membershipChanged ||= matchingIds.has(id) !== included;
      if (included) matchingIds.add(id);
      else matchingIds.delete(id);
      visibleChanged ||= rowsById.has(id);
      detailsChanged ||= details.active?.dataset.id === id;
    }
    for (const id of knownStates.keys()) {
      if (nextStates[id]) continue;
      knownStates.delete(id);
      matchingEntities.delete(id);
      previewCache?.results.delete(id);
      membershipChanged = matchingIds.delete(id) || membershipChanged;
      detailsChanged ||= details.active?.dataset.id === id;
    }
    if (membershipChanged || (devices && visibleChanged)) {
      rowOffsets = null;
      matches = [...matchingIds].sort((a, b) =>
        devices
          ? getDeviceName(nextStates[a]).localeCompare(getDeviceName(nextStates[b])) ||
            a.localeCompare(b)
          : a.localeCompare(b),
      );
      indexById = new Map(matches.map((id, index) => [id, index]));
    }
    if (membershipChanged && body.scrollTop > listOffset && indexById.has(anchorId)) {
      pendingScroll = listOffset + rowOffset(indexById.get(anchorId)) + anchorOffset;
      membershipScroll = true;
    }
    if (detailsChanged && details.active) details.update();
    editor?.refreshPreview();
    if (incremental && !membershipChanged && !visibleChanged) return;
    const label = t(`${labels}.count`, { count: matches.length });
    if (count.textContent !== label) l10n.text(count, label);
    if (matches.length || (devices && deviceRegistries.status === "loading")) {
      removeLocalizedElement(emptyRow);
      emptyRow = null;
    }
    renderRows();
    if (!rowHeight && matches.length) {
      measureLayout();
      renderRows();
    }
    if (emptyRow)
      l10n.text(
        emptyRow.querySelector("strong"),
        t(
          devices && deviceRegistries.status
            ? `devices.${deviceRegistries.status}`
            : `${labels}.no_matches`,
        ),
      );
    if (!matches.length && !emptyRow && (!devices || deviceRegistries.status !== "loading")) {
      emptyRow = node("div", "qap-empty qap-state-empty");
      emptyRow.append(
        icon("mdi:magnify"),
        node(
          "strong",
          "",
          t(
            devices && deviceRegistries.status
              ? `devices.${deviceRegistries.status}`
              : `${labels}.no_matches`,
          ),
        ),
      );
      list.append(emptyRow);
    }
  }

  function detailsRowId() {
    if (!details.active) return undefined;
    return devices && details.active.dataset.kind === "states"
      ? relationships.entityDeviceIds.get(details.active.dataset.id)
      : details.active.dataset.id;
  }

  function detailsTrigger(id, detailsKind) {
    if (devices && detailsKind === "states") {
      const entry = rowsById.get(relationships.entityDeviceIds.get(id));
      return (
        [...(entry?.explanation.children || [])]
          .find((row) => row.dataset.entity === id)
          ?.querySelector(".qap-state-summary") || entry?.summary
      );
    }
    return rowsById.get(id)?.summary;
  }

  function openDetails(id, trigger, detailsKind = kind) {
    if (disposed) return;
    details.open(
      id,
      trigger || detailsTrigger(id, detailsKind) || searchInput,
      () => {
        if (view.filter === "favorites" && !view.favorites.size) view.filter = "all";
        updateFilters();
        updateList();
      },
      detailsKind,
    );
  }

  return {
    dispose() {
      if (disposed) return;
      rememberSearch();
      clearInterval(statesRefresh);
      dispose();
    },
    refresh,
    refreshContext,
    openDetails,
    openFilters(mode, id) {
      ensureFilterRegistries();
      editor?.open(mode, id);
    },
    closeFilters() {
      editor?.close();
    },
    get filterNavigation() {
      return editor?.navigation;
    },
    openFilterReuse() {
      editor?.openReusePicker();
    },
    closeFilterReuse() {
      editor?.closeReusePicker();
    },
    get filterReuseNavigation() {
      return editor?.reuseNavigation;
    },
    get hasFilterEditor() {
      return editor?.active;
    },
    get source() {
      return deviceRegistries;
    },
  };
}
