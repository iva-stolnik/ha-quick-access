// Launcher startup, navigation observers and HA context subscriptions.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const { getEventListeners } = require("node:events");
const test = require("node:test");
const {
  installLocaleFetch,
  flush,
  environment,
  openEntityStates,
  statesProvider,
  haContextsProvider,
  openLauncherSettings,
  returnToLauncher,
  largeStates,
  startProfiles,
  EventTargetDouble,
} = require("./harness.cjs");

test("launcher starts with hidden shortcut search and groups, keeps browser navigation, and releases listeners", async () => {
  const env = environment();
  env.window.navigation = new EventTargetDouble();
  await startProfiles(env);
  env.fab().click();
  assert.deepEqual(
    env.document.body
      .querySelector(".qap-home")
      .children.slice(0, 2)
      .map((element) => element.className),
    ["qap-search", "qap-tabs"],
  );
  assert.equal(env.document.body.querySelector(".qap-search").hidden, true);
  assert.deepEqual(
    env.document.body
      .querySelector(".qap-head-actions")
      .children.map((element) => element.querySelector("qap-icon").attributes.icon),
    ["mdi:magnify", "mdi:bookmark-plus-outline", "mdi:cog"],
  );
  openLauncherSettings(env, "settings");
  assert.deepEqual(
    env.document.body.querySelectorAll(".qap-settings-row").map((row) => row.className),
    [
      "qap-settings-row qap-settings-profiles qap-manage-profiles",
      "qap-settings-row qap-settings-shortcuts",
      "qap-settings-row qap-settings-categories",
      "qap-settings-row qap-settings-visibility",
    ],
  );
  returnToLauncher(env);
  env.context.location.pathname = "/config/logs";
  env.window.navigation.dispatchEvent(new Event("currententrychange"));
  assert.equal(env.document.body.querySelector("qap-dialog"), null);
  env.fab().click();
  env.context.location.pathname = "/lovelace/home";
  env.window.dispatchEvent(new Event("popstate"));
  assert.equal(env.document.body.querySelector("qap-dialog"), null);
  assert.equal(env.server.requests.length, 0);
  env.enable(false);
  await flush();
  for (const event of ["popstate", "location-changed", "focus"])
    assert.equal(getEventListeners(env.window, event).length, 0);
  for (const event of ["navigate", "currententrychange"])
    assert.equal(getEventListeners(env.window.navigation, event).length, 0);
  assert.equal(getEventListeners(env.document, "visibilitychange").length, 0);
  assert.equal(env.mutationObservers.size, 0);
  assert.equal(env.timers.size, 0);
});

test("launcher idle fallback recovers silent page changes without inspecting page content", async () => {
  const env = environment();
  let walks = 0;
  const children = env.homeAssistant.children;
  Object.defineProperty(env.homeAssistant, "children", {
    get() {
      walks++;
      return children;
    },
  });
  await startProfiles(env);
  walks = 0;
  env.fab().click();
  env.context.location.pathname = "/config/logs";
  await env.tick(15000);
  assert.equal(env.document.body.querySelector("qap-dialog"), null);
  assert.equal(walks, 0);
  assert.equal([...env.timers.values()].filter(({ delay }) => delay === 15000).length, 1);
  env.enable(false);
  await flush();
  assert.equal(env.mutationObservers.size, 0);
  assert.equal(env.timers.size, 0);
});

for (const grouped of [false, true]) {
  test(`launcher observes ${grouped ? "grouped" : "legacy"} HA contexts for locale, registry, user and connection changes`, async () => {
    const env = environment();
    installLocaleFetch(env);
    const contexts = grouped
      ? ["hassInternationalization", "hassRegistries", "hassConfig", "hassConnection"]
      : ["locale", "entities", "user", "connection"];
    const provider = haContextsProvider(env, contexts);
    statesProvider(env);
    env.status.hass.states = largeStates(50);
    env.status.hass.entities = { name: "Kitchen" };
    env.status.hass.formatEntityName = () => env.status.hass.entities.name;
    const search = await openEntityStates(env);
    search.value = "Kitchen";
    search.dispatchEvent(new Event("input"));
    await env.tick(175);
    assert.equal(env.document.body.querySelector(".qap-count").textContent, "50 entities");
    env.status.hass = { ...env.status.hass, entities: { name: "Bathroom" } };
    provider.publish(contexts[1]);
    await flush();
    await env.tick(250);
    assert.equal(env.document.body.querySelector(".qap-count").textContent, "0 entities");
    const dialog = env.document.body.querySelector("qap-dialog");
    env.status.hass = { ...env.status.hass, language: "hr" };
    provider.publish(contexts[0]);
    await flush();
    assert.equal(env.document.body.querySelector("qap-dialog"), dialog);
    assert.equal(env.document.body.querySelector("qap-dialog").headerTitle, "Preglednik entiteta");
    assert.equal(env.status.subscriptions, 1);
    env.status.hass = { ...env.status.hass, user: { id: "bob" } };
    provider.publish(contexts[2]);
    await flush();
    assert.equal(env.window.quickAccessDebug().activeProfileId, null);
    assert.equal(env.server.listeners.size, 1);
    const replacement = new EventTargetDouble();
    replacement.subscribeMessage = env.connection.subscribeMessage;
    replacement.sendMessagePromise = env.connection.sendMessagePromise;
    env.status.hass = { ...env.status.hass, connection: replacement };
    provider.publish(contexts[3]);
    await flush();
    assert.equal(env.window.quickAccessDebug().profileContextReady, true);
    assert.equal(getEventListeners(env.connection, "ready").length, 0);
    assert.equal(getEventListeners(replacement, "ready").length, 1);
    for (const subscriptions of provider.listeners.values()) assert.equal(subscriptions.size, 1);
    env.enable(false);
    await flush();
    provider.callbacks.forEach((callback) => callback());
    await flush();
    for (const subscriptions of provider.listeners.values()) assert.equal(subscriptions.size, 0);
    assert.equal(env.mutationObservers.size, 0);
    assert.equal(env.timers.size, 0);
  });
}
