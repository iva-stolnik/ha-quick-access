import english from "./locales/en.js";
import { assetUrl } from "./utils/assets.js";

const BINDING_SWEEP_INTERVAL_MS = 30000;
const BINDING_SWEEP_BATCH_SIZE = 100;
// Transient download failures are retried on later HA updates, backing off so
// frequent state changes never turn into a request per update.
const RETRY_INITIAL_DELAY_MS = 5000;
const RETRY_MAX_DELAY_MS = 300000;
const dictionaries = new Map([["en", english]]);
const requests = new Map();
const HA_KEYS = {
  "common.save": "ui.common.save",
  "common.cancel": "ui.common.cancel",
  "common.close": "ui.common.close",
  "common.back": "ui.common.back",
  "common.delete": "ui.common.delete",
};

function languageCode(language) {
  try {
    return Intl.getCanonicalLocales(String(language || "en").replaceAll("_", "-"))[0];
  } catch {
    return "en";
  }
}

function localeChain(language) {
  const exact = languageCode(language);
  return [...new Set([exact, exact.split("-")[0], "en"])];
}

/** Resolves true when the outcome is final, false after a transient failure. */
async function fetchDictionary(locale) {
  let dictionary;
  try {
    const response = await fetch(assetUrl(`locales/${encodeURIComponent(locale)}.json`));
    // Only a genuine 404 means the locale does not exist; proxies and service
    // workers report outages with other statuses.
    if (!response.ok) return response.status === 404;
    dictionary = await response.json();
  } catch {
    // Offline, or the body was cut off. English stays in use until a retry.
    return false;
  }
  // A malformed body (for example a proxy or captive portal page) is treated
  // like an outage rather than remembered as final.
  if (!dictionary || typeof dictionary !== "object" || Array.isArray(dictionary)) return false;
  dictionaries.set(locale, dictionary);
  return true;
}

function loadDictionary(locale) {
  if (dictionaries.has(locale)) return Promise.resolve(true);
  if (!requests.has(locale)) {
    // Share in-flight requests and remember final outcomes for this page
    // session. Transient failures are forgotten so a later load retries.
    // English is bundled, so a failed fetch never prevents rendering.
    const request = fetchDictionary(locale).then((final) => {
      if (!final && requests.get(locale) === request) requests.delete(locale);
      return final;
    });
    requests.set(locale, request);
  }
  return requests.get(locale);
}

// Localizers whose dictionaries failed to download, retried when the browser
// reports connectivity again. Weak references let destroyed components go.
const RETRY = Symbol("retry");
const awaitingNetwork = new Set();

function retryAwaitingNetwork() {
  const waiting = [...awaitingNetwork];
  awaitingNetwork.clear();
  for (const target of waiting) target.deref()?.[RETRY]();
}

function retryWhenOnline(target) {
  if (typeof globalThis.addEventListener !== "function") return;
  // Re-adding the same listener, or the same localizer reference, is a no-op.
  globalThis.addEventListener("online", retryAwaitingNetwork);
  awaitingNetwork.add(target);
}

function format(template, parameters, language) {
  if (template && typeof template === "object") {
    const count = Number(parameters.count);
    let plural = "other";
    try {
      plural = new Intl.PluralRules(language).select(count);
    } catch {
      /* Use other. */
    }
    template = template[`=${count}`] ?? template[plural] ?? template.other;
  }
  if (typeof template !== "string" || !template) return null;
  return template.replace(/\{([a-zA-Z_][\w]*)\}/g, (_, name) => {
    const value = parameters[name];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function createLocalizer(initialHass) {
  let hass = initialHass;
  let language = "";
  let localize = null;
  let ready = Promise.resolve();
  const bindings = new Map();
  let targets = new WeakMap();
  let registrationsSinceSweep = 0;
  let lastSweep = Date.now();
  let awaitingRetry = false;
  let retryDelay = RETRY_INITIAL_DELAY_MS;
  let nextRetryAt = 0;
  let self = null;

  function load() {
    const current = Promise.all(localeChain(language).map(loadDictionary)).then((results) => {
      refresh();
      // A newer load owns the retry state.
      if (ready !== current) return;
      if (!results.includes(false)) {
        awaitingRetry = false;
        retryDelay = RETRY_INITIAL_DELAY_MS;
        return;
      }
      awaitingRetry = true;
      nextRetryAt = Date.now() + retryDelay;
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_DELAY_MS);
      retryWhenOnline(self);
    });
    ready = current;
    return ready;
  }

  function sweep() {
    for (const target of bindings.keys()) {
      if (!target.deref()) bindings.delete(target);
    }
    registrationsSinceSweep = 0;
    lastSweep = Date.now();
  }

  function release(element) {
    if (!element) return;
    const target = targets.get(element);
    if (target) {
      bindings.delete(target);
      targets.delete(element);
    }
    for (const child of element.children || []) release(child);
  }

  class Message {
    constructor(key, parameters, haKey) {
      this.key = key;
      this.parameters = parameters;
      this.haKey = haKey;
    }
    toString() {
      return translate(this.key, this.parameters, this.haKey);
    }
  }

  function translate(key, parameters = {}, haKey) {
    if (haKey && typeof hass?.localize === "function") {
      const value = hass.localize(haKey);
      if (value && value !== haKey) return value;
    }
    for (const locale of localeChain(language)) {
      const dictionary = dictionaries.get(locale);
      if (!dictionary || !Object.hasOwn(dictionary, key)) continue;
      const value = format(dictionary[key], parameters, locale);
      if (value !== null) return value;
    }
    // Unknown keys are a developer error, but must never leak into the UI.
    return format(english["common.unavailable"], {}, "en");
  }

  function resolve(value) {
    if (typeof value === "function") return resolve(value());
    if (value instanceof Message) return String(value);
    if (Array.isArray(value)) return value.map(resolve);
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)]));
    }
    return value;
  }

  function isLocalized(value) {
    return (
      value instanceof Message ||
      typeof value === "function" ||
      (Array.isArray(value) && value.some(isLocalized)) ||
      (value &&
        Object.getPrototypeOf(value) === Object.prototype &&
        Object.values(value).some(isLocalized))
    );
  }

  function bind(element, name, value, attribute = false) {
    if (!element) return;
    const localized = isLocalized(value);
    let target = targets.get(element);
    if (!target && localized) {
      if (++registrationsSinceSweep >= BINDING_SWEEP_BATCH_SIZE) sweep();
      target = new WeakRef(element);
      targets.set(element, target);
      bindings.set(target, new Map());
    }
    const key = `${attribute ? "attribute" : "property"}:${name}`;
    const entries = target && bindings.get(target);
    const entry = { name, value, attribute };
    if (localized) entries.set(key, entry);
    else if (entries) {
      entries.delete(key);
      if (!entries.size) {
        bindings.delete(target);
        targets.delete(element);
      }
    }
    apply(element, entry);
  }

  function apply(element, entry) {
    const { name, value, attribute } = entry;
    const rendered = resolve(value);
    if (attribute) element.setAttribute(name, String(rendered));
    else if (name === "textContent") {
      // Buttons may prepend icons after receiving their label. Update the
      // original text node without removing those children or their listeners.
      const textNode = entry.textNode?.deref();
      if (textNode?.parentNode === element) textNode.data = String(rendered);
      else {
        element.textContent = rendered;
        entry.textNode =
          element.firstChild?.nodeType === 3 ? new WeakRef(element.firstChild) : null;
      }
    } else element[name] = rendered;
  }

  function refresh() {
    for (const [target, entries] of bindings) {
      const element = target.deref();
      if (!element) {
        bindings.delete(target);
        continue;
      }
      for (const entry of entries.values()) apply(element, entry);
    }
  }

  const api = {
    t: translate,
    message: (key, parameters = {}, haKey = HA_KEYS[key]) => new Message(key, parameters, haKey),
    text: (element, value) => bind(element, "textContent", value),
    property: (element, name, value) => bind(element, name, value),
    attribute: (element, name, value) => bind(element, name, value, true),
    properties: (element, values) => {
      for (const [name, value] of Object.entries(values)) bind(element, name, value);
    },
    release,
    clear() {
      bindings.clear();
      targets = new WeakMap();
      registrationsSinceSweep = 0;
      lastSweep = Date.now();
    },
    error: (message) => Object.assign(new Error(String(message)), { localizedMessage: message }),
    errorMessage: (error) =>
      error?.localizedMessage ||
      (error?.message ? new Message("errors.server", { message: error.message }) : undefined),
    get language() {
      return language || "en";
    },
    get ready() {
      return ready;
    },
    setHass(value) {
      hass = value;
      // HA updates continue even when the user keeps the same language.
      if (Date.now() - lastSweep >= BINDING_SWEEP_INTERVAL_MS) sweep();
      // HA replaces localize when its translations load or change. Ordinary
      // state updates keep the same function, so they skip the refresh.
      const nextLocalize = typeof hass?.localize === "function" ? hass.localize : null;
      const localizeChanged = nextLocalize !== localize;
      localize = nextLocalize;
      const next = languageCode(hass?.language);
      if (next === language) {
        if (localizeChanged) refresh();
        // Outages the browser does not report as offline (HTTP 503, malformed
        // responses) recover on a later update once the backoff has elapsed.
        if (awaitingRetry && Date.now() >= nextRetryAt) return api[RETRY]();
        return ready;
      }
      language = next;
      refresh();
      return load();
    },
    [RETRY]() {
      awaitingRetry = false;
      return load();
    },
  };
  self = new WeakRef(api);
  void api.setHass(initialHass);
  return api;
}
