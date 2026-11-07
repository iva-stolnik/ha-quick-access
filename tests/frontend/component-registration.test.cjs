// HA component registration, lazy loaders, retries and disposal.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const { getEventListeners } = require("node:events");
const test = require("node:test");
const {
  flush,
  clickAndFlush,
  dispatchAndFlush,
  savedProfile,
  environment,
  openEntityStates,
  statesProvider,
  nativeComponents,
  buttons,
  componentEnvironment,
  openLauncherSettings,
  openSettingsScreen,
  openSettings,
  openShortcutsSettings,
  changeValidationControl,
  activeProfileEditor,
  selectAndFlush,
} = require("./harness.cjs");

test("late helper completion after unload cannot mount a loader or controls", async () => {
  const env = environment();
  nativeComponents(env, false);
  let finishImport;
  env.window.loadCardHelpers = () =>
    new Promise((resolve) => {
      finishImport = resolve;
    });
  await openEntityStates(env);
  env.enable(false);
  finishImport({
    createCardElement: () => ({ constructor: { getConfigElement: async () => {} } }),
  });
  await flush();
  assert.equal(env.document.body.children.length, 0);
  assert.equal(env.timers.size, 0);
});

test("launcher disposal releases every owner and cannot reactivate from late status", async () => {
  const { env, launcher } = await componentEnvironment();
  const subscriptionCount = env.server.listeners.size;
  launcher.start();
  await env.tick();
  assert.equal(env.server.listeners.size, subscriptionCount);
  assert.equal([...env.timers.values()].filter((timer) => timer.delay === 350).length, 0);
  const provider = statesProvider(env);
  env.fab().click();
  env.document.body.querySelector(".qap-tile").click();
  assert.equal(provider.listeners.size, 1);
  launcher.dispose();
  await flush();
  assert.equal(provider.listeners.size, 0);
  assert.equal(env.server.listeners.size, 0);
  assert.equal(getEventListeners(env.connection, "ready").length, 0);
  assert.equal(env.timers.size, 0);
  assert.equal(env.document.body.children.length, 0);
  env.status.callback({ enabled: true });
  launcher.start();
  await flush();
  assert.equal(env.window.quickAccessDebug().integrationEnabled, false);
  assert.equal(env.timers.size, 0);
  assert.equal(env.document.body.children.length, 0);
});

test("disposing a pending lifecycle releases its late subscription without mounting UI", async () => {
  const env = environment();
  let resolve,
    callback,
    releases = 0;
  env.connection.subscribeMessage = (receive) => {
    callback = receive;
    return new Promise((done) => {
      resolve = done;
    });
  };
  const { createLauncher } = await env.run("launcher/launcher-controller.js");
  const launcher = createLauncher();
  launcher.start();
  await env.tick();
  assert.equal(env.window.quickAccessDebug().lifecyclePending, true);
  launcher.dispose();
  callback({ enabled: true });
  resolve(() => {
    releases++;
  });
  await flush();
  assert.equal(releases, 1);
  assert.equal(env.timers.size, 0);
  assert.equal(getEventListeners(env.connection, "ready").length, 0);
  assert.equal(env.document.body.children.length, 0);
});

test("icon-picker loader stops as soon as the picker is registered without waiting for badges", async () => {
  const { env, components, api } = await componentEnvironment();
  components.register("ha-form");
  api.loadHaComponents();
  assert.ok(env.document.body.querySelector("ha-form"));
  assert.equal(components.definitionCalls.has("state-badge"), false);
  components.register("ha-icon-picker");
  await flush();
  assert.equal(env.document.body.querySelector("ha-form"), null);
  assert.equal(
    [...env.timers.values()].some((timer) => timer.delay === 5000),
    false,
  );
});

test("an already registered icon picker never starts a native loader", async () => {
  const { env, components, api } = await componentEnvironment(true);
  let imports = 0;
  env.window.loadCardHelpers = async () => {
    imports++;
  };
  api.loadHaComponents();
  api.loadHaComponents();
  assert.equal(imports, 0);
  assert.equal(components.definitionCalls.size, 0);
});

test("icon-picker loading accepts later prerequisites and keeps one registration watcher", async () => {
  const { env, components, api } = await componentEnvironment();
  api.loadHaComponents();
  assert.equal(env.document.body.querySelector("ha-form"), null);
  components.register("ha-form");
  api.loadHaComponents();
  api.loadHaComponents();
  assert.ok(env.document.body.querySelector("ha-form"));
  await env.tick(5000);
  api.loadHaComponents();
  assert.equal(env.document.body.querySelector("ha-form"), null);
  assert.equal(components.definitionCalls.get("ha-icon-picker"), 1);
});

test("icon picker wrapper stays stable through HA registration and exposes one change subscription", async () => {
  const env = environment();
  const components = nativeComponents(env, false);
  await openShortcutsSettings("/config/logs", undefined, env);
  await clickAndFlush(env.document.body.querySelector(".qap-add-shortcut"));
  const host = env.document.body.querySelector(".qap-icon-field");
  const picker = host.querySelector("qap-icon-picker");
  changeValidationControl(picker, "mdi:hammer");
  components.register();
  await flush();
  assert.equal(host.querySelector("qap-icon-picker"), picker);
  assert.equal(picker.value, "mdi:hammer");
  assert.equal(getEventListeners(picker, "value-changed").length, 1);
  changeValidationControl(picker, "mdi:cog");
  assert.equal(
    env.document.body.querySelector(".qap-shortcut-preview").querySelector("qap-icon").attributes
      .icon,
    "mdi:cog",
  );
});

test("component registration: closing an animated profile dialog cancels upgrades before DOM removal", async () => {
  const env = environment();
  const components = nativeComponents(env, false);
  components.register("ha-form");
  await env.run();
  await env.tick();
  env.enable(true);
  await flush();
  openLauncherSettings(env, "settings");
  env.document.body.querySelector(".qap-manage-profiles").click();
  env.document.body.querySelector(".qap-create-profile").click();
  const modal = activeProfileEditor(env);
  const fallback = modal.querySelector("input, qap-input");
  modal.querySelector(".qap-profile-cancel").click();
  assert.equal(modal.isConnected, false);
  assert.equal(modal.open, false);
  env.enable(false);
  await flush();
  components.register();
  await flush();
  assert.equal(modal.querySelector("input, qap-input"), fallback);
  assert.equal(env.mutationObservers.size, 0);
  assert.equal(env.document.body.children.length, 0);
  assert.equal(env.timers.size, 0);
});

for (const failure of ["reject", "cancel"]) {
  test(`component registration: ${failure} allows only one retry on reopening`, async () => {
    const { env, components, api } = await componentEnvironment();
    let helpers = 0;
    let forms = 0;
    const createElement = env.document.createElement;
    env.document.createElement = (tag) => {
      if (tag === "ha-form") forms++;
      return createElement(tag);
    };
    env.window.loadCardHelpers = async () => {
      helpers++;
      if (failure === "reject") throw new Error("offline");
      components.register("ha-form");
      return { createCardElement: () => ({ constructor: { getConfigElement: async () => {} } }) };
    };
    await clickAndFlush(env.fab());
    assert.ok(env.document.body.querySelector(".qap-tabs"));
    api.loadHaComponents();
    if (failure === "cancel") env.enable(false);
    await flush();
    api.loadHaComponents();
    await env.tick(5000);
    assert.equal(helpers, 1);
    assert.equal(forms, failure === "reject" ? 0 : 1);
    if (failure === "cancel") {
      env.enable(true);
      await flush();
    }
    for (let index = 0; index < 2; index++) {
      env.document.body.querySelector(".qap-head-button")?.click();
      await clickAndFlush(env.fab());
      api.loadHaComponents();
      await env.tick(5000);
    }
    assert.equal(helpers, failure === "reject" ? 2 : 1);
    assert.equal(forms, failure === "reject" ? 0 : 2);
    assert.equal(env.document.body.querySelector("ha-form"), null);
    await dispatchAndFlush(env.connection, new Event("ready"));
    env.enable(false);
    await flush();
    env.enable(true);
    await flush();
    await clickAndFlush(env.fab());
    assert.equal(helpers, failure === "reject" ? 2 : 1);
    assert.equal(forms, failure === "reject" ? 0 : 2);
  });
}

test("component registration: reconnection recovers a rejected import without replacing edited fallbacks", async () => {
  const { env, components, api } = await componentEnvironment();
  let helpers = 0;
  env.window.loadCardHelpers = async () => {
    helpers++;
    if (helpers === 1) throw new Error("offline");
    return {
      createCardElement: () => ({
        constructor: {
          getConfigElement: async () => {
            components.register("ha-form");
          },
        },
      }),
    };
  };
  await clickAndFlush(env.fab());
  env.connection.dispatchEvent(new Event("ready"));
  await flush();
  assert.equal(helpers, 2);
  assert.equal(env.document.body.querySelectorAll("ha-form").length, 1);
  env.document.body.querySelector(".qap-tile").click();
  const host = env.document.body.querySelector(".qap-search");
  const fallback = host.querySelector("input, qap-input, qap-search");
  fallback.value = "logs";
  fallback.dispatchEvent(new Event("input"));
  env.document.activeElement = fallback;
  components.register();
  await flush();
  assert.equal(env.document.body.querySelector("ha-form"), null);
  assert.equal(host.querySelector("input, qap-input, qap-search"), fallback);
  assert.equal(fallback.value, "logs");
  env.document.activeElement = env.fab();
  await dispatchAndFlush(host, new Event("focusout"));
  assert.equal(host.querySelector("qap-search").value, "logs");
  api.loadHaComponents();
  await dispatchAndFlush(env.connection, new Event("ready"));
  assert.equal(helpers, 2);
});

test("component registration: a timed-out helper cannot remove or recreate the active retry loader", async () => {
  const { env, components, api } = await componentEnvironment();
  const imports = [];
  env.window.loadCardHelpers = () => new Promise((resolve) => imports.push(resolve));
  await clickAndFlush(env.fab());
  env.document.body.querySelector(".qap-head-button").click();
  env.fab().click();
  await dispatchAndFlush(env.connection, new Event("ready"));
  assert.equal(imports.length, 1); // Openings and reconnects cannot overlap an active attempt.
  await env.tick(5000);
  env.document.body.querySelector(".qap-head-button").click();
  await clickAndFlush(env.fab());
  assert.equal(imports.length, 2);
  const helpers = {
    createCardElement: () => ({
      constructor: {
        getConfigElement: async () => {
          components.register("ha-form");
        },
      },
    }),
  };
  imports[1](helpers);
  await flush();
  const loader = env.document.body.querySelector("ha-form");
  assert.ok(loader);
  imports[0](helpers);
  await flush();
  assert.equal(env.document.body.querySelector("ha-form"), loader);
  assert.equal(env.document.body.querySelectorAll("ha-form").length, 1);
  await env.tick(5000);
  api.loadHaComponents();
  await dispatchAndFlush(env.connection, new Event("ready"));
  assert.equal(imports.length, 2);
  assert.equal(env.document.body.querySelector("ha-form"), null);
  env.document.body.querySelector(".qap-tile").click();
  components.register("qap-search");
  await flush();
  assert.ok(env.document.body.querySelector("qap-search"));
  env.enable(false);
  await flush();
  assert.equal(env.document.body.children.length, 0);
  assert.equal(env.timers.size, 0);
});

test("component registration: no HA components leaves working HTML UI through reconnect, unload and reload", async () => {
  const env = environment();
  const components = nativeComponents(env, false);
  await openSettings("/config/logs", undefined, env);
  const fallback = env.document.body.querySelector(".qap-textarea");
  fallback.value = "/private/reconnect";
  await dispatchAndFlush(env.connection, new Event("ready"));
  assert.equal(env.document.body.querySelector(".qap-textarea"), fallback);
  await clickAndFlush(env.document.body.querySelector(".qap-save-settings"));
  assert.equal(savedProfile(env).settings.routes[0], "/private/reconnect");
  env.enable(false);
  await flush();
  assert.equal(env.document.body.children.length, 0);
  assert.equal(env.mutationObservers.size, 0);
  assert.equal(env.timers.size, 0);
  env.enable(true);
  await flush();
  await clickAndFlush(env.fab());
  env.document.body.querySelector(".qap-tile").click();
  const input = env.document.body.querySelector(".qap-search-input");
  assert.equal(input.localName, "qap-search");
  input.value = "logs";
  input.dispatchEvent(new Event("input"));
  assert.equal(input.value, "logs");
  assert.ok([...components.definitionCalls.values()].every((count) => count === 1));
});

test("delayed settings components preserve edited drafts and reconnect visibility change handling", async () => {
  const env = environment();
  const components = nativeComponents(env, false);
  components.register("ha-form");
  await openSettings("/config/logs", undefined, env);
  const loader = env.document.body.querySelector("ha-form");
  assert.equal(
    loader.schema.some((field) => field.selector.select),
    false,
    "owned selectors need no HA schema loader",
  );
  env.document.body.querySelector(".qap-textarea").value = "/private/logs";
  env.document.body.querySelector("select, qap-select").value = "include";
  await dispatchAndFlush(
    env.document.body.querySelector("select, qap-select"),
    new Event("change"),
  );
  await clickAndFlush(env.document.body.querySelectorAll(".qap-current-url-action")[1]);
  components.register();
  await new Promise(setImmediate);
  assert.equal(env.document.body.querySelector("ha-form"), null);
  assert.equal(
    env.document.body.querySelector(".qap-textarea").value,
    "/private/logs\n/config/logs/*",
  );
  const mode = env.document.body.querySelector("qap-select");
  assert.equal(mode.value, "include");
  assert.equal(
    env.document.body.querySelectorAll(".qap-current-url-action")[1].querySelector("span")
      .textContent,
    "Remove",
  );
  await selectAndFlush(mode, "exclude");
  assert.equal(
    env.document.body.querySelector("#qap-url-paths-description").textContent,
    "List the page paths where the button should be hidden.",
  );
  await clickAndFlush(env.document.body.querySelector(".qap-current-url-action"));
  await clickAndFlush(env.document.body.querySelector(".qap-save-settings"));
  const saved = savedProfile(env).settings;
  assert.equal(saved.routes[0], "/private/logs");
  assert.equal(saved.visibility, "exclude");
  assert.deepEqual(saved.routes, ["/private/logs", "/config/logs/*", "/config/logs"]);
});

test("failed settings imports keep working fallbacks and late registration after unload cannot remount them", async () => {
  const env = environment();
  const components = nativeComponents(env, false);
  env.window.loadCardHelpers = async () => {
    throw new Error("Unavailable");
  };
  await openSettings("/config/logs", undefined, env);
  await new Promise(setImmediate);
  assert.equal(env.document.body.querySelector("ha-form"), null);
  env.document.body.querySelector(".qap-textarea").value = "/private/fallback";
  await clickAndFlush(env.document.body.querySelector(".qap-save-settings"));
  assert.equal(savedProfile(env).settings.routes[0], "/private/fallback");
  buttons(env.document.body)
    .find((button) => button.title === "Settings")
    .click();
  openSettingsScreen(env, "visibility");
  await flush();
  env.enable(false);
  await flush();
  components.register();
  await new Promise(setImmediate);
  assert.equal(env.document.body.children.length, 0);
  assert.equal(env.timers.size, 0);
});
