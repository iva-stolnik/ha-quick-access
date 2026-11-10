import { createLifecycle } from "../core/lifecycle.js";
import { createDialogs } from "../ui/dialogs.js";
import { createProfileUi } from "../profiles/profile-ui.js";
import { createShortcutUi } from "../shortcuts/shortcut-ui.js";
import { createProfileController } from "../profiles/profile-controller.js";
import { createPositionController } from "../launcher/position-controller.js";
import { createForms } from "../ui/forms.js";
import { createDom } from "../ui/dom.js";
import { getHaRoot, getHass, observeHaContexts } from "../core/ha-context.js";
import { createControls } from "../ui/controls.js";
import { createRegistryDialog } from "../registry/registry-dialog.js";
import { mountRegistryList } from "../registry/registry-list.js";
import { createEntityPresentation } from "../entities/entity-presentation.js";
import { createDevicePresentation } from "../devices/device-presentation.js";
import {
  PROFILE_SELECTION_EVENT,
  LAUNCHER_PREFERENCE_EVENT,
} from "../profiles/profile-defaults.js";
import { currentPageUrl, parseRoutes, routeMatches } from "../utils/urls.js";
import { readJson, launcherEnabledKey, readLauncherEnabled } from "../utils/storage.js";
import { createRegistryView, normalizeStatesSearchHistory } from "../registry/registry-view.js";
import { createProfileValidation } from "../profiles/profile-validation.js";
import { createLocalizer } from "../localize.js";
import { assetUrl, VERSION } from "../utils/assets.js";
import { createNavigationHistory } from "./navigation-history.js";
import {
  profileFilters,
  defaultFilter,
  linkedFilterShortcuts,
} from "../registry/filter-definitions.js";

/**
 * Quick Access — global mobile launcher for Home Assistant.
 * No iframe or CDN; dependencies are bundled locally. UI is intentionally isolated.
 * Shortcut navigation uses real links and respects HA's dirty-state guards.
 */
export function createLauncher({ controlsFactory = createControls } = {}) {
  const l10n = createLocalizer();
  const t = l10n.message;
  const dom = createDom(l10n);
  const { node, removeLocalizedElement, replaceLocalizedChildren } = dom;
  const controls = controlsFactory({
    l10n,
    ...dom,
    getHass,
    getHaRoot,
    isEnabled: () => integrationEnabled,
  });
  const { loadHaComponents, focusWhenReady, icon, coloredIcon, button, iconButton, errorMessage } =
    controls;
  const { defaultSettings } = createProfileValidation(l10n);

  const BOOTSTRAP_POLL_MS = 350;
  const UI_RETRY_MS = 5000;
  const CONTEXT_FALLBACK_MS = 15000;
  const HA_CONTEXTS = [
    "connection",
    "user",
    "locale",
    "localize",
    "entities",
    "devices",
    "areas",
    "labels",
    "panels",
    "hassConnection",
    "hassConfig",
    "hassInternationalization",
    "hassRegistries",
    "hassFormatters",
    "hassUi",
  ];
  const CSS_URL = assetUrl("quick_access.css");
  const TOAST_DURATION_MS = 2200;
  const STORAGE_ERROR_MESSAGE = t("errors.browser_storage");

  const lifecycle = createLifecycle({
    getHass,
    onStatus: updateEnabled,
    onReady: () => {
      stopProfileSubscription();
      loadHaComponents(true);
      refreshHaContext();
    },
    onConnectedStatus: () => {
      if (integrationEnabled) void connectProfiles();
    },
  });
  const surfaces = createDialogs({ l10n, ui: { ...dom, ...controls } });
  const { createDialogElement, showDialogElement, cleanupDialogElement } = surfaces;
  const forms = createForms({ l10n, ui: { ...dom, ...controls }, getShell: () => shell });
  const {
    select,
    input,
    fieldValidation,
    validateFields,
    urlPathsField,
    currentUrlRules,
    searchField,
  } = forms;
  const profileUi = createProfileUi({
    l10n,
    ui: { ...dom, ...controls, ...surfaces },
    forms,
    host: {
      get dialog() {
        return dialog;
      },
      get shell() {
        return shell;
      },
      get currentView() {
        return currentView;
      },
      set currentView(value) {
        currentView = value;
      },
    },
    getProfiles: () => profileSession,
    getRegistryDialog: () => registryDialog,
    getHass,
    isEnabled: () => integrationEnabled,
    renderView,
    closeDialog,
    navigationChanged: () => navigationHistory.sync(),
  });
  const {
    hasProfileDraft,
    trackProfileDraft,
    hasUnsavedProfileChanges,
    afterDiscardingProfileChanges,
    requestCloseDialog,
    showProfileStatus,
    updateDialogDismissal,
    closeProfileDialog,
    closeProfileMenu,
    renderProfiles,
    quotaMessage,
    showMutationError,
    clearQuotaErrors,
    closeConfirmationDialog,
  } = profileUi;
  const profileSession = createProfileController({
    l10n,
    getHass,
    isEnabled: () => integrationEnabled,
    isInitialized: () => uiInitialized,
    onProfileApplied,
    applyConfirmedVisibility,
    showProfileStatus,
    clearQuotaErrors,
    updateVisibility: () => updateVisibility(),
    hasOpenDialog: () => Boolean(dialog),
    hasProfileDraft: () => hasProfileDraft() || Boolean(registryList?.hasFilterEditor),
    hasUnsavedChanges: () =>
      hasUnsavedProfileChanges() || hasUnsavedProfileChanges(profileUi.profileDialog),
    renderView,
    refreshView: () => {
      if (currentView === "devices" && currentProfile(profileSession.serverData) && registryList)
        registryList.refresh();
      else renderView();
    },
    afterDiscardingProfileChanges: (action, allowSaving) =>
      afterDiscardingProfileChanges(action, dialog, allowSaving),
    closeDialog,
    quotaMessage,
  });
  const {
    applyProfileData,
    currentProfile,
    profileContextIsCurrent,
    stopProfileSubscription,
    connectProfiles,
    syncDeviceSelection,
    saveSettings,
    saveRegistryFavorites,
  } = profileSession;
  const position = createPositionController({
    l10n,
    ui: { ...dom, ...controls },
    profiles: profileSession,
    isInitialized: () => uiInitialized,
    getDialog: () => dialog,
    hasProfile: () => Boolean(currentProfile(profileSession.serverData)),
    evaluateVisibility,
    openDialog,
    saveJson,
    showStorageError,
    clearStorageError,
  });
  const { applyPosition, hideMenu, removeButton, ensureButton, updateVisibility } = position;
  const shortcuts = createShortcutUi({
    l10n,
    ui: { ...dom, ...controls, ...surfaces },
    forms,
    profileSession,
    profileUi,
    host: {
      get dialog() {
        return dialog;
      },
      get shell() {
        return shell;
      },
      get currentView() {
        return currentView;
      },
      set currentView(value) {
        currentView = value;
      },
    },
    getConfig: () => config,
    getHass,
    toast,
    isEnabled: () => integrationEnabled,
    switchView,
    clearStorageError,
    navigationChanged: () => navigationHistory.sync(),
    commitNavigation: () => navigationHistory.commit(),
  });
  const { renderHome, renderShortcutsSettings, renderCategoriesSettings } = shortcuts;
  const statesView = createRegistryView();
  const devicesView = createRegistryView();
  const entityPresentation = createEntityPresentation({
    l10n,
    ui: { ...dom, ...controls },
    getHass,
  });
  const devicePresentation = createDevicePresentation({
    l10n,
    ui: { ...dom, ...controls },
    getHass,
    getRegistries: () => registryList?.source,
  });
  const { formattedState } = entityPresentation;
  const registryDialog = createRegistryDialog({
    l10n,
    ui: { ...dom, ...controls, createDialogElement, showDialogElement, cleanupDialogElement },
    getHass,
    getHaRoot,
    getRegistries: () => registryList?.source,
    host: {
      get dialog() {
        return dialog;
      },
      get shell() {
        return shell;
      },
    },
    statesView,
    devicesView,
    formattedState,
    deviceAreaName: devicePresentation.deviceAreaName,
    saveRegistryFavorites,
    showMutationError,
    clearStorageError,
    toast,
    clearToast,
    navigationChanged: () => navigationHistory.sync(),
    restoreDetails: (id, kind) => registryList?.openDetails(id, undefined, kind),
  });
  const navigationHistory = createNavigationHistory({
    read: readNavigation,
    restore: restoreNavigation,
    needsGuard: (route) =>
      Boolean(departingDraftRoot(route)) ||
      profileSession.profileSaving ||
      Boolean(profileUi.confirmationDialog),
    guard: (route, action) => {
      if (profileSession.profileSaving) return;
      if (profileUi.confirmationDialog) {
        // History has already restored the current entry. Dismiss only this
        // confirmation through its existing Cancel path, retaining its parent.
        if (profileUi.confirmationDialog.dataset.dismissOnBack === "true") {
          profileUi.confirmationDialog.dispatchEvent(new Event("cancel", { cancelable: true }));
        }
        return;
      }
      afterDiscardingProfileChanges(action, departingDraftRoot(route) || dialog);
    },
  });
  let registryList = null;
  let config;
  let dialog;
  let shell;
  let currentView = "home";
  let settingsReturnRow = "profiles";
  let lastPath = location.pathname;
  let lastUrl = currentPageUrl();
  let stylesheet = null;
  let globalListeners = null;
  let contextFallback = null;
  let stopContextObservation = null;
  let contextRoot = null;
  let buttonObserver = null;
  let bootstrapTimer = null;
  let uiInitialized = false;
  let initializationError = "";
  let initializationRetryAfter = 0;
  let integrationEnabled = false;

  function observeContext() {
    stopContextObservation?.();
    contextRoot = getHaRoot();
    stopContextObservation = observeHaContexts({
      root: contextRoot,
      contextTarget: document.body,
      contexts: HA_CONTEXTS,
      onChange: refreshHaContext,
    });
  }

  function refreshHaContext() {
    if (!uiInitialized) return;
    const hass = getHass();
    if (
      hass?.user?.id !== profileSession.profileUser ||
      hass?.connection !== profileSession.profileConnection
    ) {
      teardown();
      lifecycle.refresh();
      return;
    }
    if (contextRoot !== getHaRoot()) {
      observeContext();
    }
    void l10n.setHass(hass);
    registryList?.refreshContext();
  }

  function saveJson(key, value, description) {
    try {
      localStorage.setItem(`${profileSession.storageKey}:${key}`, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn(`[Quick Access] Could not save ${description}`, error);
      return false;
    }
  }
  function showStorageError() {
    const host =
      registryDialog.active?.querySelector(".qap-feedback") ||
      shell?.querySelector(".qap-feedback") ||
      position.menu;
    if (!host) return;
    let message = host.querySelector(".qap-storage-error");
    if (!message) {
      message = errorMessage();
      message.classList.add("qap-storage-error");
      host.append(message);
    }
    l10n.text(message, STORAGE_ERROR_MESSAGE);
  }
  function clearStorageError() {
    for (const host of [registryDialog.active, shell, position.menu])
      removeLocalizedElement(host?.querySelector(".qap-storage-error"));
  }
  function resetRegistryViews() {
    Object.assign(statesView, createRegistryView());
    Object.assign(devicesView, createRegistryView());
  }
  function saveListSearchHistory(kind, view) {
    if (!profileSession.activeProfileId || !currentProfile(profileSession.serverData)) return;
    if (saveJson(`${kind}-search-history`, view.history, "recent registry searches")) {
      clearStorageError();
    } else showStorageError();
  }
  function loadDeviceData() {
    position.load(readJson(`${profileSession.storageKey}:position`));
    for (const [kind, view] of [
      ["states", statesView],
      ["devices", devicesView],
    ]) {
      const savedHistory = readJson(`${profileSession.storageKey}:${kind}-search-history`);
      view.history = normalizeStatesSearchHistory(savedHistory);
      if (
        Array.isArray(savedHistory) &&
        JSON.stringify(savedHistory) !== JSON.stringify(view.history)
      ) {
        saveListSearchHistory(kind, view);
      }
    }
    if (position.fab) {
      applyPosition();
      updateVisibility();
    }
  }
  function onProfileApplied(profile, previousId, updateStorageScope) {
    if (previousId !== profileSession.activeProfileId) {
      stopStatesRefresh();
      registryDialog.close();
      resetRegistryViews();
      shortcuts.shortcutPage = 0;
      shortcuts.activeTab = "favorites";
      shortcuts.resetShortcutSearch();
      shortcuts.disposeView();
      profileUi.disposeView();
    }
    config = profile ? JSON.parse(JSON.stringify(profile.settings)) : defaultSettings();
    // An acknowledgement can be older than the latest subscription snapshot.
    // Keep its base revision, but never roll back confirmed visibility.
    applyConfirmedVisibility();
    if (!profile?.categories.some((category) => category.id === shortcuts.activeTab))
      shortcuts.activeTab = "favorites";
    statesView.favorites = new Set(profile?.favorites || []);
    devicesView.favorites = new Set(profile?.device_favorites || []);
    updateStorageScope();
    if (profileSession.storageKey) {
      if (previousId !== profileSession.activeProfileId) loadDeviceData();
    } else {
      statesView.history = devicesView.history = [];
      position.clear();
    }
    if (position.fab) {
      applyPosition();
      updateVisibility();
    }
  }
  function applyConfirmedVisibility() {
    const profile = currentProfile(profileSession.serverData);
    if (!profile) return;
    const { visibility, routes } = profile.settings;
    config = { ...config, visibility, routes: [...routes] };
  }
  function isAllowed() {
    const matches = config.routes.some((pattern) => routeMatches(pattern, currentPageUrl()));
    return config.visibility === "include" ? matches : !matches;
  }
  function evaluateVisibility() {
    // Wait for the instance scope before exposing the launcher on startup.
    if (!profileSession.serverData) return { visible: false, reason: "" };
    try {
      const key = launcherEnabledKey(
        profileSession.serverData.instance_id,
        profileSession.profileUser,
      );
      if (!readLauncherEnabled(key))
        return { visible: false, reason: t("visibility.launcher_disabled") };
    } catch {
      /* Unavailable browser storage keeps the default enabled behavior. */
    }
    if (!currentProfile(profileSession.serverData))
      return { visible: true, reason: t("visibility.setup_required") };
    if (!isAllowed())
      return {
        visible: false,
        reason:
          config.visibility === "include"
            ? t("visibility.hidden_not_included")
            : t("visibility.hidden_excluded"),
      };
    return { visible: true, reason: t("visibility.visible") };
  }
  function syncLauncherPreference(event) {
    if (!profileSession.serverData || !profileContextIsCurrent(profileSession.profileEpoch)) return;
    const key = launcherEnabledKey(
      profileSession.serverData.instance_id,
      profileSession.profileUser,
    );
    if (event.type === "storage") {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key !== null && event.key !== key) return;
    } else if (event.detail?.key !== key) return;
    updateVisibility();
  }
  function closeDialog() {
    if (!dialog) return;
    closeConfirmationDialog();
    shortcuts.closeCategoryEditor();
    closeProfileDialog(false);
    closeProfileMenu(false);
    registryDialog.close();
    const previous = dialog;
    clearToast(previous);
    shortcuts.disposeView();
    profileUi.disposeView();
    dialog = null;
    shell = null;
    shortcuts.resetShortcutSearch();
    profileUi.clearDrafts();
    stopStatesRefresh();
    updateVisibility();
    cleanupDialogElement(previous);
    if (!profileSession.profileSaving && profileSession.serverData)
      applyProfileData(profileSession.serverData);
    navigationHistory.sync();
  }
  function stopStatesRefresh() {
    registryList?.dispose();
    registryList = null;
  }
  function openDialog() {
    if (
      dialog ||
      !uiInitialized ||
      !integrationEnabled ||
      !position.fab?.isConnected ||
      position.fab.hidden
    )
      return;
    if (profileSession.serverData && !currentProfile(profileSession.serverData))
      applyProfileData(profileSession.serverData, null);
    let active;
    try {
      loadHaComponents(true);
      hideMenu();
      closeProfileMenu(false);
      closeProfileDialog(false);
      closeConfirmationDialog();
      currentView = "home";
      active = dialog = createDialogElement(t("launcher.title"));
      active.classList.add("qap-native-layout");
      active.removeAttribute("without-header");
      active.withoutHeader = false;
      for (const event of ["input", "change", "value-changed", "selected"]) {
        active.addEventListener(
          event,
          () => {
            void Promise.resolve().then(() => {
              if (dialog === active) updateDialogDismissal();
            });
          },
          { capture: true },
        );
      }
      shell = node("div", "qap-shell");
      dialog.append(shell);
      showDialogElement(active, () => {
        if (dialog === active) return requestCloseDialog();
      });
      updateVisibility();
      renderView();
      navigationHistory.commit();
    } catch (error) {
      console.warn("[Quick Access] Could not open dialog.", error);
      try {
        closeDialog();
      } catch (cleanupError) {
        console.warn("[Quick Access] Could not clean up failed dialog.", cleanupError);
      } finally {
        // Failed mounts must disappear immediately, even if closing fails.
        surfaces.cancelRemoval(active);
        removeLocalizedElement(active);
        dialog = null;
        shell = null;
        currentView = "home";
        position.fab?.classList.remove("qap-dialog-open");
      }
    }
  }
  function switchView(view, filterId = null) {
    if (!dialog) return;
    afterDiscardingProfileChanges(() => {
      closeConfirmationDialog();
      shortcuts.closeCategoryEditor();
      closeProfileDialog(false);
      closeProfileMenu(false);
      registryDialog.close();
      stopStatesRefresh();
      if (!profileSession.profileSaving && profileSession.serverData)
        applyProfileData(profileSession.serverData);
      currentView = view;
      if (["states", "devices"].includes(view)) {
        const listView = view === "devices" ? devicesView : statesView;
        listView.filter =
          filterId ||
          defaultFilter(
            profileFilters(currentProfile()),
            view,
            listView.favorites.size ? "favorites" : "all",
          );
        listView.shortcutFilter = filterId;
        if (filterId) {
          listView.search = "";
          listView.scrollTop = 0;
        }
      }
      renderView();
      navigationHistory.commit();
      const target =
        view === "settings"
          ? shell.querySelector(`.qap-settings-${settingsReturnRow}`)
          : dialog.querySelector(".qap-head-button");
      focusWhenReady(target, () => currentView === view && !profileUi.profileDialog);
    });
  }
  function openSettingsScreen(view) {
    settingsReturnRow = view;
    switchView(view);
  }
  function navigateBack() {
    if (!profileSession.activeProfileId || currentView === "home") {
      requestCloseDialog();
      return;
    }
    switchView(
      ["profiles", "shortcuts", "categories", "visibility"].includes(currentView)
        ? "settings"
        : "home",
    );
  }
  function readNavigation() {
    if (!dialog) return null;
    let listView = null;
    if (currentView === "states") listView = statesView;
    else if (currentView === "devices") listView = devicesView;
    return {
      view: currentView,
      listFilter: listView?.filter || null,
      listShortcutFilter: listView?.shortcutFilter || null,
      listProfileId: listView?.shortcutFilter ? profileSession.activeProfileId : null,
      modal: profileUi.dialogNavigation,
      category: shortcuts.categoryNavigation,
      menu: profileUi.menuNavigation,
      details: registryDialog.navigation,
      filter: registryList?.filterNavigation || null,
      filterReuse: registryList?.filterReuseNavigation || null,
    };
  }
  function departingDraftRoot(route) {
    const current = readNavigation();
    if (!current) return null;
    const changed = (part) => current[part]?.key !== route?.[part]?.key;
    if (!route || current.view !== route.view) {
      if (hasUnsavedProfileChanges(profileUi.profileDialog)) return profileUi.profileDialog;
      if (hasUnsavedProfileChanges()) return dialog;
      return null;
    }
    if (changed("modal") && hasUnsavedProfileChanges(profileUi.profileDialog))
      return profileUi.profileDialog;
    if (changed("filter") && hasUnsavedProfileChanges()) return dialog;
    const category = shortcuts.categoryRoot;
    return changed("category") && hasUnsavedProfileChanges(category) ? category : null;
  }
  function restoreNavigation(route) {
    if (!route) {
      closeDialog();
      return;
    }
    if (!dialog) openDialog();
    if (!dialog) return;
    const current = readNavigation();
    const changed = (part) => current[part]?.key !== route[part]?.key;
    const targetView =
      route.listProfileId && route.listProfileId !== profileSession.activeProfileId
        ? "home"
        : route.view;
    closeConfirmationDialog();
    if (changed("menu")) closeProfileMenu(false);
    if (changed("category")) shortcuts.closeCategoryEditor();
    if (changed("modal")) closeProfileDialog(false);
    if (changed("details")) registryDialog.close();
    if (changed("filterReuse")) registryList?.closeFilterReuse();
    if (changed("filter")) registryList?.closeFilters();
    if (
      current.view !== targetView ||
      current.listFilter !== route.listFilter ||
      current.listShortcutFilter !== route.listShortcutFilter
    ) {
      if (["profiles", "shortcuts", "categories", "visibility"].includes(route.view))
        settingsReturnRow = route.view;
      currentView = targetView;
      if (route.listFilter && ["states", "devices"].includes(targetView)) {
        (targetView === "devices" ? devicesView : statesView).filter = route.listFilter;
        (targetView === "devices" ? devicesView : statesView).shortcutFilter =
          route.listShortcutFilter || null;
      }
      if (!profileSession.profileSaving && profileSession.serverData)
        applyProfileData(profileSession.serverData);
      renderView();
    }
    if (route.filter && readNavigation().filter?.key !== route.filter.key)
      registryList?.openFilters(route.filter.mode, route.filter.id);
    if (route.filterReuse && readNavigation().filterReuse?.key !== route.filterReuse.key)
      registryList?.openFilterReuse();
    // A modal normally hosts an inline category editor; a nested shortcut editor sits above one.
    for (const part of route.modal?.above === "category"
      ? ["category", "modal", "menu", "details"]
      : ["modal", "category", "menu", "details"]) {
      if (route[part] && readNavigation()[part]?.key !== route[part].key) route[part].open();
    }
  }
  function toast(message) {
    const host =
      registryDialog.active?.querySelector(".qap-feedback") ||
      shell?.querySelector(".qap-feedback");
    if (!host) return;
    let control = host.querySelector("qap-toast");
    if (!control) {
      control = node("qap-toast");
      control.timeoutMs = TOAST_DURATION_MS;
      replaceLocalizedChildren(host, control);
    }
    l10n.property(control, "labelText", message);
    void control.show();
  }
  function clearToast(container) {
    const host = container?.querySelector(".qap-feedback");
    if (host) replaceLocalizedChildren(host);
  }
  function currentPageBookmarkIcon() {
    const saved = config.links.some(
      (link) =>
        link.type === "internal" &&
        (link.path === location.pathname || link.path === currentPageUrl()),
    );
    return saved ? "mdi:bookmark-plus" : "mdi:bookmark-plus-outline";
  }
  function renderView() {
    if (!dialog) return;
    if (!shell) return;
    // Update the owned surface in place, preserving its controls and draft.
    const view = !profileSession.activeProfileId ? "profiles" : currentView;
    shortcuts.prepareView(view);
    profileUi.prepareView(view);
    const wide = ["settings", "shortcuts", "categories", "visibility", "profiles"].includes(view);
    dialog.setAttribute("width", wide ? "large" : "medium");
    dialog.classList.toggle("qap-home-dialog", view === "home");
    dialog.classList.toggle("qap-states-dialog", ["states", "devices"].includes(view));
    dialog.classList.toggle("qap-categories-dialog", view === "categories");
    dialog.classList.toggle(
      "qap-reorder-dialog",
      ["profiles", "shortcuts", "categories"].includes(view),
    );
    dialog.classList.toggle("qap-visibility-dialog", view === "visibility");
    dialog.classList.toggle("qap-settings-dialog", wide);
    dialog.classList.toggle(
      "qap-tall-dialog",
      ["states", "devices", "profiles", "shortcuts", "categories", "visibility"].includes(view),
    );
    // Lists retain bounded scroll viewports so their headers remain visible.
    dialog.flexContent = [
      "states",
      "devices",
      "profiles",
      "shortcuts",
      "categories",
      "visibility",
    ].includes(view);
    if (dialog.flexContent) dialog.setAttribute("flexcontent", "");
    else dialog.removeAttribute("flexcontent");
    stopStatesRefresh();
    shortcuts.closeCategoryEditor();
    closeProfileDialog(false);
    closeProfileMenu(false);
    clearToast(shell);
    for (const chrome of dialog.querySelectorAll(".qap-dialog-chrome"))
      removeLocalizedElement(chrome);
    replaceLocalizedChildren(shell);
    const goBack = profileSession.activeProfileId && view !== "home";
    const navigation = iconButton(
      goBack ? "mdi:arrow-left" : "mdi:close",
      goBack ? t("common.back") : t("common.close"),
      goBack ? navigateBack : requestCloseDialog,
      `qap-head-button${view === "settings" ? " qap-back-settings" : ""}`,
    );
    let titleText;
    if (!profileSession.activeProfileId) {
      titleText = t("fab.setup");
    } else {
      switch (currentView) {
        case "profiles":
          titleText = t("profiles.title");
          break;
        case "home":
          titleText = t("launcher.title");
          break;
        case "devices":
          titleText = t("devices.title");
          break;
        case "states":
          titleText = t("entities.title");
          break;
        case "settings":
          titleText = t("common.settings");
          break;
        case "shortcuts":
          titleText = t("settings.shortcuts");
          break;
        case "categories":
          titleText = t("settings.categories");
          break;
        default:
          titleText = t("settings.visibility");
      }
    }
    const right = node("div", "qap-head-actions");
    if (view === "profiles") {
      const create = iconButton(
        "mdi:plus",
        t("profiles.create"),
        () => profileUi.openProfileEditor("create", null, create),
        "qap-head-button qap-create-profile",
      );
      create.disabled = !profileSession.serverData;
      right.append(create);
    }
    if (view === "shortcuts")
      right.append(
        iconButton(
          "mdi:plus",
          t("shortcuts.add"),
          () => shortcuts.openShortcutEditor(),
          "qap-head-button qap-add-shortcut",
        ),
      );
    if (view === "categories")
      right.append(
        iconButton(
          "mdi:plus",
          t("categories.add"),
          () => shortcuts.createCategory(),
          "qap-head-button qap-create-category",
        ),
      );
    if (view === "home") {
      const search = iconButton(
        "mdi:magnify",
        t("shortcuts.search"),
        () => {
          shortcuts.toggleShortcutSearch();
          search.setAttribute("aria-expanded", String(shortcuts.shortcutSearchVisible));
        },
        "qap-head-button qap-search-shortcuts",
      );
      search.setAttribute("aria-controls", "qap-shortcut-search");
      search.setAttribute("aria-expanded", String(shortcuts.shortcutSearchVisible));
      right.append(
        search,
        iconButton(
          currentPageBookmarkIcon(),
          t("shortcuts.save_current_page"),
          () =>
            shortcuts.openShortcutEditor({
              path: location.pathname,
              category: shortcuts.activeTab,
              returnView: "home",
            }),
          "qap-head-button qap-save-current-page",
        ),
        iconButton(
          "mdi:cog",
          t("common.settings"),
          () => switchView("settings"),
          "qap-head-button",
        ),
      );
    }
    if (["states", "devices"].includes(view))
      right.append(
        iconButton(
          "mdi:filter",
          t("filters.title"),
          () => {
            registryList?.openFilters();
          },
          "qap-head-button qap-filter-action",
        ),
      );
    l10n.property(dialog, "headerTitle", titleText);
    l10n.attribute(dialog, "aria-label", titleText);
    navigation.slot = "headerNavigationIcon";
    navigation.classList.add("qap-dialog-chrome");
    right.slot = "headerActionItems";
    right.classList.add("qap-dialog-chrome");
    dialog.append(navigation, right);
    shell.append(node("div", "qap-profile-status"));

    const body = node("div", "qap-body");
    shell.append(body);
    shell.append(node("div", "qap-feedback"));
    if (!profileSession.activeProfileId || currentView === "profiles") renderProfiles(body);
    else if (currentView === "home") renderHome(body);
    else if (currentView === "states") renderStates(body);
    else if (currentView === "devices") renderDevices(body);
    else if (currentView === "settings") renderSettings(body);
    else if (currentView === "shortcuts") renderShortcutsSettings(body);
    else if (currentView === "categories") renderCategoriesSettings(body);
    else if (currentView === "visibility") {
      const content = node("div", "qap-settings");
      renderVisibilityControls(content);
      body.append(content);
    }
    showProfileStatus();
  }
  function renderStates(body) {
    renderRegistryList(body, "states");
  }
  function renderDevices(body) {
    renderRegistryList(body, "devices");
  }
  function renderRegistryList(body, kind) {
    registryList = mountRegistryList(body, {
      kind,
      view: kind === "devices" ? devicesView : statesView,
      l10n,
      ui: { ...dom, ...controls, ...surfaces, searchField },
      parentDialog: dialog,
      getHass,
      getHaRoot,
      isEnabled: () => integrationEnabled,
      contextTarget: shell,
      details: registryDialog,
      forms,
      profileUi,
      getFilters: () => profileFilters(currentProfile()),
      getProfiles: () => profileSession.serverData?.profiles || [],
      getLinkedShortcuts: (id) => linkedFilterShortcuts(currentProfile(), kind, id),
      saveFilters: (filters, deletedId) => {
        const profile = currentProfile();
        if (!profile) return Promise.resolve(false);
        const linkedIds = new Set(
          deletedId ? linkedFilterShortcuts(profile, kind, deletedId).map((link) => link.id) : [],
        );
        return profileSession.mutateProfile("update", {
          ...profile,
          filters,
          settings: {
            ...profile.settings,
            links: profile.settings.links.filter((link) => !linkedIds.has(link.id)),
          },
        });
      },
      navigationChanged: () => navigationHistory.sync(),
      canSaveHistory: () =>
        Boolean(profileSession.activeProfileId && currentProfile(profileSession.serverData)),
      saveHistory: saveListSearchHistory,
    });
  }

  function renderVisibilityControls(content) {
    content.classList.add("qap-visibility");
    const mode = select(
      t("visibility.rule"),
      [
        ["exclude", t("visibility.exclude")],
        ["include", t("visibility.include")],
      ],
      config.visibility,
    );
    const paths = node("textarea", "qap-control qap-textarea");
    l10n.property(paths, "placeholder", "/config/automation/*\n/lovelace/cameras");
    paths.value = config.routes.join("\n");
    content.append(mode.element);
    const pathsField = urlPathsField(paths, mode);
    content.append(pathsField);
    const pathsValidation = fieldValidation(
      paths,
      () => {
        const cleanPaths = parseRoutes(paths.value);
        if (cleanPaths.some((path) => !path.startsWith("/"))) return t("visibility.invalid_route");
        return mode.value === "include" && !cleanPaths.length ? t("visibility.route_required") : "";
      },
      pathsField,
    );
    mode.onChange(pathsValidation.revalidate);
    const validations = [pathsValidation];
    const currentPath = window.location.pathname;
    content.append(currentUrlRules(paths, currentPath));
    const note = errorMessage();
    content.append(note);
    const markSaved = trackProfileDraft(content, () => [mode.value, paths.value]);
    const save = button(
      t("common.save"),
      async () => {
        l10n.text(note, "");
        if (!validateFields(validations)) return;
        const cleanPaths = parseRoutes(paths.value);
        const next = { ...config, visibility: mode.value, routes: cleanPaths };
        if (!(await saveSettings(next))) {
          showMutationError(note);
          if (note.isConnected) note.scrollIntoView({ block: "nearest" });
          return;
        }
        if (!dialog?.contains(save)) return;
        l10n.text(note, "");
        clearStorageError();
        updateVisibility();
        markSaved();
        switchView("home");
      },
      "qap-button-primary qap-save-settings",
    );
    appendSettingsFooter(save);
  }
  function appendSettingsFooter(action) {
    const footer = node("div", "qap-settings-footer");
    action.slot = action.className.split(" ").includes("qap-button-secondary")
      ? "secondaryAction"
      : "primaryAction";
    footer.append(action);
    footer.slot = "footer";
    footer.classList.add("qap-dialog-chrome");
    dialog.append(footer);
  }
  function renderSettings(body) {
    const profile = currentProfile();
    const content = node("div", "qap-settings qap-settings-overview");
    const section = (title) => {
      const group = node("section", "qap-settings-section");
      group.append(node("h3", "qap-settings-section-title", title));
      content.append(group);
      return group;
    };
    const row = (view, title, description, symbol) => {
      const action = node(
        "qap-list-item",
        `qap-settings-row qap-settings-${view}${view === "profiles" ? " qap-manage-profiles" : ""}`,
      );
      const badge = node("span", "qap-settings-icon");
      badge.append(coloredIcon(view === "profiles" ? profile : { icon: symbol }));
      const text = node("span", "qap-settings-row-text");
      text.append(node("strong", "", title), node("small", "qap-muted", description));
      const chevron = icon("mdi:chevron-right");
      badge.slot = "start";
      text.slot = "content";
      chevron.slot = "end";
      action.append(badge, text, chevron);
      action.addEventListener("click", () => openSettingsScreen(view));
      return action;
    };
    const list = (...items) => {
      const host = node("qap-list", "qap-settings-list");
      host.append(...items.map((item) => row(...item)));
      return host;
    };
    section(t("settings.active_profile")).append(
      list(["profiles", profile.name, t("settings.manage_profiles"), profile.icon]),
    );
    const configuration = section(t("settings.profile_configuration"));
    configuration.append(
      list(
        [
          "shortcuts",
          t("settings.shortcuts"),
          t("shortcuts.count", { count: profile.settings.links.length }),
          "mdi:view-grid-outline",
        ],
        [
          "categories",
          t("settings.categories"),
          t("settings.category_count", { count: profile.categories.length }),
          "mdi:folder-outline",
        ],
        [
          "visibility",
          t("settings.visibility"),
          visibilitySummary(profile.settings),
          "mdi:eye-outline",
        ],
      ),
    );
    body.append(content);
  }
  function visibilitySummary(settings) {
    if (!settings.routes.length)
      return t(
        settings.visibility === "include"
          ? "settings.hidden_everywhere"
          : "settings.shown_everywhere",
      );
    return t(
      settings.visibility === "include" ? "settings.shown_routes" : "settings.hidden_routes",
      { count: settings.routes.length },
    );
  }
  function bootstrap() {
    void l10n.setHass(getHass());
    const hass = getHass();
    if (
      uiInitialized &&
      (hass?.user?.id !== profileSession.profileUser ||
        hass?.connection !== profileSession.profileConnection)
    )
      teardown();
    if (uiInitialized) return true;
    if (
      !integrationEnabled ||
      !hass?.user?.id ||
      !hass.states ||
      !hass.connection ||
      !document.head ||
      !document.body ||
      Date.now() < initializationRetryAfter
    )
      return false;
    try {
      profileSession.reset(hass);
      resetRegistryViews();
      position.clear();
      config = defaultSettings();
      stylesheet = node("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = CSS_URL;
      document.head.append(stylesheet);

      const routeUpdate = () => {
        refreshHaContext();
        if (!uiInitialized) return;
        // HA dialogs also update history; only page navigation closes Quick Access.
        const pathChanged = lastPath !== location.pathname;
        lastPath = location.pathname;
        lastUrl = currentPageUrl();
        navigationHistory.routeChanged();
        // Let HA own navigation; retain Quick Access drafts until discard is confirmed.
        if (dialog && pathChanged) requestCloseDialog();
        dialog
          ?.querySelector(".qap-save-current-page")
          ?.querySelector("qap-icon")
          ?.setAttribute("icon", currentPageBookmarkIcon());
        updateVisibility();
      };
      globalListeners = new AbortController();
      const options = { signal: globalListeners.signal };
      navigationHistory.start(globalListeners.signal);
      window.addEventListener(PROFILE_SELECTION_EVENT, syncDeviceSelection, options);
      window.addEventListener(LAUNCHER_PREFERENCE_EVENT, syncLauncherPreference, options);
      window.addEventListener(
        "storage",
        (event) => {
          syncDeviceSelection(event);
          syncLauncherPreference(event);
        },
        options,
      );
      window.addEventListener("location-changed", routeUpdate, options);
      window.addEventListener("popstate", routeUpdate, options);
      window.addEventListener("hashchange", routeUpdate, options);
      window.navigation?.addEventListener("currententrychange", routeUpdate, options);
      window.addEventListener("focus", refreshHaContext, options);
      document.addEventListener(
        "visibilitychange",
        () => {
          if (!document.hidden) {
            refreshHaContext();
            if (uiInitialized) routeUpdate();
          }
        },
        options,
      );
      window.addEventListener(
        "beforeunload",
        (event) => {
          if (!hasUnsavedProfileChanges() && !hasUnsavedProfileChanges(profileUi.profileDialog))
            return;
          event.preventDefault();
          event.returnValue = "";
        },
        options,
      );
      window.addEventListener(
        "resize",
        () => {
          applyPosition();
          hideMenu();
          updateVisibility();
        },
        options,
      );
      document.addEventListener(
        "pointerdown",
        (event) => {
          if (
            position.menu &&
            !position.menu.hidden &&
            !position.menu.contains(event.target) &&
            event.target !== position.fab
          )
            hideMenu();
        },
        options,
      );
      lastPath = location.pathname;
      lastUrl = currentPageUrl();
      contextFallback = setInterval(() => {
        // Older HA versions may omit context updates and route events.
        refreshHaContext();
        if (!uiInitialized) return;
        if (lastUrl !== currentPageUrl()) routeUpdate();
        ensureButton();
      }, CONTEXT_FALLBACK_MS);
      uiInitialized = true;
      observeContext();
      buttonObserver = new MutationObserver(() => {
        if (!uiInitialized) return;
        refreshHaContext();
        if (uiInitialized) ensureButton();
      });
      buttonObserver.observe(document.body, { childList: true });
      initializationError = "";
      initializationRetryAfter = 0;
      void connectProfiles();
      ensureButton();
      console.info(`[Quick Access] v${VERSION} loaded.`);
      return true;
    } catch (error) {
      teardown();
      initializationError = error?.message || String(error);
      initializationRetryAfter = Date.now() + UI_RETRY_MS;
      console.warn("[Quick Access] Could not initialize the frontend; retrying.", error);
      return false;
    }
  }

  function teardown() {
    navigationHistory.dispose();
    uiInitialized = false;
    initializationError = position.buttonError = "";
    initializationRetryAfter = position.buttonRetryAfter = 0;
    stopProfileSubscription();
    controls.dispose();
    clearTimeout(bootstrapTimer);
    bootstrapTimer = null;
    clearInterval(contextFallback);
    contextFallback = null;
    stopContextObservation?.();
    stopContextObservation = null;
    contextRoot = null;
    buttonObserver?.disconnect();
    buttonObserver = null;
    stopStatesRefresh();
    const activeDialog = dialog;
    const activeConfirmationDialog = profileUi.confirmationDialog;
    const activeProfileDialog = profileUi.profileDialog;
    closeDialog();
    activeDialog?.remove();
    activeConfirmationDialog?.remove();
    activeProfileDialog?.remove();
    surfaces.dispose();
    globalListeners?.abort();
    globalListeners = null;
    removeButton();
    l10n.clear();
    stylesheet?.remove();
    stylesheet = null;
    profileSession.dispose();
    config = defaultSettings();
    resetRegistryViews();
  }

  function bootstrapWhenReady() {
    bootstrapTimer = null;
    if (!integrationEnabled || bootstrap()) return;
    bootstrapTimer = setTimeout(bootstrapWhenReady, BOOTSTRAP_POLL_MS);
  }

  function updateEnabled({ enabled }) {
    integrationEnabled = enabled === true;
    if (!integrationEnabled) {
      teardown();
    } else if (!bootstrapTimer) bootstrapWhenReady();
  }

  window.quickAccessDebug = () => {
    const hass = getHass();
    const visibility = config ? evaluateVisibility() : null;
    if (visibility) visibility.reason = String(visibility.reason);
    return {
      version: VERSION,
      origin: location.origin,
      moduleLoaded: true,
      integrationEnabled,
      initialized: uiInitialized,
      initializationError,
      buttonError: position.buttonError,
      profileContextReady: uiInitialized && profileContextIsCurrent(profileSession.profileEpoch),
      hassAvailable: Boolean(hass),
      userReady: Boolean(hass?.user?.id),
      statesReady: Boolean(hass?.states),
      lifecycleSubscribed: lifecycle.subscribed,
      lifecyclePending: lifecycle.pending,
      lifecycleError: lifecycle.error,
      connectionConnected: hass?.connection?.connected ?? null,
      cssLoaded: Array.from(document.styleSheets).some((sheet) => sheet.href?.includes(CSS_URL)),
      viewportWidth: window.innerWidth,
      buttonHidden: position.fab ? position.fab.hidden : null,
      buttonConnected: Boolean(position.fab?.isConnected),
      dialogOpen: Boolean(dialog?.open),
      visibility,
      limits: profileSession.serverData?.limits,
      usage: profileSession.serverData?.usage,
      hiddenByRoute: config ? !isAllowed() : null,
      secureContext: window.isSecureContext,
      clipboardAvailable: Boolean(navigator.clipboard?.writeText),
      activeProfileId: profileSession.activeProfileId,
      profileRevision: profileSession.baseData?.revision ?? null,
      serverRevision: profileSession.serverData?.revision ?? null,
      profileSaving: profileSession.profileSaving,
      profileError: String(profileSession.profileError),
    };
  };
  return {
    start: () => lifecycle.start(),
    dispose() {
      integrationEnabled = false;
      lifecycle.dispose();
      teardown();
    },
  };
}
