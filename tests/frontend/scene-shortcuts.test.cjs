// Scene shortcuts.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  flush,
  clickAndFlush,
  clone,
  filterField,
  setFilterField,
  savedProfile,
  environment,
  buttons,
  openShortcutsSettings,
  startProfiles,
  shortcutAction,
  createModuleLoader,
} = require("./harness.cjs");

test("scene shortcuts only activate the selected scene, handle failures and never navigate", async () => {
  const env = environment();
  const profile = savedProfile(env);
  profile.settings.links = [
    {
      id: "evening",
      name: "Evening",
      icon: "mdi:palette",
      color: "",
      group: "favorites",
      type: "scene",
      path: "scene.evening",
    },
  ];
  env.status.hass.states = {
    "scene.evening": { entity_id: "scene.evening", state: "unknown", attributes: {} },
  };
  const calls = [];
  let reject;
  env.status.hass.callService = (...args) => {
    calls.push(clone(args));
    return new Promise((resolve, fail) => {
      reject = fail;
    });
  };
  await startProfiles(env, false);
  await clickAndFlush(env.fab());
  const dialog = env.document.body.querySelector("qap-dialog");
  const tile = env.document.body.querySelector(".qap-tile");
  const before = clone(profile);
  assert.equal(tile.localName, "button");
  assert.equal(tile.href, undefined);
  assert.equal(tile.querySelector(".qap-tile-badge").attributes.icon, "mdi:palette");
  await clickAndFlush(tile);
  await clickAndFlush(tile);
  assert.deepEqual(calls, [["scene", "turn_on", { entity_id: "scene.evening" }]]);
  reject(new Error("Disconnected"));
  await flush();
  assert.equal(tile.disabled, false);
  assert.equal(
    env.document.body.querySelector("qap-toast").labelText,
    "Could not activate the scene. Try again.",
  );
  env.status.hass.callService = async (...args) => {
    calls.push(clone(args));
  };
  await clickAndFlush(tile);
  assert.equal(calls.length, 2);
  env.status.hass.states["scene.evening"].state = "unavailable";
  await clickAndFlush(tile);
  delete env.status.hass.states["scene.evening"];
  await clickAndFlush(tile);
  assert.equal(calls.length, 2);
  assert.equal(
    env.document.body.querySelector("qap-toast").labelText,
    "Scene unavailable. Choose an available scene.",
  );
  assert.equal(env.document.body.querySelector("qap-dialog"), dialog);
  assert.equal(dialog.headerTitle, "Quick Access");
  assert.deepEqual(savedProfile(env), before);
  assert.equal(env.server.requests.length, 0);
});

test("scene shortcut creation with no scenes disables saving and missing saved scenes remain repairable", async () => {
  const env = environment();
  await openShortcutsSettings("/config/logs", undefined, env);
  await clickAndFlush(env.document.body.querySelector(".qap-add-shortcut"));
  const editor = env.document.body.querySelector(".qap-shortcut-form");
  await setFilterField(editor, "Shortcut type", "scene");
  assert.equal(buttons(editor).find((item) => item.textContent === "Save").disabled, true);
  assert.equal(
    editor.querySelector(".qap-shortcut-scenes").querySelector(".qap-muted").textContent,
    "No scenes are available.",
  );
  await setFilterField(editor, "Shortcut type", "internal");
  assert.equal(buttons(editor).find((item) => item.textContent === "Save").disabled, false);

  const missing = environment();
  const link = {
    id: "missing",
    name: "Missing scene",
    icon: "mdi:palette",
    color: "",
    group: "favorites",
    type: "scene",
    path: "scene.missing",
  };
  savedProfile(missing).settings.links.push(link);
  const loader = createModuleLoader(missing.context);
  const { createLocalizer } = await loader.load("localize.js");
  const { createProfileValidation } = await loader.load("profiles/profile-validation.js");
  const { validateProfileData } = createProfileValidation(createLocalizer());
  const data = clone(missing.server.data("test-user"));
  assert.deepEqual(clone(validateProfileData(data)), data);
  for (const path of [
    "",
    "scene.",
    "light.desk",
    "scene.all,scene.other",
    "scene.bad/name",
    "scene.UPPER",
    "scene.name\n",
  ]) {
    const invalid = clone(data);
    invalid.profiles[0].settings.links.at(-1).path = path;
    assert.throws(() => validateProfileData(invalid), path);
  }
  missing.status.hass.states = {
    "scene.day": { entity_id: "scene.day", state: "unknown", attributes: {} },
  };
  await openShortcutsSettings("/config/logs", undefined, missing);
  const row = missing.document.body
    .querySelectorAll(".qap-edit-item")
    .find((item) => item.dataset.id === link.id);
  await shortcutAction(missing, "edit", row.querySelector(".qap-shortcut-overflow"));
  const repair = missing.document.body.querySelector(".qap-shortcut-form");
  assert.equal(filterField(repair, "Scene").value, "scene.missing");
  assert.equal(buttons(repair).find((item) => item.textContent === "Save").disabled, true);
  await setFilterField(repair, "Scene", "scene.day");
  await clickAndFlush(buttons(repair).find((item) => item.textContent === "Save"));
  assert.equal(savedProfile(missing).settings.links.at(-1).path, "scene.day");
  assert.equal(savedProfile(missing).settings.links.at(-1).name, "Missing scene");
});
