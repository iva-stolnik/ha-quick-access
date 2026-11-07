// Language changes in launcher, editors, FAB and entity states.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  installLocaleFetch,
  trackLocalizationBindings,
  changeLanguage,
  panelEnvironment,
  flush,
  clone,
  savedProfile,
  environment,
  openEntityStates,
  nativeComponents,
  respondToDiscard,
  scrollStates,
  largeStates,
  openSettings,
  openShortcutsSettings,
  startProfiles,
  profileManager,
  activeProfileEditor,
  profileNameInput,
  manageProfile,
} = require("./harness.cjs");

test("localization: first-run label and setup copy update in place", async () => {
  const env = environment(undefined, undefined, { fresh: true });
  installLocaleFetch(env);
  await startProfiles(env, false);
  const label = env.fab().querySelector(".qap-fab-setup-label");
  env.fab().click();
  const manager = env.document.body.querySelector("qap-dialog");
  await changeLanguage(env, "hr-HR");
  assert.equal(env.fab().querySelector(".qap-fab-setup-label"), label);
  assert.equal(label.textContent, "Postavi Quick Access");
  assert.equal(manager.headerTitle, "Postavi Quick Access");
  assert.equal(
    manager.querySelector(".qap-settings-desc").textContent,
    "Započnite s prečacima do svojih entiteta i uređaja. Prilagodite ih kad god želite.",
  );
  assert.equal(
    manager.querySelector(".qap-create-default-profile").textContent,
    "Započni sa zadanim postavkama",
  );
});

test("localization: launcher updates in place and keeps visibility drafts and subscriptions", async () => {
  const env = environment();
  installLocaleFetch(env);
  await openSettings("/lovelace/home", null, env);
  const body = env.document.body;
  const dialog = body.querySelector(".qap-settings-dialog");
  const routes = body.querySelector("textarea");
  const [currentPage, subpages] = body.querySelectorAll(".qap-current-url-action");
  routes.value = "/unsaved/*";
  routes.dispatchEvent(new Event("input"));
  const subscriptions = [...env.server.listeners];
  const selected = env.window.quickAccessDebug().activeProfileId;
  const writes = env.server.requests.length;
  await changeLanguage(env, "hr-HR");
  assert.equal(body.querySelector(".qap-settings-dialog"), dialog);
  assert.equal(body.querySelector("textarea"), routes);
  assert.equal(routes.value, "/unsaved/*");
  assert.equal(currentPage.querySelector("span").textContent, "Dodaj");
  assert.equal(subpages.querySelector("span").textContent, "Dodaj");
  assert.equal(env.fab().attributes["aria-label"], "Otvori Quick Access");
  assert.equal(env.window.quickAccessDebug().activeProfileId, selected);
  assert.deepEqual([...env.server.listeners], subscriptions);
  assert.equal(env.server.requests.length, writes);
  await changeLanguage(env, "en-US");
  assert.equal(routes.value, "/unsaved/*");
});

test("localization: shortcut inputs, native options, errors and previews update without losing drafts", async () => {
  const env = environment();
  nativeComponents(env);
  installLocaleFetch(env);
  await openShortcutsSettings("/lovelace/home", null, env);
  const descriptions = () =>
    env.document.body
      .querySelectorAll(".qap-edit-texts")
      .map((element) => element.querySelector("small").textContent);
  const savedSettings = clone(savedProfile(env).settings);
  assert.ok(descriptions().includes("Entity Explorer"));
  assert.ok(descriptions().includes("Device Explorer"));
  await changeLanguage(env, "hr-HR");
  assert.ok(descriptions().includes("Preglednik entiteta"));
  assert.ok(descriptions().includes("Preglednik uređaja"));
  await changeLanguage(env, "en");
  assert.deepEqual(savedProfile(env).settings, savedSettings);
  env.document.body.querySelector(".qap-add-shortcut").click();
  const form = env.document.body.querySelector(".qap-shortcut-form");
  const name = form.querySelector("qap-input");
  name.value = "My Save shortcut";
  name.dispatchEvent(new Event("input"));
  const select = form.querySelector("qap-select");
  const selection = select.value;
  assert.equal(
    select.options.find((option) => option.value === "quick-states").label,
    "Entity Explorer",
  );
  assert.equal(
    select.options.find((option) => option.value === "quick-devices").label,
    "Device Explorer",
  );
  await changeLanguage(env, "hr-HR");
  assert.equal(env.document.body.querySelector(".qap-shortcut-form"), form);
  assert.equal(name.value, "My Save shortcut");
  assert.equal(name.placeholder, "npr. Automatizacije");
  assert.equal(
    form.querySelector(".qap-shortcut-preview").attributes["aria-label"],
    "Pretpregled prečaca: My Save shortcut",
  );
  assert.equal(select.value, selection);
  assert.equal(select.options[0].label, "Putanja u sustavu Home Assistant");
  assert.equal(
    select.options.find((option) => option.value === "quick-states").label,
    "Preglednik entiteta",
  );
  assert.equal(
    select.options.find((option) => option.value === "quick-devices").label,
    "Preglednik uređaja",
  );
  name.value = "";
  form.querySelector(".qap-form-actions").querySelector(".qap-button-primary").click();
  assert.equal(form.querySelector(".qap-field-error").textContent, "Unesite naziv prečaca.");
  await changeLanguage(env, "en");
  assert.equal(form.querySelector(".qap-field-error").textContent, "Enter a shortcut name.");
});

test("localization: profile editor retains its dialog, draft, profile selection and user names", async () => {
  const env = await startProfiles(environment());
  installLocaleFetch(env);
  const editor = await manageProfile(env, "test-profile", "edit");
  const name = profileNameInput(editor);
  name.value = "Custom draft";
  const selected = env.window.quickAccessDebug().activeProfileId;
  const subscriptions = [...env.server.listeners];
  await changeLanguage(env, "hr-HR");
  assert.equal(activeProfileEditor(env), editor);
  assert.equal(profileNameInput(editor), name);
  assert.equal(name.value, "Custom draft");
  assert.equal(editor.querySelector(".qap-title").textContent, "Uredi profil");
  assert.equal(
    editor.querySelector(".qap-profile-close").attributes["aria-label"],
    "Zatvori uređivanje profila",
  );
  assert.equal(editor.querySelector(".qap-profile-submit").textContent, "Spremi");
  assert.equal(env.window.quickAccessDebug().activeProfileId, selected);
  assert.deepEqual([...env.server.listeners], subscriptions);
  assert.equal(env.server.data("test-user").profiles[0].name, "Default");
  editor.querySelector(".qap-profile-close").click();
  respondToDiscard(env);
  const duplicate = await manageProfile(env, "test-profile", "duplicate");
  assert.equal(profileNameInput(duplicate).value, "Default (kopija)");
  await changeLanguage(env, "en");
  assert.equal(profileNameInput(duplicate).value, "Default (kopija)");
});

test("localization: language changes retain FAB keyboard positioning and its accessible instructions", async () => {
  const env = await startProfiles(environment());
  installLocaleFetch(env);
  const fab = env.fab();
  fab.dispatchEvent(
    Object.assign(new Event("keydown", { cancelable: true }), { key: "Enter", shiftKey: true }),
  );
  env.document.body.querySelector(".qap-menu-action").click();
  fab.dispatchEvent(
    Object.assign(new Event("keydown", { cancelable: true }), { key: "ArrowRight" }),
  );
  const position = { ...fab.style };
  const writes = env.server.requests.length;
  await changeLanguage(env, "hr-HR");
  assert.equal(env.fab(), fab);
  assert.ok(fab.className.includes("qap-positioning"));
  assert.deepEqual(fab.style, position);
  assert.match(fab.attributes["aria-description"], /^Namještanje položaja/);
  assert.equal(env.server.requests.length, writes);
  fab.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" }));
  assert.ok(!fab.className.includes("qap-positioning"));
  assert.match(fab.attributes["aria-description"], /^Enter ili razmak/);
});

test("localization: closing editors releases bindings before DOM collection before native close animations finish", async () => {
  const env = environment();
  const bindingCount = trackLocalizationBindings(env);
  nativeComponents(env);
  await startProfiles(env);
  await profileManager(env);
  const baseline = bindingCount();
  for (let index = 0; index < 3; index++) {
    const editor = await manageProfile(env, "test-profile", "edit");
    assert.ok(bindingCount() > baseline);
    editor.querySelector(".qap-profile-close").click();
    assert.equal(bindingCount(), baseline);
    // Native dialogs can remain mounted during their close animation.
    editor.dispatchEvent(new Event("closed"));
  }
  env.enable(false);
  await flush();
  assert.equal(bindingCount(), 0);
  env.enable(true);
  await flush();
  assert.ok(bindingCount() > 0);
});

test("localization: scrolling virtual entity rows keeps binding counts bounded", async () => {
  const env = environment();
  const bindingCount = trackLocalizationBindings(env);
  env.status.hass.states = largeStates(10000);
  await openEntityStates(env);
  const list = env.document.body.querySelector(".qap-state-list");
  const baseline = bindingCount();
  for (let index = 0; index < 100; index++) {
    await scrollStates(env, index * 5000);
    assert.ok(bindingCount() <= baseline + 40, `registered targets: ${bindingCount()}`);
  }
  const firstWindowCount = bindingCount();
  await scrollStates(env, 0);
  const firstRow = list.querySelector(".qap-state-row");
  const oldName = firstRow.querySelector(".qap-state-name");
  await scrollStates(env, 5000);
  assert.equal(firstRow.isConnected, false);
  env.status.hass.formatEntityName = () => "Current translated name";
  installLocaleFetch(env);
  await changeLanguage(env, "hr-HR");
  assert.equal(oldName.textContent, "Entity 0", "removed rows must no longer be refreshed");
  assert.equal(list.querySelector(".qap-state-name").textContent, "Current translated name");
  assert.ok(bindingCount() <= firstWindowCount + 40);
  env.enable(false);
  await flush();
  assert.equal(bindingCount(), 0);
});

test("localization: device options and confirmations release bindings and translate after reconnect", async () => {
  const env = panelEnvironment();
  const bindingCount = trackLocalizationBindings(env);
  installLocaleFetch(env);
  await startProfiles(env);
  const panel = await env.mountPanel();
  await flush();
  const baseline = bindingCount();
  for (let index = 0; index < 20; index++) {
    panel._renderDevice();
    panel._removeSelection.click();
    assert.ok(bindingCount() > baseline);
    panel._closeConfirmation();
    assert.equal(bindingCount(), baseline);
  }
  await changeLanguage(env, "hr-HR", panel);
  assert.equal(panel._removeSelection.textContent, "Ukloni odabir profila iz ovog preglednika");
  panel.remove();
  panel.disconnectedCallback();
  env.document.body.append(panel);
  panel.connectedCallback();
  await changeLanguage(env, "en", panel);
  assert.equal(panel._removeSelection.textContent, "Remove profile selection from this browser");
});

test("localization: entity states use HA formatting and keep open detail dialogs when language changes", async () => {
  const env = environment();
  installLocaleFetch(env);
  env.status.hass.states = {
    "light.test": {
      entity_id: "light.test",
      state: "on",
      attributes: { friendly_name: "Custom name" },
    },
  };
  env.status.hass.formatEntityState = (state) =>
    `${env.status.hass.language === "hr-HR" ? "Uključeno" : "On"} (${state.state})`;
  env.status.hass.formatEntityName = (state) =>
    env.status.hass.language === "hr-HR" ? "Prevedeno ime" : state.entity_id;
  const search = await openEntityStates(env);
  const summary = env.document.body.querySelector(".qap-state-summary");
  summary.click();
  const modal = env.document.body.querySelector(".qap-state-modal");
  assert.equal(modal.querySelector(".qap-state-dialog-value").textContent, "On (on)");
  const row = env.document.body.querySelector(".qap-state-row");
  assert.equal(row.querySelector(".qap-state-name").textContent, "light.test");
  assert.equal(row.querySelector(".qap-state-id").hidden, true);
  await changeLanguage(env, "hr-HR");
  assert.equal(env.document.body.querySelector(".qap-state-modal"), modal);
  const smartLabels = () =>
    env.document.body
      .querySelector(".qap-state-tabs")
      .children.filter((chip) =>
        ["unavailable", "unknown", "low_battery", "updates"].includes(chip.dataset.domain),
      )
      .map((chip) => chip.textContent);
  assert.deepEqual(smartLabels(), ["Nedostupno", "Nepoznato", "Slaba baterija", "Ažuriranja"]);
  assert.equal(env.document.body.querySelector(".qap-state-row"), row);
  assert.equal(modal.querySelector(".qap-state-dialog-value").textContent, "Uključeno (on)");
  assert.equal(row.querySelector(".qap-state-value").textContent, "Uključeno (on)");
  assert.equal(row.querySelector(".qap-state-name").textContent, "Prevedeno ime");
  assert.equal(row.querySelector(".qap-state-id").hidden, false);
  assert.equal(modal.querySelector(".qap-state-dialog-name").textContent, "Custom name");
  assert.equal(
    modal.querySelector(".qap-state-dialog-favorite").attributes["aria-label"],
    "Dodaj u favorite",
  );
  search.value = "Prevedeno";
  search.dispatchEvent(new Event("input"));
  await env.tick(175);
  assert.equal(env.document.body.querySelector(".qap-state-row"), row);
  await changeLanguage(env, "en");
  assert.deepEqual(smartLabels(), ["Unavailable", "Unknown", "Low battery", "Updates"]);
  await env.tick(3500);
  assert.equal(env.document.body.querySelectorAll(".qap-state-row").length, 0);
});
