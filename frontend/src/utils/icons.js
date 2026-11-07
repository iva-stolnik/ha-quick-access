import { DEFAULT_ICON } from "../profiles/profile-defaults.js";
export const ICON_THEME_COLORS = new Set([
  "primary",
  "accent",
  "red",
  "pink",
  "purple",
  "deep-purple",
  "indigo",
  "blue",
  "light-blue",
  "cyan",
  "teal",
  "green",
  "light-green",
  "lime",
  "yellow",
  "amber",
  "orange",
  "deep-orange",
  "brown",
  "light-grey",
  "grey",
  "dark-grey",
  "blue-grey",
  "black",
  "white",
]);
const ICON_COLOR_MAX_LENGTH = 256;

export function normalizeIcon(name, fallback = DEFAULT_ICON) {
  if (typeof name !== "string") return fallback;
  const value = name.trim();
  if (value.length < 64 && /^mdi:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return value;
  return fallback;
}

export function validIconColor(color) {
  if (
    typeof color !== "string" ||
    color.length > ICON_COLOR_MAX_LENGTH ||
    /[\u0000-\u001f\u007f-\u009f]/.test(color)
  )
    return false;
  // CSS.supports repairs missing closing parentheses at EOF; stored colors must
  // be complete values rather than relying on the CSS parser's error recovery.
  let depth = 0;
  for (const char of color) {
    if (char === "(") depth++;
    if (char === ")" && --depth < 0) return false;
  }
  if (depth) return false;
  const value = color.trim();
  return (
    !value ||
    ICON_THEME_COLORS.has(value) ||
    /^#(?:[a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(value) ||
    Boolean(globalThis.CSS?.supports("color", value))
  );
}

export function normalizeIconColor(color) {
  return validIconColor(color) ? color.trim() : "";
}
