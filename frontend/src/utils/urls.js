export function safePath(path) {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\")
  )
    return false;
  try {
    const url = new URL(path, location.origin);
    return url.origin === location.origin && ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export function safeExternal(url) {
  try {
    const result = new URL(url);
    if (!["http:", "https:"].includes(result.protocol) || result.hostname.includes("%"))
      return false;
    if (/(^|\.)xn--[^.]*-(\.|$)/.test(result.hostname)) return false;
    // Some URL implementations skip IDNA checks for ASCII A-labels. A soft
    // hyphen is ignored by IDNA but forces each punycode label to be checked.
    const checkedHost = result.hostname.replace(/(^|\.)xn--/g, "$1xn--\u00ad");
    return (
      checkedHost === result.hostname ||
      new URL(`https://${checkedHost}/`).hostname === result.hostname
    );
  } catch {
    return false;
  }
}

export function parseRoutes(value) {
  return value
    .split("\n")
    .map((path) => path.trim())
    .filter(Boolean);
}

export function currentPageUrl() {
  return `${location.pathname}${location.search || ""}${location.hash || ""}`;
}

export function routeMatches(pattern, path) {
  if (typeof pattern !== "string" || !pattern.startsWith("/") || typeof path !== "string")
    return false;

  // Plain paths ignore query parameters and fragments; URL rules include both.
  if (!/[?#]/.test(pattern)) path = path.split(/[?#]/, 1)[0];

  let p = 0;
  let i = 0;
  let star = -1;
  let match = 0;

  while (i < path.length) {
    if (p < pattern.length && pattern[p] === "*") {
      star = p++;
      match = i;
    } else if (p < pattern.length && pattern[p] === path[i]) {
      p++;
      i++;
    } else if (star !== -1) {
      p = star + 1;
      i = ++match;
    } else {
      return false;
    }
  }

  while (p < pattern.length && pattern[p] === "*") p++;

  return p === pattern.length;
}
