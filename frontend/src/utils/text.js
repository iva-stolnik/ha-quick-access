// Name limits count Unicode code points, matching Python's len() on the server.
export const textLength = (value) => Array.from(value).length;

/** Truncate by code points, so a limit never splits an emoji's surrogate pair. */
export const truncateText = (value, limit) =>
  Array.from(value).slice(0, Math.max(0, limit)).join("");
