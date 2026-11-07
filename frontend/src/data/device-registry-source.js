const EMPTY_REGISTRY = Object.freeze({});
const REGISTRY_POLL_INTERVAL_MS = 3500;

export function createDeviceRegistrySource({
  getHass,
  getHaRoot,
  isEnabled,
  contextTarget,
  onChange,
  includeEntities = false,
}) {
  const connection = getHass()?.connection;
  const user = getHass()?.user?.id;
  const registryState = (name) => ({
    value: getHass()?.[name],
    hassValue: getHass()?.[name],
    context: false,
    generation: 0,
    pending: null,
    reload: false,
    error: false,
    lastRequest: -Infinity,
    unsubscribe: null,
    eventUnsubscribe: null,
    subscribing: false,
  });
  const registries = Object.fromEntries(
    ["devices", "areas", ...(includeEntities ? ["entities"] : [])].map((name) => [
      name,
      registryState(name),
    ]),
  );
  const registryType = (name) =>
    ({
      devices: "device",
      areas: "area",
      entities: "entity",
      entityMetadata: "entity",
      labels: "label",
    })[name];
  const registryKey = (name) =>
    ({
      devices: "id",
      areas: "area_id",
      entities: "entity_id",
      entityMetadata: "entity_id",
      labels: "label_id",
    })[name];
  let disposed = false;
  let started = false;
  const current = () =>
    !disposed &&
    isEnabled() &&
    getHass()?.connection === connection &&
    getHass()?.user?.id === user;
  const release = (unsubscribe) => {
    if (unsubscribe)
      void Promise.resolve()
        .then(unsubscribe)
        .catch(() => {});
  };
  function accept(name, value) {
    const registry = registries[name];
    registry.generation++;
    registry.value = value;
    registry.error = false;
    onChange();
  }
  async function fetchRegistry(name) {
    const registry = registries[name];
    if (!current() || registry.context || getHass()?.[name] != null) return;
    if (registry.pending) {
      registry.reload = true;
      return;
    }
    if (connection.connected === false) return;
    const generation = registry.generation;
    const request = {};
    registry.pending = request;
    registry.lastRequest = Date.now();
    try {
      const type = `config/${registryType(name)}_registry/list`;
      const hass = getHass();
      const entries = await (hass.callWS
        ? hass.callWS({ type })
        : connection.sendMessagePromise({ type }));
      if (!current() || generation !== registry.generation) return;
      // A native registry may become available while its fallback is loading.
      // Never let the older WS snapshot replace that frontend data.
      if (registry.context) return;
      if (getHass()?.[name] != null) {
        registry.hassValue = getHass()[name];
        accept(name, registry.hassValue);
        return;
      }
      if (
        !Array.isArray(entries) ||
        entries.some(
          (entry) =>
            !entry || typeof entry !== "object" || typeof entry[registryKey(name)] !== "string",
        )
      )
        throw new Error("Invalid HA registry response");
      accept(name, Object.fromEntries(entries.map((entry) => [entry[registryKey(name)], entry])));
    } catch (error) {
      if (current() && generation === registry.generation) {
        registry.error = true;
        onChange();
      }
    } finally {
      if (registry.pending === request) {
        registry.pending = null;
        if (registry.reload && current()) {
          registry.reload = false;
          void fetchRegistry(name);
        }
      }
    }
  }
  function invalidate(name) {
    registries[name].generation++;
    void fetchRegistry(name);
  }
  function subscribe(name) {
    const registry = registries[name];
    if (
      registry.context ||
      getHass()?.[name] != null ||
      registry.eventUnsubscribe ||
      registry.subscribing ||
      !connection.subscribeEvents
    )
      return;
    registry.subscribing = true;
    void Promise.resolve()
      .then(() =>
        connection.subscribeEvents(
          () => {
            if (current()) invalidate(name);
          },
          `${registryType(name)}_registry_updated`,
        ),
      )
      .then((unsubscribe) => {
        if (!current() || registry.context || getHass()?.[name] != null) release(unsubscribe);
        else registry.eventUnsubscribe = unsubscribe;
      })
      .catch(() => {
        if (current()) {
          registry.error = true;
          onChange();
        }
      })
      .finally(() => {
        registry.subscribing = false;
      });
  }
  const ready = () => {
    if (!current()) return;
    for (const [name, registry] of Object.entries(registries)) {
      // A request on the previous socket may never settle. Its generation and
      // token must not block or clear a new request after reconnection.
      registry.pending = null;
      registry.reload = false;
      invalidate(name);
    }
  };
  function startRegistry(name) {
    const request = new Event("context-request", { bubbles: true, composed: true });
    Object.assign(request, {
      context: name,
      contextTarget,
      subscribe: true,
      callback: (value, unsubscribe) => {
        if (!current()) {
          release(unsubscribe);
          return;
        }
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          typeof unsubscribe !== "function"
        )
          return;
        const registry = registries[name];
        registry.context = true;
        registry.unsubscribe = unsubscribe;
        release(registry.eventUnsubscribe);
        registry.eventUnsubscribe = null;
        accept(name, value);
      },
    });
    if (name !== "entityMetadata") getHaRoot()?.dispatchEvent(request);
    subscribe(name);
    void fetchRegistry(name);
  }
  return {
    get devices() {
      return registries.devices.value || EMPTY_REGISTRY;
    },
    get areas() {
      return registries.areas.value || EMPTY_REGISTRY;
    },
    get entities() {
      return (
        registries.entityMetadata?.value ||
        registries.entities?.value ||
        getHass()?.entities ||
        EMPTY_REGISTRY
      );
    },
    get labels() {
      return registries.labels?.value || getHass()?.labels || EMPTY_REGISTRY;
    },
    get registryStatus() {
      return Object.fromEntries(
        Object.entries(registries).map(([name, registry]) => {
          let status = "";
          if (registry.error) status = "load_failed";
          else if (registry.value == null) status = "loading";
          return [name === "entityMetadata" ? "entities" : name, status];
        }),
      );
    },
    get entityRevision() {
      return (registries.entities?.generation ?? 0) + (registries.entityMetadata?.generation ?? 0);
    },
    get revision() {
      return Object.values(registries)
        .map((registry) => registry.generation)
        .join(":");
    },
    requireEntities() {
      if (disposed || registries.entities) return;
      registries.entities = registryState("entities");
      if (started) startRegistry("entities");
    },
    requireLabels() {
      if (disposed || registries.labels) return;
      registries.labels = registryState("labels");
      if (started) startRegistry("labels");
    },
    requireEntityMetadata() {
      this.requireEntities();
      // HA's ordinary entities context is a display registry. A WS fallback
      // already supplies full entries, so never load a second copy of it.
      const entities = registries.entities;
      if (
        disposed ||
        registries.entityMetadata ||
        (!entities.context && getHass()?.entities == null) ||
        Object.values(entities.value || {}).some((entry) => Object.hasOwn(entry, "hidden_by"))
      )
        return;
      registries.entityMetadata = registryState("entityMetadata");
      if (started) startRegistry("entityMetadata");
    },
    get loaded() {
      return registries.devices.value != null;
    },
    get status() {
      if (
        Object.entries(registries).some(
          ([name, registry]) => !["labels", "entityMetadata"].includes(name) && registry.error,
        )
      )
        return "load_failed";
      if (registries.devices.value == null) return "loading";
      return "";
    },
    start() {
      if (disposed || started) return;
      started = true;
      connection.addEventListener("ready", ready);
      for (const name of Object.keys(registries)) startRegistry(name);
    },
    refresh() {
      if (!current()) return;
      for (const [name, registry] of Object.entries(registries)) {
        const value = getHass()?.[name];
        if (value !== registry.hassValue) {
          registry.hassValue = value;
          if (value != null) {
            release(registry.eventUnsubscribe);
            registry.eventUnsubscribe = null;
            accept(name, value);
          } else if (!registry.context) {
            registry.value = undefined;
            invalidate(name);
          }
        }
        subscribe(name);
      }
    },
    poll() {
      this.refresh();
      for (const [name, registry] of Object.entries(registries)) {
        if (
          (registry.error || !registry.eventUnsubscribe) &&
          !registry.pending &&
          Date.now() - registry.lastRequest >= REGISTRY_POLL_INTERVAL_MS
        )
          void fetchRegistry(name);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      connection.removeEventListener("ready", ready);
      for (const registry of Object.values(registries)) {
        registry.generation++;
        release(registry.unsubscribe);
        release(registry.eventUnsubscribe);
      }
    },
  };
}
