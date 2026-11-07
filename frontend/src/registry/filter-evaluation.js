import { entityMatches } from "../entities/entity-search.js";
import { deviceMatches } from "../devices/device-search.js";
import { formattedEntityName } from "../entities/entity-formatting.js";
import { getDeviceName } from "../devices/device-formatting.js";
import { effectiveDeviceArea } from "../devices/device-area.js";

const NUMERIC_VALUE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const MISSING = Symbol("missing");
const own = (record, key) => (record != null && Object.hasOwn(record, key) ? record[key] : MISSING);
const text = (value) => String(value).toLocaleLowerCase();
function number(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value !== "string" || !NUMERIC_VALUE.test(value.trim())) return NaN;
  // Syntactically valid strings such as "1e309" still overflow to Infinity.
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}
function equal(actual, expected) {
  if (typeof expected === "number") return number(actual) === expected;
  if (typeof expected === "boolean") return actual === expected || actual === String(expected);
  return ["string", "number", "boolean"].includes(typeof actual) && text(actual) === text(expected);
}
export function compareValue(actual, operator, expected) {
  if (actual === MISSING || actual === undefined) return false;
  if (operator === "exists") return true;
  if (actual === null) return false;
  if (operator === "not_equals") return !compareValue(actual, "equals", expected);
  if (Array.isArray(actual)) return actual.some((value) => compareValue(value, operator, expected));
  if (operator === "equals") return equal(actual, expected);
  if (operator === "contains")
    return (
      ["string", "number", "boolean"].includes(typeof actual) &&
      text(actual).includes(text(expected))
    );
  if (operator === "any_of") return expected.some((value) => equal(actual, value));
  if (operator === "greater_than") return number(actual) > expected;
  if (operator === "less_than") return number(actual) < expected;
  return false;
}

function fieldValue(record, field, attribute, kind, context) {
  const device =
    kind === "devices"
      ? record
      : context.devices?.[context.entities?.[record.entity_id]?.device_id];
  const registry = kind === "devices" ? record : context.entities?.[record.entity_id];
  switch (field) {
    case "id":
      return kind === "devices" ? record.id : record.entity_id;
    case "name":
      return kind === "devices" ? getDeviceName(record) : formattedEntityName(record, context.hass);
    case "state":
      return own(record, "state");
    case "attribute":
      return own(record.attributes, attribute);
    case "domain":
      return record.entity_id.split(".")[0];
    case "area":
      return (
        registry?.area_id || (device && effectiveDeviceArea(device, context.devices)) || MISSING
      );
    case "label": {
      // No labels is a missing value, like a missing area or attribute.
      const labels = [...new Set([...(registry?.labels || []), ...(device?.labels || [])])];
      return labels.length ? labels : MISSING;
    }
    case "manufacturer":
    case "model":
      return own(device, field);
    case "device_class":
      return own(record.attributes, field);
    default:
      return own(registry, field);
  }
}

/** Compile once per definition/context; state snapshots are supplied at evaluation. */
export function compileFilter(condition, kind, context) {
  let usesEntities = false;
  const names = new WeakMap();
  function compile(item, scope) {
    if (item.type === "group") {
      const children = item.conditions.map((child) => compile(child, scope));
      return (record, states) => {
        // Evaluate all branches to explain every successful entity group.
        const results = children.map((predicate) => predicate(record, states));
        let match;
        if (item.operator === "and") match = results.every((result) => result.match);
        else if (item.operator === "not") match = results.every((result) => !result.match);
        else match = results.some((result) => result.match);
        return {
          match,
          entities: match
            ? new Set(
                results.filter((result) => result.match).flatMap((result) => [...result.entities]),
              )
            : new Set(),
        };
      };
    }
    if (item.type === "entities") {
      usesEntities = true;
      const predicate = compile(item.condition, "states");
      return (device, states) => {
        const eligible = [...(context.deviceEntityIds.get(device.id) || [])].filter(
          (id) => typeof states[id]?.entity_id === "string" && !context.entities?.[id]?.disabled_by,
        );
        const matched = eligible.filter((id) => predicate(states[id], states).match);
        const match =
          eligible.length > 0 &&
          (item.quantifier === "all" ? eligible.length === matched.length : matched.length > 0);
        return { match, entities: new Set(match ? matched : []) };
      };
    }
    if (item.field === "smart")
      return (record) => ({
        match:
          scope === "devices"
            ? deviceMatches(record, { filter: item.value }, "", context)
            : entityMatches(record, { filter: item.value }, "", names, context.hass),
        entities: new Set(),
      });
    return (record) => ({
      match: compareValue(
        fieldValue(record, item.field, item.attribute, scope, context),
        item.operator,
        item.value,
      ),
      entities: new Set(),
    });
  }
  const predicate = compile(condition, kind);
  return {
    evaluate: (record, states) => {
      const id = kind === "devices" ? record?.id : record?.entity_id;
      if (typeof id === "string") return predicate(record, states);
      return { match: false, entities: new Set() };
    },
    usesEntities,
  };
}

/** Rebuild only when registry identity changes; state updates use this index. */
export function entityDeviceIndex(entities = {}) {
  const entityDeviceIds = new Map();
  const deviceEntityIds = new Map();
  for (const [id, entity] of Object.entries(entities)) {
    if (!entity.device_id) continue;
    entityDeviceIds.set(id, entity.device_id);
    if (!deviceEntityIds.has(entity.device_id)) deviceEntityIds.set(entity.device_id, new Set());
    deviceEntityIds.get(entity.device_id).add(id);
  }
  return { entityDeviceIds, deviceEntityIds };
}
