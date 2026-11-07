const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { createModuleLoader } = require("./module-loader.cjs");

let entityMatches;
test.before(async () => {
  ({ entityMatches } = await createModuleLoader(vm.createContext({})).load(
    "entities/entity-search.js",
  ));
});

const batteryAttributes = { device_class: "battery", unit_of_measurement: "%" };
const entity = (entity_id, state, attributes) => ({ entity_id, state, attributes });
const matches = (state, filter, search = "", favorites = []) =>
  entityMatches(state, { filter, favorites: new Set(favorites) }, search, new WeakMap(), {});

test("smart state filters match exact unknown/unavailable states across domains", () => {
  for (const filter of ["unknown", "unavailable"]) {
    for (const domain of ["sensor", "light", "update", "binary_sensor"]) {
      for (const value of [
        "unknown",
        "unavailable",
        "on",
        "off",
        "Unknown",
        " unavailable",
        undefined,
        null,
        0,
      ]) {
        assert.equal(matches(entity(`${domain}.example`, value), filter), value === filter);
      }
    }
  }
});

test("Low Battery accepts only valid numeric percentages strictly below 20", () => {
  for (const value of ["0", "19", "19.99", " 12.5 ", ".5", "1.9e1", 0, 19]) {
    assert.equal(
      matches(entity("sensor.charge", value, batteryAttributes), "low_battery"),
      true,
      String(value),
    );
  }
  for (const value of [
    "20",
    "21",
    "100",
    20,
    21,
    "-1",
    "101",
    "unknown",
    "unavailable",
    "",
    " ",
    "19%",
    "19abc",
    "0x13",
    "0b10",
    "1,5",
    "NaN",
    "Infinity",
    "1e999",
    NaN,
    Infinity,
    undefined,
    null,
    false,
    [],
    {},
  ]) {
    assert.equal(
      matches(entity("sensor.charge", value, batteryAttributes), "low_battery"),
      false,
      String(value),
    );
  }
});

test("Low Battery requires the sensor domain, battery device class and exact percent unit", () => {
  for (const attributes of [
    undefined,
    {},
    { device_class: "battery" },
    { unit_of_measurement: "%" },
    { device_class: "temperature", unit_of_measurement: "%" },
    ...["V", "mV", "Wh", "percent", " % ", null, 100].map((unit_of_measurement) => ({
      device_class: "battery",
      unit_of_measurement,
    })),
  ]) {
    assert.equal(matches(entity("sensor.battery", "19", attributes), "low_battery"), false);
  }
  for (const domain of ["binary_sensor", "number", "input_number", "update"]) {
    assert.equal(
      matches(entity(`${domain}.battery`, "19", batteryAttributes), "low_battery"),
      false,
    );
  }
  assert.equal(
    matches(entity("sensor.arbitrary_name", "19", batteryAttributes), "low_battery"),
    true,
  );
});

test("Updates includes every update type only when its state is on", () => {
  for (const attributes of [
    undefined,
    {},
    { device_class: "firmware" },
    { device_class: "software" },
  ]) {
    for (const value of ["on", "off", "unknown", "unavailable", "ON", true, null]) {
      assert.equal(matches(entity("update.example", value, attributes), "updates"), value === "on");
    }
  }
  for (const domain of ["sensor", "binary_sensor", "switch"]) {
    assert.equal(matches(entity(`${domain}.update`, "on"), "updates"), false);
  }
});

test("all filters retain ID, friendly name and HA translated-name search", () => {
  for (const [filter, state] of [
    ["all", entity("sensor.example", "on")],
    ["favorites", entity("sensor.example", "on")],
    ["unknown", entity("sensor.example", "unknown")],
    ["unavailable", entity("sensor.example", "unavailable")],
    ["low_battery", entity("sensor.example", "19", batteryAttributes)],
    ["updates", entity("update.example", "on")],
  ]) {
    state.attributes = { ...state.attributes, friendly_name: "Kitchen" };
    const view = { filter, favorites: new Set([state.entity_id]) };
    for (const search of ["", "example", "kitchen", "translated", "no match"]) {
      assert.equal(
        entityMatches(state, view, search, new WeakMap(), { formatEntityName: () => "Translated" }),
        search !== "no match",
      );
    }
  }
  const state = entity("light.example", "on");
  assert.equal(matches(state, "favorites"), false);
  for (const invalid of [null, undefined, {}, { entity_id: 123 }])
    assert.equal(matches(invalid, "all"), false);
});
