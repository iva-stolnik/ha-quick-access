// Filter editor conditions, values, logic and visual tree.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  flush,
  clickAndFlush,
  dispatchAndFlush,
  clone,
  filterDefinitions,
  filterField,
  filterAction,
  editNewFilter,
  setFilterField,
  filterValueOptions,
  savedProfile,
  environment,
  openEntityStates,
  statesProvider,
  deviceFixture,
  openDevices,
  installDeviceRegistries,
  nativeComponents,
  buttons,
  profileMenuIn,
} = require("./harness.cjs");

test("filter values reuse shared dropdowns and persist multiple canonical IDs", async () => {
  const env = environment();
  installDeviceRegistries(env);
  env.status.hass.areas.office = { area_id: "office", name: "Office" };
  env.status.hass.entities = { "sensor.kitchen": { device_id: "device_a" } };
  env.status.hass.states = {
    "sensor.kitchen": { entity_id: "sensor.kitchen", state: "21", attributes: {} },
  };
  await openEntityStates(env);
  const panel = await editNewFilter(env, "Rooms");
  await setFilterField(panel, "Condition", "area");
  assert.equal(filterField(panel, "Value").localName, "qap-select");
  assert.deepEqual(
    filterValueOptions(panel).map((item) => item.label),
    ["Kitchen (kitchen)", "Office (office)"],
  );
  await setFilterField(panel, "Value", "kitchen");
  assert.equal(panel.querySelector(".qap-filter-preview").textContent, "1 matching entity");
  await setFilterField(panel, "Comparison", "any_of");
  assert.equal(filterField(panel, "Value").localName, "qap-select-selector");
  await setFilterField(panel, "Value", ["kitchen", "office"]);
  assert.equal(panel.querySelector(".qap-filter-selected"), null);
  assert.equal(panel.querySelector(".qap-filter-options"), null);
  await clickAndFlush(buttons(panel).find((item) => item.textContent === "Save"));
  assert.deepEqual(savedProfile(env).filters.states.at(-1).condition.conditions[0], {
    type: "rule",
    field: "area",
    operator: "any_of",
    value: ["kitchen", "office"],
  });
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "1 entity");
  assert.equal(env.server.requests.length, 1);
});

test("filter dropdowns retain missing IDs and refresh names without replacing the field", async () => {
  const env = environment();
  installDeviceRegistries(env);
  env.status.hass.entities = {};
  const definitions = await filterDefinitions(env);
  savedProfile(env).filters = clone(definitions.profileFilters());
  savedProfile(env).filters.states.push({
    id: "saved_room",
    name: "Saved room",
    hidden: false,
    condition: definitions.group([definitions.rule("area", "equals", "deleted")]),
  });
  await openEntityStates(env);
  await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
  const panel = env.document.body.querySelector(".qap-filter-panel");
  await filterAction(env, panel, "Saved room", "edit");
  const input = filterField(panel, "Value");
  assert.equal(input.value, "deleted");
  assert.equal(
    filterValueOptions(panel).find((item) => item.value === "deleted").label,
    "deleted (missing)",
  );
  env.status.hass.areas = { deleted: { area_id: "deleted", name: "Restored room" } };
  await env.tick(15000);
  await env.tick(250);
  assert.equal(filterField(panel, "Value"), input);
  assert.equal(input.value, "deleted");
  assert.equal(
    filterValueOptions(panel).find((item) => item.value === "deleted").label,
    "Restored room (deleted)",
  );
  await clickAndFlush(buttons(panel).find((item) => item.textContent === "Save"));
  assert.equal(savedProfile(env).filters.states.at(-1).condition.conditions[0].value, "deleted");
});

test("filter label selectors load once and offer manual entry on registry failure", async () => {
  for (const fails of [false, true]) {
    const env = environment();
    nativeComponents(env);
    installDeviceRegistries(env);
    env.status.hass.entities = {};
    let resolveLabels, rejectLabels;
    let requests = 0;
    env.status.hass.callWS = ({ type }) => {
      assert.equal(type, "config/label_registry/list");
      requests++;
      return new Promise((resolve, reject) => {
        resolveLabels = resolve;
        rejectLabels = reject;
      });
    };
    await openDevices(env);
    const panel = await editNewFilter(env, "Labels");
    assert.equal(requests, 0);
    await setFilterField(panel, "Condition", "label");
    assert.equal(
      panel.querySelector(".qap-filter-value").querySelector(".qap-field-tip").hidden,
      true,
    );
    if (fails) rejectLabels(new Error("Not available to this user"));
    else resolveLabels([{ label_id: "critical", name: "Critical devices" }]);
    await flush();
    await env.tick(250);
    assert.equal(env.document.body.querySelector(".qap-registry-status").hidden, true);
    if (fails) {
      assert.equal(filterField(panel, "Value").localName, "qap-select-selector");
      assert.equal(filterField(panel, "Value").selector.select.custom_value, true);
      assert.equal(
        panel.querySelector(".qap-filter-value").querySelector(".qap-field-tip").textContent,
        "Registry unavailable. Enter a value manually.",
      );
    } else
      assert.deepEqual(
        filterValueOptions(panel).map((item) => item.label),
        ["Critical devices (critical)"],
      );
    await setFilterField(panel, "Value", fails ? "manual_label" : "critical");
    await clickAndFlush(buttons(panel).find((item) => item.textContent === "Save"));
    assert.equal(
      savedProfile(env).filters.devices.at(-1).condition.conditions[0].value,
      fails ? "manual_label" : "critical",
    );
    assert.equal(requests, 1);
    env.enable(false);
    await flush();
    assert.equal(env.timers.size, 0);
  }
});

test("device filter field changes reset incompatible values and nested groups expose entity conditions and presets", async () => {
  const env = environment();
  installDeviceRegistries(env);
  env.status.hass.entities = { "sensor.temperature": { device_id: "device_a", platform: "demo" } };
  env.status.hass.states = {
    "sensor.temperature": {
      entity_id: "sensor.temperature",
      state: "12",
      attributes: { temperature: 12 },
    },
  };
  await openDevices(env);
  const panel = await editNewFilter(env, "Device test", "Thermostat");
  const fields = Array.from(filterField(panel, "Condition").options, (item) => item.value);
  assert.ok(!fields.includes("state") && !fields.includes("attribute"));
  assert.ok(fields.includes("entry_type") && fields.includes("model_id"));
  await setFilterField(panel, "Condition", "smart");
  assert.deepEqual(
    Array.from(filterField(panel, "Value").options, (item) => item.value),
    ["assigned", "unassigned"],
  );
  await clickAndFlush(panel.querySelector(".qap-filter-add-entities"));
  let nested = panel.querySelectorAll(".qap-filter-rule").at(-1);
  assert.ok(filterField(nested, "Condition").options.some((item) => item.value === "state"));
  assert.ok(filterField(nested, "Condition").options.some((item) => item.value === "platform"));
  await setFilterField(nested, "Condition", "smart");
  nested = panel.querySelectorAll(".qap-filter-rule").at(-1);
  assert.deepEqual(
    Array.from(filterField(nested, "Value").options, (item) => item.value),
    ["unavailable", "unknown", "low_battery", "updates"],
  );
  await setFilterField(nested, "Condition", "attribute");
  nested = panel.querySelectorAll(".qap-filter-rule").at(-1);
  const attribute = filterField(nested, "Attribute name");
  attribute.value = "temperature";
  await dispatchAndFlush(attribute, new Event("input"));
  await setFilterField(nested, "Comparison", "greater_than");
  nested = panel.querySelectorAll(".qap-filter-rule").at(-1);
  assert.equal(filterField(nested, "Value").value, "0");
  const numeric = filterField(nested, "Value");
  numeric.value = "10";
  await dispatchAndFlush(numeric, new Event("input"));
  assert.equal(panel.querySelector(".qap-filter-preview").textContent, "1 matching device");
  await setFilterField(nested, "Condition", "platform");
  nested = panel.querySelectorAll(".qap-filter-rule").at(-1);
  assert.equal(filterField(nested, "Comparison").value, "equals");
  assert.equal(
    nested
      .querySelectorAll(".qap-field")
      .some((item) => item.querySelector("label")?.textContent === "Attribute name"),
    false,
  );
  assert.equal(filterField(nested, "Value").value, "");
  await setFilterField(nested, "Value", "demo");
  await clickAndFlush(buttons(panel).find((item) => item.textContent === "Save"));
  const saved = savedProfile(env).filters.devices.at(-1).condition.conditions[1];
  assert.equal(saved.type, "entities");
  assert.deepEqual(saved.condition.conditions[0], {
    type: "rule",
    field: "platform",
    operator: "equals",
    value: "demo",
  });
});

for (const action of ["Save", "Apply temporarily"]) {
  test(`filter logic badge selects AND/OR/NOT without a Match selector (${action})`, async () => {
    const env = environment();
    env.status.hass.entities = {};
    env.status.hass.devices = {};
    env.status.hass.areas = {};
    env.status.hass.states = Object.fromEntries(
      ["on", "on", "off"].map((state, index) => [
        `sensor.${index}`,
        {
          entity_id: `sensor.${index}`,
          state,
          attributes: {},
        },
      ]),
    );
    await openEntityStates(env);
    const panel = await editNewFilter(env, "Logic", "on");
    const group = panel.querySelector(".qap-filter-group");
    const contents = group.querySelector(".qap-filter-group-contents");
    const input = filterField(panel, "Value");
    const trigger = group.querySelector(".qap-filter-logic");
    assert.equal(trigger.getAttribute("aria-haspopup"), "menu");
    assert.ok(
      !panel
        .querySelectorAll(".qap-field")
        .some((field) => field.querySelector("label")?.textContent === "Match"),
    );
    for (const [operator, count] of [
      ["or", 2],
      ["and", 2],
      ["not", 1],
    ]) {
      await dispatchAndFlush(
        trigger,
        Object.assign(new Event("keydown", { cancelable: true }), { key: "ArrowDown" }),
      );
      const menu = profileMenuIn(env);
      assert.equal(menu.localName, "qap-menu");
      assert.ok(menu.classList.contains("qap-filter-logic-menu"));
      assert.deepEqual(
        buttons(menu).map((item) => item.textContent),
        ["AND", "OR", "NOT"],
      );
      assert.equal(contents.hidden, false, "opening the logic menu does not collapse the group");
      await clickAndFlush(menu.querySelector(`.qap-filter-logic-${operator}`));
      assert.equal(profileMenuIn(env), null);
      assert.equal(trigger.textContent, operator.toUpperCase());
      assert.equal(trigger.getAttribute("aria-expanded"), "false");
      assert.equal(group.dataset.operator, operator);
      assert.equal(filterField(panel, "Value"), input);
      assert.equal(
        panel.querySelector(".qap-filter-preview").textContent,
        `${count} matching ${count === 1 ? "entity" : "entities"}`,
      );
    }
    await clickAndFlush(buttons(panel).find((item) => item.textContent === action));
    if (action === "Save") {
      assert.equal(
        savedProfile(env).filters.states.find((filter) => filter.name === "Logic").condition
          .operator,
        "not",
      );
      await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
      await filterAction(env, panel, "Logic", "edit");
      assert.equal(panel.querySelector(".qap-filter-logic").textContent, "NOT");
    } else {
      assert.equal(env.server.requests.length, 0);
      assert.equal(env.document.body.querySelectorAll(".qap-state-row").length, 1);
      assert.equal(env.document.body.querySelector(".qap-state-row").dataset.entity, "sensor.2");
    }
  });
}

test(`visual filter tree collapses groups, edits one condition and retains draft controls`, async () => {
  const env = environment();
  env.status.hass.entities = {};
  env.status.hass.devices = {};
  env.status.hass.areas = {};
  const definitions = await filterDefinitions(env);
  const { group, rule } = definitions;
  const condition = clone(
    group([
      rule("state", "equals", "on"),
      group(
        [
          { ...rule("attribute", "less_than", 20), attribute: "battery" },
          rule("domain", "equals", "sensor"),
        ],
        "or",
      ),
    ]),
  );
  savedProfile(env).filters = clone(definitions.profileFilters());
  savedProfile(env).filters.states.push({
    id: "visual",
    name: "Visual",
    hidden: false,
    condition,
  });
  env.status.hass.states = {
    "sensor.one": { entity_id: "sensor.one", state: "on", attributes: { battery: 12 } },
  };
  await openEntityStates(env);
  await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
  const panel = env.document.body.querySelector(".qap-filter-panel");
  await filterAction(env, panel, "Visual", "edit");
  const modal = env.document.body.querySelector(".qap-filter-modal");
  const name = filterField(panel, "Filter name");
  const [root, nested] = panel.querySelectorAll(".qap-filter-group");
  const [first, second, third] = panel.querySelectorAll(".qap-filter-rule");
  assert.equal(root.dataset.operator, "and");
  assert.equal(nested.dataset.operator, "or");
  assert.equal(nested.querySelector(".qap-filter-logic").textContent, "OR");
  assert.equal(
    nested.querySelector(".qap-filter-group-header").querySelector(".qap-filter-remove").title,
    "Remove group",
  );
  assert.equal(first.querySelector(".qap-filter-remove").title, "Remove condition");
  assert.ok(
    [first, second, third].every((row) => row.querySelector(".qap-filter-rule-fields").hidden),
  );
  assert.equal(panel.querySelector(".qap-filter-expression"), null);
  await clickAndFlush(nested.querySelector(".qap-filter-group-toggle"));
  assert.equal(nested.querySelector(".qap-filter-group-contents").hidden, true);
  assert.equal(
    nested.querySelector(".qap-filter-group-toggle").getAttribute("aria-expanded"),
    "false",
  );
  await clickAndFlush(nested.querySelector(".qap-filter-group-toggle"));
  await clickAndFlush(first.querySelector(".qap-filter-rule-toggle"));
  assert.equal(first.querySelector(".qap-filter-rule-fields").hidden, false);
  const input = filterField(first, "Value");
  env.document.activeElement = input;
  input.value = "off";
  await dispatchAndFlush(input, new Event("input"));
  assert.equal(filterField(first, "Value"), input);
  assert.equal(env.document.activeElement, input);
  assert.equal(panel.querySelectorAll(".qap-filter-rule")[1], second);
  assert.equal(filterField(panel, "Filter name"), name);
  assert.equal(env.document.body.querySelector(".qap-filter-modal"), modal);
  assert.ok(first.querySelector(".qap-filter-rule-value").textContent.includes("off"));
  await clickAndFlush(second.querySelector(".qap-filter-edit-condition"));
  assert.equal(first.querySelector(".qap-filter-rule-fields").hidden, true);
  assert.equal(second.querySelector(".qap-filter-rule-fields").hidden, false);
  await setFilterField(second, "Comparison", "greater_than");
  assert.equal(panel.querySelectorAll(".qap-filter-rule")[1], second);
  assert.equal(filterField(second, "Value").value, "0");
  const value = filterField(second, "Value");
  value.value = "";
  await dispatchAndFlush(value, new Event("input"));
  assert.equal(second.querySelector(".qap-field-error").hidden, true);
  assert.equal(
    second.querySelector(".qap-filter-rule-toggle").getAttribute("aria-invalid"),
    "false",
  );
  await clickAndFlush(buttons(panel).find((item) => item.textContent === "Apply temporarily"));
  assert.equal(second.querySelector(".qap-field-error").hidden, false);
  assert.equal(
    second.querySelector(".qap-filter-rule-toggle").getAttribute("aria-invalid"),
    "true",
  );
  assert.equal(env.document.body.querySelector(".qap-filter-modal"), modal);
  assert.equal(env.server.requests.length, 0);
  value.value = "10";
  await dispatchAndFlush(value, new Event("input"));
  await clickAndFlush(buttons(panel).find((item) => item.textContent === "Save"));
  const saved = savedProfile(env).filters.states.find((item) => item.id === "visual").condition;
  assert.equal(saved.conditions[0].value, "off");
  assert.equal(saved.conditions[1].conditions[0].value, 10);
  assert.equal(saved.conditions[1].operator, "or");
});

test("visual filter tree enforces depth and count limits and allows an empty group to be repaired", async () => {
  const env = environment();
  await openEntityStates(env);
  const panel = await editNewFilter(env, "Limits", "on");
  await clickAndFlush(panel.querySelector(".qap-filter-add-group"));
  let nested = panel.querySelectorAll(".qap-filter-group")[1];
  await clickAndFlush(nested.querySelector(".qap-filter-add-group"));
  const deepest = panel.querySelectorAll(".qap-filter-group")[2];
  assert.equal(deepest.dataset.depth, "2");
  assert.equal(deepest.querySelector(".qap-filter-add-group"), null);
  for (let index = 3; index < 10; index++)
    await clickAndFlush(panel.querySelector(".qap-filter-add-condition"));
  assert.equal(panel.querySelectorAll(".qap-filter-rule").length, 10);
  assert.ok(panel.querySelectorAll(".qap-filter-add-condition").every((action) => action.disabled));
  assert.ok(panel.querySelectorAll(".qap-filter-add-group").every((action) => action.disabled));
  await clickAndFlush(panel.querySelector(".qap-filter-add-condition"));
  assert.equal(panel.querySelectorAll(".qap-filter-rule").length, 10);
  nested = panel.querySelectorAll(".qap-filter-group")[1];
  await clickAndFlush(nested.querySelector(".qap-filter-rule").querySelector(".qap-filter-remove"));
  assert.equal(panel.querySelector(".qap-filter-add-condition").disabled, false);
  const root = panel.querySelector(".qap-filter-group");
  await clickAndFlush(
    root.querySelector(".qap-filter-group-header").querySelector(".qap-filter-group-toggle"),
  );
  assert.equal(root.querySelector(".qap-filter-group-contents").hidden, true);
  await clickAndFlush(root.querySelector(".qap-filter-add-condition"));
  assert.equal(panel.querySelector(".qap-filter-group-contents").hidden, false);
});

test("matching preview uses the live filter cache without changing the selected filter or saving a draft", async () => {
  const env = environment();
  env.status.hass.entities = {};
  env.status.hass.devices = {};
  env.status.hass.areas = {};
  env.status.hass.states = Object.fromEntries(
    Array.from({ length: 42 }, (_, index) => [
      `sensor.${index}`,
      {
        entity_id: `sensor.${index}`,
        state: "on",
        attributes: {},
      },
    ]),
  );
  const provider = statesProvider(env);
  await openEntityStates(env);
  const panel = await editNewFilter(env, "Preview", "on");
  const input = filterField(panel, "Value");
  const selected = env.document.body
    .querySelectorAll(".qap-state-tab")
    .find((tab) => tab.getAttribute("aria-pressed") === "true");
  await clickAndFlush(panel.querySelector(".qap-filter-preview-action"));
  assert.equal(
    panel.querySelector(".qap-filter-preview-action").getAttribute("aria-expanded"),
    "true",
  );
  assert.equal(
    panel.querySelector(".qap-filter-matches").querySelectorAll(".qap-state-row").length,
    40,
  );
  await clickAndFlush(
    buttons(panel.querySelector(".qap-filter-matches")).find(
      (item) => item.textContent === "Next values",
    ),
  );
  assert.equal(
    panel.querySelector(".qap-filter-matches").querySelectorAll(".qap-state-row").length,
    2,
  );
  provider.publish({ "sensor.only": { entity_id: "sensor.only", state: "on", attributes: {} } });
  await env.tick(250);
  assert.equal(panel.querySelector(".qap-filter-preview").textContent, "1 matching entity");
  assert.equal(
    panel.querySelector(".qap-filter-matches").querySelectorAll(".qap-state-row").length,
    1,
  );
  assert.equal(filterField(panel, "Value"), input);
  assert.equal(
    env.document.body
      .querySelectorAll(".qap-state-tab")
      .find((tab) => tab.getAttribute("aria-pressed") === "true"),
    selected,
  );
  assert.equal(env.server.requests.length, 0);
  const previewRow = panel.querySelector(".qap-filter-matches").querySelector(".qap-state-summary");
  await clickAndFlush(previewRow);
  const details = env.document.body
    .querySelectorAll(".qap-state-modal")
    .find((modal) => modal.dataset.id === "sensor.only");
  assert.ok(details);
  await clickAndFlush(details.querySelector(".qap-icon-button"));
  assert.equal(filterField(panel, "Value") === input, true);
  await clickAndFlush(panel.querySelector(".qap-filter-preview-action"));
  assert.equal(panel.querySelector(".qap-filter-matches").hidden, true);
});

test("an empty filter group stays invalid until a condition is added", async () => {
  const env = environment();
  env.status.hass.entities = {};
  env.status.hass.devices = {};
  env.status.hass.areas = {};
  await openEntityStates(env);
  const panel = await editNewFilter(env, "Repair", "on");
  await clickAndFlush(panel.querySelector(".qap-filter-rule").querySelector(".qap-filter-remove"));
  assert.equal(panel.querySelectorAll(".qap-filter-rule").length, 0);
  assert.ok(
    panel
      .querySelector(".qap-filter-children")
      .querySelector(".qap-muted")
      .textContent.startsWith("No conditions"),
  );
  assert.equal(panel.querySelector(".qap-filter-preview-action").disabled, true);
  await clickAndFlush(buttons(panel).find((item) => item.textContent === "Save"));
  assert.equal(env.server.requests.length, 0);
  assert.ok(panel.querySelector(".qap-error").textContent);
  await clickAndFlush(panel.querySelector(".qap-filter-add-condition"));
  assert.equal(panel.querySelectorAll(".qap-filter-rule").length, 1);
  assert.equal(panel.querySelector(".qap-filter-rule-fields").hidden, false);
  assert.equal(panel.querySelector(".qap-filter-preview-action").disabled, false);
});

test("filter metadata selectors accept custom values and enforce the multiple-value limit", async () => {
  const env = environment();
  nativeComponents(env);
  installDeviceRegistries(env, [deviceFixture("device_a", { sw_version: "current" })]);
  env.status.hass.entities = {};
  await openDevices(env);
  const panel = await editNewFilter(env, "Multiple versions");
  await setFilterField(panel, "Condition", "sw_version");
  await setFilterField(panel, "Comparison", "any_of");
  const control = filterField(panel, "Value");
  assert.equal(control.localName, "qap-select-selector");
  assert.equal(control.selector.select.custom_value, true);
  const values = ["future version", ...Array.from({ length: 19 }, (_, index) => "custom_" + index)];
  await setFilterField(panel, "Value", values);
  await setFilterField(panel, "Value", [...values, "extra"]);
  assert.deepEqual(clone(control.value), values);
  await setFilterField(panel, "Value", [...values.slice(1), "replacement"]);
  await clickAndFlush(buttons(panel).find((item) => item.textContent === "Save"));
  assert.deepEqual(savedProfile(env).filters.devices.at(-1).condition.conditions[0].value, [
    ...values.slice(1),
    "replacement",
  ]);
});

test("owned selectors preserve saved values containing commas through HA registration", async () => {
  const env = environment();
  const components = nativeComponents(env, false);
  installDeviceRegistries(env);
  const definitions = await filterDefinitions(env);
  savedProfile(env).filters = clone(definitions.profileFilters());
  const values = ["ACME, Inc.", "Other"];
  savedProfile(env).filters.devices.push({
    id: "makers",
    name: "Makers",
    hidden: false,
    condition: definitions.group([definitions.rule("manufacturer", "any_of", values)]),
  });
  await openDevices(env);
  await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
  const panel = env.document.body.querySelector(".qap-filter-panel");
  await filterAction(env, panel, "Makers", "edit");
  env.document.activeElement = null;
  components.register("qap-select-selector");
  await flush();
  assert.equal(filterField(panel, "Value").localName, "qap-select-selector");
  assert.deepEqual(clone(filterField(panel, "Value").value), values);
  await clickAndFlush(buttons(panel).find((item) => item.textContent === "Save"));
  assert.deepEqual(savedProfile(env).filters.devices.at(-1).condition.conditions[0].value, values);
});

test("entity selectors share the mounted registry source and retain missing selections through updates", async () => {
  const env = environment();
  const provider = statesProvider(env);
  installDeviceRegistries(env);
  let registryChanged;
  let registryRequests = 0;
  env.homeAssistant.addEventListener("context-request", (event) => {
    if (event.context !== "entities" || event.contextTarget === env.document.body) return;
    registryRequests++;
    registryChanged = event.callback;
    event.callback(env.status.hass.entities, () => {});
  });
  env.status.hass.entities = {
    "sensor.inactive": { original_name: "Inactive sensor", hidden_by: null },
  };
  env.status.hass.states = {
    "sensor.active": { entity_id: "sensor.active", state: "unavailable", attributes: {} },
  };
  await openEntityStates(env);
  const panel = await editNewFilter(env, "Owned entity choices");
  await setFilterField(panel, "Condition", "id");
  await setFilterField(panel, "Comparison", "any_of");
  await setFilterField(panel, "Value", ["sensor.inactive", "sensor.deleted"]);
  const control = filterField(panel, "Value");
  assert.equal(control.localName, "qap-entity-selector");
  assert.equal(control.source.get("sensor.inactive").label, "Inactive sensor");
  assert.equal(control.source.get("sensor.active").state.state, "unavailable");
  const statesRequests = provider.listeners.size;
  const revision = control.revision;
  registryChanged({ "sensor.added": { name: "Added sensor" } }, () => {});
  await env.tick(250);
  await flush();
  assert.equal(filterField(panel, "Value"), control);
  assert.ok(control.revision > revision);
  assert.equal(control.source.get("sensor.inactive"), undefined);
  assert.equal(control.source.get("sensor.added").label, "Added sensor");
  assert.deepEqual(clone(control.value), ["sensor.inactive", "sensor.deleted"]);
  assert.equal(registryRequests, 1);
  assert.equal(provider.listeners.size, statesRequests, "the selector adds no states subscription");
  await clickAndFlush(buttons(panel).find((item) => item.textContent === "Save"));
  assert.deepEqual(savedProfile(env).filters.states.at(-1).condition.conditions[0].value, [
    "sensor.inactive",
    "sensor.deleted",
  ]);
});

test("compact HA entity registries lazily load full metadata once and refresh from registry events", async () => {
  const env = environment();
  installDeviceRegistries(env);
  env.status.hass.entities = { "sensor.room": { device_id: "device_a", hidden: true, labels: [] } };
  env.status.hass.states = {
    "sensor.room": { entity_id: "sensor.room", state: "21", attributes: {} },
  };
  const requests = [];
  const events = new Map();
  let released = 0;
  env.connection.subscribeEvents = async (callback, event) => {
    assert.equal(event, "entity_registry_updated");
    events.set(event, callback);
    return () => {
      released++;
      events.delete(event);
    };
  };
  env.status.hass.callWS = ({ type }) => {
    assert.equal(type, "config/entity_registry/list");
    return new Promise((resolve) => requests.push(resolve));
  };
  await openEntityStates(env);
  const panel = await editNewFilter(env, "Hidden integration entities");
  assert.equal(requests.length, 0);
  await setFilterField(panel, "Condition", "hidden_by");
  assert.equal(requests.length, 1);
  const metadata = [
    {
      entity_id: "sensor.room",
      device_id: "device_a",
      hidden_by: "integration",
      disabled_by: null,
      labels: [],
    },
    {
      entity_id: "sensor.disabled",
      original_name: "Disabled sensor",
      hidden_by: null,
      disabled_by: "user",
      labels: [],
    },
  ];
  requests[0](metadata);
  await flush();
  await env.tick(250);
  assert.deepEqual(
    filterValueOptions(panel).map((item) => item.label),
    ["integration"],
  );
  await setFilterField(panel, "Value", "integration");
  assert.equal(panel.querySelector(".qap-filter-preview").textContent, "1 matching entity");
  await setFilterField(panel, "Condition", "id");
  await setFilterField(panel, "Value", "sensor.disabled");
  assert.equal(panel.querySelector(".qap-filter-options"), null);
  assert.equal(requests.length, 1, "manual ID input does not request metadata");
  await setFilterField(panel, "Condition", "hidden_by");
  await setFilterField(panel, "Value", "integration");
  events.get("entity_registry_updated")();
  assert.equal(requests.length, 2);
  requests[1]([{ ...metadata[0], hidden_by: "user" }, metadata[1]]);
  await flush();
  await env.tick(250);
  assert.equal(
    filterValueOptions(panel).find((item) => item.value === "integration").label,
    "integration (missing)",
  );
  assert.equal(panel.querySelector(".qap-filter-preview").textContent, "0 matching entities");
  await setFilterField(panel, "Value", "user");
  await clickAndFlush(buttons(panel).find((item) => item.textContent === "Save"));
  assert.deepEqual(savedProfile(env).filters.states.at(-1).condition.conditions[0], {
    type: "rule",
    field: "hidden_by",
    operator: "equals",
    value: "user",
  });
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "1 entity");
  env.enable(false);
  await flush();
  assert.equal(events.size, 0);
  assert.equal(released, 1);
});
