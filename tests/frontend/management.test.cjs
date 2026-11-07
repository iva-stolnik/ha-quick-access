// Management rows, Move Up/Down and item feedback.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  loadDefaults,
  flush,
  clickAndFlush,
  clone,
  filterDefinitions,
  editNewFilter,
  savedProfile,
  environment,
  openEntityStates,
  buttons,
  openShortcutsSettings,
  manyShortcuts,
  arrangementPointer,
  arrangeKey,
  startProfiles,
  profileManager,
  activeProfileEditor,
  profileMenuIn,
  profileNameInput,
  createProfileInDialog,
  trackFocus,
  categoryInput,
  openCategoriesManager,
  categoryAction,
  categorySelect,
  selectAndFlush,
  createCategoryInSettings,
} = require("./harness.cjs");
let shortcutPageSize;
test.before(async () => ({ shortcutPageSize } = await loadDefaults()));

for (const kind of ["groups", "filters", "shortcuts"]) {
  test(`${kind} management rows are static: click to edit, sibling actions and no drag gestures`, async () => {
    const env = environment();
    trackFocus(env);
    const profile = savedProfile(env);
    profile.categories.push({ id: "tools", name: "Tools" });
    let list;
    if (kind === "filters") {
      await openEntityStates(env);
      await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
      list = env.document.body.querySelector(".qap-filter-list");
    } else {
      await openShortcutsSettings("/config", undefined, env);
      list =
        kind === "groups"
          ? openCategoriesManager(env).querySelector(".qap-category-list")
          : env.document.body.querySelector(".qap-shortcut-list");
    }
    assert.equal(list.classList.contains("qap-reorder-list"), false);
    assert.equal(
      env.document.body.querySelector("qap-sortable"),
      null,
      "no sortable control outside Edit Group",
    );
    const original = list.children.map((row) => row.dataset.id);
    const requests = env.server.requests.length;
    for (const row of list.children) {
      assert.equal(row.tabIndex, undefined);
      assert.equal(row.attributes.role, undefined);
      assert.equal(row.attributes["aria-keyshortcuts"], undefined);
      assert.equal(row.attributes["aria-description"], undefined);
      assert.equal(row.querySelector(".qap-grip"), null, "no drag handles");
      const [content, ...actions] = row.children;
      const editable = kind !== "filters" || content.classList.contains("qap-filter-edit");
      assert.equal(content.localName, editable ? "button" : "div");
      assert.ok(content.classList.contains("qap-edit-content"));
      assert.deepEqual(buttons(content), [], "no nested interactive controls");
      assert.ok(actions.length > 0 && actions.every((action) => !content.contains(action)));
      const pointer = arrangementPointer(env, row);
      pointer("pointerdown");
      await env.tick(400);
      pointer("pointermove", 45, 300);
      pointer("pointerup");
      assert.equal(row.classList.contains("qap-dragging"), false, "long press never starts a drag");
      await arrangeKey(row, "ArrowDown");
      await arrangeKey(content, "ArrowDown");
    }
    assert.equal(env.document.body.querySelector(".qap-drag-origin"), null);
    assert.deepEqual(
      list.children.map((row) => row.dataset.id),
      original,
    );
    assert.equal(env.server.requests.length, requests);
    const editor = () =>
      env.document.body.querySelector(
        ".qap-category-form, .qap-shortcut-form, .qap-filter-metadata",
      );
    const row = list.children.find((item) =>
      item.querySelector(".qap-filter-edit, .qap-category-edit, .qap-shortcut-row"),
    );
    const overflow = row.querySelector(
      ".qap-filter-overflow, .qap-category-overflow, .qap-shortcut-overflow",
    );
    await clickAndFlush(overflow);
    assert.ok(profileMenuIn(env));
    assert.equal(editor(), null, "overflow never opens the editor");
    await clickAndFlush(overflow);
    assert.equal(profileMenuIn(env), null);
    await clickAndFlush(row.children[0]);
    assert.ok(editor(), "the main row opens the editor");
  });
}

test("group Move Up/Down swap neighbours after acknowledgement, highlight the moved row and keep order on failure", async () => {
  const env = await openShortcutsSettings("/config");
  trackFocus(env);
  await createCategoryInSettings(env, "Rooms");
  await createCategoryInSettings(env, "Work");
  await env.tick(2000);
  const manager = openCategoriesManager(env);
  const list = manager.querySelector(".qap-category-list");
  const names = () => list.children.map((row) => row.querySelector("strong").textContent);
  const saved = () => env.server.data("test-user").profiles[0].categories.map((item) => item.name);
  const rowNamed = (name) =>
    list.children.find((row) => row.querySelector("strong").textContent === name);
  const menuValues = async (name) => {
    await clickAndFlush(rowNamed(name).querySelector(".qap-category-overflow"));
    const values = buttons(profileMenuIn(env)).map((item) => item.value);
    await clickAndFlush(rowNamed(name).querySelector(".qap-category-overflow"));
    return values;
  };
  assert.deepEqual(
    await menuValues("Favorites"),
    ["move-down"],
    "Favorites can move but is never deletable",
  );
  assert.deepEqual(await menuValues("Rooms"), ["move-up", "move-down", "delete"]);
  assert.deepEqual(await menuValues("Work"), ["move-up", "delete"]);
  const links = clone(env.server.data("test-user").profiles[0].settings.links);
  const writes = env.server.requests.length;
  await clickAndFlush(categoryAction(env, rowNamed("Work"), "move-up"));
  assert.equal(env.server.requests.length, writes + 1, "one write per movement");
  assert.deepEqual(saved(), ["Favorites", "Work", "Rooms"]);
  assert.deepEqual(names(), ["Favorites", "Work", "Rooms"]);
  assert.deepEqual(
    env.server.data("test-user").profiles[0].settings.links,
    links,
    "moving a group never reorders shortcuts",
  );
  assert.equal(rowNamed("Work").classList.contains("qap-drop-highlight"), true);
  assert.equal(list.querySelectorAll(".qap-drop-highlight").length, 1);
  assert.equal(
    env.document.activeElement,
    rowNamed("Work").querySelector(".qap-category-overflow"),
  );
  await env.tick(2000);
  assert.equal(rowNamed("Work").classList.contains("qap-drop-highlight"), false);
  await clickAndFlush(categoryAction(env, rowNamed("Favorites"), "move-down"));
  assert.deepEqual(saved(), ["Work", "Favorites", "Rooms"]);
  await clickAndFlush(categoryAction(env, rowNamed("Favorites"), "move-up"));
  assert.deepEqual(saved(), ["Favorites", "Work", "Rooms"]);
  await env.tick(2000);
  env.server.failWrites = true;
  await clickAndFlush(categoryAction(env, rowNamed("Rooms"), "move-up"));
  assert.deepEqual(saved(), ["Favorites", "Work", "Rooms"]);
  assert.deepEqual(names(), ["Favorites", "Work", "Rooms"], "failed saves keep the previous order");
  assert.equal(
    list.querySelector(".qap-drop-highlight"),
    null,
    "failed saves show no success feedback",
  );
  assert.match(
    env.document.body.querySelector(".qap-profile-status").querySelector(".qap-error").textContent,
    /Could not save changes on the server/,
  );
  env.server.failWrites = false;
  await clickAndFlush(categoryAction(env, rowNamed("Rooms"), "move-up"));
  assert.deepEqual(saved(), ["Favorites", "Rooms", "Work"], "a failed move can be retried");
});

test("filter rows edit separately and apply only through Apply", async () => {
  const env = environment();
  const definitions = await filterDefinitions(env);
  const profile = savedProfile(env);
  profile.filters = clone(definitions.profileFilters());
  profile.filters.states.push(
    {
      id: "custom",
      name: "Custom",
      hidden: false,
      condition: definitions.group([definitions.rule("state", "equals", "on")]),
    },
    {
      id: "off",
      name: "Off",
      hidden: true,
      condition: definitions.group([definitions.rule("state", "equals", "off")]),
    },
  );
  await openEntityStates(env);
  const selected = () =>
    env.document.body
      .querySelector(".qap-state-tabs")
      .children.find((chip) => chip.attributes["aria-pressed"] === "true")?.dataset.domain;
  const modal = () => env.document.body.querySelector(".qap-filter-modal");
  const row = (id) =>
    env.document.body
      .querySelector(".qap-filter-list")
      .children.find((item) => item.dataset.id === id);
  await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
  const custom = row("custom");
  assert.deepEqual(
    custom.children.map((item) =>
      item.classList.contains("qap-filter-edit")
        ? "edit"
        : item.classList.contains("qap-filter-apply")
          ? "apply"
          : "overflow",
    ),
    ["edit", "apply", "overflow"],
  );
  assert.equal(custom.querySelector(".qap-filter-apply").attributes["aria-label"], "Apply Custom");
  assert.equal(
    custom.querySelector(".qap-filter-edit").attributes["aria-description"],
    "Edit filter",
  );
  assert.equal(
    row("off").querySelector(".qap-filter-apply").disabled,
    true,
    "hidden filters cannot be applied",
  );
  assert.equal(
    Boolean(row("off").querySelector(".qap-filter-edit").disabled),
    false,
    "hidden filters remain editable",
  );
  assert.equal(
    row("all").querySelector(".qap-filter-edit"),
    null,
    "system filters do not appear editable",
  );
  assert.equal(
    row("all").querySelector(".qap-filter-apply").attributes["aria-label"],
    "Apply All",
    "system filters offer the same Apply action",
  );
  const before = selected();
  const writes = env.server.requests.length;
  await clickAndFlush(custom.querySelector(".qap-filter-edit"));
  assert.ok(
    env.document.body.querySelector(".qap-filter-metadata"),
    "the editable row opens Edit filter",
  );
  assert.equal(selected(), before, "editing never applies a filter");
  assert.equal(
    env.document.body.querySelector(".qap-filter-cancel"),
    null,
    "editing a saved filter offers Delete instead of Cancel",
  );
  assert.ok(env.document.body.querySelector(".qap-filter-delete"));
  await clickAndFlush(env.document.body.querySelector(".qap-filter-close"));
  assert.ok(modal(), "closing Edit filter keeps the filter dialog open");
  assert.equal(env.document.body.querySelector(".qap-filter-metadata"), null);
  assert.ok(row("custom"), "closing Edit filter returns to the filter list");
  await clickAndFlush(env.document.body.querySelector(".qap-create-filter"));
  assert.ok(env.document.body.querySelector(".qap-filter-metadata"), "Create filter opens");
  await clickAndFlush(env.document.body.querySelector(".qap-filter-cancel"));
  assert.ok(row("custom"), "cancelling Create filter returns to the filter list");
  assert.equal(env.server.requests.length, writes, "leaving a form never writes");
  await clickAndFlush(row("custom").querySelector(".qap-filter-apply"));
  assert.equal(selected(), "custom", "Apply uses the existing selection in one tap");
  assert.equal(modal(), null, "Apply dismisses the filter dialog");
  for (const id of ["all", "favorites"]) {
    await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
    const activeModal = modal();
    const previous = selected();
    const content = row(id).querySelector(".qap-edit-content");
    assert.equal(content.localName, "div", "system filter content is not a button");
    assert.equal(content.attributes.tabindex, undefined);
    await clickAndFlush(content);
    await clickAndFlush(row(id).querySelector(".qap-filter-name"));
    await clickAndFlush(row(id).querySelector(".qap-edit-symbol"));
    await clickAndFlush(row(id));
    assert.equal(selected(), previous, "clicking system filter content does not apply it");
    assert.equal(modal(), activeModal, "clicking system filter content leaves the dialog open");
    await clickAndFlush(row(id).querySelector(".qap-filter-apply"));
    assert.equal(selected(), id, "Apply selects the system filter");
    assert.equal(modal(), null, "Apply on a system filter dismisses the filter dialog");
  }
  assert.equal(env.server.requests.length, writes, "applying filters never writes");
});

test("item feedback replaces timers, resolves connected rows and retains expiry across rendering", async () => {
  const env = environment();
  trackFocus(env);
  const { createItemFeedback } = await env.run("ui/item-feedback.ts");
  const rows = new Map();
  const feedback = createItemFeedback((id) => rows.get(id));
  const first = env.document.createElement("div"),
    second = env.document.createElement("div");
  rows.set("one", first);
  rows.set("two", second);
  feedback.show("one", true);
  assert.equal(
    first.classList.contains("qap-drop-highlight"),
    false,
    "detached targets remain pending",
  );
  env.document.body.append(first);
  feedback.refresh();
  assert.equal(first.lastScrollOptions.container, "nearest");
  const expiry = [...env.timers].find(([, timer]) => timer.delay === 2000)[0];
  await env.tick(1000);
  const replacement = env.document.createElement("div");
  first.remove();
  env.document.body.append(replacement);
  rows.set("one", replacement);
  feedback.refresh();
  assert.equal(first.classList.contains("qap-drop-highlight"), false);
  assert.equal(replacement.classList.contains("qap-drop-highlight"), true);
  assert.ok(env.timers.has(expiry), "rendering must retain the existing timer");
  await env.tick(2000);
  assert.equal(replacement.classList.contains("qap-drop-highlight"), false);
  env.document.body.append(second);
  feedback.show("one");
  await env.tick(1000);
  feedback.show("two");
  assert.equal(replacement.classList.contains("qap-drop-highlight"), false);
  await env.tick(1000);
  assert.equal(second.classList.contains("qap-drop-highlight"), true);
  feedback.dispose();
  assert.equal(second.classList.contains("qap-drop-highlight"), false);
  assert.equal(
    [...env.timers.values()].some((timer) => timer.delay === 2000),
    false,
  );
});

test("reorder feedback waits for acknowledgement and resolves replacement rows by ID", async () => {
  const env = environment();
  const { createReorderController } = await env.run("ui/reorder.ts");
  const owner = env.document.createElement("section"),
    list = env.document.createElement("div");
  env.document.body.append(owner);
  owner.append(list);
  const rows = ["one", "two"].map((id) => {
    const row = env.document.createElement("div");
    row.dataset.id = id;
    row.classList.add("qap-edit-item");
    list.append(row);
    return row;
  });
  let finish;
  const reorder = createReorderController({
    isSaving: () => false,
    isActive: () => owner.isConnected,
    move: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    announce() {},
  });
  reorder.registerList(list);
  rows.forEach((row) => reorder.bindHandle(row, row, list, owner));
  await arrangeKey(rows[0], "ArrowDown");
  assert.equal(rows[0].classList.contains("qap-drop-highlight"), false);
  const replacement = env.document.createElement("div");
  replacement.dataset.id = "one";
  replacement.classList.add("qap-edit-item");
  rows[0].remove();
  list.append(replacement);
  finish(true);
  await flush();
  assert.equal(rows[0].classList.contains("qap-drop-highlight"), false);
  assert.equal(replacement.classList.contains("qap-drop-highlight"), true);
  await env.tick(2000);
  await arrangeKey(rows[1], "ArrowDown");
  finish(false);
  await flush();
  assert.equal(rows[1].classList.contains("qap-drop-highlight"), false);
  await arrangeKey(rows[1], "ArrowDown");
  reorder.dispose();
  finish(true);
  await flush();
  assert.equal(
    rows[1].classList.contains("qap-drop-highlight"),
    false,
    "a disposed owner cannot show late success",
  );
});

test("profile creation feedback follows an ordinary list refresh without restarting its timer", async () => {
  const env = await startProfiles(environment());
  trackFocus(env);
  await createProfileInDialog(env, "New profile");
  const manager = env.document.body.querySelector(".qap-profiles");
  const row = manager.querySelector(".qap-drop-highlight");
  const expiry = [...env.timers].find(([, timer]) => timer.delay === 2000)[0];
  env.server.notify("test-user");
  await flush();
  const replacement = env.document.body.querySelector(".qap-drop-highlight");
  assert.notEqual(replacement, row);
  assert.equal(replacement.dataset.id, env.window.quickAccessDebug().activeProfileId);
  assert.equal(row.classList.contains("qap-drop-highlight"), false);
  assert.equal(env.timers.has(expiry), true);
  await env.tick(2000);
  assert.equal(replacement.classList.contains("qap-drop-highlight"), false);
});

test("profile display ordering sorts names and stable IDs without mutating the collection", async () => {
  const env = environment();
  const { profilesByName } = await env.run("profiles/profile-order.ts");
  const profiles = [
    { id: "z", name: "Zulu" },
    { id: "b", name: "Alpha" },
    { id: "a", name: "Alpha" },
  ];
  const before = [...profiles];
  assert.deepEqual(
    Array.from(profilesByName(profiles), (profile) => profile.id),
    ["a", "b", "z"],
  );
  assert.deepEqual(profiles, before);
});

for (const scenario of ["empty", "boundary", "grouped"]) {
  test(`new shortcuts reveal their category-ordered management page (${scenario})`, async () => {
    const count = scenario === "empty" ? 0 : shortcutPageSize + (scenario === "grouped" ? 1 : 0);
    const group = scenario === "boundary" ? "tools" : "favorites";
    const env = environment();
    trackFocus(env);
    const profile = savedProfile(env);
    profile.categories.push({ id: "tools", name: "Tools" });
    profile.settings.links = manyShortcuts(count || 1, "tools");
    if (count === 0) profile.settings.links = [];
    if (scenario === "grouped") profile.settings.links.at(-1).group = "favorites";
    await openShortcutsSettings("/config", undefined, env);
    await clickAndFlush(env.document.body.querySelector(".qap-add-shortcut"));
    const editor = env.document.body.querySelector(".qap-shortcut-form");
    editor.querySelectorAll("qap-input").find((field) => field.label === "Name").value =
      "New shortcut";
    await selectAndFlush(
      editor.querySelectorAll("qap-select").find((field) => field.label === "Shortcut type"),
      "quick-states",
    );
    await selectAndFlush(categorySelect(editor), "category:" + group);
    env.server.failWrites = true;
    const save = buttons(editor).find((button) => button.textContent === "Save");
    await clickAndFlush(save);
    assert.equal(env.document.body.querySelector(".qap-drop-highlight"), null);
    env.server.failWrites = false;
    const mutate = env.server.mutate.bind(env.server);
    let finish;
    env.server.mutate = async (...args) => {
      await new Promise((resolve) => {
        finish = resolve;
      });
      return mutate(...args);
    };
    save.click();
    await flush();
    assert.equal(editor.isConnected, true);
    assert.equal(env.document.body.querySelector(".qap-drop-highlight"), null);
    finish();
    await flush();
    const saved = savedProfile(env),
      created = saved.settings.links.find((link) => link.name === "New shortcut");
    const ordered = saved.categories.flatMap((category) =>
      saved.settings.links.filter((link) => link.group === category.id),
    );
    const page = Math.floor(ordered.findIndex((link) => link.id === created.id) / shortcutPageSize);
    const row = env.document.body.querySelector(".qap-drop-highlight");
    assert.equal(editor.isConnected, false);
    assert.equal(row.dataset.id, created.id);
    assert.equal(row.lastScrollOptions.container, "nearest");
    assert.equal(
      env.document.body.querySelector(".qap-pagination").querySelector(".qap-count").textContent,
      `Page ${page + 1} of ${Math.max(1, Math.ceil(ordered.length / shortcutPageSize))}`,
    );
    await env.tick(2000);
    assert.equal(row.classList.contains("qap-drop-highlight"), false);
    await clickAndFlush(env.document.body.querySelector(".qap-head-button"));
    assert.equal(env.document.body.querySelector(".qap-drop-highlight"), null);
  });
}

test("new groups reveal the saved row and newly active profiles reveal the current section", async () => {
  const env = await openShortcutsSettings("/config");
  trackFocus(env);
  const manager = openCategoriesManager(env);
  await clickAndFlush(manager.querySelector(".qap-create-category"));
  const form = env.document.body.querySelector(".qap-category-form");
  categoryInput(form).value = "New group";
  env.server.failWrites = true;
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.equal(env.document.body.querySelector(".qap-drop-highlight"), null);
  env.server.failWrites = false;
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  const group = savedProfile(env).categories.find((category) => category.name === "New group");
  let row = env.document.body.querySelector(".qap-drop-highlight");
  assert.equal(row.dataset.id, group.id);
  assert.equal(row.lastScrollOptions.container, "nearest");
  await createProfileInDialog(env, "New profile");
  row = env.document.body.querySelector(".qap-drop-highlight");
  assert.equal(row.dataset.id, env.window.quickAccessDebug().activeProfileId);
  assert.equal(row.parentElement.classList.contains("qap-current-profile"), true);
  assert.equal(row.classList.contains("qap-edit-item"), true);
  assert.equal(row.lastScrollOptions.container, "nearest");
  await clickAndFlush(env.document.body.querySelector(".qap-head-button"));
  assert.equal(
    [...env.timers.values()].some((timer) => timer.delay === 2000),
    false,
  );
});

test("created filters apply immediately and reveal only when their same-context list is reopened", async () => {
  const env = environment();
  trackFocus(env);
  await openEntityStates(env);
  const panel = await editNewFilter(env, "New saved filter");
  const save = buttons(panel).find((button) => button.textContent === "Save");
  env.server.failWrites = true;
  await clickAndFlush(save);
  assert.equal(env.document.body.querySelector(".qap-drop-highlight"), null);
  env.server.failWrites = false;
  await clickAndFlush(save);
  const created = savedProfile(env).filters.states.find(
    (filter) => filter.name === "New saved filter",
  );
  assert.equal(env.document.body.querySelector(".qap-filter-modal"), null);
  await env.tick(3000);
  await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
  const row = panel.querySelector(".qap-drop-highlight");
  assert.equal(row.dataset.id, created.id);
  assert.equal(row.lastScrollOptions.container, "nearest");
  await clickAndFlush(env.document.body.querySelector(".qap-filter-close"));
  await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
  assert.equal(panel.querySelector(".qap-drop-highlight"), null, "a consumed reveal cannot replay");
});

test("failed profile creation has no feedback and confirmed creation uses its actual selected ID", async () => {
  const env = await startProfiles(environment());
  trackFocus(env);
  const manager = await profileManager(env);
  await clickAndFlush(manager.querySelector(".qap-create-profile"));
  const editor = activeProfileEditor(env);
  profileNameInput(editor).value = "Confirmed profile";
  env.server.failWrites = true;
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.equal(env.document.body.querySelector(".qap-drop-highlight"), null);
  assert.equal(editor.isConnected, true);
  env.server.failWrites = false;
  const mutate = env.server.mutate.bind(env.server);
  let finish;
  env.server.mutate = async (...args) => {
    await new Promise((resolve) => {
      finish = resolve;
    });
    return mutate(...args);
  };
  editor.querySelector(".qap-profile-submit").click();
  await flush();
  assert.equal(env.document.body.querySelector(".qap-drop-highlight"), null);
  finish();
  await flush();
  const row = env.document.body.querySelector(".qap-drop-highlight");
  assert.equal(row.dataset.id, env.window.quickAccessDebug().activeProfileId);
  assert.equal(row.querySelector("strong").textContent, "Confirmed profile");
  await clickAndFlush(env.document.body.querySelector(".qap-head-button"));
  await clickAndFlush(env.document.body.querySelector(".qap-back-settings"));
  await clickAndFlush(env.document.body.querySelector(".qap-head-button"));
  assert.equal(row.classList.contains("qap-drop-highlight"), false);
  assert.equal(
    [...env.timers.values()].some((timer) => timer.delay === 2000),
    false,
  );
});

test("closing a registry context discards pending filter feedback", async () => {
  const env = environment();
  await openEntityStates(env);
  const panel = await editNewFilter(env, "Pending filter");
  await clickAndFlush(buttons(panel).find((button) => button.textContent === "Save"));
  await clickAndFlush(env.document.body.querySelector(".qap-head-button"));
  await clickAndFlush(env.document.body.querySelector(".qap-tile"));
  await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
  assert.equal(env.document.body.querySelector(".qap-drop-highlight"), null);
});
