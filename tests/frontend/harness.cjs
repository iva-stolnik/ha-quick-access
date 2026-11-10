// Shared DOM/HA doubles and helpers for the frontend controller suites in this directory.
// Each *.test.cjs file runs in its own process, so these doubles never share state across files.
const assert = require("node:assert/strict");
const { getEventListeners } = require("node:events");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const { load: loadYaml, YAML11_SCHEMA } = require("js-yaml");
const attributesValue = (viewer) =>
  viewer.value ? loadYaml(viewer.value, { schema: YAML11_SCHEMA }) : {};

const { assetVersion, createModuleLoader } = require("../module-loader.cjs");
const configSource = "quick_access_config.js";
const externalURLCases = JSON.parse(
  readFileSync(path.join(__dirname, "../external-url-cases.json"), "utf8"),
);
let profileVersion, defaultLinks, shortcutPageSize, shortcutLimit;
// Loaded once per process. Test files await this in their own before hook, since
// root-level before hooks registered by different modules are not run in sequence.
let defaultsLoaded;
function loadDefaults() {
  defaultsLoaded ??= (async () => {
    const defaults = await createModuleLoader(vm.createContext({})).load(
      "profiles/profile-defaults.js",
    );
    profileVersion = defaults.PROFILE_VERSION;
    defaultLinks = JSON.parse(JSON.stringify(defaults.DEFAULT_LINKS));
    shortcutPageSize = defaults.SHORTCUT_PAGE_SIZE;
    shortcutLimit = defaults.SHORTCUT_LIMIT;
    return { profileVersion, defaultLinks, shortcutPageSize, shortcutLimit };
  })();
  return defaultsLoaded;
}
test.before(loadDefaults);

function installLocaleFetch(env) {
  const requests = [];
  const croatian = JSON.parse(
    readFileSync(path.join(__dirname, "../../frontend/public/locales/hr.json"), "utf8"),
  );
  env.context.fetch = async (url) => {
    requests.push(url);
    return {
      ok: url === `/quick_access/locales/hr.json?v=${assetVersion}`,
      json: async () => croatian,
    };
  };
  return requests;
}

function trackLocalizationBindings(env) {
  const maps = [];
  const RealmMap = vm.runInContext("Map", env.context);
  const RealmWeakRef = vm.runInContext("WeakRef", env.context);
  env.context.Map = class extends RealmMap {
    constructor(...args) {
      super(...args);
      maps.push(this);
    }
  };
  return () =>
    maps.reduce(
      (count, map) => count + [...map.keys()].filter((key) => key instanceof RealmWeakRef).length,
      0,
    );
}

async function changeLanguage(env, language, panel) {
  env.status.hass = { ...env.status.hass, language };
  if (panel) panel.hass = env.status.hass;
  await env.tick(15000);
  await flush();
}

function panelEnvironment(search = "", env = environment()) {
  Object.assign(env.context.location, {
    search,
    href: `http://homeassistant.local:8123/quick-access-config${search}`,
  });
  env.status.hass.callWS = async () => {
    throw new Error("Device settings must use only the user-scoped profile API");
  };
  env.mountPanel = async () => {
    await env.run(configSource);
    const panel = new (env.definitions.get("quick-access-config"))();
    env.document.body.append(panel);
    panel.hass = env.status.hass;
    panel.connectedCallback();
    env.panel = panel;
    return panel;
  };
  return env;
}
const flush = () => new Promise(setImmediate);
async function clickAndFlush(element) {
  element.click();
  await flush();
}
async function dispatchAndFlush(element, event) {
  element.dispatchEvent(event);
  await flush();
}
const defaultCategories = () => [{ id: "favorites", name: "Favorites" }];
const defaultSettings = () => ({
  visibility: "exclude",
  routes: [],
  links: defaultLinks.map((link) => ({ ...link })),
});
const clone = (value) => JSON.parse(JSON.stringify(value));

async function filterDefinitions(env) {
  return createModuleLoader(env.context).load("registry/filter-definitions.js");
}

function filterField(root, label) {
  const field = root
    .querySelectorAll(".qap-field")
    .find(
      (item) =>
        item.querySelector("label")?.textContent === label ||
        item.querySelector("qap-input, qap-select, qap-select-selector, qap-entity-selector")
          ?.label === label,
    );
  assert.ok(field, `Filter field ${label}`);
  return field.querySelector(
    "input, select, qap-input, qap-select, qap-select-selector, qap-entity-selector",
  );
}

async function filterAction(env, panel, name, action) {
  const row = panel
    .querySelectorAll(".qap-edit-item")
    .find((item) => item.querySelector(".qap-filter-name")?.textContent === name);
  assert.ok(row, `Filter row ${name}`);
  if (action === "edit") {
    await clickAndFlush(row.querySelector(".qap-filter-edit"));
    return;
  }
  await clickAndFlush(row.querySelector(".qap-filter-overflow"));
  const menu = profileMenuIn(env);
  assert.ok(menu);
  await clickAndFlush(menu.querySelector(`.qap-${action}-filter`));
}

async function editNewFilter(env, name, value = "unknown") {
  await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
  const panel = env.document.body.querySelector(".qap-filter-panel");
  await clickAndFlush(env.document.body.querySelector(".qap-create-filter"));
  const nameInput = filterField(panel, "Filter name");
  nameInput.value = name;
  await dispatchAndFlush(nameInput, new Event("input"));
  await clickAndFlush(panel.querySelector(".qap-filter-rule-toggle"));
  const valueInput = filterField(panel, "Value");
  valueInput.value = value;
  await dispatchAndFlush(valueInput, new Event("input"));
  return panel;
}

async function setFilterField(root, label, value) {
  const control = filterField(root, label);
  control.value = value;
  await dispatchAndFlush(
    control,
    control.localName === "qap-select-selector" || control.localName === "qap-entity-selector"
      ? new CustomEvent("value-changed", { detail: { value } })
      : new Event("change"),
  );
}

function filterValueOptions(root) {
  const control = filterField(root, "Value");
  return clone(
    control.selector?.select.options ||
      control.options ||
      control.children.map((item) => ({ value: item.value, label: item.textContent })),
  );
}

class ProfileServer {
  constructor(instanceId = "test-instance") {
    this.instanceId = instanceId;
    this.users = new Map();
    this.listeners = new Set();
    this.failWrites = false;
    this.failLoads = false;
    this.requests = [];
  }
  data(user) {
    if (!this.users.has(user))
      this.users.set(user, {
        version: profileVersion,
        revision: 0,
        profiles: [],
        instance_id: this.instanceId,
      });
    const data = this.users.get(user);
    data.limits = this.limits || {
      max_profiles: 10,
      max_categories: 20,
      max_user_bytes: 8 * 1024 * 1024,
      max_profile_bytes: 2 * 1024 * 1024,
    };
    data.usage = {
      profiles: data.profiles.length,
      user_bytes: Buffer.byteLength(
        JSON.stringify({ version: data.version, revision: data.revision, profiles: data.profiles }),
      ),
      by_profile: Object.fromEntries(
        data.profiles.map((profile) => [
          profile.id,
          {
            categories: profile.categories?.length,
            bytes: Buffer.byteLength(JSON.stringify(profile)),
          },
        ]),
      ),
    };
    return data;
  }
  notify(user) {
    for (const listener of this.listeners)
      if (listener.user === user) listener.callback(clone(this.data(user)));
  }
  async mutate(user, message) {
    this.requests.push(clone(message));
    if (this.failWrites) throw { message: "Could not save changes on the server." };
    const data = this.data(user);
    if (message.operation !== "reset_visibility" && message.revision !== data.revision)
      throw { code: "conflict" };
    const index = data.profiles.findIndex((item) => item.id === message.profile_id);
    if (message.operation === "create") {
      if (index !== -1) throw { code: "invalid_data", message: "Already exists" };
      data.profiles.push(clone(message.profile));
    } else if (index === -1) throw { code: "invalid_data", message: "Missing profile" };
    else if (message.operation === "delete") data.profiles.splice(index, 1);
    else if (message.operation === "reset_visibility")
      data.profiles[index] = {
        ...data.profiles[index],
        settings: { ...data.profiles[index].settings, visibility: "exclude", routes: [] },
      };
    else if (message.operation === "reorder")
      data.profiles = clone(message.profile_ids).map((id) =>
        data.profiles.find((profile) => profile.id === id),
      );
    else data.profiles[index] = clone(message.profile);
    data.revision++;
    this.notify(user);
    return clone(data);
  }
}

const savedProfile = (env, user = "test-user") => env.server.data(user).profiles[0];

// Node's EventTarget holds the abort handler for `{ signal }` listeners weakly, so after a
// garbage collection abort() can leave such a listener attached. Browsers always remove it.
// Keep the handler on the signal itself so cleanup assertions do not depend on GC timing.
class EventTargetDouble extends EventTarget {
  addEventListener(type, listener, options) {
    const signal = options !== null && typeof options === "object" ? options.signal : undefined;
    if (!signal) return super.addEventListener(type, listener, options);
    if (signal.aborted) return;
    const { signal: _signal, ...listenerOptions } = options;
    super.addEventListener(type, listener, listenerOptions);
    signal.addEventListener(
      "abort",
      () => this.removeEventListener(type, listener, listenerOptions),
      { once: true },
    );
  }
}

class Element extends EventTargetDouble {
  constructor(tag) {
    super();
    this.localName = tag;
    this.nodeType = 1;
    this.children = [];
    this.style = {
      setProperty(name, value) {
        this[name] = String(value);
      },
      removeProperty(name) {
        const previous = this[name] ?? "";
        delete this[name];
        return previous;
      },
      getPropertyValue(name) {
        return this[name] ?? "";
      },
    };
    this.dataset = {};
    this.attributes = {};
    this.scrollTop = 0;
    this.clientTop = 0;
    this.className = "";
    this.classList = {
      contains: (name) => this.className.split(" ").includes(name),
      add: (...names) => {
        this.className = [...new Set([...this.className.split(" "), ...names])].join(" ").trim();
      },
      remove: (...names) => {
        this.className = this.className
          .split(" ")
          .filter((name) => !names.includes(name))
          .join(" ");
      },
      toggle: (name, enabled) => (enabled ? this.classList.add(name) : this.classList.remove(name)),
    };
  }
  attachShadow() {
    this.shadowRoot = this.ownerDocument.createElement("shadow-root");
    this.shadowRoot.parentElement = this;
    return this.shadowRoot;
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  append(...children) {
    for (const child of children) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
      this.notifyMutation?.({
        type: "childList",
        target: this,
        addedNodes: [child],
        removedNodes: [],
      });
    }
  }
  prepend(...children) {
    this.append(...children);
    this.children.unshift(...this.children.splice(-children.length));
  }
  before(element) {
    const parent = this.parentElement;
    element.remove();
    element.parentElement = parent;
    parent.children.splice(parent.children.indexOf(this), 0, element);
    parent.notifyMutation?.({
      type: "childList",
      target: parent,
      addedNodes: [element],
      removedNodes: [],
    });
  }
  after(element) {
    const parent = this.parentElement;
    element.remove();
    element.parentElement = parent;
    parent.children.splice(parent.children.indexOf(this) + 1, 0, element);
    parent.notifyMutation?.({
      type: "childList",
      target: parent,
      addedNodes: [element],
      removedNodes: [],
    });
  }
  get previousElementSibling() {
    return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1];
  }
  get nextElementSibling() {
    return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1];
  }
  replaceChildren(...children) {
    for (const child of [...this.children]) child.remove();
    this.append(...children);
  }
  insertBefore(element, reference) {
    if (reference && reference.parentElement !== this) throw new Error("Reference is not a child");
    if (element === reference) return element;
    element.remove();
    element.parentElement = this;
    const index = reference ? this.children.indexOf(reference) : this.children.length;
    this.children.splice(index, 0, element);
    this.notifyMutation?.({
      type: "childList",
      target: this,
      addedNodes: [element],
      removedNodes: [],
    });
    return element;
  }
  remove() {
    this.parentElement?.notifyMutation?.({
      type: "childList",
      target: this.parentElement,
      addedNodes: [],
      removedNodes: [this],
    });
    if (this.parentElement)
      this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  querySelectorAll(selector) {
    const selectors = selector.split(",").map((part) => part.trim());
    return this.children.flatMap((child) => {
      const matches = selectors.some((part) =>
        part.startsWith("#")
          ? child.id === part.slice(1)
          : part.startsWith(".")
            ? child.className.split(" ").includes(part.slice(1))
            : child.localName === part,
      );
      return [...(matches ? [child] : []), ...child.querySelectorAll(selector)];
    });
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  matches(selector) {
    return selector.split(",").some((part) => {
      part = part.trim();
      if (part === "[role='button']") return this.getAttribute("role") === "button";
      if (part === "[contenteditable]") return this.getAttribute("contenteditable") !== null;
      return part === this.localName;
    });
  }
  contains(target) {
    return target === this || this.children.some((child) => child.contains(target));
  }
  get isConnected() {
    return this.localName === "body" || this.parentElement?.isConnected === true;
  }
  getBoundingClientRect() {
    if (this.className.split(" ").includes("qap-state-row"))
      return { top: 0, height: this.ownerDocument.layout.rowHeight };
    if (this.className.split(" ").includes("qap-state-list")) {
      const body = this.ownerDocument.body.querySelector(".qap-body");
      return { top: this.ownerDocument.layout.listOffset - body.scrollTop };
    }
    if (this.className === "qap-body") return { top: 0 };
    return { left: 300, top: 700, right: 356, bottom: 756 };
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    if (this.localName === "qap-dialog") this.dispatchEvent(new Event("closed"));
  }
  focus() {}
  scrollIntoView() {}
  click() {
    const event = new Event("click");
    event.detail = 0;
    this.dispatchEvent(event);
  }
}

function environment(
  origin = "http://homeassistant.local:8123",
  server = new ProfileServer(),
  { fresh = false, onDynamicImport } = {},
) {
  const timers = new Map();
  let timerId = 0;
  let now = 0;
  const window = new EventTargetDouble();
  const connection = new EventTargetDouble();
  const status = {
    callback: null,
    subscriptions: 0,
    unsubscriptions: 0,
    fail: false,
    snapshot: { enabled: false },
  };
  connection.subscribeMessage = async (callback, message, options) => {
    if (message.type === "quick_access/subscribe_profiles") {
      if (server.failLoads) throw new Error("Could not load profiles");
      const listener = { user: status.hass.user.id, callback };
      server.listeners.add(listener);
      callback(clone(server.data(listener.user)));
      return async () => {
        server.listeners.delete(listener);
      };
    }
    status.subscriptions++;
    status.subscriptionOptions = options;
    assert.equal(message.type, "quick_access/subscribe_status");
    if (status.fail) throw new Error("not ready");
    status.callback = callback;
    status.subscribedUser = status.hass.user.id;
    callback(status.snapshot);
    return async () => {
      status.unsubscriptions++;
    };
  };
  const hass = { user: { id: "test-user" }, states: {}, connection };
  connection.sendMessagePromise = (message) => server.mutate(status.hass.user.id, message);
  const homeAssistant = new Element("home-assistant");
  Object.defineProperty(homeAssistant, "hass", { get: () => status.hass });
  const head = new Element("head");
  const body = new Element("body");
  const mutationObservers = new Set();
  const resizeObservers = new Set();
  const layout = {
    rowHeight: 67,
    rowGap: 7,
    listOffset: 160,
    viewportHeight: 500,
    paddingBottom: 24,
  };
  class ResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
    }
    observe(target) {
      this.targets.add(target);
      resizeObservers.add(this);
    }
    unobserve(target) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
      resizeObservers.delete(this);
    }
  }
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.queued = false;
      this.targets = new Map();
      this.records = [];
    }
    observe(target, options) {
      this.targets.set(target, options);
      mutationObservers.add(this);
    }
    disconnect() {
      this.targets.clear();
      this.records = [];
      mutationObservers.delete(this);
    }
    notify(target, record) {
      if (
        ![...this.targets].some(
          ([observed, options]) =>
            options[record.type] &&
            (observed === target || (options.subtree && observed.contains(target))) &&
            (record.type !== "attributes" ||
              !options.attributeFilter ||
              options.attributeFilter.includes(record.attributeName)),
        )
      )
        return;
      this.records.push(record);
      if (this.queued) return;
      this.queued = true;
      queueMicrotask(() => {
        this.queued = false;
        const records = this.records;
        this.records = [];
        if (records.length) this.callback(records, this);
      });
    }
  }
  const createElement = (tag) => {
    const element = new Element(tag);
    element.ownerDocument = document;
    // Owned menu lifecycle is asynchronous like Lit; real rendering, focus and
    // keyboard behavior are exercised by the Chromium suite.
    if (tag === "qap-menu") {
      element.updateComplete = Promise.resolve();
      let open = false;
      Object.defineProperty(element, "open", {
        get: () => open,
        set: (value) => {
          if (open === value) return;
          open = value;
          void Promise.resolve().then(() => {
            if (open === value && element.isConnected)
              element.dispatchEvent(new Event(value ? "wa-after-show" : "wa-after-hide"));
          });
        },
      });
    }
    if (tag === "qap-toast") {
      element.messages = [];
      element.show = async () => {
        element.messages.push(element.labelText);
      };
    }
    if (tag === "qap-menu-item")
      element.click = () => {
        if (!element.disabled)
          element.parentElement?.dispatchEvent(
            new CustomEvent("wa-select", { detail: { item: element }, cancelable: true }),
          );
      };

    Object.defineProperty(element, "clientHeight", {
      get: () => (element.className === "qap-body" ? layout.viewportHeight : 0),
    });
    element.notifyMutation = (record) => {
      for (const observer of mutationObservers) observer.notify(element, record);
    };
    return element;
  };
  for (const element of [body, head, homeAssistant])
    element.notifyMutation = (record) => {
      for (const observer of mutationObservers) observer.notify(element, record);
    };
  const document = new EventTargetDouble();
  homeAssistant.ownerDocument = document;
  Object.assign(document, {
    head,
    body,
    layout,
    createElement,
    querySelector: (selector) =>
      selector === "home-assistant" ? homeAssistant : body.querySelector(selector),
  });
  Object.defineProperty(document, "styleSheets", {
    get: () => head.children.map(({ href }) => ({ href })),
  });
  status.hass = hass;
  const storage = new Map();
  const definitions = new Map();
  const context = vm.createContext({
    window,
    document,
    URL,
    AbortController,
    CustomEvent,
    Event,
    MutationObserver,
    ResizeObserver,
    HTMLElement: class extends Element {
      constructor() {
        super("custom-element");
        this.ownerDocument = document;
      }
    },
    getComputedStyle: () => ({
      rowGap: String(layout.rowGap),
      paddingBottom: String(layout.paddingBottom),
    }),
    requestAnimationFrame: (callback) => {
      timers.set(++timerId, { callback, delay: 16, once: true });
      return timerId;
    },
    cancelAnimationFrame: (id) => timers.delete(id),
    innerWidth: 390,
    innerHeight: 844,
    location: { origin, pathname: "/lovelace/home" },
    navigator: {},
    customElements: {
      get: (tag) => definitions.get(tag),
      define: (tag, cls) => definitions.set(tag, cls),
    },
    console: {
      info() {},
      warn(...args) {
        if (process.env.QUICK_ACCESS_TEST_TRACE) console.warn(...args);
      },
    },
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    localStorage: {
      get length() {
        return storage.size;
      },
      key: (index) => [...storage.keys()][index] ?? null,
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    setInterval: (callback, delay) => {
      timers.set(++timerId, { callback, delay });
      return timerId;
    },
    clearInterval: (id) => timers.delete(id),
    setTimeout: (callback, delay) => {
      timers.set(++timerId, { callback, delay, once: true });
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  window.confirm = () => {
    throw new Error("Use the confirmation modal");
  };
  window.innerWidth = context.innerWidth;
  window.location = context.location;
  const modules = createModuleLoader(context, { onDynamicImport });
  const run = (file = "quick_access.js") => modules.load(file);
  const tick = async (delay = 350) => {
    now += delay;
    for (const [id, timer] of [...timers]) {
      if (timer.delay === delay && timers.has(id)) {
        if (timer.once) timers.delete(id);
        timer.callback();
      }
    }
    await new Promise(setImmediate);
  };
  const resize = (width, height = context.innerHeight) => {
    context.innerWidth = window.innerWidth = width;
    context.innerHeight = window.innerHeight = height;
    window.dispatchEvent(new Event("resize"));
  };
  const env = {
    definitions,
    run,
    tick,
    resize,
    context,
    window,
    document,
    homeAssistant,
    connection,
    status,
    timers,
    storage,
    server,
    mutationObservers,
    resizeObservers,
    layout,
    notifyResize: () => {
      for (const observer of resizeObservers)
        observer.callback([{ target: body.querySelector(".qap-body") }]);
    },
    enable: (enabled, entry_id = "quick-access-entry") => {
      status.snapshot = { enabled, entry_id };
      if (status.subscribedUser !== status.hass?.user?.id) {
        connection.dispatchEvent(new Event("ready"));
        return;
      }
      status.callback(status.snapshot);
    },
    fab: () => body.querySelector("#qap-fab"),
  };
  if (!fresh) {
    server.data("test-user").profiles.push({
      id: "test-profile",
      name: "Default",
      icon: "mdi:devices",
      settings: defaultSettings(),
      favorites: [],
      categories: defaultCategories(),
    });
    storage.set(
      `quick_access_v1:${server.instanceId}:test-user:active-profile`,
      JSON.stringify("test-profile"),
    );
  }
  return env;
}

async function openEntityStates(env) {
  await startProfiles(env, false);
  await clickAndFlush(env.fab());
  if (env.document.body.querySelector(".qap-create-default-profile")) {
    await clickAndFlush(env.document.body.querySelector(".qap-create-default-profile"));
  }
  await clickAndFlush(env.document.body.querySelector(".qap-tile"));
  return env.document.body.querySelector(".qap-search-input");
}

function statesProvider(env) {
  const listeners = new Set();
  let lastCallback;
  env.homeAssistant.addEventListener("context-request", (event) => {
    if (event.context !== "states") return;
    assert.equal(event.subscribe, true);
    assert.equal(event.contextTarget.className, "qap-states");
    lastCallback = event.callback;
    listeners.add(event.callback);
    event.callback(env.status.hass.states, () => listeners.delete(event.callback));
  });
  return {
    listeners,
    publish: (states) => {
      env.status.hass = { ...env.status.hass, states };
      for (const callback of listeners) callback(states, () => listeners.delete(callback));
    },
    lateCallback: () => lastCallback(env.status.hass.states, () => listeners.delete(lastCallback)),
  };
}

function haContextsProvider(env, contexts) {
  const listeners = new Map(contexts.map((context) => [context, new Map()]));
  const callbacks = [];
  env.homeAssistant.addEventListener("context-request", (event) => {
    const subscriptions = listeners.get(event.context);
    if (!subscriptions) return;
    assert.equal(event.subscribe, true);
    assert.equal(event.contextTarget, env.document.body);
    const unsubscribe = () => subscriptions.delete(event.callback);
    subscriptions.set(event.callback, unsubscribe);
    callbacks.push(() => event.callback({}, unsubscribe));
    event.callback({}, unsubscribe);
  });
  return {
    listeners,
    callbacks,
    publish(context) {
      for (const [callback, unsubscribe] of listeners.get(context)) callback({}, unsubscribe);
    },
  };
}

function deviceFixture(id = "device_a", fields = {}) {
  return {
    id,
    name: "Thermostat",
    name_by_user: "Kitchen thermostat",
    area_id: "kitchen",
    manufacturer: "Example",
    model: "T1",
    model_id: "t-1",
    sw_version: "1.2",
    hw_version: null,
    serial_number: "SN-01",
    identifiers: [["demo", id]],
    connections: [["mac", "01:23:45:67:89:ab"]],
    config_entries: ["entry_a"],
    via_device_id: null,
    labels: [],
    disabled_by: null,
    ...fields,
  };
}

async function openDevices(env) {
  const create = env.document.createElement;
  env.document.createElement = (tag) => {
    const element = create(tag);
    element.focus = () => {
      env.document.activeElement = element;
    };
    return element;
  };
  await openEntityStates(env);
  buttons(env.document.body)
    .find((control) => control.title === "Back")
    .click();
  const tile = env.document.body
    .querySelectorAll(".qap-tile")
    .find(
      (item) =>
        item.localName === "button" &&
        item.querySelector(".qap-tile-name").textContent === "Device Explorer",
    );
  assert.ok(tile, "Device Explorer opens inside Quick Access");
  await clickAndFlush(tile);
  return env.document.body.querySelector(".qap-search-input");
}

function installDeviceRegistries(env, devices = [deviceFixture()]) {
  env.status.hass.devices = Object.fromEntries(devices.map((device) => [device.id, device]));
  env.status.hass.areas = { kitchen: { area_id: "kitchen", name: "Kitchen" } };
}

function nativeComponents(env, initiallyLoaded = true) {
  const tags = [
    "qap-search",
    "ha-icon-picker",
    "qap-input",
    "qap-select",
    "qap-select-selector",
    "qap-radio-group",
    "qap-radio-option",
    "qap-list",
    "qap-list-item",
  ];
  const registered = new Set(initiallyLoaded ? tags : []);
  const pending = new Map();
  const definitionCalls = new Map();
  env.context.customElements = {
    define: (tag, cls) => env.definitions.set(tag, cls),
    get: (tag) => (registered.has(tag) ? Element : env.definitions.get(tag)),
    whenDefined: (tag) => {
      definitionCalls.set(tag, (definitionCalls.get(tag) || 0) + 1);
      return registered.has(tag)
        ? Promise.resolve()
        : new Promise((resolve) => {
            if (!pending.has(tag)) pending.set(tag, []);
            pending.get(tag).push(resolve);
          });
    },
  };
  return {
    definitionCalls,
    register: (...names) => {
      for (const tag of names.length ? names : tags) {
        registered.add(tag);
        for (const resolve of pending.get(tag) || []) resolve();
        pending.delete(tag);
      }
    },
  };
}

function buttons(root) {
  return ["button", "qap-button", "qap-icon-button", "qap-chip", "qap-menu-item"].flatMap((tag) =>
    root.querySelectorAll(tag),
  );
}

function iconColorInput(root) {
  const field = root.querySelector(".qap-icon-color-field");
  return field.querySelector("qap-input") || field.querySelector("input, qap-input");
}

// Capture the injected control service while exercising the real launcher owner.
async function componentEnvironment(initiallyLoaded = false) {
  const env = environment();
  const components = nativeComponents(env, initiallyLoaded);
  const { createControls } = await env.run("ui/controls.js");
  const { createLauncher } = await env.run("launcher/launcher-controller.js");
  let controls;
  const launcher = createLauncher({
    controlsFactory: (dependencies) => {
      controls = createControls(dependencies);
      return controls;
    },
  });
  launcher.start();
  await env.tick();
  env.enable(true);
  await flush();
  return { env, components, api: controls, launcher };
}

function respondToDiscard(env, discard = true) {
  const modal = env.document.body
    .querySelectorAll(".qap-discard-changes-confirmation")
    .find((element) => element.open);
  assert.ok(modal, "Unsaved changes use the existing confirmation modal");
  if (discard) modal.querySelector(".qap-button-danger").click();
  else
    buttons(modal)
      .find((button) => button.textContent === "Cancel" || button.textContent === "Odustani")
      .click();
}

function openLauncherSettings(env, screen = "visibility") {
  if (!env.document.body.querySelector(".qap-settings-dialog")) {
    env.fab().click();
    buttons(env.document.body)
      .find((button) => button.title === "Settings")
      ?.click();
  }
  openSettingsScreen(env, screen);
}

function openSettingsScreen(env, screen) {
  const root = env.document.body;
  const destination = {
    visibility: ".qap-save-settings",
    shortcuts: ".qap-shortcut-groups",
    categories: ".qap-categories-manager",
    profiles: ".qap-profiles",
    settings: ".qap-settings-overview",
  }[screen];
  if (root.querySelector(destination)) return;
  for (let i = 0; i < 3 && !root.querySelector(".qap-settings-overview"); i++) {
    const back = buttons(root).find((button) => button.title === "Back");
    if (!back) return;
    back.click();
  }
  if (screen !== "settings") root.querySelector(".qap-settings-" + screen)?.click();
}

function returnToLauncher(env) {
  for (
    let i = 0;
    i < 4 && env.document.body.querySelector(".qap-title")?.textContent !== "Quick Access";
    i++
  ) {
    buttons(env.document.body)
      .find((button) => button.title === "Back")
      ?.click();
  }
}

function navigationEnvironment() {
  const env = environment();
  const location = env.window.location;
  const entries = [{ state: { keep: "HA state" }, path: location.pathname }];
  let index = 0;
  let traversals = 0;
  const history = (env.window.history = {
    get state() {
      return entries[index].state;
    },
    get length() {
      return entries.length;
    },
    pushState(state, title, url) {
      entries.splice(index + 1, entries.length, {
        state: structuredClone(state),
        path: url || location.pathname,
      });
      index++;
      location.pathname = entries[index].path;
    },
    replaceState(state, title, url) {
      entries[index] = { state: structuredClone(state), path: url || location.pathname };
      location.pathname = entries[index].path;
    },
    go(delta) {
      const target = index + delta;
      if (!delta || target < 0 || target >= entries.length) return;
      traversals++;
      setImmediate(() => {
        index = target;
        location.pathname = entries[index].path;
        env.window.dispatchEvent(new Event("popstate"));
        traversals--;
      });
    },
    back() {
      this.go(-1);
    },
    forward() {
      this.go(1);
    },
  });
  env.historyIndex = () => index;
  env.settle = async () => {
    await flush();
    for (let attempt = 0; traversals && attempt < 20; attempt++) await flush();
    assert.equal(traversals, 0, "history traversals settle without loops");
  };
  env.back = async () => {
    history.back();
    await env.settle();
  };
  env.forward = async () => {
    history.forward();
    await env.settle();
  };
  return env;
}

async function scrollStates(env, top) {
  const body = env.document.body.querySelector(".qap-body");
  body.scrollTop = top;
  body.dispatchEvent(new Event("scroll"));
  await env.tick(16);
}

async function reachableStateIds(env) {
  const ids = new Set();
  const count = Number(env.document.body.querySelector(".qap-count").textContent.split(" ")[0]);
  const stride = env.layout.rowHeight + env.layout.rowGap;
  for (
    let top = 0;
    top < env.layout.listOffset + count * stride;
    top += env.layout.viewportHeight
  ) {
    await scrollStates(env, top);
    for (const row of env.document.body.querySelectorAll(".qap-state-row"))
      ids.add(row.dataset.entity);
  }
  return [...ids].sort();
}

function largeStates(count) {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => {
      const entity_id = `sensor.entity_${String(index).padStart(5, "0")}`;
      return [
        entity_id,
        { entity_id, state: String(index), attributes: { friendly_name: `Entity ${index}` } },
      ];
    }),
  );
}

async function openSettings(pathname, settings, env = environment(), screen = "visibility") {
  env.window.location.pathname = pathname;
  env.window.location.search = "?more-info-entity-id=sensor.temperature";
  env.window.location.hash = "#details";
  if (settings) Object.assign(savedProfile(env).settings, settings);
  await startProfiles(env, false);
  await clickAndFlush(env.fab());
  await clickAndFlush(buttons(env.document.body).find((element) => element.title === "Settings"));
  openSettingsScreen(env, screen);
  return env;
}

async function openShortcutsSettings(pathname, settings, env = environment()) {
  return openSettings(pathname, settings, env, "shortcuts");
}

const maxProfileItems = Number(
  readFileSync(
    path.join(__dirname, "../../custom_components/quick_access/profiles.py"),
    "utf8",
  ).match(/MAX_SHORTCUTS = (\d+)/)[1],
);
function manyShortcuts(count, group = "favorites") {
  return Array.from({ length: count }, (_, index) => ({
    id: `shortcut-${index}`,
    name: `Shortcut ${index}`,
    type: "internal",
    path: `/s/${index}`,
    icon: "mdi:home",
    color: "",
    group,
  }));
}

function changeValidationControl(control, value, event = "input") {
  control.value = value;
  control.dispatchEvent(
    control.localName === "qap-icon-picker"
      ? new CustomEvent("value-changed", { detail: { value } })
      : new Event(event),
  );
}

function validationEnvironment(controls, delayed = false) {
  const env = environment();
  const components =
    controls === "fallback" ? null : nativeComponents(env, !delayed && controls === "HA picker");
  if (!delayed && controls === "HA input") components.register("qap-input", "qap-select");
  const create = env.document.createElement;
  env.document.createElement = (tag) => {
    const element = create(tag);
    element.focus = () => {
      env.document.activeElement = element;
    };
    element.scrollIntoView = (options) => {
      element.lastScrollOptions = options;
    };
    if (["qap-input", "qap-icon-picker"].includes(tag)) element.updateComplete = Promise.resolve();
    return element;
  };
  return { env, components };
}

async function shortcutValidationEditor(controls, delayed = false) {
  const { env, components } = validationEnvironment(controls, delayed);
  await openShortcutsSettings("/config/logs", undefined, env);
  await clickAndFlush(env.document.body.querySelector(".qap-add-shortcut"));
  const editor = env.document.body.querySelector(".qap-shortcut-form");
  const fields = () => {
    const inputs = editor.querySelectorAll("qap-input");
    const fallbacks = editor.querySelectorAll("input, qap-input");
    const iconField = editor.querySelector(".qap-icon-field");
    return {
      name: inputs.find((field) => field.label === "Name") || fallbacks[0],
      icon:
        iconField.querySelector("qap-icon-picker") ||
        iconField.querySelector("qap-input") ||
        iconField.querySelector("input, qap-input"),
      route: inputs.find((field) => field.label === "URL path") || fallbacks.at(-1),
      type: editor.querySelector("qap-select") || editor.querySelector("select, qap-select"),
    };
  };
  const errorFor = (control) => control.parentElement.querySelector(".qap-field-error");
  return {
    env,
    components,
    editor,
    fields,
    change: changeValidationControl,
    errorFor,
    save: buttons(editor).find((button) => button.textContent === "Save"),
  };
}

// Arrangement uses the shared reorder controller, but commits only on category Save.
async function openArrangement(env, id = "favorites") {
  const manager = openCategoriesManager(env);
  const row = manager.querySelectorAll(".qap-category-row").find((row) => row.dataset.id === id);
  await clickAndFlush(categoryAction(env, row, "edit"));
  const form = env.document.body.querySelector(".qap-category-form");
  const list = form.querySelector(".qap-arrangement-enabled");
  const surface = form.querySelector(".qap-arrangement");
  return { form, list, surface, ids: () => list.children.map((item) => item.dataset.id) };
}

// Add from Edit Group: the shortcut persists at once, the arrangement only on group Save.
async function groupWithShortcuts(
  env,
  count,
  grid = { columns: 2, rows: 2 },
  { native = false } = {},
) {
  if (native) nativeComponents(env);
  const profile = savedProfile(env);
  profile.categories[0].grid = grid;
  profile.categories.push({ id: "tools", name: "Tools" });
  profile.settings.links = [
    ...manyShortcuts(count),
    { ...manyShortcuts(1, "tools")[0], id: "other" },
    { ...manyShortcuts(1)[0], id: "disabled", name: "Disabled", hidden: true },
  ];
  await openShortcutsSettings("/config", undefined, env);
  return openArrangement(env);
}
const addTileOf = (form) => form.querySelector(".qap-arrangement-add");
const optionsOf = (control) =>
  clone(
    control.options ||
      control.children.map((item) => ({ value: item.value, label: item.textContent })),
  );
const placeholderCount = (form) =>
  form.querySelector(".qap-arrangement-placeholders").children.length;
async function openNestedEditor(env, form) {
  await clickAndFlush(addTileOf(form));
  return env.document.body.querySelector(".qap-shortcut-editor");
}
function fillNewShortcut(editor, name, route = "/new") {
  const fields = editor.querySelector(".qap-shortcut-form").querySelectorAll("input, qap-input");
  fields[0].value = name;
  fields[0].dispatchEvent(new Event("input"));
  fields.at(-1).value = route;
  fields.at(-1).dispatchEvent(new Event("input"));
}
async function saveNewShortcut(editor, name, route) {
  fillNewShortcut(editor, name, route);
  await clickAndFlush(buttons(editor).find((button) => button.textContent === "Save"));
}
// Changing an existing shortcut's group asks before Save writes the transfer.
function moveConfirmation(env) {
  return env.document.body
    .querySelectorAll(".qap-move-shortcut-confirmation")
    .find((element) => element.open);
}
async function confirmMove(env, confirm = true) {
  const modal = moveConfirmation(env);
  assert.ok(modal, "a category change asks for confirmation");
  await clickAndFlush(
    buttons(modal).find((button) => button.textContent === (confirm ? "Move shortcut" : "Cancel")),
  );
}
const shortcutIds = (env, group = "favorites") =>
  savedProfile(env)
    .settings.links.filter((link) => link.group === group)
    .map((link) => link.id);
async function reorderToCADB(view) {
  // A, B, C, D -> C, A, D, B through keyboard reordering only.
  const [, b, c] = view.list.children;
  await arrangeKey(c, "ArrowLeft");
  await arrangeKey(c, "ArrowLeft");
  await arrangeKey(b, "ArrowRight");
  assert.deepEqual(view.ids(), ["shortcut-2", "shortcut-0", "shortcut-3", "shortcut-1"]);
}

function arrangementGeometry({ form, list, surface }) {
  surface.clientHeight = 300;
  surface.scrollHeight = 3000;
  surface.scrollTop = 0;
  surface.clientWidth = 300;
  surface.scrollWidth = 300;
  surface.scrollLeft = 0;
  surface.getBoundingClientRect = () => ({
    left: 0,
    right: 300,
    top: 100,
    bottom: 400,
    width: 300,
    height: 300,
  });
  list.getBoundingClientRect = () => ({
    left: 0,
    right: 300,
    top: 100,
    bottom: 3100,
    width: 300,
    height: 3000,
  });
  for (const item of list.children) {
    item.getBoundingClientRect = () => {
      const index = list.children.indexOf(item);
      const [columns, rows] = form
        .querySelector(".qap-grid-fields")
        .querySelectorAll("qap-input")
        .map((field) => Number(field.value));
      const left = (index % columns) * 100;
      const top =
        128 +
        Math.floor(index / columns) * 60 +
        Math.floor(index / (columns * rows)) * 28 -
        surface.scrollTop;
      return { left, right: left + 90, top, bottom: top + 50, width: 90, height: 50 };
    };
  }
}
function arrangementPointer(env, item) {
  const grip = item;
  let captured = false;
  grip.setPointerCapture = () => {
    captured = true;
  };
  grip.hasPointerCapture = () => captured;
  grip.releasePointerCapture = () => {
    captured = false;
  };
  return (type, x = 45, y = 150) => {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      button: 0,
      pointerId: 7,
      clientX: x,
      clientY: y,
    });
    (["pointermove", "pointerup", "pointercancel"].includes(type)
      ? env.document
      : grip
    ).dispatchEvent(event);
    return event;
  };
}
const arrangeKey = (item, key) =>
  dispatchAndFlush(
    item,
    Object.assign(new Event("keydown", { cancelable: true }), { altKey: true, key }),
  );

function fabPointer(env, type, x = 320, y = 720, pointerType = "mouse") {
  const fab = env.fab();
  fab.setPointerCapture = () => {};
  fab.hasPointerCapture = () => false;
  fab.getBoundingClientRect = () => {
    const left = fab.style.left === "auto" ? 300 : parseFloat(fab.style.left);
    const top = fab.style.top === "auto" ? 700 : parseFloat(fab.style.top);
    return { left, top, right: left + 48, bottom: top + 48 };
  };
  fab.dispatchEvent(
    Object.assign(new Event(type), {
      pointerId: 1,
      pointerType,
      button: 0,
      clientX: x,
      clientY: y,
    }),
  );
}
async function dragFab(env, finish = "pointerup") {
  fabPointer(env, "pointerdown");
  await env.tick(480);
  fabPointer(env, "pointermove", 160, 420);
  fabPointer(env, finish, 160, 420);
}

function delayNativeFocus(env, tag) {
  const pending = new Map();
  const createElement = env.document.createElement;
  env.document.createElement = (name) => {
    const element = createElement(name);
    if (name !== tag) return element;
    let ready = false;
    let resolve;
    const state = { earlyFocus: 0, focusCalls: 0 };
    element.updateComplete = new Promise((done) => {
      resolve = done;
    });
    state.render = () => {
      ready = true;
      resolve(true);
    };
    element.focus = () => {
      // A real HA button would throw here because its inner button is null.
      if (!ready) {
        state.earlyFocus++;
        return;
      }
      state.focusCalls++;
      env.document.activeElement = element;
    };
    pending.set(element, state);
    return element;
  };
  return pending;
}

async function startProfiles(env, initializeDefault = true) {
  await env.run();
  await env.tick();
  env.enable(true);
  await flush();
  if (
    initializeDefault &&
    !env.window.quickAccessDebug().profileError &&
    !env.server.data(env.status.hass.user.id).profiles.length
  ) {
    env.fab().click();
    await clickAndFlush(env.document.body.querySelector(".qap-create-default-profile"));
    buttons(env.document.body)
      .find((button) => button.title === "Close")
      ?.click();
  }
  return env;
}
async function profileManager(env) {
  openLauncherSettings(env, "settings");
  env.document.body.querySelector(".qap-manage-profiles")?.click();
  await flush();
  return env.document.body.querySelector("qap-dialog");
}
async function useProfile(env, id) {
  const manager = await profileManager(env);
  profileRowIn(manager, id).querySelector(".qap-profile-activate")?.click();
  await flush();
  // Leave the helper in Settings whether selection started in setup or management.
  if (manager.querySelector(".qap-home"))
    await clickAndFlush(buttons(manager).find((button) => button.title === "Settings"));
  else await clickAndFlush(env.document.body.querySelector(".qap-head-button"));
}
function profileRowIn(root, id) {
  return root.querySelectorAll(".qap-profile-row").find((row) => row.dataset.id === id);
}
function activeProfileEditor(env) {
  return env.document.body.querySelectorAll(".qap-profile-editor").find((element) => element.open);
}
function profileMenuIn(env) {
  return (
    env.document.body.querySelector(".qap-profile-dropdown") ||
    env.document.body.querySelector(".qap-profile-menu")
  );
}
async function shortcutAction(
  env,
  action = "edit",
  trigger = env.document.body.querySelector(".qap-shortcut-overflow"),
) {
  if (["edit", "delete"].includes(action)) {
    if (!env.document.body.querySelector(".qap-shortcut-form"))
      await clickAndFlush(trigger.parentElement.querySelector(".qap-shortcut-row"));
    if (action === "delete")
      await clickAndFlush(
        env.document.body.querySelector(".qap-shortcut-form").querySelector(".qap-delete-shortcut"),
      );
    return;
  }
  await clickAndFlush(trigger);
  await clickAndFlush(profileMenuIn(env).querySelector(`.qap-${action}-shortcut`));
}
function profileNameInput(editor) {
  return editor.querySelector("qap-input") || editor.querySelector("input, qap-input");
}
async function manageProfile(env, id, action) {
  const manager = await profileManager(env);
  // Editing is the row's main action; secondary actions stay in the overflow menu.
  if (action === "edit") {
    await clickAndFlush(profileRowIn(manager, id).querySelector(".qap-profile-content"));
    return activeProfileEditor(env);
  }
  await clickAndFlush(profileRowIn(manager, id).querySelector(".qap-profile-overflow"));
  await clickAndFlush(profileMenuIn(env).querySelector(`.qap-${action}-profile`));
  return activeProfileEditor(env);
}
async function createProfileInDialog(env, name) {
  const manager = await profileManager(env);
  manager.querySelector(".qap-create-profile").click();
  const editor = activeProfileEditor(env);
  profileNameInput(editor).value = name;
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
}
const deviceKey = (env, user = "test-user", id = env.window.quickAccessDebug().activeProfileId) =>
  `quick_access_v1:${env.server.instanceId}:${user}:${id}`;

function trackFocus(env) {
  const create = env.document.createElement;
  env.document.createElement = (tag) => {
    const element = create(tag);
    element.focus = () => {
      env.document.activeElement = element;
    };
    element.scrollIntoView = (options) => {
      element.lastScrollOptions = options;
    };
    return element;
  };
}
function chooseProfileCopy(editor) {
  const group = editor.querySelector("qap-radio-group");
  group.value = "copy";
  group.dispatchEvent(new Event("change"));
}

function profileIconControl(editor) {
  const field = editor.querySelector(".qap-profile-icon-field");
  return (
    field.querySelector("qap-icon-picker") ||
    field.querySelector("qap-input") ||
    field.querySelector("input, qap-input")
  );
}
function setProfileIcon(editor, value) {
  const control = profileIconControl(editor);
  if (control.localName === "qap-icon-picker")
    control.dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
  else {
    control.value = value;
    control.dispatchEvent(new Event("input"));
  }
}

function categoryInput(form) {
  return form.querySelector("qap-input") || form.querySelector("input, qap-input");
}
function openCategoriesManager(env) {
  openSettingsScreen(env, "categories");
  return env.document.body.querySelector(".qap-categories-dialog");
}
function categoryAction(env, row, action) {
  if (action === "edit") return row.querySelector(".qap-category-edit");
  row.querySelector(".qap-category-overflow").click();
  return env.document.body.querySelector(".qap-" + action + "-category");
}
function categorySelect(root) {
  const field = root.querySelector(".qap-category-dropdown");
  return field.querySelector("qap-select") || field.querySelector("select, qap-select");
}
async function selectAndFlush(control, value) {
  control.value = value;
  await dispatchAndFlush(control, new Event("change"));
}
async function openCategoryCreate(env) {
  const control = categorySelect(env.document.body);
  if (control.localName === "qap-select") {
    await selectAndFlush(control, "add-category");
  } else {
    control.value = "add-category";
    await dispatchAndFlush(control, new Event("change"));
  }
  return env.document.body.querySelector(".qap-category-form");
}
async function createCategoryInSettings(env, name) {
  openCategoriesManager(env).querySelector(".qap-create-category").click();
  const form = env.document.body.querySelector(".qap-category-form");
  categoryInput(form).value = name;
  await clickAndFlush(form.querySelector(".qap-category-submit"));
}

const selectionKey = (instance = "test-instance", user = "test-user") =>
  `quick_access_v1:${instance}:${user}:active-profile`;
const launcherKey = (instance = "test-instance", user = "test-user") =>
  `quick_access_v1:${instance}:${user}:launcher-enabled`;
const toggleLauncher = (panel, enabled) => {
  panel._launcherToggle.checked = enabled;
  panel._launcherToggle.dispatchEvent(new Event("change"));
};
const deviceStatus = (panel) => panel.shadowRoot.querySelector(".device-status").textContent;
const chooseDeviceProfile = (panel, id) => {
  const select = panel.shadowRoot.querySelector("#device-profile");
  select.value = id;
  select.dispatchEvent(new Event("change"));
};
const confirmDevice = (panel) => panel.shadowRoot.querySelector(".confirm-device").click();
const storageEvent = (env, key, storageArea = env.context.localStorage) => {
  const event = new Event("storage");
  Object.assign(event, { key, storageArea });
  env.window.dispatchEvent(event);
};
async function deviceEnvironment() {
  const env = panelEnvironment(undefined, await startProfiles(environment()));
  await env.mountPanel();
  await flush();
  return env;
}

module.exports = {
  attributesValue,
  configSource,
  externalURLCases,
  loadDefaults,
  installLocaleFetch,
  trackLocalizationBindings,
  changeLanguage,
  panelEnvironment,
  flush,
  clickAndFlush,
  dispatchAndFlush,
  defaultCategories,
  defaultSettings,
  clone,
  filterDefinitions,
  filterField,
  filterAction,
  editNewFilter,
  setFilterField,
  filterValueOptions,
  ProfileServer,
  savedProfile,
  EventTargetDouble,
  Element,
  environment,
  openEntityStates,
  statesProvider,
  haContextsProvider,
  deviceFixture,
  openDevices,
  installDeviceRegistries,
  nativeComponents,
  buttons,
  iconColorInput,
  componentEnvironment,
  respondToDiscard,
  openLauncherSettings,
  openSettingsScreen,
  returnToLauncher,
  navigationEnvironment,
  scrollStates,
  reachableStateIds,
  largeStates,
  openSettings,
  openShortcutsSettings,
  maxProfileItems,
  manyShortcuts,
  changeValidationControl,
  validationEnvironment,
  shortcutValidationEditor,
  openArrangement,
  groupWithShortcuts,
  addTileOf,
  optionsOf,
  placeholderCount,
  openNestedEditor,
  moveConfirmation,
  confirmMove,
  fillNewShortcut,
  saveNewShortcut,
  shortcutIds,
  reorderToCADB,
  arrangementGeometry,
  arrangementPointer,
  arrangeKey,
  fabPointer,
  dragFab,
  delayNativeFocus,
  startProfiles,
  profileManager,
  useProfile,
  profileRowIn,
  activeProfileEditor,
  profileMenuIn,
  shortcutAction,
  profileNameInput,
  manageProfile,
  createProfileInDialog,
  deviceKey,
  trackFocus,
  chooseProfileCopy,
  profileIconControl,
  setProfileIcon,
  categoryInput,
  openCategoriesManager,
  categoryAction,
  categorySelect,
  selectAndFlush,
  openCategoryCreate,
  createCategoryInSettings,
  selectionKey,
  launcherKey,
  toggleLauncher,
  deviceStatus,
  chooseDeviceProfile,
  confirmDevice,
  storageEvent,
  deviceEnvironment,
  assetVersion,
  createModuleLoader,
};
