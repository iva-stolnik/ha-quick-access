const STATES_SEARCH_HISTORY_LIMIT = 10;
export const STATES_SEARCH_MAX_LENGTH = 200;
export const STATES_SEARCH_DEBOUNCE_MS = 175;
export const STATES_UPDATE_BATCH_MS = 250;
export const STATES_FALLBACK_POLL_MS = 3500;
export const STATES_OVERSCAN = 4;

/** @returns {{search: string, history: string[], favorites: Set<string>, filter: string, shortcutFilter: string|null, temporary: object|null, scrollTop: number}} */
export function createRegistryView() {
  return {
    search: "",
    history: [],
    favorites: new Set(),
    filter: "all",
    shortcutFilter: null,
    temporary: null,
    scrollTop: 0,
  };
}

export function normalizeStatesSearchHistory(value) {
  if (!Array.isArray(value)) return [];
  const history = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const term = item.trim();
    if (!term || term.length > STATES_SEARCH_MAX_LENGTH) continue;
    if (history.some((saved) => saved.toLocaleLowerCase() === term.toLocaleLowerCase())) continue;
    history.push(term);
    if (history.length === STATES_SEARCH_HISTORY_LIMIT) break;
  }
  return history;
}

export function isRegistryShortcut(type) {
  return type === "quick-states" || type === "quick-devices" || type === "saved-filter";
}
