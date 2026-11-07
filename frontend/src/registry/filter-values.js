const ENUM_FIELDS = new Set([
  "domain",
  "area",
  "label",
  "manufacturer",
  "model",
  "model_id",
  "sw_version",
  "hw_version",
  "platform",
  "device_class",
  "hidden_by",
  "entity_category",
  "entry_type",
]);
const DEVICE_METADATA = new Set(["manufacturer", "model", "model_id", "sw_version", "hw_version"]);

/** One editor's lazy option cache. It borrows the mounted list's authenticated data. */
export function createFilterValueSource(getContext) {
  const cache = new Map();
  return (field, scope) => {
    if (!ENUM_FIELDS.has(field)) return null;
    const context = getContext(field, scope);
    const { states = {}, entities = {}, devices = {}, areas = {}, labels = {} } = context;
    const key = `${scope}:${field}`;
    let references;
    if (field === "area") references = [areas];
    else if (field === "label") references = [labels];
    else if (DEVICE_METADATA.has(field)) references = [devices];
    else if (field === "domain") references = [states, entities];
    else if (field === "device_class") references = [states];
    else references = [scope === "devices" ? devices : entities];
    references.push(context.revision, JSON.stringify(context.registryStatus));
    const previous = cache.get(key);
    if (previous && references.every((value, index) => value === previous.references[index]))
      return previous.result;
    const options = new Map();
    const add = (value, name = value) => {
      if (typeof value !== "string" || !value || value.length > 256) return;
      options.set(value, { value, label: typeof name === "string" && name ? name : value });
    };
    let registry = scope === "devices" ? "devices" : "entities";
    if (field === "area") {
      registry = "areas";
      for (const [id, area] of Object.entries(areas)) add(id, area.name);
    } else if (field === "label") {
      registry = "labels";
      for (const [id, label] of Object.entries(labels)) add(id, label.name);
    } else if (field === "domain" || field === "device_class") {
      registry = "entities";
      for (const [id, state] of Object.entries(states)) {
        if (field === "domain") add(id.split(".")[0]);
        else add(state.attributes?.device_class);
      }
      if (field === "domain") Object.keys(entities).forEach((id) => add(id.split(".")[0]));
      // Device class evaluation follows the state attributes, not registry overrides.
    } else {
      if (DEVICE_METADATA.has(field)) registry = "devices";
      for (const entry of Object.values(registry === "devices" ? devices : entities))
        add(entry[field]);
    }
    const status = context.registryStatus?.[registry] || "";
    const result = {
      options: [...options.values()].sort(
        (a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value),
      ),
      status,
      markMissing: true,
      allowCustom:
        ["model_id", "sw_version", "hw_version"].includes(field) ||
        status === "load_failed" ||
        (!options.size && status !== "loading"),
    };
    cache.set(key, { references, result });
    return result;
  };
}
