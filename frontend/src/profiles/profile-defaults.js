export const PROFILE_VERSION = 1;
export const SHORTCUT_NAME_MAX_LENGTH = 50;
export const SHORTCUT_PAGE_SIZE = 50;
export const DEFAULT_SHORTCUT_GRID = Object.freeze({ rows: 4, columns: 3 });
export const SHORTCUT_GRID_MAX_DIMENSION = 10;
export const SHORTCUT_LIMIT = 500;
export const CATEGORY_NAME_MAX_LENGTH = 50;
export const PROFILE_NAME_MAX_LENGTH = 80;
export const DEFAULT_ICON = "mdi:view-grid-outline";
export const DEFAULT_PROFILE_ICON = "mdi:devices";
export const DEFAULT_PROFILE_COLOR = "indigo";
export const STATES_PATH = "/config/tools/state";
export const REGISTRY_FAVORITES_LIMIT = 10000;
export const PROFILE_SELECTION_EVENT = "quick-access-profile-selection-changed";
export const LAUNCHER_PREFERENCE_EVENT = "quick-access-launcher-preference-changed";
export const DEVICE_STORAGE_PREFIX = "quick_access_v1:";

export const DEFAULT_LINKS = [
  {
    id: "quick-states",
    name: "Entity Explorer",
    type: "quick-states",
    path: "",
    icon: "mdi:format-list-bulleted",
    color: "cyan",
    group: "favorites",
  },
  {
    id: "quick-devices",
    name: "Device Explorer",
    type: "quick-devices",
    path: "",
    icon: "mdi:devices",
    color: "teal",
    group: "favorites",
  },
];
