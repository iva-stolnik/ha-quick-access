import {
  DEVICE_STORAGE_PREFIX,
  PROFILE_SELECTION_EVENT,
  LAUNCHER_PREFERENCE_EVENT,
} from "../profiles/profile-defaults.js";

export function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

export function profileSelectionKey(instance, user) {
  return `${DEVICE_STORAGE_PREFIX}${instance}:${user}:active-profile`;
}

export function launcherEnabledKey(instance, user) {
  return `${DEVICE_STORAGE_PREFIX}${instance}:${user}:launcher-enabled`;
}

export function readLauncherEnabled(key) {
  const raw = localStorage.getItem(key);
  try {
    return JSON.parse(raw) !== false;
  } catch {
    return true;
  }
}

export function writeLauncherEnabled(key, enabled) {
  localStorage.setItem(key, JSON.stringify(enabled));
  window.dispatchEvent(new CustomEvent(LAUNCHER_PREFERENCE_EVENT, { detail: { key } }));
}

// Let callers report storage failures; malformed values mean no selection.
export function readProfileSelection(key) {
  const raw = localStorage.getItem(key);
  try {
    const selected = JSON.parse(raw);
    return typeof selected === "string" ? selected : null;
  } catch {
    return null;
  }
}

export function writeProfileSelection(key, id) {
  if (id) localStorage.setItem(key, JSON.stringify(id));
  else localStorage.removeItem(key);
  window.dispatchEvent(new CustomEvent(PROFILE_SELECTION_EVENT, { detail: { key } }));
}
