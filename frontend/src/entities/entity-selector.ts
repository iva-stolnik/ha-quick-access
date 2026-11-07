import { entityMatches, entitySearchTermMatches } from "./entity-search.js";
import { entityFallbackIconName, formattedEntityName } from "./entity-formatting.js";

interface SelectorState {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    icon?: string;
    device_class?: string;
    supported_features?: number;
  };
}
interface SelectorEntity {
  name?: string | null;
  original_name?: string | null;
  icon?: string | null;
  device_id?: string | null;
  area_id?: string | null;
  platform?: string;
  device_class?: string | null;
  original_device_class?: string | null;
}
interface EntitySelectorContext {
  states?: Readonly<Record<string, SelectorState>>;
  entities?: Readonly<Record<string, SelectorEntity>>;
  devices?: Readonly<
    Record<string, { name?: string | null; name_by_user?: string | null; area_id?: string | null }>
  >;
  areas?: Readonly<Record<string, { name?: string }>>;
  hass?: {
    language?: string;
    locale?: unknown;
    formatEntityName?: (state: SelectorState) => string;
    localize?: (key: string) => string;
  };
  revision?: unknown;
}
interface EntitySelectorFilter {
  domain?: string | readonly string[];
  device_class?: string | readonly string[];
  integration?: string;
  supported_features?: number | readonly number[];
}
export interface EntitySelectorConfig {
  multiple?: boolean;
  include_entities?: readonly string[];
  exclude_entities?: readonly string[];
  filter?: EntitySelectorFilter | readonly EntitySelectorFilter[];
}
interface EntitySelectorOption {
  value: string;
  label: string;
  secondary: string;
  icon: string;
  domain: string;
  state: SelectorState;
  platform?: string;
}

const ALL_ENTITIES = { filter: "all" };
const matchesValue = (value: string | undefined, filter: string | readonly string[] | undefined) =>
  filter === undefined ||
  (typeof filter === "string" ? filter === value : filter.includes(value ?? ""));

function matchesEntitySelector(
  option: EntitySelectorOption,
  config: EntitySelectorConfig,
  current = "",
) {
  if (
    (config.include_entities && !config.include_entities.includes(option.value)) ||
    config.exclude_entities?.includes(option.value)
  )
    return false;
  if (option.value === current || !config.filter) return true;
  const filters = Array.isArray(config.filter) ? config.filter : [config.filter];
  return filters.some((filter: EntitySelectorFilter) => {
    const features = filter.supported_features;
    return (
      matchesValue(option.value.split(".")[0], filter.domain) &&
      matchesValue(option.state.attributes.device_class, filter.device_class) &&
      (!filter.integration || filter.integration === option.platform) &&
      (!features ||
        (typeof features === "number" ? [features] : features).some(
          (feature) => ((option.state.attributes.supported_features ?? 0) & feature) === feature,
        ))
    );
  });
}

/** Existing values remain editable even after deletion or a restriction change. */
export function validEntitySelection(
  value: string,
  config: EntitySelectorConfig,
  current = "",
  option?: EntitySelectorOption,
) {
  if (value === current) return true;
  if (!/^[\da-z_]+\.[\da-z_]+$/.test(value)) return false;
  return matchesEntitySelector(
    option ?? {
      value,
      label: value,
      secondary: "",
      icon: "",
      domain: value.split(".")[0],
      state: { entity_id: value, state: "unavailable", attributes: {} },
    },
    config,
  );
}

/** Borrows the editor's existing snapshots. No fetches, subscriptions or state ownership. */
export function createEntitySelectorSource(getContext: () => EntitySelectorContext) {
  let references: unknown[] = [];
  let context: EntitySelectorContext = {};
  let options: EntitySelectorOption[] | undefined;
  let byId = new Map<string, EntitySelectorOption>();
  let searchNames: WeakMap<SelectorState, { friendlyName: string | undefined; name: string }> =
    new WeakMap();
  let revision = 0;
  const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  function refresh() {
    const next = getContext();
    const refs = [
      next.states,
      next.entities,
      next.devices,
      next.areas,
      next.revision,
      next.hass?.formatEntityName,
      next.hass?.localize,
      next.hass?.language,
      JSON.stringify(next.hass?.locale),
    ];
    if (
      refs.length === references.length &&
      refs.every((value, index) => value === references[index])
    )
      return false;
    context = next;
    references = refs;
    options = undefined;
    searchNames = new WeakMap();
    revision++;
    return true;
  }
  function all() {
    if (options) return options;
    const { states = {}, entities = {}, devices = {}, areas = {}, hass } = context;
    options = [...new Set([...Object.keys(states), ...Object.keys(entities)])]
      .map((value) => {
        const entry = entities[value];
        const state = states[value] ?? {
          entity_id: value,
          state: "unavailable",
          attributes: {
            friendly_name: entry?.name || entry?.original_name || undefined,
            icon: entry?.icon || undefined,
            device_class: entry?.device_class || entry?.original_device_class || undefined,
          },
        };
        const device = entry?.device_id ? devices[entry.device_id] : undefined;
        const areaId = entry?.area_id || device?.area_id;
        const secondary = [
          areaId ? areas[areaId]?.name : undefined,
          device?.name_by_user || device?.name,
        ]
          .filter(Boolean)
          .join(" ▸ ");
        const formatted = entry?.name || formattedEntityName(state, hass);
        const label =
          formatted === value
            ? value.substring(value.indexOf(".") + 1).replaceAll("_", " ")
            : formatted;
        const domain =
          hass?.localize?.(`component.${value.split(".")[0]}.title`) || value.split(".")[0];
        return {
          value,
          label,
          secondary,
          domain,
          icon: entry?.icon || entityFallbackIconName(state),
          state,
          platform: entry?.platform,
        };
      })
      .sort(
        (a, b) =>
          a.label.localeCompare(b.label, context.hass?.language) || a.value.localeCompare(b.value),
      );
    byId = new Map(options.map((option) => [option.value, option]));
    return options;
  }
  return {
    refresh,
    get revision() {
      return revision;
    },
    get(value: string) {
      all();
      return byId.get(value);
    },
    search(query: string, config: EntitySelectorConfig, current = "") {
      // HA ignores one-character terms. Reuse Quick Access's canonical-ID/name search.
      const terms = fold(query.trim())
        .split(/\s+/)
        .filter((term) => term.length >= 2);
      const result = all().filter(
        (option) =>
          matchesEntitySelector(option, config, current) &&
          terms.every(
            (term) =>
              entityMatches(option.state, ALL_ENTITIES, term, searchNames, context.hass) ||
              entitySearchTermMatches(
                fold(`${option.label} ${option.secondary} ${option.value} ${option.domain}`),
                term,
              ),
          ),
      );
      const exact = result.findIndex((option) => option.value === query.trim());
      if (exact > 0) result.unshift(...result.splice(exact, 1));
      return result;
    },
  };
}
export type EntitySelectorSource = ReturnType<typeof createEntitySelectorSource>;
