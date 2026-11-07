import { getDeviceName } from "../devices/device-formatting.js";

let attributesViewerPromise;
// HA's "language" time format keeps the language's hour cycle; "system" uses
// the browser's and is resolved when formatting.
const HOUR12_BY_TIME_FORMAT = { 12: true, 24: false };

function loadAttributesViewer() {
  return (attributesViewerPromise ??= Promise.all([
    import("../ui/components/attributes-viewer.ts"),
    import("../utils/attributes.ts"),
  ])
    .then(([{ QapAttributesViewer }, { serializeAttributes }]) => {
      if (!customElements.get("qap-attributes-viewer"))
        customElements.define("qap-attributes-viewer", QapAttributesViewer);
      return serializeAttributes;
    })
    .catch((error) => {
      attributesViewerPromise = null;
      throw error;
    }));
}

export function createRegistryDialog({
  l10n,
  ui,
  getHass,
  getHaRoot,
  getRegistries,
  host,
  statesView,
  devicesView,
  formattedState,
  deviceAreaName,
  saveRegistryFavorites,
  showMutationError,
  clearStorageError,
  toast,
  clearToast,
  navigationChanged,
  restoreDetails,
}) {
  const t = l10n.message;
  const COPY_SUCCESS_MESSAGE = t("common.copied");
  let dateTimeFormat = { key: null, formatter: null };

  // Follow HA's profile settings rather than the browser's: its language, its
  // 12/24-hour preference, and whether times use the server's time zone.
  function dateTimeFormatter() {
    const hass = getHass();
    const locale = hass?.locale;
    const language = locale?.language || hass?.language || undefined;
    const timeZone = locale?.time_zone === "server" ? hass?.config?.time_zone : undefined;
    let hour12 = HOUR12_BY_TIME_FORMAT[locale?.time_format];
    if (locale?.time_format === "system") {
      hour12 = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12;
    }
    const key = JSON.stringify([language, timeZone, hour12]);
    if (dateTimeFormat.key === key) return dateTimeFormat.formatter;
    const options = { dateStyle: "medium", timeStyle: "medium", hour12 };
    let formatter;
    try {
      formatter = new Intl.DateTimeFormat(language, { ...options, timeZone });
    } catch {
      // An unsupported language tag or time zone must not hide the timestamps.
      formatter = new Intl.DateTimeFormat(undefined, options);
    }
    dateTimeFormat = { key, formatter };
    return formatter;
  }
  const {
    node,
    iconButton,
    button,
    errorMessage,
    setIconButtonLabel,
    focusWhenReady,
    removeLocalizedElement,
    createDialogElement,
    showDialogElement,
    cleanupDialogElement,
  } = ui;
  let stateDialog = null;
  let stateDialogReturnFocus = null;
  let navigation = null;
  let serializeAttributes = null;
  function registryDetails(kind, id) {
    if (kind === "devices") {
      const record = (getRegistries()?.devices || getHass()?.devices)?.[id];
      return {
        record,
        name: record ? getDeviceName(record) : id,
        value: deviceAreaName(record),
        attributes: record || {},
      };
    }
    const record = getHass()?.states?.[id];
    return {
      record,
      name: record?.attributes?.friendly_name || id,
      value: formattedState(record, false),
      copyValue: record?.state,
      attributes: record?.attributes || {},
    };
  }

  function registryDetailRowValue(kind, id, field) {
    const details = registryDetails(kind, id);
    if (!field) return details.value;
    const value = details.record?.[field];
    const available = value != null && value !== "";
    if (!available) return t("common.unavailable");
    if (kind === "states") {
      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? t("common.unavailable")
        : dateTimeFormatter().format(date);
    }
    return value;
  }

  function finalizeStateDialog(active) {
    if (stateDialog !== active) return;
    clearToast(active);
    const returnFocus = stateDialogReturnFocus;
    stateDialog = null;
    navigation = null;
    navigationChanged();
    stateDialogReturnFocus = null;
    const restoreFocus = () => {
      if (!stateDialog && host.dialog && returnFocus?.isConnected)
        returnFocus.focus({ preventScroll: true });
    };
    const waitForClose = active.open;
    if (waitForClose) active.addEventListener("closed", restoreFocus, { once: true });
    if (active.open) cleanupDialogElement(active);
    else removeLocalizedElement(active);
    if (!waitForClose) restoreFocus();
  }

  function closeStateDialog() {
    if (!stateDialog) return;
    finalizeStateDialog(stateDialog);
  }

  function updateStateDialog() {
    if (!stateDialog) return;
    const entityId = stateDialog.dataset.id;
    const kind = stateDialog.dataset.kind;
    const details = registryDetails(kind, entityId);
    if (kind === "devices" && !details.record) {
      if (getRegistries()?.loaded) closeStateDialog();
      return;
    }
    const name = details.name;
    l10n.text(stateDialog.querySelector(".qap-state-dialog-name"), name);
    for (const row of stateDialog.querySelectorAll(".qap-state-dialog-state-line")) {
      l10n.text(row.querySelector(".qap-state-dialog-value"), () =>
        registryDetailRowValue(kind, entityId, row.dataset.field),
      );
      const copy = row.querySelector(".qap-state-dialog-state-copy");
      if (copy) copy.disabled = details.copyValue == null;
    }
    if (serializeAttributes) {
      const viewer = stateDialog.querySelector("qap-attributes-viewer");
      let value;
      try {
        value = serializeAttributes(details.attributes);
      } catch {
        value = String(t("common.unavailable"));
      }
      if (viewer.value !== value) viewer.value = value;
    }
    const favorite = stateDialog.querySelector(".qap-state-dialog-favorite");
    const isFavorite = (kind === "devices" ? devicesView : statesView).favorites.has(entityId);
    const favoriteLabel = t(isFavorite ? "common.remove_favorite" : "common.add_favorite");
    favorite.setAttribute("aria-pressed", String(isFavorite));
    setIconButtonLabel(favorite, favoriteLabel);
    if (favorite.localName === "qap-icon-button") favorite.selected = isFavorite;
    favorite
      .querySelector("qap-icon")
      .setAttribute("icon", isFavorite ? "mdi:star" : "mdi:star-outline");
  }

  function showEntityMoreInfo(entityId) {
    const homeAssistant = getHaRoot();
    if (!homeAssistant) return;
    // HA opens More Info above Entity details, so returning restores this
    // exact dialog, including its scroll position.
    homeAssistant.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId },
      }),
    );
  }

  function openStateDialog(entityId, trigger, onFavoritesChanged, kind = "states") {
    const labels = kind === "devices" ? "devices" : "entities";
    const view = kind === "devices" ? devicesView : statesView;
    if (stateDialog || !host.dialog) return;
    const entity = registryDetails(kind, entityId).record;
    if (!entity) return;

    const modal = createDialogElement(t(`${labels}.details`));
    navigation = { key: `${kind}:${entityId}`, open: () => restoreDetails(entityId) };
    navigationChanged();
    modal.classList.add("qap-state-modal");
    modal.dataset.id = entityId;
    modal.dataset.kind = kind;
    if (kind === "devices") modal.dataset.device = entityId;
    else modal.dataset.entity = entityId;
    modal.setAttribute("aria-labelledby", "qap-state-dialog-title");
    const content = node("div", "qap-shell qap-state-modal-content");
    const status = node("div", "qap-profile-status");
    const note = errorMessage();
    status.append(note);

    const header = node("div", "qap-state-modal-head");
    const title = node("h2", "qap-title", t(`${labels}.details`));
    title.id = "qap-state-dialog-title";
    const favorite = iconButton(
      "mdi:star-outline",
      t("common.add_favorite"),
      async () => {
        const favorites = new Set(view.favorites);
        if (favorites.has(entityId)) favorites.delete(entityId);
        else favorites.add(entityId);
        favorite.disabled = true;
        l10n.text(note, "");
        delete note.dataset.quotaError;
        if (!(await saveRegistryFavorites(kind, [...favorites]))) {
          favorite.disabled = false;
          if (stateDialog === modal) showMutationError(note);
          return;
        }
        favorite.disabled = false;
        if (stateDialog !== modal) return;
        clearStorageError();
        updateStateDialog();
        onFavoritesChanged();
      },
      "qap-state-dialog-favorite",
    );
    const back = iconButton("mdi:arrow-left", t("common.back"), closeStateDialog);
    header.append(back, title, favorite);

    const body = node("div", "qap-state-modal-body");
    // Share the identity controls; devices show their name before the copied ID.
    const identity = node("div", "qap-state-dialog-identity");
    const idRow = node("div", "qap-state-dialog-identity-row");
    const copyEntityId = () => {
      void copyText(entityId);
    };
    idRow.append(
      iconButton(
        "mdi:content-copy",
        t(`${labels}.copy_id`),
        copyEntityId,
        "qap-state-dialog-id-copy",
      ),
    );
    const idLink = button(entityId, copyEntityId, "qap-state-dialog-id-link");
    l10n.property(idLink, "title", t(`${labels}.copy_id`));
    idRow.append(idLink);
    const nameRow = node("div", "qap-state-dialog-identity-row");
    nameRow.append(
      iconButton(
        "mdi:information-outline",
        t(`${labels}.more_info`),
        () => showEntityMoreInfo(entityId),
        "qap-state-dialog-info",
        kind === "devices" ? `/config/devices/device/${encodeURIComponent(entityId)}` : undefined,
      ),
    );
    nameRow.append(node("span", "qap-state-dialog-name"));
    if (kind === "devices") identity.append(nameRow, idRow);
    else identity.append(idRow, nameRow);

    const attributes = node("section", "qap-state-dialog-attributes");
    const detailFields =
      kind === "devices"
        ? ["", "manufacturer", "model", "sw_version"]
        : ["", "last_changed", "last_updated"];
    for (const field of detailFields) {
      const stateLine = node("div", "qap-state-dialog-state-line");
      stateLine.dataset.field = field;
      stateLine.append(
        node("span", "qap-state-dialog-state-label", t(`${labels}.${field || "state"}`)),
      );
      stateLine.append(node("span", "qap-state-dialog-value"));
      if (kind !== "devices" && !field) {
        stateLine.append(
          iconButton(
            "mdi:content-copy",
            t(`${labels}.copy_state`),
            () => {
              const value = registryDetails(kind, entityId).copyValue;
              if (value != null) void copyText(value);
            },
            "qap-state-dialog-state-copy",
          ),
        );
      }
      attributes.append(stateLine);
    }
    const editor = node("div", "qap-state-dialog-editor");
    const viewer = node("qap-attributes-viewer");
    l10n.property(viewer, "label", t(`${labels}.attributes_label`));
    l10n.property(viewer, "copyLabel", t("common.copy"));
    viewer.addEventListener("copy-request", (event) => {
      event.stopPropagation();
      if (stateDialog === modal && viewer.isConnected) void copyText(event.detail.value);
    });
    editor.append(viewer);
    attributes.append(
      node("h3", "qap-state-dialog-section-title", t(`${labels}.attributes`)),
      editor,
    );
    body.append(identity, attributes);

    content.append(header, status, body, node("div", "qap-feedback"));
    modal.append(content);
    stateDialog = modal;
    stateDialogReturnFocus = trigger;
    showDialogElement(modal, () => finalizeStateDialog(modal));
    updateStateDialog();
    focusWhenReady(back, () => stateDialog === modal && modal.open);
    void loadAttributesViewer().then(
      (serialize) => {
        if (stateDialog !== modal) return;
        serializeAttributes = serialize;
        updateStateDialog();
      },
      () => {
        if (stateDialog === modal) viewer.textContent = String(t("common.unavailable"));
      },
    );
  }
  // Async Clipboard requires a secure context and can be restricted by embedded
  // browsers. The fallback command works in many HTTP/WebView contexts if invoked
  // directly from a user gesture; manual selection is the final fallback.

  function selectCopyText(input) {
    input.focus({ preventScroll: true });
    input.select();
    input.setSelectionRange(0, input.value.length);
  }

  function fallbackCopyText(text) {
    const input = node("textarea");
    input.value = text;
    input.readOnly = true;
    l10n.attribute(input, "aria-label", t("clipboard.text"));
    input.style.cssText =
      "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;z-index:2147483647;pointer-events:none;";
    // When using <dialog>.showModal(), nodes outside the dialog are inert.
    (stateDialog || host.dialog || document.body).append(input);
    const previous = document.activeElement;
    let copied = false;
    try {
      selectCopyText(input);
      copied = document.execCommand("copy") === true;
    } catch (error) {
      console.debug("[Quick Access] Clipboard fallback method unavailable", error);
    } finally {
      input.remove();
      if (previous?.isConnected && typeof previous.focus === "function") {
        previous.focus({ preventScroll: true });
      }
    }
    return copied;
  }

  function showManualCopy(text) {
    const target = stateDialog?.querySelector(".qap-state-modal-content") || host.shell;
    if (!target) return;
    removeLocalizedElement(target.querySelector(".qap-manual-copy"));
    const panel = node("div", "qap-manual-copy");
    panel.setAttribute("role", "region");
    l10n.attribute(panel, "aria-label", t("clipboard.manual"));
    const header = node("div", "qap-manual-head");
    header.append(node("strong", "", t("clipboard.copy_manually")));
    header.append(iconButton("mdi:close", t("common.close"), () => removeLocalizedElement(panel)));
    const info = node("p", "", t("clipboard.blocked"));
    const input = node("textarea", "qap-manual-input");
    input.readOnly = true;
    input.value = text;
    l10n.attribute(input, "aria-label", t("clipboard.text"));
    const selectBtn = button(
      t("clipboard.select"),
      () => selectCopyText(input),
      "qap-button-primary",
    );
    panel.append(header, info, input, selectBtn);
    target.append(panel);
    selectCopyText(input);
  }

  async function copyText(value) {
    const text = String(value);
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        toast(COPY_SUCCESS_MESSAGE);
        return;
      } catch (error) {
        console.debug("[Quick Access] Async clipboard failed", error);
      }
    }
    if (fallbackCopyText(text)) {
      toast(COPY_SUCCESS_MESSAGE);
      return;
    }
    showManualCopy(text);
  }

  return {
    open: openStateDialog,
    update: updateStateDialog,
    close: closeStateDialog,
    copyText,
    get navigation() {
      return stateDialog ? navigation : null;
    },
    get active() {
      return stateDialog;
    },
    set returnFocus(element) {
      stateDialogReturnFocus = element;
    },
  };
}
