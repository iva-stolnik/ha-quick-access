const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { createModuleLoader } = require("./module-loader.cjs");

const modules = createModuleLoader(vm.createContext({}));
const state = (domain, value, attributes = {}) => ({
  entity_id: `${domain}.test`,
  state: value,
  attributes,
});

test("state icons honor registry and attribute overrides, custom sets and safe fallbacks", async () => {
  const { resolveStateIcon, normalizeEntityIcon } = await modules.load("entities/state-icon.ts");
  const entity = state("light", "on", { icon: "custom:bedside" });
  assert.equal(resolveStateIcon(entity).icon, "custom:bedside");
  assert.equal(
    resolveStateIcon(entity, { entities: { "light.test": { icon: "mdi:desk-lamp" } } }).icon,
    "mdi:desk-lamp",
  );
  for (const invalid of [null, {}, "<img>", "mdi:bad icon", "url(javascript:bad)"])
    assert.equal(normalizeEntityIcon(invalid), "");
  assert.equal(resolveStateIcon(state("sun", "below_horizon")).icon, "mdi:weather-night");
  assert.equal(
    resolveStateIcon(state("device_tracker", "home", { source_type: "router" })).icon,
    "mdi:lan-connect",
  );
  assert.equal(
    resolveStateIcon(state("update", "on", { in_progress: true })).icon,
    "mdi:package-down",
  );
  assert.equal(
    resolveStateIcon(state("binary_sensor", "on", { device_class: "door" })).icon,
    "mdi:door-open",
  );
  assert.equal(
    resolveStateIcon(state("binary_sensor", "off", { device_class: "door" })).icon,
    "mdi:door-closed",
  );
  assert.equal(
    resolveStateIcon(state("sensor", "21", { device_class: "temperature" })).icon,
    "mdi:thermometer",
  );
  assert.equal(
    resolveStateIcon(state("cover", "closed", { device_class: "garage" })).icon,
    "mdi:garage",
  );
  assert.equal(resolveStateIcon(undefined).icon, "mdi:help-circle");
});

test("colors preserve HA variable precedence, battery thresholds and domain activity", async () => {
  const { resolveStateIcon, entityStateActive } = await modules.load("entities/state-icon.ts");
  for (const [domain, value, active] of [
    ["light", "on", true],
    ["switch", "off", false],
    ["binary_sensor", "on", true],
    ["cover", "closed", false],
    ["cover", "opening", true],
    ["climate", "heat", true],
    ["lock", "locked", false],
    ["lock", "jammed", true],
    ["alert", "off", true],
    ["alert", "idle", false],
    ["vacuum", "docked", false],
    ["camera", "idle", false],
    ["person", "not_home", false],
    ["timer", "paused", false],
    ["weather", "sunny", true],
  ]) {
    const entity = state(domain, value, { device_class: "test_class" });
    assert.equal(entityStateActive(entity), active, `${domain} ${value}`);
    assert.equal(
      resolveStateIcon(entity).color,
      `var(--state-${domain}-test_class-${value}-color, var(--state-${domain}-${value}-color, var(--state-${domain}-${active ? "active" : "inactive"}-color, var(--state-${active ? "active" : "inactive"}-color, var(--state-icon-color)))))`,
    );
  }
  assert.equal(
    resolveStateIcon(state("sensor", "21", { device_class: "temperature" })).color,
    "var(--state-icon-color)",
  );
  for (const [value, level] of [
    ["0", "low"],
    ["29", "low"],
    ["30", "medium"],
    ["69", "medium"],
    ["70", "high"],
    ["100", "high"],
  ]) {
    assert.equal(
      resolveStateIcon(state("sensor", value, { device_class: "battery" })).color,
      `var(--state-sensor-battery-${level}-color)`,
    );
  }
  const grouped = resolveStateIcon(state("group", "on", { entity_id: ["light.one", "light.two"] }));
  assert.match(grouped.color, /^var\(--state-light-on-color/);
  const climate = resolveStateIcon(state("climate", "heat_cool", { hvac_action: "cooling" }));
  assert.match(climate.color, /^var\(--state-climate-cool-color/);
  assert.match(
    resolveStateIcon(state("climate", "heat", { hvac_action: "idle" })).color,
    /--state-climate-inactive-color/,
  );
  assert.equal(
    resolveStateIcon(state("climate", "heat", { hvac_action: "invalid" })).color,
    "var(--state-icon-color)",
  );
});

test("RGB and brightness match HA and clear across transitions, malformed values and disabled states", async () => {
  const { resolveStateIcon } = await modules.load("entities/state-icon.ts");
  for (const [brightness, filter] of [
    [255, "brightness(100%)"],
    [64, "brightness(61.8%)"],
    [1, "brightness(49.2%)"],
    [0, ""],
    ["64", ""],
    [NaN, ""],
    [-1, ""],
  ]) {
    const model = resolveStateIcon(state("light", "on", { rgb_color: [10, 20, 255], brightness }));
    assert.equal(model.color, "rgb(10,20,255)");
    assert.equal(model.filter, filter);
  }
  for (const rgb_color of [[], [1, 2], [1, 2, 3, 4], [NaN, 0, 0], [256, 0, 0], ["1", 2, 3]]) {
    assert.match(
      resolveStateIcon(state("light", "on", { rgb_color })).color,
      /^var\(--state-light/,
    );
  }
  assert.equal(resolveStateIcon(state("plant", "ok", { brightness: 100 })).filter, "");
  const unavailable = resolveStateIcon(state("light", "unavailable"));
  assert.equal(unavailable.color, "var(--state-unavailable-color)");
  assert.equal(unavailable.filter, "");
  assert.match(resolveStateIcon(state("light", "unknown")).color, /--state-light-inactive-color/);
  assert.equal(
    resolveStateIcon(state("light", "on", { brightness: 255 }), undefined, undefined, true).color,
    "var(--disabled-text-color)",
  );
  assert.equal(
    resolveStateIcon(state("light", "on"), { entities: { "light.test": { disabled_by: "user" } } })
      .color,
    "var(--disabled-text-color)",
  );
  assert.equal(resolveStateIcon(state("alarm_control_panel", "triggered")).pulse, true);
  assert.equal(resolveStateIcon(state("alarm_control_panel", "disarmed")).pulse, false);
});

test("entity pictures retain HA URL handling, camera sizing and image shapes", async () => {
  const { resolveStateIcon } = await modules.load("entities/state-icon.ts");
  assert.equal(
    resolveStateIcon(state("person", "home", { entity_picture: "/local/person.png" })).image,
    "/local/person.png",
  );
  assert.equal(
    resolveStateIcon(state("update", "on", { entity_picture: "/api/brands/test/icon.png" })).image,
    "",
  );
  const context = { hassUrl: (url) => `https://ha.example${url}` };
  const camera = resolveStateIcon(
    state("camera", "idle", { entity_picture_local: "/api/camera_proxy/test?token=test" }),
    context,
  );
  assert.equal(
    camera.image,
    "https://ha.example/api/camera_proxy/test?token=test&width=80&height=80",
  );
  assert.equal(camera.imageRadius, "var(--state-badge-with-media-image-border-radius, 8%)");
});

test("unavailable and unknown entities ignore retained RGB, brightness and HVAC attributes", async () => {
  const { resolveStateIcon } = await modules.load("entities/state-icon.ts");
  for (const [domain, attributes] of [
    ["light", { rgb_color: [255, 0, 0], brightness: 64 }],
    ["climate", { hvac_action: "heating" }],
    ["climate", { hvac_action: "cooling", rgb_color: [0, 0, 255], brightness: 255 }],
  ]) {
    const unavailable = resolveStateIcon(state(domain, "unavailable", attributes));
    assert.equal(unavailable.color, "var(--state-unavailable-color)", domain);
    assert.equal(unavailable.filter, "", domain);
    const unknown = resolveStateIcon(state(domain, "unknown", attributes));
    assert.match(unknown.color, new RegExp(`--state-${domain}-inactive-color`));
    assert.equal(unknown.filter, "", domain);
  }
});

test("icon metadata shares requests, honors integration/state/range precedence and survives failures", async () => {
  const { entityIconMetadata } = await modules.load("data/entity-icons.ts");
  const calls = [];
  const context = {
    connection: {},
    config: { components: ["sensor", "demo"] },
    entities: { "sensor.test": { platform: "demo", translation_key: "temperature" } },
    callWS: async (message) => {
      calls.push(message);
      return {
        resources:
          message.category === "entity"
            ? {
                demo: {
                  sensor: {
                    temperature: {
                      default: "demo:temperature",
                      state: { unavailable: "demo:missing" },
                    },
                  },
                },
              }
            : {
                sensor: {
                  _: { default: "mdi:eye" },
                  temperature: {
                    default: "mdi:thermometer",
                    range: { 0: "mdi:snowflake", 25: "mdi:fire" },
                  },
                },
              },
      };
    },
  };
  const entity = state("sensor", "21", { device_class: "temperature" });
  const pending = entityIconMetadata(entity, context).pending;
  for (let i = 0; i < 500; i++) entityIconMetadata(entity, context);
  await Promise.all(pending);
  assert.equal(calls.length, 2);
  assert.equal(entityIconMetadata(entity, context).icon, "demo:temperature");
  assert.equal(
    entityIconMetadata({ ...entity, state: "unavailable" }, context).icon,
    "demo:missing",
  );
  context.entities = {};
  assert.equal(entityIconMetadata(entity, context).icon, "mdi:snowflake");
  assert.equal(entityIconMetadata({ ...entity, state: "30" }, context).icon, "mdi:fire");
  const failing = {
    ...context,
    connection: {},
    callWS: async () => {
      throw Error("offline");
    },
  };
  await Promise.all(entityIconMetadata(entity, failing).pending);
  assert.equal(entityIconMetadata(entity, failing).icon, undefined);
  const override = { ...entity, attributes: { icon: "custom:override" } };
  assert.equal(entityIconMetadata(override, context).pending.length, 0);
});

test("Lit skips unchanged presentation, handles in-place attributes and resolves the latest state after metadata loads", async () => {
  class Element {
    setAttribute() {}
    requestUpdate() {
      this.updates++;
    }
    connectedCallback() {}
  }
  const loader = createModuleLoader(vm.createContext({ HTMLElement: Element }));
  const { QapStateIcon } = await loader.load("ui/components/state-icon.ts");
  const icon = new QapStateIcon();
  icon.updates = 0;
  icon.stateObj = state("light", "on", { rgb_color: [255, 0, 0], brightness: 255 });
  assert.equal(icon.shouldUpdate(), true);
  assert.equal(icon.shouldUpdate(), false);
  icon.stateObj.attributes.rgb_color[0] = 0;
  assert.equal(icon.shouldUpdate(), true);
  assert.equal(icon.presentation.color, "rgb(0,0,0)");
  icon.stateObj = state("light", "off");
  assert.equal(icon.shouldUpdate(), true);
  assert.equal(icon.presentation.filter, "");
  icon.stateObj = state("light", "unavailable", { rgb_color: [255, 0, 0], brightness: 64 });
  assert.equal(icon.shouldUpdate(), true);
  assert.equal(icon.presentation.color, "var(--state-unavailable-color)");
  assert.equal(icon.presentation.filter, "");
  icon.stateObj = state("light", "off");
  icon.shouldUpdate();
  let complete;
  icon.hass = {
    connection: {},
    config: { components: ["light"] },
    callWS: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  };
  icon.isConnected = true;
  icon.shouldUpdate();
  await Promise.resolve();
  icon.stateObj = state("light", "unavailable");
  icon.shouldUpdate();
  complete({
    resources: {
      light: { _: { default: "mdi:lightbulb", state: { unavailable: "mdi:lightbulb-alert" } } },
    },
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(icon.updates, 1);
  assert.equal(icon.shouldUpdate(), true);
  assert.equal(icon.presentation.icon, "mdi:lightbulb-alert");
  assert.equal(icon.presentation.color, "var(--state-unavailable-color)");
});
