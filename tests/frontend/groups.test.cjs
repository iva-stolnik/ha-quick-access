// Group settings, limits, dropdowns, rename/reorder/delete and sync.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  loadDefaults,
  flush,
  clickAndFlush,
  dispatchAndFlush,
  defaultCategories,
  clone,
  ProfileServer,
  environment,
  nativeComponents,
  buttons,
  respondToDiscard,
  openSettingsScreen,
  returnToLauncher,
  openShortcutsSettings,
  startProfiles,
  profileManager,
  useProfile,
  profileNameInput,
  manageProfile,
  createProfileInDialog,
  categoryInput,
  openCategoriesManager,
  categoryAction,
  categorySelect,
  openCategoryCreate,
  createCategoryInSettings,
} = require("./harness.cjs");
let defaultLinks;
test.before(async () => ({ defaultLinks } = await loadDefaults()));

test(`category settings use shared rows with protected drafts and return focus`, async () => {
  const env = environment();
  const create = env.document.createElement;
  env.document.createElement = (tag) => {
    const element = create(tag);
    element.focus = () => {
      env.document.activeElement = element;
    };
    return element;
  };
  await openShortcutsSettings("/config", undefined, env);
  const parent = env.document.body.querySelector(".qap-settings-dialog");
  assert.equal(parent.querySelector(".qap-category-row"), null);
  const manager = openCategoriesManager(env);
  assert.equal(manager, parent);
  assert.equal(manager.headerTitle, "Groups");
  const row = manager.querySelector(".qap-category-row");
  assert.ok(row.classList.contains("qap-edit-item"));
  assert.equal(row.querySelector(".qap-grip"), null);
  assert.equal(row.tabIndex, undefined, "static rows are not drag handles");
  assert.equal(row.querySelector(".qap-category-edit").localName, "button");
  // A lone Favorites group cannot move or be deleted, so it has no overflow.
  assert.equal(row.querySelector(".qap-category-overflow"), null);
  manager.querySelector(".qap-create-category").click();
  const form = env.document.body.querySelector(".qap-category-form");
  const modal = env.document.body.querySelector(".qap-category-modal");
  assert.equal(modal.localName, "qap-dialog");
  assert.notEqual(modal, manager);
  assert.equal(form.querySelector(".qap-form-actions").parentElement, form);
  assert.equal(
    form.querySelector(".qap-body").contains(form.querySelector(".qap-form-actions")),
    false,
  );
  assert.equal(form.querySelector(".qap-category-submit").textContent, "Save");
  categoryInput(form).value = "Keep this group";
  manager.querySelector(".qap-head-button").click();
  respondToDiscard(env, false);
  assert.equal(manager.open, true);
  assert.equal(categoryInput(form).value, "Keep this group");
  manager.querySelector(".qap-head-button").click();
  respondToDiscard(env, true);
  await flush();
  assert.equal(form.isConnected, false);
  assert.equal(parent.open, true);
  assert.ok(parent.querySelector(".qap-settings-overview"));
  assert.equal(env.document.activeElement, parent.querySelector(".qap-settings-categories"));
  assert.equal(env.server.requests.length, 0);
});

test("group limit includes Favorites and preserves drafts in both creation flows", async () => {
  const env = environment();
  const profile = env.server.data("test-user").profiles[0];
  for (let index = 1; index < 19; index++)
    profile.categories.push({ id: `category_${index}`, name: `Category ${index}` });
  await openShortcutsSettings("/config", undefined, env);
  await createCategoryInSettings(env, "Twentieth");
  assert.equal(env.server.data("test-user").profiles[0].categories.length, 20);
  const before = clone(env.server.data("test-user"));
  const requests = env.server.requests.length;
  await createCategoryInSettings(env, "One too many");
  let form = env.document.body.querySelector(".qap-category-form");
  assert.equal(categoryInput(form).value, "One too many");
  assert.match(form.querySelector(".qap-error").textContent, /Group limit reached/);
  form.querySelector(".qap-category-cancel").click();
  respondToDiscard(env);
  openSettingsScreen(env, "shortcuts");
  env.document.body.querySelector(".qap-add-shortcut").click();
  form = await openCategoryCreate(env);
  categoryInput(form).value = "Another group";
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.equal(categoryInput(form).value, "Another group");
  assert.match(form.querySelector(".qap-error").textContent, /Group limit reached/);
  assert.equal(env.server.requests.length, requests);
  assert.deepEqual(env.server.data("test-user"), before);
});

test("frontend accepts saved usage above reduced quotas without dropping profiles or groups", async () => {
  for (const collection of ["profiles", "categories"]) {
    const env = environment();
    const data = env.server.data("test-user");
    const profile = data.profiles[0];
    if (collection === "profiles")
      for (let i = 1; i <= 10; i++)
        data.profiles.push({ ...clone(profile), id: "profile_" + i, name: "Profile " + i });
    else
      for (let i = 1; i <= 20; i++)
        profile.categories.push({ id: "category_" + i, name: "Group " + i });
    const saved = clone(data.profiles);
    await startProfiles(env);
    assert.equal(env.window.quickAccessDebug().activeProfileId, "test-profile");
    assert.equal(env.window.quickAccessDebug().profileError, "");
    assert.equal(env.server.requests.length, 0);
    assert.deepEqual(data.profiles, saved);
    const manager = await profileManager(env);
  }
});

test("delayed group acknowledgements preserve unsaved shortcut drafts after remote profile deletion", async () => {
  const env = await openShortcutsSettings("/config");
  env.document.body.querySelector(".qap-add-shortcut").click();
  const editor = env.document.body.querySelector(".qap-shortcut-form");
  const name = editor.querySelector("input, qap-input");
  name.value = "Recoverable shortcut draft";
  editor
    .querySelectorAll("input, qap-input")
    .find((field) => field.placeholder === "/config/tools/state").value = "/config/logs";
  const form = await openCategoryCreate(env);
  categoryInput(form).value = "Living room";
  const send = env.connection.sendMessagePromise;
  let acknowledge;
  env.connection.sendMessagePromise = async (message) => {
    const result = await send(message);
    return new Promise((resolve) => {
      acknowledge = () => resolve(result);
    });
  };
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  await env.server.mutate("test-user", {
    operation: "delete",
    profile_id: "test-profile",
    revision: env.server.data("test-user").revision,
  });
  acknowledge();
  await flush();

  assert.equal(env.document.body.querySelector(".qap-shortcut-form"), editor);
  assert.equal(name.value, "Recoverable shortcut draft");
  assert.equal(form.isConnected, false);
  assert.equal(env.window.quickAccessDebug().activeProfileId, "test-profile");
  assert.equal(env.window.quickAccessDebug().profileRevision, 1);
  assert.equal(env.window.quickAccessDebug().serverRevision, 2);
  assert.equal(env.window.quickAccessDebug().profileSaving, false);

  env.connection.sendMessagePromise = send;
  await clickAndFlush(buttons(editor).find((item) => item.textContent === "Save"));
  assert.match(env.window.quickAccessDebug().profileError, /changed on another device/);
  assert.equal(name.value, "Recoverable shortcut draft");
  assert.deepEqual(env.server.data("test-user").profiles, []);
  env.document.body.querySelector(".qap-head-button").click();
  respondToDiscard(env);
  assert.equal(env.window.quickAccessDebug().activeProfileId, null);
});

test("group dropdown saves only acknowledged groups and retains shortcut drafts", async () => {
  const env = environment();
  nativeComponents(env);
  await openShortcutsSettings("/config", undefined, env);
  env.document.body.querySelector(".qap-add-shortcut").click();
  const editor = env.document.body.querySelector(".qap-shortcut-form");
  const inputs = editor.querySelectorAll("qap-input");
  inputs[0].value = "Unsaved name";
  inputs.find(
    (field) => field.label === "URL path" || field.placeholder === "/config/tools/state",
  ).value = "/config/logs";
  const storageBefore = [...env.storage];
  const form = await openCategoryCreate(env);
  const input = categoryInput(form);
  input.value = "";
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.ok(form.querySelector(".qap-field-error").textContent);
  assert.equal(env.server.requests.length, 0);
  input.value = "  Living room  ";
  const send = env.connection.sendMessagePromise;
  let acknowledge;
  env.connection.sendMessagePromise = (message) =>
    new Promise((resolve) => {
      acknowledge = () => send(message).then(resolve);
    });
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.deepEqual(env.server.data("test-user").profiles[0].categories, defaultCategories());
  assert.equal(categorySelect(editor).value, "category:favorites");
  assert.equal(form.isConnected, true);
  await acknowledge();
  await flush();
  const saved = env.server.data("test-user").profiles[0].categories[1];
  assert.equal(saved.name, "Living room");
  assert.equal(categorySelect(editor).value, `category:${saved.id}`);
  assert.equal(form.isConnected, false);
  assert.equal(inputs[0].value, "Unsaved name");
  assert.deepEqual([...env.storage], storageBefore, "groups must never enter localStorage");
  env.connection.sendMessagePromise = send;
  await clickAndFlush(buttons(editor).find((item) => item.textContent === "Save"));
  assert.equal(env.server.data("test-user").profiles[0].settings.links.at(-1).group, saved.id);
  assert.equal(env.server.data("test-user").profiles[0].settings.links.at(-1).path, "/config/logs");
});

test("group creation errors retain the name and selected group", async () => {
  const env = environment();
  await openShortcutsSettings("/config", undefined, env);
  env.document.body.querySelector(".qap-add-shortcut").click();
  const form = await openCategoryCreate(env);
  categoryInput(form).value = "My room";
  env.server.failWrites = true;
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.equal(categoryInput(form).value, "My room");
  assert.match(form.querySelector(".qap-error").textContent, /Could not save/);
  assert.equal(env.server.data("test-user").profiles[0].categories.length, 1);
  env.server.failWrites = false;
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.equal(env.server.data("test-user").profiles[0].categories[1].name, "My room");
});

test("group select preserves selection through HA imports and returns focus after creation cancels", async () => {
  const env = environment();
  const create = env.document.createElement;
  env.document.createElement = (tag) => {
    const element = create(tag);
    element.focus = () => {
      env.document.activeElement = element;
    };
    return element;
  };
  const components = nativeComponents(env, false);
  env.server.data("test-user").profiles[0].categories.push({ id: "tools", name: "Tools" });
  await openShortcutsSettings("/config", undefined, env);
  env.document.body.querySelector(".qap-add-shortcut").click();
  const fallback = categorySelect(env.document.body);
  assert.equal(fallback.localName, "qap-select");
  assert.deepEqual(
    Array.from(fallback.options, (option) => option.label),
    ["Favorites", "Tools", "Add new group..."],
  );
  fallback.value = "category:tools";
  await dispatchAndFlush(fallback, new Event("change"));
  components.register("qap-select");
  await flush();
  const select = categorySelect(env.document.body);
  assert.equal(select.localName, "qap-select");
  assert.equal(select.value, "category:tools");
  const form = await openCategoryCreate(env);
  assert.equal(select.value, "category:tools", "creation keeps the confirmed group selected");
  form.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
  await flush();
  assert.equal(form.isConnected, false);
  assert.equal(env.document.activeElement, select);
  assert.equal(select.value, "category:tools");
});

test("groups rename, reorder and delete atomically without changing visibility settings or losing shortcuts", async () => {
  const env = await openShortcutsSettings("/config");
  const routes = clone(env.server.data("test-user").profiles[0].settings.routes);
  const storage = [...env.storage];
  await createCategoryInSettings(env, "Rooms");
  await createCategoryInSettings(env, "Work");
  assert.deepEqual(env.server.data("test-user").profiles[0].settings.routes, routes);
  let rows = env.document.body.querySelectorAll(".qap-category-row");
  assert.equal(rows[0].querySelector(".qap-delete-category"), null);
  assert.ok(rows[0].querySelector(".qap-category-overflow"));
  const roomId = rows[1].dataset.id;
  await clickAndFlush(categoryAction(env, rows[1], "edit"));
  const form = env.document.body.querySelector(".qap-category-form");
  categoryInput(form).value = "Living room";
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  rows = env.document.body.querySelectorAll(".qap-category-row");
  await clickAndFlush(categoryAction(env, rows[1], "move-down"));
  let profile = env.server.data("test-user").profiles[0];
  assert.deepEqual(
    profile.categories.map((item) => item.name),
    ["Favorites", "Work", "Living room"],
  );
  assert.deepEqual(
    env.document.body
      .querySelectorAll(".qap-category-row")
      .map((item) => item.querySelector("strong").textContent),
    ["Favorites", "Work", "Living room"],
  );
  assert.equal(profile.categories[2].id, roomId);
  profile.settings.links[0].group = roomId;
  // Reflect a separate confirmed edit before opening Settings again.
  env.server.data("test-user").revision++;
  env.server.notify("test-user");
  env.document.body.querySelector(".qap-head-button").click();
  openSettingsScreen(env, "shortcuts");
  openCategoriesManager(env);
  rows = env.document.body.querySelectorAll(".qap-category-row");
  let remove = categoryAction(env, rows[2], "delete");
  await clickAndFlush(remove);
  let confirmation = env.document.body.querySelector(".qap-delete-category-confirmation");
  assert.match(
    confirmation.querySelector("#qap-delete-category-description").textContent,
    /contains 1 shortcuts, including 0 disabled/,
  );
  assert.equal(
    confirmation.querySelector(".qap-category-delete-choice").querySelector("qap-select").value,
    "move",
  );
  assert.equal(
    confirmation.querySelector(".qap-category-delete-destination").querySelector("qap-select")
      .value,
    "favorites",
  );
  buttons(confirmation)
    .find((item) => item.textContent === "Cancel")
    .click();
  assert.equal(profile.categories.length, 3);
  remove = categoryAction(env, rows[2], "delete");
  await clickAndFlush(remove);
  confirmation = env.document.body.querySelector(".qap-delete-category-confirmation");
  await clickAndFlush(confirmation.querySelector(".qap-button-primary"));
  profile = env.server.data("test-user").profiles[0];
  assert.deepEqual(
    profile.categories.map((item) => item.name),
    ["Favorites", "Work"],
  );
  assert.deepEqual(
    env.document.body
      .querySelectorAll(".qap-category-row")
      .map((item) => item.querySelector("strong").textContent),
    ["Favorites", "Work"],
  );
  assert.equal(profile.settings.links.length, defaultLinks.length);
  assert.equal(profile.settings.links[0].group, "favorites");
  const request = env.server.requests.at(-1).profile;
  assert.equal(
    request.categories.some((item) => item.id === roomId),
    false,
  );
  assert.equal(
    request.settings.links.some((item) => item.group === roomId),
    false,
  );
  assert.deepEqual([...env.storage], storage);
});

test("empty groups stay visible and preselect the group in the new shortcut editor", async () => {
  const env = await openShortcutsSettings("/config");
  await createCategoryInSettings(env, "Empty room");
  const category = env.server.data("test-user").profiles[0].categories[1];
  returnToLauncher(env);
  const tabs = env.document.body.querySelector(".qap-tabs");
  assert.equal(tabs.children.length, 2);
  tabs.children.find((item) => item.dataset.tab === category.id).click();
  const empty = env.document.body.querySelector(".qap-empty");
  assert.equal(empty.querySelector("strong").textContent, "No shortcuts yet");
  buttons(empty)
    .find((item) => item.textContent === "Add shortcut")
    .click();
  assert.equal(categorySelect(env.document.body).value, `category:${category.id}`);
});

test("group changes synchronize to a second client, preserve conflicting drafts and copy independently", async () => {
  const server = new ProfileServer();
  const a = await startProfiles(environment(undefined, server, { fresh: true }));
  const originalId = a.window.quickAccessDebug().activeProfileId;
  const b = await startProfiles(environment(undefined, server, { fresh: true }));
  await useProfile(b, originalId);
  b.document.body.querySelector(".qap-head-button").click();
  b.fab().click();
  a.fab().click();
  buttons(a.document.body)
    .find((item) => item.title === "Settings")
    .click();
  openSettingsScreen(a, "shortcuts");
  await createCategoryInSettings(a, "Rooms");
  assert.deepEqual(
    b.document.body.querySelector(".qap-tabs").children.map((item) => item.textContent),
    ["Favorites", "Rooms"],
  );
  buttons(b.document.body)
    .find((item) => item.title === "Settings")
    .click();
  openSettingsScreen(b, "shortcuts");
  openCategoriesManager(b).querySelector(".qap-create-category").click();
  const form = b.document.body.querySelector(".qap-category-form");
  categoryInput(form).value = "B draft";
  await createCategoryInSettings(a, "Work");
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.match(form.querySelector(".qap-error").textContent, /another device/);
  assert.equal(categoryInput(form).value, "B draft");
  assert.deepEqual(
    server.data("test-user").profiles[0].categories.map((item) => item.name),
    ["Favorites", "Rooms", "Work"],
  );
  const editor = await manageProfile(a, originalId, "duplicate");
  profileNameInput(editor).value = "Copied";
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  const copied = server.data("test-user").profiles.at(-1);
  assert.deepEqual(copied.categories, server.data("test-user").profiles[0].categories);
  copied.categories[1].name = "Independent";
  assert.equal(server.data("test-user").profiles[0].categories[1].name, "Rooms");
  await createProfileInDialog(a, "Fresh");
  assert.deepEqual(server.data("test-user").profiles.at(-1).categories, defaultCategories());
});

test("frontend rejects invalid groups, missing groups and dangling shortcut references", async () => {
  for (const change of [
    (p) => {
      delete p.categories;
    },
    (p) => {
      p.categories = [];
    },
    (p) => {
      p.categories.push({ id: "favorites", name: "Other" });
    },
    (p) => {
      p.categories.push({ id: "other", name: "FAVORITES" });
    },
    (p) => {
      p.categories[0].name = "Other";
    },
    (p) => {
      p.categories.push({ id: "bad id", name: "Other" });
    },
    (p) => {
      p.settings.links[0].group = "missing";
    },
  ]) {
    const env = environment();
    change(env.server.data("test-user").profiles[0]);
    await startProfiles(env);
    assert.match(env.window.quickAccessDebug().profileError, /categor|Invalid/);
    assert.equal(env.server.requests.length, 0);
  }
});
