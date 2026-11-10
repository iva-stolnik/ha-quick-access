const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const colorCases = require("./filter-color-cases.json");
const { createModuleLoader } = require("./module-loader.cjs");
let definitions, evaluation, valueSource, presentation, english;
test.before(async () => {
  // The real browser checks these CSS formats too; Node has no CSS parser.
  const loader = createModuleLoader(
    vm.createContext({
      CSS: {
        supports: (property, value) =>
          property === "color" && colorCases.valid.some((color) => color.trim() === value),
      },
    }),
  );
  definitions = await loader.load("registry/filter-definitions.js");
  evaluation = await loader.load("registry/filter-evaluation.js");
  valueSource = await loader.load("registry/filter-values.js");
  presentation = await loader.load("registry/filter-presentation.js");
  english = (await loader.load("locales/en.js")).default;
});

test("condition summaries preserve field labels, operators and stored value types", () => {
  const { rule } = definitions;
  const t = (key) => english[key];
  const condition = { ...rule("attribute", "less_than", 20), attribute: "battery" };
  const original = JSON.stringify(condition);
  assert.deepEqual(clone(presentation.conditionSummary(condition, t)), {
    field: 'Attribute ["battery"]',
    operator: "Less than",
    value: "20",
    text: 'Attribute ["battery"] Less than 20',
  });
  for (const value of [true, false, 0, "0", '" AND (x)', [true, 0, "0", "a OR b"]]) {
    assert.equal(
      presentation.conditionSummary(rule("state", "equals", value), t).value,
      JSON.stringify(value),
    );
  }
  for (const operator of definitions.FILTER_OPERATORS) {
    assert.equal(
      presentation.conditionSummary(rule("state", operator, "on"), t).operator,
      english[`filters.op_${operator}`],
    );
  }
  assert.equal(
    presentation.conditionSummary(rule("state", "exists", true), t).text,
    "State Exists",
  );
  assert.equal(JSON.stringify(condition), original);
});

test("editor scopes and operator choices exclude scalar device states and numeric identity comparisons", () => {
  const both = ["id", "name", "area", "label", "manufacturer", "model", "smart"];
  for (const field of both) {
    assert.ok(definitions.ENTITY_FIELDS.includes(field));
    assert.ok(definitions.DEVICE_FIELDS.includes(field));
  }
  for (const field of [
    "state",
    "attribute",
    "domain",
    "platform",
    "device_class",
    "hidden_by",
    "entity_category",
  ]) {
    assert.ok(definitions.ENTITY_FIELDS.includes(field));
    assert.ok(!definitions.DEVICE_FIELDS.includes(field));
  }
  for (const field of ["model_id", "serial_number", "sw_version", "hw_version", "entry_type"]) {
    assert.ok(definitions.DEVICE_FIELDS.includes(field));
    assert.ok(!definitions.ENTITY_FIELDS.includes(field));
  }
  for (const [scope, fields] of [
    ["states", definitions.ENTITY_FIELDS],
    ["devices", definitions.DEVICE_FIELDS],
  ]) {
    assert.ok(!fields.includes("disabled_by"));
    assert.equal(
      definitions.validCondition(
        definitions.group([definitions.rule("disabled_by", "equals", "user")]),
        scope,
      ),
      false,
    );
  }
  for (const field of ["id", "area", "domain", "label", "entry_type"]) {
    assert.deepEqual(clone(definitions.fieldOperators(field)).slice(0, 3), [
      "equals",
      "not_equals",
      "any_of",
    ]);
    assert.ok(!definitions.fieldOperators(field).includes("greater_than"));
    assert.ok(!definitions.fieldOperators(field).includes("contains"));
  }
  assert.ok(definitions.fieldOperators("name").includes("contains"));
  for (const field of ["state", "attribute"])
    assert.ok(definitions.fieldOperators(field).includes("less_than"));
  assert.deepEqual(clone(definitions.fieldOperators("smart")), ["equals"]);
});

test("value options borrow canonical authenticated registry values, sort and deduplicate, and refresh by registry identity", () => {
  const { states, context } = fixture();
  Object.assign(context, {
    states,
    areas: { room: { name: "Living room" } },
    labels: { critical: { name: "Critical devices" } },
  });
  context.entities["sensor.a"].platform = "demo";
  context.entities["sensor.b"].platform = "demo";
  Object.assign(context.entities["sensor.a"], {
    hidden_by: "integration",
    entity_category: "diagnostic",
  });
  Object.assign(context.devices.one, {
    name: "Thermostat",
    model: "T1",
    model_id: "t-1",
    sw_version: "1.2",
    hw_version: "2",
    entry_type: "service",
  });
  context.devices.other = { id: "other", manufacturer: "Acme", model: "A1" };
  states["sensor.a"].attributes.device_class = "battery";
  states["sensor.a"].attributes.friendly_name = "Battery level";
  const source = valueSource.createFilterValueSource(() => context);
  assert.deepEqual(clone(source("area", "states").options), [
    { value: "room", label: "Living room" },
  ]);
  assert.deepEqual(clone(source("label", "devices").options), [
    { value: "critical", label: "Critical devices" },
  ]);
  for (const [field, scope, expected] of [
    ["manufacturer", "states", ["Acme"]],
    ["model", "devices", ["A1", "T1"]],
    ["domain", "states", ["sensor"]],
    ["platform", "states", ["demo"]],
    ["device_class", "states", ["battery"]],
    ["hidden_by", "states", ["integration"]],
    ["entity_category", "states", ["diagnostic"]],
    ["entry_type", "devices", ["service"]],
    ["model_id", "devices", ["t-1"]],
    ["sw_version", "devices", ["1.2"]],
    ["hw_version", "devices", ["2"]],
  ])
    assert.deepEqual(
      clone(source(field, scope).options.map((item) => item.value)),
      expected,
      field,
    );
  for (const scope of ["states", "devices"]) {
    for (const field of ["state", "attribute", "attribute_name", "id", "name"])
      assert.equal(source(field, scope), null);
  }
  const old = source("area", "states");
  assert.equal(source("area", "states"), old);
  context.areas = { new_room: { name: "Office" } };
  assert.deepEqual(clone(source("area", "states").options), [
    { value: "new_room", label: "Office" },
  ]);
  assert.deepEqual(clone(old.options), [{ value: "room", label: "Living room" }]);
});
const clone = (value) => JSON.parse(JSON.stringify(value));
const entity = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes });
function fixture() {
  const states = {
    "sensor.a": entity("sensor.a", "unknown", { battery: 9, enabled: false }),
    "sensor.b": entity("sensor.b", "12", { battery: 90 }),
  };
  const entities = {
    "sensor.a": { device_id: "one", labels: ["critical"] },
    "sensor.b": { device_id: "one" },
    "sensor.absent": { device_id: "empty" },
  };
  const devices = {
    one: { id: "one", manufacturer: "Acme", area_id: "room" },
    empty: { id: "empty" },
  };
  return {
    states,
    context: {
      hass: { states },
      entities,
      devices,
      areas: {},
      ...evaluation.entityDeviceIndex(entities),
    },
  };
}

// Columns after the value describe Exists, Equals, Contains, Any of, > 0 and < 20.
const valueCases = [
  ["missing", {}, false, false, false, false, false, false],
  ["undefined", { value: undefined }, false, false, false, false, false, false],
  ["null", { value: null }, false, false, false, false, false, false],
  ["empty array", { value: [] }, false, false, false, false, false, false],
  ["empty object", { value: {} }, false, false, false, false, false, false],
  ["array", { value: ["match", 10] }, true, true, true, true, true, true],
  ["object", { value: { key: "match" } }, true, false, false, false, false, false],
  ["empty string", { value: "" }, true, false, false, true, false, false],
  ["whitespace", { value: "   " }, true, false, false, false, false, false],
  ["false", { value: false }, true, false, false, true, false, false],
  ["zero", { value: 0 }, true, false, false, true, false, true],
  ["string", { value: "match" }, true, true, true, true, false, false],
  ["unknown", { value: "unknown" }, true, false, false, false, false, false],
  ["unavailable", { value: "unavailable" }, true, false, false, false, false, false],
  ["number", { value: 10 }, true, false, false, false, true, true],
  ["numeric string", { value: "10" }, true, false, false, false, true, true],
];

test("scalar and array comparisons preserve string, numeric and membership semantics", () => {
  for (const value of ["", "   ", false, 0, "unknown", "unavailable", "Match", 10]) {
    assert.equal(evaluation.compareValue(value, "equals", value), true);
    assert.equal(evaluation.compareValue(value, "not_equals", value), false);
    assert.equal(evaluation.compareValue(value, "any_of", [value]), true);
  }
  assert.equal(evaluation.compareValue("Match", "equals", "match"), true);
  assert.equal(evaluation.compareValue("10", "equals", 10), true);
  assert.equal(evaluation.compareValue(["match", "other"], "not_equals", "match"), false);
  assert.equal(evaluation.compareValue(["other"], "not_equals", "match"), true);
});

test("metadata, areas, attributes and states normalize presence consistently through groups", () => {
  const { group, rule } = definitions;
  const deviceFields = [
    "manufacturer",
    "model",
    "model_id",
    "serial_number",
    "sw_version",
    "hw_version",
    "entry_type",
    "area",
  ];
  const entityFields = [
    "manufacturer",
    "model",
    "platform",
    "hidden_by",
    "entity_category",
    "device_class",
    "attribute",
    "state",
    "area",
  ];
  for (const [kind, fields] of [
    ["devices", deviceFields],
    ["states", entityFields],
  ]) {
    for (const field of fields) {
      for (const [name, value, present, equals, contains, anyOf, greater, less] of valueCases) {
        const { states, context } = fixture();
        const state = states["sensor.a"];
        const registry = context.entities[state.entity_id];
        const device = context.devices.one;
        delete device.area_id;
        const target =
          kind === "devices" || ["manufacturer", "model"].includes(field)
            ? device
            : ["attribute", "device_class"].includes(field)
              ? state.attributes
              : field === "state"
                ? state
                : registry;
        const key = field === "area" ? "area_id" : field === "attribute" ? "test" : field;
        delete target[key];
        if (Object.hasOwn(value, "value")) target[key] = value.value;
        const record = kind === "devices" ? device : state;
        const matches = (condition) =>
          evaluation.compileFilter(condition, kind, context).evaluate(record, states).match;
        for (const [operator, expected, match] of [
          ["exists", true, present],
          ["equals", "match", equals],
          ["not_equals", "match", present && !equals],
          ["contains", "at", contains],
          ["any_of", ["match", false, 0, ""], anyOf],
          ["greater_than", 0, greater],
          ["less_than", 20, less],
        ]) {
          const condition = {
            ...rule(field, operator, expected),
            ...(field === "attribute" ? { attribute: key } : {}),
          };
          assert.equal(definitions.validCondition(clone(group([condition])), kind), true);
          assert.equal(matches(group([condition])), match, `${kind} ${field} ${name}: ${operator}`);
        }
        const exists = {
          ...rule(field, "exists", true),
          ...(field === "attribute" ? { attribute: key } : {}),
        };
        assert.equal(
          matches(group([exists], "not")),
          !present,
          `${kind} ${field} ${name}: NOT Exists`,
        );
        assert.equal(matches(group([exists, rule("id", "equals", "absent")], "or")), present);
        assert.equal(matches(group([exists, rule("id", "exists", true)], "and")), present);
      }
    }
  }
});

test("filter groups compose nested AND/OR, preserve numeric and boolean semantics, and reject missing values", () => {
  const { group, rule } = definitions;
  const { states, context } = fixture();
  const attribute = (key, operator, value) => ({
    ...rule("attribute", operator, value),
    attribute: key,
  });
  const matches = (condition, id = "sensor.a") =>
    evaluation.compileFilter(condition, "states", context).evaluate(states[id], states).match;
  assert.equal(
    matches(
      group([
        rule("state", "any_of", ["unknown", "unavailable"]),
        group([attribute("battery", "less_than", 20), rule("domain", "equals", "light")], "or"),
      ]),
    ),
    true,
  );
  assert.equal(
    matches(group([attribute("enabled", "equals", false), attribute("battery", "equals", 9)])),
    true,
  );
  assert.equal(matches(group([rule("state", "greater_than", 10)]), "sensor.b"), true);
  for (const operator of [
    "exists",
    "not_equals",
    "equals",
    "contains",
    "greater_than",
    "less_than",
  ]) {
    assert.equal(
      matches(group([attribute("missing", operator, operator === "exists" ? true : 1)])),
      false,
      operator,
    );
  }
  states["sensor.a"].attributes.null_value = null;
  assert.equal(matches(group([attribute("null_value", "exists", true)])), false);
  assert.equal(matches(group([attribute("null_value", "not_equals", "unknown")])), false);
  assert.equal(
    evaluation
      .compileFilter(group([rule("domain", "equals", "sensor")]), "states", context)
      .evaluate({}, states).match,
    false,
  );
  for (const invalid of [
    "unknown",
    "unavailable",
    "",
    " ",
    false,
    null,
    "Infinity",
    "0x10",
    {},
    [],
  ]) {
    assert.equal(evaluation.compareValue(invalid, "less_than", 20), false, JSON.stringify(invalid));
  }
  // Valid syntax that overflows the finite range must not compare as Infinity.
  for (const overflow of ["1e309", "-1e309", Infinity, -Infinity]) {
    for (const operator of ["greater_than", "less_than", "equals"])
      assert.equal(
        evaluation.compareValue(overflow, operator, 50),
        false,
        `${overflow} ${operator}`,
      );
  }
});

test("device ANY/ALL groups apply AND to the same entity and combine separate groups independently", () => {
  const { group, rule } = definitions;
  const { states, context } = fixture();
  const entities = (conditions, quantifier = "any") => ({
    type: "entities",
    quantifier,
    condition: group(conditions),
  });
  const evaluate = (condition, id = "one") =>
    evaluation.compileFilter(condition, "devices", context).evaluate(context.devices[id], states);
  const unknown = rule("state", "equals", "unknown");
  const highBattery = { ...rule("attribute", "greater_than", 50), attribute: "battery" };
  assert.equal(evaluate(group([entities([unknown, highBattery])])).match, false);
  const separate = evaluate(group([entities([unknown]), entities([highBattery])]));
  assert.equal(separate.match, true);
  assert.deepEqual([...separate.entities].sort(), ["sensor.a", "sensor.b"]);
  assert.equal(evaluate(group([entities([unknown], "all")])).match, false);
  assert.equal(
    evaluate(group([entities([rule("domain", "equals", "sensor")], "all")])).match,
    true,
  );
  for (const quantifier of ["any", "all"])
    assert.equal(evaluate(group([entities([unknown], quantifier)]), "empty").match, false);
  states["sensor.absent"] = entity("sensor.absent", "unavailable");
  assert.equal(
    evaluate(group([entities([rule("state", "equals", "unknown")])]), "empty").match,
    false,
  );
  assert.equal(
    evaluate(group([entities([rule("state", "equals", "unavailable")])]), "empty").match,
    true,
  );
  context.entities["sensor.absent"].disabled_by = "user";
  assert.equal(
    evaluate(group([entities([rule("state", "equals", "unavailable")])]), "empty").match,
    false,
  );
});

test("nested device ANY/ALL conditions share missing-value and NOT Exists semantics", () => {
  const { group, rule } = definitions;
  for (const [name, value, present, equals] of valueCases) {
    for (const both of [false, true]) {
      const { states, context } = fixture();
      states["sensor.a"].attributes = value;
      states["sensor.b"].attributes = both ? value : { value: null };
      for (const [operator, expected, firstMatch] of [
        ["exists", true, present],
        ["equals", "match", equals],
        ["not_equals", "match", present && !equals],
      ]) {
        const condition = { ...rule("attribute", operator, expected), attribute: "value" };
        for (const quantifier of ["any", "all"]) {
          const nested = { type: "entities", quantifier, condition: group([condition]) };
          const saved = JSON.parse(JSON.stringify(group([nested])));
          assert.equal(definitions.validCondition(saved, "devices"), true);
          const result = evaluation
            .compileFilter(saved, "devices", context)
            .evaluate(context.devices.one, states);
          assert.equal(
            result.match,
            firstMatch && (both || quantifier === "any"),
            `${name} ${operator} ${quantifier} both=${both}`,
          );
          nested.condition = group(
            [{ ...rule("attribute", "exists", true), attribute: "value" }],
            "not",
          );
          assert.equal(
            evaluation
              .compileFilter(group([nested]), "devices", context)
              .evaluate(context.devices.one, states).match,
            quantifier === "all" ? !present : !present || !both,
            `${name} NOT Exists ${quantifier} both=${both}`,
          );
        }
      }
    }
  }
});

test("NOT groups match only when no child matches, including nested and device entity groups", () => {
  const { group, rule } = definitions;
  const { states, context } = fixture();
  const a = rule("state", "equals", "unknown");
  const b = rule("domain", "equals", "sensor");
  const matches = (condition) =>
    evaluation.compileFilter(condition, "states", context).evaluate(states["sensor.a"], states)
      .match;
  for (const [left, right, expected] of [
    [a, b, false],
    [a, rule("domain", "equals", "light"), false],
    [rule("state", "equals", "on"), b, false],
    [rule("state", "equals", "on"), rule("domain", "equals", "light"), true],
  ])
    assert.equal(matches(group([left, right], "not")), expected);
  const condition = group([group([a], "not")], "not");
  assert.equal(matches(condition), true);
  assert.equal(definitions.validCondition(condition, "states"), true);
  assert.equal(definitions.validCondition(group([], "not"), "states"), false);
  assert.equal(
    definitions.validCondition(group([group([group([group([a], "not")])])]), "states"),
    false,
  );
  const entities = { type: "entities", quantifier: "any", condition: group([a]) };
  const result = evaluation.compileFilter(group([entities], "not"), "devices", context);
  assert.equal(result.evaluate(context.devices.one, states).match, false);
  const empty = result.evaluate(context.devices.empty, states);
  assert.equal(empty.match, true);
  assert.equal(empty.entities.size, 0);
});

test("registry metadata inherits device area, labels and manufacturer and reuses smart predicates", () => {
  const { group, rule } = definitions;
  const { states, context } = fixture();
  const condition = group([
    rule("area", "equals", "room"),
    rule("label", "equals", "critical"),
    rule("manufacturer", "contains", "acm"),
    rule("smart", "equals", "unknown"),
  ]);
  assert.equal(
    evaluation.compileFilter(condition, "states", context).evaluate(states["sensor.a"], states)
      .match,
    true,
  );
  const battery = entity("sensor.battery", "19", {
    device_class: "battery",
    unit_of_measurement: "%",
  });
  assert.equal(
    evaluation
      .compileFilter(group([rule("smart", "equals", "low_battery")]), "states", context)
      .evaluate(battery, {}).match,
    true,
  );
});

test("Low Battery thresholds validate only on battery smart rules and preserve legacy defaults", () => {
  const { group, rule, validCondition } = definitions;
  const battery = rule("smart", "equals", "low_battery");
  assert.equal(validCondition(group([battery]), "states"), true);
  for (const threshold of [0, 10, 15, 15.5, 20, 100])
    assert.equal(validCondition(group([{ ...battery, threshold }]), "states"), true);
  for (const threshold of [undefined, null, true, false, "15", [], {}, -1, 100.01, NaN, Infinity])
    assert.equal(validCondition(group([{ ...battery, threshold }]), "states"), false);
  for (const condition of [
    rule("smart", "equals", "unknown"),
    rule("state", "less_than", 15),
    rule("attribute", "equals", "low_battery"),
  ])
    assert.equal(validCondition(group([{ ...condition, threshold: 15 }]), "states"), false);
  assert.equal(validCondition(group([{ ...battery, threshold: 15 }]), "devices"), false);
});

test("Low Battery uses custom thresholds for entities and nested device entity matches", () => {
  const { group, rule } = definitions;
  const { context } = fixture();
  for (const threshold of [undefined, 0, 10, 15, 15.5, 100]) {
    const condition = group([
      {
        ...rule("smart", "equals", "low_battery"),
        ...(threshold === undefined ? {} : { threshold }),
      },
    ]);
    const compiled = evaluation.compileFilter(condition, "states", context);
    for (const percentage of [-1, 0, 9, 10, 14.9, 15, 15.5, 19, 20, 99.9, 100, 101, "unknown"])
      assert.equal(
        compiled.evaluate(
          entity("sensor.battery", String(percentage), {
            device_class: "battery",
            unit_of_measurement: "%",
          }),
          {},
        ).match,
        typeof percentage === "number" && percentage >= 0 && percentage < (threshold ?? 20),
        `${percentage} below ${threshold ?? 20}`,
      );
    assert.equal(
      compiled.evaluate(
        entity("sensor.voltage", "5", {
          device_class: "battery",
          unit_of_measurement: "V",
        }),
        {},
      ).match,
      false,
    );
  }
  const states = {
    "sensor.a": entity("sensor.a", "10", { device_class: "battery", unit_of_measurement: "%" }),
    "sensor.b": entity("sensor.b", "15", { device_class: "battery", unit_of_measurement: "%" }),
  };
  for (const [quantifier, threshold, expected] of [
    ["any", 10, false],
    ["any", 15, true],
    ["all", 15, false],
    ["all", 16, true],
  ]) {
    const condition = group([
      {
        type: "entities",
        quantifier,
        condition: group([{ ...rule("smart", "equals", "low_battery"), threshold }]),
      },
    ]);
    assert.equal(definitions.validCondition(condition, "devices"), true);
    const result = evaluation
      .compileFilter(condition, "devices", context)
      .evaluate(context.devices.one, states);
    assert.equal(result.match, expected);
    if (quantifier === "any" && expected) assert.deepEqual([...result.entities], ["sensor.a"]);
  }
  const t = (key, parameters = {}) =>
    english[key].replace(/\{(\w+)\}/g, (_, name) => parameters[name]);
  for (const threshold of [undefined, 10, 15.5])
    assert.equal(
      presentation.conditionSummary({ ...rule("smart", "equals", "low_battery"), threshold }, t)
        .text,
      `Smart filter Low battery below ${threshold ?? 20}%`,
    );
});

test("records without labels treat label like other missing values", () => {
  const { group, rule } = definitions;
  const { states, context } = fixture();
  const matches = (condition, id) =>
    evaluation.compileFilter(condition, "states", context).evaluate(states[id], states).match;
  // sensor.a is labeled "critical"; sensor.b and its device have no labels.
  assert.equal(matches(group([rule("label", "not_equals", "other")]), "sensor.a"), true);
  assert.equal(matches(group([rule("label", "not_equals", "critical")]), "sensor.a"), false);
  for (const operator of ["equals", "not_equals", "any_of"]) {
    const value = operator === "any_of" ? ["critical"] : "critical";
    assert.equal(matches(group([rule("label", operator, value)]), "sensor.b"), false, operator);
  }
  // Same as a missing area: "not equals" never matches an absent value.
  delete context.devices.one.area_id;
  assert.equal(matches(group([rule("area", "not_equals", "room")]), "sensor.b"), false);
});

test("device and entity labels expose Exists and preserve membership and inherited labels", () => {
  const { group, rule } = definitions;
  assert.ok(definitions.fieldOperators("label").includes("exists"));
  for (const kind of ["devices", "states"]) {
    for (const [labels, present] of [
      [{}, false],
      [{ labels: undefined }, false],
      [{ labels: null }, false],
      [{ labels: [] }, false],
      [{ labels: ["critical", "other"] }, true],
    ]) {
      const { states, context } = fixture();
      const registry = context.entities["sensor.a"];
      const device = context.devices.one;
      delete registry.labels;
      Object.assign(kind === "devices" ? device : registry, labels);
      const record = kind === "devices" ? device : states["sensor.a"];
      const matches = (condition) =>
        evaluation.compileFilter(condition, kind, context).evaluate(record, states).match;
      for (const [operator, value, expected] of [
        ["exists", true, present],
        ["equals", "critical", present],
        ["not_equals", "critical", false],
        ["not_equals", "missing", present],
        ["any_of", ["critical"], present],
      ]) {
        const condition = group([rule("label", operator, value)]);
        assert.equal(definitions.validCondition(clone(condition), kind), true);
        assert.equal(matches(condition), expected, `${kind} ${JSON.stringify(labels)} ${operator}`);
      }
      assert.equal(matches(group([rule("label", "exists", true)], "not")), !present);
      if (kind === "states") {
        device.labels = ["inherited"];
        assert.equal(matches(group([rule("label", "exists", true)])), true);
        assert.equal(matches(group([rule("label", "equals", "inherited")])), true);
      }
    }
  }
});

test("saved defaults reference their own collection", () => {
  const filters = clone(definitions.profileFilters());
  filters.defaults = { states: "unknown" };
  assert.equal(definitions.validFilters(filters), true);
  assert.equal(definitions.defaultFilter(filters, "states", "favorites"), "unknown");
  for (const defaults of [
    null,
    [],
    "unknown",
    { states: null },
    { states: 1 },
    { states: undefined },
    { states: "missing" },
    { states: "temporary" },
    { states: "assigned" },
    { devices: "unknown" },
    { other: "all" },
  ]) {
    assert.equal(definitions.validFilters({ ...filters, defaults }), false);
  }
  filters.states.find((filter) => filter.id === "unknown").hidden = true;
  assert.equal(definitions.defaultFilter(filters, "states", "favorites"), "all");
});

test("filter colors preserve supported formats and reject invalid values in both collections", () => {
  const filters = clone(definitions.profileFilters());
  assert.equal(definitions.validFilters(filters), true);
  for (const kind of ["states", "devices"]) {
    for (const color of colorCases.valid) {
      filters[kind].forEach((filter) => {
        filter.color = color;
      });
      assert.equal(definitions.validFilters(filters), true);
    }
    for (const color of [...colorCases.invalid, " ".repeat(257), `var(--${"x".repeat(250)})`]) {
      filters[kind][2].color = color;
      assert.equal(definitions.validFilters(filters), false);
    }
    delete filters[kind][2].color;
  }
});

test("filter validation protects system filters and enforces exact shape, bounds and supported rules", () => {
  const { group, rule } = definitions;
  const initial = clone(definitions.profileFilters());
  for (const mutate of [
    (filters) => filters.states.shift(),
    (filters) => {
      filters.states[0].name = "Renamed";
    },
    (filters) => {
      filters.states[2].name = "ALL";
    },
    (filters) => {
      filters.states[2].condition.conditions[0].operator = "regex";
    },
    (filters) => {
      filters.states[2].matches = ["sensor.a"];
    },
    (filters) => {
      filters.states[2].condition = group([null]);
    },
    (filters) => {
      filters.states[2].condition = group([group([group([group([rule()])])])]);
    },
    (filters) => {
      filters.states[2].condition = group(Array.from({ length: 11 }, () => rule()));
    },
    (filters) => {
      filters.devices[2].condition = group([rule("state", "equals", "on")]);
    },
    (filters) => {
      filters.states[2].condition = group([
        { type: "entities", quantifier: "any", condition: group([rule()]) },
      ]);
    },
    (filters) => {
      filters.states[2].id = "temporary";
    },
    (filters) => {
      filters.states[2].icon = "mdi:Bad";
    },
    (filters) => {
      filters.states[2].templateId = "assigned";
    },
    (filters) => {
      filters.states[2].condition = group([rule("filter", "equals", "unknown")]);
    },
  ]) {
    const next = clone(initial);
    mutate(next);
    assert.equal(definitions.validFilters(next), false);
  }
  initial.states[0].hidden = true;
  initial.states[1].hidden = true;
  assert.equal(definitions.validFilters(initial), true);
  for (let index = 0; index < 6; index++)
    initial.states.push({
      id: `custom_${index}`,
      name: `Custom ${index}`,
      hidden: false,
      condition: group([rule()]),
    });
  assert.equal(definitions.validFilters(initial), true);
  initial.states.push({ id: "eleven", name: "Eleven", hidden: false, condition: group([rule()]) });
  assert.equal(definitions.validFilters(initial), false);
  const oversized = clone(definitions.profileFilters());
  for (const kind of ["states", "devices"])
    oversized[kind] = [
      ...oversized[kind].slice(0, 2),
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `custom_${index}`,
        name: `Custom ${index}`,
        hidden: false,
        condition: group(Array.from({ length: 10 }, () => rule("name", "equals", "x".repeat(256)))),
      })),
    ];
  assert.equal(
    definitions.validFilters(oversized),
    false,
    "valid individual rules still obey the profile filter payload cap",
  );
});

test("restored templates retain localization without translating custom filter names", () => {
  const template = clone(definitions.filterTemplates("states")[0]);
  template.id = "restored";
  const translate = (key) => `translated:${key}`;
  assert.equal(definitions.filterLabel(template, "states", translate), template.name);
  template.templateId = "unavailable";
  assert.equal(
    definitions.filterLabel(template, "states", translate),
    "translated:entities.unavailable",
  );
  const filters = clone(definitions.profileFilters());
  filters.states[2] = template;
  assert.equal(definitions.validFilters(filters), true);
});
