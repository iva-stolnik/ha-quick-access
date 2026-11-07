// Group grids, shortcut pagination and shortcut search.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
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
  installDeviceRegistries,
  nativeComponents,
  buttons,
  respondToDiscard,
  openSettingsScreen,
  returnToLauncher,
  openSettings,
  openShortcutsSettings,
  maxProfileItems,
  manyShortcuts,
  startProfiles,
  useProfile,
  shortcutAction,
  categoryInput,
  openCategoriesManager,
  categoryAction,
  selectAndFlush,
} = require("./harness.cjs");
let defaultLinks, shortcutPageSize, shortcutLimit;
test.before(async () => ({ defaultLinks, shortcutPageSize, shortcutLimit } = await loadDefaults()));

test(`group grids preview, validate, save and paginate independently`, async () => {
  const env = environment();
  const profile = savedProfile(env);
  profile.categories.push({ id: "tools", name: "Tools", grid: { columns: 4, rows: 1 } });
  profile.settings.links = [
    ...manyShortcuts(17),
    ...manyShortcuts(6, "tools").map((link) => ({ ...link, id: `tools-${link.id}` })),
  ];
  profile.settings.links[0].hidden = true;
  await openShortcutsSettings("/config", undefined, env);
  assert.equal(env.document.body.querySelector(".qap-edit-grid"), null);
  const manager = openCategoriesManager(env);
  const favoritesRow = manager
    .querySelectorAll(".qap-category-row")
    .find((row) => row.dataset.id === "favorites");
  const edit = categoryAction(env, favoritesRow, "edit");
  assert.equal(env.document.body.querySelector(".qap-delete-category"), null);
  await flush();
  await clickAndFlush(edit);
  const form = env.document.body.querySelector(".qap-category-form");
  assert.equal(form.querySelector(".qap-title").textContent, "Edit group");
  assert.equal(categoryInput(form).disabled, true);
  const controls = form.querySelector(".qap-grid-fields").querySelectorAll("qap-input");
  const [columns, rows] = controls;
  const change = (control, value) => {
    control.value = value;
    control.dispatchEvent(new Event("input"));
  };
  change(columns, "7");
  change(rows, "2");
  const preview = form.querySelector(".qap-arrangement-enabled");
  assert.equal(preview.style.getPropertyValue("--qap-grid-columns"), "7");
  assert.equal(
    preview.querySelectorAll(".qap-tile").length,
    16,
    "all enabled shortcuts are arranged without pagination",
  );
  assert.deepEqual(
    preview.children.map((item) => item.dataset.id),
    manyShortcuts(17)
      .slice(1)
      .map((link) => link.id),
  );
  assert.equal(
    form.querySelectorAll(".qap-grid-placeholder").length,
    11,
    "Add takes the first free cell; the rest of the last page stays empty",
  );
  assert.equal(form.querySelector(".qap-arrangement-add").style.gridColumn, "3");
  assert.equal(preview.querySelector(".qap-arrangement-add"), null, "Add stays outside sorting");
  assert.equal(
    preview.querySelectorAll(".qap-grid-placeholder").length,
    0,
    "placeholders stay outside sorting",
  );
  assert.equal(preview.querySelector(".qap-tile-name").textContent, "Shortcut 1");
  const labels = form.querySelector(".qap-grid-labels");
  assert.equal(labels.checked, true);
  labels.checked = false;
  labels.dispatchEvent(new Event("change"));
  assert.equal(preview.querySelector(".qap-tile-name"), null);
  assert.equal(preview.querySelector(".qap-tile").getAttribute("aria-label"), "Shortcut 1");
  assert.equal(preview.querySelector(".qap-tile").title, "Shortcut 1");
  assert.ok(
    preview.querySelectorAll(".qap-tile").every((tile) => tile.inert && tile.tabIndex === -1),
  );
  assert.equal(env.server.requests.length, 0, "Preview changes stay in the draft");
  change(rows, "0");
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.equal(env.server.requests.length, 0);
  assert.equal(rows.getAttribute("aria-invalid"), "true");
  change(rows, "2");
  env.server.failWrites = true;
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.equal(form.isConnected, true);
  assert.equal(columns.value, "7");
  env.server.failWrites = false;
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.equal(form.isConnected, false);
  assert.deepEqual(savedProfile(env).categories[0], {
    id: "favorites",
    name: "Favorites",
    grid: { columns: 7, rows: 2, hideNames: true },
  });
  assert.deepEqual(savedProfile(env).categories[1].grid, { columns: 4, rows: 1 });
  returnToLauncher(env);
  const tiles = () => env.document.body.querySelector(".qap-tiles");
  assert.equal(tiles().style.getPropertyValue("--qap-grid-columns"), "7");
  assert.equal(tiles().querySelectorAll(".qap-tile").length, 14);
  assert.equal(tiles().querySelector(".qap-tile-name"), null);
  assert.equal(tiles().querySelector(".qap-tile").getAttribute("aria-label"), "Shortcut 1");
  env.document.body.querySelector(".qap-page-next").click();
  assert.equal(tiles().querySelectorAll(".qap-tile").length, 2);
  env.document.body
    .querySelector(".qap-tabs")
    .children.find((tab) => tab.dataset.tab === "tools")
    .click();
  assert.equal(tiles().style.getPropertyValue("--qap-grid-columns"), "4");
  assert.equal(tiles().querySelectorAll(".qap-tile").length, 4);
  assert.equal(tiles().querySelector(".qap-tile-name").textContent, "Shortcut 0");
  env.document.body.querySelector(".qap-page-next").click();
  assert.equal(tiles().querySelectorAll(".qap-tile").length, 2);
});

test("saved icon-only grids keep search names and restore labels when disabled", async () => {
  const env = environment();
  const profile = savedProfile(env);
  profile.categories[0].grid = { columns: 3, rows: 4, hideNames: true };
  profile.categories.push({ id: "tools", name: "Tools" });
  profile.settings.links = [
    manyShortcuts(1)[0],
    { ...manyShortcuts(1, "tools")[0], id: "tools-0" },
  ];
  await startProfiles(env);
  env.fab().click();
  const search = env.document.body.querySelector(".qap-search-input");
  search.value = "Shortcut 0";
  search.dispatchEvent(new Event("input"));
  const tiles = env.document.body.querySelector(".qap-home").querySelectorAll(".qap-tile");
  assert.equal(tiles.length, 2);
  assert.equal(tiles[0].querySelector(".qap-tile-name"), null);
  assert.equal(tiles[0].getAttribute("aria-label"), "Shortcut 0");
  assert.equal(tiles[1].querySelector(".qap-tile-name").textContent, "Shortcut 0");
  buttons(env.document.body)
    .find((button) => button.title === "Settings")
    .click();
  openSettingsScreen(env, "categories");
  const favorites = env.document.body
    .querySelectorAll(".qap-category-row")
    .find((row) => row.dataset.id === "favorites");
  await clickAndFlush(categoryAction(env, favorites, "edit"));
  const form = env.document.body.querySelector(".qap-category-form");
  const labels = form.querySelector(".qap-grid-labels");
  assert.equal(labels.checked, false);
  labels.checked = true;
  labels.dispatchEvent(new Event("change"));
  assert.equal(
    form.querySelector(".qap-arrangement-enabled").querySelector(".qap-tile-name").textContent,
    "Shortcut 0",
  );
  form.querySelector(".qap-category-cancel").click();
  respondToDiscard(env, false);
  assert.equal(form.isConnected, true);
  assert.equal(savedProfile(env).categories[0].grid.hideNames, true);
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.equal(savedProfile(env).categories[0].grid.hideNames, undefined);
  returnToLauncher(env);
  assert.equal(
    env.document.body.querySelector(".qap-home").querySelector(".qap-tile-name").textContent,
    "Shortcut 0",
  );
});

test("grid label validation accepts optional booleans and rejects malformed preferences", async () => {
  const env = environment();
  const { validShortcutGrid } = await env.run("profiles/profile-validation.js");
  for (const hideNames of [true, false])
    assert.equal(validShortcutGrid({ rows: 2, columns: 3, hideNames }), true);
  assert.equal(validShortcutGrid({ rows: 2, columns: 3 }), true);
  for (const hideNames of [null, 0, 1, "true", [], {}]) {
    assert.equal(validShortcutGrid({ rows: 2, columns: 3, hideNames }), false);
  }
  assert.equal(validShortcutGrid({ rows: 2, columns: 3, hideNames: true, extra: true }), false);
});

test("new group grid drafts cancel safely and save the selected dimensions with the name", async () => {
  const env = await openShortcutsSettings("/config");
  openCategoriesManager(env).querySelector(".qap-create-category").click();
  const form = env.document.body.querySelector(".qap-category-form");
  const [columns, rows] = form
    .querySelector(".qap-grid-fields")
    .querySelectorAll("input, qap-input");
  for (const [control, value] of [
    [columns, "4"],
    [rows, "2"],
  ]) {
    control.value = value;
    control.dispatchEvent(new Event("input"));
  }
  assert.equal(form.querySelector(".qap-arrangement-enabled").children.length, 0);
  assert.equal(form.querySelectorAll(".qap-grid-placeholder").length, 0);
  assert.match(form.querySelector(".qap-arrangement-empty").textContent, /No enabled shortcuts/);
  form.querySelector(".qap-category-cancel").click();
  respondToDiscard(env, false);
  assert.equal(columns.value, "4");
  form.querySelector(".qap-category-cancel").click();
  respondToDiscard(env, true);
  assert.equal(form.isConnected, false);
  assert.equal(env.server.requests.length, 0);
  openCategoriesManager(env).querySelector(".qap-create-category").click();
  const newForm = env.document.body.querySelector(".qap-category-form");
  categoryInput(newForm).value = "Rooms";
  const dimensions = newForm.querySelector(".qap-grid-fields").querySelectorAll("input, qap-input");
  dimensions[0].value = "4";
  dimensions[1].value = "2";
  await clickAndFlush(newForm.querySelector(".qap-category-submit"));
  assert.deepEqual(savedProfile(env).categories.at(-1).grid, { columns: 4, rows: 2 });
  assert.equal(savedProfile(env).categories.at(-1).name, "Rooms");
});

test("shortcut pagination bounds maximum launcher DOM and preserves group selection", async () => {
  const env = environment();
  const profile = env.server.data("test-user").profiles[0];
  profile.categories.push({ id: "tools", name: "Tools" });
  profile.settings.links = manyShortcuts(maxProfileItems);
  await startProfiles(env);
  env.fab().click();
  const tiles = () => env.document.body.querySelectorAll(".qap-tile-name");
  const next = () => env.document.body.querySelector(".qap-page-next");
  const previous = () => env.document.body.querySelector(".qap-page-previous");
  const pageStatus = () =>
    env.document.body.querySelector(".qap-pagination").querySelector(".qap-count").textContent;
  assert.equal(tiles().length, shortcutPageSize);
  assert.equal(previous().disabled, true);
  const seen = new Set();
  while (true) {
    assert.ok(tiles().length <= shortcutPageSize);
    for (const tile of tiles()) {
      assert.equal(seen.has(tile.textContent), false);
      seen.add(tile.textContent);
    }
    if (next().disabled) break;
    next().click();
  }
  assert.equal(seen.size, maxProfileItems);
  assert.equal(tiles().at(-1).textContent, `Shortcut ${maxProfileItems - 1}`);
  assert.equal(
    pageStatus(),
    `Page ${Math.ceil(maxProfileItems / shortcutPageSize)} of ${Math.ceil(maxProfileItems / shortcutPageSize)}`,
  );
  previous().click();
  assert.equal(tiles()[0].textContent, `Shortcut ${maxProfileItems - 2 * shortcutPageSize}`);
  assert.equal(env.document.body.querySelector(".qap-search-input").value, "");
  env.document.body
    .querySelector(".qap-tabs")
    .children.find((tab) => tab.dataset.tab === "tools")
    .click();
  assert.equal(tiles().length, 0);
  assert.equal(env.document.body.querySelector(".qap-pagination").hidden, true);
  env.document.body
    .querySelector(".qap-tabs")
    .children.find((tab) => tab.dataset.tab === "favorites")
    .click();
  assert.equal(tiles()[0].textContent, "Shortcut 0");
  next().click();
  profile.settings.links = profile.settings.links.slice(0, 1);
  env.server.data("test-user").revision++;
  env.server.notify("test-user");
  assert.equal(tiles().length, 1, "a remote shrink clamps the current page");
  assert.equal(pageStatus(), "Page 1 of 1");
  assert.equal(
    env.server.requests.length,
    0,
    "pagination and group selection never write profiles",
  );
});

test("shortcut search spans groups, paginates and restores the selected group", async () => {
  const env = environment();
  installDeviceRegistries(env);
  const profile = env.server.data("test-user").profiles[0];
  profile.categories.push({ id: "tools", name: "Tools" });
  profile.settings.links = manyShortcuts(shortcutPageSize + 2);
  profile.settings.links.push({ ...defaultLinks[1], group: "tools" });
  await startProfiles(env);
  env.fab().click();
  const tiles = () =>
    env.document.body.querySelectorAll(".qap-tile-name").map((tile) => tile.textContent);
  const search = env.document.body.querySelector(".qap-search-input");
  assert.equal(search.localName, "qap-search");
  assert.equal(search.attributes["aria-label"], "Search shortcuts across groups...");
  const revealSearch = env.document.body.querySelector(".qap-search-shortcuts");
  assert.equal(revealSearch.attributes["aria-expanded"], "false");
  assert.equal(revealSearch.attributes["aria-controls"], search.parentElement.id);
  assert.equal(search.parentElement.hidden, true);
  search.focus = () => {
    env.document.activeElement = search;
  };
  revealSearch.click();
  assert.equal(search.parentElement.hidden, false);
  assert.equal(revealSearch.attributes["aria-expanded"], "true");
  assert.notEqual(
    env.document.activeElement,
    search,
    "showing search does not focus it or open the keyboard",
  );
  revealSearch.click();
  assert.equal(search.parentElement.hidden, true);
  assert.equal(revealSearch.attributes["aria-expanded"], "false");
  revealSearch.click();
  const searchFor = (value) => {
    search.value = value;
    search.dispatchEvent(new Event("input"));
  };
  env.document.body
    .querySelector(".qap-tabs")
    .children.find((tab) => tab.dataset.tab === "tools")
    .click();
  assert.deepEqual(tiles(), ["Device Explorer"]);
  searchFor("  sHoRtCuT  ");
  assert.equal(env.document.body.querySelector(".qap-tabs").hidden, true);
  assert.equal(tiles().length, shortcutPageSize);
  env.document.body.querySelector(".qap-page-next").click();
  assert.deepEqual(tiles(), [`Shortcut ${shortcutPageSize}`, `Shortcut ${shortcutPageSize + 1}`]);
  searchFor("/s/0");
  assert.deepEqual(tiles(), ["Shortcut 0"], "a new query resets pagination and matches paths");
  searchFor("TOOLS");
  assert.deepEqual(tiles(), ["Device Explorer"], "group names are searchable");
  await clickAndFlush(env.document.body.querySelector(".qap-tile"));
  assert.equal(
    env.document.body.querySelector("qap-dialog").headerTitle,
    "Device Explorer",
    "registry shortcut actions work from search results",
  );
  buttons(env.document.body)
    .find((button) => button.title === "Back")
    .click();
  const restored = env.document.body.querySelector(".qap-search-input");
  assert.equal(restored.value, "TOOLS");
  assert.equal(restored.parentElement.hidden, false);
  restored.value = "no such shortcut";
  restored.dispatchEvent(new Event("input"));
  assert.equal(tiles().length, 0);
  assert.equal(
    env.document.body.querySelector(".qap-empty").querySelector("strong").textContent,
    "No matching shortcuts",
  );
  assert.equal(env.document.body.querySelector(".qap-empty").querySelector("button"), null);
  assert.equal(env.document.body.querySelector(".qap-pagination").hidden, true);
  const toggle = env.document.body.querySelector(".qap-search-shortcuts");
  restored.blur = () => {
    env.document.activeElement = null;
  };
  env.document.activeElement = restored;
  toggle.click();
  assert.equal(restored.parentElement.hidden, true);
  assert.equal(toggle.attributes["aria-expanded"], "false");
  assert.equal(
    env.document.activeElement,
    null,
    "hiding the focused search dismisses the keyboard",
  );
  toggle.click();
  assert.equal(restored.parentElement.hidden, false);
  assert.equal(restored.value, "no such shortcut", "toggling only changes search visibility");
  assert.equal(toggle.attributes["aria-expanded"], "true");
  assert.equal(env.document.activeElement, null);
  restored.value = "   ";
  restored.dispatchEvent(new Event("input"));
  assert.deepEqual(tiles(), ["Device Explorer"]);
  assert.equal(env.document.body.querySelector(".qap-tabs").hidden, false);
  assert.equal(
    env.document.body.querySelector(".qap-tabs").children.find((tab) => tab.dataset.tab === "tools")
      .attributes["aria-pressed"],
    "true",
  );
  assert.deepEqual(env.server.requests, [], "searches never write profiles");
});

test("closing Quick Access clears an unmatched shortcut search before reopening", async () => {
  const env = await startProfiles(environment());
  env.fab().click();
  env.document.body.querySelector(".qap-search-shortcuts").click();
  const search = env.document.body.querySelector(".qap-search-input");
  search.value = "no such shortcut";
  search.dispatchEvent(new Event("input"));
  assert.equal(env.document.body.querySelectorAll(".qap-tile").length, 0);
  env.document.body.querySelector(".qap-head-button").click();
  env.fab().click();
  assert.equal(env.document.body.querySelector(".qap-search-input").value, "");
  assert.equal(env.document.body.querySelector(".qap-search").hidden, true);
  assert.equal(
    env.document.body.querySelector(".qap-search-shortcuts").attributes["aria-expanded"],
    "false",
  );
  assert.equal(env.document.body.querySelector(".qap-empty"), null);
  assert.equal(env.document.body.querySelectorAll(".qap-tile").length, defaultLinks.length);
});

test("shortcut search survives synchronization and language changes and resets with the profile", async () => {
  const env = environment();
  installLocaleFetch(env);
  const data = env.server.data("test-user");
  data.profiles.push({ ...clone(data.profiles[0]), id: "other", name: "Other" });
  await startProfiles(env);
  env.fab().click();
  env.document.body.querySelector(".qap-search-shortcuts").click();
  const searchFor = (value) => {
    const control = env.document.body.querySelector(".qap-search-input");
    control.value = value;
    control.dispatchEvent(new Event("input"));
  };
  searchFor("explorer");
  data.profiles[0].settings.links[0].name = "Renamed";
  data.revision++;
  env.server.notify("test-user");
  assert.equal(env.document.body.querySelector(".qap-search-input").value, "explorer");
  assert.equal(env.document.body.querySelector(".qap-search").hidden, false);
  assert.deepEqual(
    env.document.body.querySelectorAll(".qap-tile-name").map((tile) => tile.textContent),
    ["Device Explorer"],
  );
  searchFor("missing");
  const control = env.document.body.querySelector(".qap-search-input");
  await changeLanguage(env, "hr-HR");
  assert.equal(env.document.body.querySelector(".qap-search-input"), control);
  assert.equal(control.value, "missing");
  assert.equal(control.placeholder, "Pretraži prečace u svim grupama...");
  assert.equal(
    env.document.body.querySelector(".qap-empty").querySelector("strong").textContent,
    "Nema odgovarajućih prečaca",
  );
  await changeLanguage(env, "en");
  await useProfile(env, "other");
  returnToLauncher(env);
  assert.equal(env.document.body.querySelector(".qap-search-input").value, "");
  assert.equal(env.document.body.querySelector(".qap-search").hidden, true);
  assert.equal(env.document.body.querySelectorAll(".qap-tile-name").length, defaultLinks.length);
  assert.equal(env.server.requests.length, 0);
});

test("shortcut limit preserves new drafts", async () => {
  const env = environment();
  assert.equal(shortcutLimit, maxProfileItems, "frontend and server limits agree");
  const profile = env.server.data("test-user").profiles[0];
  profile.settings.links = manyShortcuts(shortcutLimit);
  await openShortcutsSettings("/config", undefined, env);
  env.document.body.querySelector(".qap-add-shortcut").click();
  const editor = env.document.body.querySelector(".qap-shortcut-form");
  const fields = editor.querySelectorAll("input, qap-input");
  fields[0].value = "Keep my draft";
  fields.at(-1).value = "/config";
  await clickAndFlush(buttons(editor).find((button) => button.textContent === "Save"));
  assert.equal(env.document.body.querySelector(".qap-shortcut-form"), editor);
  assert.equal(fields[0].value, "Keep my draft");
  assert.match(
    editor.querySelector(".qap-error").textContent,
    /Shortcut limit reached \(500 per profile\)/,
  );
  assert.equal(env.server.requests.length, 0);
  assert.equal(env.server.data("test-user").profiles[0].settings.links.length, shortcutLimit);
});

test("native shortcut search and pagination controls retain group browsing", async () => {
  const env = environment();
  nativeComponents(env);
  const profile = savedProfile(env);
  profile.categories.push({ id: "tools", name: "Tools" });
  profile.settings.links = manyShortcuts(shortcutPageSize + 1, "tools");
  await startProfiles(env);
  env.fab().click();
  const search = env.document.body.querySelector("qap-search");
  assert.equal(search.parentElement.hidden, true);
  search.focus = () => {
    env.document.activeElement = search;
  };
  search.updateComplete = Promise.resolve();
  await clickAndFlush(env.document.body.querySelector(".qap-search-shortcuts"));
  assert.equal(search.parentElement.hidden, false);
  assert.notEqual(env.document.activeElement, search);
  await clickAndFlush(env.document.body.querySelector(".qap-search-shortcuts"));
  assert.equal(search.parentElement.hidden, true);
  await clickAndFlush(env.document.body.querySelector(".qap-search-shortcuts"));
  search.value = "TOOLS";
  search.dispatchEvent(new Event("input"));
  assert.equal(env.document.body.querySelectorAll(".qap-tile").length, shortcutPageSize);
  const next = env.document.body.querySelector(".qap-page-next");
  assert.equal(next.localName, "qap-button");
  next.click();
  assert.equal(
    env.document.body.querySelector(".qap-tile-name").textContent,
    "Shortcut " + shortcutPageSize,
  );
  env.document.body.querySelector(".qap-page-previous").click();
  assert.equal(env.document.body.querySelector(".qap-tile-name").textContent, "Shortcut 0");
  search.value = "";
  search.dispatchEvent(new Event("input"));
  assert.equal(env.document.body.querySelectorAll(".qap-tile").length, 0);
  assert.equal(env.document.body.querySelector(".qap-tabs").hidden, false);
  assert.equal(env.server.requests.length, 0);
});

test(`shortcut settings paginate the whole maximum profile and sort later pages safely`, async () => {
  const env = environment();
  const profile = env.server.data("test-user").profiles[0];
  profile.categories.push({ id: "tools", name: "Tools" });
  profile.settings.links = manyShortcuts(maxProfileItems, "tools");
  const firstGroupCount = Math.floor(shortcutPageSize / 2);
  for (const link of profile.settings.links.slice(0, firstGroupCount)) link.group = "favorites";
  const original = clone(profile.settings.links);
  await openShortcutsSettings("/config", undefined, env);
  const items = () => env.document.body.querySelectorAll(".qap-edit-item");
  const next = () => env.document.body.querySelector(".qap-page-next");
  assert.equal(items().length, shortcutPageSize, "the limit is per page across all groups");
  assert.equal(env.document.body.querySelectorAll(".qap-shortcut-category").length, 2);
  next().click();
  let list = env.document.body
    .querySelectorAll(".qap-shortcut-list")
    .find((list) => list.dataset.group === "tools");
  assert.equal(list.children.length, shortcutPageSize);
  assert.equal(items()[0].dataset.id, original[shortcutPageSize].id);
  assert.equal(list.querySelector(".qap-grip"), null, "management pages have no drag controls");
  assert.equal(list.querySelector("qap-sortable"), null);
  const saved = () => env.server.data("test-user").profiles[0].settings.links;
  assert.deepEqual(saved(), original);
  await dispatchAndFlush(
    list.parentElement,
    new CustomEvent("item-moved", { detail: { oldIndex: 0, newIndex: 1 } }),
  );
  assert.deepEqual(saved(), original, "obsolete sort notifications cannot mutate shortcuts");
  assert.equal(env.server.requests.length, 0);
  next().click();
  while (!next().disabled) {
    assert.ok(items().length <= shortcutPageSize);
    next().click();
  }
  assert.equal(items().at(-1).dataset.id, original.at(-1).id);
  assert.equal(items().length, shortcutPageSize);
});

test("shortcut settings retain a later page through editing and clamp it after deleting its last item", async () => {
  const env = environment();
  const profile = env.server.data("test-user").profiles[0];
  profile.settings.links = manyShortcuts(shortcutPageSize + 1);
  await openShortcutsSettings("/config", undefined, env);
  env.document.body.querySelector(".qap-page-next").click();
  await shortcutAction(env);
  await clickAndFlush(buttons(env.document.body).find((button) => button.textContent === "Save"));
  assert.equal(env.document.body.querySelectorAll(".qap-edit-item").length, 1);
  await shortcutAction(env, "delete");
  await clickAndFlush(
    env.document.body.querySelector(".qap-delete-confirmation").querySelector(".qap-button-danger"),
  );
  assert.equal(env.document.body.querySelectorAll(".qap-edit-item").length, shortcutPageSize);
  assert.equal(env.document.body.querySelector(".qap-pagination").hidden, true);
  assert.equal(env.server.data("test-user").profiles[0].settings.links.length, shortcutPageSize);
});

test("shortcut pagination stays bounded at the administrator's maximum group count", async () => {
  const env = environment();
  const constants = readFileSync(
    path.join(__dirname, "../../custom_components/quick_access/const.py"),
    "utf8",
  );
  const maxCategories = Number(
    constants.match(/OPTION_MAXIMUMS = \{[\s\S]*?"max_categories": (\d+)/)[1],
  );
  env.server.limits = { ...env.server.data("test-user").limits, max_categories: maxCategories };
  const profile = env.server.data("test-user").profiles[0];
  profile.categories.push(
    ...Array.from({ length: maxCategories - 1 }, (_, index) => ({
      id: `group-${index}`,
      name: `Group ${index}`,
    })),
  );
  profile.settings.links = manyShortcuts(maxProfileItems);
  profile.settings.links.forEach((link, index) => {
    link.group = profile.categories[index % maxCategories].id;
  });
  await openShortcutsSettings("/config", undefined, env);
  const seen = new Set();
  while (true) {
    const items = env.document.body.querySelectorAll(".qap-edit-item");
    assert.ok(items.length <= shortcutPageSize);
    for (const item of items) {
      assert.equal(seen.has(item.dataset.id), false);
      seen.add(item.dataset.id);
    }
    const next = env.document.body.querySelector(".qap-page-next");
    if (next.disabled) break;
    next.click();
  }
  assert.equal(seen.size, maxProfileItems);
  assert.equal(env.document.body.querySelectorAll(".qap-category-row").length, 0);
  assert.equal(
    openCategoriesManager(env).querySelectorAll(".qap-category-row").length,
    maxCategories,
  );
  assert.equal(env.server.requests.length, 0);
});

test("native settings inputs and selects retain validation, URL actions, and saved values", async () => {
  const env = environment();
  nativeComponents(env);
  await openSettings("/config/logs", undefined, env);
  const mode = env.document.body.querySelector("qap-select");
  const paths = env.document.body.querySelector(".qap-textarea");
  const save = env.document.body.querySelector(".qap-save-settings");
  assert.equal(mode.label, "Where to show Quick Access");
  assert.deepEqual(
    Array.from(mode.options, (option) => option.value),
    ["exclude", "include"],
  );
  assert.equal(env.document.body.querySelector("input, qap-input"), null);
  assert.equal(env.document.body.querySelector("select"), null);
  await dispatchAndFlush(mode, new CustomEvent("selected", { detail: { value: "invalid" } }));
  assert.equal(mode.value, "exclude");
  await selectAndFlush(mode, "include");
  assert.equal(mode.value, "include");
  assert.equal(
    env.document.body.querySelector("#qap-url-paths-description").textContent,
    "List the page paths where the button should be shown.",
  );
  await clickAndFlush(save);
  assert.equal(
    env.document.body.querySelector(".qap-url-paths").querySelector(".qap-field-error").textContent,
    "Add at least one page path for this display rule.",
  );
  for (const action of env.document.body.querySelectorAll(".qap-current-url-action"))
    action.click();
  await flush();
  const routes = [
    "/config/logs",
    "/config/logs/*",
    "/config/logs?more-info-entity-id=sensor.temperature#details",
  ];
  assert.equal(paths.value, routes.join("\n"));
  await clickAndFlush(save);
  const saved = savedProfile(env).settings;
  assert.equal(saved.visibility, "include");
  assert.deepEqual(saved.routes, routes);
  buttons(env.document.body)
    .find((button) => button.title === "Settings")
    .click();
  openSettingsScreen(env, "visibility");
  await flush();
  assert.equal(env.document.body.querySelector(".qap-textarea").value, routes.join("\n"));
  assert.equal(env.document.body.querySelector("qap-select").value, "include");
});
