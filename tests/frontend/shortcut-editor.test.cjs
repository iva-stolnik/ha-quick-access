// Shortcut editor: current page, external URLs, previews, colors and fields.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  externalURLCases,
  loadDefaults,
  flush,
  clickAndFlush,
  dispatchAndFlush,
  clone,
  savedProfile,
  Element,
  environment,
  nativeComponents,
  buttons,
  iconColorInput,
  respondToDiscard,
  openLauncherSettings,
  openSettingsScreen,
  returnToLauncher,
  openShortcutsSettings,
  changeValidationControl,
  startProfiles,
  shortcutAction,
  categorySelect,
  selectAndFlush,
  confirmMove,
} = require("./harness.cjs");
let defaultLinks;
test.before(async () => ({ defaultLinks } = await loadDefaults()));

test("external URL editor validation matches shared backend cases and preserves valid snapshots", async () => {
  const env = await startProfiles(environment());
  const { safeExternal } = await env.run("utils/urls.js");
  const { createProfileValidation } = await env.run("profiles/profile-validation.js");
  const { createLocalizer } = await env.run("localize.js");
  const { validateProfileData, shortcutPathError } = createProfileValidation(createLocalizer());
  for (const [result, paths] of Object.entries(externalURLCases)) {
    for (const url of paths) {
      const valid = result === "valid";
      assert.equal(safeExternal(url), valid, url);
      assert.equal(
        String(shortcutPathError("external", url)),
        valid ? "" : "Enter a full http:// or https:// URL.",
        url,
      );
      if (!valid) continue;
      const snapshot = clone(env.server.data("test-user"));
      Object.assign(snapshot.profiles[0].settings.links[0], { type: "external", path: url });
      const before = clone(snapshot);
      assert.deepEqual(clone(validateProfileData(snapshot)), before, url);
      assert.deepEqual(snapshot, before, "Validation must preserve all saved shortcuts");
    }
  }
  assert.equal(env.server.requests.length, 0, "Validation must not save a repaired snapshot");
});

test("server-validated external hosts load when a browser parser rejects them, while unsafe protocols fail", async () => {
  const env = await startProfiles(environment());
  const { safeExternal } = await env.run("utils/urls.js");
  const { createProfileValidation } = await env.run("profiles/profile-validation.js");
  const { createLocalizer } = await env.run("localize.js");
  const { validateProfileData } = createProfileValidation(createLocalizer());
  const url = "https://browser-unsupported.example/";
  const NativeURL = env.context.URL;
  env.context.URL = class extends NativeURL {
    constructor(value, ...args) {
      if (value === url) throw new TypeError("Browser IDNA rules differ");
      super(value, ...args);
    }
  };
  assert.equal(safeExternal(url), false);
  const snapshot = clone(env.server.data("test-user"));
  const link = snapshot.profiles[0].settings.links[0];
  Object.assign(link, { type: "external", path: url });
  const before = clone(snapshot);
  assert.deepEqual(clone(validateProfileData(snapshot)), before);
  assert.deepEqual(snapshot, before);
  for (const path of [
    "javascript:alert(1)",
    " \tjava\nscript:alert(1)",
    "data:text/html,test",
    "ftp://example.com/",
    "//example.com/",
    "/lovelace/home",
  ]) {
    link.path = path;
    assert.throws(() => validateProfileData(snapshot), /Invalid server profile data/, path);
  }
  assert.equal(env.server.requests.length, 0, "Validation must not rewrite saved shortcuts");
});

test(`settings overview goes back to Quick Access in the same open dialog`, async () => {
  const env = await startProfiles(environment());
  const create = env.document.createElement;
  env.document.createElement = (tag) => {
    const element = create(tag);
    element.focus = () => {
      env.document.activeElement = element;
    };
    return element;
  };
  openLauncherSettings(env, "settings");
  const root = env.document.body;
  const dialog = root.querySelector(".qap-settings-dialog");
  const shell = dialog.querySelector(".qap-shell");
  assert.equal(shell.querySelector(".qap-head")?.localName, undefined);
  assert.equal(dialog.querySelector(".qap-head-button").slot, "headerNavigationIcon");
  assert.equal(dialog.querySelector(".qap-head-actions").slot, "headerActionItems");
  assert.equal(dialog.headerTitle, "Settings");
  assert.equal(
    dialog.querySelectorAll(".qap-head-button").length,
    1,
    "Overview has only Back navigation",
  );
  assert.equal(dialog.querySelector(".qap-back-settings").title, "Back");
  assert.equal(
    dialog.querySelector(".qap-back-settings").querySelector("qap-icon").getAttribute("icon"),
    "mdi:arrow-left",
  );
  assert.equal(shell.querySelector(".qap-settings-footer"), null);
  assert.deepEqual(
    root.querySelectorAll(".qap-settings-section-title").map((heading) => heading.textContent),
    ["Active profile", "Profile configuration"],
  );
  for (const action of root.querySelectorAll(".qap-settings-row")) {
    assert.equal(action.localName, "qap-list-item");
    assert.ok(action.querySelector(".qap-settings-icon").querySelector("qap-icon"));
    assert.equal(action.parentElement.localName, "qap-list");
    assert.equal(action.querySelector(".qap-settings-icon").slot, "start");
    assert.equal(action.querySelector(".qap-settings-row-text").slot, "content");
    assert.equal(action.children.at(-1).slot, "end");
  }
  assert.equal(root.querySelector(".qap-add-shortcut"), null);
  assert.equal(root.querySelector(".qap-save-settings"), null);
  for (const [screen, heading, control] of [
    ["profiles", "Profiles", ".qap-create-profile"],
    ["shortcuts", "Shortcuts", ".qap-add-shortcut"],
    ["categories", "Groups", ".qap-create-category"],
    ["visibility", "Display rules", ".qap-save-settings"],
  ]) {
    root.querySelector(".qap-settings-" + screen).click();
    assert.equal(dialog.headerTitle, heading);
    assert.ok(root.querySelector(control));
    if (screen === "visibility") {
      const footer = dialog.querySelector(".qap-settings-footer");
      assert.equal(footer.querySelector(control).textContent, "Save");
      assert.equal(footer.localName, "div");
      assert.equal(footer.querySelector(control).slot, "primaryAction");
      assert.equal(shell.querySelector(".qap-body").contains(footer), false);
      assert.equal(footer.parentElement, dialog);
      assert.equal(footer.slot, "footer");
    } else if (screen === "profiles") {
      const create = dialog.querySelector(".qap-head-actions").querySelector(control);
      assert.equal(create.localName, "qap-icon-button");
      assert.equal(create.querySelector("qap-icon").attributes.icon, "mdi:plus");
      assert.equal(create.attributes["aria-label"], "Create profile");
      assert.equal(dialog.querySelector(".qap-settings-footer"), null);
    }
    assert.equal(root.querySelectorAll(".qap-shell").length, 1);
    assert.equal(dialog.querySelector(".qap-shell"), shell);
    assert.equal(env.document.activeElement, root.querySelector(".qap-head-button"));
    root.querySelector(".qap-head-button").click();
    assert.ok(root.querySelector(".qap-settings-overview"));
    assert.equal(env.document.activeElement, root.querySelector(".qap-settings-" + screen));
  }
  root.querySelector(".qap-back-settings").click();
  assert.equal(root.querySelector(".qap-settings-dialog"), null);
  assert.equal(root.querySelector(".qap-home-dialog"), dialog);
  assert.equal(dialog.querySelector(".qap-shell"), shell);
  assert.equal(dialog.open, true);
  assert.equal(dialog.headerTitle, "Quick Access");
  assert.equal(dialog.querySelector(".qap-head-button").title, "Close");
  assert.equal(env.document.activeElement, dialog.querySelector(".qap-head-button"));
  openLauncherSettings(env, "settings");
  assert.ok(root.querySelector(".qap-settings-overview"));
  root.querySelector(".qap-back-settings").click();
  dialog.querySelector(".qap-head-button").click();
  assert.equal(dialog.isConnected, false);
});

test("Save current page icon follows saved internal paths across active-profile groups", async () => {
  const env = environment();
  const data = env.server.data("test-user");
  const profile = data.profiles[0];
  const path = env.window.location.pathname;
  const shortcut = {
    id: "current-page",
    name: "Saved page",
    type: "internal",
    path,
    icon: "mdi:home",
    color: "",
    group: "custom",
  };
  profile.categories.push({ id: "custom", name: "Custom group" });
  profile.settings.links = [
    { ...shortcut, id: "child-page", path: `${path}/child` },
    { ...shortcut, id: "parent-page", path: "/lovelace" },
    {
      ...shortcut,
      id: "external-page",
      type: "external",
      path: `${env.window.location.origin}${path}`,
    },
  ];
  data.profiles.push({
    ...clone(profile),
    id: "other-profile",
    name: "Other profile",
    settings: { ...clone(profile.settings), links: [shortcut] },
  });
  Object.assign(env.window.location, { search: "?edit=1", hash: "#details" });
  await startProfiles(env);
  env.fab().click();
  const action = () => env.document.body.querySelector(".qap-save-current-page");
  const symbol = () => action().querySelector("qap-icon").attributes.icon;
  assert.equal(
    symbol(),
    "mdi:bookmark-plus-outline",
    "other profiles, external URLs and different paths do not mark the page as saved",
  );
  const writes = env.server.requests.length;
  profile.settings.links.push(shortcut);
  data.revision++;
  env.server.notify("test-user");
  await flush();
  assert.equal(
    symbol(),
    "mdi:bookmark-plus",
    "a shortcut in another group marks the current page as saved",
  );
  assert.equal(action().title, "Save current page");
  assert.equal(action().attributes["aria-label"], "Save current page");
  action().click();
  assert.ok(
    env.document.body.querySelector(".qap-shortcut-form"),
    "the filled icon still opens the New shortcut editor",
  );
  env.document.body.querySelector(".qap-cancel-shortcut").click();
  assert.equal(symbol(), "mdi:bookmark-plus");
  profile.settings.links.pop();
  data.revision++;
  env.server.notify("test-user");
  await flush();
  assert.equal(symbol(), "mdi:bookmark-plus-outline", "removing the shortcut restores the outline");
  assert.equal(env.server.requests.length, writes);
});

test("Save current page reuses the shortcut editor and returns to the launcher with HTML controls", async () => {
  const env = environment();
  const profile = env.server.data("test-user").profiles[0];
  profile.categories.push({ id: "custom", name: "Custom group" });
  const original = clone(profile);
  await startProfiles(env);
  env.fab().click();
  const body = env.document.body;
  const action = body.querySelector(".qap-save-current-page");
  body
    .querySelector(".qap-tabs")
    .children.find((tab) => tab.dataset.tab === "custom")
    .click();
  const pathname = "/lovelace/custom%20dashboard";
  Object.assign(env.window.location, { pathname, search: "?edit=1", hash: "#details" });
  const writes = env.server.requests.length;
  action.click();
  const editor = body.querySelector(".qap-shortcut-form");
  assert.equal(editor.querySelector(".qap-title").textContent, "Create shortcut");
  const fields = () => ({
    name: editor.querySelector("qap-input") || editor.querySelector("input, qap-input"),
    icon: editor.querySelector("qap-icon-picker") || editor.querySelectorAll("input, qap-input")[1],
    route:
      editor.querySelectorAll("qap-input").at(-1) ||
      editor.querySelectorAll("input, qap-input").at(-1),
    type: editor.querySelector("qap-select") || editor.querySelector("select, qap-select"),
  });
  assert.equal(fields().type.value, "internal");
  assert.equal(fields().route.value, pathname);
  assert.equal(fields().name.value, "");
  assert.equal(categorySelect(editor).value, "category:custom");
  assert.equal(env.server.requests.length, writes);

  fields().name.value = "My current page";
  fields().name.dispatchEvent(new Event("input"));
  fields().icon.value = "mdi:bookmark-outline";
  fields().icon.dispatchEvent(new Event("input"));
  assert.deepEqual(env.server.data("test-user").profiles[0], original);
  await clickAndFlush(buttons(editor).find((button) => button.textContent === "Save"));
  assert.ok(body.querySelector(".qap-home"));
  const saved = env.server.data("test-user").profiles[0];
  assert.deepEqual(saved.settings.links.slice(0, -1), original.settings.links);
  assert.deepEqual(saved.settings.links.at(-1), {
    id: saved.settings.links.at(-1).id,
    name: "My current page",
    icon: "mdi:bookmark-outline",
    color: "",
    type: "internal",
    path: pathname,
    group: "custom",
  });
  assert.equal(body.querySelector(".qap-tile-name").textContent, "My current page");
  assert.equal(body.querySelector(".qap-tile").href, pathname);
  assert.equal(
    body.querySelector(".qap-save-current-page").querySelector("qap-icon").attributes.icon,
    "mdi:bookmark-plus",
  );

  const savedWrites = env.server.requests.length;
  body
    .querySelector(".qap-tabs")
    .children.find((tab) => tab.dataset.tab === "favorites")
    .click();
  env.window.location.pathname = "/";
  env.window.dispatchEvent(new Event("location-changed"));
  env.fab().click();
  body.querySelector(".qap-save-current-page").click();
  const cancelled = body.querySelector(".qap-shortcut-form");
  const cancelledName =
    cancelled.querySelector("qap-input") || cancelled.querySelector("input, qap-input");
  assert.equal(cancelledName.value, "");
  assert.equal(
    (
      cancelled.querySelectorAll("qap-input").at(-1) ||
      cancelled.querySelectorAll("input, qap-input").at(-1)
    ).value,
    "/",
  );
  assert.equal(categorySelect(cancelled).value, "category:favorites");
  cancelled.querySelector(".qap-cancel-shortcut").click();
  assert.ok(body.querySelector(".qap-home"));
  assert.equal(
    body.querySelector(".qap-save-current-page").querySelector("qap-icon").attributes.icon,
    "mdi:bookmark-plus-outline",
  );
  assert.equal(env.server.requests.length, savedWrites);

  buttons(body)
    .find((button) => button.title === "Settings")
    .click();
  openSettingsScreen(env, "shortcuts");
  body.querySelector(".qap-add-shortcut").click();
  const standard = body.querySelector(".qap-shortcut-form");
  assert.deepEqual(
    buttons(standard.querySelector(".qap-form-actions")).map((button) => button.textContent),
    ["Cancel", "Save"],
  );
  assert.equal(
    (
      standard.querySelectorAll("qap-input").at(-1) ||
      standard.querySelectorAll("input, qap-input").at(-1)
    ).value,
    "",
  );
  standard.querySelector(".qap-cancel-shortcut").click();
  assert.ok(body.querySelector(".qap-shortcut-groups"));
});

test("current-page drafts survive HA upgrades and native URL-card actions fill HA inputs", async () => {
  const env = environment();
  Object.assign(env.window.location, { search: "?view=advanced", hash: "#section" });
  const fullUrl = `${env.window.location.pathname}?view=advanced#section`;
  const components = nativeComponents(env, false);
  await startProfiles(env);
  env.fab().click();
  env.document.body.querySelector(".qap-save-current-page").click();
  const editor = env.document.body.querySelector(".qap-shortcut-form");
  const name = editor.querySelector("input, qap-input");
  name.value = "Keep this draft";
  name.dispatchEvent(new Event("input"));
  components.register();
  await flush();
  const inputs = editor.querySelectorAll("qap-input");
  assert.equal(inputs.find((input) => input.label === "Name").value, "Keep this draft");
  const route = inputs.find((input) => input.label === "URL path");
  assert.equal(route.value, env.window.location.pathname);
  editor.querySelectorAll(".qap-current-url-action")[1].click();
  assert.equal(route.value, fullUrl);
  route.value = "/other";
  editor.querySelector(".qap-current-url-action").click();
  assert.equal(route.value, env.window.location.pathname);
  editor.querySelector(".qap-cancel-shortcut").click();
  respondToDiscard(env);
  env.document.body.querySelector(".qap-save-current-page").click();
  const nativeEditor = env.document.body.querySelector(".qap-shortcut-form");
  const type = nativeEditor.querySelector("qap-select");
  changeValidationControl(type, "quick-states", "change");
  const card = nativeEditor.querySelector(".qap-current-url-card");
  assert.equal(card.parentElement.hidden, true);
  changeValidationControl(type, "internal", "change");
  assert.equal(
    card.parentElement.hidden,
    true,
    "the prefilled current path hides its own suggestion",
  );
  const nativeRoute = nativeEditor
    .querySelectorAll("qap-input")
    .find((input) => input.label === "URL path");
  nativeRoute.value = "/other";
  nativeRoute.dispatchEvent(new Event("input"));
  assert.equal(card.parentElement.hidden, false);
  card.querySelector("qap-button").click();
  assert.equal(nativeRoute.value, env.window.location.pathname);
  assert.equal(card.parentElement.hidden, true);
  nativeEditor.querySelectorAll(".qap-current-url-action")[1].click();
  assert.equal(nativeRoute.value, fullUrl);
  assert.equal(card.parentElement.hidden, true);
  assert.equal(env.server.requests.length, 0);
});

test("Save current page offers full URLs and persists parameters and fragments exactly", async () => {
  const env = environment();
  const pathname = "/config/example";
  const search = "?view=advanced&name=a%20b";
  const hash = "#section";
  const fullUrl = `${pathname}${search}${hash}`;
  Object.assign(env.window.location, { pathname, search, hash });
  await startProfiles(env);
  env.fab().click();
  env.document.body.querySelector(".qap-save-current-page").click();
  const editor = env.document.body.querySelector(".qap-shortcut-form");
  const route = editor.querySelectorAll("input, qap-input").at(-1);
  assert.equal(route.value, pathname, "the page-only default remains available");
  const cards = editor.querySelectorAll(".qap-current-url-card");
  assert.deepEqual(
    cards.map((card) => card.querySelector(".qap-current-url-path").textContent),
    [pathname, fullUrl],
  );
  assert.equal(
    cards[1].querySelector(".qap-field-tip").textContent,
    "Current URL with parameters and fragment",
  );
  assert.equal(
    cards[1].querySelector(".qap-current-url-action").querySelector("span").textContent,
    "Add",
  );
  cards[1].querySelector(".qap-current-url-action").click();
  assert.equal(route.value, fullUrl);
  cards[0].querySelector(".qap-current-url-action").click();
  assert.equal(route.value, pathname);
  cards[1].querySelector(".qap-current-url-action").click();
  editor.querySelector("input, qap-input").value = "Advanced view";
  assert.equal(env.server.requests.length, 0);
  await clickAndFlush(buttons(editor).find((button) => button.textContent === "Save"));
  assert.equal(savedProfile(env).settings.links.at(-1).path, fullUrl);
  assert.equal(env.document.body.querySelectorAll(".qap-tile").at(-1).href, fullUrl);
  assert.equal(
    env.document.body.querySelector(".qap-save-current-page").querySelector("qap-icon").attributes
      .icon,
    "mdi:bookmark-plus",
  );
  env.window.location.hash = "#other";
  await dispatchAndFlush(env.window, new Event("hashchange"));
  assert.equal(
    env.document.body.querySelector(".qap-save-current-page").querySelector("qap-icon").attributes
      .icon,
    "mdi:bookmark-plus-outline",
  );
});

test("shortcut current URL card fills new paths and stays hidden while editing with HTML controls", async () => {
  for (const editing of [false, true]) {
    const env = environment();
    const pathname = "/config/dashboard";
    await openShortcutsSettings(
      pathname,
      {
        routes: ["/config/logs"],
        links: [
          {
            id: "custom",
            name: "Custom",
            type: "quick-states",
            path: "",
            icon: "mdi:format-list-bulleted",
            color: "",
            group: "favorites",
          },
        ],
      },
      env,
    );
    const originalSettings = JSON.stringify(savedProfile(env).settings);
    if (editing) await shortcutAction(env);
    else await clickAndFlush(env.document.body.querySelector(".qap-add-shortcut"));
    const editor = env.document.body.querySelector(".qap-shortcut-form");
    const card = editor.querySelector(".qap-current-url-card");
    const routeField = card.parentElement.previousElementSibling;
    const route = () =>
      routeField.querySelector("qap-input") || routeField.querySelector("input, qap-input");
    const changeType = (value) => {
      const type = editor.querySelector("qap-select") || editor.querySelector("select, qap-select");
      type.value = value;
      type.dispatchEvent(new Event("change"));
    };
    assert.equal(routeField.hidden, editing);
    assert.equal(card.parentElement.hidden, editing);
    assert.equal(card.querySelector(".qap-current-url-path").textContent, pathname);
    assert.equal(editor.querySelector(".qap-current-url-title"), null);
    changeType("internal");
    assert.equal(card.parentElement.hidden, editing);
    const action = card.querySelector(".qap-current-url-action");
    assert.equal(card.querySelector(".qap-field-tip").textContent, "Use current page path");
    assert.equal(action.querySelector("span").textContent, "Add");
    assert.equal(route().value, "");
    if (editing) route().value = pathname;
    else {
      route().value = "/old/path";
      await clickAndFlush(action);
    }
    assert.equal(route().value, pathname);

    if (!editing) {
      route().value = "/another/path";
      await clickAndFlush(action);
      await clickAndFlush(action);
    }
    assert.equal(route().value, pathname);
    assert.equal(card.parentElement.hidden, true, "an already used suggestion is hidden");
    changeType("quick-states");
    assert.equal(routeField.hidden, true);
    assert.equal(card.parentElement.hidden, true);
    changeType("internal");
    assert.equal(routeField.hidden, false);
    assert.equal(card.parentElement.hidden, true);
    if (!editing) {
      route().value = "/different";
      route().dispatchEvent(new Event("input"));
      assert.equal(card.parentElement.hidden, false);
      await clickAndFlush(action);
      assert.equal(card.parentElement.hidden, true);
    }
    const name = editor.querySelector("qap-input") || editor.querySelector("input, qap-input");
    name.value = "Current page";
    assert.equal(JSON.stringify(savedProfile(env).settings), originalSettings);
    await clickAndFlush(buttons(editor).find((button) => button.textContent === "Save"));
    const saved = savedProfile(env).settings;
    assert.equal(saved.links.find((link) => link.name === "Current page").path, pathname);
    assert.deepEqual(saved.routes, ["/config/logs"]);
  }
});

for (const origin of ["http://ha.example", "https://ha.example"]) {
  test(`external shortcut destinations stay absolute on ${origin} without rewriting saved paths`, async () => {
    const env = environment(origin);
    const cases = [
      ["https:example.com/path", "https://example.com/path"],
      ["http:example.com/path", "http://example.com/path"],
      ["https:/example.com/path", "https://example.com/path"],
      ["https:\\example.com\\path", "https://example.com/path"],
      ["https://example.com", "https://example.com/"],
    ];
    const profile = env.server.data("test-user").profiles[0];
    const template = profile.settings.links[0];
    profile.settings.links = cases.map(([path], index) => ({
      ...template,
      id: `external-${index}`,
      name: `External ${index}`,
      type: "external",
      path,
      group: "favorites",
    }));
    profile.settings.links.push({
      ...template,
      id: "internal",
      name: "Internal",
      type: "internal",
      path: "/config/logs",
      group: "favorites",
    });
    const before = clone(profile);
    await startProfiles(env);
    env.fab().click();
    const tiles = env.document.body.querySelectorAll(".qap-tile");
    assert.equal(tiles.length, cases.length + 1);
    cases.forEach(([path, destination], index) => {
      const tile = tiles[index];
      assert.equal(new URL(tile.href, origin + "/lovelace/home").href, destination, path);
      assert.equal(tile.href, destination, path);
      assert.equal(tile.target, "_blank");
      assert.equal(tile.rel, "noopener noreferrer");
    });
    assert.equal(tiles.at(-1).href, "/config/logs");
    assert.equal(new URL(tiles.at(-1).href, origin).href, origin + "/config/logs");
    assert.deepEqual(profile, before);
    assert.equal(env.server.requests.length, 0);
  });
}

test("a browser-rejected external shortcut does not prevent other shortcut tiles from rendering", async () => {
  const env = environment("https://ha.example");
  const profile = env.server.data("test-user").profiles[0];
  const template = profile.settings.links[0];
  const path = "https://browser-unsupported.example/";
  profile.settings.links = [
    {
      ...template,
      id: "unsupported",
      name: "Unsupported",
      type: "external",
      path,
      group: "favorites",
    },
    {
      ...template,
      id: "internal",
      name: "Internal",
      type: "internal",
      path: "/config/logs",
      group: "favorites",
    },
  ];
  const before = clone(profile);
  const NativeURL = env.context.URL;
  env.context.URL = class extends NativeURL {
    constructor(value, ...args) {
      if (value === path) throw new TypeError("Browser IDNA rules differ");
      super(value, ...args);
    }
  };
  await startProfiles(env);
  env.fab().click();
  const tiles = env.document.body.querySelectorAll(".qap-tile");
  assert.equal(tiles.length, 2);
  assert.equal(tiles[0].href, undefined);
  assert.equal(tiles[0].getAttribute("aria-disabled"), "true");
  assert.equal(tiles[1].href, "/config/logs");
  assert.deepEqual(profile, before);
  assert.equal(env.server.requests.length, 0);
});

test("new shortcut preview updates without saving and matches the saved Quick Access tile", async () => {
  const env = await openShortcutsSettings("/config");
  await clickAndFlush(env.document.body.querySelector(".qap-add-shortcut"));
  const editor = env.document.body.querySelector(".qap-shortcut-form");
  const preview = editor.querySelector(".qap-shortcut-preview");
  const [name, route] = editor
    .querySelectorAll("input, qap-input")
    .filter((field) => field.type !== "color");
  const icon = editor.querySelector("qap-icon-picker");
  const type = editor.querySelector("select, qap-select");
  assert.equal(preview.nextElementSibling, name.parentElement);
  assert.equal(preview.querySelector(".qap-tile-name").textContent, "Shortcut name");
  name.value = "  My website  ";
  await dispatchAndFlush(name, new Event("input"));
  icon.value = "mdi:web";
  changeValidationControl(icon, icon.value);
  type.value = "external";
  await dispatchAndFlush(type, new Event("change"));
  route.value = "https://example.com";
  const tile = preview.querySelector(".qap-tile");
  assert.equal(tile.querySelector(".qap-tile-name").textContent, "My website");
  assert.equal(
    tile.querySelector(".qap-tile-icon").querySelector("qap-icon").attributes.icon,
    "mdi:web",
  );
  assert.ok(tile.querySelector(".qap-tile-external"));
  assert.equal(tile.inert, true);
  assert.equal(tile.tabIndex, -1);
  assert.equal(tile.href, undefined);
  await clickAndFlush(tile);
  assert.equal(editor.querySelector(".qap-title").textContent, "Create shortcut");
  assert.equal(env.server.requests.length, 0);
  const appearance = (element) => ({
    tag: element.localName,
    classes: element.className,
    name: element.querySelector(".qap-tile-name").textContent,
    iconClasses: element.querySelector(".qap-tile-icon").className,
    icons: element.querySelectorAll("qap-icon").map((icon) => icon.attributes.icon),
  });
  const expected = appearance(tile);
  await clickAndFlush(buttons(editor).find((button) => button.textContent === "Save"));
  returnToLauncher(env);
  await flush();
  const savedTile = env.document.body
    .querySelectorAll(".qap-tile")
    .find((element) => element.querySelector(".qap-tile-name").textContent === "My website");
  assert.deepEqual(appearance(savedTile), expected);
  assert.equal(savedTile.href, "https://example.com/");
  assert.equal(savedTile.target, "_blank");
  assert.equal(savedTile.rel, "noopener noreferrer");
});

test("shortcut preview follows native name, icon picker, and type changes without opening Entity states", async () => {
  const env = environment();
  nativeComponents(env);
  await openShortcutsSettings("/config", undefined, env);
  await clickAndFlush(env.document.body.querySelector(".qap-add-shortcut"));
  const editor = env.document.body.querySelector(".qap-shortcut-form");
  const preview = editor.querySelector(".qap-shortcut-preview");
  const name = editor.querySelectorAll("qap-input").find((field) => field.label === "Name");
  const type = editor
    .querySelectorAll("qap-select")
    .find((field) => field.label === "Shortcut type");
  name.value = "My states";
  await dispatchAndFlush(name, new Event("input"));
  await dispatchAndFlush(
    editor.querySelector("qap-icon-picker"),
    new CustomEvent("value-changed", { detail: { value: "mdi:thermometer" } }),
  );
  await selectAndFlush(type, "quick-states");
  const tile = preview.querySelector(".qap-tile");
  assert.equal(tile.localName, "button");
  assert.equal(tile.querySelector(".qap-tile-name").textContent, "My states");
  assert.equal(tile.querySelector("qap-icon").attributes.icon, "mdi:thermometer");
  await clickAndFlush(tile);
  assert.equal(editor.querySelector(".qap-title").textContent, "Create shortcut");
  await selectAndFlush(type, "external");
  assert.ok(preview.querySelector(".qap-tile-external"));
  await selectAndFlush(type, "internal");
  assert.equal(preview.querySelector(".qap-tile-external"), null);
});

test("shortcut preview keeps draft values and live updates after delayed native controls load", async () => {
  const env = environment();
  const components = nativeComponents(env, false);
  components.register("ha-form");
  await openShortcutsSettings("/config", undefined, env);
  await clickAndFlush(env.document.body.querySelector(".qap-add-shortcut"));
  const editor = env.document.body.querySelector(".qap-shortcut-form");
  const preview = editor.querySelector(".qap-shortcut-preview");
  const [name] = editor.querySelectorAll("input, qap-input");
  const icon = editor.querySelector("qap-icon-picker");
  name.value = "Draft shortcut";
  await dispatchAndFlush(name, new Event("input"));
  icon.value = "mdi:hammer";
  changeValidationControl(icon, icon.value);
  const color = iconColorInput(editor);
  color.value = "#008080";
  await dispatchAndFlush(color, new Event("change"));
  components.register();
  await new Promise(setImmediate);
  const nativeName = editor.querySelectorAll("qap-input").find((field) => field.label === "Name");
  const picker = editor.querySelector("qap-icon-picker");
  assert.equal(nativeName.value, "Draft shortcut");
  assert.equal(picker.value, "mdi:hammer");
  const colorPicker = iconColorInput(editor);
  assert.equal(colorPicker.value, "#008080");
  assert.equal(preview.querySelector(".qap-tile-name").textContent, "Draft shortcut");
  assert.equal(preview.querySelector("qap-icon").style.color, "#008080");
  nativeName.value = "Updated draft";
  await dispatchAndFlush(nativeName, new Event("input"));
  await dispatchAndFlush(
    picker,
    new CustomEvent("value-changed", { detail: { value: "invalid" } }),
  );
  colorPicker.value = "#ff9800";
  await dispatchAndFlush(colorPicker, new Event("input"));
  assert.equal(preview.querySelector(".qap-tile-name").textContent, "Updated draft");
  assert.equal(preview.querySelector("qap-icon").attributes.icon, "mdi:view-grid-outline");
  assert.equal(preview.querySelector("qap-icon").style.color, "#ff9800");
});

test("native icon color selection persists across reloads and applies to previews, tiles, and the settings list", async () => {
  const env = environment();
  nativeComponents(env);
  await openShortcutsSettings("/config", undefined, env);
  await clickAndFlush(env.document.body.querySelector(".qap-add-shortcut"));
  const editor = env.document.body.querySelector(".qap-shortcut-form");
  const colorField = editor.querySelector(".qap-icon-color-field");
  assert.equal(colorField.previousElementSibling, editor.querySelector(".qap-icon-field"));
  const name = editor.querySelectorAll("qap-input").find((field) => field.label === "Name");
  const route = editor.querySelectorAll("qap-input").find((field) => field.label === "URL path");
  name.value = "Colored shortcut";
  route.value = "/config/logs";
  const picker = iconColorInput(editor);
  assert.equal(picker.type, "color");
  picker.value = "#8e24aa";
  await dispatchAndFlush(picker, new Event("input"));
  assert.equal(
    editor.querySelector(".qap-shortcut-preview").querySelector("qap-icon").style.color,
    "#8e24aa",
  );
  assert.equal(env.server.requests.length, 0);
  await clickAndFlush(buttons(editor).find((button) => button.textContent === "Save"));
  assert.equal(
    env.document.body.querySelectorAll(".qap-edit-symbol").at(-1).querySelector("qap-icon").style
      .color,
    "#8e24aa",
  );
  returnToLauncher(env);
  await flush();
  const tile = env.document.body.querySelectorAll(".qap-tile").at(-1);
  assert.equal(tile.querySelector(".qap-tile-name").textContent, "Colored shortcut");
  assert.equal(tile.querySelector("qap-icon").style.color, "#8e24aa");
  const restored = environment(undefined, env.server, { fresh: true });
  nativeComponents(restored);
  for (const [key, value] of env.storage) restored.storage.set(key, value);
  await openShortcutsSettings("/config", undefined, restored);
  await shortcutAction(
    restored,
    "edit",
    restored.document.body.querySelectorAll(".qap-shortcut-overflow").at(-1),
  );
  assert.equal(iconColorInput(restored.document.body).value, "#8e24aa");
  assert.equal(
    restored.document.body.querySelector(".qap-shortcut-preview").querySelector("qap-icon").style
      .color,
    "#8e24aa",
  );
});

test("icon color supports custom colors and clearing the selection restores the theme default", async () => {
  const env = environment();
  nativeComponents(env);
  env.context.getComputedStyle = () => ({ color: "rgb(18, 52, 86)" });
  await openShortcutsSettings("/config", undefined, env);
  await shortcutAction(env);
  for (const color of ["#c678dd", "#0c2238", ""]) {
    const editor = env.document.body.querySelector(".qap-shortcut-form");
    if (color) {
      const picker = iconColorInput(editor);
      picker.value = color;
      await dispatchAndFlush(picker, new Event("input"));
    } else editor.querySelector(".qap-icon-color-reset").click();
    await flush();
    assert.equal(
      editor.querySelector(".qap-shortcut-preview").querySelector("qap-icon").style.color ?? "",
      color ?? "",
    );
    await clickAndFlush(buttons(editor).find((button) => button.textContent === "Save"));
    assert.equal(savedProfile(env).settings.links[0].color, color ?? "");
    await shortcutAction(env);
    assert.equal(iconColorInput(env.document.body).value, color || "#123456");
  }
});

test("the full color picker works without native controls and ignores unsafe stored color strings", async () => {
  for (const initialColor of ["", "url(example)", "red; background: url(example)"]) {
    const env = environment();
    await openShortcutsSettings(
      "/config",
      {
        links: [
          {
            id: "custom",
            name: "Custom",
            type: "internal",
            path: "/config",
            icon: "mdi:hammer",
            color: initialColor,
            group: "favorites",
          },
        ],
      },
      env,
    );
    await shortcutAction(env);
    const editor = env.document.body.querySelector(".qap-shortcut-form");
    const picker = iconColorInput(editor);
    assert.equal(picker.localName, "qap-input");
    assert.equal(picker.type, "color");
    assert.equal(picker.value, "#03a9f4");
    assert.equal(
      editor.querySelector(".qap-shortcut-preview").querySelector("qap-icon").style.color,
      undefined,
    );
    picker.value = "#e53935";
    await dispatchAndFlush(picker, new Event("input"));
    assert.equal(
      editor.querySelector(".qap-shortcut-preview").querySelector("qap-icon").style.color,
      "#e53935",
    );
    await clickAndFlush(buttons(editor).find((button) => button.textContent === "Save"));
    assert.equal(savedProfile(env).settings.links[0].color, "#e53935");
  }
});

test("native shortcut icon editing rejects invalid drafts and saves the corrected icon", async () => {
  const env = environment();
  nativeComponents(env);
  await openShortcutsSettings("/config", undefined, env);
  await shortcutAction(env);
  const editor = env.document.body.querySelector(".qap-shortcut-form");
  const picker = editor.querySelector("qap-icon-picker");
  changeValidationControl(picker, "mdi:Bad");
  await clickAndFlush(buttons(editor).find((button) => button.textContent === "Save"));
  assert.match(
    picker.parentElement.querySelector(".qap-field-error").textContent,
    /Choose a valid shortcut icon/,
  );
  assert.equal(picker.value, "mdi:Bad");
  assert.equal(env.server.requests.length, 0);
  changeValidationControl(picker, " mdi:star-outline ");
  await clickAndFlush(buttons(editor).find((button) => button.textContent === "Save"));
  assert.equal(savedProfile(env).settings.links[0].icon, "mdi:star-outline");
  assert.equal(env.document.body.querySelector(".qap-shortcut-form"), null);
});

test("native shortcut fields save text, group, type, and an icon input when the picker is unavailable", async () => {
  const env = environment();
  const components = nativeComponents(env, false);
  components.register("qap-input", "qap-select");
  env.server.data("test-user").profiles[0].categories.push({ id: "tools", name: "My tools" });
  await openShortcutsSettings("/config/logs", undefined, env);
  await shortcutAction(env);
  const fields = env.document.body.querySelectorAll("qap-input");
  const name = fields.find((field) => field.label === "Name");
  const icon = env.document.body.querySelector("qap-icon-picker");
  const route = fields.find((field) => field.label === "URL path");
  const selects = env.document.body.querySelectorAll("qap-select");
  const type = selects.find((field) => field.label === "Shortcut type");
  const group = selects.find((field) => field.label === "Group");
  assert.ok(group, "Group uses the same native select as Shortcut type");
  const save = buttons(env.document.body).find((button) => button.textContent === "Save");
  assert.equal(name.maxLength, 50);
  assert.equal(route.autocomplete, "off");
  assert.equal(route.spellcheck, false);
  name.value = "";
  await clickAndFlush(save);
  assert.equal(
    name.parentElement.querySelector(".qap-field-error").textContent,
    "Enter a shortcut name.",
  );
  name.value = "My site";
  icon.value = "mdi:hammer";
  await selectAndFlush(type, "external");
  route.value = "/invalid-external-path";
  await clickAndFlush(save);
  assert.equal(
    route.parentElement.querySelector(".qap-field-error").textContent,
    "Enter a full http:// or https:// URL.",
  );
  route.value = "https://example.com";
  await selectAndFlush(group, "category:tools");
  await clickAndFlush(save);
  await confirmMove(env);
  const saved = savedProfile(env).settings.links.find((link) => link.id === defaultLinks[0].id);
  assert.equal(saved.name, "My site");
  assert.equal(saved.icon, "mdi:hammer");
  assert.equal(saved.type, "external");
  assert.equal(saved.path, "https://example.com");
  assert.equal(saved.group, "tools");
  await shortcutAction(
    env,
    "edit",
    env.document.body
      .querySelectorAll(".qap-edit-item")
      .find((item) => item.dataset.id === saved.id)
      .querySelector(".qap-shortcut-overflow"),
  );
  const updatedType = env.document.body
    .querySelectorAll("qap-select")
    .find((field) => field.label === "Shortcut type");
  const updatedRoute = env.document.body
    .querySelectorAll("qap-input")
    .find((field) => field.label === "URL path");
  assert.equal(updatedRoute.value, saved.path);
  await selectAndFlush(updatedType, "quick-states");
  assert.equal(updatedRoute.parentElement.hidden, true);
  await selectAndFlush(updatedType, "internal");
  assert.equal(updatedRoute.parentElement.hidden, false);
});
