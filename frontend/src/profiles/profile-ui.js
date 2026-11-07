import {
  DEFAULT_PROFILE_ICON,
  DEFAULT_PROFILE_COLOR,
  PROFILE_NAME_MAX_LENGTH,
} from "./profile-defaults.js";
import { createProfileValidation } from "./profile-validation.js";
import { normalizeIcon, normalizeIconColor } from "../utils/icons.js";
import { newId } from "../utils/ids.js";
import { textLength, truncateText } from "../utils/text.js";
import { createItemFeedback } from "../ui/item-feedback.ts";
import { createManagementRow, overflowButton } from "../ui/editable-list.js";
import { profilesByName } from "./profile-order.ts";
import { profileFilters } from "../registry/filter-definitions.js";

export function createProfileUi({
  l10n,
  ui,
  forms,
  host,
  getProfiles,
  getRegistryDialog,
  getHass,
  isEnabled,
  renderView,
  closeDialog,
  navigationChanged,
}) {
  const t = l10n.message;

  const {
    node,
    button,
    iconButton,
    coloredIcon,
    leadingIcon,
    errorMessage,
    focusWhenReady,
    loadHaComponents,
    removeLocalizedElement,
    replaceLocalizedChildren,
    createDialogElement,
    createEditorDialog,
    showDialogElement,
    cleanupDialogElement,
  } = ui;
  const { input, select, iconPickerField, iconColorField, fieldValidation, validateFields } = forms;
  const { defaultSettings, defaultCategories, profileNameError } = createProfileValidation(l10n);
  const applyProfileData = (...args) => getProfiles().applyProfileData(...args);
  const mutateProfile = (...args) => getProfiles().mutateProfile(...args);
  const rememberProfileSelection = (...args) => getProfiles().rememberProfileSelection(...args);
  const createProfile = (...args) => getProfiles().createProfile(...args);
  const feedback = createItemFeedback((id) =>
    [...(host.shell?.querySelectorAll(".qap-profile-row") || [])].find(
      (row) => row.dataset.id === id,
    ),
  );
  let feedbackContext = null;
  function prepareView(view) {
    const profileId = getProfiles().activeProfileId;
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
  let confirmationDialog = null;
  let profileDialog = null;
  let profileDialogReturnFocus = null;
  let profileDialogRetainsView = false;
  let profileMenu = null;
  let profileMenuTrigger = null;
  let profileMenuListeners = null;
  let profileUiGeneration = 0;
  let dialogNavigation = null;
  let menuNavigation = null;
  const profileDrafts = new Map();
  const PROFILE_ERROR_MESSAGE = t("errors.server_save");
  const PROFILE_MENU_GAP = 4;
  function hasProfileDraft() {
    // Rows can update live. Open forms and menus retain their original snapshot
    // so a remote change cannot replace a draft or change a pending action.
    return Boolean(
      host.dialog &&
      (profileDialog ||
        profileMenu ||
        confirmationDialog ||
        (getProfiles().activeProfileId &&
          ["shortcuts", "categories", "visibility"].includes(host.currentView))),
    );
  }

  function trackProfileDraft(element, read, owner = null) {
    const draft = { read, owner, saved: JSON.stringify(read()) };
    profileDrafts.set(element, draft);
    return () => {
      draft.saved = JSON.stringify(read());
      updateDialogDismissal();
    };
  }

  function hasUnsavedProfileChanges(root = host.dialog) {
    let dirty = false;
    for (const [element, draft] of profileDrafts) {
      if (!element.isConnected) profileDrafts.delete(element);
      else if (
        (root?.contains(element) || (draft.owner && root?.contains(draft.owner))) &&
        JSON.stringify(draft.read()) !== draft.saved
      )
        dirty = true;
    }
    return dirty;
  }

  function afterDiscardingProfileChanges(action, root = host.dialog, allowSaving = false) {
    if (getProfiles().profileSaving && !allowSaving) return false;
    if (
      !hasUnsavedProfileChanges(root) &&
      (root !== host.dialog || !hasUnsavedProfileChanges(profileDialog))
    ) {
      action();
      return true;
    }
    const parent = host.dialog;
    if (root && !root.open) {
      if (root.localName === "dialog") root.showModal();
      else root.open = true;
    }
    const trigger = document.activeElement?.isConnected ? document.activeElement : root;
    confirmAction(
      {
        title: t("common.discard_changes"),
        description: t("settings.confirm_discard"),
        confirmLabel: t("common.discard"),
        id: "qap-discard-changes",
      },
      trigger,
      () => {
        if (
          host.dialog === parent &&
          root?.isConnected &&
          (!getProfiles().profileSaving || allowSaving)
        )
          action();
      },
    );
    return false;
  }

  function requestCloseDialog() {
    return afterDiscardingProfileChanges(closeDialog);
  }

  function showProfileStatus() {
    if (profileDialog) {
      profileDialog.preventScrimClose = getProfiles().profileSaving;
      profileDialog.querySelector(".qap-profile-close").disabled = getProfiles().profileSaving;
    }
    updateDialogDismissal();
    const editors = [...document.body.querySelectorAll(".qap-editor-dialog")].map((modal) =>
      modal.querySelector(".qap-shell"),
    );
    for (const root of [host.dialog, ...editors]) {
      renderProfileStatus(root);
      const close = root?.querySelector(".qap-editor-close");
      if (close) close.disabled = getProfiles().profileSaving;
    }
  }

  function updateDialogDismissal() {
    if (host.dialog)
      host.dialog.preventScrimClose = getProfiles().profileSaving || hasUnsavedProfileChanges();
  }

  function renderProfileStatus(root) {
    const host = root?.querySelector(".qap-profile-status");
    if (!host) return;
    const body = root.querySelector(".qap-body");
    if (body) {
      body.inert = getProfiles().profileSaving;
      body.setAttribute("aria-busy", String(getProfiles().profileSaving));
    }
    for (const actions of root.querySelectorAll(".qap-form-actions"))
      actions.inert = getProfiles().profileSaving;
    for (const action of root.querySelectorAll(
      ".qap-save-settings, .qap-create-profile, .qap-create-category, .qap-back-settings",
    )) {
      action.disabled =
        getProfiles().profileSaving ||
        (action.classList.contains("qap-create-profile") && !getProfiles().serverData);
      if (
        action.localName === "qap-button" &&
        action.className.split(" ").includes("qap-save-settings")
      )
        action.loading = getProfiles().profileSaving;
    }
    replaceLocalizedChildren(host);
    const pending =
      !getProfiles().profileSaving &&
      getProfiles().baseData &&
      getProfiles().serverData &&
      getProfiles().serverData.revision !== getProfiles().baseData.revision;
    const text =
      getProfiles().profileError ||
      (pending ? t("profiles.status.remote_changes") : getProfiles().localWarning);
    if (text) {
      const message = errorMessage();
      l10n.text(message, text);
      host.append(message);
    }
    if (pending) {
      const reload = button(
        t("profiles.reload"),
        () =>
          confirmAction(
            {
              title: t("profiles.confirm_reload"),
              description: t("profiles.reload_description"),
              confirmLabel: t("common.reload"),
              id: "qap-reload-profiles",
            },
            reload,
            () => {
              applyProfileData(getProfiles().serverData, getProfiles().activeProfileId);
              renderView();
            },
          ),
        "qap-linkish",
      );
      reload.disabled = getProfiles().profileSaving;
      host.append(reload);
    }
  }

  function appendProfileMetadata(container, profile) {
    const filters = profileFilters(profile);
    for (const [key, count] of [
      ["shortcuts.count", profile.settings.links.length],
      ["settings.category_count", profile.categories.length],
      ["filters.count", filters.states.length + filters.devices.length],
    ]) {
      if (count) container.append(node("small", "qap-profile-metadata", t(key, { count })));
    }
  }

  function profileNotice(message) {
    const notice = ui.errorMessage();
    notice.className = "qap-profile-notice";
    notice.append(node("span", "", message));
    return notice;
  }

  function restoreProfileFocus(trigger, parent, generation) {
    let target = trigger;
    if (!target?.isConnected) {
      const row = [...(host.shell?.querySelectorAll(".qap-profile-row") || [])].find(
        (item) => item.dataset.id === trigger?.dataset.profileId,
      );
      const shortcut = [
        ...(host.shell?.querySelectorAll(".qap-shortcut-row, .qap-shortcut-overflow") || []),
      ].find((item) => item.dataset.shortcutId === trigger?.dataset.shortcutId);
      // Rows re-render after saves; return to the same control of the same profile.
      target =
        row?.querySelector(
          trigger?.classList?.contains("qap-profile-content")
            ? ".qap-profile-content"
            : ".qap-profile-overflow",
        ) ||
        shortcut ||
        host.dialog?.querySelector(".qap-add-shortcut") ||
        host.dialog?.querySelector(".qap-save-current-page") ||
        host.dialog?.querySelector(".qap-create-category") ||
        host.dialog?.querySelector(".qap-create-profile") ||
        host.dialog?.querySelector(".qap-head-button");
    }
    focusWhenReady(
      target,
      () =>
        host.dialog === parent &&
        parent?.open &&
        !profileDialog &&
        !profileMenu &&
        !confirmationDialog &&
        profileUiGeneration === generation,
    );
  }

  function closeProfileDialog(restoreFocus = true, refreshView = false, focusTarget = null) {
    if (!profileDialog) return;
    const modal = profileDialog;
    const trigger = focusTarget || profileDialogReturnFocus;
    const parent = host.dialog;
    // A dialog stacked above another editor's draft never re-renders the view
    // beneath it; that editor keeps its own base and remote changes stay pending.
    const retainView = profileDialogRetainsView;
    profileDialog = profileDialogReturnFocus = null;
    profileDialogRetainsView = false;
    dialogNavigation = null;
    navigationChanged();
    const generation = ++profileUiGeneration;
    const waitForClose = modal.open;
    const restore = () => {
      if (!restoreFocus) return;
      // Restore the current controller-owned trigger after the closing frame.
      restoreProfileFocus(trigger, parent, generation);
    };
    if (waitForClose) modal.addEventListener("closed", restore, { once: true });
    cleanupDialogElement(modal);
    if (retainView) {
      // The underlying editor owns the view; never replace its draft here.
    } else if (
      restoreFocus &&
      !getProfiles().profileSaving &&
      getProfiles().serverData &&
      getProfiles().baseData?.revision !== getProfiles().serverData.revision
    ) {
      applyProfileData(getProfiles().serverData);
      renderView();
    } else if (refreshView && host.dialog === parent) renderView();
    if (!waitForClose) restore();
  }

  function closeProfileMenu(restoreFocus = true) {
    if (!profileMenu) return;
    const trigger = profileMenuTrigger;
    profileMenu.open = false;
    profileMenu.anchorElement = undefined;
    removeLocalizedElement(profileMenu);
    profileMenu = profileMenuTrigger = null;
    menuNavigation = null;
    navigationChanged();
    profileMenuListeners?.abort();
    profileMenuListeners = null;
    trigger?.setAttribute("aria-expanded", "false");
    const generation = ++profileUiGeneration;
    if (restoreFocus) restoreProfileFocus(trigger, host.dialog, generation);
  }

  function confirmProfileDeletion(profile, trigger) {
    const parent = host.dialog;
    confirmAction(
      {
        title: t("profiles.delete"),
        notice: t("profiles.delete_warning"),
        description: t("profiles.delete_confirmation", { name: profile.name }),
        confirmLabel: t("profiles.delete"),
        id: "qap-delete-profile",
        closeButton: true,
      },
      trigger,
      async () => {
        const saved = await mutateProfile("delete", profile);
        if (saved && host.dialog === parent) renderView();
      },
    );
  }

  function openProfileMenu(profile, trigger, focusLast = false) {
    openActionMenu(
      trigger,
      [
        {
          value: "duplicate",
          label: t("common.duplicate"),
          symbol: "mdi:content-copy",
          run: () => openProfileEditor("duplicate", profile, trigger),
        },
        {
          value: "delete",
          label: t("common.delete"),
          symbol: "mdi:delete-outline",
          separator: true,
          danger: true,
          run: () => confirmProfileDeletion(profile, trigger),
        },
      ],
      t("profiles.manage", { name: profile.name }),
      focusLast,
    );
  }

  function openActionMenu(
    trigger,
    actions,
    label,
    focusLast = false,
    { dialog = host.dialog, shell = host.shell, navigation = null, className = "" } = {},
  ) {
    if (!host.dialog || getProfiles().profileSaving || profileDialog || confirmationDialog) return;
    if (profileMenuTrigger === trigger) {
      closeProfileMenu();
      return;
    }
    closeProfileMenu(false);
    profileUiGeneration++;
    const popup = node("qap-menu", "qap-profile-dropdown");
    if (className) popup.classList.add(className);
    popup.id = newId();
    l10n.attribute(popup, "aria-label", label);
    trigger.setAttribute("aria-controls", popup.id);
    trigger.setAttribute("aria-expanded", "true");
    const items = [];
    const runAction = (action) => {
      if (profileMenu !== popup || !shell?.contains(trigger) || getProfiles().profileSaving) return;
      closeProfileMenu(false);
      actions.find((item) => item.value === action)?.run();
    };
    for (const {
      value: action,
      label,
      symbol,
      separator,
      danger,
      className = `qap-${action}-profile`,
    } of actions) {
      if (separator) {
        const divider = node("div", "qap-profile-menu-divider");
        divider.setAttribute("role", "separator");
        popup.append(divider);
      }
      const item = node("qap-menu-item", className, label);
      item.value = action;
      if (symbol) {
        const symbolElement = leadingIcon(symbol);
        symbolElement.slot = "icon";
        item.prepend(symbolElement);
      }
      if (danger) item.setAttribute("variant", "danger");
      items.push(item);
      popup.append(item);
    }
    profileMenu = popup;
    profileMenuTrigger = trigger;
    const selector = ".qap-profile-overflow";
    const profileId = trigger.dataset.profileId;
    menuNavigation = navigation || {
      key: `${selector}:${profileId || ""}`,
      open: () => {
        const target = [...(host.dialog?.querySelectorAll(selector) || [])].find(
          (item) => item.dataset.profileId === profileId,
        );
        target?.click();
      },
    };
    navigationChanged();
    shell.append(popup);
    profileMenuListeners = new AbortController();
    const options = { signal: profileMenuListeners.signal };
    window.addEventListener("resize", () => closeProfileMenu(false), options);
    // Body scroll events cross the owned dialog's shadow boundary.
    dialog.addEventListener("scroll", () => closeProfileMenu(false), { ...options, capture: true });
    shell
      .querySelector(".qap-body, .qap-state-modal-body")
      ?.addEventListener("scroll", () => closeProfileMenu(false), options);
    const focused = focusLast ? items.length - 1 : 0;
    const focusItem = () =>
      focusWhenReady(items[focused], () => profileMenu === popup && popup.open);
    popup.placement = "bottom-end";
    popup.distance = PROFILE_MENU_GAP;
    let selectedAction = null;
    popup.addEventListener("wa-select", (event) => {
      const item = event.detail?.item;
      if (
        event.target !== popup ||
        !popup.open ||
        !items.includes(item) ||
        item.disabled ||
        selectedAction ||
        profileMenu !== popup ||
        getProfiles().profileSaving
      )
        return;
      event.stopPropagation();
      event.preventDefault();
      selectedAction = item.value;
      popup.open = false;
    });
    // Wait for the menu to finish hiding before opening another modal.
    popup.addEventListener("wa-after-hide", (event) => {
      if (event.target !== popup || profileMenu !== popup) return;
      if (selectedAction) runAction(selectedAction);
      else closeProfileMenu(false);
    });
    popup.addEventListener("wa-after-show", focusItem);
    popup.anchorElement = trigger;
    popup.open = true;
  }

  function createProfileDialog(
    title,
    closeLabel,
    className,
    trigger,
    navigation = null,
    refreshViewOnClose = false,
    retainView = false,
  ) {
    closeProfileMenu(false);
    profileUiGeneration++;
    const { modal, content, body } = createEditorDialog(
      title,
      closeLabel,
      () => dismiss(),
      className,
    );
    const titleElement = content.querySelector(".qap-title");
    titleElement.id = newId();
    modal.setAttribute("aria-labelledby", titleElement.id);
    const dismiss = () => {
      if (profileDialog !== modal) return;
      return afterDiscardingProfileChanges(
        () => closeProfileDialog(true, refreshViewOnClose),
        modal,
      );
    };
    content.querySelector(".qap-editor-close").classList.add("qap-profile-close");
    profileDialog = modal;
    profileDialogReturnFocus = trigger;
    profileDialogRetainsView = retainView;
    dialogNavigation = navigation;
    navigationChanged();
    showDialogElement(modal, dismiss);
    return { modal, content, body, dismiss };
  }

  function openProfileEditor(kind, profile, trigger) {
    if (
      !host.dialog ||
      getProfiles().profileSaving ||
      profileDialog ||
      confirmationDialog ||
      !getProfiles().serverData
    )
      return;
    const parent = host.dialog;
    const editing = kind === "edit";
    let returnView;
    if (getProfiles().activeProfileId) returnView = host.currentView;
    else if (editing) returnView = "profiles";
    else returnView = "home";
    const profiles = profilesByName((getProfiles().baseData || getProfiles().serverData).profiles);
    const copy = kind === "duplicate";
    let title;
    let closeLabel;
    if (editing) {
      title = t("profiles.edit");
      closeLabel = t("profiles.close_edit");
    } else if (copy) {
      title = t("profiles.duplicate_title");
      closeLabel = t("profiles.close_duplicate");
    } else {
      title = t("profiles.create");
      closeLabel = t("profiles.close_create");
    }
    const { modal, body, dismiss } = createProfileDialog(
      title,
      closeLabel,
      "qap-profile-editor",
      trigger,
      {
        key: `${kind}:${profile?.id || ""}`,
        open: () => {
          const current = getProfiles().serverData?.profiles.find(
            (item) => item.id === profile?.id,
          );
          if (kind === "create" || current) openProfileEditor(kind, current, trigger);
        },
      },
    );
    body.classList.add("qap-profile-form");
    if (copy) body.append(node("p", "qap-settings-desc", t("profiles.copy_description")));
    const copyNameOverhead = textLength(String(t("profiles.copy_name", { name: "" })));
    let initialName = "";
    if (editing) initialName = profile.name;
    else if (copy)
      initialName = String(
        t("profiles.copy_name", {
          name: truncateText(profile.name, PROFILE_NAME_MAX_LENGTH - copyNameOverhead),
        }),
      );
    const name = input(copy ? t("profiles.new_name") : t("profiles.name"), "text", initialName, {
      maxlength: PROFILE_NAME_MAX_LENGTH,
      autocomplete: "off",
    });
    body.append(name.element);
    let iconEdited = false;
    let colorEdited = false;
    const profileIcon = iconPickerField(
      t("common.icon"),
      profile?.icon ?? DEFAULT_PROFILE_ICON,
      () => {
        iconEdited = true;
      },
    );
    const color = iconColorField(profile ? profile.color : DEFAULT_PROFILE_COLOR, () => {
      colorEdited = true;
    });
    profileIcon.element.classList.add("qap-profile-icon-field");
    body.append(profileIcon.element, color.element);
    let startWith = copy ? "copy" : "default";
    const source = editing
      ? null
      : select(
          t("profiles.copy_from"),
          profiles.map((item) => [item.id, item.name]),
          profile?.id || getProfiles().activeProfileId || profiles[0]?.id || "",
        );
    const sourceSummary = editing ? null : node("p", "qap-profile-source-summary qap-muted");
    const sourceSection = editing ? null : node("div", "qap-profile-source");
    sourceSection?.append(source.element, sourceSummary);
    const iconValidation = fieldValidation(profileIcon, () =>
      normalizeIcon(profileIcon.value, "") ? "" : t("profiles.errors.invalid_icon"),
    );
    const sourceValidation =
      source &&
      fieldValidation(source, () =>
        startWith === "copy" &&
        (!profiles.some((item) => item.id === source.value) ||
          !getProfiles().serverData.profiles.some((item) => item.id === source.value))
          ? t("profiles.errors.source_unavailable")
          : "",
      );
    const validations = [
      fieldValidation(name, () => profileNameError(name.value)),
      iconValidation,
      ...(sourceValidation ? [sourceValidation] : []),
    ];
    const updateSource = () => {
      if (!source) return;
      sourceSection.hidden = startWith !== "copy";
      const selected = profiles.find((item) => item.id === source.value);
      replaceLocalizedChildren(sourceSummary);
      if (selected) appendProfileMetadata(sourceSummary, selected);
      else sourceSummary.append(node("span", "", t("profiles.no_source")));
      if (!editing && !iconEdited) {
        profileIcon.value =
          startWith === "copy" ? (selected?.icon ?? DEFAULT_PROFILE_ICON) : DEFAULT_PROFILE_ICON;
      }
      if (!editing && !colorEdited)
        color.value = startWith === "copy" ? selected?.color : DEFAULT_PROFILE_COLOR;
      iconValidation.revalidate();
      sourceValidation.revalidate();
    };
    source?.onChange(updateSource);
    if (!editing && !copy) {
      const choices = node("div", "qap-profile-start");
      const group = node("qap-radio-group");
      l10n.property(group, "label", t("profiles.start_with"));
      group.name = newId();
      group.orientation = "vertical";
      group.value = startWith;
      const startOptions = [
        ["default", t("profiles.default_settings"), t("profiles.defaults_description")],
        ["copy", t("profiles.copy_existing"), t("profiles.copy_independent")],
      ];
      const optionText = (label, description) => {
        const text = node("span");
        text.append(node("strong", "", label), node("small", "qap-muted", description));
        return text;
      };
      const setStartWith = (value) => {
        if (
          !startOptions.some(([option]) => option === value) ||
          (value === "copy" && !profiles.length)
        )
          return;
        startWith = value;
        updateSource();
      };
      for (const [value, label, description] of startOptions) {
        const option = node("qap-radio-option", "qap-profile-choice");
        option.value = value;
        option.disabled = value === "copy" && !profiles.length;
        option.append(optionText(label, description));
        group.append(option);
      }
      group.addEventListener("change", (event) => {
        if (event.target !== group) return;
        event.stopPropagation();
        setStartWith(group.value);
        group.value = startWith;
      });
      choices.append(group);
      body.append(choices);
    }
    if (!editing) body.append(sourceSection);
    updateSource();
    const markSaved = trackProfileDraft(body, () => [
      name.value,
      profileIcon.value,
      color.value,
      startWith,
      source?.value,
    ]);
    const actions = node("div", "qap-form-actions qap-profile-form-actions");
    const save = button(
      t("common.save"),
      async () => {
        if (profileDialog !== modal || host.dialog !== parent || getProfiles().profileSaving)
          return;
        if (
          !validateFields(
            validations,
            () => profileDialog === modal && host.dialog === parent && modal.open,
          )
        )
          return;
        const selectedIcon = typeof profileIcon.value === "string" ? profileIcon.value.trim() : "";
        const sourceProfile =
          startWith === "copy" ? profiles.find((item) => item.id === source.value) : null;
        host.currentView = returnView;
        const saved = editing
          ? await mutateProfile("update", {
              ...profile,
              name: name.value.trim(),
              icon: selectedIcon,
              color: normalizeIconColor(color.value),
            })
          : await createProfile(
              name.value,
              sourceProfile?.settings || defaultSettings(),
              sourceProfile?.favorites || [],
              selectedIcon,
              sourceProfile?.categories || defaultCategories(),
              normalizeIconColor(color.value),
              sourceProfile?.device_favorites || [],
              sourceProfile?.filters,
            );
        if (
          saved &&
          host.dialog === parent &&
          host.currentView === returnView &&
          (!profileDialog || profileDialog === modal)
        ) {
          if (profileDialog === modal) {
            closeProfileDialog(false);
            renderView();
          }
          if (!editing && host.currentView === "profiles")
            feedback.show(getProfiles().activeProfileId, true);
          const generation = profileUiGeneration;
          let target;
          if (editing) target = trigger;
          else if (returnView === "home") target = host.dialog.querySelector(".qap-head-button");
          else
            target = host.shell
              ?.querySelector(".qap-current-profile")
              ?.querySelector(".qap-profile-overflow");
          const restore = () => restoreProfileFocus(target, parent, generation);
          if (modal.isConnected) modal.addEventListener("closed", restore, { once: true });
          else restore();
        }
      },
      "qap-button-primary qap-profile-submit",
    );
    name.element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      save.click();
    });
    const remove = editing
      ? button(
          t("common.delete"),
          () => {
            if (profileDialog !== modal || host.dialog !== parent || getProfiles().profileSaving)
              return;
            confirmAction(
              {
                title: t("profiles.delete"),
                notice: t("profiles.delete_warning"),
                description: t("profiles.delete_confirmation", { name: profile.name }),
                confirmLabel: t("profiles.delete"),
                id: "qap-delete-profile",
                closeButton: true,
                awaitConfirmation: true,
              },
              remove,
              async () => {
                if (!(await mutateProfile("delete", profile))) return false;
                markSaved();
                if (profileDialog === modal && host.dialog === parent)
                  closeProfileDialog(true, true);
                return true;
              },
            );
          },
          "qap-button-danger qap-profile-delete",
        )
      : null;
    actions.append(remove ?? button(t("common.cancel"), dismiss, "qap-profile-cancel"), save);
    body.parentElement.append(actions);
    showProfileStatus();
  }

  function profileRow(profile) {
    const active = profile.id === getProfiles().activeProfileId;
    const details = node("span", "qap-profile-details qap-edit-texts");
    const label = node("strong", "", profile.name);
    label.title = profile.name;
    details.append(label);
    const metadata = node("span", "qap-profile-summary");
    appendProfileMetadata(metadata, profile);
    details.append(metadata);
    const actions = [];
    if (!active) {
      // Activation stays one tap and separate from editing the row.
      const use = button(
        t("profiles.use_action"),
        () => {
          if (
            getProfiles().profileSaving ||
            profileDialog ||
            confirmationDialog ||
            !host.shell?.contains(use)
          )
            return;
          closeProfileMenu(false);
          afterDiscardingProfileChanges(() => {
            if (getProfiles().profileSaving || !host.shell?.contains(use)) return;
            if (!getProfiles().serverData?.profiles.some((item) => item.id === profile.id)) {
              getProfiles().profileError = t("profiles.errors.deleted");
              showProfileStatus();
              return;
            }
            const view = getProfiles().activeProfileId ? "profiles" : "home";
            applyProfileData(getProfiles().serverData, profile.id);
            rememberProfileSelection();
            host.currentView = view;
            renderView();
            focusWhenReady(
              view === "home"
                ? host.dialog.querySelector(".qap-head-button")
                : host.shell
                    .querySelector(".qap-current-profile")
                    .querySelector(".qap-profile-overflow"),
              () => host.currentView === view && !profileDialog,
            );
          });
        },
        "qap-linkish qap-edit-primary-action qap-profile-activate",
      );
      l10n.attribute(use, "aria-label", t("profiles.use", { name: profile.name }));
      actions.push(use);
    }
    const overflow = overflowButton(
      ui,
      t("profiles.manage", { name: profile.name }),
      (trigger, last) => openProfileMenu(profile, trigger, last),
      "qap-profile-overflow",
    );
    overflow.dataset.profileId = profile.id;
    actions.push(overflow);
    const { row, content } = createManagementRow(ui, l10n, {
      id: profile.id,
      className: `qap-profile-row${active ? " is-current" : ""}`,
      contentClass: "qap-profile-content",
      symbol: coloredIcon(profile),
      details,
      hint: t("profiles.edit"),
      onClick: () => openProfileEditor("edit", profile, content),
      actions,
    });
    content.dataset.profileId = profile.id;
    return row;
  }

  function renderProfiles(body) {
    void loadHaComponents();
    const content = node("div", "qap-settings qap-profiles");
    content.append(
      node(
        "p",
        "qap-settings-desc",
        t(getProfiles().activeProfileId ? "profiles.selection_help" : "profiles.setup_description"),
      ),
    );
    if (!getProfiles().serverData) {
      content.append(
        button(t("profiles.retry"), () => {
          getProfiles().stopProfileSubscription();
          void getProfiles().connectProfiles();
        }),
      );
      body.append(content);
      return;
    }
    const profiles = profilesByName((getProfiles().baseData || getProfiles().serverData).profiles);
    const current = profiles.find((profile) => profile.id === getProfiles().activeProfileId);
    if (current) {
      const section = node("section", "qap-current-profile");
      section.append(
        node("h3", "qap-profile-section-title", t("profiles.current")),
        profileRow(current),
      );
      content.append(section);
    }
    const others = profiles.filter((profile) => profile.id !== getProfiles().activeProfileId);
    if (others.length) {
      const section = node("section", "qap-other-profiles");
      section.append(
        node(
          "h3",
          "qap-profile-section-title",
          current ? t("profiles.others") : t("profiles.saved"),
        ),
      );
      const list = node("div", "qap-profile-list");
      for (const profile of others) list.append(profileRow(profile));
      section.append(list);
      content.append(section);
    } else if (!current) content.append(node("p", "qap-muted", t("profiles.empty")));
    if (!profiles.length) {
      const initialize = button(
        t("profiles.start_defaults"),
        async () => {
          const parent = host.dialog;
          if (
            (await createProfile(String(t("profiles.default_name")))) &&
            host.dialog === parent &&
            host.currentView === "profiles"
          )
            feedback.show(getProfiles().activeProfileId, true);
        },
        "qap-create-default-profile",
      );
      content.append(initialize);
    }
    body.append(content);
    feedback.refresh();
  }

  function quotaMessage(kind) {
    let resource = "storage";
    if (kind === "profiles") resource = "profiles";
    else if (kind === "categories") resource = "categories";
    return t(`limits.${resource}_${getHass()?.user?.is_admin ? "admin" : "user"}`);
  }

  function showMutationError(note) {
    l10n.text(
      note,
      getProfiles().profileError || getProfiles().localWarning || PROFILE_ERROR_MESSAGE,
    );
    note.dataset.quotaError = getProfiles().profileErrorCode;
  }

  function clearQuotaErrors(previous, next) {
    if (!previous) return;
    const keys = {
      profile_limit: "max_profiles",
      category_limit: "max_categories",
      profile_storage_limit: "max_profile_bytes",
      user_storage_limit: "max_user_bytes",
    };
    const increased = (code) => keys[code] && next[keys[code]] > previous[keys[code]];
    if (increased(getProfiles().profileErrorCode))
      getProfiles().profileError = getProfiles().profileErrorCode = "";
    for (const root of new Set([
      host.shell,
      ...document.body.querySelectorAll(".qap-editor-dialog"),
      getRegistryDialog().active,
    ])) {
      for (const note of root?.querySelectorAll(".qap-error") || []) {
        if (increased(note.dataset.quotaError)) {
          l10n.text(note, "");
          delete note.dataset.quotaError;
        }
      }
    }
  }

  function closeConfirmationDialog() {
    if (!confirmationDialog) return;
    const active = confirmationDialog;
    confirmationDialog = null;
    cleanupDialogElement(active);
  }

  function confirmAction(
    {
      title,
      description,
      confirmLabel,
      id,
      notice,
      closeButton = false,
      configure,
      awaitConfirmation = false,
    },
    trigger,
    onConfirm,
  ) {
    if (confirmationDialog || !host.dialog) return;
    const modal = createDialogElement(title, true);
    modal.classList.add("qap-confirmation", `${id}-confirmation`);
    if (awaitConfirmation) modal.dataset.dismissOnBack = "true";
    modal.setAttribute("aria-labelledby", `${id}-title`);
    modal.setAttribute("aria-describedby", `${id}-description`);
    modal.setAttribute("type", "alert");
    const content = node("div", "qap-shell");
    const heading = node("div", "qap-head");
    const titleElement = node("h2", "qap-title", title);
    titleElement.id = `${id}-title`;
    heading.append(titleElement);
    const body = node("div", "qap-body qap-settings");
    if (notice) {
      modal.classList.add("qap-profile-confirmation");
      body.append(profileNotice(notice));
    }
    const descriptionElement = node("p", "qap-settings-desc", description);
    descriptionElement.id = `${id}-description`;
    let saving = false;
    const dismiss = () => {
      if (confirmationDialog !== modal || saving) return;
      const restoreFocus = () => {
        if (!confirmationDialog && trigger.isConnected) trigger.focus({ preventScroll: true });
      };
      const waitForClose = modal.open;
      if (waitForClose) modal.addEventListener("closed", restoreFocus, { once: true });
      closeConfirmationDialog();
      if (!waitForClose) restoreFocus();
    };
    const actions = node("div", "qap-form-actions");
    if (closeButton)
      heading.append(iconButton("mdi:close", t("common.close_confirmation"), dismiss));
    const cancel = button(t("common.cancel"), dismiss);
    cancel.setAttribute("autofocus", "");
    const error = errorMessage();
    const confirm = button(
      confirmLabel,
      async () => {
        if (confirmationDialog !== modal || !trigger.isConnected || !isEnabled()) return;
        if (!awaitConfirmation) {
          dismiss();
          onConfirm();
          return;
        }
        if (saving || getProfiles().profileSaving) return;
        saving = true;
        confirm.disabled = cancel.disabled = true;
        body.inert = true;
        modal.preventScrimClose = true;
        l10n.text(error, "");
        let saved = false;
        try {
          saved = await onConfirm();
        } catch (failure) {
          l10n.text(error, l10n.errorMessage(failure) || PROFILE_ERROR_MESSAGE);
        } finally {
          saving = false;
          confirm.disabled = cancel.disabled = false;
          body.inert = false;
          modal.preventScrimClose = false;
        }
        if (saved) dismiss();
        else if (!error.textContent) showMutationError(error);
      },
      "qap-button-danger",
    );
    actions.append(cancel, confirm);
    body.append(descriptionElement);
    configure?.(body, confirm);
    if (awaitConfirmation) body.append(error);
    content.append(heading, body, actions);
    modal.append(content);
    confirmationDialog = modal;
    showDialogElement(modal, dismiss);
    focusWhenReady(cancel, () => confirmationDialog === modal && modal.open);
  }

  return {
    prepareView,
    disposeView,
    untrackProfileDraft: (element) => profileDrafts.delete(element),
    hasProfileDraft,
    trackProfileDraft,
    hasUnsavedProfileChanges,
    afterDiscardingProfileChanges,
    requestCloseDialog,
    showProfileStatus,
    updateDialogDismissal,
    renderProfileStatus,
    closeProfileDialog,
    closeProfileMenu,
    openActionMenu,
    createProfileDialog,
    openProfileEditor,
    renderProfiles,
    quotaMessage,
    showMutationError,
    clearQuotaErrors,
    closeConfirmationDialog,
    confirmAction,
    get profileDialog() {
      return profileDialog;
    },
    get profileMenu() {
      return profileMenu;
    },
    get confirmationDialog() {
      return confirmationDialog;
    },
    get dialogNavigation() {
      return profileDialog ? dialogNavigation : null;
    },
    get menuNavigation() {
      return profileMenu ? menuNavigation : null;
    },
    clearDrafts() {
      profileDrafts.clear();
    },
  };
}
