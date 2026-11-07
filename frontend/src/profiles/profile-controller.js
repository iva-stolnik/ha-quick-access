import {
  DEFAULT_PROFILE_ICON,
  DEFAULT_PROFILE_COLOR,
  DEVICE_STORAGE_PREFIX,
  SHORTCUT_LIMIT,
} from "./profile-defaults.js";
import { createProfileValidation } from "./profile-validation.js";
import {
  readProfileSelection,
  writeProfileSelection,
  profileSelectionKey,
} from "../utils/storage.js";
import { subscribeProfiles, sendProfileMutation } from "../data/profile-api.js";
import { newId } from "../utils/ids.js";

export function createProfileController({
  l10n,
  getHass,
  isEnabled,
  isInitialized,
  onProfileApplied,
  applyConfirmedVisibility,
  showProfileStatus,
  clearQuotaErrors,
  updateVisibility,
  hasOpenDialog,
  hasProfileDraft,
  hasUnsavedChanges,
  renderView,
  refreshView,
  afterDiscardingProfileChanges,
  closeDialog,
  quotaMessage,
}) {
  const t = l10n.message;
  const PROFILE_ERROR_MESSAGE = t("errors.server_save");
  const SUBSCRIBE_RETRY_MS = 5000;
  const { validateProfileData, defaultSettings, defaultCategories, profileNameError } =
    createProfileValidation(l10n);
  let storageKey;
  let profileUser = null;
  let profileConnection = null;
  let profileEpoch = 0;
  let profileUnsubscribe = null;
  let profileRetryTimer = null;
  let serverData = null;
  let baseData = null;
  let activeProfileId = null;
  let selectionGeneration = 0;
  let deviceKey = null;
  let profileSubscribeEpoch = null;
  let profileSaving = false;
  let profileSaveGeneration = 0;
  let profileError = "";
  let profileErrorCode = "";
  let localWarning = "";
  let pendingCreate = null;
  function applyProfileData(data, selectedId = activeProfileId) {
    if (!data) return;
    const previousId = activeProfileId;
    const profile = data.profiles.find((item) => item.id === selectedId);
    baseData = data;
    activeProfileId = profile?.id ?? null;
    onProfileApplied(profile, previousId, () => {
      storageKey = activeProfileId ? `${deviceKey}:${activeProfileId}` : null;
    });
    profileError = profileErrorCode = "";
    showProfileStatus();
  }
  function currentProfile(data = baseData) {
    return data?.profiles.find((profile) => profile.id === activeProfileId);
  }

  function profileContextIsCurrent(epoch, user = profileUser, connection = profileConnection) {
    return (
      isEnabled() &&
      epoch === profileEpoch &&
      getHass()?.user?.id === user &&
      getHass()?.connection === connection
    );
  }

  function receiveProfileData(value, epoch) {
    if (!profileContextIsCurrent(epoch)) return;
    try {
      const next = validateProfileData(value);
      if (serverData && next.instance_id !== serverData.instance_id)
        throw l10n.error(t("profiles.errors.instance_changed"));
      if (serverData && next.revision < serverData.revision) return;
      const initial = !serverData;
      const previousLimits = serverData?.limits;
      serverData = next;
      clearQuotaErrors(previousLimits, next.limits);
      if (initial) {
        deviceKey = `${DEVICE_STORAGE_PREFIX}${next.instance_id}:${profileUser}`;
        let selected = null;
        try {
          selected = readProfileSelection(profileSelectionKey(next.instance_id, profileUser));
        } catch {
          localWarning = t("profiles.errors.selection_read_failed");
        }
        applyProfileData(next, typeof selected === "string" ? selected : null);
      } else if (!profileSaving && !hasProfileDraft()) applyProfileData(next);
      else {
        // Confirmed visibility takes effect while editors retain their drafts
        // and base revision, so recovery cannot be overwritten by a stale save.
        applyConfirmedVisibility();
      }
      updateVisibility();
      showProfileStatus();
      if (!profileSaving && hasOpenDialog() && (initial || !hasProfileDraft())) refreshView();
    } catch (error) {
      profileError = l10n.errorMessage(error);
      showProfileStatus();
    }
  }

  function stopProfileSubscription() {
    profileEpoch++;
    clearTimeout(profileRetryTimer);
    profileRetryTimer = null;
    const unsubscribe = profileUnsubscribe;
    profileUnsubscribe = null;
    if (unsubscribe)
      void Promise.resolve()
        .then(unsubscribe)
        .catch(() => {});
    profileSubscribeEpoch = null;
    profileSaving = false;
  }

  async function connectProfiles() {
    if (
      !isInitialized() ||
      !profileContextIsCurrent(profileEpoch) ||
      profileSubscribeEpoch === profileEpoch ||
      profileUnsubscribe
    )
      return;
    const epoch = profileEpoch;
    profileSubscribeEpoch = epoch;
    const connection = profileConnection;
    showProfileStatus();
    try {
      const unsubscribe = await subscribeProfiles(connection, (value) =>
        receiveProfileData(value, epoch),
      );
      if (!profileContextIsCurrent(epoch)) {
        await unsubscribe();
        return;
      }
      profileUnsubscribe = unsubscribe;
      clearTimeout(profileRetryTimer);
      profileRetryTimer = null;
      showProfileStatus();
    } catch (error) {
      if (!profileContextIsCurrent(epoch)) return;
      profileError = l10n.errorMessage(error) || t("profiles.errors.load_failed");
      showProfileStatus();
      profileRetryTimer = setTimeout(() => {
        profileRetryTimer = null;
        void connectProfiles();
      }, SUBSCRIBE_RETRY_MS);
    } finally {
      if (profileEpoch === epoch) profileSubscribeEpoch = null;
    }
  }

  async function mutateProfile(
    operation,
    profile,
    { useLatest = false, expectedRevision = (useLatest ? serverData : baseData)?.revision } = {},
  ) {
    if (profileSaving) return false;
    if (
      !serverData ||
      !profileContextIsCurrent(profileEpoch) ||
      profileConnection.connected === false
    ) {
      profileError = t("profiles.errors.disconnected");
      showProfileStatus();
      return false;
    }
    const previous =
      operation === "create" ? null : baseData?.profiles.find((item) => item.id === profile.id);
    if (
      ["create", "update"].includes(operation) &&
      profile.settings.links.length > SHORTCUT_LIMIT &&
      profile.settings.links.length > (previous?.settings.links.length ?? 0)
    ) {
      profileErrorCode = "shortcut_limit";
      profileError = t("shortcuts.limit", { limit: SHORTCUT_LIMIT });
      showProfileStatus();
      return false;
    }
    const epoch = profileEpoch;
    const selectedId = activeProfileId;
    const selectedGeneration = selectionGeneration;
    const saveGeneration = ++profileSaveGeneration;
    profileSaving = true;
    profileError = "";
    showProfileStatus();
    try {
      const result = await sendProfileMutation(
        profileConnection,
        operation,
        profile,
        expectedRevision,
      );
      if (
        !profileContextIsCurrent(epoch) ||
        activeProfileId !== selectedId ||
        selectedGeneration !== selectionGeneration
      )
        return false;
      const saved = validateProfileData(result);
      if (saved.instance_id !== serverData.instance_id)
        throw l10n.error(t("profiles.errors.refresh_instance"));
      if (saved.revision >= serverData.revision) serverData = saved;
      const nextId = operation === "create" ? profile.id : selectedId;
      if (
        saved.revision < serverData.revision &&
        !serverData.profiles.some((item) => item.id === nextId) &&
        !hasUnsavedChanges()
      ) {
        // A newer deletion wins once no unsaved form needs the old snapshot.
        applyProfileData(serverData, nextId);
        renderView();
      } else {
        // Use the acknowledged version as the base. Later remote changes remain
        // pending; the next write will conflict instead of overwriting them.
        applyProfileData(saved, nextId);
      }
      return true;
    } catch (error) {
      if (profileContextIsCurrent(epoch) && selectedGeneration === selectionGeneration) {
        profileErrorCode = error.code || "";
        switch (error.code) {
          case "shortcut_limit":
            profileError = t("shortcuts.limit", { limit: SHORTCUT_LIMIT });
            break;
          case "conflict":
            profileError = t("profiles.errors.conflict");
            break;
          default:
            profileError = l10n.errorMessage(error) || PROFILE_ERROR_MESSAGE;
        }
        showProfileStatus();
      }
      return false;
    } finally {
      // A refresh can invalidate the response without ending this save's lock.
      // Only a newer save or context can supersede its cleanup.
      if (profileContextIsCurrent(epoch) && saveGeneration === profileSaveGeneration) {
        profileSaving = false;
        showProfileStatus();
      }
    }
  }

  function rememberProfileSelection() {
    try {
      const key = `${deviceKey}:active-profile`;
      writeProfileSelection(key, activeProfileId);
      return true;
    } catch {
      localWarning = t("profiles.status.session_selection");
      showProfileStatus();
      return false;
    }
  }

  function syncDeviceSelection(event) {
    const key = deviceKey && `${deviceKey}:active-profile`;
    if (!key || !serverData || !profileContextIsCurrent(profileEpoch)) return;
    if (event.type === "storage") {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key !== null && event.key !== key) return;
    } else if (event.detail?.key !== key) return;
    let selected;
    try {
      selected = readProfileSelection(key);
    } catch {
      localWarning = t("profiles.errors.selection_read_failed");
      showProfileStatus();
      return;
    }
    const nextId = typeof selected === "string" ? selected : null;
    if (nextId === activeProfileId) {
      if (!event.detail?.refresh) return;
      selectionGeneration++;
      const profile = currentProfile(serverData);
      if (profile && (profileSaving || hasProfileDraft())) {
        // Apply confirmed visibility while retaining the editor's base revision.
        // Its next save must conflict instead of overwriting concurrent changes.
        applyConfirmedVisibility();
        updateVisibility();
        showProfileStatus();
      } else {
        applyProfileData(serverData);
        renderView();
      }
      return;
    }
    // Selection changes invalidate open editors, but never write profiles.
    // An external device selection must also supersede an in-flight response.
    afterDiscardingProfileChanges(() => {
      selectionGeneration++;
      closeDialog();
      profileSaving = false;
      applyProfileData(serverData, nextId);
    }, true);
  }

  async function createProfile(
    name,
    settings = defaultSettings(),
    favorites = [],
    profileIcon = DEFAULT_PROFILE_ICON,
    categories = defaultCategories(),
    color = DEFAULT_PROFILE_COLOR,
    deviceFavorites = [],
    filters,
  ) {
    const fingerprint = JSON.stringify({
      name: name.trim(),
      icon: profileIcon,
      color,
      settings,
      favorites,
      categories,
      deviceFavorites,
      filters,
    });
    const profile = {
      id: pendingCreate?.fingerprint === fingerprint ? pendingCreate.id : newId(),
      name: name.trim(),
      icon: profileIcon,
      color,
      settings: JSON.parse(JSON.stringify(settings)),
      favorites: [...favorites],
      device_favorites: [...deviceFavorites],
      categories: JSON.parse(JSON.stringify(categories)),
    };
    if (filters) profile.filters = JSON.parse(JSON.stringify(filters));
    const nameError = profileNameError(name);
    if (nameError) {
      profileError = nameError;
      showProfileStatus();
      return false;
    }
    pendingCreate = { fingerprint, id: profile.id };
    if (serverData?.profiles.some((item) => item.id === profile.id)) {
      // A subscription may confirm a create whose command response was lost.
      applyProfileData(serverData, profile.id);
      rememberProfileSelection();
      pendingCreate = null;
      renderView();
      return true;
    }
    if (serverData?.profiles.length >= serverData.limits.max_profiles) {
      profileErrorCode = "profile_limit";
      profileError = quotaMessage("profiles");
      showProfileStatus();
      return false;
    }
    if (!(await mutateProfile("create", profile, { useLatest: true }))) return false;
    rememberProfileSelection();
    pendingCreate = null;
    renderView();
    return true;
  }

  async function saveSettings(nextConfig, options) {
    const profile = currentProfile();
    if (!profile) return false;
    return mutateProfile("update", { ...profile, settings: nextConfig }, options);
  }

  async function saveRegistryFavorites(kind, favorites) {
    const profile = currentProfile();
    const field = kind === "devices" ? "device_favorites" : "favorites";
    return profile ? mutateProfile("update", { ...profile, [field]: favorites }) : false;
  }

  return {
    applyProfileData,
    currentProfile,
    profileContextIsCurrent,
    stopProfileSubscription,
    connectProfiles,
    mutateProfile,
    rememberProfileSelection,
    syncDeviceSelection,
    createProfile,
    saveSettings,
    saveRegistryFavorites,
    get storageKey() {
      return storageKey;
    },
    get profileUser() {
      return profileUser;
    },
    get profileConnection() {
      return profileConnection;
    },
    get profileEpoch() {
      return profileEpoch;
    },
    get serverData() {
      return serverData;
    },
    get baseData() {
      return baseData;
    },
    get activeProfileId() {
      return activeProfileId;
    },
    get deviceKey() {
      return deviceKey;
    },
    get profileSaving() {
      return profileSaving;
    },
    get profileError() {
      return profileError;
    },
    set profileError(value) {
      profileError = value;
    },
    get profileErrorCode() {
      return profileErrorCode;
    },
    set profileErrorCode(value) {
      profileErrorCode = value;
    },
    get localWarning() {
      return localWarning;
    },
    set localWarning(value) {
      localWarning = value;
    },
    reset(hass) {
      profileUser = hass?.user?.id ?? null;
      profileConnection = hass?.connection ?? null;
      serverData = baseData = null;
      deviceKey = storageKey = activeProfileId = null;
      pendingCreate = null;
      localWarning = profileError = profileErrorCode = "";
      profileSaving = false;
    },
    dispose() {
      stopProfileSubscription();
      serverData = baseData = null;
      activeProfileId = storageKey = deviceKey = null;
    },
  };
}
