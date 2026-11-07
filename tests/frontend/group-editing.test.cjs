// Group mutations, quotas, category deletion and edit forms.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const {
  loadDefaults,
  flush,
  clickAndFlush,
  defaultCategories,
  defaultSettings,
  clone,
  filterDefinitions,
  filterAction,
  ProfileServer,
  savedProfile,
  environment,
  openEntityStates,
  nativeComponents,
  buttons,
  openLauncherSettings,
  openSettingsScreen,
  navigationEnvironment,
  openShortcutsSettings,
  manyShortcuts,
  changeValidationControl,
  openArrangement,
  arrangeKey,
  startProfiles,
  useProfile,
  activeProfileEditor,
  manageProfile,
  categoryInput,
  openCategoriesManager,
  categoryAction,
  categorySelect,
  selectAndFlush,
  createCategoryInSettings,
} = require("./harness.cjs");
let defaultLinks;
test.before(async () => ({ defaultLinks } = await loadDefaults()));

test("remote rename/order/deletion refresh tabs and reset a deleted active group without changing entity favorites", async () => {
  const server = new ProfileServer();
  const a = await startProfiles(environment(undefined, server, { fresh: true }));
  const id = a.window.quickAccessDebug().activeProfileId;
  const b = await startProfiles(environment(undefined, server, { fresh: true }));
  await useProfile(b, id);
  b.document.body.querySelector(".qap-head-button").click();
  b.fab().click();
  a.fab().click();
  buttons(a.document.body)
    .find((item) => item.title === "Settings")
    .click();
  openSettingsScreen(a, "shortcuts");
  await createCategoryInSettings(a, "Room");
  const roomId = server.data("test-user").profiles[0].categories[1].id;
  b.document.body.querySelector(".qap-tabs").children[1].click();
  let changed = clone(server.data("test-user").profiles[0]);
  changed.categories[1].name = "Renamed room";
  changed.categories.reverse();
  changed.favorites = ["sensor.kitchen"];
  await server.mutate("test-user", {
    operation: "update",
    profile_id: id,
    revision: server.data("test-user").revision,
    profile: changed,
  });
  assert.deepEqual(
    b.document.body.querySelector(".qap-tabs").children.map((item) => item.textContent),
    ["Renamed room", "Favorites"],
  );
  assert.equal(
    b.document.body.querySelector(".qap-tabs").children[0].attributes["aria-pressed"],
    "true",
  );
  changed = clone(changed);
  changed.categories = defaultCategories();
  await server.mutate("test-user", {
    operation: "update",
    profile_id: id,
    revision: server.data("test-user").revision,
    profile: changed,
  });
  assert.equal(b.document.body.querySelector(".qap-tabs").children.length, 1);
  assert.equal(
    b.document.body.querySelector(".qap-tabs").children[0].attributes["aria-pressed"],
    "true",
  );
  assert.equal(b.document.body.querySelectorAll(".qap-tile").length, defaultLinks.length);
  assert.deepEqual(server.data("test-user").profiles[0].favorites, ["sensor.kitchen"]);
  buttons(b.document.body)
    .find((item) => item.title === "Settings")
    .click();
  openSettingsScreen(b, "shortcuts");
  b.document.body.querySelector(".qap-add-shortcut").click();
  assert.deepEqual(
    Array.from(categorySelect(b.document.body).options, (item) => item.value),
    ["category:favorites", "add-category"],
  );
  assert.equal(
    server.data("test-user").profiles[0].categories.some((item) => item.id === roomId),
    false,
  );
});

test("quota increases clear form warnings and permit retry without discarding the group draft", async () => {
  const env = environment();
  env.server.limits = { ...env.server.data("test-user").limits, max_categories: 1 };
  await openShortcutsSettings("/lovelace/home", undefined, env);
  openCategoriesManager(env).querySelector(".qap-create-category").click();
  const form = env.document.body.querySelector(".qap-category-form");
  const name = form.querySelector("input, qap-input");
  name.value = "Rooms";
  form.querySelector(".qap-category-submit").click();
  await flush();
  assert.match(form.querySelector(".qap-error").textContent, /Group limit reached/);
  env.server.limits.max_categories = 2;
  env.server.notify("test-user");
  assert.equal(form.querySelector(".qap-error").textContent, "");
  assert.equal(name.value, "Rooms");
  form.querySelector(".qap-category-submit").click();
  await flush();
  assert.equal(env.server.data("test-user").profiles[0].categories.length, 2);
});

for (const order of ["event-first", "response-first"]) {
  test(`profile mutation ${order} preserves both message paths and equal-revision quota updates`, async () => {
    const env = await startProfiles(environment());
    openLauncherSettings(env);
    const paths = env.document.body.querySelector(".qap-textarea");
    paths.value = "/saved/path";
    const listener = [...env.server.listeners][0];
    const receive = listener.callback;
    let event, acknowledge;
    listener.callback = (value) => {
      event = value;
    };
    const send = env.connection.sendMessagePromise;
    env.connection.sendMessagePromise = async (message) => {
      const result = await send(message);
      return new Promise((resolve) => {
        acknowledge = () => resolve(result);
      });
    };
    // Count the real validator's full snapshot clones in the module realm.
    const realmJSON = vm.runInContext("JSON", env.context);
    let snapshotClones = 0;
    env.context.JSON = {
      stringify: realmJSON.stringify,
      parse: (text) => {
        const value = realmJSON.parse(text);
        if (Array.isArray(value?.profiles) && value?.usage) snapshotClones++;
        return value;
      },
    };
    await clickAndFlush(env.document.body.querySelector(".qap-save-settings"));
    assert.equal(snapshotClones, 0);
    assert.equal(env.window.quickAccessDebug().profileSaving, true);
    if (order === "event-first") {
      receive(event);
      assert.equal(snapshotClones, 1);
      assert.equal(env.window.quickAccessDebug().serverRevision, 1);
      assert.equal(
        env.window.quickAccessDebug().profileRevision,
        0,
        "the event preserves the editor base until acknowledgement",
      );
      assert.equal(env.document.body.querySelector(".qap-textarea"), paths);
      assert.equal(paths.value, "/saved/path");
      acknowledge();
    } else {
      acknowledge();
      await flush();
      assert.equal(snapshotClones, 1);
      receive(event);
    }
    await flush();
    assert.equal(snapshotClones, 2, "both paths still validate and own their snapshots");
    assert.equal(env.window.quickAccessDebug().profileRevision, 1);
    assert.equal(env.window.quickAccessDebug().serverRevision, 1);
    assert.equal(env.window.quickAccessDebug().profileSaving, false);
    assert.deepEqual(env.server.data("test-user").profiles[0].settings.routes, ["/saved/path"]);
    env.server.limits = { ...event.limits, max_categories: 30 };
    receive(clone(env.server.data("test-user")));
    assert.equal(env.window.quickAccessDebug().serverRevision, 1);
    assert.equal(env.window.quickAccessDebug().limits.max_categories, 30);
    assert.equal(env.window.quickAccessDebug().profileError, "");
  });
}

test("native launcher select and current-route actions preserve drafts across remote updates", async () => {
  const env = environment();
  nativeComponents(env);
  await startProfiles(env);
  openLauncherSettings(env);
  const root = env.document.body;
  const mode = root.querySelector("qap-select");
  changeValidationControl(mode, "include", "change");
  const data = env.server.data("test-user");
  const updated = { ...clone(data.profiles[0]), name: "Remote" };
  await env.server.mutate("test-user", {
    operation: "update",
    profile_id: updated.id,
    revision: data.revision,
    profile: updated,
  });
  assert.equal(root.querySelector("qap-select"), mode);
  assert.equal(mode.value, "include");
  const reload = root.querySelector(".qap-linkish");
  assert.ok(reload);
  reload.click();
  env.document.body
    .querySelector(".qap-reload-profiles-confirmation")
    .querySelector(".qap-button-danger")
    .click();
  assert.equal(root.querySelector("qap-select").value, "exclude");
});

test("leaving settings discards a stale visibility draft and restores the current saved launcher state", async () => {
  const env = await startProfiles(environment());
  openLauncherSettings(env);
  const root = env.document.body;
  root.querySelector(".qap-textarea").value = "/private/shared";
  root.dispatchEvent(new Event("input"));
  const data = env.server.data("test-user");
  const profile = clone(data.profiles[0]);
  profile.settings = { ...profile.settings, routes: ["/missing"], visibility: "include" };
  await env.server.mutate("test-user", {
    operation: "update",
    profile_id: profile.id,
    revision: data.revision,
    profile,
  });
  assert.equal(root.querySelector(".qap-textarea").value, "/private/shared");
  env.document.body.querySelector(".qap-head-button").click();
  assert.equal(env.window.quickAccessDebug().hiddenByRoute, true);
  assert.equal(env.fab().hidden, true);
  assert.match(env.window.quickAccessDebug().visibility.reason, /not included/);
});

for (const action of ["move", "delete"]) {
  for (const outcome of ["save", "cancel", "failure", "conflict"]) {
    test("nonempty category " + action + " is atomic on " + outcome, async () => {
      const env = navigationEnvironment();
      const profile = savedProfile(env);
      profile.categories.push({ id: "source", name: "Source" }, { id: "target", name: "Target" });
      const link = (id, group, hidden = false) => ({
        ...manyShortcuts(1, group)[0],
        id,
        name: id,
        hidden,
        color: "red",
      });
      profile.settings.links = [
        link("d1", "target"),
        link("s1", "source"),
        link("f1", "favorites"),
        link("s2", "source", true),
        link("d2", "target", true),
        link("s3", "source"),
        link("s4", "source", true),
      ];
      const before = clone(profile);
      await openShortcutsSettings("/config", undefined, env);
      const manager = openCategoriesManager(env);
      const row = manager
        .querySelectorAll(".qap-category-row")
        .find((row) => row.dataset.id === "source");
      await clickAndFlush(categoryAction(env, row, "delete"));
      const modal = env.document.body.querySelector(".qap-delete-category-confirmation");
      assert.match(
        modal.querySelector("#qap-delete-category-description").textContent,
        /Source.*4 shortcuts.*2 disabled/,
      );
      const choice = modal.querySelector(".qap-category-delete-choice").querySelector("qap-select");
      const destination = modal
        .querySelector(".qap-category-delete-destination")
        .querySelector("qap-select");
      assert.equal(choice.value, "move");
      assert.equal(destination.value, "favorites");
      assert.deepEqual(
        Array.from(destination.options, (option) => option.value),
        ["favorites", "target"],
      );
      await selectAndFlush(destination, "target");
      await selectAndFlush(choice, action);
      const confirm = buttons(modal.querySelector(".qap-form-actions")).at(-1);
      assert.equal(
        confirm.textContent,
        action === "move" ? "Delete group" : "Delete group and shortcuts",
      );
      assert.equal(confirm.classList.contains("qap-button-danger"), action === "delete");
      assert.equal(destination.parentElement.hidden, action === "delete");
      assert.match(
        modal.querySelectorAll("p").at(-1).textContent,
        /Home Assistant.*saved filters are kept/,
      );
      assert.equal(env.server.requests.length, 0);
      if (outcome === "cancel") {
        buttons(modal)
          .find((button) => button.textContent === "Cancel")
          .click();
        assert.deepEqual(savedProfile(env), before);
        assert.equal(env.server.requests.length, 0);
        return;
      }
      let latest = before;
      if (outcome === "failure") env.server.failWrites = true;
      if (outcome === "conflict") {
        latest = clone(before);
        latest.settings.links[1].name = "Remote source shortcut";
        await env.server.mutate("test-user", {
          operation: "update",
          profile_id: profile.id,
          revision: 0,
          profile: latest,
        });
      }
      const writes = env.server.requests.length;
      await clickAndFlush(confirm);
      if (["failure", "conflict"].includes(outcome)) {
        assert.equal(modal.isConnected, true);
        assert.equal(choice.value, action);
        assert.equal(destination.value, "target");
        assert.deepEqual(savedProfile(env), latest);
        assert.match(
          modal.querySelector(".qap-error").textContent,
          outcome === "conflict" ? /changed|reload|conflict/i : /Could not save/,
        );
        if (outcome === "conflict") return;
        env.server.failWrites = false;
        await clickAndFlush(confirm);
      }
      const saved = savedProfile(env);
      assert.equal(
        saved.categories.some((category) => category.id === "source"),
        false,
      );
      assert.equal(
        saved.settings.links.some((link) => link.group === "source"),
        false,
      );
      assert.equal(env.server.requests.length, writes + (outcome === "failure" ? 2 : 1));
      assert.deepEqual(saved.filters, before.filters);
      assert.deepEqual(saved.favorites, before.favorites);
      assert.deepEqual(saved.settings.routes, before.settings.routes);
      const expected = action === "move" ? ["d1", "s1", "s3", "d2", "s2", "s4"] : ["d1", "d2"];
      assert.deepEqual(
        saved.settings.links.filter((link) => link.group === "target").map((link) => link.id),
        expected,
      );
      for (const original of before.settings.links) {
        const transferred = saved.settings.links.find((link) => link.id === original.id);
        if (action === "delete" && original.group === "source")
          assert.equal(transferred, undefined);
        else
          assert.deepEqual(
            transferred,
            original.group === "source" ? { ...original, group: "target" } : original,
          );
      }
      assert.equal(modal.isConnected, false);
    });
  }
}

for (const dismissal of ["Escape", "back"]) {
  test("category deletion dismissal changes nothing through " + dismissal, async () => {
    const env = navigationEnvironment();
    const profile = savedProfile(env);
    profile.categories.push({ id: "source", name: "Source" });
    profile.settings.links[0].group = "source";
    const before = clone(profile);
    await openShortcutsSettings("/config", undefined, env);
    const row = openCategoriesManager(env)
      .querySelectorAll(".qap-category-row")
      .find((row) => row.dataset.id === "source");
    await clickAndFlush(categoryAction(env, row, "delete"));
    const modal = env.document.body.querySelector(".qap-delete-category-confirmation");
    if (dismissal === "back") await env.back();
    else modal.dispatchEvent(new Event("cancel", { cancelable: true }));
    assert.equal(modal.isConnected, false);
    assert.deepEqual(savedProfile(env), before);
    assert.equal(env.server.requests.length, 0);
  });
}

test("empty category deletion is simple and Favorites remains protected", async () => {
  const env = environment();
  savedProfile(env).categories.push({ id: "empty", name: "Empty" });
  await openShortcutsSettings("/config", undefined, env);
  const manager = openCategoriesManager(env);
  let row = manager
    .querySelectorAll(".qap-category-row")
    .find((row) => row.dataset.id === "favorites");
  categoryAction(env, row, "delete");
  assert.equal(env.document.body.querySelector(".qap-delete-category"), null);
  row.querySelector(".qap-category-overflow").click();
  row = manager.querySelectorAll(".qap-category-row").find((row) => row.dataset.id === "empty");
  await clickAndFlush(categoryAction(env, row, "delete"));
  const modal = env.document.body.querySelector(".qap-delete-category-confirmation");
  assert.match(modal.querySelector("#qap-delete-category-description").textContent, /empty group/);
  assert.equal(modal.querySelector(".qap-category-delete-choice"), null);
  assert.equal(modal.querySelector(".qap-category-delete-destination"), null);
  const links = clone(savedProfile(env).settings.links);
  await clickAndFlush(buttons(modal.querySelector(".qap-form-actions")).at(-1));
  assert.deepEqual(savedProfile(env).settings.links, links);
  assert.equal(savedProfile(env).categories.length, 1);
  assert.equal(env.server.requests.length, 1);
});

test("frontend grid dimensions accept 10 by 10 and reject 11 on either axis", async () => {
  const env = environment();
  const { validShortcutGrid } = await env.run("profiles/profile-validation.js");
  assert.equal(validShortcutGrid({ rows: 10, columns: 10 }), true);
  for (const grid of [
    { rows: 11, columns: 10 },
    { rows: 10, columns: 11 },
    { rows: 0, columns: 1 },
  ])
    assert.equal(validShortcutGrid(grid), false);
  await openShortcutsSettings("/config", undefined, env);
  const { form } = await openArrangement(env);
  const [columns, rows] = form.querySelector(".qap-grid-fields").querySelectorAll("qap-input");
  columns.value = "11";
  rows.value = "10";
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.equal(env.server.requests.length, 0);
  assert.match(columns.parentElement.querySelector(".qap-field-error").textContent, /1 to 10/);
  columns.value = "10";
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.deepEqual(savedProfile(env).categories[0].grid, { columns: 10, rows: 10 });
});

test("a remotely deleted category keeps its arrangement draft and reports the missing category", async () => {
  const env = environment();
  savedProfile(env).categories.push({ id: "tools", name: "Tools" });
  savedProfile(env).settings.links = manyShortcuts(2, "tools");
  await openShortcutsSettings("/config", undefined, env);
  const view = await openArrangement(env, "tools");
  await arrangeKey(view.list.children[0], "ArrowRight");
  const order = view.ids();
  const latest = clone(savedProfile(env));
  latest.categories = latest.categories.filter((category) => category.id !== "tools");
  latest.settings.links = [];
  await env.server.mutate("test-user", {
    operation: "update",
    profile_id: latest.id,
    revision: 0,
    profile: latest,
  });
  const writes = env.server.requests.length;
  await clickAndFlush(view.form.querySelector(".qap-category-submit"));
  assert.equal(view.form.isConnected, true);
  assert.deepEqual(view.ids(), order);
  assert.match(
    view.form.querySelector(".qap-form-body").querySelector(".qap-error").textContent,
    /no longer exists/,
  );
  assert.equal(env.server.requests.length, writes);
  assert.deepEqual(savedProfile(env), latest);
});

test("group grid layout settings start collapsed and the header toggles them", async () => {
  const env = environment();
  await openShortcutsSettings("/config", undefined, env);
  const { form } = await openArrangement(env);
  const settings = form.querySelector(".qap-grid-settings");
  const toggle = form.querySelector(".qap-grid-layout-toggle");
  assert.equal(toggle.querySelector("span").textContent, "Grid layout");
  assert.equal(toggle.getAttribute("aria-controls"), settings.id);
  assert.equal(
    form.querySelector(".qap-grid-layout-heading").nextElementSibling,
    settings,
    "the header sits above rows and columns",
  );
  assert.equal(settings.hidden, true);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await clickAndFlush(toggle);
  assert.equal(settings.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  await clickAndFlush(toggle);
  assert.equal(settings.hidden, true);
  const columns = form.querySelector(".qap-grid-stepper").querySelector("qap-input, input");
  columns.value = "0";
  columns.dispatchEvent(new Event("input"));
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.equal(settings.hidden, false, "an invalid dimension expands the settings");
  assert.equal(env.server.requests.length, 0);
});

test("group rows show their shortcut and filter counts", async () => {
  const env = environment();
  const profile = savedProfile(env);
  profile.categories.push({ id: "rooms", name: "Rooms" }, { id: "empty", name: "Empty" });
  profile.settings.links = [
    ...manyShortcuts(3).map((link) => ({ ...link, group: "rooms" })),
    {
      id: "filter-a",
      name: "Filter A",
      icon: "mdi:filter",
      color: "",
      type: "saved-filter",
      path: "",
      group: "rooms",
      filterKind: "states",
      filterId: "all",
    },
    {
      id: "single",
      name: "Single",
      icon: "mdi:home",
      color: "",
      type: "internal",
      path: "/single",
      group: "favorites",
    },
  ];
  await openShortcutsSettings("/config", undefined, env);
  const summary = (id) =>
    openCategoriesManager(env)
      .querySelectorAll(".qap-category-row")
      .find((row) => row.dataset.id === id)
      .querySelector(".qap-edit-texts")
      .querySelector("small").textContent;
  assert.equal(summary("favorites"), "1 shortcut");
  assert.equal(summary("rooms"), "3 shortcuts, 1 filter");
  assert.equal(summary("empty"), "0 shortcuts");
});

test("edit forms replace Cancel with Delete except for protected groups and new items", async () => {
  const env = await openShortcutsSettings("/config");
  await createCategoryInSettings(env, "Rooms");
  let { form } = await openArrangement(env);
  assert.ok(form.querySelector(".qap-category-cancel"), "Favorites keeps Cancel");
  assert.equal(form.querySelector(".qap-category-delete"), null);
  await clickAndFlush(form.querySelector(".qap-category-cancel"));
  openCategoriesManager(env).querySelector(".qap-create-category").click();
  form = env.document.body.querySelector(".qap-category-form");
  assert.ok(form.querySelector(".qap-category-cancel"), "a new group keeps Cancel");
  await clickAndFlush(form.querySelector(".qap-category-cancel"));
  const id = env.server
    .data("test-user")
    .profiles[0].categories.find((item) => item.name === "Rooms").id;
  ({ form } = await openArrangement(env, id));
  assert.equal(form.querySelector(".qap-category-cancel"), null);
  const remove = form.querySelector(".qap-category-delete");
  assert.equal(remove.getAttribute("variant"), "danger");
  categoryInput(form).value = "Unsaved rename";
  await clickAndFlush(remove);
  const confirmation = env.document.body.querySelector(".qap-delete-category-confirmation");
  assert.ok(confirmation);
  await clickAndFlush(buttons(confirmation).find((item) => item.textContent === "Cancel"));
  assert.equal(form.isConnected, true, "cancelling the confirmation keeps the editor");
  await clickAndFlush(remove);
  await clickAndFlush(
    env.document.body
      .querySelector(".qap-delete-category-confirmation")
      .querySelector(".qap-button-danger, .qap-button-primary"),
  );
  assert.deepEqual(
    env.server.data("test-user").profiles[0].categories.map((item) => item.name),
    ["Favorites"],
  );
  assert.equal(form.isConnected, false, "the editor closes after deletion");
  assert.equal(env.document.body.querySelector(".qap-discard-changes-confirmation"), null);
  assert.deepEqual(
    env.document.body.querySelectorAll(".qap-category-row").map((row) => row.dataset.id),
    ["favorites"],
  );
});

test("Edit profile offers Delete and closes after the profile is deleted", async () => {
  const env = await startProfiles(environment());
  const other = {
    id: "other",
    name: "Other device",
    icon: "mdi:tablet",
    settings: defaultSettings(),
    favorites: [],
    categories: defaultCategories(),
  };
  await env.server.mutate("test-user", {
    operation: "create",
    profile_id: other.id,
    revision: 0,
    profile: other,
  });
  const editor = await manageProfile(env, "other", "edit");
  assert.equal(editor.querySelector(".qap-profile-cancel"), null);
  const remove = editor.querySelector(".qap-profile-delete");
  assert.equal(remove.getAttribute("variant"), "danger");
  await clickAndFlush(remove);
  const confirmation = env.document.body.querySelector(".qap-delete-profile-confirmation");
  assert.match(
    confirmation.querySelector("#qap-delete-profile-description").textContent,
    /Other device/,
  );
  await clickAndFlush(confirmation.querySelector(".qap-button-danger"));
  assert.deepEqual(
    env.server.data("test-user").profiles.map((item) => item.id),
    ["test-profile"],
  );
  assert.equal(activeProfileEditor(env), undefined);
  assert.equal(
    env.document.body
      .querySelectorAll(".qap-profile-row")
      .some((row) => row.dataset.id === "other"),
    false,
  );
  env.document.body.querySelector(".qap-create-profile").click();
  assert.ok(activeProfileEditor(env).querySelector(".qap-profile-cancel"), "Create keeps Cancel");
  assert.equal(activeProfileEditor(env).querySelector(".qap-profile-delete"), null);
});

test("Edit filter deletes through the shared confirmation and returns to the list", async () => {
  const env = environment();
  const definitions = await filterDefinitions(env);
  const profile = savedProfile(env);
  profile.filters = clone(definitions.profileFilters());
  profile.filters.states.push({
    id: "custom",
    name: "Custom",
    hidden: false,
    condition: definitions.group([definitions.rule("state", "equals", "on")]),
  });
  await openEntityStates(env);
  await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
  const panel = env.document.body
    .querySelector(".qap-filter-modal")
    .querySelector(".qap-filter-panel");
  await filterAction(env, panel, "Custom", "edit");
  await clickAndFlush(panel.querySelector(".qap-filter-delete"));
  await clickAndFlush(
    env.document.body
      .querySelector(".qap-delete-filter-confirmation")
      .querySelector(".qap-button-danger"),
  );
  assert.equal(
    savedProfile(env).filters.states.some((item) => item.id === "custom"),
    false,
  );
  assert.ok(panel.querySelector(".qap-filter-list"), "deletion returns to the filter list");
  assert.equal(panel.querySelector(".qap-filter-metadata"), null);
  await clickAndFlush(env.document.body.querySelector(".qap-create-filter"));
  assert.ok(panel.querySelector(".qap-filter-cancel"), "Create filter keeps Cancel");
  assert.equal(panel.querySelector(".qap-filter-delete"), null);
});
