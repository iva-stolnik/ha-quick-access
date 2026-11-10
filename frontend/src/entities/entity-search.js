import { formattedEntityName } from "./entity-formatting.js";

export const DEFAULT_LOW_BATTERY_THRESHOLD = 20;
const NUMERIC_STATE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Approximate substring matching for picker terms, without another search dependency. */
export function entitySearchTermMatches(text, term) {
  if (text.includes(term)) return true;
  const allowedErrors = Math.floor(term.length * 0.3);
  if (!allowedErrors) return false;
  let previous = Array.from({ length: term.length + 1 }, (_, index) => index);
  for (const character of text) {
    const next = [0];
    for (let index = 1; index <= term.length; index++) {
      next[index] = Math.min(
        next[index - 1] + 1,
        previous[index] + 1,
        previous[index - 1] + (character === term[index - 1] ? 0 : 1),
      );
    }
    if (next[term.length] <= allowedErrors) return true;
    previous = next;
  }
  return false;
}

function isLowBattery(state, domain, threshold = DEFAULT_LOW_BATTERY_THRESHOLD) {
  if (
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > 100 ||
    domain !== "sensor" ||
    state.attributes?.device_class !== "battery" ||
    state.attributes?.unit_of_measurement !== "%"
  )
    return false;
  if (typeof state.state !== "string" && typeof state.state !== "number") return false;
  const value = String(state.state).trim();
  if (!NUMERIC_STATE.test(value)) return false;
  const percentage = Number(value);
  return Number.isFinite(percentage) && percentage >= 0 && percentage < threshold;
}

export function entityMatches(state, view, searchTerm, searchNames, hass) {
  if (typeof state?.entity_id !== "string") return false;
  const domain = state.entity_id.split(".")[0];
  switch (view.filter) {
    case "favorites":
      if (!view.favorites.has(state.entity_id)) return false;
      break;
    case "unavailable":
    case "unknown":
      if (state.state !== view.filter) return false;
      break;
    case "low_battery":
      if (!isLowBattery(state, domain, view.threshold)) return false;
      break;
    case "updates":
      if (domain !== "update" || state.state !== "on") return false;
      break;
    case "all":
      break;
    default:
      return false;
  }
  if (
    !searchTerm ||
    `${state.entity_id} ${state.attributes?.friendly_name || ""}`
      .toLocaleLowerCase()
      .includes(searchTerm)
  )
    return true;
  let cached = searchNames.get(state);
  const friendlyName = state.attributes?.friendly_name;
  if (!cached || cached.friendlyName !== friendlyName) {
    cached = { friendlyName, name: formattedEntityName(state, hass).toLocaleLowerCase() };
    searchNames.set(state, cached);
  }
  return cached.name.includes(searchTerm);
}
