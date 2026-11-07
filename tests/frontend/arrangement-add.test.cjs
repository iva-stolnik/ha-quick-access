// Edit Group dimensions and the arrangement Add tile.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const path = require("node:path");
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
  buttons,
  respondToDiscard,
  navigationEnvironment,
  openShortcutsSettings,
  manyShortcuts,
  openArrangement,
  groupWithShortcuts,
  addTileOf,
  optionsOf,
  placeholderCount,
  openNestedEditor,
  fillNewShortcut,
  saveNewShortcut,
  shortcutIds,
  reorderToCADB,
  arrangeKey,
  trackFocus,
  categoryInput,
  openCategoriesManager,
  categorySelect,
} = require("./harness.cjs");
let shortcutLimit;
test.before(async () => ({ shortcutLimit } = await loadDefaults()));

test("group steppers enforce both bounds and reflow the draft without changing order", async () => {
  const env = environment();
  const profile = savedProfile(env);
  profile.categories[0].grid = { columns: 4, rows: 4 };
  profile.settings.links = manyShortcuts(10);
  await openShortcutsSettings("/config", undefined, env);
  const { form, list, ids } = await openArrangement(env);
  const original = ids();
  const slots = form.querySelector(".qap-arrangement-placeholders");
  assert.equal(slots.children.length, 5, "Add occupies the eleventh cell");
  assert.equal(slots.getAttribute("aria-hidden"), "true");
  assert.equal(slots.inert, true);
  assert.ok(slots.children.every((item) => !item.dataset.id && item.tabIndex !== 0));
  assert.equal(list.querySelector(".qap-grid-placeholder"), null);
  for (const [index, dimension] of ["columns", "rows"].entries()) {
    const stepper = form.querySelectorAll(".qap-grid-stepper")[index];
    const control = stepper.querySelector("qap-input");
    const decrease = stepper.querySelector(".qap-grid-decrease");
    const increase = stepper.querySelector(".qap-grid-increase");
    assert.match(increase.getAttribute("aria-label"), new RegExp(dimension));
    for (let count = 0; count < 12; count++) decrease.click();
    assert.equal(control.value, "1");
    assert.equal(decrease.disabled, true);
    assert.equal(increase.disabled, false);
    assert.deepEqual(ids(), original);
    for (let count = 0; count < 12; count++) increase.click();
    assert.equal(control.value, "10");
    assert.equal(decrease.disabled, false);
    assert.equal(increase.disabled, true);
    assert.deepEqual(ids(), original);
    if (dimension === "columns")
      assert.equal(list.style.getPropertyValue("--qap-grid-columns"), "10");
  }
  assert.match(form.querySelector("style").textContent, /nth-child\(100n \+ 1\)/);
  assert.equal(slots.children.length, 89, "ten shortcuts and Add on a 10 × 10 page");
  assert.equal(env.server.requests.length, 0);
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.equal(env.server.requests.length, 1);
  assert.deepEqual(
    savedProfile(env).settings.links.map((link) => link.id),
    original,
  );
  assert.deepEqual(savedProfile(env).categories[0].grid, { columns: 10, rows: 10 });
});

test("arrangement help shares Display Rules dismissal and never dirties a group draft", async () => {
  const env = environment();
  installLocaleFetch(env);
  await openShortcutsSettings("/config", undefined, env);
  const { form } = await openArrangement(env);
  const help = form.querySelector(".qap-arrangement-help");
  const tooltip = form.querySelector("qap-tooltip");
  assert.equal(tooltip.anchorElement, help);
  assert.equal(help.getAttribute("aria-controls"), tooltip.id);
  assert.equal(
    help.classList.contains("qap-linkish"),
    true,
    "help uses the Display Rules Learn more link style",
  );
  assert.equal(help.querySelector("span").textContent, "Learn more");
  assert.equal(tooltip.open, false);
  await clickAndFlush(help);
  assert.equal(tooltip.open, true);
  assert.match(
    tooltip.querySelector("p").textContent,
    /Hold a card.*one position.*one row.*Escape/,
  );
  await dispatchAndFlush(
    help,
    Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" }),
  );
  assert.equal(tooltip.open, false);
  assert.equal(form.isConnected, true);
  await dispatchAndFlush(help, new Event("focusin"));
  assert.equal(tooltip.open, true);
  await dispatchAndFlush(tooltip, new Event("close"));
  assert.equal(tooltip.open, false);
  await changeLanguage(env, "hr");
  assert.equal(help.querySelector("span").textContent, "Saznaj više");
  assert.equal(form.querySelector(".qap-grid-labels").label, "Prikaži nazive");
  await clickAndFlush(form.querySelector(".qap-category-cancel"));
  assert.equal(form.isConnected, false, "help, focus and language changes leave a clean draft");
  assert.equal(env.document.body.querySelector(".qap-discard-changes-confirmation"), null);
  assert.equal(env.server.requests.length, 0);
});

test("unchanged explicit show-name preferences survive saving other group fields", async () => {
  const env = environment();
  const profile = savedProfile(env);
  profile.categories.push({
    id: "tools",
    name: "Tools",
    grid: { columns: 4, rows: 4, hideNames: false },
  });
  await openShortcutsSettings("/config", undefined, env);
  const { form } = await openArrangement(env, "tools");
  assert.equal(form.querySelector(".qap-grid-labels").checked, true);
  assert.equal(categoryInput(form).disabled, false);
  categoryInput(form).value = "Renamed tools";
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.deepEqual(savedProfile(env).categories.at(-1), {
    id: "tools",
    name: "Renamed tools",
    grid: { columns: 4, rows: 4, hideNames: false },
  });
});

test("Add tile follows the last enabled shortcut, stays outside sorting and never moves order", async () => {
  const env = environment();
  const view = await groupWithShortcuts(env, 5);
  const { form, list, ids } = view;
  const add = addTileOf(form);
  assert.equal(add.localName, "button");
  assert.equal(add.type, "button");
  assert.equal(add.getAttribute("aria-label"), "Add shortcut");
  assert.equal(add.querySelector(".qap-tile-name").textContent, "Add");
  assert.equal(add.disabled, false);
  assert.equal(add.inert, undefined);
  assert.equal(add.dataset.id, undefined);
  assert.equal(add.getAttribute("role"), null);
  assert.equal(list.contains(add), false, "Add is never a sortable item");
  assert.equal(
    form.querySelector(".qap-arrangement-placeholders").contains(add),
    false,
    "inert placeholders stay inert",
  );
  // [1][2] [3][4] | [5][+] [ ][ ]
  const row = add.parentElement;
  assert.equal(add.style.gridColumn, "2");
  assert.equal(row.classList.contains("qap-partial-row"), true);
  assert.equal(row.classList.contains("qap-page-start"), false);
  assert.equal(placeholderCount(form), 2);
  assert.equal(form.querySelector(".qap-arrangement-empty").hidden, true);
  const order = ids();
  assert.deepEqual(order, ["shortcut-0", "shortcut-1", "shortcut-2", "shortcut-3", "shortcut-4"]);
  // Pointer presses on Add never start a long-press drag.
  add.dispatchEvent(
    Object.assign(new Event("pointerdown", { cancelable: true }), {
      button: 0,
      pointerId: 3,
      clientX: 1,
      clientY: 1,
    }),
  );
  await env.tick(400);
  assert.equal(form.querySelector(".qap-dragging"), null);
  const [columns] = form.querySelector(".qap-grid-fields").querySelectorAll("qap-input");
  columns.value = "5";
  columns.dispatchEvent(new Event("input"));
  assert.equal(add.style.gridColumn, "1", "five shortcuts fill a five-column row");
  assert.equal(row.classList.contains("qap-partial-row"), false);
  assert.equal(placeholderCount(form), 4);
  assert.deepEqual(ids(), order, "dimension changes never change order");
  assert.match(form.querySelector("style").textContent, /nth-child\(10n \+ 1\)/);
  assert.equal(
    form.querySelector("style").textContent.includes(".qap-arrangement-add::before"),
    false,
    "Add shares page 1",
  );
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.deepEqual(savedProfile(env).categories[0].grid, { columns: 5, rows: 2 });
  assert.equal(JSON.stringify(savedProfile(env)).includes("qap-arrangement-add"), false);
  assert.deepEqual(shortcutIds(env), [...order, "disabled"]);
});

test("Add ignores long presses and drags but opens the editor on a tap or keyboard activation", async () => {
  const env = environment();
  const { form } = await groupWithShortcuts(env, 5);
  const add = addTileOf(form);
  const pointer = (type, x = 1, y = 1) =>
    add.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), {
        button: 0,
        isPrimary: true,
        pointerId: 7,
        clientX: x,
        clientY: y,
      }),
    );
  const tap = async (detail = 1) => {
    add.dispatchEvent(Object.assign(new Event("click", { cancelable: true }), { detail }));
    await flush();
  };
  const editor = () => env.document.body.querySelector(".qap-shortcut-editor");
  pointer("pointerdown");
  await env.tick(400);
  assert.equal(
    add.classList.contains("qap-press-ignored"),
    true,
    "a held press drops the pressed highlight",
  );
  const menu = new Event("contextmenu", { cancelable: true });
  add.dispatchEvent(menu);
  assert.equal(menu.defaultPrevented, true, "a long press opens no context menu");
  pointer("pointerup");
  await tap();
  assert.equal(editor(), null, "a long press never opens the editor");
  assert.equal(add.classList.contains("qap-press-ignored"), false);
  pointer("pointerdown");
  pointer("pointermove", 30, 1);
  pointer("pointerup", 30, 1);
  await tap();
  assert.equal(editor(), null, "a drag never opens the editor");
  assert.equal(form.querySelector(".qap-dragging"), null);
  pointer("pointerdown");
  await env.tick(400);
  await tap(0);
  assert.equal(editor()?.open, true, "keyboard activation is never treated as a long press");
  editor().querySelector(".qap-editor-close").click();
  await flush();
  assert.equal(editor(), null);
  pointer("pointerdown");
  await env.tick(100);
  pointer("pointerup");
  await tap();
  assert.equal(editor()?.open, true, "a tap opens the editor");
});

test("Add opens the next logical page after a full one and is unavailable for unsaved groups or at the limit", async () => {
  const env = environment();
  const { form } = await groupWithShortcuts(env, 4);
  const row = addTileOf(form).parentElement;
  assert.equal(addTileOf(form).style.gridColumn, "1");
  assert.equal(row.classList.contains("qap-page-start"), true);
  assert.equal(row.classList.contains("qap-partial-row"), false);
  assert.equal(placeholderCount(form), 3);
  assert.ok(
    form
      .querySelector("style")
      .textContent.includes(
        `.qap-arrangement-add::before { content: attr(data-page-label) " 2"; }`,
      ),
  );
  assert.equal(addTileOf(form).getAttribute("data-page-label"), "Page");
  await clickAndFlush(form.querySelector(".qap-category-cancel"));

  openCategoriesManager(env).querySelector(".qap-create-category").click();
  const created = env.document.body.querySelector(".qap-category-form");
  assert.equal(
    addTileOf(created).parentElement.hidden,
    true,
    "a group that does not exist on the server cannot receive shortcuts",
  );
  assert.match(created.querySelector(".qap-arrangement-empty").textContent, /Save the group first/);
  await clickAndFlush(addTileOf(created));
  assert.equal(env.document.body.querySelector(".qap-shortcut-editor"), null);
  await clickAndFlush(created.querySelector(".qap-category-cancel"));

  const limited = environment();
  savedProfile(limited).settings.links = manyShortcuts(shortcutLimit);
  await openShortcutsSettings("/config", undefined, limited);
  const view = await openArrangement(limited);
  assert.equal(addTileOf(view.form).disabled, true);
  assert.match(
    addTileOf(view.form).getAttribute("title"),
    /Shortcut limit reached \(500 per profile\)/,
  );
  await clickAndFlush(addTileOf(view.form));
  assert.equal(limited.document.body.querySelector(".qap-shortcut-editor"), null);
});

test(`Reorder, Add and Save keep the draft, persist only the shortcut, then save the group atomically`, async () => {
  const env = environment();
  trackFocus(env);
  const view = await groupWithShortcuts(env, 4, { columns: 2, rows: 2 });
  const { form, ids } = view;
  await reorderToCADB(view);
  const [columns] = form.querySelector(".qap-grid-fields").querySelectorAll("qap-input");
  columns.value = "3";
  columns.dispatchEvent(new Event("input"));
  const categoryModal = env.document.body.querySelector(".qap-category-modal");
  const before = clone(savedProfile(env));
  const revision = env.server.data("test-user").revision;
  const editor = await openNestedEditor(env, form);
  assert.ok(editor, "the existing shortcut editor opens");
  assert.equal(
    env.document.body.querySelector(".qap-discard-changes-confirmation"),
    null,
    "opening Add never asks to discard the group",
  );
  assert.equal(
    env.document.body.children.indexOf(editor) > env.document.body.children.indexOf(categoryModal),
    true,
    "the editor stacks above Edit Group",
  );
  assert.equal(categoryModal.open, true);
  assert.equal(form.isConnected, true);
  assert.equal(editor.querySelector(".qap-title").textContent, "Create shortcut");
  const category = categorySelect(editor);
  assert.equal(category.value, "category:favorites");
  assert.equal(
    optionsOf(category).some((option) => option.value === "add-category"),
    false,
    "a nested editor cannot replace Edit Group with an inline group editor",
  );
  await saveNewShortcut(editor, "Created E", "/created");
  assert.equal(editor.open, false);
  assert.equal(form.isConnected, true);
  assert.equal(categoryModal.open, true);
  assert.equal(env.server.requests.length, 1);
  const [write] = env.server.requests;
  assert.equal(write.revision, revision);
  assert.deepEqual(
    write.profile.categories,
    before.categories,
    "unsaved group settings are not written",
  );
  const created = savedProfile(env).settings.links.find((link) => link.name === "Created E");
  assert.deepEqual(
    shortcutIds(env),
    ["shortcut-0", "shortcut-1", "shortcut-2", "shortcut-3", created.id, "disabled"],
    "the server keeps its order and appends after enabled shortcuts",
  );
  assert.deepEqual(shortcutIds(env, "tools"), ["other"]);
  assert.deepEqual(
    ids(),
    ["shortcut-2", "shortcut-0", "shortcut-3", "shortcut-1", created.id],
    "the draft order survives creation",
  );
  assert.equal(columns.value, "3");
  const item = view.list.children.at(-1);
  assert.equal(item.dataset.id, created.id);
  assert.equal(item.classList.contains("qap-arrangement-item"), true);
  assert.equal(
    item.classList.contains("qap-drop-highlight"),
    true,
    "the existing accent highlight reveals the new tile",
  );
  assert.ok(item.lastScrollOptions, "the new tile scrolls into view");
  assert.equal(env.document.activeElement, item);
  assert.equal(addTileOf(form).style.gridColumn, "3", "Add moves to the next free cell");
  assert.equal(placeholderCount(form), 0);
  await env.tick(2000);
  assert.equal(item.classList.contains("qap-drop-highlight"), false);
  await arrangeKey(item, "ArrowLeft");
  assert.equal(ids()[3], created.id, "the new tile can be arranged before group Save");
  assert.equal(env.server.requests.length, 1, "arrangement never persists before group Save");
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.equal(form.isConnected, false);
  assert.equal(env.server.requests.length, 2);
  assert.equal(
    env.server.requests[1].revision,
    revision + 1,
    "group Save uses the acknowledged shortcut revision",
  );
  assert.deepEqual(shortcutIds(env), [
    "shortcut-2",
    "shortcut-0",
    "shortcut-3",
    created.id,
    "shortcut-1",
    "disabled",
  ]);
  assert.deepEqual(savedProfile(env).categories[0].grid, { columns: 3, rows: 2 });
  assert.deepEqual(shortcutIds(env, "tools"), ["other"]);
});

test("Cancelling Edit Group after Add keeps the saved shortcut and discards only the arrangement", async () => {
  const env = environment();
  const view = await groupWithShortcuts(env, 4);
  const { form } = view;
  await reorderToCADB(view);
  const [, rows] = form.querySelector(".qap-grid-fields").querySelectorAll("qap-input");
  rows.value = "5";
  rows.dispatchEvent(new Event("input"));
  await saveNewShortcut(await openNestedEditor(env, form), "Kept");
  const kept = savedProfile(env).settings.links.find((link) => link.name === "Kept").id;
  await clickAndFlush(form.querySelector(".qap-category-cancel"));
  respondToDiscard(env, false);
  assert.equal(form.isConnected, true, "the arrangement draft is still unsaved and protected");
  await clickAndFlush(form.querySelector(".qap-category-cancel"));
  respondToDiscard(env, true);
  await flush();
  assert.equal(form.isConnected, false);
  assert.equal(env.server.requests.length, 1);
  assert.deepEqual(shortcutIds(env), [
    "shortcut-0",
    "shortcut-1",
    "shortcut-2",
    "shortcut-3",
    kept,
    "disabled",
  ]);
  assert.deepEqual(savedProfile(env).categories[0].grid, { columns: 2, rows: 2 });
});

test("Add alone leaves a clean group draft; dimensions alone stay dirty after Add", async () => {
  const env = environment();
  const { form, ids } = await groupWithShortcuts(env, 2);
  await saveNewShortcut(await openNestedEditor(env, form), "First");
  await saveNewShortcut(await openNestedEditor(env, form), "Second");
  const added = savedProfile(env)
    .settings.links.filter((link) => ["First", "Second"].includes(link.name))
    .map((link) => link.id);
  assert.deepEqual(
    ids(),
    ["shortcut-0", "shortcut-1", ...added],
    "each creation appends to the current draft",
  );
  assert.equal(new Set(ids()).size, ids().length);
  assert.equal(
    addTileOf(form).parentElement.classList.contains("qap-page-start"),
    true,
    "a full final page moves Add to the next page",
  );
  await clickAndFlush(form.querySelector(".qap-category-cancel"));
  assert.equal(
    env.document.body.querySelector(".qap-discard-changes-confirmation"),
    null,
    "the new shortcuts are already saved",
  );
  assert.equal(form.isConnected, false);
  assert.equal(env.server.requests.length, 2);
  assert.deepEqual(
    env.server.requests.map((request) => request.revision),
    [env.server.data("test-user").revision - 2, env.server.data("test-user").revision - 1],
  );

  const view = await openArrangement(env);
  const [columns] = view.form.querySelector(".qap-grid-fields").querySelectorAll("qap-input");
  columns.value = "1";
  columns.dispatchEvent(new Event("input"));
  const order = view.ids();
  await saveNewShortcut(await openNestedEditor(env, view.form), "Third");
  assert.equal(view.ids().length, order.length + 1);
  assert.deepEqual(view.ids().slice(0, -1), order, "changing dimensions never changes order");
  await clickAndFlush(view.form.querySelector(".qap-category-cancel"));
  respondToDiscard(env, true);
  await flush();
  assert.deepEqual(savedProfile(env).categories[0].grid, { columns: 2, rows: 2 });
  assert.equal(
    savedProfile(env).settings.links.some((link) => link.name === "Third"),
    true,
  );
});

test("Cancelling Add preserves the group draft and protects its own dirty fields independently", async () => {
  const env = environment();
  trackFocus(env);
  const view = await groupWithShortcuts(env, 4);
  const { form, ids } = view;
  await reorderToCADB(view);
  const draft = ids();
  const revision = env.server.data("test-user").revision;
  await env.tick(2000); // Keyboard reordering shows its own highlight first.
  let editor = await openNestedEditor(env, form);
  await clickAndFlush(buttons(editor).find((button) => button.textContent === "Cancel"));
  assert.equal(editor.open, false);
  assert.equal(env.document.body.querySelector(".qap-discard-changes-confirmation"), null);
  assert.equal(env.document.activeElement, addTileOf(form), "focus returns to Add");
  editor = await openNestedEditor(env, form);
  fillNewShortcut(editor, "Unsaved");
  editor.dispatchEvent(new Event("cancel", { cancelable: true }));
  respondToDiscard(env, false);
  assert.equal(editor.open, true, "Escape keeps a dirty shortcut until discarded");
  editor.querySelector(".qap-editor-close").click();
  respondToDiscard(env, true);
  await flush();
  assert.equal(editor.open, false);
  assert.equal(form.isConnected, true, "discarding the shortcut never discards Edit Group");
  assert.deepEqual(ids(), draft);
  assert.equal(view.list.children.length, 4, "no placeholder shortcut is added");
  assert.ok(
    !form.querySelector(".qap-drop-highlight"),
    "no success feedback once the reorder highlight expired",
  );
  assert.equal(env.server.requests.length, 0);
  assert.equal(env.server.data("test-user").revision, revision);
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.deepEqual(shortcutIds(env), [...draft, "disabled"]);
});

test("Add respects revision conflicts and never rebases remote changes into the group draft", async () => {
  const env = environment();
  const view = await groupWithShortcuts(env, 4);
  const { form, ids } = view;
  await reorderToCADB(view);
  const draft = ids();
  const remote = (change) => {
    const data = env.server.data("test-user");
    change(data.profiles[0]);
    data.revision++;
    env.server.notify("test-user");
  };
  // A remote change before creation makes the shortcut write conflict.
  remote((profile) => {
    profile.name = "Renamed elsewhere";
  });
  const editor = await openNestedEditor(env, form);
  await saveNewShortcut(editor, "Conflicting");
  assert.equal(editor.open, true, "a failed save keeps the shortcut editor and its fields");
  assert.match(editor.querySelector(".qap-error").textContent, /changed on another device/);
  assert.equal(
    savedProfile(env).settings.links.some((link) => link.name === "Conflicting"),
    false,
  );
  assert.deepEqual(ids(), draft);
  await clickAndFlush(buttons(editor).find((button) => button.textContent === "Save"));
  assert.equal(
    savedProfile(env).settings.links.filter((link) => link.name === "Conflicting").length,
    0,
    "repeated Save cannot create copies",
  );
  editor.querySelector(".qap-editor-close").click();
  respondToDiscard(env, true);
  await flush();
  assert.equal(
    form.isConnected,
    true,
    "closing the editor does not reload the view under the group draft",
  );
  assert.deepEqual(ids(), draft);
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.equal(form.isConnected, true);
  assert.match(form.querySelector(".qap-error").textContent, /changed on another device/);
  assert.equal(savedProfile(env).name, "Renamed elsewhere");
  assert.deepEqual(shortcutIds(env), [
    "shortcut-0",
    "shortcut-1",
    "shortcut-2",
    "shortcut-3",
    "disabled",
  ]);
});

test("a remote change after Add still conflicts with group Save; failures keep the draft and the shortcut", async () => {
  const env = environment();
  const view = await groupWithShortcuts(env, 4);
  const { form, ids } = view;
  await reorderToCADB(view);
  env.server.failWrites = true;
  const editor = await openNestedEditor(env, form);
  await saveNewShortcut(editor, "Retried");
  assert.equal(editor.open, true);
  assert.equal(view.list.children.length, 4, "a failed creation leaves the draft intact");
  env.server.failWrites = false;
  await clickAndFlush(buttons(editor).find((button) => button.textContent === "Save"));
  assert.equal(editor.open, false);
  const retried = savedProfile(env).settings.links.filter((link) => link.name === "Retried");
  assert.equal(retried.length, 1);
  assert.equal(
    env.server.requests[0].profile.settings.links.at(-2).id,
    retried[0].id,
    "a retried write keeps its shortcut ID",
  );
  const draft = ids();
  env.server.failWrites = true;
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.equal(form.isConnected, true);
  assert.deepEqual(ids(), draft, "a failed group Save preserves the draft");
  env.server.failWrites = false;
  const data = env.server.data("test-user");
  data.profiles[0].favorites = ["sensor.remote"];
  data.revision++;
  env.server.notify("test-user");
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.equal(form.isConnected, true);
  assert.match(form.querySelector(".qap-error").textContent, /changed on another device/);
  assert.deepEqual(
    savedProfile(env).favorites,
    ["sensor.remote"],
    "unrelated remote changes are never overwritten",
  );
  assert.deepEqual(shortcutIds(env), [
    "shortcut-0",
    "shortcut-1",
    "shortcut-2",
    "shortcut-3",
    retried[0].id,
    "disabled",
  ]);
  assert.deepEqual(ids(), draft);
});

test("stale nested saves never resurrect Edit Group or rebase another context", async () => {
  const env = environment();
  const { form } = await groupWithShortcuts(env, 4);
  let resolveSave;
  const send = env.connection.sendMessagePromise;
  env.connection.sendMessagePromise = (message) =>
    new Promise((resolve, reject) => {
      resolveSave = () => send(message).then(resolve, reject);
    });
  const editor = await openNestedEditor(env, form);
  fillNewShortcut(editor, "Pending");
  buttons(editor)
    .find((button) => button.textContent === "Save")
    .click();
  await flush();
  env.enable(false);
  await flush();
  resolveSave();
  await flush();
  await flush();
  assert.equal(form.isConnected, false);
  assert.equal(env.document.body.querySelector(".qap-category-form"), null);
  assert.equal(env.document.body.querySelector(".qap-shortcut-editor"), null);
});

test("history Back closes only the nested editor; Forward restores it above the same group draft", async () => {
  const env = navigationEnvironment();
  const view = await groupWithShortcuts(env, 4);
  const { form, ids } = view;
  await env.settle();
  await reorderToCADB(view);
  const draft = ids();
  const path = env.window.location.pathname;
  let editor = await openNestedEditor(env, form);
  await env.settle();
  const depth = env.historyIndex();
  await env.back();
  assert.equal(editor.open, false);
  assert.equal(form.isConnected, true);
  assert.deepEqual(ids(), draft);
  assert.equal(env.window.location.pathname, path, "no Home Assistant route changes");
  await env.forward();
  editor = env.document.body.querySelector(".qap-shortcut-editor");
  assert.equal(editor?.open, true, "Forward reopens Add above Edit Group");
  assert.equal(env.document.body.querySelector(".qap-category-form"), form);
  fillNewShortcut(editor, "Dirty");
  await env.back();
  respondToDiscard(env, false);
  await env.settle();
  assert.equal(editor.open, true);
  assert.equal(env.historyIndex(), depth);
  await saveNewShortcut(editor, "Via history");
  await env.settle();
  assert.equal(form.isConnected, true);
  assert.equal(env.historyIndex(), depth - 1, "Save returns to the Edit Group entry");
  assert.equal(ids().length, 5);
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  await env.settle();
  assert.deepEqual(shortcutIds(env).slice(0, 4), draft);
  assert.equal(env.window.location.pathname, path);
  assert.equal(
    env.window.history.state.keep,
    "HA state",
    "Home Assistant's own history state is retained",
  );
});

test("Add from Shortcuts management keeps inline group creation and its existing feedback", async () => {
  const env = environment();
  await openShortcutsSettings("/config", undefined, env);
  env.document.body.querySelector(".qap-add-shortcut").click();
  const editor = env.document.body.querySelector(".qap-shortcut-editor");
  assert.equal(
    optionsOf(categorySelect(editor)).some((option) => option.value === "add-category"),
    true,
  );
  await saveNewShortcut(editor, "Managed");
  assert.equal(editor.open, false);
  const created = savedProfile(env).settings.links.at(-1);
  assert.equal(created.name, "Managed");
  const row = env.document.body
    .querySelectorAll(".qap-edit-item")
    .find((item) => item.dataset.id === created.id);
  assert.equal(row.classList.contains("qap-drop-highlight"), true);
});
