import {
  PROFILE_VERSION,
  CATEGORY_NAME_MAX_LENGTH,
  SHORTCUT_NAME_MAX_LENGTH,
  PROFILE_NAME_MAX_LENGTH,
  REGISTRY_FAVORITES_LIMIT,
  DEFAULT_LINKS,
  SHORTCUT_GRID_MAX_DIMENSION,
} from "./profile-defaults.js";
import { normalizeIcon } from "../utils/icons.js";
import { safePath, safeExternal } from "../utils/urls.js";
import { validFilters, validFilterReference } from "../registry/filter-definitions.js";
import { textLength } from "../utils/text.js";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export function validShortcutGrid(grid) {
  return Boolean(
    grid &&
    typeof grid === "object" &&
    !Array.isArray(grid) &&
    Object.keys(grid)
      .filter((key) => key !== "hideNames")
      .sort()
      .join(",") === "columns,rows" &&
    (!("hideNames" in grid) || typeof grid.hideNames === "boolean") &&
    [grid.rows, grid.columns].every(
      (value) => Number.isInteger(value) && value >= 1 && value <= SHORTCUT_GRID_MAX_DIMENSION,
    ),
  );
}

export function createProfileValidation(l10n) {
  const t = l10n.message;
  const SHORTCUT_TYPES = [
    "internal",
    "external",
    "quick-states",
    "quick-devices",
    "saved-filter",
    "scene",
  ];
  function categoryNameError(name, categories, editingId) {
    const trimmed = name.trim();
    if (
      !trimmed ||
      textLength(trimmed) > CATEGORY_NAME_MAX_LENGTH ||
      CONTROL_CHARACTERS.test(trimmed)
    ) {
      return t("categories.invalid_name", { limit: CATEGORY_NAME_MAX_LENGTH });
    }
    const lowered = trimmed.toLowerCase();
    // Favorites is stored in English but shown translated: block both spellings.
    return categories.some(
      (category) =>
        category.id !== editingId &&
        (category.name.toLowerCase() === lowered ||
          (category.id === "favorites" && String(t("common.favorites")).toLowerCase() === lowered)),
    )
      ? t("categories.duplicate_name")
      : "";
  }

  function validCategories(categories) {
    if (!Array.isArray(categories) || !categories.length) return false;
    const ids = new Set();
    const names = new Set();
    for (const category of categories) {
      if (
        !category ||
        Object.keys(category)
          .filter((key) => key !== "grid")
          .sort()
          .join(",") !== "id,name" ||
        ("grid" in category && !validShortcutGrid(category.grid)) ||
        typeof category.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(category.id) ||
        ids.has(category.id) ||
        typeof category.name !== "string" ||
        category.name !== category.name.trim() ||
        categoryNameError(category.name, [], category.id) ||
        names.has(category.name.toLowerCase()) ||
        (category.id === "favorites" && category.name !== "Favorites")
      )
        return false;
      ids.add(category.id);
      names.add(category.name.toLowerCase());
    }
    return ids.has("favorites");
  }

  function shortcutPathError(type, path) {
    if (type === "internal" && !safePath(path)) return t("shortcuts.invalid_internal_path");
    if (type === "external" && !safeExternal(path)) return t("shortcuts.invalid_external_url");
    if (type === "scene" && (!/^scene\.[a-z0-9_]+$/.test(path) || path !== path.trim()))
      return t("shortcuts.scene_unavailable");
    return "";
  }

  function validStoredShortcutPath(type, path) {
    if (type !== "external") return !shortcutPathError(type, path);
    // The server validates external hosts. Repeating IDNA validation here can
    // reject its snapshots on browsers with different Unicode/parser versions.
    // Still enforce HTTP(S), using the URL standard's control-character cleanup.
    return /^[\u0000-\u0020]*https?:/i.test(path.replace(/[\t\n\r]/g, ""));
  }

  function validateProfileData(value) {
    if (
      !value ||
      value.version !== PROFILE_VERSION ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      typeof value.instance_id !== "string" ||
      !value.instance_id ||
      !Array.isArray(value.profiles) ||
      Object.keys(value).sort().join(",") !== "instance_id,limits,profiles,revision,usage,version"
    ) {
      throw l10n.error(t("profiles.errors.unsupported_data"));
    }
    const quotaKeys = ["max_profiles", "max_categories", "max_user_bytes", "max_profile_bytes"];
    if (
      !value.limits ||
      Object.keys(value.limits).sort().join(",") !== [...quotaKeys].sort().join(",") ||
      quotaKeys.some((key) => !Number.isSafeInteger(value.limits[key]) || value.limits[key] <= 0) ||
      value.limits.max_profile_bytes > value.limits.max_user_bytes ||
      !value.usage ||
      value.usage.profiles !== value.profiles.length ||
      !Number.isSafeInteger(value.usage.user_bytes) ||
      value.usage.user_bytes < 0 ||
      !value.usage.by_profile ||
      Object.keys(value.usage.by_profile).length !== value.profiles.length ||
      value.profiles.some((profile) => {
        const usage = value.usage.by_profile[profile?.id];
        return (
          !usage ||
          usage.categories !== profile?.categories?.length ||
          !Number.isSafeInteger(usage.bytes) ||
          usage.bytes < 0
        );
      })
    )
      throw l10n.error(t("profiles.errors.invalid_quotas"));
    const ids = new Set();
    for (const profile of value.profiles) {
      if (!validCategories(profile?.categories)) {
        throw l10n.error(t("profiles.errors.invalid_categories"));
      }
      const linkIds = new Set();
      if (
        !profile ||
        typeof profile.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(profile.id) ||
        ids.has(profile.id) ||
        typeof profile.name !== "string" ||
        !profile.name.trim() ||
        textLength(profile.name) > PROFILE_NAME_MAX_LENGTH ||
        typeof profile.icon !== "string" ||
        !profile.icon ||
        normalizeIcon(profile.icon, "") !== profile.icon ||
        ("color" in profile && typeof profile.color !== "string") ||
        Object.keys(profile)
          .filter((key) => !["color", "device_favorites", "filters"].includes(key))
          .sort()
          .join(",") !== "categories,favorites,icon,id,name,settings" ||
        ("filters" in profile && !validFilters(profile.filters)) ||
        !profile.settings ||
        Object.keys(profile.settings).sort().join(",") !== "links,routes,visibility" ||
        !Array.isArray(profile.settings.links) ||
        !Array.isArray(profile.settings.routes) ||
        profile.settings.routes.some(
          (route) => typeof route !== "string" || !route.startsWith("/"),
        ) ||
        !["include", "exclude"].includes(profile.settings.visibility) ||
        profile.settings.links.some((link) => {
          // Keep unresolved IDs readable for repair; the server rejects writes with missing targets.
          if (
            !link ||
            Object.keys(link)
              .filter((key) => key !== "hidden")
              .sort()
              .join(",") !==
              (link.type === "saved-filter"
                ? "color,filterId,filterKind,group,icon,id,name,path,type"
                : "color,group,icon,id,name,path,type") ||
            ("hidden" in link && typeof link.hidden !== "boolean") ||
            (link.type === "saved-filter" && (!validFilterReference(link) || link.path !== "")) ||
            typeof link.id !== "string" ||
            !link.id ||
            linkIds.has(link.id) ||
            typeof link.name !== "string" ||
            !link.name ||
            textLength(link.name) > SHORTCUT_NAME_MAX_LENGTH ||
            typeof link.icon !== "string" ||
            !link.icon ||
            normalizeIcon(link.icon, "") !== link.icon ||
            typeof link.color !== "string" ||
            typeof link.path !== "string" ||
            !SHORTCUT_TYPES.includes(link.type) ||
            !validStoredShortcutPath(link.type, link.path) ||
            !profile.categories.some((category) => category.id === link.group)
          )
            return true;
          linkIds.add(link.id);
          return false;
        }) ||
        ("device_favorites" in profile &&
          (!Array.isArray(profile.device_favorites) ||
            profile.device_favorites.length > REGISTRY_FAVORITES_LIMIT ||
            profile.device_favorites.some(
              (id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id),
            ) ||
            new Set(profile.device_favorites).size !== profile.device_favorites.length)) ||
        !Array.isArray(profile.favorites) ||
        profile.favorites.some(
          (id) => typeof id !== "string" || !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(id),
        ) ||
        new Set(profile.favorites).size !== profile.favorites.length
      ) {
        throw l10n.error(t("profiles.errors.invalid_data"));
      }
      ids.add(profile.id);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function profileNameError(name) {
    const trimmed = name.trim();
    return !trimmed ||
      textLength(trimmed) > PROFILE_NAME_MAX_LENGTH ||
      CONTROL_CHARACTERS.test(trimmed)
      ? t("profiles.errors.invalid_name", { limit: PROFILE_NAME_MAX_LENGTH })
      : "";
  }

  function shortcutNameError(name) {
    const trimmed = name.trim();
    if (!trimmed) return t("shortcuts.name_required");
    return textLength(trimmed) > SHORTCUT_NAME_MAX_LENGTH || CONTROL_CHARACTERS.test(trimmed)
      ? t("shortcuts.invalid_name", { limit: SHORTCUT_NAME_MAX_LENGTH })
      : "";
  }

  function defaultSettings() {
    return {
      visibility: "exclude",
      routes: [],
      links: DEFAULT_LINKS.map((link) => ({ ...link, name: String(t(`defaults.${link.id}`)) })),
    };
  }

  function defaultCategories() {
    return [{ id: "favorites", name: "Favorites" }];
  }

  return {
    categoryNameError,
    validCategories,
    shortcutPathError,
    validateProfileData,
    profileNameError,
    shortcutNameError,
    defaultSettings,
    defaultCategories,
  };
}
