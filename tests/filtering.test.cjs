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
  assert.equal(matches(group([attribute("null_value", "exists", true)])), true);
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
