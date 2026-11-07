// Floating launcher preference storage and synchronization.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const { getEventListeners } = require("node:events");
const path = require("node:path");
const test = require("node:test");
const {
  panelEnvironment,
  flush,
  clone,
  ProfileServer,
  environment,
  nativeComponents,
  startProfiles,
  selectionKey,
  launcherKey,
  toggleLauncher,
  deviceStatus,
  chooseDeviceProfile,
  confirmDevice,
  storageEvent,
  deviceEnvironment,
} = require("./harness.cjs");

test("floating launcher preference applies immediately without changing profiles", async () => {
  const env = panelEnvironment(undefined, await startProfiles(environment()));
  const panel = await env.mountPanel();
  await flush();
  const savedProfiles = clone(env.server.data("test-user"));
  assert.equal(panel._launcherToggle.localName, "qap-checkbox");
  assert.equal(panel._launcherToggle.attributes["aria-label"], "Show floating launcher");
  assert.equal(panel._launcherToggle.checked, true);
  assert.equal(env.storage.has(launcherKey()), false);
  toggleLauncher(panel, false);
  assert.equal(env.fab().hidden, true);
  assert.equal(env.storage.get(launcherKey()), "false");
  assert.equal(panel._profileSelect.value, "test-profile");
  for (const path of ["/lovelace/other", "/quick-access-config", "/config"]) {
    env.context.location.pathname = path;
    env.window.dispatchEvent(new Event("location-changed"));
    env.resize(1440);
    assert.equal(env.fab().hidden, true);
  }
  panel._removeSelection.click();
  confirmDevice(panel);
  assert.equal(env.fab().hidden, true, "no profile must not expose the Setup button");
  env.server.notify("test-user");
  env.enable(false);
  env.enable(true);
  await flush();
  assert.equal(env.fab().hidden, true);
  panel.remove();
  panel.disconnectedCallback();
  env.document.body.append(panel);
  panel.connectedCallback();
  await flush();
  assert.equal(panel._launcherToggle.checked, false);
  assert.equal(panel._launcherToggle.disabled, false);
  toggleLauncher(panel, true);
  assert.equal(env.fab().hidden, false);
  assert.equal(env.fab().attributes["aria-label"], "Set up Quick Access");
  assert.deepEqual(env.server.data("test-user"), savedProfiles);
  const profile = env.server.data("test-user").profiles[0];
  profile.settings.routes = ["/*"];
  env.server.notify("test-user");
  const withRoutes = clone(env.server.data("test-user"));
  chooseDeviceProfile(panel, profile.id);
  assert.equal(env.fab().hidden, true, "enabling must still respect profile routes");
  toggleLauncher(panel, false);
  toggleLauncher(panel, true);
  assert.equal(env.fab().hidden, true);
  assert.deepEqual(env.server.data("test-user"), withRoutes);
  assert.equal(env.server.requests.length, 0);
});

test("disabled floating launcher never appears while the instance scope is loading or after reload", async () => {
  const env = environment();
  env.storage.set(launcherKey(), "false");
  let receiveProfiles;
  const subscribe = env.connection.subscribeMessage;
  env.connection.subscribeMessage = (callback, message, options) => {
    if (message.type !== "quick_access/subscribe_profiles")
      return subscribe(callback, message, options);
    receiveProfiles = callback;
    return Promise.resolve(async () => {});
  };
  const append = env.document.body.append.bind(env.document.body);
  env.document.body.append = (...children) => {
    for (const child of children)
      if (child.id === "qap-fab") assert.equal(child.hidden, true, "hide before attaching to DOM");
    append(...children);
  };
  await startProfiles(env, false);
  assert.equal(env.fab().hidden, true);
  env.window.dispatchEvent(new Event("location-changed"));
  assert.equal(env.fab().hidden, true);
  receiveProfiles(clone(env.server.data("test-user")));
  assert.equal(env.fab().hidden, true);
  env.storage.delete(selectionKey());
  storageEvent(env, selectionKey());
  assert.equal(env.fab().hidden, true);
  env.enable(false);
  env.enable(true);
  await flush();
  assert.equal(env.fab().hidden, true);
  receiveProfiles(clone(env.server.data("test-user")));
  assert.equal(env.fab().hidden, true);
});

test("floating launcher storage events synchronize tabs, filter scopes and handle removal and clear", async () => {
  const env = await deviceEnvironment(),
    panel = env.panel;
  env.storage.set(launcherKey(), "false");
  for (const key of [
    launcherKey("elsewhere"),
    launcherKey("test-instance", "elsewhere"),
    selectionKey("elsewhere"),
  ])
    storageEvent(env, key);
  storageEvent(env, launcherKey(), {});
  assert.equal(env.fab().hidden, false);
  assert.equal(panel._launcherToggle.checked, true);
  storageEvent(env, launcherKey());
  assert.equal(env.fab().hidden, true);
  assert.equal(panel._launcherToggle.checked, false);
  env.storage.delete(launcherKey());
  storageEvent(env, launcherKey());
  assert.equal(env.fab().hidden, false);
  assert.equal(panel._launcherToggle.checked, true);
  toggleLauncher(panel, false);
  env.storage.clear();
  storageEvent(env, null);
  assert.equal(env.fab().hidden, false);
  assert.equal(panel._launcherToggle.checked, true);
  assert.equal(env.window.quickAccessDebug().activeProfileId, null);
  panel.remove();
  panel.disconnectedCallback();
  assert.equal(getEventListeners(env.window, "quick-access-launcher-preference-changed").length, 1);
  env.enable(false);
  assert.equal(getEventListeners(env.window, "quick-access-launcher-preference-changed").length, 0);
});

test("floating launcher preferences stay separate across authenticated users and instances", async () => {
  const env = await deviceEnvironment(),
    panel = env.panel;
  toggleLauncher(panel, false);
  env.status.hass.user = { id: "bob" };
  panel.hass = env.status.hass;
  await env.tick(15000);
  assert.equal(panel._launcherToggle.checked, true);
  assert.equal(env.fab().hidden, false);
  toggleLauncher(panel, false);
  assert.equal(env.storage.get(launcherKey("test-instance", "bob")), "false");
  env.status.hass.user = { id: "test-user" };
  panel.hass = env.status.hass;
  await env.tick(15000);
  assert.equal(env.fab().hidden, true);
  assert.equal(panel._launcherToggle.checked, false);
  const other = panelEnvironment(
    undefined,
    environment(undefined, new ProfileServer("other-instance")),
  );
  for (const [key, value] of env.storage) other.storage.set(key, value);
  await startProfiles(other);
  const otherPanel = await other.mountPanel();
  await flush();
  assert.equal(otherPanel._launcherToggle.checked, true);
  assert.equal(other.fab().hidden, false);
});

test("floating launcher toggle restores saved state on storage failure and upgrades delayed native controls", async () => {
  const env = await deviceEnvironment(),
    panel = env.panel;
  const setItem = env.context.localStorage.setItem;
  env.context.localStorage.setItem = () => {
    throw Error("Storage blocked");
  };
  toggleLauncher(panel, false);
  assert.equal(panel._launcherToggle.checked, true);
  assert.equal(env.fab().hidden, false);
  assert.match(deviceStatus(panel), /Could not save changes/);
  assert.equal(env.storage.has(launcherKey()), false);
  env.context.localStorage.setItem = setItem;
  toggleLauncher(panel, false);
  const components = nativeComponents(env, false);
  // Mount again to install registration watchers in the native control environment.
  panel.remove();
  panel.disconnectedCallback();
  env.document.body.append(panel);
  panel.connectedCallback();
  await flush();
  assert.equal(panel._launcherToggle.localName, "qap-checkbox");
  assert.equal(panel._launcherToggle.checked, false);
  toggleLauncher(panel, true);
  assert.equal(env.fab().hidden, false);
  assert.equal(env.server.requests.length, 0);
});

test("floating launcher defaults to enabled for missing or malformed preferences", async () => {
  const env = await deviceEnvironment();
  for (const raw of ["true", "null", '"false"', "{}", "invalid JSON"]) {
    env.storage.set(launcherKey(), raw);
    storageEvent(env, launcherKey());
    assert.equal(env.fab().hidden, false);
    assert.equal(env.panel._launcherToggle.checked, true);
  }
});
