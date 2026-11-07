// Profile management rows, create/duplicate/edit dialogs and editors.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const { getEventListeners } = require("node:events");
const test = require("node:test");
const {
  loadDefaults,
  flush,
  clickAndFlush,
  dispatchAndFlush,
  defaultCategories,
  defaultSettings,
  clone,
  savedProfile,
  Element,
  environment,
  nativeComponents,
  buttons,
  respondToDiscard,
  changeValidationControl,
  arrangementPointer,
  arrangeKey,
  delayNativeFocus,
  startProfiles,
  profileManager,
  profileRowIn,
  activeProfileEditor,
  profileMenuIn,
  profileNameInput,
  manageProfile,
  createProfileInDialog,
  trackFocus,
  chooseProfileCopy,
  profileIconControl,
  setProfileIcon,
  selectionKey,
} = require("./harness.cjs");
let defaultLinks;
test.before(async () => ({ defaultLinks } = await loadDefaults()));

test(`Profiles use static shortcut rows sorted by name`, async () => {
  const env = environment();
  const data = env.server.data("test-user"),
    active = data.profiles[0];
  data.profiles = [
    { ...clone(active), id: "z", name: "Zulu" },
    active,
    { ...clone(active), id: "a", name: "Alpha" },
    { ...clone(active), id: "m", name: "Middle" },
  ];
  const stored = clone(data.profiles);
  const manager = await profileManager(await startProfiles(env));
  const list = manager.querySelector(".qap-profile-list");
  assert.deepEqual(
    list.children.map((row) => row.dataset.id),
    ["a", "m", "z"],
  );
  assert.equal(list.classList.contains("qap-reorder-list"), false);
  assert.equal(manager.querySelector("qap-sortable"), null);
  for (const row of list.children) {
    assert.equal(row.classList.contains("qap-edit-item"), true);
    assert.equal(row.getAttribute("aria-keyshortcuts"), null);
    assert.equal(row.tabIndex, undefined);
    const pointer = arrangementPointer(env, row);
    pointer("pointerdown");
    await env.tick(400);
    pointer("pointermove");
    pointer("pointerup");
    await arrangeKey(row, "ArrowDown");
    assert.equal(row.classList.contains("qap-dragging"), false);
  }
  assert.equal(env.server.requests.length, 0);
  assert.deepEqual(data.profiles, stored, "display sorting never writes or mutates stored order");
  data.profiles.find((profile) => profile.id === "z").name = "Aardvark";
  env.server.notify("test-user");
  await flush();
  assert.deepEqual(
    manager.querySelector(".qap-profile-list").children.map((row) => row.dataset.id),
    ["z", "a", "m"],
  );
  assert.equal(env.window.quickAccessDebug().activeProfileId, active.id);
});

test("Profile rows edit on click and activation switches only from the separate Use button", async () => {
  const env = environment();
  nativeComponents(env);
  env.server.data("test-user").profiles.push({
    id: "other",
    name: "Other device",
    icon: "mdi:devices",
    settings: defaultSettings(),
    favorites: [],
    categories: defaultCategories(),
  });
  await startProfiles(env);
  trackFocus(env);
  const manager = await profileManager(env);
  const row = profileRowIn(manager, "other");
  const content = row.querySelector(".qap-profile-content");
  const activate = row.querySelector(".qap-profile-activate");
  const overflow = row.querySelector(".qap-profile-overflow");
  const current = profileRowIn(manager, "test-profile");
  const confirmation = () => env.document.body.querySelector(".qap-confirmation");
  assert.equal(content.localName, "button");
  assert.equal(content.type, "button");
  assert.equal(content.attributes["aria-description"], "Edit profile");
  assert.equal(activate.localName, "qap-button");
  assert.equal(activate.textContent, "Use");
  assert.equal(activate.attributes["aria-label"], "Use Other device");
  assert.equal(activate.attributes["aria-haspopup"], undefined);
  assert.deepEqual(
    row.children,
    [content, activate, overflow],
    "edit, Use and overflow are sibling controls",
  );
  assert.deepEqual(buttons(content), [], "the edit button contains no nested controls");
  assert.equal(row.querySelector(".qap-edit-symbol").parentElement, content);
  assert.equal(content.contains(row.querySelector(".qap-edit-texts")), true);
  assert.equal(row.attributes.role, undefined);
  assert.equal(row.tabIndex, undefined);
  assert.equal(
    current.querySelector(".qap-profile-activate"),
    null,
    "the active profile has no Use action",
  );
  for (const [target, name] of [
    [current, "Default"],
    [row, "Other device"],
  ]) {
    const before = env.server.requests.length;
    target.click();
    assert.equal(activeProfileEditor(env), undefined, "the row container itself is not a control");
    await clickAndFlush(target.querySelector(".qap-profile-content"));
    const editor = activeProfileEditor(env);
    assert.equal(editor.querySelector(".qap-title").textContent, "Edit profile");
    assert.equal(profileNameInput(editor).value, name);
    assert.equal(
      env.window.quickAccessDebug().activeProfileId,
      "test-profile",
      "editing never switches profiles",
    );
    await clickAndFlush(editor.querySelector(".qap-profile-close"));
    editor.dispatchEvent(new Event("closed"));
    await flush();
    assert.equal(activeProfileEditor(env), undefined);
    assert.equal(env.server.requests.length, before);
  }
  overflow.click();
  assert.ok(profileMenuIn(env));
  assert.equal(activeProfileEditor(env), undefined, "overflow never opens the editor");
  assert.equal(confirmation(), null);
  overflow.click();
  assert.equal(profileMenuIn(env), null);
  assert.equal(env.window.quickAccessDebug().activeProfileId, "test-profile");
  activate.click();
  assert.equal(env.window.quickAccessDebug().activeProfileId, "other");
  assert.equal(activeProfileEditor(env), undefined, "Use never opens the editor");
  assert.equal(confirmation(), null);
  assert.equal(
    env.document.activeElement,
    profileRowIn(manager, "other").querySelector(".qap-profile-overflow"),
  );
  assert.equal(JSON.parse(env.storage.get(selectionKey())), "other");
  assert.equal(env.server.requests.length, 0, "activation only changes this browser's selection");
  assert.deepEqual(
    manager.querySelector(".qap-profile-list").children.map((item) => item.dataset.id),
    ["test-profile"],
  );
  activate.click();
  assert.equal(
    env.window.quickAccessDebug().activeProfileId,
    "other",
    "detached activation buttons are ignored",
  );
});

test("Profile activation rejects profiles deleted while the menu is open", async () => {
  const env = environment();
  env.server.data("test-user").profiles.push({
    id: "other",
    name: "Other",
    icon: "mdi:devices",
    settings: defaultSettings(),
    favorites: [],
    categories: defaultCategories(),
  });
  await startProfiles(env);
  const manager = await profileManager(env);
  const row = profileRowIn(manager, "other");
  row.querySelector(".qap-profile-overflow").click();
  await env.server.mutate("test-user", { operation: "delete", profile_id: "other", revision: 0 });
  row.querySelector(".qap-profile-activate").click();
  assert.equal(env.window.quickAccessDebug().activeProfileId, "test-profile");
  assert.match(
    env.document.body.querySelector(".qap-error").textContent,
    /profile no longer exists/,
  );
});

test("first-run setup explains the defaults and retains its label until creation succeeds", async () => {
  const env = await startProfiles(environment(undefined, undefined, { fresh: true }), false);
  const label = env.fab().querySelector(".qap-fab-setup-label");
  assert.equal(label.textContent, "Set up Quick Access");
  env.fab().click();
  const manager = env.document.body.querySelector("qap-dialog");
  assert.equal(manager.headerTitle, "Set up Quick Access");
  assert.equal(
    manager.querySelector(".qap-settings-desc").textContent,
    "Start with shortcuts to your entities and devices. Customize them whenever you want.",
  );
  const initialize = manager.querySelector(".qap-create-default-profile");
  assert.equal(initialize.textContent, "Start with defaults");
  env.server.failWrites = true;
  await clickAndFlush(initialize);
  assert.equal(env.fab().querySelector(".qap-fab-setup-label"), label);
  assert.ok(manager.querySelector(".qap-profiles"));
  env.server.failWrites = false;
  await clickAndFlush(manager.querySelector(".qap-create-default-profile"));
  assert.ok(manager.querySelector(".qap-home"));
  assert.equal(env.fab().querySelector(".qap-fab-setup-label"), null);
  const settings = await profileManager(env);
  assert.equal(settings.headerTitle, "Profiles");
  assert.match(settings.querySelector(".qap-settings-desc").textContent, /local to this browser/);
  env.enable(false);
  env.enable(true);
  await flush();
  assert.equal(env.fab().querySelector(".qap-fab-setup-label"), null);
});

for (const origin of [undefined, "https://ha.example.org"]) {
  test(`onboarding Use opens launcher home without a previous selection (${origin || "local"})`, async () => {
    const env = environment(origin);
    env.storage.delete(selectionKey());
    await startProfiles(env);
    trackFocus(env);
    env.fab().click();
    const manager = env.document.body.querySelector("qap-dialog");
    assert.ok(manager.querySelector(".qap-profiles"));
    assert.equal(env.window.quickAccessDebug().activeProfileId, null);

    await clickAndFlush(
      profileRowIn(manager, "test-profile").querySelector(".qap-profile-activate"),
    );

    assert.equal(env.window.quickAccessDebug().activeProfileId, "test-profile");
    assert.equal(JSON.parse(env.storage.get(selectionKey())), "test-profile");
    assert.equal(env.fab().querySelector(".qap-fab-setup-label"), null);
    assert.ok(manager.querySelector(".qap-home"));
    assert.equal(manager.querySelector(".qap-profiles"), null);
    assert.equal(env.document.activeElement, manager.querySelector(".qap-head-button"));
    assert.equal(env.server.requests.length, 0);
    await clickAndFlush(manager.querySelector(".qap-head-button"));
    assert.equal(manager.open, false, "home closes directly without visiting Settings");
  });
}

for (const kind of ["default", "copy", "duplicate"]) {
  test(`onboarding ${kind} creation opens home only after a successful save`, async () => {
    const env = environment();
    env.storage.delete(selectionKey());
    await startProfiles(env);
    trackFocus(env);
    env.fab().click();
    const manager = env.document.body.querySelector("qap-dialog");
    if (kind === "duplicate") {
      await clickAndFlush(
        profileRowIn(manager, "test-profile").querySelector(".qap-profile-overflow"),
      );
      await clickAndFlush(profileMenuIn(env).querySelector(".qap-duplicate-profile"));
    } else manager.querySelector(".qap-create-profile").click();
    const editor = activeProfileEditor(env);
    profileNameInput(editor).value = "New device";
    if (kind === "copy") chooseProfileCopy(editor);

    env.server.failWrites = true;
    await clickAndFlush(editor.querySelector(".qap-profile-submit"));
    assert.equal(activeProfileEditor(env), editor);
    assert.equal(env.window.quickAccessDebug().activeProfileId, null);
    assert.ok(manager.querySelector(".qap-profiles"));
    assert.match(editor.querySelector(".qap-error").textContent, /Could not save/);

    env.server.failWrites = false;
    await clickAndFlush(editor.querySelector(".qap-profile-submit"));
    const created = env.server.data("test-user").profiles.at(-1);
    assert.equal(created.name, "New device");
    assert.equal(env.window.quickAccessDebug().activeProfileId, created.id);
    assert.equal(JSON.parse(env.storage.get(selectionKey())), created.id);
    assert.equal(activeProfileEditor(env), undefined);
    assert.ok(manager.querySelector(".qap-home"));
    await flush();
    assert.equal(env.document.activeElement, manager.querySelector(".qap-head-button"));
  });
}

test("Create dialog supports defaults, copy source changes and confirmed activation", async () => {
  const env = await startProfiles(environment());
  nativeComponents(env);
  const source = {
    id: "desktop",
    name: "Desktop",
    icon: "mdi:devices",
    settings: { ...defaultSettings() },
    favorites: ["sensor.desktop"],
    categories: defaultCategories(),
  };
  await env.server.mutate("test-user", {
    operation: "create",
    profile_id: source.id,
    revision: 0,
    profile: source,
  });
  const manager = await profileManager(env);
  manager.querySelector(".qap-create-profile").click();
  const editor = activeProfileEditor(env);
  assert.equal(editor.localName, "qap-dialog");
  assert.equal(editor.querySelector(".qap-title").textContent, "Create profile");
  assert.equal(editor.querySelector(".qap-profile-submit").textContent, "Save");
  assert.equal(editor.querySelector(".qap-profile-source").hidden, true);
  assert.equal(editor.querySelector(".qap-color-value").textContent, "indigo");
  assert.equal(profileNameInput(editor).maxlength ?? profileNameInput(editor).maxLength, 80);
  editor.querySelector(".qap-profile-submit").click();
  assert.match(
    profileNameInput(editor).parentElement.querySelector(".qap-field-error").textContent,
    /Enter a profile name/,
  );
  assert.equal(env.server.data("test-user").profiles.length, 2);
  profileNameInput(editor).value = "Tablet";
  chooseProfileCopy(editor);
  assert.equal(editor.querySelector(".qap-profile-source").hidden, false);
  const select = editor.querySelector("qap-select") || editor.querySelector("select, qap-select");
  changeValidationControl(select, source.id, "change");
  assert.deepEqual(
    editor.querySelector(".qap-profile-source-summary").children.map((line) => line.textContent),
    [`${defaultLinks.length} shortcuts`, "1 group", "11 filters"],
  );
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.equal(editor.open, false);
  const created = env.server.data("test-user").profiles.at(-1);
  assert.equal(created.name, "Tablet");
  assert.notEqual(created.id, source.id);
  assert.deepEqual(created.settings, source.settings);
  assert.deepEqual(created.favorites, source.favorites);
  assert.equal(env.window.quickAccessDebug().activeProfileId, created.id);
  assert.ok(manager.querySelector(".qap-profiles"), "creation from Settings retains Profiles");
  editor.dispatchEvent(new Event("closed"));
  await createProfileInDialog(env, "Default tablet");
  assert.deepEqual(env.server.data("test-user").profiles.at(-1).settings, defaultSettings());
  assert.equal(env.server.data("test-user").profiles.at(-1).color, "indigo");
});

test("empty profile collections have an accessible Create dialog with copying disabled", async () => {
  const env = await startProfiles(environment());
  const server = env.server;
  await profileManager(env);
  server.data("test-user").profiles = [];
  server.data("test-user").revision++;
  server.notify("test-user");
  env.document.body.querySelector(".qap-create-profile").click();
  const editor = activeProfileEditor(env);
  assert.equal(
    editor.querySelectorAll("qap-radio-option").find((field) => field.value === "copy").disabled,
    true,
  );
  assert.ok(editor.attributes["aria-labelledby"]);
  editor.querySelector(".qap-profile-cancel").click();
  assert.equal(editor.open, false);
  assert.equal(server.requests.length, 0);
});

test("Duplicate preselects its row, proposes an editable name and copies an alternative source independently", async () => {
  const env = await startProfiles(environment());
  const alternate = {
    id: "alternate",
    name: "Another profile",
    icon: "mdi:devices",
    settings: { ...defaultSettings(), links: [] },
    favorites: ["sensor.alternate"],
    categories: defaultCategories(),
  };
  await env.server.mutate("test-user", {
    operation: "create",
    profile_id: alternate.id,
    revision: 0,
    profile: alternate,
  });
  const editor = await manageProfile(env, "test-profile", "duplicate");
  assert.equal(editor.querySelector(".qap-title").textContent, "Duplicate profile");
  assert.equal(profileNameInput(editor).value, "Default (Copy)");
  assert.equal(editor.querySelector("select, qap-select").value, "test-profile");
  assert.equal(editor.querySelector(".qap-profile-start"), null);
  editor.querySelector("select, qap-select").value = alternate.id;
  profileNameInput(editor).value = "Independent copy";
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  const created = env.server.data("test-user").profiles.at(-1);
  assert.deepEqual(created.settings, alternate.settings);
  assert.deepEqual(created.favorites, alternate.favorites);
  assert.equal(env.server.data("test-user").profiles[0].name, "Default");
});

test("Edit validates names and preserves its input on failed writes and remote conflicts", async () => {
  const env = await startProfiles(environment());
  const editor = await manageProfile(env, "test-profile", "edit");
  const name = profileNameInput(editor);
  assert.equal(name.value, "Default");
  assert.equal(editor.querySelector(".qap-title").textContent, "Edit profile");
  for (const invalid of [" ", "x".repeat(81)]) {
    name.value = invalid;
    editor.querySelector(".qap-profile-submit").click();
    assert.match(
      name.parentElement.querySelector(".qap-field-error").textContent,
      /Enter a profile name/,
    );
  }
  name.value = "My draft";
  setProfileIcon(editor, "mdi:star");
  env.server.failWrites = true;
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.equal(activeProfileEditor(env), editor);
  assert.equal(name.value, "My draft");
  assert.equal(profileIconControl(editor).value, "mdi:star");
  assert.match(
    editor.querySelector(".qap-profile-status").querySelector(".qap-error").textContent,
    /Could not save/,
  );
  env.server.failWrites = false;
  const remote = clone(env.server.data("test-user").profiles[0]);
  remote.name = "Remote name";
  remote.icon = "mdi:home";
  await env.server.mutate("test-user", {
    operation: "update",
    profile_id: remote.id,
    revision: 0,
    profile: remote,
  });
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.equal(name.value, "My draft");
  assert.equal(profileIconControl(editor).value, "mdi:star");
  assert.equal(env.server.data("test-user").profiles[0].name, "Remote name");
  assert.equal(savedProfile(env).icon, "mdi:home");
  assert.match(
    editor.querySelector(".qap-profile-status").querySelector(".qap-error").textContent,
    /changed on another device/,
  );
  editor.querySelector(".qap-profile-close").click();
  respondToDiscard(env);
  assert.equal(activeProfileEditor(env), undefined);
  assert.equal(
    env.document.body.querySelector(".qap-current-profile").querySelector("strong").textContent,
    "Remote name",
  );
});

for (const fail of [false, true]) {
  test(`profile editors block dismissal until a pending save ${fail ? "fails" : "succeeds"}`, async () => {
    const env = environment();
    await startProfiles(env);
    const editor = await manageProfile(env, "test-profile", "edit");
    const close = editor.querySelector(".qap-profile-close");
    const body = editor.querySelector(".qap-body");
    const name = profileNameInput(editor);
    name.value = "Pending name";
    let finishSave;
    const pending = new Promise((resolve) => {
      finishSave = resolve;
    });
    const send = env.connection.sendMessagePromise;
    env.connection.sendMessagePromise = async (message) => {
      await pending;
      return send(message);
    };
    env.server.failWrites = fail;

    editor.querySelector(".qap-profile-submit").click();
    assert.equal(env.window.quickAccessDebug().profileSaving, true);
    assert.equal(editor.querySelector(".qap-profile-status").children.length, 0);
    assert.equal(close.disabled, true);
    assert.equal(body.inert, true);
    assert.equal(editor.querySelector(".qap-form-actions").inert, true);
    assert.equal(body.contains(editor.querySelector(".qap-form-actions")), false);
    assert.equal(editor.preventScrimClose, true);
    close.click();
    editor.querySelector(".qap-profile-delete").click();
    assert.equal(
      env.document.body.querySelector(".qap-delete-profile-confirmation"),
      null,
      "Delete is unavailable while saving",
    );
    const cancel = new Event("cancel", { cancelable: true });
    editor.dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented, true);
    editor.click();
    assert.equal(activeProfileEditor(env), editor);
    assert.equal(editor.isConnected, true);
    assert.equal(env.server.data("test-user").profiles[0].name, "Default");

    finishSave();
    await flush();
    assert.equal(env.window.quickAccessDebug().profileSaving, false);
    assert.equal(env.server.requests.length, 1);
    if (fail) {
      assert.equal(activeProfileEditor(env), editor);
      assert.equal(name.value, "Pending name");
      assert.equal(close.disabled, false);
      assert.equal(body.inert, false);
      assert.equal(editor.querySelector(".qap-form-actions").inert, false);
      assert.equal(editor.preventScrimClose, false);
      assert.match(
        editor.querySelector(".qap-profile-status").querySelector(".qap-error").textContent,
        /Could not save/,
      );
      close.click();
      respondToDiscard(env);
    } else {
      assert.equal(env.server.data("test-user").profiles[0].name, "Pending name");
    }
    assert.equal(activeProfileEditor(env), undefined);
  });
}

test("profile forms reject deleted copy sources, ignore stale submissions and support Enter on the name", async () => {
  const env = await startProfiles(environment());
  let editor = await manageProfile(env, "test-profile", "duplicate");
  await env.server.mutate("test-user", {
    operation: "delete",
    profile_id: "test-profile",
    revision: 0,
  });
  editor.querySelector(".qap-profile-submit").click();
  assert.match(
    editor.querySelector(".qap-profile-source").querySelector(".qap-field-error").textContent,
    /available source profile/,
  );
  editor.querySelector(".qap-profile-cancel").click();
  const requestCount = env.server.requests.length;
  editor.querySelector(".qap-profile-submit").click();
  assert.equal(env.server.requests.length, requestCount);
  env.document.body.querySelector(".qap-create-profile").click();
  editor = activeProfileEditor(env);
  profileNameInput(editor).value = "Created with Enter";
  await dispatchAndFlush(
    profileNameInput(editor).parentElement,
    Object.assign(new Event("keydown"), { key: "Enter", isComposing: false }),
  );
  assert.equal(env.server.data("test-user").profiles[0].name, "Created with Enter");
});

test("forms and menus close on navigation, parent dismissal and unload, including native animation cleanup", async () => {
  for (const child of ["form", "menu"]) {
    for (const exit of ["back", "navigate", "disable"]) {
      const env = await startProfiles(environment());
      const manager = await profileManager(env);
      if (child === "form") manager.querySelector(".qap-create-profile").click();
      else manager.querySelector(".qap-profile-overflow").click();
      const oldForm = activeProfileEditor(env);
      if (exit === "back") env.document.body.querySelector(".qap-head-button").click();
      if (exit === "navigate") {
        env.context.location.pathname = "/config/logs";
        env.window.dispatchEvent(new Event("location-changed"));
      }
      if (exit === "disable") env.enable(false);
      assert.equal(activeProfileEditor(env), undefined);
      assert.equal(profileMenuIn(env), null);
      if (oldForm) {
        oldForm.querySelector(".qap-profile-submit").click();
        assert.equal(env.server.requests.length, 0);
      }
      if (exit === "disable") {
        assert.equal(env.document.body.children.length, 0);
        assert.equal(env.timers.size, 0);
        assert.equal(getEventListeners(env.document, "pointerdown").length, 0);
      }
    }
  }
});

test("editor restoration focuses the current trigger after the dialog restores captured focus", async () => {
  const env = await startProfiles(environment());
  nativeComponents(env);
  trackFocus(env);
  const manager = await profileManager(env);
  const trigger = manager.querySelector(".qap-create-profile");
  const captured = manager.querySelector(".qap-profile-overflow");
  trigger.click();
  const editor = activeProfileEditor(env);
  editor.close = () => {
    captured.focus();
    Element.prototype.close.call(editor);
  };
  editor.querySelector(".qap-profile-cancel").click();
  await flush();
  assert.equal(env.document.activeElement, trigger);
});

test("profile editors never focus an input when they open", async () => {
  for (const cancel of [false, true]) {
    const env = await startProfiles(environment());
    nativeComponents(env);
    await profileManager(env);
    const pending = delayNativeFocus(env, "qap-input");
    env.document.body.querySelector(".qap-create-profile").click();
    const editor = activeProfileEditor(env);
    const input = profileNameInput(editor);
    const state = pending.get(input);
    assert.equal(state.earlyFocus, 0);
    if (cancel) editor.querySelector(".qap-profile-cancel").click();
    state.render();
    await flush();
    assert.equal(state.focusCalls, 0);
    assert.equal(state.earlyFocus, 0);
  }
});
