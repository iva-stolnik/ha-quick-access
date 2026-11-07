import { normalizeEntityIcon, specialStateIcon } from "../entities/state-icon";
import type { EntityIconContext, EntityIconState } from "../entities/state-icon";

interface IconTranslation {
  default?: string;
  state?: Record<string, string>;
  range?: Record<string, string>;
}
type ComponentIcons = Record<string, IconTranslation>;
type ComponentResources = Record<string, ComponentIcons>;
type PlatformResources = Record<string, Record<string, ComponentIcons>>;
interface Resource<T> {
  value?: T;
  ready: Promise<void>;
}
interface IconCache {
  components: Map<string, Resource<ComponentResources>>;
  platforms: Map<string, Resource<PlatformResources>>;
}
const connections = new WeakMap<object, IconCache>();

function resource<T>(
  context: EntityIconContext,
  cache: Map<string, Resource<T>>,
  category: string,
  integration?: string,
): Resource<T> {
  const key = integration ?? JSON.stringify(context.config?.components);
  let result = cache.get(key);
  if (!result) {
    const entry: Resource<T> = { ready: Promise.resolve() };
    // HA's icon metadata endpoint, on the existing connection. No state subscriptions.
    entry.ready = Promise.resolve()
      .then(() =>
        context.callWS!<{ resources?: T }>({
          type: "frontend/get_icons",
          category,
          ...(integration ? { integration } : {}),
        }),
      )
      .then((response) => {
        entry.value = response?.resources;
      })
      .catch(() => {
        // Keep the local state-aware fallback and avoid retry storms in large lists.
      });
    cache.set(key, entry);
    result = entry;
  }
  return result;
}

function translatedStateIcon(value: string, translation?: IconTranslation): string | undefined {
  const exact = normalizeEntityIcon(translation?.state?.[value]);
  if (exact) return exact;
  if (translation?.range && value.trim() && Number.isFinite(Number(value))) {
    const threshold = Object.keys(translation.range)
      .map(Number)
      .filter(Number.isFinite)
      .filter((key) => key <= Number(value))
      .sort((a, b) => b - a)[0];
    const ranged = normalizeEntityIcon(translation.range[String(threshold)]);
    if (ranged) return ranged;
  }
  return normalizeEntityIcon(translation?.default) || undefined;
}

/** Shared metadata requests; callers resolve again once these resources are ready. */
export function entityIconMetadata(
  state?: EntityIconState,
  context?: EntityIconContext,
): { icon?: string; pending: readonly Promise<void>[] } {
  if (
    !state ||
    !context?.callWS ||
    !context.connection ||
    normalizeEntityIcon(context.entities?.[state.entity_id]?.icon) ||
    normalizeEntityIcon(state.attributes.icon)
  )
    return { pending: [] };
  let cache = connections.get(context.connection);
  if (!cache) {
    cache = { components: new Map(), platforms: new Map() };
    connections.set(context.connection, cache);
  }
  const domain = state.entity_id.split(".")[0],
    entry = context.entities?.[state.entity_id];
  const loaded = context.config?.components ?? [];
  const platform =
    entry?.platform && entry.translation_key && loaded.includes(entry.platform)
      ? resource(context, cache.platforms, "entity", entry.platform)
      : undefined;
  const component = loaded.includes(domain)
    ? resource(context, cache.components, "entity_component")
    : undefined;
  const platformTranslation =
    entry?.platform && entry.translation_key
      ? platform?.value?.[entry.platform]?.[domain]?.[entry.translation_key]
      : undefined;
  const icons = component?.value?.[domain];
  return {
    icon:
      translatedStateIcon(state.state, platformTranslation) ||
      specialStateIcon(state) ||
      translatedStateIcon(state.state, icons?.[state.attributes.device_class ?? ""] || icons?._),
    pending: [...(platform ? [platform.ready] : []), ...(component ? [component.ready] : [])],
  };
}
