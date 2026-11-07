// Saved filter shortcuts and filter deletion with linked shortcuts.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  installLocaleFetch,
  changeLanguage,
  flush,
  clickAndFlush,
  dispatchAndFlush,
  clone,
  filterDefinitions,
  filterField,
  filterAction,
  editNewFilter,
  setFilterField,
  savedProfile,
  environment,
  openEntityStates,
  openDevices,
  installDeviceRegistries,
  nativeComponents,
  buttons,
  iconColorInput,
  navigationEnvironment,
  openShortcutsSettings,
  changeValidationControl,
  startProfiles,
  profileMenuIn,
  shortcutAction,
  categorySelect,
  selectAndFlush,
  selectionKey,
  storageEvent,
  createModuleLoader,
} = require("./harness.cjs");

test("saved filter snapshot validation rejects malformed references while allowing unavailable IDs to be repaired", async () => {
  const env = environment();
  savedProfile(env).settings.links.push({
    id: "pin",
    name: "Pin",
    icon: "mdi:pin",
    color: "",
    group: "favorites",
    type: "saved-filter",
    path: "",
    filterKind: "states",
    filterId: "missing",
  });
  const loader = createModuleLoader(env.context);
  const { createLocalizer } = await loader.load("localize.js");
  const { createProfileValidation } = await loader.load("profiles/profile-validation.js");
  const { validateProfileData } = createProfileValidation(createLocalizer());
  const data = clone(env.server.data("test-user"));
  assert.deepEqual(clone(validateProfileData(data)), data);
  for (const change of [
    { filterId: "temporary" },
    { filterId: "" },
    { filterId: [] },
    { filterKind: "other" },
    { filterKind: null },
    { path: "/" },
    { rules: [] },
    { type: "quick-states" },
  ]) {
    const invalid = clone(data);
    Object.assign(invalid.profiles[0].settings.links.at(-1), change);
    assert.throws(() => validateProfileData(invalid));
  }
});

test(`saved filter shortcut colors inherit until overridden and persist independently`, async () => {
  const env = environment();
  const definitions = await filterDefinitions(env);
  savedProfile(env).filters = clone(definitions.profileFilters());
  savedProfile(env).filters.states.find((item) => item.id === "unknown").color = "#8e24aa";
  savedProfile(env).filters.devices.find((item) => item.id === "all").color = "teal";
  await openShortcutsSettings("/config/logs", undefined, env);
  await clickAndFlush(env.document.body.querySelector(".qap-add-shortcut"));
  let editor = env.document.body.querySelector(".qap-shortcut-form");
  const previewColor = () =>
    editor.querySelector(".qap-shortcut-preview").querySelector("qap-icon").style.color ?? "";
  await setFilterField(editor, "Shortcut type", "saved-filter");
  assert.equal(previewColor(), "", "filters without a color retain the theme default");
  await setFilterField(editor, "Filter", "unknown");
  assert.equal(iconColorInput(editor).value, "#8e24aa");
  assert.equal(previewColor(), "#8e24aa");
  await setFilterField(editor, "Filter type", "devices");
  await setFilterField(editor, "Filter", "all");
  assert.equal(previewColor(), "var(--teal-color)");
  await setFilterField(editor, "Filter type", "states");
  assert.equal(previewColor(), "");
  await setFilterField(editor, "Filter", "unknown");
  await clickAndFlush(buttons(editor).find((item) => item.textContent === "Save"));
  const inherited = clone(savedProfile(env).settings.links.at(-1));
  assert.equal(inherited.color, "#8e24aa");
  assert.equal(
    env.document.body.querySelectorAll(".qap-edit-symbol").at(-1).querySelector("qap-icon").style
      .color,
    "#8e24aa",
  );

  const row = () =>
    env.document.body
      .querySelectorAll(".qap-edit-item")
      .find((item) => item.dataset.id === inherited.id);
  await shortcutAction(env, "edit", row().querySelector(".qap-shortcut-overflow"));
  editor = env.document.body.querySelector(".qap-shortcut-form");
  await setFilterField(editor, "Filter type", "devices");
  await setFilterField(editor, "Filter", "all");
  assert.equal(previewColor(), "#8e24aa", "editing never replaces a stored shortcut color");
  iconColorInput(editor).value = "#abcdef";
  await dispatchAndFlush(iconColorInput(editor), new Event("input"));
  await setFilterField(editor, "Filter type", "states");
  await setFilterField(editor, "Filter type", "devices");
  await setFilterField(editor, "Filter", "all");
  assert.equal(previewColor(), "#abcdef");
  await clickAndFlush(buttons(editor).find((item) => item.textContent === "Save"));
  assert.equal(savedProfile(env).settings.links.at(-1).color, "#abcdef");

  const updated = clone(savedProfile(env));
  updated.filters.devices.find((item) => item.id === "all").color = "#112233";
  await env.server.mutate("test-user", {
    operation: "update",
    profile_id: updated.id,
    profile: updated,
    revision: env.server.data("test-user").revision,
  });
  await flush();
  assert.equal(savedProfile(env).settings.links.at(-1).color, "#abcdef");
  await shortcutAction(env, "duplicate", row().querySelector(".qap-shortcut-overflow"));
  assert.equal(savedProfile(env).settings.links.at(-1).color, "#abcdef");

  const restored = environment(undefined, env.server, { fresh: true });
  for (const [key, value] of env.storage) restored.storage.set(key, value);
  await openShortcutsSettings("/config/logs", undefined, restored);
  await shortcutAction(
    restored,
    "edit",
    restored.document.body.querySelectorAll(".qap-shortcut-overflow").at(-1),
  );
  assert.equal(iconColorInput(restored.document.body).value, "#abcdef");
});

for (const override of ["#abcdef", ""]) {
  test(`new saved filter shortcuts retain an explicit color override (${override || "theme"})`, async () => {
    const env = environment();
    const definitions = await filterDefinitions(env);
    savedProfile(env).filters = clone(definitions.profileFilters());
    savedProfile(env).filters.states.find((item) => item.id === "unknown").color = "#8e24aa";
    await openShortcutsSettings("/config/logs", undefined, env);
    await clickAndFlush(env.document.body.querySelector(".qap-add-shortcut"));
    const editor = env.document.body.querySelector(".qap-shortcut-form");
    await setFilterField(editor, "Shortcut type", "saved-filter");
    await setFilterField(editor, "Filter", "unknown");
    if (override) {
      iconColorInput(editor).value = override;
      await dispatchAndFlush(iconColorInput(editor), new Event("input"));
    } else await clickAndFlush(editor.querySelector(".qap-icon-color-reset"));
    await setFilterField(editor, "Filter type", "devices");
    await setFilterField(editor, "Filter type", "states");
    await setFilterField(editor, "Filter", "unknown");
    assert.equal(
      editor.querySelector(".qap-shortcut-preview").querySelector("qap-icon").style.color ?? "",
      override,
    );
    await clickAndFlush(buttons(editor).find((item) => item.textContent === "Save"));
    const saved = savedProfile(env).settings.links.at(-1);
    assert.equal(saved.color, override);
    const row = env.document.body
      .querySelectorAll(".qap-edit-item")
      .find((item) => item.dataset.id === saved.id);
    await shortcutAction(env, "edit", row.querySelector(".qap-shortcut-overflow"));
    const reopened = env.document.body.querySelector(".qap-shortcut-form");
    await setFilterField(reopened, "Filter type", "devices");
    await setFilterField(reopened, "Filter type", "states");
    await setFilterField(reopened, "Filter", "unknown");
    assert.equal(
      reopened.querySelector(".qap-shortcut-preview").querySelector("qap-icon").style.color ?? "",
      override,
    );
    await clickAndFlush(buttons(reopened).find((item) => item.textContent === "Save"));
    assert.equal(savedProfile(env).settings.links.at(-1).color, override);
  });
}

test(`saved filter shortcuts select active and hidden filters and keep customized names and icons`, async () => {
  const env = environment();
  const definitions = await filterDefinitions(env);
  savedProfile(env).filters = clone(definitions.profileFilters());
  for (const filter of savedProfile(env).filters.states) {
    if (["all", "favorites", "unknown"].includes(filter.id)) filter.hidden = true;
    if (filter.id === "unknown") filter.icon = "mdi:alert";
  }
  await openShortcutsSettings("/config/logs", undefined, env);
  await clickAndFlush(env.document.body.querySelector(".qap-add-shortcut"));
  const editor = env.document.body.querySelector(".qap-shortcut-form");
  await setFilterField(editor, "Shortcut type", "saved-filter");
  assert.equal(filterField(editor, "Filter type").value, "states");
  const choice = filterField(editor, "Filter");
  assert.equal(choice.localName, categorySelect(editor).localName);
  assert.equal(choice.localName, "qap-select");
  const ids = Array.from(choice.options, (option) => option.value);
  assert.ok(!ids.includes("all") && !ids.includes("favorites"));
  assert.equal(ids.at(-1), "unknown");
  assert.deepEqual(
    [...new Set(Array.from(choice.options, (option) => option.group))],
    ["Active filters", "Hidden filters"],
  );
  await selectAndFlush(choice, "unknown");
  assert.equal(filterField(editor, "Name").value, "Unknown");
  const icon = editor
    .querySelector(".qap-icon-field")
    .querySelector("qap-icon-picker, qap-input, input");
  assert.equal(icon.value, "mdi:alert");
  await setFilterField(editor, "Name", "Pinned issues");
  await changeValidationControl(icon, "mdi:pin");
  await setFilterField(editor, "Filter type", "devices");
  await setFilterField(editor, "Filter type", "states");
  await setFilterField(editor, "Filter", "unknown");
  assert.equal(filterField(editor, "Name").value, "Pinned issues");
  assert.equal(icon.value, "mdi:pin");
  await clickAndFlush(buttons(editor).find((item) => item.textContent === "Save"));
  const link = savedProfile(env).settings.links.at(-1);
  assert.deepEqual(
    { ...link, id: "saved" },
    {
      id: "saved",
      name: "Pinned issues",
      icon: "mdi:pin",
      color: "",
      group: "favorites",
      type: "saved-filter",
      path: "",
      filterKind: "states",
      filterId: "unknown",
    },
  );
  const row = env.document.body
    .querySelectorAll(".qap-edit-item")
    .find((item) => item.dataset.id === link.id);
  await shortcutAction(env, "edit", row.querySelector(".qap-shortcut-overflow"));
  const editChoice = filterField(env.document.body.querySelector(".qap-shortcut-form"), "Filter");
  assert.equal(editChoice.localName, choice.localName);
  assert.equal(editChoice.value, "unknown");
});

test("saved filter shortcut creation switches to the eligible kind and disables saving when both collections are empty", async () => {
  for (const available of ["devices", null]) {
    const env = environment();
    installDeviceRegistries(env);
    const definitions = await filterDefinitions(env);
    const filters = clone(definitions.profileFilters());
    for (const kind of ["states", "devices"])
      filters[kind] = filters[kind]
        .filter((item) => ["all", "favorites"].includes(item.id))
        .map((item) => ({ ...item, hidden: kind !== available }));
    savedProfile(env).filters = filters;
    await openShortcutsSettings("/config/logs", undefined, env);
    await clickAndFlush(env.document.body.querySelector(".qap-add-shortcut"));
    const editor = env.document.body.querySelector(".qap-shortcut-form");
    await setFilterField(editor, "Shortcut type", "saved-filter");
    assert.equal(filterField(editor, "Filter type").value, available || "states");
    const save = buttons(editor).find((item) => item.textContent === "Save");
    assert.equal(Boolean(save.disabled), !available);
    if (!available)
      assert.match(
        editor.querySelector(".qap-shortcut-filters").querySelector(".qap-muted").textContent,
        /No saved filters are available/,
      );
    if (available) {
      await clickAndFlush(save);
      assert.equal(savedProfile(env).settings.links.at(-1).filterKind, "devices");
      await clickAndFlush(env.document.body.querySelector(".qap-head-button"));
      await clickAndFlush(env.document.body.querySelector(".qap-head-button"));
      await clickAndFlush(
        env.document.body
          .querySelectorAll(".qap-tile")
          .find((item) => item.querySelector(".qap-tile-name")?.textContent === "Favorites"),
      );
      assert.equal(env.document.body.querySelector("qap-dialog").headerTitle, "Device Explorer");
    } else {
      await setFilterField(editor, "Shortcut type", "internal");
      assert.equal(save.disabled, false);
    }
  }
});

test("saved filter shortcuts resolve live profile rules, hidden system filters and Back/Forward without changing tile metadata", async () => {
  const env = navigationEnvironment();
  const definitions = await filterDefinitions(env);
  const profile = savedProfile(env);
  profile.filters = clone(definitions.profileFilters());
  profile.settings.links.push({
    id: "issues-pin",
    name: "Pinned issues",
    icon: "mdi:pin",
    color: "",
    group: "favorites",
    type: "saved-filter",
    path: "",
    filterKind: "states",
    filterId: "unknown",
  });
  profile.filters.states.find((item) => item.id === "all").hidden = true;
  profile.settings.links.push({
    ...profile.settings.links.at(-1),
    id: "all-pin",
    name: "Everything",
    filterId: "all",
  });
  env.status.hass.entities = {};
  env.status.hass.devices = {};
  env.status.hass.areas = {};
  env.status.hass.states = {
    "sensor.one": { entity_id: "sensor.one", state: "unknown", attributes: {} },
    "sensor.two": { entity_id: "sensor.two", state: "unavailable", attributes: {} },
  };
  await startProfiles(env);
  await clickAndFlush(env.fab());
  const tile = (name) =>
    env.document.body
      .querySelectorAll(".qap-tile")
      .find((item) => item.querySelector(".qap-tile-name")?.textContent === name);
  await clickAndFlush(tile("Pinned issues"));
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "1 entity");
  const updated = clone(savedProfile(env));
  const filter = updated.filters.states.find((item) => item.id === "unknown");
  Object.assign(filter, {
    name: "All problems",
    icon: "mdi:alert",
    hidden: true,
    condition: definitions.group([definitions.rule("state", "any_of", ["unknown", "unavailable"])]),
  });
  await env.server.mutate("test-user", {
    operation: "update",
    profile_id: updated.id,
    profile: updated,
    revision: env.server.data("test-user").revision,
  });
  await flush();
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "2 entities");
  assert.equal(
    savedProfile(env).settings.links.find((item) => item.id === "issues-pin").name,
    "Pinned issues",
  );
  assert.equal(
    savedProfile(env).settings.links.find((item) => item.id === "issues-pin").icon,
    "mdi:pin",
  );
  await env.back();
  assert.ok(tile("Pinned issues"));
  await env.forward();
  assert.equal(
    env.document.body
      .querySelector(".qap-state-tabs")
      .children.find((item) => item.dataset.domain === "unknown").textContent,
    "All problems",
  );
  await env.back();
  await clickAndFlush(tile("Everything"));
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "2 entities");
  assert.equal(
    env.document.body
      .querySelector(".qap-state-tabs")
      .children.find((item) => item.dataset.domain === "all").attributes["aria-pressed"],
    "true",
  );
  await env.back();
  env.server
    .data("test-user")
    .profiles.push({ ...clone(savedProfile(env)), id: "other", name: "Other" });
  env.server.data("test-user").revision++;
  env.server.notify("test-user");
  env.storage.set(selectionKey(), JSON.stringify("other"));
  storageEvent(env, selectionKey());
  await env.settle();
  assert.equal(env.window.quickAccessDebug().activeProfileId, "other");
  await env.forward();
  assert.equal(
    env.document.body.querySelector(".qap-states"),
    null,
    "Forward does not resolve the old profile's filter in another profile",
  );
  assert.ok(tile("Everything"));
});

test("filter deletion confirms linked names and commits one profile mutation, preserving both records on failure or conflict", async () => {
  const env = environment();
  const definitions = await filterDefinitions(env);
  const profile = savedProfile(env);
  profile.filters = clone(definitions.profileFilters());
  profile.filters.states.find((item) => item.id === "all").hidden = true;
  for (const [id, name] of [
    ["pin1", "First pin"],
    ["pin2", "Second pin"],
  ])
    profile.settings.links.push({
      id,
      name,
      icon: "mdi:pin",
      color: "",
      group: "favorites",
      type: "saved-filter",
      path: "",
      filterKind: "states",
      filterId: "unknown",
    });
  profile.settings.links.push({
    ...profile.settings.links.at(-1),
    id: "device-pin",
    filterKind: "devices",
    filterId: "all",
  });
  env.server.data("test-user").profiles.push({ ...clone(profile), id: "other", name: "Other" });
  env.status.hass.entities = {};
  env.status.hass.devices = {};
  env.status.hass.areas = {};
  await startProfiles(env);
  await clickAndFlush(env.fab());
  await clickAndFlush(
    env.document.body
      .querySelectorAll(".qap-tile")
      .find((item) => item.querySelector(".qap-tile-name")?.textContent === "First pin"),
  );
  await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
  let panel = env.document.body.querySelector(".qap-filter-panel");
  const confirm = async (names = ["First pin", "Second pin"]) => {
    await filterAction(env, panel, "Unknown", "delete");
    const modal = env.document.body.querySelector(".qap-delete-filter-confirmation");
    assert.equal(
      modal.querySelector(".qap-settings-desc").textContent,
      `Deleting this filter will also delete ${names.length} linked shortcuts: ${names.join(", ")}.`,
    );
    assert.equal(
      modal.querySelector(".qap-button-danger").textContent,
      "Delete filter and linked shortcuts",
    );
    return modal;
  };
  await clickAndFlush(buttons(await confirm()).find((item) => item.textContent === "Cancel"));
  const before = clone(savedProfile(env));
  env.server.failWrites = true;
  await clickAndFlush((await confirm()).querySelector(".qap-button-danger"));
  assert.deepEqual(savedProfile(env), before);
  env.server.failWrites = false;
  const send = env.server.mutate.bind(env.server);
  env.server.mutate = async () => {
    throw { code: "conflict" };
  };
  await clickAndFlush((await confirm()).querySelector(".qap-button-danger"));
  assert.deepEqual(savedProfile(env), before);
  env.server.mutate = send;
  const staleConfirmation = await confirm();
  savedProfile(env).settings.links.push({
    ...savedProfile(env).settings.links.find((item) => item.id === "pin1"),
    id: "pin3",
    name: "Third pin",
  });
  env.server.data("test-user").revision++;
  env.server.notify("test-user");
  await clickAndFlush(staleConfirmation.querySelector(".qap-button-danger"));
  assert.ok(savedProfile(env).filters.states.some((item) => item.id === "unknown"));
  assert.ok(savedProfile(env).settings.links.some((item) => item.id === "pin3"));
  await clickAndFlush(env.document.body.querySelector(".qap-filter-close"));
  await clickAndFlush(env.document.body.querySelector(".qap-head-button"));
  await clickAndFlush(
    env.document.body
      .querySelectorAll(".qap-tile")
      .find((item) => item.querySelector(".qap-tile-name")?.textContent === "First pin"),
  );
  await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
  panel = env.document.body.querySelector(".qap-filter-panel");
  const requests = env.server.requests.length;
  await clickAndFlush(
    (await confirm(["First pin", "Second pin", "Third pin"])).querySelector(".qap-button-danger"),
  );
  assert.equal(env.server.requests.length, requests + 1);
  assert.ok(!savedProfile(env).filters.states.some((item) => item.id === "unknown"));
  assert.ok(
    !savedProfile(env).settings.links.some((item) => ["pin1", "pin2", "pin3"].includes(item.id)),
  );
  assert.ok(savedProfile(env).settings.links.some((item) => item.id === "device-pin"));
  assert.deepEqual(env.server.data("test-user").profiles[1].settings.links, before.settings.links);
  await clickAndFlush(env.document.body.querySelector(".qap-filter-close"));
  assert.equal(
    env.document.body
      .querySelector(".qap-state-tabs")
      .children.some((item) => item.attributes["aria-pressed"] === "true"),
    false,
  );
});

test("filter deletion localizes linked shortcut plurals and reports the total and remaining counts", async () => {
  for (const [language, count] of ["en", "hr"].flatMap((language) =>
    [1, 2, 4, 5, 21, 22, 500].map((count) => [language, count]),
  )) {
    const env = environment();
    installLocaleFetch(env);
    const definitions = await filterDefinitions(env);
    const profile = savedProfile(env);
    profile.filters = clone(definitions.profileFilters());
    profile.settings.links = Array.from({ length: count }, (_, index) => ({
      id: `pin${index}`,
      name: `Pin ${index + 1}`,
      icon: "mdi:pin",
      color: "",
      group: "favorites",
      type: "saved-filter",
      path: "",
      filterKind: "states",
      filterId: "unknown",
    }));
    await startProfiles(env);
    await clickAndFlush(env.fab());
    await clickAndFlush(env.document.body.querySelector(".qap-tile"));
    await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
    const panel = env.document.body.querySelector(".qap-filter-panel");
    await changeLanguage(env, language);
    const row = panel
      .querySelectorAll(".qap-edit-item")
      .find((item) => item.dataset.id === "unknown");
    await clickAndFlush(row.querySelector(".qap-filter-overflow"));
    await clickAndFlush(profileMenuIn(env).querySelector(".qap-delete-filter"));
    const modal = env.document.body.querySelector(".qap-delete-filter-confirmation");
    const names = Array.from({ length: Math.min(count, 3) }, (_, index) => `Pin ${index + 1}`).join(
      ", ",
    );
    const hrNoun = [1, 21].includes(count)
      ? "povezani prečac"
      : [2, 4, 22].includes(count)
        ? "povezana prečaca"
        : "povezanih prečaca";
    const expected =
      language === "en"
        ? `Deleting this filter will also delete ${count} linked ${count === 1 ? "shortcut" : "shortcuts"}: ${names}${count > 3 ? `, and ${count - 3} more` : ""}.`
        : `Brisanjem ovog filtra izbrisat će se i ${count} ${hrNoun}: ${names}${count > 3 ? ` i još ${count - 3}` : ""}.`;
    assert.equal(modal.querySelector(".qap-settings-desc").textContent, expected);
    assert.equal(
      modal.querySelector(".qap-button-danger").textContent,
      language === "en"
        ? "Delete filter and linked shortcuts"
        : "Izbriši filtar i povezane prečace",
    );
    await clickAndFlush(
      buttons(modal).find(
        (item) => item.textContent === (language === "en" ? "Cancel" : "Odustani"),
      ),
    );
    assert.equal(savedProfile(env).settings.links.length, count);
  }
});

test("unresolved saved filter shortcuts explain the failure and open their editor without falling back to an Explorer", async () => {
  const env = environment();
  savedProfile(env).settings.links.push({
    id: "missing",
    name: "Missing filter",
    icon: "mdi:pin",
    color: "",
    group: "favorites",
    type: "saved-filter",
    path: "",
    filterKind: "states",
    filterId: "missing",
  });
  await startProfiles(env);
  await clickAndFlush(env.fab());
  await clickAndFlush(
    env.document.body
      .querySelectorAll(".qap-tile")
      .find((item) => item.querySelector(".qap-tile-name")?.textContent === "Missing filter"),
  );
  const modal = env.document.body.querySelector(".qap-unavailable-filter-confirmation");
  assert.match(
    modal.querySelector(".qap-settings-desc").textContent,
    /could not be found in this profile/,
  );
  assert.equal(env.document.body.querySelector(".qap-states"), null);
  await clickAndFlush(modal.querySelector(".qap-button-danger"));
  const editor = env.document.body.querySelector(".qap-shortcut-form");
  assert.equal(filterField(editor, "Name").value, "Missing filter");
  assert.equal(filterField(editor, "Filter").value, "missing");
  assert.equal(buttons(editor).find((item) => item.textContent === "Save").disabled, true);
  await setFilterField(editor, "Filter", "all");
  assert.equal(buttons(editor).find((item) => item.textContent === "Save").disabled, false);
  assert.equal(filterField(editor, "Name").value, "Missing filter");
});

test(`attribute filter errors wait for save and reset for each editor`, async () => {
  const env = environment();
  env.status.hass.states = {
    "sensor.temperature": {
      entity_id: "sensor.temperature",
      state: "on",
      attributes: { temperature: 12 },
    },
  };
  await openEntityStates(env);
  const panel = await editNewFilter(env, "Temperature");
  await setFilterField(panel, "Condition", "attribute");
  const error = panel.querySelector(".qap-field-error");
  const toggle = panel.querySelector(".qap-filter-rule-toggle");
  const preview = panel.querySelector(".qap-filter-preview-action");
  assert.equal(error.hidden, true);
  assert.equal(toggle.getAttribute("aria-invalid"), "false");
  assert.equal(toggle.getAttribute("aria-describedby"), null);
  assert.ok(!panel.querySelector(".qap-error").textContent);
  assert.equal(panel.querySelector(".qap-filter-preview").textContent, "");
  assert.equal(preview.hidden, true);
  assert.equal(preview.disabled, true);
  await setFilterField(panel, "Value", "12");
  assert.equal(error.hidden, true);
  assert.equal(preview.hidden, true);
  const requestsBeforeSave = env.server.requests.length;
  await clickAndFlush(buttons(panel).find((item) => item.textContent === "Save"));
  assert.equal(env.server.requests.length, requestsBeforeSave);
  assert.equal(error.hidden, false);
  assert.equal(toggle.getAttribute("aria-invalid"), "true");
  assert.equal(toggle.getAttribute("aria-describedby"), error.id);
  assert.ok(panel.querySelector(".qap-error").textContent);
  assert.equal(preview.hidden, false);
  await setFilterField(panel, "Attribute name", "temperature");
  assert.equal(error.hidden, true);
  assert.equal(toggle.getAttribute("aria-invalid"), "false");
  assert.equal(toggle.getAttribute("aria-describedby"), null);
  assert.equal(preview.disabled, false);
  assert.equal(panel.querySelector(".qap-filter-preview").textContent, "1 matching entity");
  await clickAndFlush(buttons(panel).find((item) => item.textContent === "Save"));
  assert.equal(
    savedProfile(env).filters.states.at(-1).condition.conditions[0].attribute,
    "temperature",
  );
  const next = await editNewFilter(env, "Another attribute");
  await setFilterField(next, "Condition", "attribute");
  assert.equal(next.querySelector(".qap-field-error").hidden, true);
  assert.equal(next.querySelector(".qap-filter-preview-action").hidden, true);
  assert.ok(!next.querySelector(".qap-error").textContent);
});

for (const [kind, field, expected] of [
  ["states", "state", "on"],
  ["states", "attribute", "12"],
  ["states", "id", "sensor.temperature"],
  ["devices", "id", "device_a"],
]) {
  test(`${kind} ${field} conditions use appropriate inputs and preserve saved lists`, async () => {
    const env = environment();
    installDeviceRegistries(env);
    env.status.hass.entities = { "sensor.temperature": { device_id: "device_a" } };
    env.status.hass.states = {
      "sensor.temperature": {
        entity_id: "sensor.temperature",
        state: "on",
        attributes: { temperature: 12 },
      },
    };
    await (kind === "devices" ? openDevices(env) : openEntityStates(env));
    const name = `${field} text filter`;
    const panel = await editNewFilter(env, name);
    await setFilterField(panel, "Condition", field);
    if (field === "attribute") {
      const attribute = filterField(panel, "Attribute name");
      assert.equal(attribute.localName, "qap-input");
      assert.equal(attribute.maxLength, 100);
      await setFilterField(panel, "Attribute name", "temperature");
    }
    const input = filterField(panel, "Value");
    assert.equal(
      input.localName,
      field === "id" && kind === "states" ? "qap-entity-selector" : "qap-input",
    );
    if (input.localName !== "qap-entity-selector") assert.equal(input.type, "text");
    await setFilterField(panel, "Value", expected);
    assert.equal(
      panel.querySelector(".qap-filter-preview").textContent,
      `1 matching ${kind === "devices" ? "device" : "entity"}`,
    );
    await setFilterField(panel, "Comparison", "any_of");
    await setFilterField(
      panel,
      "Value",
      field === "id" && kind === "states"
        ? [expected, "custom value"]
        : `${expected}, custom value`,
    );
    assert.equal(panel.querySelector(".qap-filter-options"), null);
    assert.equal(filterField(panel, "Value").getAttribute("role"), null);
    await clickAndFlush(buttons(panel).find((item) => item.textContent === "Save"));
    assert.deepEqual(savedProfile(env).filters[kind].at(-1).condition.conditions[0], {
      type: "rule",
      field,
      operator: "any_of",
      value: [expected, "custom value"],
      ...(field === "attribute" ? { attribute: "temperature" } : {}),
    });
    await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
    const reopened = env.document.body.querySelector(".qap-filter-panel");
    await filterAction(env, reopened, name, "edit");
    assert.deepEqual(
      clone(filterField(reopened, "Value").value),
      field === "id" && kind === "states"
        ? [expected, "custom value"]
        : `${expected}, custom value`,
    );
    assert.equal(reopened.querySelector(".qap-filter-options"), null);
    if (field === "attribute")
      assert.equal(filterField(reopened, "Attribute name").value, "temperature");
  });
}
