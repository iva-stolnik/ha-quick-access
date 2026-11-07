// Profile action menus, counts and owned radios.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const { getEventListeners } = require("node:events");
const test = require("node:test");
const {
  loadDefaults,
  installLocaleFetch,
  changeLanguage,
  flush,
  clickAndFlush,
  defaultCategories,
  defaultSettings,
  clone,
  Element,
  environment,
  nativeComponents,
  buttons,
  startProfiles,
  profileManager,
  profileRowIn,
  activeProfileEditor,
  profileMenuIn,
  profileNameInput,
  chooseProfileCopy,
  profileIconControl,
  setProfileIcon,
} = require("./harness.cjs");
let defaultLinks;
test.before(async () => ({ defaultLinks } = await loadDefaults()));

test("profile menu actions survive touch blur before click with native and fallback controls", async () => {
  for (const [action, title] of [
    ["duplicate", "Duplicate profile"],
    ["delete", "Delete profile"],
  ]) {
    const env = await startProfiles(environment());
    installLocaleFetch(env);
    const manager = await profileManager(env);
    await clickAndFlush(manager.querySelector(".qap-profile-overflow"));
    const popup = profileMenuIn(env);
    assert.deepEqual(
      buttons(popup).map((item) => item.textContent),
      ["Duplicate", "Delete"],
    );
    assert.deepEqual(
      buttons(popup).map((item) => item.value),
      ["duplicate", "delete"],
    );
    assert.equal(
      popup.querySelector(".qap-delete-profile").previousElementSibling.attributes.role,
      "separator",
    );
    await changeLanguage(env, "hr");
    assert.deepEqual(
      buttons(popup).map((item) => item.textContent),
      ["Dupliciraj", "Izbriši"],
    );
    await changeLanguage(env, "en");
    const item = popup.querySelector(`.qap-${action}-profile`);
    // Model the blur-before-click sequence from a touch interaction. A null
    // relatedTarget is not evidence that focus moved outside the menu.
    popup.dispatchEvent(Object.assign(new Event("focusout"), { relatedTarget: null }));
    await clickAndFlush(item);
    const child =
      action === "delete"
        ? env.document.body.querySelector(".qap-delete-profile-confirmation")
        : activeProfileEditor(env);
    assert.ok(child?.open, `${action} should open after touch blur`);
    assert.equal(child.querySelector(".qap-title").textContent, title);
    assert.equal(profileMenuIn(env), null);
    assert.equal(env.server.requests.length, 0);
  }
});

test("Profiles show localized content counts across groups and filter types and omit empty counts", async () => {
  const env = environment();
  installLocaleFetch(env);
  const filters = {
    version: 1,
    states: [
      { id: "favorites", name: "Favorites", hidden: false },
      { id: "all", name: "All", hidden: false },
      {
        id: "custom",
        name: "Custom",
        hidden: true,
        condition: {
          type: "group",
          operator: "and",
          conditions: [{ type: "rule", field: "state", operator: "equals", value: "on" }],
        },
      },
    ],
    devices: [
      { id: "favorites", name: "Favorites", hidden: false },
      { id: "all", name: "All", hidden: false },
    ],
  };
  env.server.data("test-user").profiles.push({
    id: "empty",
    name: "Empty",
    icon: "mdi:devices",
    settings: { ...defaultSettings(), links: [] },
    favorites: ["sensor.favorite"],
    device_favorites: ["device"],
    categories: [...defaultCategories(), { id: "tools", name: "Tools" }],
    filters,
  });
  await startProfiles(env);
  const manager = await profileManager(env);
  const lines = (root) =>
    root.querySelectorAll(".qap-profile-metadata").map((line) => line.textContent);
  assert.deepEqual(lines(profileRowIn(manager, "test-profile")), [
    `${defaultLinks.length} shortcuts`,
    "1 group",
    "11 filters",
  ]);
  assert.deepEqual(lines(profileRowIn(manager, "empty")), ["2 groups", "5 filters"]);
  const profile = clone(env.server.data("test-user").profiles.find((item) => item.id === "empty"));
  profile.settings.links = [
    { ...defaultLinks[0] },
    { ...defaultLinks[1], group: "tools", hidden: true },
  ];
  await env.server.mutate("test-user", {
    operation: "update",
    profile_id: profile.id,
    revision: env.server.data("test-user").revision,
    profile,
  });
  assert.deepEqual(lines(profileRowIn(manager, "empty")), ["2 shortcuts", "2 groups", "5 filters"]);
  await changeLanguage(env, "hr");
  assert.deepEqual(lines(profileRowIn(manager, "empty")), ["2 prečaca", "2 grupe", "5 filtara"]);
  manager.querySelector(".qap-create-profile").click();
  const editor = activeProfileEditor(env);
  chooseProfileCopy(editor);
  const source = editor.querySelector("qap-select") || editor.querySelector("select, qap-select");
  source.value = profile.id;
  source.dispatchEvent(new Event("change"));
  assert.deepEqual(lines(editor.querySelector(".qap-profile-source-summary")), [
    "2 prečaca",
    "2 grupe",
    "5 filtara",
  ]);
});

test("Profiles uses grouped semantic rows, owned action menus and existing form controls", async () => {
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
  assert.equal(profileRowIn(manager, "test-profile").localName, "div");
  assert.equal(profileRowIn(manager, "other").attributes.role, undefined);
  assert.equal(
    profileRowIn(manager, "other").querySelector(".qap-profile-activate").localName,
    "qap-button",
  );
  assert.equal(
    profileRowIn(manager, "other").querySelector(".qap-profile-content").localName,
    "button",
  );
  assert.equal(manager.querySelector(".qap-settings-footer"), null);
  const create = manager.querySelector(".qap-head-actions").querySelector(".qap-create-profile");
  assert.equal(create.localName, "qap-icon-button");
  assert.equal(create.querySelector("qap-icon").attributes.icon, "mdi:plus");
  const trigger = manager.querySelector(".qap-profile-overflow");
  await clickAndFlush(trigger);
  const popup = profileMenuIn(env);
  assert.equal(popup.localName, "qap-menu");
  assert.equal(popup.querySelector(".qap-delete-profile").localName, "qap-menu-item");
  assert.equal(popup.anchorElement, trigger);
  assert.equal(popup.placement, "bottom-end");
  assert.equal(popup.open, true);
  assert.equal(popup.querySelector(".qap-edit-profile"), null, "editing is the row's main action");
  assert.equal(popup.querySelector(".qap-duplicate-profile").children[0].slot, "icon");
  assert.equal(popup.querySelector(".qap-delete-profile").attributes.variant, "danger");
  assert.equal(popup.querySelector(".qap-profile-menu-divider").localName, "div");
  assert.equal(popup.style.left, undefined, "HA controls native popup placement");
  assert.equal(getEventListeners(env.document, "focusin").length, 0);
  assert.equal(
    getEventListeners(popup, "keydown").length,
    0,
    "HA handles native menu keyboard events",
  );
  trigger.click();
  manager.querySelector(".qap-create-profile").click();
  const editor = activeProfileEditor(env);
  assert.equal(profileNameInput(editor).localName, "qap-input");
  assert.equal(profileIconControl(editor).localName, "qap-icon-picker");
  const choices = editor.querySelector(".qap-profile-start");
  const group = choices.querySelector("qap-radio-group");
  assert.equal(group.label, "Start with");
  assert.equal(group.value, "default");
  assert.equal(group.querySelectorAll("qap-radio-option").length, 2);
  assert.equal(choices.querySelector("input, qap-input"), null);
  chooseProfileCopy(editor);
  assert.equal(editor.querySelector(".qap-profile-source").hidden, false);
});

test("owned action menus persist through a tap, open their action and reopen after cancel", async () => {
  const env = environment();
  await startProfiles(env);
  const manager = await profileManager(env);
  const trigger = manager.querySelector(".qap-profile-overflow");
  await clickAndFlush(trigger);
  const popup = profileMenuIn(env);
  assert.equal(popup.localName, "qap-menu");
  assert.equal(popup.querySelector(".qap-duplicate-profile").localName, "qap-menu-item");
  await flush();
  assert.equal(profileMenuIn(env), popup, "the menu must not be replaced during a tap");
  await clickAndFlush(popup.querySelector(".qap-duplicate-profile"));
  assert.equal(
    activeProfileEditor(env).querySelector(".qap-title").textContent,
    "Duplicate profile",
  );
  activeProfileEditor(env).querySelector(".qap-profile-cancel").click();
  await clickAndFlush(trigger);
  assert.equal(profileMenuIn(env).localName, "qap-menu");
  assert.equal(env.server.requests.length, 0);
});

test("menu actions wait for hide completion and cannot reopen dialogs after navigation or unload", async () => {
  for (const exit of ["select", "outside", "toggle", "scroll", "resize", "navigate", "disable"]) {
    const env = environment();
    nativeComponents(env);
    await startProfiles(env);
    const manager = await profileManager(env);
    const trigger = manager.querySelector(".qap-profile-overflow");
    const pointerListeners = getEventListeners(env.document, "pointerdown").length;
    const resizeListeners = getEventListeners(env.window, "resize").length;
    await clickAndFlush(trigger);
    const popup = profileMenuIn(env);
    assert.equal(getEventListeners(env.document, "pointerdown").length, pointerListeners);
    if (["select", "navigate", "disable"].includes(exit)) {
      const invalidItem = new Element("ha-dropdown-item");
      invalidItem.value = "delete";
      popup.dispatchEvent(new CustomEvent("wa-select", { detail: { item: invalidItem } }));
      assert.equal(popup.open, true, "items from another menu are ignored");
      popup.querySelector(".qap-duplicate-profile").click();
      assert.equal(popup.open, false);
      assert.equal(
        activeProfileEditor(env),
        undefined,
        "the editor must wait for the menu to finish closing",
      );
    }
    if (exit === "outside") popup.open = false;
    if (exit === "toggle") trigger.click();
    if (exit === "scroll")
      env.document.body.querySelector(".qap-body").dispatchEvent(new Event("scroll"));
    if (exit === "resize") env.window.dispatchEvent(new Event("resize"));
    if (exit === "navigate") {
      env.context.location.pathname = "/config/logs";
      env.window.dispatchEvent(new Event("location-changed"));
    }
    if (exit === "disable") env.enable(false);
    await flush();
    assert.equal(profileMenuIn(env), null);
    assert.equal(Boolean(activeProfileEditor(env)), exit === "select");
    assert.equal(trigger.attributes["aria-expanded"], "false");
    assert.equal(
      getEventListeners(env.window, "resize").length,
      exit === "disable" ? 0 : resizeListeners,
    );
    assert.equal(env.server.requests.length, 0);
  }
});

test("owned radios preserve source and icon drafts without native HA registration", async () => {
  for (const empty of [false, true]) {
    const env = environment();
    const components = nativeComponents(env, false);
    await startProfiles(env);
    await profileManager(env);
    if (empty) {
      env.server.data("test-user").profiles = [];
      env.server.data("test-user").revision++;
      env.server.notify("test-user");
    }
    env.document.body.querySelector("qap-dialog").querySelector(".qap-create-profile").click();
    const editor = activeProfileEditor(env);
    profileNameInput(editor).value = "Draft profile";
    if (!empty) chooseProfileCopy(editor);
    setProfileIcon(editor, "mdi:cat");
    await flush();
    const group = editor.querySelector("qap-radio-group");
    assert.equal(group.value, empty ? "default" : "copy");
    assert.equal(group.querySelectorAll("qap-radio-option")[1].disabled, empty);
    assert.equal(editor.querySelector(".qap-profile-source").hidden, empty);
    assert.equal(profileNameInput(editor).value, "Draft profile");
    assert.equal(profileIconControl(editor).value, "mdi:cat");
    group.value = "copy";
    group.dispatchEvent(new Event("change"));
    assert.equal(group.value, empty ? "default" : "copy");
    assert.equal(editor.querySelector(".qap-profile-source").hidden, empty);
    assert.equal(env.server.requests.length, 0);
  }
});
