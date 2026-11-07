const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const {
  assetVersion,
  createModuleLoader,
  frontend,
  frontendFiles,
} = require("./module-loader.cjs");
const croatian = JSON.parse(
  readFileSync(path.join(__dirname, "../frontend/public/locales/hr.json"), "utf8"),
);

async function localizationEnvironment(resources = {}, globals = {}) {
  const requests = [];
  const context = vm.createContext({
    URL,
    ...globals,
    fetch: async (url) => {
      requests.push(url);
      assert.ok(url.startsWith("/quick_access/locales/"));
      assert.equal(new URL(url, "https://ha.example").search, `?v=${assetVersion}`);
      const locale = decodeURIComponent(url.split("/").at(-1).split(".json")[0]);
      // A resource may be a dictionary, an Error to throw, an HTTP error
      // status, or a function returning one of those per request.
      const value = resources[locale];
      const resource = typeof value === "function" ? value() : value;
      if (resource instanceof Error) throw resource;
      if (typeof resource === "number") return { ok: false, status: resource };
      const ok = Object.hasOwn(resources, locale);
      return { ok, status: ok ? 200 : 404, json: async () => resource };
    },
  });
  const modules = createModuleLoader(context);
  const { createLocalizer } = await modules.load("localize.js");
  const { default: english } = await modules.load("locales/en.js");
  return { createLocalizer, requests, english };
}

function trackedBindings() {
  const maps = [];
  const collected = new WeakSet();
  let now = 0;
  class TestWeakRef {
    constructor(target) {
      this.target = target;
    }
    deref() {
      return collected.has(this.target) ? undefined : this.target;
    }
  }
  return {
    globals: {
      Map: class extends Map {
        constructor(...args) {
          super(...args);
          maps.push(this);
        }
      },
      WeakRef: TestWeakRef,
      Date: class extends Date {
        static now() {
          return now;
        }
      },
    },
    // Simulate collection so these tests do not depend on GC timing.
    collect: (element) => collected.add(element),
    advance: (milliseconds) => {
      now += milliseconds;
    },
    count: () =>
      maps.reduce(
        (count, map) => count + [...map.keys()].filter((key) => key instanceof TestWeakRef).length,
        0,
      ),
  };
}

test("localization: bundled English survives offline, missing and invalid locales and keys", async () => {
  const env = await localizationEnvironment({
    fr: new Error("offline"),
    de: ["invalid dictionary"],
    it: { "common.save": 42 },
  });
  const localizer = env.createLocalizer({ language: "fr-FR" });
  assert.equal(localizer.t("common.save"), "Save");
  await localizer.ready;
  assert.equal(localizer.t("common.save"), "Save");
  for (const language of ["de", "it", "zz-ZZ", "../../invalid", undefined, "en-US"]) {
    await localizer.setHass({ language });
    assert.equal(localizer.t("common.cancel"), "Cancel");
    assert.equal(localizer.t("common.save"), "Save");
    assert.equal(localizer.t("missing.key"), "Unavailable");
    assert.equal(localizer.t("toString"), "Unavailable");
  }
});

test("localization: exact locale wins, then base language, then English per key", async () => {
  const env = await localizationEnvironment({
    "hr-HR": { "common.save": "Regional save", "common.cancel": "" },
    hr: { "common.save": "Spremi", "common.cancel": "Odustani" },
  });
  const localizer = env.createLocalizer({ language: "hr_hr" });
  await localizer.ready;
  assert.equal(localizer.language, "hr-HR");
  assert.equal(localizer.t("common.save"), "Regional save");
  assert.equal(localizer.t("common.cancel"), "Odustani");
  assert.equal(localizer.t("profiles.create"), "Create profile");
  await localizer.setHass({ language: "hr-BA" });
  assert.equal(localizer.t("common.save"), "Spremi");
});

test("localization: components share successful, pending and missing dictionary requests", async () => {
  const env = await localizationEnvironment({ hr: croatian });
  const first = env.createLocalizer({ language: "hr-HR" });
  const second = env.createLocalizer({ language: "hr-HR" });
  await Promise.all([first.ready, second.ready]);
  assert.equal(env.requests.length, 2);
  assert.equal(second.t("common.save"), "Spremi");
  await first.setHass({ language: "en" });
  await first.setHass({ language: "hr-HR" });
  await second.setHass({ language: "hr-HR" });
  assert.equal(env.requests.length, 2);
});

test("localization: network failures are retried on language change and when back online", async () => {
  let online = false;
  const listeners = [];
  const globals = {
    addEventListener: (type, listener) => {
      if (type === "online" && !listeners.includes(listener)) listeners.push(listener);
    },
  };
  const hr = () => (online ? croatian : new TypeError("Failed to fetch"));

  // Switching language away and back retries the failed download.
  const env = await localizationEnvironment({ hr }, globals);
  const localizer = env.createLocalizer({ language: "hr" });
  await localizer.ready;
  assert.equal(localizer.t("common.save"), "Save");
  assert.equal(env.requests.length, 1);
  online = true;
  await localizer.setHass({ language: "en" });
  await localizer.setHass({ language: "hr" });
  assert.equal(localizer.t("common.save"), "Spremi");
  assert.equal(env.requests.length, 2);

  // The online event retries without a language change, once per localizer.
  online = false;
  listeners.length = 0;
  const second = await localizationEnvironment({ hr }, globals);
  const waiting = second.createLocalizer({ language: "hr" });
  await waiting.ready;
  await waiting.setHass({ language: "hr" });
  assert.equal(waiting.t("common.save"), "Save");
  assert.equal(listeners.length, 1);
  online = true;
  listeners[0]();
  await waiting.ready;
  assert.equal(waiting.t("common.save"), "Spremi");
  assert.equal(second.requests.length, 2);
  listeners[0]();
  await waiting.ready;
  assert.equal(second.requests.length, 2);
});

test("localization: server errors are retried but missing locales are remembered", async () => {
  let status = 503;
  const env = await localizationEnvironment({ hr: () => status });
  const localizer = env.createLocalizer({ language: "hr" });
  await localizer.ready;
  assert.equal(localizer.t("common.save"), "Save");
  status = 404;
  for (const language of ["en", "hr", "en", "hr"]) await localizer.setHass({ language });
  assert.equal(env.requests.length, 2);
});

function fakeClock() {
  let now = 0;
  return {
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    advance: (milliseconds) => {
      now += milliseconds;
    },
  };
}

test("localization: server errors recover on later HA updates with backoff", async () => {
  const clock = fakeClock();
  let resource = 503;
  const env = await localizationEnvironment({ hr: () => resource }, { Date: clock.Date });
  const localizer = env.createLocalizer({ language: "hr" });
  await localizer.ready;
  assert.equal(env.requests.length, 1);

  // The server recovers while the browser stays online; frequent updates
  // within the backoff window do not refetch.
  resource = croatian;
  for (let index = 0; index < 10; index++) await localizer.setHass({ language: "hr" });
  assert.equal(env.requests.length, 1);
  assert.equal(localizer.t("common.save"), "Save");

  clock.advance(5000);
  await localizer.setHass({ language: "hr" });
  assert.equal(env.requests.length, 2);
  assert.equal(localizer.t("common.save"), "Spremi");
  for (let index = 0; index < 10; index++) await localizer.setHass({ language: "hr" });
  clock.advance(600000);
  await localizer.setHass({ language: "hr" });
  assert.equal(env.requests.length, 2);
});

test("localization: repeated server errors double the retry delay up to a cap", async () => {
  const clock = fakeClock();
  const env = await localizationEnvironment({ hr: 503 }, { Date: clock.Date });
  const localizer = env.createLocalizer({ language: "hr" });
  await localizer.ready;
  for (const delay of [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000]) {
    const before = env.requests.length;
    clock.advance(delay - 1);
    await localizer.setHass({ language: "hr" });
    assert.equal(env.requests.length, before);
    clock.advance(1);
    await localizer.setHass({ language: "hr" });
    assert.equal(env.requests.length, before + 1);
  }
});

test("localization: malformed successful responses are retried instead of remembered", async () => {
  const clock = fakeClock();
  let resource = [];
  const env = await localizationEnvironment({ hr: () => resource }, { Date: clock.Date });
  const localizer = env.createLocalizer({ language: "hr" });
  await localizer.ready;
  assert.equal(localizer.t("common.save"), "Save");
  resource = croatian;
  clock.advance(5000);
  await localizer.setHass({ language: "hr" });
  assert.equal(env.requests.length, 2);
  assert.equal(localizer.t("common.save"), "Spremi");
});

test("localization: interpolation is literal text and plural rules follow the selected dictionary", async () => {
  const env = await localizationEnvironment({ hr: croatian });
  const localizer = env.createLocalizer({ language: "en" });
  for (const count of [0, 1, 2])
    assert.equal(
      localizer.t("entities.count", { count }),
      `${count} ${count === 1 ? "entity" : "entities"}`,
    );
  assert.equal(
    localizer.t("profiles.manage", { name: '<img src=x onerror="alert(1)">' }),
    'Manage <img src=x onerror="alert(1)">',
  );
  assert.equal(localizer.t("profiles.copy_name", { name: "My {profile}" }), "My {profile} (Copy)");
  assert.doesNotMatch(localizer.t("profiles.manage"), /undefined|\{name\}/);
  await localizer.setHass({ language: "hr-HR" });
  assert.equal(
    localizer.t("profiles.copy_name", { name: "Moj {profil}" }),
    "Moj {profil} (kopija)",
  );
  assert.equal(
    localizer.t("errors.server", { message: "offline" }),
    "Home Assistant prijavio je pogrešku: offline",
  );
  for (const [count, ending] of [
    [1, "entitet"],
    [2, "entiteta"],
    [5, "entiteta"],
    [21, "entitet"],
  ]) {
    assert.equal(localizer.t("entities.count", { count }), `${count} ${ending}`);
  }
  assert.match(localizer.t("shortcuts.count", { count: 1 }), /1 prečac/);
  assert.match(localizer.t("shortcuts.count", { count: 2 }), /2 prečaca/);
  assert.match(
    localizer.t("categories.delete_contents", { count: 4, disabled: 2, name: "Custom" }),
    /Custom.*4 prečaca.*2 onemogućeno/,
  );
});

test("localization: HA translations are reused for common actions, with Quick Access fallback", async () => {
  const env = await localizationEnvironment();
  const keys = [];
  const localizer = env.createLocalizer({
    language: "en",
    localize: (key) => {
      keys.push(key);
      return key === "ui.common.save" ? "HA Save" : key;
    },
  });
  assert.equal(String(localizer.message("common.save")), "HA Save");
  assert.equal(String(localizer.message("common.cancel")), "Cancel");
  assert.equal(String(localizer.message("profiles.create")), "Create profile");
  assert.deepEqual(keys, ["ui.common.save", "ui.common.cancel"]);
});

test("localization: bindings update labels, native options and text without replacing adjacent icons", async () => {
  const env = await localizationEnvironment({ hr: croatian });
  const localizer = env.createLocalizer({ language: "en" });
  const attributes = {};
  const element = {
    setAttribute(name, value) {
      attributes[name] = value;
    },
    set textContent(value) {
      this.firstChild = { nodeType: 3, parentNode: this, data: value };
    },
    get textContent() {
      return this.firstChild.data;
    },
  };
  const icon = { preserved: true };
  localizer.text(element, localizer.message("common.save"));
  element.icon = icon;
  const textNode = element.firstChild;
  localizer.attribute(element, "aria-label", localizer.message("shortcuts.edit"));
  // Create these values in the localizer's realm, like actual module callers.
  localizer.property(element, "options", [localizer.message("common.cancel")]);
  await localizer.setHass({ language: "hr-HR" });
  assert.equal(element.textContent, "Spremi");
  assert.equal(element.firstChild, textNode);
  assert.equal(element.icon, icon);
  assert.equal(attributes["aria-label"], "Uredi prečac");
  assert.equal(element.options[0], "Odustani");
  localizer.text(element, "User-defined Save");
  await localizer.setHass({ language: "en" });
  assert.equal(element.textContent, "User-defined Save");
});

test("localization: late locale requests cannot revert a newer language", async () => {
  const env = await localizationEnvironment({ hr: croatian });
  const localizer = env.createLocalizer({ language: "hr-HR" });
  const target = {};
  localizer.text(target, localizer.message("common.save"));
  await localizer.setHass({ language: "en" });
  await localizer.ready;
  assert.equal(target.textContent, "Save");
});

test("localization: releasing subtrees removes bindings immediately and allows rebinding", async () => {
  const tracked = trackedBindings();
  const env = await localizationEnvironment({ hr: croatian }, tracked.globals);
  const localizer = env.createLocalizer({ language: "en" });
  await localizer.ready;
  const child = { setAttribute() {} };
  const view = { children: [{ children: [child] }] };
  const retained = {};
  for (const element of [view, child, retained])
    localizer.text(element, localizer.message("common.save"));
  localizer.attribute(child, "title", "static");
  assert.equal(tracked.count(), 3);
  localizer.release(view);
  localizer.release(view);
  localizer.release(null);
  assert.equal(tracked.count(), 1);
  await localizer.setHass({ language: "hr" });
  assert.equal(retained.textContent, "Spremi");
  assert.equal(child.textContent, "Save");
  localizer.text(child, localizer.message("common.cancel"));
  assert.equal(tracked.count(), 2);
  await localizer.setHass({ language: "en" });
  assert.equal(child.textContent, "Cancel");
  localizer.clear();
  assert.equal(tracked.count(), 0);
  localizer.text(retained, localizer.message("common.cancel"));
  assert.equal(tracked.count(), 1);
  await localizer.setHass({ language: "hr" });
  assert.equal(retained.textContent, "Odustani");
});

test("localization: replacing the last localized value drops the registration", async () => {
  const tracked = trackedBindings();
  const env = await localizationEnvironment({}, tracked.globals);
  const localizer = env.createLocalizer({ language: "en" });
  await localizer.ready;
  const element = { setAttribute() {} };
  localizer.text(element, localizer.message("common.save"));
  localizer.attribute(element, "title", localizer.message("common.save"));
  localizer.text(element, "custom");
  assert.equal(tracked.count(), 1);
  localizer.attribute(element, "title", "custom");
  assert.equal(tracked.count(), 0);
  localizer.text(element, localizer.message("common.save"));
  assert.equal(tracked.count(), 1);
});

test("localization: binding activity sweeps 10,000 dead targets without changing language", async () => {
  const tracked = trackedBindings();
  const env = await localizationEnvironment({ hr: croatian }, tracked.globals);
  const localizer = env.createLocalizer({ language: "en" });
  await localizer.ready;
  const detached = {};
  localizer.text(detached, localizer.message("common.save"));
  for (let index = 0; index < 10000; index++) {
    const element = {};
    localizer.text(element, localizer.message("common.save"));
    tracked.collect(element);
  }
  assert.ok(tracked.count() < 101, `registered targets: ${tracked.count()}`);
  assert.equal(localizer.language, "en");
  await localizer.setHass({ language: "hr" });
  assert.equal(detached.textContent, "Spremi", "a live detached target must retain its binding");
  assert.equal(tracked.count(), 1);
});

test("localization: a new HA localize function refreshes bindings without a language change", async () => {
  const env = await localizationEnvironment();
  const calls = [];
  const provider = (label) => (key) => {
    calls.push(label);
    return key === "ui.common.save" ? `Save ${label}` : key;
  };
  const first = provider("A");
  const localizer = env.createLocalizer({ language: "en", localize: first });
  await localizer.ready;
  const button = {};
  localizer.text(button, localizer.message("common.save"));
  assert.equal(button.textContent, "Save A");
  calls.length = 0;
  await localizer.setHass({ language: "en", localize: first, states: {} });
  assert.deepEqual(calls, [], "state-only updates must not re-render bindings");
  await localizer.setHass({ language: "en", localize: provider("B") });
  assert.equal(button.textContent, "Save B");
});

test("localization: unchanged-language HA updates sweep dead targets after the interval", async () => {
  const tracked = trackedBindings();
  const env = await localizationEnvironment({}, tracked.globals);
  const localizer = env.createLocalizer({ language: "en" });
  await localizer.ready;
  const element = {};
  localizer.text(element, localizer.message("common.save"));
  tracked.collect(element);
  tracked.advance(30000);
  await localizer.setHass({ language: "en" });
  assert.equal(tracked.count(), 0);
});

test("localization: resources have stable keys and matching placeholders", async () => {
  const { english } = await localizationEnvironment();
  assert.deepEqual(Object.keys(english).sort(), Object.keys(croatian).sort());
  const placeholders = (value) =>
    [...new Set([...value.matchAll(/\{\w+\}/g)].map(([token]) => token))].sort();
  for (const [key, value] of Object.entries(english)) {
    assert.match(key, /^[a-z_]+\.[a-z0-9_.-]+$/);
    const forms = typeof value === "string" ? [value] : Object.values(value);
    const translated =
      typeof croatian[key] === "string" ? [croatian[key]] : Object.values(croatian[key]);
    assert.equal(typeof value, typeof croatian[key], key);
    if (typeof value === "object") {
      assert.deepEqual(Object.keys(value).sort(), ["one", "other"], key);
      assert.deepEqual(Object.keys(croatian[key]).sort(), ["few", "one", "other"], key);
    }
    for (const form of forms) assert.ok(form.length, key);
    for (const form of forms) assert.deepEqual(placeholders(form), placeholders(forms[0]), key);
    for (const form of translated)
      assert.deepEqual(placeholders(form), placeholders(forms[0]), key);
  }
  for (const file of frontendFiles().filter(
    (file) => file.endsWith(".js") && !file.startsWith("locales/"),
  )) {
    const source = readFileSync(path.join(frontend, file), "utf8");
    const namespaces = [...new Set(Object.keys(english).map((key) => key.split(".")[0]))].join("|");
    const references = new RegExp(`"((?:${namespaces})\\.[a-z0-9_.-]+)"`, "g");
    // Include conditional keys and field metadata as well as direct calls.
    for (const [, key] of source.matchAll(references))
      assert.ok(Object.hasOwn(english, key), `${file}: ${key}`);
  }
});

test("localization: shared actions, favorites, search headings and copy names agree in both languages", async () => {
  const env = await localizationEnvironment({ hr: croatian });
  const localizer = env.createLocalizer({ language: "en" });
  for (const [language, labels, copy] of [
    [
      "en",
      [
        "Enable",
        "Disable",
        "Duplicate",
        "Delete",
        "Default",
        "Set default",
        "Add to favorites",
        "Remove from favorites",
        "Recent searches",
      ],
      "Original (Copy)",
    ],
    [
      "hr",
      [
        "Omogući",
        "Onemogući",
        "Dupliciraj",
        "Izbriši",
        "Zadani",
        "Postavi kao zadani",
        "Dodaj u favorite",
        "Ukloni iz favorita",
        "Nedavna pretraživanja",
      ],
      "Original (kopija)",
    ],
  ]) {
    await localizer.setHass({ language });
    assert.deepEqual(
      [
        "enable",
        "disable",
        "duplicate",
        "delete",
        "default",
        "set_default",
        "add_favorite",
        "remove_favorite",
        "recent_searches",
      ].map((key) => String(localizer.message(`common.${key}`))),
      labels,
    );
    for (const kind of ["profiles", "shortcuts", "filters"])
      assert.equal(localizer.t(`${kind}.copy_name`, { name: "Original" }), copy);
    assert.equal(localizer.t("devices.sw_version"), localizer.t("filters.field_sw_version"));
    assert.equal(localizer.t("devices.state"), localizer.t("filters.field_area"));
    assert.notEqual(localizer.t("filters.remove_group"), localizer.t("filters.remove_condition"));
    // Edit titles name their subject instead of a generic "Edit".
    for (const key of ["profiles.edit", "shortcuts.edit", "filters.edit"])
      assert.notEqual(localizer.t(key), language === "hr" ? "Uredi" : "Edit");
  }
});

test("localization: all count messages select English and Croatian forms for 0, 1, 2, 5, 21 and 22", async () => {
  const env = await localizationEnvironment({ hr: croatian });
  const localizer = env.createLocalizer({ language: "en" });
  const counts = [
    [0, "other"],
    [1, "one"],
    [2, "few"],
    [5, "other"],
    [21, "one"],
    [22, "few"],
  ];
  for (const language of ["en", "hr"]) {
    await localizer.setHass({ language });
    const dictionary = language === "en" ? env.english : croatian;
    for (const [count, hrCategory] of counts) {
      const category = language === "en" ? (count === 1 ? "one" : "other") : hrCategory;
      for (const [key, value] of Object.entries(dictionary).filter(
        ([, value]) => typeof value === "object",
      )) {
        const parameters = { count, name: "Example", names: "First, Second", remaining: 3 };
        const expected = value[category].replace(/\{(\w+)\}/g, (_, key) => parameters[key]);
        assert.equal(localizer.t(key, parameters), expected, `${language} ${key} ${count}`);
      }
      for (const [key, enNoun, hrNouns] of [
        [
          "filters.preview_states",
          "entity",
          {
            one: "odgovarajući entitet",
            few: "odgovarajuća entiteta",
            other: "odgovarajućih entiteta",
          },
        ],
        [
          "filters.matching_entities",
          "entity",
          {
            one: "odgovarajući entitet",
            few: "odgovarajuća entiteta",
            other: "odgovarajućih entiteta",
          },
        ],
        [
          "filters.preview_devices",
          "device",
          {
            one: "odgovarajući uređaj",
            few: "odgovarajuća uređaja",
            other: "odgovarajućih uređaja",
          },
        ],
      ]) {
        const phrase =
          language === "hr"
            ? hrNouns[category]
            : `matching ${count === 1 ? enNoun : enNoun === "entity" ? "entities" : "devices"}`;
        assert.equal(localizer.t(key, { count }), `${count} ${phrase}`);
      }
      for (const more of [false, true]) {
        const noun = {
          one: "povezani prečac",
          few: "povezana prečaca",
          other: "povezanih prečaca",
        }[category];
        const expected =
          language === "hr"
            ? `Brisanjem ovog filtra izbrisat će se i ${count} ${noun}: First${more ? " i još 3" : ""}.`
            : `Deleting this filter will also delete ${count} linked ${count === 1 ? "shortcut" : "shortcuts"}: First${more ? ", and 3 more" : ""}.`;
        assert.equal(
          localizer.t(`filters.delete_linked_confirmation${more ? "_more" : ""}`, {
            count,
            names: "First",
            remaining: 3,
          }),
          expected,
        );
      }
    }
  }
});

test("localization: native HA configuration translations preserve structure, options and error keys", () => {
  const directory = path.join(__dirname, "../custom_components/quick_access/translations");
  const english = JSON.parse(readFileSync(path.join(directory, "en.json"), "utf8"));
  const croatian = JSON.parse(readFileSync(path.join(directory, "hr.json"), "utf8"));
  const check = (original, translated) => {
    assert.deepEqual(Object.keys(original).sort(), Object.keys(translated).sort());
    for (const [key, value] of Object.entries(original)) {
      if (typeof value === "object") check(value, translated[key]);
      else {
        assert.equal(typeof translated[key], "string");
        assert.ok(translated[key].trim());
        assert.deepEqual(
          [...value.matchAll(/\{\w+\}/g)].map(([token]) => token).sort(),
          [...translated[key].matchAll(/\{\w+\}/g)].map(([token]) => token).sort(),
        );
      }
    }
  };
  check(english, croatian);
  assert.deepEqual(Object.keys(croatian.options.step.init.data).sort(), [
    "max_categories",
    "max_profile_mib",
    "max_profiles",
    "max_user_mib",
  ]);
  assert.deepEqual(Object.keys(croatian.options.error).sort(), [
    "invalid_limit",
    "profile_exceeds_user",
  ]);
  assert.ok(croatian.config.abort.already_configured);
});
