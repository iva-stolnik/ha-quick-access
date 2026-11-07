import { validIconColor } from "../utils/icons.js";

export const FILTER_VALUE_LIMIT = 20;
export const FILTER_LIMIT = 10;
export const CONDITION_LIMIT = 10;
export const FILTER_DEPTH_LIMIT = 2;
export const FILTER_NAME_LIMIT = 50;
const FILTER_BYTES_LIMIT = 32768;
export const SYSTEM_FILTERS = ["all", "favorites"];
export const FILTER_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "any_of",
  "greater_than",
  "less_than",
  "exists",
];
export const ENTITY_FIELDS = [
  "state",
  "attribute",
  "id",
  "name",
  "domain",
  "area",
  "label",
  "manufacturer",
  "model",
  "platform",
  "device_class",
  "hidden_by",
  "entity_category",
  "smart",
];
export const DEVICE_FIELDS = [
  "id",
  "name",
  "area",
  "label",
  "manufacturer",
  "model",
  "model_id",
  "serial_number",
  "sw_version",
  "hw_version",
  "entry_type",
  "smart",
];
export const SMART_FILTERS = {
  states: ["unavailable", "unknown", "low_battery", "updates"],
  devices: ["assigned", "unassigned"],
};
export const group = (conditions = [], operator = "and") => ({
  type: "group",
  operator,
  conditions,
});
export const rule = (field = "state", operator = "equals", value = "") => ({
  type: "rule",
  field,
  operator,
  value,
});

// Editor choices are narrower than the persisted v1 schema, so existing filters
// continue to load and evaluate without a migration or a silent draft rewrite.
export function fieldOperators(field) {
  if (field === "smart") return ["equals"];
  if (["state", "attribute"].includes(field)) return FILTER_OPERATORS;
  if (field === "name") return ["equals", "not_equals", "contains"];
  if (field === "serial_number") return ["equals", "not_equals", "contains", "exists"];
  return [
    "equals",
    "not_equals",
    "any_of",
    ...(["id", "domain", "label"].includes(field) ? [] : ["exists"]),
  ];
}

export function filterTemplates(kind) {
  const names = {
    unavailable: "Unavailable",
    unknown: "Unknown",
    low_battery: "Low Battery",
    updates: "Updates",
    assigned: "With area",
    unassigned: "Without area",
  };
  const templates = SMART_FILTERS[kind].map((id) => ({
    id,
    name: names[id],
    hidden: false,
    condition: group([rule("smart", "equals", id)]),
  }));
  if (kind === "devices")
    templates.push({
      id: "entity_issues",
      name: "Devices with entity issues",
      hidden: false,
      condition: group([
        {
          type: "entities",
          quantifier: "any",
          condition: group([rule("state", "any_of", ["unknown", "unavailable"])]),
        },
      ]),
    });
  return templates;
}

// Absence is the migration marker. An explicitly saved collection is authoritative,
// including an empty custom list: deleted templates are never added on reload.
export function profileFilters(profile) {
  return (
    profile?.filters || {
      version: 1,
      ...Object.fromEntries(
        ["states", "devices"].map((kind) => [
          kind,
          [
            { id: "favorites", name: "Favorites", hidden: false },
            { id: "all", name: "All", hidden: false },
            ...filterTemplates(kind),
          ],
        ]),
      ),
    }
  );
}

export function defaultFilter(filters, kind, fallback = "all") {
  const id = filters.defaults?.[kind] || fallback;
  return filters[kind].some((filter) => filter.id === id && !filter.hidden) ? id : "all";
}

export function filterIcon(filter) {
  return filter.icon || (filter.id === "favorites" ? "mdi:star" : "mdi:filter-variant");
}

export function eligibleShortcutFilters(profile, kind) {
  const entries = profileFilters(profile)[kind];
  return [
    ...entries.filter((filter) => !filter.hidden),
    ...entries.filter((filter) => filter.hidden && !SYSTEM_FILTERS.includes(filter.id)),
  ];
}

export function validFilterReference(link) {
  return (
    ["states", "devices"].includes(link.filterKind) &&
    typeof link.filterId === "string" &&
    /^[A-Za-z0-9_-]{1,100}$/.test(link.filterId) &&
    link.filterId !== "temporary"
  );
}

export function resolveShortcutFilter(profile, link) {
  return profile && validFilterReference(link)
    ? profileFilters(profile)[link.filterKind].find((filter) => filter.id === link.filterId)
    : undefined;
}

export function linkedFilterShortcuts(profile, kind, id) {
  return profile.settings.links.filter(
    (link) => link.type === "saved-filter" && link.filterKind === kind && link.filterId === id,
  );
}

export function filterLabel(filter, kind, t) {
  if (SYSTEM_FILTERS.includes(filter.id)) return t(`common.${filter.id}`);
  const template = filterTemplates(kind).find(
    (item) => item.id === (filter.templateId || filter.id) && item.name === filter.name,
  );
  if (!template) return filter.name;
  if (template.id === "entity_issues") return t("filters.entity_issues");
  const prefix = kind === "devices" ? "devices" : "entities";
  const key = { assigned: "with_area", unassigned: "without_area" }[template.id] || template.id;
  return t(`${prefix}.${key}`);
}

const keysAre = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const scalar = (value) =>
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value)) ||
  (typeof value === "string" && value.length <= 256);

export function validCondition(condition, kind) {
  let count = 0;
  function valid(item, scope, depth) {
    if (!item || typeof item !== "object" || depth > FILTER_DEPTH_LIMIT) return false;
    if (item.type === "group")
      return (
        keysAre(item, ["type", "operator", "conditions"]) &&
        ["and", "or", "not"].includes(item.operator) &&
        Array.isArray(item.conditions) &&
        item.conditions.length > 0 &&
        item.conditions.length <= CONDITION_LIMIT &&
        item.conditions.every((child) =>
          valid(child, scope, child?.type === "rule" ? depth : depth + 1),
        )
      );
    if (item.type === "entities")
      return (
        scope === "devices" &&
        keysAre(item, ["type", "quantifier", "condition"]) &&
        ["any", "all"].includes(item.quantifier) &&
        item.condition?.type === "group" &&
        valid(item.condition, "states", depth)
      );
    if (
      item.type !== "rule" ||
      ++count > CONDITION_LIMIT ||
      !keysAre(item, [
        "type",
        "field",
        "operator",
        "value",
        ...(item.field === "attribute" ? ["attribute"] : []),
      ]) ||
      !(scope === "devices" ? DEVICE_FIELDS : ENTITY_FIELDS).includes(item.field) ||
      !FILTER_OPERATORS.includes(item.operator)
    )
      return false;
    if (
      item.field === "attribute" &&
      (typeof item.attribute !== "string" || !item.attribute.length || item.attribute.length > 100)
    )
      return false;
    if (item.field === "smart")
      return item.operator === "equals" && SMART_FILTERS[scope].includes(item.value);
    if (item.operator === "exists") return item.value === true;
    if (["greater_than", "less_than"].includes(item.operator))
      return typeof item.value === "number" && Number.isFinite(item.value);
    if (item.operator === "any_of")
      return (
        Array.isArray(item.value) &&
        item.value.length > 0 &&
        item.value.length <= FILTER_VALUE_LIMIT &&
        item.value.every(scalar)
      );
    return scalar(item.value);
  }
  return condition?.type === "group" && valid(condition, kind, 0);
}

export function validFilters(value) {
  if (
    !keysAre(value, [
      "version",
      "states",
      "devices",
      ...(value?.defaults !== undefined ? ["defaults"] : []),
    ]) ||
    value.version !== 1
  )
    return false;
  if (
    value.defaults !== undefined &&
    (!value.defaults ||
      typeof value.defaults !== "object" ||
      Array.isArray(value.defaults) ||
      Object.keys(value.defaults).some((kind) => !["states", "devices"].includes(kind)))
  )
    return false;
  const valid = ["states", "devices"].every((kind) => {
    const entries = value[kind];
    if (!Array.isArray(entries) || entries.length > FILTER_LIMIT + SYSTEM_FILTERS.length)
      return false;
    const ids = new Set();
    const names = new Set();
    for (const item of entries) {
      const system = SYSTEM_FILTERS.includes(item?.id);
      if (
        !keysAre(item, [
          "id",
          "name",
          "hidden",
          ...(system ? [] : ["condition"]),
          ...["icon", "color", "templateId"].filter((key) => item?.[key] !== undefined),
        ]) ||
        (item.icon !== undefined &&
          (typeof item.icon !== "string" ||
            item.icon.length >= 64 ||
            !/^mdi:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.icon))) ||
        (item.color !== undefined && !validIconColor(item.color)) ||
        (item.templateId !== undefined &&
          (system || !filterTemplates(kind).some((template) => template.id === item.templateId))) ||
        typeof item.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(item.id) ||
        item.id === "temporary" ||
        ids.has(item.id) ||
        typeof item.name !== "string" ||
        item.name !== item.name.trim() ||
        !item.name ||
        Array.from(item.name).length > FILTER_NAME_LIMIT ||
        /[\u0000-\u001f\u007f-\u009f]/.test(item.name) ||
        names.has(item.name.toLowerCase()) ||
        typeof item.hidden !== "boolean"
      )
        return false;
      if (system) {
        const expectedName = item.id === "all" ? "All" : "Favorites";
        if (item.name !== expectedName) return false;
      } else if (!validCondition(item.condition, kind)) return false;
      ids.add(item.id);
      names.add(item.name.toLowerCase());
    }
    return (
      SYSTEM_FILTERS.every((id) => ids.has(id)) &&
      (!Object.hasOwn(value.defaults || {}, kind) ||
        (typeof value.defaults[kind] === "string" && ids.has(value.defaults[kind])))
    );
  });
  // Only serialize after structural validation has bounded every nested value.
  return (
    valid &&
    Array.from(JSON.stringify(value)).reduce((bytes, char) => {
      const codePoint = char.codePointAt(0);
      if (codePoint <= 0x7f) return bytes + 1;
      if (codePoint <= 0x7ff) return bytes + 2;
      if (codePoint <= 0xffff) return bytes + 3;
      return bytes + 4;
    }, 0) <= FILTER_BYTES_LIMIT
  );
}
