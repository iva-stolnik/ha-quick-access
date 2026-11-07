// Bundled chunks have hashed names; CSS and locales carry the integration version.
export const VERSION = __QUICK_ACCESS_VERSION__;

export function assetUrl(path) {
  return `/quick_access/${path}?v=${VERSION}`;
}
