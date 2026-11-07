// Entity states smart filters, HA states context, refresh and formatting.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const vm = require("node:vm");
const test = require("node:test");
const {
  attributesValue,
  installLocaleFetch,
  changeLanguage,
  flush,
  clickAndFlush,
  dispatchAndFlush,
  environment,
  openEntityStates,
  statesProvider,
  nativeComponents,
  buttons,
  scrollStates,
  largeStates,
} = require("./harness.cjs");

for (const [filter, id, initial, matching, attributes] of [
  ["unavailable", "light.example", "on", "unavailable", {}],
  ["unknown", "switch.example", "off", "unknown", {}],
  [
    "low_battery",
    "sensor.example",
    "20",
    "19",
    { device_class: "battery", unit_of_measurement: "%" },
  ],
  ["updates", "update.example", "off", "on", {}],
]) {
  test(`smart filter ${filter} updates membership and preserves interactions`, async () => {
    const env = environment();
    const provider = statesProvider(env);
    const state = {
      entity_id: id,
      state: initial,
      attributes: { ...attributes, friendly_name: "Kitchen" },
    };
    env.status.hass.states = { [id]: state };
    const search = await openEntityStates(env);
    const filters = env.document.body.querySelector(".qap-state-tabs");
    const chip = filters.children.find((control) => control.dataset.domain === filter);
    assert.equal(chip.localName, "qap-chip");
    assert.equal(filters.attributes["aria-label"], "Entity filters");
    chip.click();
    assert.equal(chip.attributes["aria-pressed"], "true");
    assert.equal(
      filters.children.filter((control) => control.attributes["aria-pressed"] === "true").length,
      1,
    );
    assert.equal(chip.selected, true);
    assert.equal(env.document.body.querySelector(".qap-count").textContent, "0 entities");
    assert.equal(
      env.document.body.querySelector(".qap-state-empty").querySelector("strong").textContent,
      "No matching entities",
    );
    provider.publish({ [id]: { ...state, state: matching } });
    await env.tick(250);
    const row = env.document.body.querySelector(".qap-state-row");
    assert.equal(row.dataset.entity, id);
    assert.equal(row.attributes["role"], "listitem");
    assert.equal(row.attributes["aria-setsize"], "1");
    assert.equal(env.document.body.querySelector(".qap-state-empty"), null);
    search.value = "Kitchen";
    search.dispatchEvent(new Event("input"));
    await env.tick(175);
    assert.equal(env.document.body.querySelector(".qap-state-row"), row);
    search.value = "no match";
    search.dispatchEvent(new Event("input"));
    await env.tick(175);
    assert.equal(env.document.body.querySelector(".qap-count").textContent, "0 entities");
    search.value = "";
    search.dispatchEvent(new Event("input"));
    const summary = env.document.body.querySelector(".qap-state-summary");
    assert.equal(summary.attributes["aria-label"], `View details for ${id}`);
    summary.click();
    const modal = env.document.body.querySelector(".qap-state-modal");
    assert.equal(modal.dataset.entity, id);
    let moreInfo;
    env.homeAssistant.addEventListener("hass-more-info", (event) => {
      moreInfo = event.detail.entityId;
    });
    modal.querySelector(".qap-state-dialog-info").click();
    assert.equal(moreInfo, id);
    assert.equal(
      env.server.requests.length,
      0,
      "filtering and details never mutate profiles or invoke updates",
    );
    await clickAndFlush(modal.querySelector(".qap-state-dialog-favorite"));
    assert.equal(
      modal.querySelector(".qap-state-dialog-favorite").attributes["aria-pressed"],
      "true",
    );
    assert.equal(chip.attributes["aria-pressed"], "true");
    provider.publish({ [id]: { ...state, state: initial } });
    await env.tick(250);
    assert.equal(env.document.body.querySelector(".qap-count").textContent, "0 entities");
    assert.equal(modal.open, true, "details stay open when the entity leaves the filter");
    provider.publish({ [id]: { ...state, state: matching } });
    await env.tick(250);
    assert.equal(env.document.body.querySelector(".qap-count").textContent, "1 entity");
    if (filter === "low_battery") {
      provider.publish({
        [id]: {
          ...state,
          state: matching,
          attributes: { ...attributes, unit_of_measurement: "V" },
        },
      });
      await env.tick(250);
      assert.equal(env.document.body.querySelector(".qap-count").textContent, "0 entities");
      provider.publish({ [id]: { ...state, state: matching } });
      await env.tick(250);
    }
    provider.publish({});
    await env.tick(250);
    assert.equal(env.document.body.querySelector(".qap-count").textContent, "0 entities");
    assert.equal(modal.querySelector(".qap-state-dialog-state-copy").disabled, true);
    assert.equal(
      provider.listeners.size,
      1,
      "all smart filters share the existing states subscription",
    );
  });
}

test("entity details format timestamps, refresh independently of state and localize missing values", async () => {
  const env = environment();
  installLocaleFetch(env);
  const provider = statesProvider(env);
  const id = "sensor.temperature";
  const state = {
    entity_id: id,
    state: "21",
    attributes: { friendly_name: "Kitchen", last_changed: "An unrelated attribute" },
    last_changed: "2026-11-06T09:12:34.123456+00:00",
    last_updated: "2026-11-06T09:15:45.654321+00:00",
  };
  env.status.hass.states = { [id]: state };
  await openEntityStates(env);
  await clickAndFlush(env.document.body.querySelector(".qap-state-summary"));
  const modal = env.document.body.querySelector(".qap-state-modal");
  const rows = modal.querySelectorAll(".qap-state-dialog-state-line");
  assert.deepEqual(
    rows.map((row) => row.querySelector(".qap-state-dialog-state-label").textContent),
    ["State", "Last changed", "Last updated"],
  );
  const values = () => rows.map((row) => row.querySelector(".qap-state-dialog-value").textContent);
  const formattedTime = (value) =>
    new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
  assert.deepEqual(values(), [
    state.state,
    formattedTime(state.last_changed),
    formattedTime(state.last_updated),
  ]);
  assert.equal(modal.querySelectorAll(".qap-state-dialog-state-copy").length, 1);
  assert.deepEqual(attributesValue(modal.querySelector("qap-attributes-viewer")), state.attributes);

  const updated = { ...state, last_updated: "2026-11-06T09:16:00.000001+00:00" };
  provider.publish({ [id]: updated });
  await env.tick(250);
  assert.deepEqual(values(), [
    state.state,
    formattedTime(state.last_changed),
    formattedTime(updated.last_updated),
  ]);
  const changed = {
    ...updated,
    state: "22",
    last_changed: "2026-11-06T09:17:00.000002+00:00",
    last_updated: "2026-11-06T09:17:00.000002+00:00",
  };
  provider.publish({ [id]: changed });
  await env.tick(250);
  assert.deepEqual(values(), [
    changed.state,
    formattedTime(changed.last_changed),
    formattedTime(changed.last_updated),
  ]);

  provider.publish({ [id]: { ...state, last_changed: "invalid", last_updated: "invalid" } });
  await env.tick(250);
  assert.deepEqual(values(), [state.state, "Unavailable", "Unavailable"]);

  provider.publish({ [id]: { ...state, last_changed: null, last_updated: "" } });
  await env.tick(250);
  assert.deepEqual(values(), [state.state, "Unavailable", "Unavailable"]);
  await changeLanguage(env, "hr");
  assert.deepEqual(
    rows.map((row) => row.querySelector(".qap-state-dialog-state-label").textContent),
    ["Stanje", "Posljednja promjena", "Posljednje ažuriranje"],
  );
  assert.deepEqual(values(), [state.state, "Nedostupno", "Nedostupno"]);
  provider.publish({});
  await env.tick(250);
  assert.deepEqual(values(), ["Nedostupno", "Nedostupno", "Nedostupno"]);
});

const TIMESTAMP = "2026-11-06T09:12:34.123456+00:00";

async function openTimestampDetails(hass) {
  const env = environment();
  // The browser deliberately disagrees with HA so the test shows which wins.
  vm.runInContext(
    `Intl.DateTimeFormat = class extends Intl.DateTimeFormat {
      constructor(locale, options = {}) {
        super(locale ?? "en-US", { ...options, timeZone: options.timeZone ?? "America/New_York" });
      }
    };`,
    env.context,
  );
  Object.assign(env.status.hass, hass, {
    states: {
      "sensor.temperature": {
        entity_id: "sensor.temperature",
        state: "21",
        attributes: {},
        last_changed: TIMESTAMP,
        last_updated: TIMESTAMP,
      },
    },
  });
  await openEntityStates(env);
  await clickAndFlush(env.document.body.querySelector(".qap-state-summary"));
  const modal = env.document.body.querySelector(".qap-state-modal");
  const values = () =>
    modal.querySelectorAll(".qap-state-dialog-value").map((element) => element.textContent);
  return { env, values };
}

const haTime = (locale, options) =>
  new Date(TIMESTAMP).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
    ...options,
  });

for (const [name, hass, expected] of [
  [
    "HA language over the browser locale, in the browser time zone",
    { language: "hr", locale: { language: "hr", time_zone: "local" } },
    haTime("hr", { timeZone: "America/New_York" }),
  ],
  [
    "the server time zone when HA is set to use it",
    {
      language: "en",
      locale: { language: "en", time_zone: "server" },
      config: { time_zone: "Europe/Zagreb" },
    },
    haTime("en", { timeZone: "Europe/Zagreb" }),
  ],
  [
    "HA's 24-hour preference",
    { language: "en", locale: { language: "en", time_format: "24", time_zone: "local" } },
    haTime("en", { timeZone: "America/New_York", hour12: false }),
  ],
  [
    "the browser locale and time zone when HA provides no locale",
    {},
    haTime("en-US", { timeZone: "America/New_York" }),
  ],
]) {
  test(`entity timestamps use ${name}`, async () => {
    const { values } = await openTimestampDetails(hass);
    assert.deepEqual(values(), ["21", expected, expected]);
  });
}

test("entity timestamps follow HA language changes while details are open", async () => {
  const { env, values } = await openTimestampDetails({
    language: "en",
    locale: { language: "en", time_zone: "local" },
  });
  const english = haTime("en", { timeZone: "America/New_York" });
  assert.deepEqual(values(), ["21", english, english]);
  installLocaleFetch(env);
  env.status.hass.locale = { language: "hr", time_zone: "local" };
  await changeLanguage(env, "hr");
  const croatian = haTime("hr", { timeZone: "America/New_York" });
  assert.notEqual(croatian, english);
  assert.deepEqual(values(), ["21", croatian, croatian]);
});

test("Low Battery filters only changed entities during live batches and retains offscreen row bounds", async () => {
  const env = environment();
  const provider = statesProvider(env);
  let batteryReads = 0;
  const attributes = {
    unit_of_measurement: "%",
    get device_class() {
      batteryReads++;
      return "battery";
    },
  };
  env.status.hass.states = Object.fromEntries(
    Object.entries(largeStates(10000)).map(([id, state]) => [
      id,
      { ...state, state: "19", attributes },
    ]),
  );
  await openEntityStates(env);
  env.document.body
    .querySelector(".qap-state-tabs")
    .children.find((chip) => chip.dataset.domain === "low_battery")
    .click();
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "10000 entities");
  const firstRow = env.document.body.querySelector(".qap-state-row");
  batteryReads = 0;
  const id = "sensor.entity_09999";
  provider.publish({
    ...env.status.hass.states,
    [id]: { ...env.status.hass.states[id], state: "18" },
  });
  await env.tick(250);
  assert.equal(batteryReads, 1, "only the changed offscreen entity needs battery validation");
  assert.equal(env.document.body.querySelector(".qap-state-row"), firstRow);
  assert.ok(env.document.body.querySelectorAll(".qap-state-row").length < 50);
  provider.publish({
    ...env.status.hass.states,
    [id]: { ...env.status.hass.states[id], state: "20" },
  });
  await env.tick(250);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "9999 entities");
});

test("smart filters retain polling fallback when HA has no states context", async () => {
  const env = environment();
  const id = "update.application";
  env.status.hass.states = { [id]: { entity_id: id, state: "off" } };
  await openEntityStates(env);
  env.document.body
    .querySelector(".qap-state-tabs")
    .children.find((chip) => chip.dataset.domain === "updates")
    .click();
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "0 entities");
  env.status.hass.states[id] = { entity_id: id, state: "on" };
  await env.tick(3500);
  assert.equal(env.document.body.querySelector(".qap-state-row").dataset.entity, id);
  delete env.status.hass.states[id];
  await env.tick(3500);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "0 entities");
});

test("HA states context batches snapshots and filters only changed entities in a 10000-entity search", async () => {
  const env = environment();
  const provider = statesProvider(env);
  env.status.hass.states = largeStates(10000);
  let nameReads = 0;
  env.status.hass.formatEntityName = (state) => {
    nameReads++;
    return `Translated ${state.entity_id}`;
  };
  const search = await openEntityStates(env);
  search.value = "Translated";
  search.dispatchEvent(new Event("input"));
  await env.tick(175);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "10000 entities");
  assert.equal(
    [...env.timers.values()].some(({ delay }) => delay === 3500),
    false,
  );
  // Count list sorts separately from the tiny virtual-window index sorts.
  env.context.listSorts = 0;
  vm.runInContext(
    `const originalSort = Array.prototype.sort;
    Array.prototype.sort = function(...args) { if (this.length > 50) listSorts++; return originalSort.apply(this, args); };`,
    env.context,
  );
  nameReads = 0;
  for (let index = 0; index < 4; index++) {
    await env.tick(15000);
    await env.tick(3500);
  }
  assert.equal(nameReads, 0, "idle context does no entity formatting or filtering");
  const id = "sensor.entity_09999";
  let firstBatchTimer;
  for (let index = 0; index < 100; index++) {
    provider.publish({
      ...env.status.hass.states,
      [id]: { ...env.status.hass.states[id], state: String(index) },
    });
    if (index === 0) firstBatchTimer = [...env.timers].find(([, timer]) => timer.delay === 250)[0];
  }
  assert.equal(
    env.timers.has(firstBatchTimer),
    true,
    "new snapshots do not postpone the batch deadline",
  );
  assert.equal(nameReads, 0, "burst waits for one fixed batch window");
  assert.equal([...env.timers.values()].filter(({ delay }) => delay === 250).length, 1);
  await env.tick(250);
  assert.equal(nameReads, 1, "only the final offscreen state needs name matching");
  assert.equal(env.context.listSorts, 0, "state-only updates keep the sorted index");
  assert.ok(env.document.body.querySelectorAll(".qap-state-row").length < 50);
  await scrollStates(env, 1000000);
  assert.equal(env.document.body.querySelectorAll(".qap-state-value").at(-1).textContent, "99");
  env.enable(false);
  await flush();
  assert.equal(provider.listeners.size, 0);
});

test("HA context updates details, search membership, deletions and additions while preserving rows and scroll anchors", async () => {
  const env = environment();
  const provider = statesProvider(env);
  env.status.hass.states = largeStates(5000);
  const search = await openEntityStates(env);
  await scrollStates(env, 160 + 100 * 74);
  const list = env.document.body.querySelector(".qap-state-list");
  const row = list.children[4];
  const id = row.dataset.entity;
  row.querySelector("button").click();
  const modal = env.document.body.querySelector(".qap-state-modal");
  const nextStates = { ...env.status.hass.states };
  nextStates[id] = {
    ...nextStates[id],
    state: "new value",
    attributes: { friendly_name: "Kitchen", voltage: 12 },
  };
  provider.publish(nextStates);
  await env.tick(250);
  assert.equal(row.querySelector(".qap-state-value").textContent, "new value");
  assert.equal(modal.querySelector(".qap-state-dialog-value").textContent, "new value");
  assert.match(modal.querySelector("qap-attributes-viewer").value, /voltage: 12/);
  assert.equal(env.document.body.querySelector(".qap-body").scrollTop, 160 + 100 * 74);
  assert.equal(list.children[4], row);
  search.value = "Kitchen";
  search.dispatchEvent(new Event("input"));
  await env.tick(175);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "1 entity");
  provider.publish({
    ...nextStates,
    [id]: { ...nextStates[id], attributes: { friendly_name: "Bathroom" } },
  });
  await env.tick(250);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "0 entities");
  const replacement = {
    entity_id: "sensor.new",
    state: "on",
    attributes: { friendly_name: "Kitchen" },
  };
  const reconnected = { "sensor.new": replacement };
  await dispatchAndFlush(env.connection, new Event("ready"));
  provider.publish(reconnected);
  await env.tick(250);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "1 entity");
  assert.equal(modal.querySelector(".qap-state-dialog-value").textContent, "Unavailable");
  assert.equal(modal.querySelector(".qap-state-dialog-state-copy").disabled, true);
  assert.equal(env.document.body.querySelector(".qap-state-row").dataset.entity, "sensor.new");
});

test("HA states context invalidates translated name searches after registry and locale changes without state events", async () => {
  const env = environment();
  installLocaleFetch(env);
  statesProvider(env);
  env.status.hass.states = largeStates(5000);
  env.status.hass.entities = { name: "Kitchen" };
  env.status.hass.formatEntityName = () =>
    `${env.status.hass.entities.name} ${env.status.hass.language || "en"}`;
  const search = await openEntityStates(env);
  search.value = "Kitchen en";
  search.dispatchEvent(new Event("input"));
  await env.tick(175);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "5000 entities");
  env.status.hass.entities = { name: "Bathroom" };
  await env.tick(15000);
  await env.tick(250);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "0 entities");
  env.status.hass.entities = { name: "Kitchen" };
  await env.tick(15000);
  await env.tick(250);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "5000 entities");
  await changeLanguage(env, "hr");
  await env.tick(250);
  assert.equal(env.document.body.querySelectorAll(".qap-state-row").length, 0);
});

test("a states provider without a subscription disposer keeps the polling fallback", async () => {
  const env = environment();
  env.homeAssistant.addEventListener("context-request", (event) => {
    if (event.context === "states") event.callback(env.status.hass.states);
  });
  await openEntityStates(env);
  assert.equal([...env.timers.values()].filter(({ delay }) => delay === 3500).length, 1);
  env.status.hass.states = largeStates(5000);
  await env.tick(3500);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "5000 entities");
});

test("closing HA states context cancels pending batches and releases subscriptions, including late callbacks", async () => {
  const env = environment();
  const provider = statesProvider(env);
  env.status.hass.states = largeStates(5000);
  await openEntityStates(env);
  provider.publish({});
  assert.equal(provider.listeners.size, 1);
  assert.equal([...env.timers.values()].filter(({ delay }) => delay === 250).length, 1);
  env.document.body.querySelector(".qap-head-button").click();
  assert.equal(provider.listeners.size, 0);
  assert.equal(
    [...env.timers.values()].some(({ delay }) => [250, 3500].includes(delay)),
    false,
  );
  provider.lateCallback();
  await env.tick(250);
  assert.equal(env.document.body.querySelector(".qap-state-list"), null);
  env.document.body.querySelector(".qap-tile").click();
  assert.equal(provider.listeners.size, 1);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "0 entities");
  env.enable(false);
  await flush();
  assert.equal(provider.listeners.size, 0);
  assert.equal(env.timers.size, 0);
});

test("repeated launcher and entity-list cycles release mounted resources", async () => {
  const env = environment();
  const provider = statesProvider(env);
  env.status.hass.states = largeStates(100);
  await openEntityStates(env);
  let closedResources;
  for (let cycle = 0; cycle < 20; cycle++) {
    assert.equal(provider.listeners.size, 1);
    assert.equal(env.resizeObservers.size, 1);
    provider.publish({ ...env.status.hass.states });
    await clickAndFlush(env.document.body.querySelector(".qap-head-button"));
    assert.equal(provider.listeners.size, 0);
    assert.equal(env.resizeObservers.size, 0);
    assert.equal(
      [...env.timers.values()].some(({ delay }) => [16, 250, 3500].includes(delay)),
      false,
    );
    await clickAndFlush(env.document.body.querySelector(".qap-head-button"));
    assert.equal(env.document.body.querySelector("qap-dialog"), null);
    const resources = {
      timers: env.timers.size,
      observers: env.mutationObservers.size,
      profiles: env.server.listeners.size,
    };
    closedResources ??= resources;
    assert.deepEqual(
      resources,
      closedResources,
      `closed resource counts stay bounded after cycle ${cycle + 1}`,
    );
    await clickAndFlush(env.fab());
    await clickAndFlush(env.document.body.querySelector(".qap-tile"));
  }
  env.enable(false);
  await flush();
  assert.equal(provider.listeners.size, 0);
  assert.equal(env.resizeObservers.size, 0);
  assert.equal(env.mutationObservers.size, 0);
  assert.equal(env.server.listeners.size, 0);
  assert.equal(env.timers.size, 0);
});

test("Entity states refresh keeps unchanged rows and buttons mounted, updates changed states, and reconciles membership", async () => {
  const env = environment();
  nativeComponents(env);
  env.status.hass.states = {
    "sensor.kitchen": {
      entity_id: "sensor.kitchen",
      state: "21",
      attributes: { friendly_name: "Kitchen", unit_of_measurement: "°C" },
    },
    "light.bedroom": { entity_id: "light.bedroom", state: "off", attributes: {} },
  };
  await openEntityStates(env);
  const list = env.document.body.querySelector(".qap-state-list");
  const kitchen = list
    .querySelectorAll(".qap-state-row")
    .find((row) => row.dataset.entity === "sensor.kitchen");
  const bedroom = list
    .querySelectorAll(".qap-state-row")
    .find((row) => row.dataset.entity === "light.bedroom");
  const summary = kitchen.querySelector("button");
  const icon = kitchen.querySelector("qap-state-icon");
  assert.ok(icon);
  const originalState = env.status.hass.states["sensor.kitchen"];
  assert.equal(icon.stateObj, originalState);

  // This interval used to discard and re-create the entire list.
  let moves = 0;
  const originalInsertBefore = list.insertBefore.bind(list);
  list.insertBefore = (...args) => {
    moves++;
    return originalInsertBefore(...args);
  };
  await env.tick(3500);
  assert.equal(moves, 0);
  assert.equal(list.querySelectorAll(".qap-state-row")[1], kitchen);
  assert.equal(kitchen.querySelector("button"), summary);
  assert.equal(kitchen.querySelector("qap-state-icon"), icon);

  env.status.hass.states["sensor.kitchen"] = {
    entity_id: "sensor.kitchen",
    state: "22",
    attributes: { friendly_name: "Kitchen air", unit_of_measurement: "°C" },
  };
  await env.tick(3500);
  assert.equal(list.querySelectorAll(".qap-state-row")[1], kitchen);
  assert.equal(list.querySelectorAll(".qap-state-row")[0], bedroom);
  assert.equal(kitchen.querySelector("button"), summary);
  assert.equal(kitchen.querySelector(".qap-state-name").textContent, "Kitchen air");
  assert.equal(kitchen.querySelector(".qap-state-value").textContent, "22 °C");
  assert.equal(icon.stateObj, env.status.hass.states["sensor.kitchen"]);

  env.status.hass.states["binary_sensor.door"] = {
    entity_id: "binary_sensor.door",
    state: "on",
    attributes: {},
  };
  delete env.status.hass.states["light.bedroom"];
  await env.tick(3500);
  assert.deepEqual(
    list.querySelectorAll(".qap-state-row").map((row) => row.dataset.entity),
    ["binary_sensor.door", "sensor.kitchen"],
  );
  assert.equal(list.querySelectorAll(".qap-state-row")[1], kitchen);
  assert.equal(kitchen.querySelector("button"), summary);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "2 entities");
});

test("Entity states empty results remain mounted across unchanged refreshes", async () => {
  const env = environment();
  await openEntityStates(env);
  const empty = env.document.body.querySelector(".qap-state-empty");
  assert.ok(empty);
  await env.tick(3500);
  assert.equal(env.document.body.querySelector(".qap-state-empty"), empty);
  env.status.hass.states["sensor.kitchen"] = {
    entity_id: "sensor.kitchen",
    state: "21",
    attributes: {},
  };
  await env.tick(3500);
  assert.equal(env.document.body.querySelector(".qap-state-empty"), null);
  delete env.status.hass.states["sensor.kitchen"];
  await env.tick(3500);
  assert.ok(env.document.body.querySelector(".qap-state-empty"));
});

test("Entity states prefer HA names and state formatting, avoid duplicate units, and preserve raw inspection data", async () => {
  const env = environment();
  const state = {
    entity_id: "sensor.energy",
    state: "1234.50",
    attributes: {
      friendly_name: "Raw energy name",
      unit_of_measurement: "kWh",
      nested: { values: [1, false, null, "on"] },
    },
  };
  env.status.hass.states = { [state.entity_id]: state };
  env.status.hass.locale = { number_format: "de-DE" };
  const formattedStates = [];
  env.status.hass.formatEntityName = function (entity) {
    assert.equal(this, env.status.hass);
    assert.equal(entity, state);
    return "Kitchen energy";
  };
  env.status.hass.formatEntityState = function (entity) {
    assert.equal(this, env.status.hass);
    formattedStates.push(entity);
    return `${new Intl.NumberFormat(this.locale.number_format).format(Number(entity.state))} kWh`;
  };
  const copied = [];
  env.window.isSecureContext = true;
  env.context.navigator.clipboard = { writeText: async (value) => copied.push(value) };
  await openEntityStates(env);
  const row = env.document.body.querySelector(".qap-state-row");
  assert.deepEqual(
    row.querySelector(".qap-state-info").children.map((item) => item.textContent),
    ["Kitchen energy", state.entity_id],
  );
  assert.equal(row.querySelector(".qap-state-value").textContent, "1.234,5 kWh");
  const summary = row.querySelector(".qap-state-summary");
  await clickAndFlush(summary);
  const modal = env.document.body.querySelector(".qap-state-modal");
  assert.equal(modal.querySelector(".qap-state-dialog-id-link").textContent, state.entity_id);
  assert.equal(
    modal.querySelector(".qap-state-dialog-name").textContent,
    state.attributes.friendly_name,
  );
  assert.equal(modal.querySelector(".qap-state-dialog-value").textContent, "1.234,5 kWh");
  assert.deepEqual(attributesValue(modal.querySelector("qap-attributes-viewer")), state.attributes);
  modal.querySelector(".qap-state-dialog-state-copy").click();
  await clickAndFlush(modal.querySelector(".qap-state-dialog-id-copy"));
  assert.deepEqual(copied, ["1234.50", "sensor.energy"]);
  assert.ok(formattedStates.length > 0);
  assert.ok(formattedStates.every((entity) => entity === state));

  // Formatting preferences can change without changing the entity or language.
  env.status.hass.locale.number_format = "en-US";
  await env.tick(3500);
  assert.equal(env.document.body.querySelector(".qap-state-row"), row);
  assert.equal(row.querySelector(".qap-state-summary"), summary);
  assert.equal(env.document.body.querySelector(".qap-state-modal"), modal);
  assert.equal(row.querySelector(".qap-state-value").textContent, "1,234.5 kWh");
  assert.equal(modal.querySelector(".qap-state-dialog-value").textContent, "1,234.5 kWh");
  state.state = "0002.00";
  await clickAndFlush(modal.querySelector(".qap-state-dialog-state-copy"));
  assert.equal(copied.at(-1), "0002.00");
});

test("Entity states handle missing friendly names, unusable HA names, and unavailable or unknown states", async () => {
  const env = environment();
  const names = [undefined, null, "", "   ", false, {}, "sensor.fallback_6"];
  env.status.hass.states = Object.fromEntries(
    names.map((name, index) => {
      const entity_id = `sensor.fallback_${index}`;
      return [
        entity_id,
        {
          entity_id,
          state: index % 2 ? "unknown" : "unavailable",
          attributes: index ? {} : { friendly_name: "Fallback name" },
        },
      ];
    }),
  );
  const nativeId = "sensor.native";
  env.status.hass.states[nativeId] = { entity_id: nativeId, state: "on" };
  env.status.hass.formatEntityName = (state) =>
    state.entity_id === nativeId
      ? "Native name without attributes"
      : names[Number(state.entity_id.at(-1))];
  env.status.hass.formatEntityState = (state) =>
    ({ unavailable: "Nedostupno", unknown: "Nepoznato", on: "Uključeno" })[state.state];
  await openEntityStates(env);
  const rows = () => env.document.body.querySelectorAll(".qap-state-row");
  for (const row of rows()) {
    const state = env.status.hass.states[row.dataset.entity];
    const expected =
      state.entity_id === nativeId
        ? "Native name without attributes"
        : state.attributes.friendly_name || state.entity_id;
    assert.equal(row.querySelector(".qap-state-name").textContent, expected);
    assert.equal(row.querySelector(".qap-state-id").hidden, expected === state.entity_id);
    assert.equal(
      row.querySelector(".qap-state-value").textContent,
      { unavailable: "Nedostupno", unknown: "Nepoznato", on: "Uključeno" }[state.state],
    );
  }
  delete env.status.hass.formatEntityName;
  delete env.status.hass.formatEntityState;
  await env.tick(3500);
  for (const row of rows()) {
    const state = env.status.hass.states[row.dataset.entity];
    assert.equal(
      row.querySelector(".qap-state-name").textContent,
      state.attributes?.friendly_name || state.entity_id,
    );
    assert.equal(row.querySelector(".qap-state-value").textContent, state.state);
  }
  const unnamed = rows().find(
    (row) =>
      row.dataset.entity !== nativeId &&
      !env.status.hass.states[row.dataset.entity].attributes?.friendly_name,
  );
  env.status.hass.states[unnamed.dataset.entity].attributes.friendly_name = "Now named";
  await env.tick(3500);
  assert.equal(unnamed.querySelector(".qap-state-id").hidden, false);
});

test("Entity states cache formatted search names for large collections and refresh changed names", async () => {
  const env = environment();
  env.status.hass.states = largeStates(10000);
  let nameCalls = 0;
  env.status.hass.formatEntityName = function (state) {
    nameCalls++;
    return `${this.entities?.prefix || "Displayed"} ${state.attributes.friendly_name}`;
  };
  const search = await openEntityStates(env);
  const searchFor = async (value) => {
    search.value = value;
    search.dispatchEvent(new Event("input"));
    await env.tick(175);
  };
  const rows = () => env.document.body.querySelectorAll(".qap-state-row");
  const count = () => env.document.body.querySelector(".qap-count").textContent;
  assert.ok(nameCalls < 100, "opening the virtual list formats only mounted names");
  await searchFor("Displayed Entity 9999");
  assert.equal(rows()[0].dataset.entity, "sensor.entity_09999");
  const firstSearchCalls = nameCalls;
  await searchFor("Displayed Entity 9998");
  assert.equal(rows()[0].dataset.entity, "sensor.entity_09998");
  assert.ok(
    nameCalls - firstSearchCalls < 100,
    "repeated searches reuse off-screen formatted names",
  );
  const retained = rows()[0];
  await env.tick(3500);
  assert.equal(rows()[0], retained);
  assert.ok(nameCalls - firstSearchCalls < 100, "unchanged refreshes reuse the search cache");
  env.status.hass.states[retained.dataset.entity].attributes.friendly_name = "Renamed";
  await env.tick(3500);
  assert.equal(count(), "0 entities");
  await searchFor("Displayed Renamed");
  assert.equal(rows()[0].dataset.entity, retained.dataset.entity);
  // Registry updates can change formatted names without replacing a state.
  env.status.hass.entities = { prefix: "Registry" };
  await env.tick(3500);
  assert.equal(count(), "0 entities");
  await searchFor("Registry Renamed");
  assert.equal(rows()[0].dataset.entity, retained.dataset.entity);
  await searchFor("sensor.entity_09998");
  assert.equal(rows()[0].dataset.entity, retained.dataset.entity);
  await searchFor("Renamed");
  assert.equal(rows()[0].dataset.entity, retained.dataset.entity);
  assert.ok(rows().length < 50);
});
