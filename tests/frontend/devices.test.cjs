// Device Explorer rows, details, areas, registries and favorites.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const {
  attributesValue,
  installLocaleFetch,
  changeLanguage,
  flush,
  clickAndFlush,
  dispatchAndFlush,
  clone,
  filterDefinitions,
  ProfileServer,
  environment,
  deviceFixture,
  openDevices,
  installDeviceRegistries,
  nativeComponents,
  buttons,
  scrollStates,
  openShortcutsSettings,
  changeValidationControl,
  manageProfile,
  createModuleLoader,
} = require("./harness.cjs");

test("Device display names trim each name and follow user, integration, then ID precedence", async () => {
  const { getDeviceName } = await createModuleLoader(vm.createContext({})).load(
    "devices/device-formatting.js",
  );
  const cases = [
    [{ name_by_user: " User name ", name: " Integration name " }, "User name"],
    [{ name: " Integration name " }, "Integration name"],
    [{ name_by_user: null, name: "Integration name" }, "Integration name"],
    [{ name_by_user: "", name: "Integration name" }, "Integration name"],
    [{ name_by_user: " \t\n ", name: " Integration name " }, "Integration name"],
    [{ name_by_user: "User name", name: " \t " }, "User name"],
    [{}, "device_a"],
    [{ name_by_user: null, name: null }, "device_a"],
    [{ name_by_user: "", name: "" }, "device_a"],
    [{ name_by_user: " \t ", name: " \n " }, "device_a"],
  ];
  for (const [fields, expected] of cases) {
    assert.equal(getDeviceName({ id: "device_a", ...fields }), expected, JSON.stringify(fields));
  }
});

test("Device rows, sorting and details share trimmed display names", async () => {
  const env = environment();
  installDeviceRegistries(env, [
    deviceFixture("device_a", { name_by_user: " \t ", name: " Alpha " }),
    deviceFixture("device_b", { name_by_user: " Zulu ", name: "Integration name" }),
    deviceFixture("device_c", { name_by_user: " ", name: " \n " }),
  ]);
  await openDevices(env);
  const rows = env.document.body.querySelectorAll(".qap-state-row");
  assert.deepEqual(
    rows.map((row) => row.dataset.device),
    ["device_a", "device_c", "device_b"],
  );
  assert.deepEqual(
    rows.map((row) => row.querySelector(".qap-state-name").textContent),
    ["Alpha", "device_c", "Zulu"],
  );
  for (const row of rows) {
    row.querySelector(".qap-state-summary").click();
    const modal = env.document.body.querySelector(".qap-state-modal");
    assert.equal(
      modal.querySelector(".qap-state-dialog-name").textContent,
      row.querySelector(".qap-state-name").textContent,
    );
    assert.equal(modal.querySelector(".qap-state-dialog-id-link").textContent, row.dataset.device);
    modal.dispatchEvent(new Event("cancel"));
  }
});

test("Device Explorer shortcut stays on the current route and supports search, area filters and isolated recent history", async () => {
  const env = environment();
  installDeviceRegistries(env, [
    deviceFixture("device_a", { name_by_user: " Kitchen thermostat ", name: "Integration name" }),
    deviceFixture("device_b", { name_by_user: null, name: "Garage", area_id: null }),
  ]);
  env.storage.set(
    `quick_access_v1:test-instance:test-user:test-profile:states-search-history`,
    JSON.stringify(["entity search"]),
  );
  const search = await openDevices(env);
  assert.equal(env.context.location.pathname, "/lovelace/home");
  assert.equal(env.document.body.querySelector("qap-dialog").headerTitle, "Device Explorer");
  assert.equal(env.server.requests.length, 0, "native registries need no extra WS requests");
  assert.equal(search.attributes["aria-label"], "Search devices...");
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "2 devices");
  const rows = () => env.document.body.querySelectorAll(".qap-state-row");
  assert.deepEqual(
    rows().map((row) => row.dataset.device),
    ["device_b", "device_a"],
  );
  assert.equal(env.document.body.querySelectorAll(".qap-state-tab").length, 5);
  buttons(env.document.body)
    .find((button) => button.dataset.domain === "assigned")
    .click();
  assert.deepEqual(
    rows().map((row) => row.dataset.device),
    ["device_a"],
  );
  buttons(env.document.body)
    .find((button) => button.dataset.domain === "unassigned")
    .click();
  assert.deepEqual(
    rows().map((row) => row.dataset.device),
    ["device_b"],
  );
  buttons(env.document.body)
    .find((button) => button.dataset.domain === "all")
    .click();
  for (const term of ["device_a", "Kitchen thermostat", "Integration name"]) {
    search.value = term;
    search.dispatchEvent(new Event("input"));
    await env.tick(175);
    assert.deepEqual(
      rows().map((row) => row.dataset.device),
      ["device_a"],
      term,
    );
  }
  search.value = "";
  search.dispatchEvent(new Event("input"));
  search.value = "t-1";
  search.dispatchEvent(new Event("input"));
  assert.equal(rows().length, 2);
  await env.tick(175);
  assert.equal(rows().length, 2); // Both have this model ID.
  search.value = "Kitchen";
  search.dispatchEvent(new Event("input"));
  await env.tick(175);
  assert.deepEqual(
    rows().map((row) => row.dataset.device),
    ["device_a"],
  );
  search.dispatchEvent(new Event("focusout"));
  assert.deepEqual(
    JSON.parse(
      env.storage.get(
        "quick_access_v1:test-instance:test-user:test-profile:devices-search-history",
      ),
    ),
    ["Kitchen"],
  );
  assert.deepEqual(
    JSON.parse(
      env.storage.get(`quick_access_v1:test-instance:test-user:test-profile:states-search-history`),
    ),
    ["entity search"],
  );
  search.value = "";
  search.dispatchEvent(new Event("input"));
  assert.equal(rows().length, 2);
  buttons(env.document.body)
    .find((button) => button.title === "Back")
    .click();
  assert.equal(env.context.location.pathname, "/lovelace/home");
});

test(`Device details reuse identity, structured attributes, copy and stars`, async () => {
  const env = environment();
  const record = deviceFixture("device_a", { name_by_user: " Kitchen thermostat " });
  installDeviceRegistries(env, [record]);
  const copies = [];
  env.window.isSecureContext = true;
  env.context.navigator.clipboard = { writeText: async (value) => copies.push(value) };
  await openDevices(env);
  const row = env.document.body.querySelector(".qap-state-summary");
  await clickAndFlush(row);
  const modal = env.document.body.querySelector(".qap-state-modal");
  assert.equal(modal.localName, "qap-dialog");
  assert.equal(modal.querySelector("h2").textContent, "Device details");
  assert.equal(modal.querySelectorAll(".qap-state-dialog-identity-row").length, 2);
  const identityRows = modal.querySelectorAll(".qap-state-dialog-identity-row");
  assert.equal(
    identityRows[0].querySelector(".qap-state-dialog-name").textContent,
    "Kitchen thermostat",
  );
  assert.equal(identityRows[1].querySelector(".qap-state-dialog-id-link").textContent, record.id);
  const copyId = identityRows[1].querySelector(".qap-state-dialog-id-copy");
  assert.equal(copyId.attributes["aria-label"], "Copy device ID");
  assert.equal(modal.querySelector(".qap-state-dialog-name").textContent, "Kitchen thermostat");
  assert.equal(modal.querySelector(".qap-state-dialog-state-label").textContent, "Area");
  assert.equal(modal.querySelector(".qap-state-dialog-value").textContent, "Kitchen");
  const detailRows = modal.querySelectorAll(".qap-state-dialog-state-line");
  assert.deepEqual(
    detailRows.map((row) => row.querySelector(".qap-state-dialog-state-label").textContent),
    ["Area", "Manufacturer", "Model", "Software version"],
  );
  assert.deepEqual(
    detailRows.map((row) => row.querySelector(".qap-state-dialog-value").textContent),
    ["Kitchen", record.manufacturer, record.model, record.sw_version],
  );
  const viewer = modal.querySelector("qap-attributes-viewer");
  assert.equal(viewer.label, "Device registry attributes");
  assert.deepEqual(attributesValue(viewer), record);
  modal.querySelector(".qap-state-dialog-id-copy").click();
  assert.equal(modal.querySelector(".qap-state-dialog-state-copy"), null);
  await flush();
  assert.deepEqual(copies, [record.id]);
  const star = modal.querySelector(".qap-state-dialog-favorite");
  env.server.failWrites = true;
  await clickAndFlush(star);
  assert.equal(star.attributes["aria-pressed"], "false");
  assert.match(modal.querySelector(".qap-error").textContent, /Could not save/);
  env.server.failWrites = false;
  await clickAndFlush(star);
  assert.equal(star.attributes["aria-pressed"], "true");
  assert.equal(modal.querySelector(".qap-error").textContent, "");
  const saved = env.server.data("test-user").profiles[0];
  assert.deepEqual(saved.device_favorites, [record.id]);
  assert.deepEqual(saved.favorites, []);
  await clickAndFlush(star);
  assert.deepEqual(env.server.data("test-user").profiles[0].device_favorites, []);
  const nativeLink = modal.querySelector(".qap-state-dialog-info");
  assert.equal(nativeLink.localName, "qap-icon-button");
  assert.equal(nativeLink.href, "/config/devices/device/device_a");
  assert.equal(nativeLink.title, "Open device in Home Assistant");
  nativeLink.click();
  assert.equal(
    modal.isConnected,
    true,
    "native navigation guards control whether the route changes",
  );
  buttons(modal)
    .find((button) => button.title === "Back")
    .click();
  await flush();
  assert.equal(env.document.activeElement, row);
});

test("Device navigation uses the owned link control independently of HA icon button APIs", async () => {
  const env = environment();
  nativeComponents(env);
  installDeviceRegistries(env);
  await openDevices(env);
  env.document.body.querySelector(".qap-state-summary").click();
  const modal = env.document.body.querySelector(".qap-state-modal");
  const link = modal.querySelector(".qap-state-dialog-info");
  assert.equal(link.localName, "qap-icon-button");
  assert.equal(link.href, "/config/devices/device/device_a");
  assert.equal(link.attributes["aria-label"], "Open device in Home Assistant");
  assert.equal(modal.querySelector(".qap-state-dialog-favorite").localName, "qap-icon-button");
});

test("Devices virtualize 10000 records, retain keyboard reachability and restore the searched viewport", async () => {
  const env = environment();
  installDeviceRegistries(
    env,
    Array.from({ length: 10000 }, (_, index) =>
      deviceFixture(`d_${String(index).padStart(5, "0")}`, {
        name: `Device ${String(index).padStart(5, "0")}`,
        name_by_user: null,
      }),
    ),
  );
  const search = await openDevices(env);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "10000 devices");
  const list = env.document.body.querySelector(".qap-state-list");
  assert.ok(list.children.length < 20);
  await scrollStates(env, 160 + 5000 * 74);
  const ids = list.querySelectorAll(".qap-state-row").map((row) => row.dataset.device);
  assert.equal(ids[0], "d_04996");
  const lastMounted = list.children.at(-1);
  const row = lastMounted.querySelector(".qap-state-summary");
  assert.equal(lastMounted.querySelector(".qap-matching-count").hidden, true);
  row.focus();
  const tab = new Event("keydown", { cancelable: true });
  Object.assign(tab, { key: "Tab" });
  row.dispatchEvent(tab);
  assert.equal(tab.defaultPrevented, true);
  assert.equal(
    env.document.activeElement.parentElement.dataset.device,
    `d_${String(Number(lastMounted.dataset.device.slice(2)) + 1).padStart(5, "0")}`,
  );
  const keyboardScrollTop = env.document.body.querySelector(".qap-body").scrollTop;
  env.document.activeElement.click();
  const modal = env.document.body.querySelector(".qap-state-modal");
  modal.dispatchEvent(new Event("cancel"));
  assert.equal(env.document.body.querySelector(".qap-body").scrollTop, keyboardScrollTop);
  search.value = "Device 09999";
  search.dispatchEvent(new Event("input"));
  await env.tick(175);
  assert.equal(list.querySelector(".qap-state-row").dataset.device, "d_09999");
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "1 device");
  search.value = "";
  search.dispatchEvent(new Event("input"));
  await scrollStates(env, 160 + 9000 * 74);
  const scrollTop = env.document.body.querySelector(".qap-body").scrollTop;
  buttons(env.document.body)
    .find((button) => button.title === "Back")
    .click();
  env.document.body
    .querySelectorAll(".qap-tile")
    .find(
      (tile) =>
        tile.localName === "button" &&
        tile.querySelector(".qap-tile-name").textContent === "Device Explorer",
    )
    .click();
  assert.equal(env.document.body.querySelector(".qap-body").scrollTop, scrollTop);
  env.enable(false);
  await flush();
  assert.equal(env.resizeObservers.size, 0);
});

test("Device areas distinguish explicit, inherited, entity override and transport-parent areas", async () => {
  const env = environment();
  installDeviceRegistries(env, [
    deviceFixture("parent"),
    deviceFixture("child", { area_id: null, parent_device_id: "parent" }),
    deviceFixture("transport", { area_id: null, via_device_id: "parent" }),
  ]);
  env.status.hass.entities = { "sensor.override": { device_id: "transport", area_id: "kitchen" } };
  await openDevices(env);
  const row = env.document.body
    .querySelectorAll(".qap-state-row")
    .find((row) => row.dataset.device === "child");
  await clickAndFlush(row.querySelector("button"));
  const modal = env.document.body.querySelector(".qap-state-modal");
  assert.equal(modal.querySelector(".qap-state-dialog-value").textContent, "Kitchen");
  assert.equal(modal.querySelector(".qap-state-dialog-state-copy"), null);
  assert.equal(attributesValue(modal.querySelector("qap-attributes-viewer")).area_id, null);
  modal.dispatchEvent(new Event("cancel"));
  buttons(env.document.body)
    .find((button) => button.dataset.domain === "unassigned")
    .click();
  assert.deepEqual(
    env.document.body.querySelectorAll(".qap-state-row").map((row) => row.dataset.device),
    ["transport"],
  );
});

test("Registry contexts update details, release subscriptions and close details when a device is removed", async () => {
  const env = environment();
  installDeviceRegistries(env);
  const listeners = new Map();
  env.homeAssistant.addEventListener("context-request", (event) => {
    if (!["devices", "areas"].includes(event.context)) return;
    listeners.set(event.context, event.callback);
    event.callback(env.status.hass[event.context], () => listeners.delete(event.context));
  });
  await openDevices(env);
  await clickAndFlush(env.document.body.querySelector(".qap-state-summary"));
  const modal = env.document.body.querySelector(".qap-state-modal");
  const renamed = deviceFixture("device_a", {
    name_by_user: "Updated",
    manufacturer: "Updated manufacturer",
    model: null,
    sw_version: "2.0",
  });
  listeners.get("devices")({ device_a: renamed }, () => listeners.delete("devices"));
  await env.tick(250);
  assert.equal(modal.querySelector(".qap-state-dialog-name").textContent, "Updated");
  const detailRows = modal.querySelectorAll(".qap-state-dialog-state-line");
  assert.deepEqual(
    detailRows.map((row) => row.querySelector(".qap-state-dialog-value").textContent),
    ["Kitchen", "Updated manufacturer", "Unavailable", "2.0"],
  );
  assert.equal(detailRows[2].querySelector(".qap-state-dialog-state-copy"), null);
  listeners.get("areas")({ kitchen: { area_id: "kitchen", name: "Renamed area" } }, () =>
    listeners.delete("areas"),
  );
  await env.tick(250);
  assert.equal(modal.querySelector(".qap-state-dialog-value").textContent, "Renamed area");
  const callback = listeners.get("devices");
  callback({}, () => listeners.delete("devices"));
  await env.tick(250);
  assert.equal(modal.open, false);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "0 devices");
  env.enable(false);
  await flush();
  assert.equal(listeners.size, 0);
  callback({ device_a: renamed }, () => {});
  await env.tick(250);
  assert.equal(env.document.body.querySelector(".qap-state-list"), null);
});

test("Registry fallback ignores invalidated WS responses, refreshes on events and reconnects, and releases late subscriptions", async () => {
  const env = environment();
  const pending = [];
  const events = new Map();
  const releases = [];
  env.status.hass.callWS = ({ type }) =>
    new Promise((resolve, reject) => pending.push({ type, resolve, reject }));
  env.connection.subscribeEvents = async (callback, name) => {
    events.set(name, callback);
    return () => releases.push(name);
  };
  await openDevices(env);
  assert.equal(env.document.body.querySelector(".qap-empty"), null);
  assert.equal(env.document.body.querySelector(".qap-registry-status").hidden, true);
  assert.equal(env.document.body.querySelector(".qap-registry-status").textContent, "");
  assert.equal(pending.length, 2);
  events.get("device_registry_updated")();
  pending
    .find((request) => request.type === "config/device_registry/list")
    .resolve([deviceFixture("stale")]);
  pending
    .find((request) => request.type === "config/area_registry/list")
    .resolve([{ area_id: "kitchen", name: "Kitchen" }]);
  await flush();
  assert.equal(pending.length, 3);
  pending[2].resolve([deviceFixture("current")]);
  await flush();
  await env.tick(250);
  assert.deepEqual(
    env.document.body.querySelectorAll(".qap-state-row").map((row) => row.dataset.device),
    ["current"],
  );
  await dispatchAndFlush(env.connection, new Event("ready"));
  assert.equal(pending.length, 5);
  const oldList = env.document.body.querySelector(".qap-state-list");
  env.enable(false);
  pending[3].resolve([deviceFixture("late")]);
  pending[4].resolve([]);
  await flush();
  assert.equal(oldList.isConnected, false);
  assert.deepEqual(releases.sort(), ["area_registry_updated", "device_registry_updated"]);
  assert.equal(env.document.body.querySelector(".qap-state-list"), null);
});

test("Registry failures are visible and recover without resetting device or entity favorites", async () => {
  const env = environment();
  env.server.data("test-user").profiles[0].device_favorites = ["device_a"];
  env.server.data("test-user").profiles[0].favorites = ["sensor.kitchen"];
  let fail = true;
  env.status.hass.callWS = async ({ type }) => {
    if (fail) throw { code: "unauthorized" };
    return type === "config/device_registry/list" ? [deviceFixture()] : [];
  };
  await openDevices(env);
  await env.tick(250);
  assert.match(
    env.document.body.querySelector(".qap-registry-status").textContent,
    /Could not load/,
  );
  assert.deepEqual(env.server.data("test-user").profiles[0].device_favorites, ["device_a"]);
  fail = false;
  await env.tick(3500);
  await env.tick(250);
  assert.equal(env.document.body.querySelector(".qap-registry-status").hidden, true);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "1 device");
  env.document.body.querySelector(".qap-state-summary").click();
  assert.equal(
    env.document.body.querySelector(".qap-state-dialog-favorite").attributes["aria-pressed"],
    "true",
  );
  assert.deepEqual(env.server.data("test-user").profiles[0].favorites, ["sensor.kitchen"]);
});

test("Device stars synchronize across clients while conflicts and stale acknowledgements preserve remote data", async () => {
  const server = new ProfileServer();
  const a = environment("http://homeassistant.local:8123", server);
  const b = environment("http://remote.example", server, { fresh: true });
  b.storage.set(
    "quick_access_v1:test-instance:test-user:active-profile",
    JSON.stringify("test-profile"),
  );
  installDeviceRegistries(a);
  installDeviceRegistries(b);
  await openDevices(a);
  await openDevices(b);
  a.document.body.querySelector(".qap-state-summary").click();
  b.document.body.querySelector(".qap-state-summary").click();
  const modal = a.document.body.querySelector(".qap-state-modal");
  const remoteModal = b.document.body.querySelector(".qap-state-modal");
  const star = modal.querySelector(".qap-state-dialog-favorite");
  let release;
  a.connection.sendMessagePromise = (message) =>
    new Promise((resolve, reject) => {
      release = () => server.mutate("test-user", message).then(resolve, reject);
    });
  star.click();
  await clickAndFlush(remoteModal.querySelector(".qap-state-dialog-favorite"));
  await release();
  await flush();
  assert.match(modal.querySelector(".qap-error").textContent, /changed on another device/);
  assert.deepEqual(server.data("test-user").profiles[0].device_favorites, ["device_a"]);
  assert.equal(
    remoteModal.querySelector(".qap-state-dialog-favorite").attributes["aria-pressed"],
    "true",
  );
  // A reload from the subscription restores the confirmed star without replacing
  // the list or open details. Then race an acknowledged removal with a rename.
  server.notify("test-user");
  assert.equal(a.document.body.querySelector(".qap-state-modal"), modal);
  assert.equal(star.attributes["aria-pressed"], "true");
  a.connection.sendMessagePromise = async (message) => {
    const result = await server.mutate("test-user", message);
    return new Promise((resolve) => {
      release = () => resolve(result);
    });
  };
  await clickAndFlush(star);
  const changed = clone(server.data("test-user").profiles[0]);
  changed.name = "Remote rename";
  changed.favorites = ["sensor.remote"];
  await server.mutate("test-user", {
    operation: "update",
    profile_id: changed.id,
    revision: server.data("test-user").revision,
    profile: changed,
  });
  release();
  await flush();
  assert.equal(server.data("test-user").profiles[0].name, "Remote rename");
  assert.deepEqual(server.data("test-user").profiles[0].favorites, ["sensor.remote"]);
  assert.deepEqual(server.data("test-user").profiles[0].device_favorites, []);
  server.notify("test-user");
  assert.equal(star.attributes["aria-pressed"], "false");
});

test("Devices keeps owned search and attributes stable during HA registration without losing metadata", async () => {
  const env = environment();
  const components = nativeComponents(env, false);
  installDeviceRegistries(env, [{ id: "minimal", name: null, area_id: null }]);
  const search = await openDevices(env);
  search.focus();
  search.value = "minimal";
  search.dispatchEvent(new Event("input"));
  components.register();
  await flush();
  assert.equal(env.document.body.querySelector(".qap-search-input"), search);
  search.dispatchEvent(new Event("keydown"));
  await env.tick(175);
  env.document.activeElement = null;
  await dispatchAndFlush(search.parentElement, new Event("focusout"));
  assert.equal(env.document.body.querySelector(".qap-search-input").localName, "qap-search");
  assert.equal(env.document.body.querySelector(".qap-search-input").value, "minimal");
  await clickAndFlush(env.document.body.querySelector(".qap-state-summary"));
  const modal = env.document.body.querySelector(".qap-state-modal");
  assert.equal(modal.querySelector(".qap-state-dialog-name").textContent, "minimal");
  assert.equal(modal.querySelector(".qap-state-dialog-value").textContent, "No area");
  assert.equal(modal.querySelector(".qap-state-dialog-state-copy"), null);
  const metadataRows = modal.querySelectorAll(".qap-state-dialog-state-line").slice(1);
  assert.equal(metadataRows.length, 3);
  for (const metadataRow of metadataRows) {
    assert.equal(metadataRow.querySelector(".qap-state-dialog-value").textContent, "Unavailable");
    assert.equal(metadataRow.querySelector(".qap-state-dialog-state-copy"), null);
  }
  assert.deepEqual(attributesValue(modal.querySelector("qap-attributes-viewer")), {
    id: "minimal",
    name: null,
    area_id: null,
  });
  env.enable(false);
  await flush();
  assert.equal(env.mutationObservers.size, 0);
});

test("Devices reconnect can replace an unresolved registry request and ignore the old socket's response", async () => {
  const env = environment();
  const pending = [];
  env.status.hass.areas = {};
  env.status.hass.callWS = () => new Promise((resolve) => pending.push(resolve));
  await openDevices(env);
  assert.equal(pending.length, 1);
  await dispatchAndFlush(env.connection, new Event("ready"));
  assert.equal(pending.length, 2);
  pending[1]([deviceFixture("new_socket")]);
  await flush();
  await env.tick(250);
  pending[0]([deviceFixture("old_socket")]);
  await flush();
  await env.tick(250);
  assert.deepEqual(
    env.document.body.querySelectorAll(".qap-state-row").map((row) => row.dataset.device),
    ["new_socket"],
  );
});

test("Devices translates existing rows and details in place and isolates pending loads from a replacement view", async () => {
  const env = environment();
  installLocaleFetch(env);
  installDeviceRegistries(env);
  await openDevices(env);
  env.document.body.querySelector(".qap-state-summary").click();
  const modal = env.document.body.querySelector(".qap-state-modal");
  await changeLanguage(env, "hr");
  assert.equal(env.document.body.querySelector(".qap-state-modal"), modal);
  assert.equal(env.document.body.querySelector("qap-dialog").headerTitle, "Preglednik uređaja");
  assert.equal(modal.querySelector("h2").textContent, "Pojedinosti uređaja");
  assert.equal(modal.querySelector(".qap-state-dialog-state-label").textContent, "Područje");
  modal.dispatchEvent(new Event("cancel"));
  env.enable(false);
  const fallback = environment();
  let release;
  fallback.status.hass.areas = {};
  fallback.status.hass.callWS = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  await openDevices(fallback);
  buttons(fallback.document.body)
    .find((button) => button.title === "Back")
    .click();
  fallback.document.body.querySelector(".qap-tile").click();
  release([deviceFixture()]);
  await flush();
  await fallback.tick(250);
  assert.equal(fallback.document.body.querySelector("qap-dialog").headerTitle, "Entity Explorer");
  assert.equal(fallback.document.body.querySelector(".qap-count").textContent, "0 entities");
});

test("Device Explorer editor saves the internal shortcut without a path, and profile copies retain separate favorite sets", async () => {
  const env = environment();
  nativeComponents(env);
  await openShortcutsSettings("/config", undefined, env);
  env.document.body.querySelector(".qap-add-shortcut").click();
  const editor = env.document.body.querySelector(".qap-shortcut-form");
  const name = editor.querySelectorAll("qap-input").find((input) => input.label === "Name");
  const type = editor
    .querySelectorAll("qap-select")
    .find((select) => select.label === "Shortcut type");
  assert.equal(
    type.options.find((option) => option.value === "quick-devices").label,
    "Device Explorer",
  );
  name.value = "My devices";
  name.dispatchEvent(new Event("input"));
  changeValidationControl(type, "quick-devices", "change");
  await clickAndFlush(buttons(editor).find((button) => button.textContent === "Save"));
  const saved = env.server.data("test-user").profiles[0].settings.links.at(-1);
  assert.equal(saved.type, "quick-devices");
  assert.equal(saved.path, "");
  const profile = env.server.data("test-user").profiles[0];
  profile.device_favorites = ["device_a"];
  profile.categories[0].grid = { columns: 7, rows: 2, hideNames: true };
  profile.favorites = ["sensor.kitchen"];
  const definitions = await filterDefinitions(env);
  profile.filters = clone(definitions.profileFilters());
  profile.settings.links.push({
    id: "issues-pin",
    name: "My issues",
    icon: "mdi:pin",
    color: "",
    group: "favorites",
    type: "saved-filter",
    path: "",
    filterKind: "states",
    filterId: "unknown",
  });
  env.server.notify("test-user");
  const duplicate = await manageProfile(env, "test-profile", "duplicate");
  await clickAndFlush(duplicate.querySelector(".qap-profile-submit"));
  const copy = env.server.data("test-user").profiles.at(-1);
  assert.notEqual(copy.id, profile.id);
  assert.deepEqual(copy.device_favorites, ["device_a"]);
  assert.deepEqual(copy.favorites, ["sensor.kitchen"]);
  assert.deepEqual(copy.settings, profile.settings);
  assert.deepEqual(copy.categories, profile.categories);
  assert.deepEqual(copy.filters, profile.filters);
  assert.notEqual(copy.filters.states, profile.filters.states);
  assert.equal(definitions.resolveShortcutFilter(copy, copy.settings.links.at(-1)).id, "unknown");
});

test("Devices fallback defers to newly available native registries and cleans up late event subscriptions", async () => {
  const env = environment();
  const requests = [];
  const subscriptions = [];
  let released = 0;
  const send = env.connection.sendMessagePromise;
  env.connection.sendMessagePromise = (message) =>
    message.type.startsWith("config/")
      ? new Promise((resolve) => requests.push({ type: message.type, resolve }))
      : send(message);
  env.connection.subscribeEvents = () => new Promise((resolve) => subscriptions.push(resolve));
  await openDevices(env);
  installDeviceRegistries(env, [deviceFixture("native")]);
  requests
    .find(({ type }) => type === "config/device_registry/list")
    .resolve([deviceFixture("stale")]);
  requests.find(({ type }) => type === "config/area_registry/list").resolve([]);
  await flush();
  await env.tick(250);
  assert.equal(env.document.body.querySelector(".qap-state-row").dataset.device, "native");
  env.enable(false);
  subscriptions.forEach((resolve) => resolve(() => released++));
  await flush();
  assert.equal(released, 2);
  assert.equal(env.document.body.querySelector(".qap-state-modal"), null);
});

test("Devices do not refilter unchanged native registries during idle lifecycle and poll ticks", async () => {
  const env = environment();
  installDeviceRegistries(env);
  let scans = 0;
  env.status.hass.devices = new Proxy(env.status.hass.devices, {
    ownKeys: (target) => {
      scans++;
      return Reflect.ownKeys(target);
    },
  });
  await openDevices(env);
  scans = 0;
  await env.tick(15000);
  await env.tick(3500);
  await env.tick(250);
  assert.equal(scans, 0);
  env.status.hass.devices = { device_b: deviceFixture("device_b") };
  await env.tick(15000);
  await env.tick(250);
  assert.equal(env.document.body.querySelector(".qap-state-row").dataset.device, "device_b");
});
