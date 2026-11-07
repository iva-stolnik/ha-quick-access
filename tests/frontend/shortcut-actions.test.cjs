// Shortcut overflow actions, deletion, write failures and retries.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  loadDefaults,
  installLocaleFetch,
  changeLanguage,
  flush,
  clickAndFlush,
  dispatchAndFlush,
  clone,
  savedProfile,
  environment,
  nativeComponents,
  buttons,
  respondToDiscard,
  openSettingsScreen,
  returnToLauncher,
  navigationEnvironment,
  openSettings,
  openShortcutsSettings,
  manyShortcuts,
  openArrangement,
  arrangeKey,
  profileMenuIn,
  shortcutAction,
} = require("./harness.cjs");
let defaultLinks;
test.before(async () => ({ defaultLinks } = await loadDefaults()));

test("failed server writes keep settings draft open and leave active settings unchanged", async () => {
  const initial = { visibility: "exclude", routes: [], links: [] };
  const env = await openSettings("/config", initial);
  const persisted = JSON.stringify(savedProfile(env).settings);
  const paths = env.document.body.querySelector(".qap-textarea");
  paths.value = "/private/logs";
  const save = env.document.body.querySelector(".qap-save-settings");
  const failWrites = env.server.failWrites;
  env.server.failWrites = true;
  await clickAndFlush(save);
  assert.equal(JSON.stringify(savedProfile(env).settings), persisted);
  assert.equal(env.document.body.querySelector("qap-dialog").headerTitle, "Display rules");
  assert.equal(paths.value, "/private/logs");
  assert.match(env.document.body.querySelector(".qap-error").textContent, /Could not save changes/);
  assert.equal(env.window.quickAccessDebug().hiddenByRoute, false);
  env.server.failWrites = failWrites;
  await clickAndFlush(save);
  assert.equal(env.document.body.querySelector("qap-dialog").headerTitle, "Quick Access");
  assert.equal(savedProfile(env).settings.routes[0], "/private/logs");
});

test(`shortcut overflow restores current controls through Back and Forward`, async () => {
  const env = navigationEnvironment();
  await openShortcutsSettings("/config", undefined, env);
  const originalTrigger = env.document.body.querySelector(".qap-shortcut-overflow");
  await clickAndFlush(originalTrigger);
  assert.ok(profileMenuIn(env));
  await env.back();
  assert.equal(profileMenuIn(env), null);
  await env.back();
  assert.ok(env.document.body.querySelector(".qap-settings-overview"));
  await env.forward();
  assert.ok(env.document.body.querySelector(".qap-shortcut-groups"));
  assert.equal(originalTrigger.isConnected, false);
  await env.forward();
  assert.ok(profileMenuIn(env));
  assert.equal(
    env.document.body.querySelector(".qap-shortcut-overflow").attributes["aria-expanded"],
    "true",
  );
  await clickAndFlush(profileMenuIn(env).querySelector(".qap-visibility-shortcut"));
  assert.equal(
    savedProfile(env).settings.links.find((link) => link.id === defaultLinks[0].id).hidden,
    true,
  );
});

test(`shortcut overflow actions persist visibility, duplicate independently and confirm deletion`, async () => {
  const env = environment();
  installLocaleFetch(env);
  const profile = env.server.data("test-user").profiles[0];
  profile.settings.links = manyShortcuts(2);
  profile.settings.links[0].name = "A".repeat(50);
  const original = clone(profile.settings.links[0]);
  await openShortcutsSettings("/config", undefined, env);
  const add = env.document.body.querySelector(".qap-add-shortcut");
  assert.equal(add.querySelector("qap-icon").attributes.icon, "mdi:plus");
  assert.equal(add.title, "Add shortcut");
  assert.ok(add.parentElement.classList.contains("qap-head-actions"));
  const row = (id = original.id) =>
    env.document.body.querySelectorAll(".qap-edit-item").find((item) => item.dataset.id === id);
  const trigger = row().querySelector(".qap-shortcut-overflow");
  assert.equal(trigger.querySelector("qap-icon").attributes.icon, "mdi:dots-vertical");
  assert.equal(trigger.attributes["aria-haspopup"], "menu");
  await dispatchAndFlush(trigger, Object.assign(new Event("keydown"), { key: "ArrowDown" }));
  let menu = profileMenuIn(env);
  assert.equal(menu.localName, "qap-menu");
  assert.equal(menu.querySelectorAll("qap-menu-item").length, 3);
  assert.deepEqual(
    buttons(menu).map((item) => item.textContent),
    ["Disable", "Duplicate", "Delete"],
  );
  assert.deepEqual(
    buttons(menu).map((item) => item.value),
    ["visibility", "duplicate", "delete"],
  );
  assert.equal(menu.querySelector(".qap-edit-shortcut"), null);
  assert.equal(menu.querySelector(".qap-delete-shortcut").getAttribute("variant"), "danger");
  await changeLanguage(env, "hr");
  assert.deepEqual(
    buttons(menu).map((item) => item.textContent),
    ["Onemogu\u0107i", "Dupliciraj", "Izbri\u0161i"],
  );
  assert.equal(trigger.title, `Upravljaj prečacem ${original.name}`);
  await changeLanguage(env, "en");
  assert.equal(menu.anchorElement, trigger);
  await clickAndFlush(menu.querySelector(".qap-visibility-shortcut"));
  assert.equal(
    savedProfile(env).settings.links.find((link) => link.id === original.id).hidden,
    true,
  );
  assert.ok(row().classList.contains("qap-shortcut-hidden"));
  await shortcutAction(env, "edit", row().querySelector(".qap-shortcut-overflow")); // Editing keeps visibility and position.
  await clickAndFlush(
    buttons(env.document.body.querySelector(".qap-shortcut-form")).find(
      (item) => item.textContent === "Save",
    ),
  );
  assert.equal(
    savedProfile(env).settings.links.find((link) => link.id === original.id).hidden,
    true,
  );
  returnToLauncher(env);
  assert.deepEqual(
    env.document.body.querySelectorAll(".qap-tile-name").map((tile) => tile.textContent),
    ["Shortcut 1"],
  );
  const search = env.document.body.querySelector(".qap-search-input");
  search.value = original.name;
  search.dispatchEvent(new Event("input"));
  assert.equal(
    env.document.body.querySelectorAll(".qap-tile").length,
    0,
    "search also excludes hidden shortcuts",
  );
  buttons(env.document.body)
    .find((item) => item.title === "Settings")
    .click();
  openSettingsScreen(env, "shortcuts");
  await clickAndFlush(row().querySelector(".qap-shortcut-overflow"));
  menu = profileMenuIn(env);
  assert.equal(menu.querySelector(".qap-visibility-shortcut").textContent, "Enable");
  await changeLanguage(env, "hr");
  assert.equal(menu.querySelector(".qap-visibility-shortcut").textContent, "Omogući");
  await changeLanguage(env, "en");
  await clickAndFlush(menu.querySelector(".qap-visibility-shortcut"));
  assert.equal(
    savedProfile(env).settings.links.find((link) => link.id === original.id).hidden,
    false,
  );
  await shortcutAction(env, "duplicate", row().querySelector(".qap-shortcut-overflow"));
  const links = savedProfile(env).settings.links;
  assert.equal(links.length, 3);
  const copy = links.at(-1);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.name.length, 50);
  assert.match(copy.name, / \(Copy\)$/);
  assert.deepEqual(
    { ...copy, id: original.id, name: original.name },
    { ...original, hidden: false },
  );
  await shortcutAction(env, "edit", row(copy.id).querySelector(".qap-shortcut-overflow"));
  const editor = env.document.body.querySelector(".qap-shortcut-form");
  (editor.querySelector("qap-input") || editor.querySelector("input, qap-input")).value =
    "Independent copy";
  await clickAndFlush(buttons(editor).find((item) => item.textContent === "Save"));
  assert.equal(
    savedProfile(env).settings.links.find((link) => link.id === original.id).name,
    original.name,
  );
  assert.equal(
    savedProfile(env).settings.links.find((link) => link.id === copy.id).name,
    "Independent copy",
  );
  await clickAndFlush(row().querySelector(".qap-shortcut-overflow"));
  await clickAndFlush(profileMenuIn(env).querySelector(".qap-delete-shortcut"));
  assert.equal(env.document.body.querySelector(".qap-shortcut-form"), null);
  let confirmation = env.document.body.querySelector(".qap-delete-confirmation");
  assert.equal(savedProfile(env).settings.links.length, 3);
  await clickAndFlush(buttons(confirmation).find((item) => item.textContent === "Cancel"));
  assert.equal(savedProfile(env).settings.links.length, 3);
  await clickAndFlush(row().querySelector(".qap-shortcut-overflow"));
  await clickAndFlush(profileMenuIn(env).querySelector(".qap-delete-shortcut"));
  confirmation = env.document.body.querySelector(".qap-delete-confirmation");
  await clickAndFlush(confirmation.querySelector(".qap-button-danger"));
  assert.deepEqual(
    savedProfile(env).settings.links.map((item) => item.id),
    ["shortcut-1", copy.id],
  );
  await clickAndFlush(env.document.body.querySelector(".qap-add-shortcut"));
  assert.ok(env.document.body.querySelector(".qap-shortcut-form"));
});

test(`shortcut overflow failures retain rows and allow retry`, async () => {
  const env = environment();
  await openShortcutsSettings("/config", undefined, env);
  const before = clone(savedProfile(env).settings.links);
  const failWrites = env.server.failWrites;
  for (const action of ["visibility", "duplicate", "delete"]) {
    env.server.failWrites = true;
    await shortcutAction(env, action);
    if (action === "delete")
      await clickAndFlush(
        env.document.body
          .querySelector(".qap-delete-confirmation")
          .querySelector(".qap-button-danger"),
      );
    assert.deepEqual(savedProfile(env).settings.links, before);
    assert.equal(env.document.body.querySelectorAll(".qap-edit-item").length, before.length);
    assert.match(
      env.document.body.querySelector(".qap-profile-status").querySelector(".qap-error")
        .textContent,
      /Could not save changes/,
    );
  }
  await clickAndFlush(
    buttons(env.document.body.querySelector(".qap-delete-confirmation")).find(
      (button) => button.textContent === "Cancel",
    ),
  );
  env.document.body.querySelector(".qap-profile-close").click();
  env.server.failWrites = failWrites;
  await shortcutAction(env, "visibility");
  assert.equal(
    savedProfile(env).settings.links.find((link) => link.id === before[0].id).hidden,
    true,
  );
  assert.equal(
    env.document.body.querySelector(".qap-profile-status").querySelector(".qap-error"),
    null,
  );
});

test(`shortcut deletion requires confirmation and cancellation preserves shortcuts`, async () => {
  const env = environment();
  const createElement = env.document.createElement;
  env.document.createElement = (tag) => {
    const element = createElement(tag);
    element.focus = () => {
      env.document.activeElement = element;
    };
    return element;
  };
  await openShortcutsSettings("/config", undefined, env);
  const list = env.document.body.querySelector(".qap-shortcut-groups");
  const original = clone(savedProfile(env));
  const remove = env.document.body.querySelector(".qap-shortcut-overflow");
  const openConfirmation = async () => {
    await shortcutAction(env, "delete", remove);
    const modal = env.document.body.querySelector(".qap-delete-confirmation");
    assert.equal(modal.localName, "qap-dialog");
    assert.equal(modal.open, true);
    assert.equal(modal.attributes["aria-labelledby"], "qap-delete-title");
    assert.equal(modal.attributes["aria-describedby"], "qap-delete-description");
    assert.equal(modal.attributes.type, "alert");
    assert.equal(
      modal.querySelector("#qap-delete-description").textContent,
      'Are you sure you want to delete shortcut "Entity Explorer"?',
    );
    assert.equal(env.document.activeElement.textContent, "Cancel");
    assert.equal(env.server.data("test-user").revision, 0);
    assert.equal(env.document.body.querySelectorAll(".qap-delete-confirmation").length, 1);
    return modal;
  };
  const checkCancelled = (modal) => {
    assert.equal(modal.open, false);
    assert.equal(modal.isConnected, false);
    assert.equal(
      env.document.activeElement,
      env.document.body.querySelector(".qap-shortcut-form").querySelector(".qap-delete-shortcut"),
    );
    assert.equal(env.document.body.querySelector(".qap-shortcut-groups"), list);
    assert.deepEqual(savedProfile(env), original);
    assert.equal(env.server.data("test-user").revision, 0);
    // A stale click after dismissal cannot delete anything.
    modal.querySelector(".qap-button-danger").click();
    assert.equal(env.server.data("test-user").revision, 0);
  };
  let modal = await openConfirmation();
  await clickAndFlush(buttons(modal).find((button) => button.textContent === "Cancel"));
  checkCancelled(modal);
  modal = await openConfirmation();
  await dispatchAndFlush(modal, new Event("cancel", { cancelable: true }));
  checkCancelled(modal);
  modal = await openConfirmation();
  modal.dispatchEvent(
    new CustomEvent("cancel", { cancelable: true, detail: { source: "backdrop" } }),
  );
  await flush();
  checkCancelled(modal);
  modal = await openConfirmation();
  const confirm = modal.querySelector(".qap-button-danger");
  await clickAndFlush(confirm);
  assert.equal(env.document.body.querySelector("qap-dialog").headerTitle, "Shortcuts");
  const saved = savedProfile(env).settings;
  assert.deepEqual(
    saved.links.map((link) => link.id),
    defaultLinks.slice(1).map((link) => link.id),
  );
  await clickAndFlush(confirm);
  assert.deepEqual(savedProfile(env).settings, saved);
});

test(`closing shortcut settings invalidates pending deletion`, async () => {
  for (const exit of ["back", "close", "navigate", "disable"]) {
    const env = environment();
    await openShortcutsSettings("/config", undefined, env);
    await shortcutAction(env, "delete");
    const modal = env.document.body.querySelector(".qap-delete-confirmation");
    if (exit === "back") env.document.body.querySelector(".qap-head-button").click();
    if (exit === "close")
      env.document.body.querySelector("qap-dialog").dispatchEvent(new Event("cancel"));
    if (exit === "navigate") {
      env.context.location.pathname = "/config/devices";
      await dispatchAndFlush(env.window, new Event("location-changed"));
    }
    if (exit === "disable") {
      env.enable(false);
      await flush();
      assert.equal(modal.isConnected, false);
    }
    assert.equal(modal.open, false);
    assert.equal(modal.isConnected, false);
    await clickAndFlush(modal.querySelector(".qap-button-danger"));
    assert.equal(env.server.data("test-user").revision, 0);
  }
});

test(`existing shortcut editor orders Delete before Save and discards edits through X`, async () => {
  const env = environment();
  await openShortcutsSettings("/config", undefined, env);
  const original = clone(savedProfile(env));
  const writes = env.server.requests.length;
  await shortcutAction(env);
  const editor = env.document.body.querySelector(".qap-shortcut-form");
  assert.deepEqual(
    buttons(editor.querySelector(".qap-form-actions")).map((button) => button.textContent),
    ["Delete", "Save"],
  );
  assert.equal(editor.querySelector(".qap-cancel-shortcut"), null);
  const name = editor.querySelector("qap-input") || editor.querySelector("input, qap-input");
  name.value = "Discarded name";
  name.dispatchEvent(new Event("input"));
  await clickAndFlush(editor.querySelector(".qap-profile-close"));
  assert.equal(env.document.body.querySelector(".qap-shortcut-form"), editor);
  respondToDiscard(env);
  await flush();
  assert.ok(env.document.body.querySelector(".qap-shortcut-groups"));
  assert.deepEqual(savedProfile(env), original);
  assert.equal(env.server.requests.length, writes);
});

test("shortcut edit and delete stay on screen after write failures and retry cleanly", async () => {
  const env = await openShortcutsSettings("/config");
  await shortcutAction(env);
  const editor = env.document.body.querySelector(".qap-shortcut-form");
  const name = editor.querySelector("input, qap-input");
  name.value = "Changed shortcut";
  const failWrites = env.server.failWrites;
  env.server.failWrites = true;
  await clickAndFlush(buttons(editor).find((element) => element.textContent === "Save"));
  assert.equal(env.document.body.querySelector(".qap-shortcut-form"), editor);
  assert.equal(name.value, "Changed shortcut");
  assert.match(editor.querySelector(".qap-error").textContent, /Could not save changes/);
  assert.equal(env.server.data("test-user").revision, 0);
  env.server.failWrites = failWrites;
  await clickAndFlush(buttons(editor).find((element) => element.textContent === "Save"));
  assert.equal(env.document.body.querySelector("qap-dialog").headerTitle, "Shortcuts");
  assert.equal(savedProfile(env).settings.links[0].name, "Changed shortcut");
  const revision = env.server.data("test-user").revision;
  env.server.failWrites = true;
  await shortcutAction(env, "delete");
  await clickAndFlush(
    env.document.body.querySelector(".qap-delete-confirmation").querySelector(".qap-button-danger"),
  );
  assert.ok(env.document.body.querySelector(".qap-shortcut-groups"));
  assert.equal(env.server.data("test-user").revision, revision);
  assert.equal(savedProfile(env).settings.links[0].name, "Changed shortcut");
  assert.match(
    env.document.body.querySelector(".qap-profile-status").querySelector(".qap-error").textContent,
    /Could not save changes/,
  );
  env.server.failWrites = failWrites;
  await shortcutAction(env, "delete");
  await clickAndFlush(
    env.document.body.querySelector(".qap-delete-confirmation").querySelector(".qap-button-danger"),
  );
  assert.equal(
    savedProfile(env).settings.links.some((link) => link.name === "Changed shortcut"),
    false,
  );
});

test("failed category ordering Save retains the draft and can be retried", async () => {
  const env = environment();
  nativeComponents(env);
  await openShortcutsSettings("/config", undefined, env);
  const view = await openArrangement(env);
  const initial = view.ids();
  await arrangeKey(view.list.children[0], "ArrowRight");
  const draft = view.ids();
  assert.equal(env.server.requests.length, 0);
  env.server.failWrites = true;
  await clickAndFlush(view.form.querySelector(".qap-category-submit"));
  assert.deepEqual(view.ids(), draft);
  assert.deepEqual(
    savedProfile(env).settings.links.map((link) => link.id),
    initial,
  );
  assert.match(view.form.querySelector(".qap-error").textContent, /Could not save changes/);
  env.server.failWrites = false;
  await clickAndFlush(view.form.querySelector(".qap-category-submit"));
  assert.deepEqual(
    savedProfile(env).settings.links.map((link) => link.id),
    draft,
  );
  assert.equal(view.form.isConnected, false);
});
