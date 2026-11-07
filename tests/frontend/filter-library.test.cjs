// Device entity filters, reuse picker, defaults, presets and saved filters.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  installLocaleFetch,
  changeLanguage,
  flush,
  clickAndFlush,
  dispatchAndFlush,
  clone,
  filterDefinitions,
  filterField,
  filterAction,
  editNewFilter,
  setFilterField,
  ProfileServer,
  savedProfile,
  environment,
  openEntityStates,
  statesProvider,
  deviceFixture,
  openDevices,
  installDeviceRegistries,
  nativeComponents,
  buttons,
  iconColorInput,
  navigationEnvironment,
  scrollStates,
  openShortcutsSettings,
  changeValidationControl,
  profileMenuIn,
  shortcutAction,
} = require("./harness.cjs");

test("device matching entity controls preserve native tab order and cross unmounted rows in both directions", async () => {
  const env = environment();
  const devices = Array.from({ length: 100 }, (_, index) =>
    deviceFixture(`device_${String(index).padStart(3, "0")}`, {
      name_by_user: null,
      name: `Device ${String(index).padStart(3, "0")}`,
    }),
  );
  installDeviceRegistries(env, devices);
  env.status.hass.entities = Object.fromEntries(
    devices.map(({ id }) => [`sensor.${id}`, { device_id: id }]),
  );
  env.status.hass.states = Object.fromEntries(
    devices.map(({ id }) => [
      `sensor.${id}`,
      { entity_id: `sensor.${id}`, state: "unknown", attributes: {} },
    ]),
  );
  await openDevices(env);
  await clickAndFlush(
    env.document.body
      .querySelectorAll(".qap-state-tab")
      .find((chip) => chip.dataset.domain === "entity_issues"),
  );
  await env.tick(250);
  const list = env.document.body.querySelector(".qap-state-list");
  const first = list.children[0];
  const summary = first.querySelector(".qap-state-summary");
  const expand = first.querySelector(".qap-matching-count");
  const tab = (control, shiftKey = false) => {
    control.focus();
    const event = Object.assign(new Event("keydown", { cancelable: true }), {
      key: "Tab",
      shiftKey,
    });
    control.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(expand.hidden, false);
  assert.equal(expand.disabled, false);
  assert.equal(tab(summary), false, "Tab can reach the expansion button");
  assert.equal(tab(expand, true), false, "Shift+Tab can return to the summary");
  assert.equal(tab(expand), false, "Tab crosses mounted rows natively");
  assert.equal(tab(list.children[1].querySelector(".qap-state-summary"), true), false);
  await clickAndFlush(expand);
  assert.equal(expand.attributes["aria-expanded"], "true");
  assert.equal(tab(summary), false, "expanded content preserves the row's tab order");
  await scrollStates(env, 160 + 50 * 74);
  assert.equal(
    list.children.some((row) => row.dataset.device === "device_001"),
    false,
  );
  assert.equal(tab(summary), false, "an unmounted next row must not skip the expansion button");
  assert.equal(tab(expand), true);
  assert.equal(
    env.document.activeElement,
    list.children
      .find((row) => row.dataset.device === "device_001")
      .querySelector(".qap-state-summary"),
  );
  await scrollStates(env, 160 + 50 * 74);
  assert.equal(first.isConnected, false);
  const nextSummary = env.document.activeElement;
  assert.equal(tab(nextSummary, true), true);
  const restored = list.children.find((row) => row.dataset.device === "device_000");
  assert.equal(
    env.document.activeElement,
    restored.querySelector(".qap-matching-count"),
    "reverse boundary crossing lands on the previous row's last control",
  );
  assert.equal(
    tab(restored.querySelector(".qap-state-summary"), true),
    false,
    "Shift+Tab can leave the first row",
  );
});

test("device entity filters batch affected devices, keep explanations collapsed, reuse rows and reset expansion on filter switch", async () => {
  const env = environment();
  const provider = statesProvider(env);
  let registryCallback;
  env.homeAssistant.addEventListener("context-request", (event) => {
    if (event.context !== "entities" || event.contextTarget === env.document.body) return;
    registryCallback = event.callback;
    event.callback(env.status.hass.entities, () => {});
  });
  installDeviceRegistries(env, [
    deviceFixture("device_a"),
    deviceFixture("device_b", { name_by_user: "Garage" }),
    deviceFixture("empty"),
  ]);
  env.status.hass.entities = {
    "sensor.a": { device_id: "device_a" },
    "sensor.b": { device_id: "device_b" },
    "sensor.missing": { device_id: "empty" },
  };
  let untouchedReads = 0;
  const untouched = { entity_id: "sensor.b", attributes: {} };
  Object.defineProperty(untouched, "state", {
    enumerable: true,
    get: () => {
      untouchedReads++;
      return "on";
    },
  });
  env.status.hass.states = {
    "sensor.a": { entity_id: "sensor.a", state: "unknown", attributes: {} },
    "sensor.b": untouched,
  };
  await openDevices(env);
  const select = async (id) =>
    clickAndFlush(
      env.document.body
        .querySelector(".qap-state-tabs")
        .children.find((chip) => chip.dataset.domain === id),
    );
  await select("entity_issues");
  await env.tick(250);
  let row = env.document.body.querySelector(".qap-state-row");
  assert.equal(row.dataset.device, "device_a");
  const count = row.querySelector(".qap-matching-count");
  const details = row.querySelector(".qap-matching-entities");
  assert.equal(count.textContent, "1 matching entity");
  assert.equal(count.attributes["aria-expanded"], "false");
  assert.equal(details.children.length, 0);
  await clickAndFlush(count);
  assert.equal(details.children.length, 1);
  assert.equal(details.querySelector("strong").textContent, "sensor.a");
  assert.equal(details.querySelector("span").textContent, "unknown");
  untouchedReads = 0;
  provider.publish({
    ...env.status.hass.states,
    "sensor.a": { entity_id: "sensor.a", state: "unavailable", attributes: {} },
  });
  provider.publish({
    ...env.status.hass.states,
    "sensor.a": { entity_id: "sensor.a", state: "unknown", attributes: {} },
  });
  assert.equal(untouchedReads, 0);
  await env.tick(250);
  assert.equal(untouchedReads, 0, "unchanged device's entities are not evaluated");
  assert.equal(env.document.body.querySelector(".qap-state-row"), row);
  assert.equal(count.attributes["aria-expanded"], "true");
  await clickAndFlush(count);
  assert.equal(details.children.length, 0);
  await clickAndFlush(count);
  await select("all");
  await select("entity_issues");
  row = env.document.body.querySelector(".qap-state-row");
  assert.equal(row.querySelector(".qap-matching-count").attributes["aria-expanded"], "false");
  assert.equal(row.querySelector(".qap-matching-entities").children.length, 0);
  env.status.hass.entities = {
    ...env.status.hass.entities,
    "sensor.b": { device_id: "device_a" },
    "sensor.a": { device_id: "device_b" },
  };
  await env.tick(15000);
  await env.tick(250);
  assert.equal(env.document.body.querySelector(".qap-state-row").dataset.device, "device_b");
  env.status.hass.entities["sensor.a"].device_id = "device_a";
  registryCallback(env.status.hass.entities, () => {});
  await env.tick(250);
  assert.equal(
    env.document.body.querySelector(".qap-state-row").dataset.device,
    "device_a",
    "in-place registry notifications rebuild relationship indices",
  );
});

for (const kind of ["states", "devices"]) {
  test(`reuse picker copies ${kind} filters and preserves drafts through Back/Forward`, async () => {
    const env = navigationEnvironment();
    installDeviceRegistries(env);
    env.status.hass.entities = {};
    const definitions = await filterDefinitions(env);
    const source = {
      id: "shared",
      name: "Shared filter",
      icon: "mdi:thermometer",
      hidden: true,
      condition: definitions.group([
        definitions.rule(kind === "devices" ? "name" : "state", "equals", "unknown"),
      ]),
    };
    savedProfile(env).filters = clone(definitions.profileFilters());
    savedProfile(env).filters[kind].push(clone(source));
    const other = clone(savedProfile(env));
    Object.assign(other, {
      id: "other",
      name: "Other profile",
      icon: "mdi:cellphone",
      color: "teal",
    });
    const otherKind = kind === "states" ? "devices" : "states";
    other.filters[otherKind].push({
      ...clone(source),
      id: "other-kind",
      name: "Other kind",
      condition: clone(
        definitions.group([
          definitions.rule(otherKind === "devices" ? "name" : "state", "equals", "unknown"),
        ]),
      ),
    });
    env.server.data("test-user").profiles.push(other);
    await (kind === "devices" ? openDevices(env) : openEntityStates(env));
    const panel = await editNewFilter(env, "Unsaved draft");
    const name = filterField(panel, "Filter name");
    const trigger = panel.querySelector(".qap-filter-reuse");
    const templateField = panel
      .querySelectorAll(".qap-field")
      .find((field) => field.querySelector("label")?.textContent === "Start from a template");
    assert.ok(templateField.contains(trigger));
    assert.equal(templateField.querySelector("select, qap-select"), null);
    await env.settle();
    const parentIndex = env.historyIndex();
    await clickAndFlush(trigger);
    await env.settle();
    const picker = () => env.document.body.querySelector(".qap-filter-reuse-modal");
    const finishClosing = (active) => {};
    assert.equal(picker().localName, "qap-dialog");
    assert.deepEqual(
      picker()
        .querySelectorAll("h3")
        .map((heading) => heading.textContent),
      [`${savedProfile(env).name} profile filters`, "Other profile profile filters"],
    );
    assert.ok(
      picker()
        .querySelectorAll(".qap-filter-reuse-profile")
        .every((section) => section.localName === "details" && !section.open),
    );
    assert.ok(
      picker()
        .querySelectorAll(".qap-filter-reuse-heading")
        .every((heading) => heading.localName === "summary"),
    );
    const profileIcon = picker()
      .querySelectorAll(".qap-filter-reuse-heading")[1]
      .querySelector("qap-icon");
    assert.equal(profileIcon.attributes.icon, "mdi:cellphone");
    assert.equal(profileIcon.style.color, "var(--teal-color)");
    const option = picker().querySelector(".qap-filter-reuse-option");
    assert.equal(option.classList.contains("qap-linkish"), false);
    assert.equal(option.attributes.variant, "neutral");
    assert.ok(
      picker()
        .querySelectorAll(".qap-filter-reuse-option")
        .some((button) => button.textContent === "Shared filter"),
    );
    assert.equal(
      picker()
        .querySelectorAll(".qap-filter-reuse-option")
        .some((button) => button.textContent === "Other kind"),
      false,
    );
    assert.equal(env.historyIndex(), parentIndex + 1);
    const active = picker();
    await env.back();
    finishClosing(active);
    assert.equal(picker(), null);
    assert.equal(filterField(panel, "Filter name"), name);
    assert.equal(name.value, "Unsaved draft");
    assert.equal(env.document.body.querySelector(".qap-discard-changes-confirmation"), null);
    await env.forward();
    assert.equal(picker().open, true);
    const selected = picker();
    await clickAndFlush(
      selected
        .querySelectorAll(".qap-filter-reuse-profile")[1]
        .querySelectorAll(".qap-filter-reuse-option")
        .find((button) => button.textContent === "Shared filter"),
    );
    finishClosing(selected);
    await env.settle();
    assert.equal(name.value, "Shared filter (Copy)");
    assert.equal(env.historyIndex(), parentIndex);
    assert.equal(env.server.requests.length, 0);
    await clickAndFlush(buttons(panel).find((button) => button.textContent === "Save"));
    const saved = savedProfile(env).filters[kind].find(
      (filter) => filter.name === "Shared filter (Copy)",
    );
    assert.ok(saved);
    assert.notEqual(saved.id, source.id);
    assert.equal(saved.hidden, false);
    assert.equal(saved.icon, source.icon);
    assert.deepEqual(saved.condition, clone(source.condition));
    assert.deepEqual(env.server.data("test-user").profiles[1], other);
  });
}

test("reuse picker explains an empty collection and closes with its parent", async () => {
  const env = environment();
  const definitions = await filterDefinitions(env);
  savedProfile(env).filters = clone(definitions.profileFilters());
  savedProfile(env).filters.states = savedProfile(env).filters.states.filter((filter) =>
    definitions.SYSTEM_FILTERS.includes(filter.id),
  );
  env.status.hass.entities = {};
  env.status.hass.devices = {};
  env.status.hass.areas = {};
  await openEntityStates(env);
  const panel = await editNewFilter(env, "Draft");
  await clickAndFlush(panel.querySelector(".qap-filter-reuse"));
  const picker = env.document.body.querySelector(".qap-filter-reuse-modal");
  assert.equal(
    picker.querySelector(".qap-muted").textContent,
    "No existing filters of this type in your profiles.",
  );
  assert.equal(picker.querySelectorAll(".qap-filter-reuse-option").length, 0);
  env.enable(false);
  await flush();
  assert.equal(picker.isConnected, false);
});

test("filter editor uses mobile Back/Forward and the existing unsaved draft confirmation", async () => {
  const env = navigationEnvironment();
  env.status.hass.entities = {};
  env.status.hass.devices = {};
  env.status.hass.areas = {};
  await openEntityStates(env);
  env.resize(320);
  const panel = await editNewFilter(env, "Unsaved", "unknown");
  await env.settle();
  const index = env.historyIndex();
  await env.back();
  assert.ok(env.document.body.querySelector(".qap-discard-changes-confirmation"));
  assert.equal(filterField(panel, "Filter name").value, "Unsaved");
  await clickAndFlush(
    buttons(env.document.body.querySelector(".qap-discard-changes-confirmation")).find(
      (button) => button.textContent === "Cancel",
    ),
  );
  assert.equal(env.historyIndex(), index);
  await env.back();
  await clickAndFlush(
    buttons(env.document.body.querySelector(".qap-discard-changes-confirmation")).find(
      (button) => button.textContent === "Discard",
    ),
  );
  await env.settle();
  assert.equal(
    panel.querySelector(".qap-filter-list").querySelectorAll(".qap-edit-item").length,
    6,
  );
  await env.forward();
  assert.equal(filterField(panel, "Filter name").value, "");
  assert.equal(env.server.requests.length, 0);
});

for (const kind of ["states", "devices"]) {
  test(`${kind} defaults persist, reopen independently and recover from hidden/deleted defaults`, async () => {
    const env = environment();
    installDeviceRegistries(env);
    env.status.hass.entities = {};
    savedProfile(env).favorites = ["sensor.favorite"];
    savedProfile(env).device_favorites = ["device_a"];
    const definitions = await filterDefinitions(env);
    savedProfile(env).filters = clone(definitions.profileFilters());
    const id = kind === "states" ? "unknown" : "assigned";
    const name = kind === "states" ? "Unknown" : "With area";
    await (kind === "devices" ? openDevices(env) : openEntityStates(env));
    const selected = () =>
      env.document.body
        .querySelector(".qap-state-tabs")
        .children.find((chip) => chip.attributes["aria-pressed"] === "true")?.dataset.domain;
    assert.equal(selected(), "favorites");
    await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
    let panel = env.document.body.querySelector(".qap-filter-panel");
    env.server.failWrites = true;
    await filterAction(env, panel, name, "default");
    assert.equal(savedProfile(env).filters.defaults, undefined);
    assert.match(panel.querySelector(".qap-error").textContent, /Could not save/);
    env.server.failWrites = false;
    await filterAction(env, panel, name, "default");
    assert.deepEqual(savedProfile(env).filters.defaults, { [kind]: id });
    assert.equal(selected(), "favorites", "setting a default applies on the next opening");
    const row = panel.querySelectorAll(".qap-edit-item").find((item) => item.dataset.id === id);
    assert.equal(row.querySelector("small").textContent, "Default");
    await clickAndFlush(row.querySelector(".qap-filter-overflow"));
    assert.equal(profileMenuIn(env).querySelector(".qap-default-filter").textContent, "Default");
    await clickAndFlush(profileMenuIn(env).querySelector(".qap-default-filter"));
    await clickAndFlush(env.document.body.querySelector(".qap-filter-close"));
    const reopen = async () => {
      await clickAndFlush(buttons(env.document.body).find((item) => item.title === "Back"));
      const label = kind === "devices" ? "Device Explorer" : "Entity Explorer";
      await clickAndFlush(
        env.document.body
          .querySelectorAll(".qap-tile")
          .find((tile) => tile.querySelector(".qap-tile-name").textContent === label),
      );
    };
    await reopen();
    assert.equal(selected(), id);
    await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
    panel = env.document.body.querySelector(".qap-filter-panel");
    await filterAction(env, panel, name, "visibility");
    assert.equal(savedProfile(env).filters.defaults[kind], "all");
    assert.equal(selected(), "all");
    await filterAction(env, panel, name, "default");
    assert.equal(savedProfile(env).filters[kind].find((item) => item.id === id).hidden, false);
    assert.equal(savedProfile(env).filters.defaults[kind], id);
    await filterAction(env, panel, name, "delete");
    await clickAndFlush(
      env.document.body
        .querySelector(".qap-delete-filter-confirmation")
        .querySelector(".qap-button-danger"),
    );
    assert.equal(savedProfile(env).filters.defaults[kind], "all");
    await clickAndFlush(env.document.body.querySelector(".qap-filter-close"));
    await reopen();
    assert.equal(selected(), "all");
    const otherKind = kind === "states" ? "devices" : "states";
    assert.equal(savedProfile(env).filters.defaults[otherKind], undefined);

    const server = env.server;
    const reloaded = environment("http://homeassistant.local:8123", server, { fresh: true });
    reloaded.storage.set(
      "quick_access_v1:test-instance:test-user:active-profile",
      JSON.stringify("test-profile"),
    );
    installDeviceRegistries(reloaded);
    reloaded.status.hass.entities = {};
    await (kind === "devices" ? openDevices(reloaded) : openEntityStates(reloaded));
    const active = reloaded.document.body
      .querySelector(".qap-state-tabs")
      .children.find((chip) => chip.attributes["aria-pressed"] === "true");
    assert.equal(
      active.dataset.domain,
      "all",
      "an explicit default overrides favorites after reload",
    );
  });
}

test("filter dropdowns restore after mobile Back/Forward, including reopening the filter modal", async () => {
  const env = navigationEnvironment();
  env.status.hass.entities = {};
  env.status.hass.devices = {};
  env.status.hass.areas = {};
  await openEntityStates(env);
  env.resize(320);
  await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
  const panel = env.document.body.querySelector(".qap-filter-panel");
  await clickAndFlush(panel.querySelector(".qap-filter-overflow"));
  await env.settle();
  assert.ok(profileMenuIn(env));
  await env.back();
  assert.equal(profileMenuIn(env), null);
  assert.ok(env.document.body.querySelector(".qap-filter-modal"));
  await env.back();
  assert.equal(env.document.body.querySelector(".qap-filter-modal"), null);
  await env.forward();
  assert.ok(env.document.body.querySelector(".qap-filter-modal"));
  assert.equal(profileMenuIn(env), null);
  await env.forward();
  assert.ok(profileMenuIn(env));
  await clickAndFlush(profileMenuIn(env).querySelector(".qap-visibility-filter"));
  assert.equal(savedProfile(env).filters.states[0].hidden, true);
});

test("duplicating filters respects the filter limit and preserves the copy draft after a rejected save", async () => {
  const env = environment();
  env.status.hass.entities = {};
  env.status.hass.devices = {};
  env.status.hass.areas = {};
  const definitions = await filterDefinitions(env);
  const filters = clone(definitions.profileFilters());
  while (filters.states.length < definitions.FILTER_LIMIT + definitions.SYSTEM_FILTERS.length) {
    const index = filters.states.length;
    filters.states.push({
      id: `extra_${index}`,
      name: `Extra ${index}`,
      hidden: false,
      condition: clone(filters.states[2].condition),
    });
  }
  savedProfile(env).filters = filters;
  const original = clone(filters.states);
  await openEntityStates(env);
  await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
  const panel = env.document.body.querySelector(".qap-filter-panel");
  await filterAction(env, panel, "Unavailable", "duplicate");
  await clickAndFlush(buttons(panel).find((item) => item.textContent === "Save"));
  assert.equal(filterField(panel, "Filter name").value, "Unavailable (Copy)");
  assert.match(panel.querySelector(".qap-error").textContent, /up to 10 filters/);
  assert.deepEqual(savedProfile(env).filters.states, original);
  assert.equal(env.server.requests.length, 0);
});

test("concurrent filter saves retain the losing draft and revision instead of overwriting remote filters", async () => {
  const server = new ProfileServer();
  const first = environment("http://homeassistant.local:8123", server);
  const second = environment("http://homeassistant.local:8123", server, { fresh: true });
  second.storage.set(
    "quick_access_v1:test-instance:test-user:active-profile",
    JSON.stringify("test-profile"),
  );
  for (const env of [first, second]) {
    env.status.hass.entities = {};
    env.status.hass.devices = {};
    env.status.hass.areas = {};
  }
  await openEntityStates(first);
  await openEntityStates(second);
  const firstPanel = await editNewFilter(first, "First", "unknown");
  const secondPanel = await editNewFilter(second, "Second", "unavailable");
  await clickAndFlush(buttons(firstPanel).find((button) => button.textContent === "Save"));
  await clickAndFlush(buttons(secondPanel).find((button) => button.textContent === "Save"));
  assert.equal(filterField(secondPanel, "Filter name").value, "Second");
  assert.match(second.window.quickAccessDebug().profileError, /changed|another|conflict/i);
  assert.equal(savedProfile(first).filters.states.at(-1).name, "First");
  assert.equal(
    savedProfile(first).filters.states.some((filter) => filter.name === "Second"),
    false,
  );
});

for (const [kind, id, canonical, translated] of [
  ["states", "unavailable", "Unavailable", "Nedostupno"],
  ["devices", "assigned", "With area", "S područjem"],
]) {
  test(`localized ${kind} presets keep canonical names until explicitly renamed`, async () => {
    const env = environment();
    installLocaleFetch(env);
    installDeviceRegistries(env);
    env.status.hass.entities = {};
    await (kind === "devices" ? openDevices(env) : openEntityStates(env));
    await changeLanguage(env, "hr");
    const manage = async (label) => {
      await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
      const panel = env.document.body.querySelector(".qap-filter-panel");
      await filterAction(env, panel, label, "edit");
      return panel;
    };
    let panel = await manage(translated);
    assert.equal(filterField(panel, "Naziv filtra").value, translated);
    await clickAndFlush(buttons(panel).find((button) => button.textContent === "Spremi"));
    assert.equal(
      savedProfile(env).filters[kind].find((filter) => filter.id === id).name,
      canonical,
    );
    const chip = () =>
      env.document.body
        .querySelector(".qap-state-tabs")
        .children.find((item) => item.dataset.domain === id);
    await changeLanguage(env, "en");
    assert.equal(chip().textContent, canonical);
    await changeLanguage(env, "hr");
    panel = await manage(translated);
    const name = filterField(panel, "Naziv filtra");
    name.value = "My preset";
    await dispatchAndFlush(name, new Event("input"));
    name.value = translated;
    await dispatchAndFlush(name, new Event("input"));
    await clickAndFlush(buttons(panel).find((button) => button.textContent === "Spremi"));
    assert.equal(
      savedProfile(env).filters[kind].find((filter) => filter.id === id).name,
      canonical,
    );
    panel = await manage(translated);
    const renamed = filterField(panel, "Naziv filtra");
    renamed.value = "My preset";
    await dispatchAndFlush(renamed, new Event("input"));
    await clickAndFlush(buttons(panel).find((button) => button.textContent === "Spremi"));
    assert.equal(
      savedProfile(env).filters[kind].find((filter) => filter.id === id).name,
      "My preset",
    );
    await changeLanguage(env, "en");
    assert.equal(chip().textContent, "My preset");
  });
}

test("saved filters rename with stable IDs, copy under a new name, delete permanently, and reuse presets from another profile", async () => {
  const env = environment();
  const definitions = await filterDefinitions(env);
  savedProfile(env).filters = clone(definitions.profileFilters());
  const templateProfile = clone(savedProfile(env));
  Object.assign(templateProfile, { id: "template-source", name: "Filter templates" });
  templateProfile.filters.states.find((filter) => filter.id === "unknown").color = "#123456";
  env.server.data("test-user").profiles.push(templateProfile);
  env.status.hass.entities = {};
  env.status.hass.devices = {};
  env.status.hass.areas = {};
  const provider = statesProvider(env);
  env.status.hass.states = {
    "sensor.one": { entity_id: "sensor.one", state: "unknown", attributes: {} },
  };
  await openEntityStates(env);
  const manage = async () => {
    await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
    const panel = env.document.body.querySelector(".qap-filter-panel");
    return panel;
  };
  let panel = await manage();
  await filterAction(env, panel, "Unknown", "edit");
  const name = filterField(panel, "Filter name");
  name.value = "My unknown";
  await dispatchAndFlush(name, new Event("input"));
  provider.publish({
    ...env.status.hass.states,
    "sensor.two": { entity_id: "sensor.two", state: "unknown", attributes: {} },
  });
  await env.tick(250);
  assert.equal(panel.querySelector(".qap-filter-preview").textContent, "2 matching entities");
  await clickAndFlush(buttons(panel).find((button) => button.textContent === "Save"));
  assert.equal(
    savedProfile(env).filters.states.find((filter) => filter.id === "unknown").name,
    "My unknown",
  );
  panel = await manage();
  await filterAction(env, panel, "My unknown", "duplicate");
  const copyName = filterField(panel, "Filter name");
  copyName.value = "Unknown copy";
  await dispatchAndFlush(copyName, new Event("input"));
  await clickAndFlush(buttons(panel).find((button) => button.textContent === "Save"));
  const copy = savedProfile(env).filters.states.find((filter) => filter.name === "Unknown copy");
  assert.notEqual(copy.id, "unknown");
  assert.equal(
    savedProfile(env).filters.states.find((filter) => filter.id === "unknown").name,
    "My unknown",
  );
  panel = await manage();
  await filterAction(env, panel, "My unknown", "delete");
  await clickAndFlush(
    env.document.body
      .querySelector(".qap-delete-filter-confirmation")
      .querySelector(".qap-button-danger"),
  );
  assert.equal(
    savedProfile(env).filters.states.some((filter) => filter.id === "unknown"),
    false,
  );
  await clickAndFlush(env.document.body.querySelector(".qap-filter-close"));
  const remote = clone(savedProfile(env));
  remote.name = "Remote metadata change";
  await env.server.mutate("test-user", {
    operation: "update",
    profile_id: remote.id,
    profile: remote,
    revision: env.server.data("test-user").revision,
  });
  await flush();
  assert.equal(
    env.document.body
      .querySelector(".qap-state-tabs")
      .children.some((chip) => chip.dataset.domain === "unknown"),
    false,
  );
  panel = await manage();
  await clickAndFlush(env.document.body.querySelector(".qap-create-filter"));
  installLocaleFetch(env);
  await changeLanguage(env, "hr");
  await clickAndFlush(panel.querySelector(".qap-filter-reuse"));
  const templates = env.document.body.querySelector(".qap-filter-reuse-modal");
  const template = templates
    .querySelectorAll(".qap-filter-reuse-profile")
    .find((section) => section.dataset.profile === templateProfile.id)
    .querySelectorAll(".qap-filter-reuse-option")
    .find((option) => option.dataset.id === "unknown");
  assert.equal(template.textContent, "Nepoznato");
  assert.equal(template.querySelector("qap-icon").style.color, "#123456");
  await clickAndFlush(template);
  assert.equal(filterField(panel, "Naziv filtra").value, "Nepoznato");
  assert.equal(iconColorInput(panel).value, "#123456");
  await clickAndFlush(buttons(panel).find((button) => button.textContent === "Spremi"));
  const restored = savedProfile(env).filters.states.find((filter) => filter.name === "Unknown");
  assert.notEqual(restored.id, "unknown");
  assert.equal(restored.color, "#123456");
  await changeLanguage(env, "en");
  assert.equal(
    env.document.body
      .querySelector(".qap-state-tabs")
      .children.find((chip) => chip.dataset.domain === restored.id).textContent,
    "Unknown",
  );
});

test(`scene shortcuts list scenes, preserve customized metadata and save the selected activation target`, async () => {
  const env = environment();
  env.status.hass.states = {
    "scene.evening": {
      entity_id: "scene.evening",
      state: "unknown",
      attributes: { friendly_name: "Evening", icon: "mdi:weather-night" },
    },
    "scene.day": {
      entity_id: "scene.day",
      state: "unavailable",
      attributes: { friendly_name: "Day" },
    },
    "light.desk": { entity_id: "light.desk", state: "on", attributes: {} },
  };
  await openShortcutsSettings("/config/logs", undefined, env);
  await clickAndFlush(env.document.body.querySelector(".qap-add-shortcut"));
  let editor = env.document.body.querySelector(".qap-shortcut-form");
  assert.equal(editor.querySelector(".qap-shortcut-scenes").hidden, true);
  await setFilterField(editor, "Shortcut type", "scene");
  const scene = filterField(editor, "Scene");
  assert.equal(scene.localName, filterField(editor, "Filter").localName);
  assert.deepEqual(
    Array.from(scene.options, (option) => option.value),
    ["scene.day", "scene.evening"],
  );
  assert.equal(editor.querySelector(".qap-shortcut-scenes").hidden, false);
  assert.equal(editor.querySelector(".qap-shortcut-filters").hidden, true);
  assert.equal(filterField(editor, "URL path").parentElement.hidden, true);
  assert.equal(editor.querySelector(".qap-tile-badge").attributes.icon, "mdi:palette");
  assert.equal(filterField(editor, "Name").value, "Day");
  const icon = editor
    .querySelector(".qap-icon-field")
    .querySelector("qap-icon-picker, qap-input, input");
  assert.equal(icon.value, "mdi:palette");
  await setFilterField(editor, "Scene", "scene.evening");
  assert.equal(filterField(editor, "Name").value, "Evening");
  assert.equal(icon.value, "mdi:weather-night");
  await setFilterField(editor, "Name", "My scene");
  await changeValidationControl(icon, "mdi:home");
  await setFilterField(editor, "Scene", "scene.day");
  await setFilterField(editor, "Scene", "scene.evening");
  assert.equal(filterField(editor, "Name").value, "My scene");
  assert.equal(icon.value, "mdi:home");
  await clickAndFlush(buttons(editor).find((item) => item.textContent === "Save"));
  const link = savedProfile(env).settings.links.at(-1);
  assert.deepEqual(
    { ...link, id: "saved" },
    {
      id: "saved",
      name: "My scene",
      icon: "mdi:home",
      color: "",
      group: "favorites",
      type: "scene",
      path: "scene.evening",
    },
  );
  const row = env.document.body
    .querySelectorAll(".qap-edit-item")
    .find((item) => item.dataset.id === link.id);
  await shortcutAction(env, "edit", row.querySelector(".qap-shortcut-overflow"));
  editor = env.document.body.querySelector(".qap-shortcut-form");
  assert.equal(filterField(editor, "Scene").value, "scene.evening");
  await setFilterField(editor, "Shortcut type", "internal");
  await setFilterField(editor, "URL path", "/config/logs");
  await clickAndFlush(buttons(editor).find((item) => item.textContent === "Save"));
  assert.equal(savedProfile(env).settings.links.at(-1).path, "/config/logs");
  assert.equal(savedProfile(env).settings.links.at(-1).type, "internal");
});
