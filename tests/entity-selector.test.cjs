const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { createModuleLoader } = require("./module-loader.cjs");

async function setup() {
  const { createEntitySelectorSource } = await createModuleLoader(vm.createContext({})).load(
    "entities/entity-selector.ts",
  );
  let context = {
    states: {
      "light.kitchen": {
        entity_id: "light.kitchen",
        state: "unavailable",
        attributes: { friendly_name: "Kitchen lamp", supported_features: 5 },
      },
      "sensor.temperature": {
        entity_id: "sensor.temperature",
        state: "20",
        attributes: { friendly_name: "Temperature", device_class: "temperature" },
      },
    },
    entities: {
      "light.kitchen": { device_id: "kitchen", platform: "hue" },
      "sensor.disabled": { original_name: "Disabled sensor", original_device_class: "humidity" },
    },
    devices: { kitchen: { name: "Ceiling", area_id: "room" } },
    areas: { room: { name: "Kuhinja" } },
  };
  const source = createEntitySelectorSource(() => context);
  source.refresh();
  return {
    source,
    update(next) {
      context = { ...context, ...next };
      return source.refresh();
    },
  };
}
const ids = (options) => Array.from(options, (option) => option.value);

test("entity selector normalizes empty values and mode transitions without duplicate form events", async () => {
  class HTMLElement extends EventTarget {}
  class CustomEvent extends Event {
    constructor(name, options) {
      super(name, options);
      this.detail = options.detail;
    }
  }
  const { QapEntitySelector } = await createModuleLoader(
    vm.createContext({ HTMLElement, Event, CustomEvent }),
  ).load("ui/components/entity-selector.ts");
  for (const empty of ["", null, undefined, [], [""]]) {
    const control = new QapEntitySelector();
    const events = [];
    control.required = true;
    control.addEventListener("value-changed", (event) => events.push(event.detail.value));
    control.value = empty;
    const single = control.selector;
    control.selector = { entity: { multiple: true } };
    control.willUpdate(new Map([["selector", single]]));
    assert.deepEqual(Array.from(control.value), []);
    assert.equal(control.checkValidity(), false, "an empty string is not a selected entity");
    const count = events.length;
    control.willUpdate(new Map([["value", empty]]));
    control.willUpdate(new Map([["selector", control.selector]]));
    assert.equal(events.length, count, "normalization settles without another event");
    control.selector = { entity: {} };
    control.willUpdate(new Map([["selector", { entity: { multiple: true } }]]));
    assert.equal(control.value, undefined);
  }
  const control = new QapEntitySelector();
  const events = [];
  control.addEventListener("value-changed", (event) => events.push(event.detail.value));
  control.selector = { entity: { multiple: true } };
  control.value = null;
  control.willUpdate(
    new Map([
      ["selector", undefined],
      ["value", ""],
    ]),
  );
  assert.deepEqual(Array.from(control.value), []);
  assert.equal(events.length, 0, "initialization must not dirty the form");
  control.value = ["", "sensor.one", "sensor.two", ""];
  control.willUpdate(new Map([["value", []]]));
  assert.deepEqual(Array.from(control.value), ["sensor.one", "sensor.two"]);
  assert.equal(events.length, 0, "external normalization is silent");
  const values = control.value;
  control.selector = { entity: {} };
  control.willUpdate(new Map([["selector", { entity: { multiple: true } }]]));
  assert.equal(control.value, "sensor.one");
  control.selector = { entity: { multiple: true } };
  control.willUpdate(new Map([["selector", { entity: {} }]]));
  assert.deepEqual(Array.from(control.value), ["sensor.one"]);
  assert.deepEqual(
    Array.from(values),
    ["sensor.one", "sensor.two"],
    "normalization never mutates the owner's array",
  );
  assert.equal(events.length, 2);
});

test("entity selector borrows states and registries, including unavailable and inactive entities", async () => {
  const { source, update } = await setup();
  assert.deepEqual(ids(source.search("", {})).sort(), [
    "light.kitchen",
    "sensor.disabled",
    "sensor.temperature",
  ]);
  assert.equal(source.get("sensor.disabled").label, "Disabled sensor");
  assert.equal(source.get("light.kitchen").state.state, "unavailable");
  assert.deepEqual(ids(source.search("kuhinja ceiling", {})), ["light.kitchen"]);
  assert.deepEqual(
    ids(source.search("kitchn", {})),
    ["light.kitchen"],
    "picker search tolerates a small spelling error",
  );
  assert.deepEqual(
    ids(source.search("k", {})),
    ids(source.search("", {})),
    "one-character terms match HA's minimum length",
  );
  const revision = source.revision;
  assert.equal(update({}), false);
  assert.equal(source.revision, revision);
  const before = source.search("", {});
  assert.equal(
    source.get("light.kitchen"),
    before.find((option) => option.value === "light.kitchen"),
    "one shared derived index",
  );
});

test("entity selector preserves HA include/exclude precedence, OR filters, features and current selection", async () => {
  const { source } = await setup();
  assert.deepEqual(
    ids(
      source.search("", {
        include_entities: ["light.kitchen", "sensor.temperature"],
        exclude_entities: ["light.kitchen"],
      }),
    ),
    ["sensor.temperature"],
  );
  assert.deepEqual(
    ids(source.search("", { filter: { domain: "sensor", device_class: ["temperature"] } })),
    ["sensor.temperature"],
  );
  assert.deepEqual(
    ids(
      source.search("", {
        filter: [
          { domain: "light", supported_features: [2, 4], integration: "hue" },
          { device_class: "humidity" },
        ],
      }),
    ).sort(),
    ["light.kitchen", "sensor.disabled"],
  );
  assert.deepEqual(ids(source.search("", { filter: { domain: "switch" } }, "light.kitchen")), [
    "light.kitchen",
  ]);
  assert.deepEqual(
    ids(
      source.search(
        "",
        { exclude_entities: ["light.kitchen"], filter: { domain: "switch" } },
        "light.kitchen",
      ),
    ),
    [],
  );
});

test("registry refreshes invalidate search and labels", async () => {
  const { source, update } = await setup();
  assert.equal(
    update({
      entities: {
        "sensor.disabled": { name: "Renamed", icon: "mdi:water" },
        "switch.new": { name: "Added" },
      },
    }),
    true,
  );
  assert.equal(source.get("sensor.disabled").label, "Renamed");
  assert.equal(source.get("sensor.disabled").icon, "mdi:water");
  assert.deepEqual(ids(source.search("added", {})), ["switch.new"]);
  update({ states: {}, entities: {} });
  assert.equal(source.get("sensor.disabled"), undefined);
  assert.deepEqual(ids(source.search("", {})), []);
});

test("manual entity IDs obey the same restrictions, while saved missing values survive", async () => {
  const { validEntitySelection } = await createModuleLoader(vm.createContext({})).load(
    "entities/entity-selector.ts",
  );
  const { source } = await setup();
  const valid = (value, config, current = "") =>
    validEntitySelection(value, config, current, source.get(value));
  assert.equal(valid("sensor.new", {}), true);
  assert.equal(valid("invalid", {}), false);
  assert.equal(valid("sensor.new", { include_entities: ["sensor.temperature"] }), false);
  assert.equal(valid("sensor.temperature", { exclude_entities: ["sensor.temperature"] }), false);
  assert.equal(valid("light.new", { filter: { domain: "sensor" } }), false);
  assert.equal(valid("sensor.new", { filter: { domain: ["sensor", "light"] } }), true);
  assert.equal(valid("sensor.new", { filter: { device_class: "temperature" } }), false);
  assert.equal(valid("sensor.temperature", { filter: { device_class: "temperature" } }), true);
  assert.equal(valid("sensor.deleted", { include_entities: [] }, "sensor.deleted"), true);
});

test("entity selector emits the existing single/multiple value contracts only for committed changes", async () => {
  class HTMLElement extends EventTarget {
    updateComplete = Promise.resolve();
  }
  class CustomEvent extends Event {
    constructor(name, options) {
      super(name, options);
      this.detail = options.detail;
    }
  }
  const { QapEntitySelector } = await createModuleLoader(
    vm.createContext({ HTMLElement, Event, CustomEvent }),
  ).load("ui/components/entity-selector.ts");
  const control = new QapEntitySelector();
  const events = [];
  control.addEventListener("value-changed", (event) =>
    events.push({ value: event.detail.value, bubbles: event.bubbles, composed: event.composed }),
  );
  control.commit("sensor.one");
  control.commit("sensor.one");
  assert.deepEqual(events, [{ value: "sensor.one", bubbles: true, composed: true }]);
  control.composing = true;
  control.commit("sensor.ime");
  assert.equal(events.length, 1);
  control.composing = false;
  control.commit(undefined);
  assert.equal(events.at(-1).value, undefined);
  control.commit("invalid entity ID");
  assert.equal(events.at(-1).value, undefined);
  control.selector = { entity: { multiple: true } };
  control.value = ["sensor.one"];
  control.updateRow(1, new CustomEvent("value-changed", { detail: { value: "sensor.two" } }));
  assert.deepEqual(Array.from(events.at(-1).value), ["sensor.one", "sensor.two"]);
  control.updateRow(0, new CustomEvent("value-changed", { detail: { value: "sensor.two" } }));
  assert.deepEqual(
    Array.from(events.at(-1).value),
    ["sensor.two"],
    "editing to a duplicate removes the original, like HA",
  );
  control.disabled = true;
  control.commit("sensor.disabled");
  assert.deepEqual(Array.from(control.value), ["sensor.two"]);
  control.disabled = false;
  control.selector = { entity: { multiple: true, filter: { domain: "sensor" } } };
  const count = events.length;
  control.updateRow(1, new CustomEvent("value-changed", { detail: { value: "light.bypass" } }));
  assert.equal(events.length, count);
  assert.deepEqual(Array.from(control.value), ["sensor.two"]);
  control.selector = { entity: { include_entities: ["sensor.allowed"] } };
  control.value = "sensor.deleted";
  control.commit("sensor.denied");
  assert.equal(control.value, "sensor.deleted");
  assert.equal(events.length, count);
});
