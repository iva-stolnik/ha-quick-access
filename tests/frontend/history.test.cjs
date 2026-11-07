// Browser history Back/Forward through launcher dialogs and editors.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const { getEventListeners } = require("node:events");
const test = require("node:test");
const {
  clickAndFlush,
  savedProfile,
  environment,
  openEntityStates,
  deviceFixture,
  openDevices,
  nativeComponents,
  buttons,
  respondToDiscard,
  openLauncherSettings,
  navigationEnvironment,
  startProfiles,
  profileNameInput,
  manageProfile,
  categoryInput,
  openCategoriesManager,
  openCategoryCreate,
} = require("./harness.cjs");

test(`history Back and Forward walk settings, close home and preserve HA state`, async () => {
  const env = navigationEnvironment();
  await startProfiles(env);
  openLauncherSettings(env, "settings");
  env.document.body.querySelector(".qap-settings-visibility").click();
  await env.settle();
  const history = env.window.history;
  assert.equal(history.length, 4, "home, overview and visibility each own one entry");
  assert.equal(env.window.location.pathname, "/lovelace/home");
  assert.equal(history.state.keep, "HA state");
  await env.back();
  assert.ok(env.document.body.querySelector(".qap-settings-overview"));
  await env.back();
  assert.ok(env.document.body.querySelector(".qap-home"));
  const dialog = env.document.body.querySelector(".qap-home-dialog");
  await env.back();
  assert.equal(dialog.open, false);
  assert.equal(env.historyIndex(), 0);
  assert.equal(env.window.location.pathname, "/lovelace/home");
  await env.forward();
  assert.ok(env.document.body.querySelector(".qap-home"));
  await env.forward();
  assert.ok(env.document.body.querySelector(".qap-settings-overview"));
  await env.forward();
  assert.ok(env.document.body.querySelector(".qap-textarea"));
  assert.equal(history.length, 4, "Forward never pushes entries");
});

test("browser Back protects drafts, canceled discard preserves DOM, and rapid Back uses one prompt", async () => {
  const env = await startProfiles(navigationEnvironment());
  openLauncherSettings(env);
  const draft = env.document.body.querySelector("textarea");
  draft.value = "/draft/*";
  await env.settle();
  const originalIndex = env.historyIndex();
  await env.back();
  const prompt = env.document.body.querySelector(".qap-discard-changes-confirmation");
  assert.ok(prompt);
  assert.equal(env.historyIndex(), originalIndex, "history is restored before prompting");
  env.window.history.back();
  env.window.history.back();
  await env.settle();
  assert.equal(env.document.body.querySelector(".qap-discard-changes-confirmation"), prompt);
  respondToDiscard(env, false);
  await env.settle();
  assert.equal(draft.isConnected, true);
  assert.equal(draft.value, "/draft/*");
  assert.equal(env.historyIndex(), originalIndex);
  await env.back();
  respondToDiscard(env);
  await env.settle();
  assert.equal(draft.isConnected, false);
  assert.ok(env.document.body.querySelector(".qap-settings-overview"));
  await env.forward();
  assert.equal(env.document.body.querySelector("textarea").value, "");
});

test("profile and group editors use history and guard the departing form", async () => {
  const env = await startProfiles(navigationEnvironment());
  const editor = await manageProfile(env, "test-profile", "edit");
  await env.settle();
  profileNameInput(editor).value = "Keep profile draft";
  await env.back();
  respondToDiscard(env, false);
  assert.equal(editor.open, true);
  assert.equal(profileNameInput(editor).value, "Keep profile draft");
  await env.back();
  respondToDiscard(env);
  await env.settle();
  assert.equal(editor.open, false);
  await env.forward();
  assert.ok(env.document.body.querySelector(".qap-profile-editor"));
  await env.back();
  env.document.body.querySelector(".qap-head-button").click();
  await env.settle();
  env.document.body.querySelector(".qap-settings-shortcuts").click();
  const manager = openCategoriesManager(env);
  await env.settle();
  manager.querySelector(".qap-create-category").click();
  await env.settle();
  const category = env.document.body.querySelector(".qap-category-form");
  categoryInput(category).value = "Group draft";
  await env.back();
  respondToDiscard(env, false);
  assert.equal(category.isConnected, true);
  await env.back();
  respondToDiscard(env);
  await env.settle();
  assert.equal(category.isConnected, false);
  assert.equal(manager.open, true);
  await env.back();
  assert.equal(manager.querySelector(".qap-categories-manager"), null);
  await env.forward();
  await env.forward();
  assert.ok(env.document.body.querySelector(".qap-category-form"));
});

test("inline group Back preserves its dirty shortcut parent and restores editor return paths", async () => {
  const env = await startProfiles(navigationEnvironment());
  env.fab().click();
  env.document.body.querySelector(".qap-save-current-page").click();
  await env.settle();
  const shortcut = env.document.body.querySelector(".qap-shortcut-form");
  shortcut.querySelector("input, qap-input").value = "Shortcut draft";
  const category = await openCategoryCreate(env);
  await env.settle();
  await env.back();
  assert.equal(category.isConnected, false);
  assert.equal(shortcut.isConnected, true);
  assert.equal(shortcut.querySelector("input, qap-input").value, "Shortcut draft");
  assert.equal(env.document.body.querySelector(".qap-confirmation"), null);
  await env.back();
  respondToDiscard(env);
  await env.settle();
  assert.ok(env.document.body.querySelector(".qap-home"));
  await env.forward();
  assert.ok(env.document.body.querySelector(".qap-shortcut-form"));
  await env.back();
  assert.ok(env.document.body.querySelector(".qap-home"));
});

for (const kind of ["states", "devices"]) {
  test(`history closes and restores ${kind} details before its list`, async () => {
    const env = navigationEnvironment();
    env.status.hass.states = {
      "sensor.test": { entity_id: "sensor.test", state: "on", attributes: {} },
    };
    if (kind === "devices") {
      env.status.hass.devices = { device_a: deviceFixture() };
      await openDevices(env);
    } else await openEntityStates(env);
    env.document.body.querySelector(".qap-state-summary").click();
    await env.settle();
    const details = env.document.body.querySelector(".qap-state-modal");
    buttons(details)
      .find((button) => button.title === "Back")
      .click();
    await env.settle();
    assert.equal(details.open, false);
    assert.ok(env.document.body.querySelector(".qap-states"));
    await env.back();
    assert.ok(env.document.body.querySelector(".qap-home"));
    await env.forward();
    await env.forward();
    assert.ok(env.document.body.querySelector(".qap-state-modal"));
  });
}

for (const origin of ["home", "shortcuts"]) {
  test(`shortcut editor returns to ${origin} after Back and Save`, async () => {
    const env = navigationEnvironment();
    savedProfile(env).settings.links = [];
    await startProfiles(env);
    if (origin === "home") {
      env.fab().click();
      env.document.body.querySelector(".qap-empty").querySelector(".qap-button-primary").click();
    } else {
      openLauncherSettings(env, "shortcuts");
      env.document.body.querySelector(".qap-add-shortcut").click();
    }
    await env.settle();
    const editorIndex = env.historyIndex();
    env.document.body
      .querySelector(".qap-shortcut-editor")
      .querySelector(".qap-editor-close")
      .click();
    await env.settle();
    const destination = origin === "home" ? ".qap-home" : ".qap-shortcut-groups";
    assert.ok(env.document.body.querySelector(destination));
    assert.equal(env.historyIndex(), editorIndex - 1);
    await env.forward();
    const editor = env.document.body.querySelector(".qap-shortcut-form");
    editor.querySelector("input, qap-input").value = "Saved shortcut";
    editor.querySelectorAll("input, qap-input").at(-1).value = "/config";
    await clickAndFlush(buttons(editor).find((button) => button.textContent === "Save"));
    await env.settle();
    assert.ok(env.document.body.querySelector(destination));
    assert.equal(env.historyIndex(), editorIndex - 1);
    assert.equal(savedProfile(env).settings.links[0].name, "Saved shortcut");
  });
}

test("outside dismissal and UI Back unwind history; reopening branches without duplicate entries", async () => {
  const env = await startProfiles(navigationEnvironment());
  openLauncherSettings(env, "settings");
  env.document.body.querySelector(".qap-settings-shortcuts").click();
  await env.settle();
  env.document.body.querySelector(".qap-head-button").click();
  await env.settle();
  assert.equal(env.historyIndex(), 2);
  env.document.body
    .querySelector(".qap-settings-dialog")
    .dispatchEvent(new Event("cancel", { cancelable: true }));
  await env.settle();
  assert.equal(env.historyIndex(), 0);
  assert.equal(env.document.body.querySelector("qap-dialog"), null);
  env.fab().click();
  await env.settle();
  assert.equal(env.historyIndex(), 1);
  assert.equal(env.window.history.length, 2, "reopening replaces the old forward branch");
});

test("committed HA sidebar navigation is not replayed and retired dialog entries are skipped", async () => {
  const env = await startProfiles(navigationEnvironment());
  openLauncherSettings(env, "settings");
  await env.settle();
  const history = env.window.history;
  history.pushState({ ha: "sidebar" }, "", "/config/logs");
  env.window.dispatchEvent(new Event("location-changed"));
  await env.settle();
  assert.equal(env.document.body.querySelector("qap-dialog"), null);
  assert.equal(env.window.location.pathname, "/config/logs");
  assert.deepEqual(history.state, { ha: "sidebar" });
  await env.back();
  assert.equal(env.historyIndex(), 0, "one Back skips retired Quick Access entries");
  assert.equal(env.document.body.querySelector("qap-dialog"), null);
  await env.forward();
  assert.equal(env.window.location.pathname, "/config/logs");
  assert.equal(env.document.body.querySelector("qap-dialog"), null);
});

test("reloaded history and disconnected sessions cannot restore obsolete dialogs or drafts", async () => {
  const env = await startProfiles(navigationEnvironment());
  openLauncherSettings(env);
  await env.settle();
  env.enable(false);
  await env.settle();
  assert.equal(env.historyIndex(), 0);
  assert.equal(env.document.body.querySelector("qap-dialog"), null);
  assert.equal(getEventListeners(env.window, "popstate").length, 0);
  // Simulate the browser restoring an entry from a previous frontend session.
  await env.forward();
  assert.equal(env.historyIndex(), 1);
  env.enable(true);
  await env.tick();
  await env.settle();
  assert.equal(env.historyIndex(), 0);
  assert.equal(env.document.body.querySelector("qap-dialog"), null);
  await env.forward();
  assert.equal(env.historyIndex(), 0, "reload history cannot revive a previous session");
  env.fab().click();
  await env.settle();
  assert.equal(env.historyIndex(), 1);
  assert.ok(env.document.body.querySelector(".qap-home"));
});

for (const method of ["pushState", "replaceState"]) {
  test(`HA ${method} preserves its state when it copies the Quick Access namespace`, async () => {
    const env = await startProfiles(navigationEnvironment());
    openLauncherSettings(env, "settings");
    const history = env.window.history;
    history[method]({ ...history.state, ha: "sidebar" }, "", "/config/logs");
    env.window.dispatchEvent(new Event("location-changed"));
    await env.settle();
    assert.deepEqual(history.state, { keep: "HA state", ha: "sidebar" });
    assert.equal(env.window.location.pathname, "/config/logs");
    await env.back();
    assert.equal(env.historyIndex(), 0);
    await env.forward();
    assert.equal(env.window.location.pathname, "/config/logs");
    assert.equal(env.document.body.querySelector("qap-dialog"), null);
  });
}

test("history write failures retain a usable launcher with its existing draft guards", async () => {
  const env = navigationEnvironment();
  env.window.history.pushState = () => {
    throw new Error("History unavailable");
  };
  await startProfiles(env);
  openLauncherSettings(env);
  await env.settle();
  const draft = env.document.body.querySelector("textarea");
  assert.ok(draft);
  draft.value = "/keep/draft";
  env.document.body.querySelector(".qap-head-button").click();
  respondToDiscard(env, false);
  assert.equal(draft.isConnected, true);
  assert.equal(draft.value, "/keep/draft");
});

test("Back closes inline group creation before its dirty parent and Forward restores it", async () => {
  const env = await startProfiles(navigationEnvironment());
  env.fab().click();
  env.document.body.querySelector(".qap-save-current-page").click();
  const draft = env.document.body
    .querySelector(".qap-shortcut-form")
    .querySelector("input, qap-input");
  draft.value = "Dirty parent";
  await openCategoryCreate(env);
  await env.settle();
  assert.ok(env.document.body.querySelector(".qap-category-form"));
  await env.back();
  assert.equal(env.document.body.querySelector(".qap-category-form"), null);
  assert.equal(draft.value, "Dirty parent");
  assert.equal(env.document.body.querySelector(".qap-confirmation"), null);
  await env.forward();
  assert.ok(env.document.body.querySelector(".qap-category-form"));
});

test("page navigation retains unsaved profile editor drafts outside the launcher surface", async () => {
  const env = await startProfiles(environment());
  const editor = await manageProfile(env, "test-profile", "edit");
  const name = profileNameInput(editor);
  name.value = "Keep profile draft";
  env.window.location.pathname = "/config/logs";
  env.window.dispatchEvent(new Event("popstate"));
  respondToDiscard(env, false);
  assert.equal(editor.open, true);
  assert.equal(name.value, "Keep profile draft");
  assert.equal(env.window.location.pathname, "/config/logs");
  env.window.location.pathname = "/lovelace/other";
  env.window.dispatchEvent(new Event("popstate"));
  respondToDiscard(env);
  assert.equal(editor.open, false);
  assert.equal(env.server.requests.length, 0);
});
