// Edit Group: tapping an arrangement tile edits that shortcut above the group draft,
// and moving an existing shortcut to another group is confirmed on Save.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
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
  saveNewShortcut,
  shortcutIds,
  reorderToCADB,
  arrangementGeometry,
  arrangementPointer,
  arrangeKey,
  trackFocus,
  categorySelect,
  selectAndFlush,
  changeValidationControl,
  moveConfirmation,
  confirmMove,
} = require("./harness.cjs");

const editorOf = (env) => env.document.body.querySelector(".qap-shortcut-editor");
const fieldsOf = (editor) =>
  editor.querySelector(".qap-shortcut-form").querySelectorAll("input, qap-input");
const saveButton = (editor) => buttons(editor).find((button) => button.textContent === "Save");
const tileOf = (view, id) => view.list.children.find((item) => item.dataset.id === id);
const tap = (item) =>
  dispatchAndFlush(item, Object.assign(new Event("click", { cancelable: true }), { detail: 1 }));
const press = (item, key) =>
  dispatchAndFlush(item, Object.assign(new Event("keydown", { cancelable: true }), { key }));
async function closeEditor(env) {
  editorOf(env).querySelector(".qap-editor-close").click();
  await flush();
  assert.equal(Boolean(editorOf(env)), false);
}
async function editTile(env, view, id) {
  await tap(tileOf(view, id));
  const editor = editorOf(env);
  assert.equal(editor?.open, true, "a tap opens the existing shortcut editor");
  return editor;
}
function remoteChange(env, change) {
  const data = env.server.data("test-user");
  change(data.profiles[0]);
  data.revision++;
  env.server.notify("test-user");
}

test("a tap or Enter/Space edits the tile; long presses, drags, Escape and scrolling never do", async () => {
  const env = environment();
  const view = await groupWithShortcuts(env, 4);
  arrangementGeometry(view);
  const [first, , third] = view.list.children;
  const original = view.ids();
  const pointer = arrangementPointer(env, first);

  pointer("pointerdown");
  await env.tick(100);
  pointer("pointerup");
  await tap(first);
  let editor = editorOf(env);
  assert.equal(editor?.open, true, "a short tap opens Edit Shortcut");
  assert.equal(editor.querySelector(".qap-title").textContent, "Edit shortcut");
  assert.equal(fieldsOf(editor)[0].value, "Shortcut 0", "the tapped shortcut is loaded by ID");
  assert.equal(categorySelect(editor).value, "category:favorites");
  assert.deepEqual(view.ids(), original);
  await closeEditor(env);

  pointer("pointerdown");
  await env.tick(400);
  assert.equal(first.classList.contains("qap-dragging"), true, "a long press still drags");
  pointer("pointerup");
  await tap(first);
  assert.equal(Boolean(editorOf(env)), false, "releasing a long press never opens the editor");
  assert.deepEqual(view.ids(), original);

  pointer("pointerdown");
  await env.tick(400);
  pointer("pointermove", 145, 153);
  pointer("pointerup", 145, 153);
  await tap(first);
  assert.equal(Boolean(editorOf(env)), false, "dropping a drag never opens the editor");
  assert.deepEqual(view.ids(), ["shortcut-1", "shortcut-0", "shortcut-2", "shortcut-3"]);

  // Gestures stay on one tile: this Node EventTarget keeps capture listeners after
  // removeEventListener(type, listener, true), unlike browsers (see the browser suite).
  pointer("pointerdown");
  await env.tick(400);
  pointer("pointermove", 45, 210);
  assert.equal(first.classList.contains("qap-dragging"), true);
  env.document.dispatchEvent(
    Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" }),
  );
  assert.equal(first.classList.contains("qap-dragging"), false, "Escape cancels the drag");
  assert.equal(view.form.isConnected, true, "Escape during a drag keeps Edit Group open");
  pointer("pointerup", 45, 210);
  await tap(first);
  assert.equal(Boolean(editorOf(env)), false, "a cancelled drag never opens the editor");
  assert.deepEqual(view.ids(), ["shortcut-1", "shortcut-0", "shortcut-2", "shortcut-3"]);

  // A mouse press moved beyond the tolerance and released on the tile still clicks.
  pointer("pointerdown");
  pointer("pointermove", 45, 185);
  pointer("pointermove", 45, 150);
  pointer("pointerup");
  await tap(first);
  assert.equal(Boolean(editorOf(env)), false, "a moved press never opens the editor");
  await env.tick(400);
  assert.equal(first.classList.contains("qap-dragging"), false);
  pointer("pointerdown");
  pointer("pointermove", 47, 152);
  pointer("pointerup");
  await tap(first);
  assert.equal(editorOf(env)?.open, true, "movement within the tolerance is still a tap");
  await closeEditor(env);

  // A scroll gesture leaves the tolerance; the browser then cancels the pointer and sends no click.
  pointer("pointerdown");
  const scrolling = new Event("touchmove", { cancelable: true });
  env.document.dispatchEvent(scrolling);
  assert.equal(scrolling.defaultPrevented, false, "native scrolling continues");
  pointer("pointermove", 45, 180);
  pointer("pointercancel", 45, 180);
  await env.tick(400);
  assert.equal(first.classList.contains("qap-dragging"), false);
  assert.equal(Boolean(editorOf(env)), false);

  for (const key of ["Enter", " "]) {
    await press(third, key);
    editor = editorOf(env);
    assert.equal(editor?.open, true, `${JSON.stringify(key)} opens Edit Shortcut`);
    assert.equal(fieldsOf(editor)[0].value, "Shortcut 2");
    await closeEditor(env);
  }
  await arrangeKey(third, "ArrowLeft");
  assert.equal(Boolean(editorOf(env)), false, "Alt+Arrow keeps reordering");
  assert.deepEqual(view.ids(), ["shortcut-1", "shortcut-2", "shortcut-0", "shortcut-3"]);
  assert.equal(env.server.requests.length, 0);
  assert.match(third.getAttribute("aria-description"), /press Enter to edit/);
});

test("arrangement tiles edit actions and links instead of executing them", async () => {
  const env = environment();
  const calls = [];
  env.status.hass.callService = async (...args) => calls.push(args);
  env.status.hass.states["scene.evening"] = {
    entity_id: "scene.evening",
    state: "scening",
    attributes: { friendly_name: "Evening" },
  };
  const profile = savedProfile(env);
  profile.settings.links = [
    { ...manyShortcuts(1)[0], id: "scene", name: "Evening", type: "scene", path: "scene.evening" },
    { ...manyShortcuts(1)[0], id: "devices", name: "Devices", type: "quick-devices", path: "" },
    { ...manyShortcuts(1)[0], id: "link", name: "Site", type: "external", path: "https://a.b" },
  ];
  await openShortcutsSettings("/config", undefined, env);
  const view = await openArrangement(env);
  for (const link of profile.settings.links) {
    const tile = tileOf(view, link.id).querySelector(".qap-tile");
    assert.equal(tile.inert, true);
    assert.equal(tile.href || "", "", "arrangement tiles carry no destination");
    const editor = await editTile(env, view, link.id);
    assert.equal(fieldsOf(editor)[0].value, link.name);
    await closeEditor(env);
  }
  assert.deepEqual(calls, [], "no scene is activated");
  assert.equal(view.form.isConnected, true, "no explorer replaces Edit Group");
  assert.equal(env.server.requests.length, 0);
});

test("editing from Edit Group persists only the shortcut; the draft keeps its order and shows the edit", async () => {
  const env = environment();
  trackFocus(env);
  const view = await groupWithShortcuts(env, 4);
  const { form, ids } = view;
  await reorderToCADB(view);
  const [, rows] = form.querySelector(".qap-grid-fields").querySelectorAll("qap-input");
  rows.value = "5";
  rows.dispatchEvent(new Event("input"));
  const categoryModal = env.document.body.querySelector(".qap-category-modal");
  const before = clone(savedProfile(env));
  const revision = env.server.data("test-user").revision;
  const tile = tileOf(view, "shortcut-0");
  const editor = await editTile(env, view, "shortcut-0");
  assert.equal(
    env.document.body.querySelector(".qap-discard-changes-confirmation"),
    null,
    "opening Edit Shortcut never asks to discard the group",
  );
  assert.equal(
    env.document.body.children.indexOf(editor) > env.document.body.children.indexOf(categoryModal),
    true,
    "the editor stacks above Edit Group",
  );
  assert.equal(
    optionsOf(categorySelect(editor)).some((option) => option.value === "add-category"),
    false,
    "a nested editor cannot replace Edit Group with an inline group editor",
  );
  changeValidationControl(editor.querySelector("qap-icon-picker"), "mdi:star");
  fieldsOf(editor)[0].value = "Renamed A";
  fieldsOf(editor)[0].dispatchEvent(new Event("input"));
  await clickAndFlush(saveButton(editor));
  assert.equal(Boolean(moveConfirmation(env)), false, "an unchanged group needs no confirmation");
  assert.equal(editor.open, false);
  assert.equal(form.isConnected, true);
  assert.equal(categoryModal.open, true);
  assert.equal(env.server.requests.length, 1);
  const [write] = env.server.requests;
  assert.equal(write.revision, revision);
  assert.deepEqual(write.profile.categories, before.categories, "group settings stay unsaved");
  assert.deepEqual(
    shortcutIds(env),
    ["shortcut-0", "shortcut-1", "shortcut-2", "shortcut-3", "disabled"],
    "the saved order is unchanged",
  );
  const edited = savedProfile(env).settings.links.find((link) => link.id === "shortcut-0");
  assert.equal(edited.icon, "mdi:star");
  assert.equal(edited.name, "Renamed A");
  assert.deepEqual(ids(), ["shortcut-2", "shortcut-0", "shortcut-3", "shortcut-1"]);
  assert.equal(rows.value, "5");
  assert.equal(tileOf(view, "shortcut-0"), tile, "the tile is refreshed in place");
  assert.match(tile.querySelector(".qap-tile-icon").className, /qap-icon-mdi-star/);
  assert.equal(tile.querySelector(".qap-tile-name").textContent, "Renamed A");
  assert.equal(tile.getAttribute("aria-label"), "Renamed A");
  assert.equal(env.document.activeElement, tile, "focus returns to the edited tile");

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
    "disabled",
  ]);
  assert.equal(
    savedProfile(env).settings.links.find((link) => link.id === "shortcut-0").icon,
    "mdi:star",
    "Cancel Edit Group keeps the independently saved edit",
  );
  assert.deepEqual(savedProfile(env).categories, before.categories);
});

test("closing a dirty Edit Shortcut keeps the group draft; + still creates shortcuts afterwards", async () => {
  const env = environment();
  trackFocus(env);
  const view = await groupWithShortcuts(env, 4);
  await reorderToCADB(view);
  const draft = view.ids();
  const editor = await editTile(env, view, "shortcut-3");
  fieldsOf(editor)[0].value = "Unsaved";
  fieldsOf(editor)[0].dispatchEvent(new Event("input"));
  editor.querySelector(".qap-editor-close").click();
  respondToDiscard(env, false);
  assert.equal(editor.open, true, "a dirty shortcut is protected");
  editor.querySelector(".qap-editor-close").click();
  respondToDiscard(env, true);
  await flush();
  assert.equal(editor.open, false);
  assert.equal(view.form.isConnected, true);
  assert.deepEqual(view.ids(), draft);
  assert.equal(env.document.activeElement, tileOf(view, "shortcut-3"));
  assert.equal(env.server.requests.length, 0);
  await saveNewShortcut(await openNestedEditor(env, view.form), "Created");
  const created = savedProfile(env).settings.links.find((link) => link.name === "Created").id;
  assert.deepEqual(view.ids(), [...draft, created]);
  await clickAndFlush(view.form.querySelector(".qap-category-submit"));
  assert.deepEqual(shortcutIds(env), [...draft, created, "disabled"]);
});

test("history Back closes only the nested Edit Shortcut; Forward reopens the same shortcut", async () => {
  const env = navigationEnvironment();
  const view = await groupWithShortcuts(env, 4);
  await env.settle();
  await reorderToCADB(view);
  const draft = view.ids();
  let editor = await editTile(env, view, "shortcut-1");
  await env.settle();
  await env.back();
  assert.equal(editor.open, false);
  assert.equal(view.form.isConnected, true);
  assert.deepEqual(view.ids(), draft);
  await env.forward();
  editor = editorOf(env);
  assert.equal(editor?.open, true);
  assert.equal(fieldsOf(editor)[0].value, "Shortcut 1");
  assert.equal(env.document.body.querySelector(".qap-category-form"), view.form);
});

for (const finish of ["cancel", "save"]) {
  test(`Reorder, edit, move group, confirm, then ${finish} Edit Group keeps the transfer independent`, async () => {
    const env = environment();
    trackFocus(env);
    const view = await groupWithShortcuts(env, 4);
    const { form, ids } = view;
    await reorderToCADB(view);
    const before = clone(savedProfile(env));
    const revision = env.server.data("test-user").revision;
    const editor = await editTile(env, view, "shortcut-0");
    await selectAndFlush(categorySelect(editor), "category:tools");
    assert.equal(
      Boolean(moveConfirmation(env)),
      false,
      "changing the dropdown alone never confirms",
    );
    await clickAndFlush(saveButton(editor));
    const confirmation = moveConfirmation(env);
    assert.ok(confirmation);
    assert.equal(env.server.requests.length, 0, "nothing is written before confirmation");
    assert.equal(
      confirmation.querySelector(".qap-title").textContent,
      "Move shortcut to another group?",
    );
    assert.equal(
      confirmation.querySelector("#qap-move-shortcut-description").textContent,
      'Move "Shortcut 0" from "Favorites" to "Tools"?',
    );
    assert.equal(
      confirmation.querySelector(".qap-body").querySelector(".qap-muted").textContent,
      "The shortcut will be removed from its current group and added to the destination group.",
    );
    const move = buttons(confirmation).find((button) => button.textContent === "Move shortcut");
    assert.equal(move.classList.contains("qap-button-primary"), true);
    await clickAndFlush(move);
    assert.equal(editor.open, false, "Edit Shortcut closes after the transfer is saved");
    assert.equal(form.isConnected, true);
    assert.equal(env.server.requests.length, 1);
    assert.equal(env.server.requests[0].revision, revision);
    assert.deepEqual(env.server.requests[0].profile.categories, before.categories);
    assert.deepEqual(shortcutIds(env), ["shortcut-1", "shortcut-2", "shortcut-3", "disabled"]);
    assert.deepEqual(shortcutIds(env, "tools"), ["other", "shortcut-0"]);
    assert.deepEqual(ids(), ["shortcut-2", "shortcut-3", "shortcut-1"], "A leaves the draft");
    assert.equal(form.querySelectorAll(".qap-arrangement-item").length, 3);
    assert.equal(addTileOf(form).style.gridColumn, "2", "Add takes the freed cell");
    assert.equal(placeholderCount(form), 0);
    assert.equal(
      env.document.activeElement,
      tileOf(view, "shortcut-3"),
      "focus moves to the tile that took the transferred shortcut's place",
    );
    if (finish === "cancel") {
      await clickAndFlush(form.querySelector(".qap-category-cancel"));
      respondToDiscard(env, true);
      await flush();
      assert.equal(env.server.requests.length, 1, "the remaining arrangement is never written");
      assert.deepEqual(shortcutIds(env), ["shortcut-1", "shortcut-2", "shortcut-3", "disabled"]);
    } else {
      await clickAndFlush(form.querySelector(".qap-category-submit"));
      assert.equal(env.server.requests.length, 2);
      assert.equal(env.server.requests[1].revision, revision + 1);
      assert.deepEqual(shortcutIds(env), ["shortcut-2", "shortcut-3", "shortcut-1", "disabled"]);
    }
    assert.equal(form.isConnected, false);
    assert.deepEqual(shortcutIds(env, "tools"), ["other", "shortcut-0"]);
  });
}

test("Delete from a nested Edit Shortcut removes only that tile from the draft", async () => {
  const env = environment();
  const view = await groupWithShortcuts(env, 4);
  await reorderToCADB(view);
  const editor = await editTile(env, view, "shortcut-3");
  await clickAndFlush(editor.querySelector(".qap-delete-shortcut"));
  const confirmation = env.document.body.querySelector(".qap-delete-confirmation");
  await clickAndFlush(buttons(confirmation).find((button) => button.textContent === "Delete"));
  assert.equal(editor.open, false);
  assert.deepEqual(view.ids(), ["shortcut-2", "shortcut-0", "shortcut-1"]);
  assert.deepEqual(shortcutIds(env), ["shortcut-0", "shortcut-1", "shortcut-2", "disabled"]);
  await clickAndFlush(view.form.querySelector(".qap-category-submit"));
  assert.equal(env.server.requests.length, 2);
  assert.deepEqual(shortcutIds(env), ["shortcut-2", "shortcut-0", "shortcut-1", "disabled"]);
});

test("Cancel keeps Edit Shortcut and its values; confirming appends by enabled state; failures stay open", async () => {
  const env = environment();
  const profile = savedProfile(env);
  profile.categories.push({ id: "tools", name: "Tools" }, { id: "extra", name: "Extra" });
  profile.settings.links = [
    ...manyShortcuts(2),
    { ...manyShortcuts(1)[0], id: "hidden", name: "Hidden", hidden: true },
    { ...manyShortcuts(1, "tools")[0], id: "tool" },
    { ...manyShortcuts(1, "tools")[0], id: "tool-off", hidden: true },
    { ...manyShortcuts(1, "extra")[0], id: "x-1" },
    { ...manyShortcuts(1, "extra")[0], id: "x-2" },
  ];
  await openShortcutsSettings("/config", undefined, env);
  const open = async (id) => {
    const row = env.document.body
      .querySelectorAll(".qap-edit-item")
      .find((item) => item.dataset.id === id);
    await clickAndFlush(row.querySelector(".qap-shortcut-row"));
    return editorOf(env);
  };

  let editor = await open("shortcut-0");
  fieldsOf(editor)[0].value = "Renamed";
  fieldsOf(editor)[0].dispatchEvent(new Event("input"));
  changeValidationControl(editor.querySelector("qap-icon-picker"), "mdi:star");
  fieldsOf(editor).at(-1).value = "/renamed";
  fieldsOf(editor).at(-1).dispatchEvent(new Event("input"));
  await clickAndFlush(saveButton(editor));
  assert.equal(
    Boolean(moveConfirmation(env)),
    false,
    "name, icon and path edits need no confirmation",
  );
  assert.equal(Boolean(editorOf(env)), false);
  assert.equal(env.server.requests.length, 1);

  editor = await open("shortcut-0");
  await selectAndFlush(categorySelect(editor), "category:tools");
  fieldsOf(editor)[0].value = "";
  fieldsOf(editor)[0].dispatchEvent(new Event("input"));
  await clickAndFlush(saveButton(editor));
  assert.equal(Boolean(moveConfirmation(env)), false, "an invalid form is never confirmed");
  fieldsOf(editor)[0].value = "Moved";
  fieldsOf(editor)[0].dispatchEvent(new Event("input"));
  await clickAndFlush(saveButton(editor));
  await confirmMove(env, false);
  assert.equal(Boolean(moveConfirmation(env)), false);
  assert.equal(editor.open, true, "Cancel keeps Edit Shortcut");
  assert.equal(fieldsOf(editor)[0].value, "Moved");
  assert.equal(categorySelect(editor).value, "category:tools");
  assert.equal(env.server.requests.length, 1, "Cancel saves nothing");

  await selectAndFlush(categorySelect(editor), "category:favorites");
  await clickAndFlush(saveButton(editor));
  assert.equal(Boolean(moveConfirmation(env)), false, "returning to the original group needs none");
  assert.equal(Boolean(editorOf(env)), false);
  assert.equal(env.server.requests.length, 2);

  editor = await open("shortcut-0");
  await selectAndFlush(categorySelect(editor), "category:tools");
  env.server.failWrites = true;
  await clickAndFlush(saveButton(editor));
  await confirmMove(env);
  assert.equal(editor.open, true, "a failed transfer keeps the editor");
  assert.notEqual(editor.querySelector(".qap-error").textContent, "");
  assert.equal(categorySelect(editor).value, "category:tools");
  env.server.failWrites = false;

  let release;
  const send = env.connection.sendMessagePromise;
  env.connection.sendMessagePromise = (message) =>
    new Promise((resolve, reject) => {
      release = () => send(message).then(resolve, reject);
    });
  const writes = env.server.requests.length;
  await clickAndFlush(saveButton(editor));
  const move = buttons(moveConfirmation(env)).find((b) => b.textContent === "Move shortcut");
  move.click();
  move.click();
  await flush();
  await clickAndFlush(saveButton(editor));
  assert.equal(
    Boolean(moveConfirmation(env)),
    false,
    "Save is locked while the transfer is pending",
  );
  env.connection.sendMessagePromise = send;
  release();
  await flush();
  await flush();
  assert.equal(env.server.requests.length, writes + 1, "one confirmed Save writes once");
  assert.equal(Boolean(editorOf(env)), false);
  const links = savedProfile(env).settings.links;
  assert.deepEqual(
    links.filter((link) => link.group === "tools").map((link) => link.id),
    ["tool", "shortcut-0", "tool-off"],
    "an enabled shortcut is appended before the destination's disabled ones",
  );
  assert.deepEqual(shortcutIds(env, "extra"), ["x-1", "x-2"]);
  assert.equal(links.find((link) => link.id === "shortcut-0").hidden, undefined);

  editor = await open("hidden");
  await selectAndFlush(categorySelect(editor), "category:tools");
  await clickAndFlush(saveButton(editor));
  await confirmMove(env);
  assert.deepEqual(shortcutIds(env, "tools"), ["tool", "shortcut-0", "tool-off", "hidden"]);
  assert.equal(
    savedProfile(env).settings.links.find((link) => link.id === "hidden").hidden,
    true,
    "the disabled state is preserved",
  );
  assert.deepEqual(shortcutIds(env), ["shortcut-1"]);

  env.document.body.querySelector(".qap-add-shortcut").click();
  editor = editorOf(env);
  await selectAndFlush(categorySelect(editor), "category:extra");
  await saveNewShortcut(editor, "New one");
  assert.equal(Boolean(moveConfirmation(env)), false, "new shortcuts are never confirmed");
  assert.equal(savedProfile(env).settings.links.at(-1).name, "New one");
});

test("a nested transfer respects revisions and never overwrites remote changes", async () => {
  const env = environment();
  const view = await groupWithShortcuts(env, 4);
  await reorderToCADB(view);
  const draft = view.ids();
  const editor = await editTile(env, view, "shortcut-0");
  await selectAndFlush(categorySelect(editor), "category:tools");
  await clickAndFlush(saveButton(editor));
  remoteChange(env, (profile) => {
    profile.name = "Renamed elsewhere";
  });
  await confirmMove(env);
  assert.equal(editor.open, true, "a conflicting transfer keeps Edit Shortcut");
  assert.match(editor.querySelector(".qap-error").textContent, /changed on another device/);
  assert.equal(categorySelect(editor).value, "category:tools");
  assert.deepEqual(view.ids(), draft, "the group draft is untouched");
  assert.deepEqual(shortcutIds(env, "tools"), ["other"]);
  assert.equal(savedProfile(env).name, "Renamed elsewhere");
  const writes = env.server.requests.length;
  await clickAndFlush(saveButton(editor));
  await confirmMove(env);
  assert.equal(editor.open, true, "a retried transfer conflicts again");
  assert.match(editor.querySelector(".qap-error").textContent, /changed on another device/);
  assert.equal(env.server.requests.length, writes + 1);
  assert.deepEqual(shortcutIds(env, "tools"), ["other"]);
  editor.querySelector(".qap-editor-close").click();
  respondToDiscard(env, true);
  await flush();
  assert.deepEqual(view.ids(), draft);
  await clickAndFlush(view.form.querySelector(".qap-category-submit"));
  assert.equal(view.form.isConnected, true, "group Save still conflicts");
  assert.equal(savedProfile(env).name, "Renamed elsewhere");
  assert.deepEqual(shortcutIds(env), [
    "shortcut-0",
    "shortcut-1",
    "shortcut-2",
    "shortcut-3",
    "disabled",
  ]);
});
