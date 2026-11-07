// Filter modal, custom filters, menus, hidden filters and overflow actions.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
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
  savedProfile,
  Element,
  environment,
  openEntityStates,
  openDevices,
  installDeviceRegistries,
  nativeComponents,
  buttons,
  iconColorInput,
  profileMenuIn,
  trackFocus,
} = require("./harness.cjs");

for (const kind of ["states", "devices"]) {
  test(`filters open in a separate modal and restore the ${kind} list`, async () => {
    const env = environment();
    const create = env.document.createElement;
    env.document.createElement = (tag) => {
      const element = create(tag);
      element.focus = () => {
        env.document.activeElement = element;
      };
      return element;
    };
    installDeviceRegistries(env);
    env.status.hass.entities = {};
    const search = await (kind === "devices" ? openDevices(env) : openEntityStates(env));
    const parent = env.document.body.querySelector(".qap-states-dialog");
    const body = parent.querySelector(".qap-body");
    const trigger = parent.querySelector(".qap-filter-action");
    body.scrollTop = 120;
    await clickAndFlush(trigger);
    const modal = env.document.body.querySelector(".qap-filter-modal");
    const panel = modal.querySelector(".qap-filter-panel");
    assert.equal(modal.localName, "qap-dialog");
    assert.equal(modal.open, true);
    assert.equal(modal.parentElement, env.document.body);
    assert.equal(parent.querySelector(".qap-filter-panel"), null);
    assert.equal(modal.querySelector(".qap-title").textContent, "Filters");
    assert.ok(modal.contains(env.document.activeElement));
    const selectedFilter = () => parent.querySelector('[aria-pressed="true"]')?.dataset.domain;
    const before = selectedFilter();
    for (const id of ["all", "favorites"]) {
      const row = panel
        .querySelector(".qap-filter-list")
        .children.find((row) => row.dataset.id === id);
      await clickAndFlush(row.querySelector(".qap-edit-content"));
      assert.equal(selectedFilter(), before, `${id} row content does not apply the filter`);
      assert.equal(modal.open, true, `${id} row content leaves the dialog open`);
    }

    assert.equal(env.document.body.querySelector(".qap-filter-modal"), modal);
    assert.equal(modal.querySelector(".qap-title").textContent, "Filters");
    assert.ok(modal.querySelector(".qap-head").querySelector(".qap-create-filter"));
    await clickAndFlush(modal.querySelector(".qap-filter-close"));
    assert.equal(modal.isConnected, false);
    assert.equal(parent.open, true);
    assert.equal(body.scrollTop, 120);
    assert.equal(parent.querySelector(".qap-search-input"), search);
    assert.equal(env.document.activeElement, trigger);
    await clickAndFlush(trigger);
    const reopened = env.document.body.querySelector(".qap-filter-modal");
    assert.equal(reopened.open, true);

    await clickAndFlush(env.document.body.querySelector(".qap-create-filter"));
    const name = filterField(panel, "Filter name");
    name.value = "Unsaved modal filter";
    await dispatchAndFlush(name, new Event("input"));
    const unload = new Event("beforeunload", { cancelable: true });
    Object.defineProperty(unload, "returnValue", { value: "", writable: true });
    env.window.dispatchEvent(unload);
    assert.equal(unload.defaultPrevented, true);
    await dispatchAndFlush(reopened, new Event("cancel", { cancelable: true }));
    const confirmation = env.document.body.querySelector(".qap-discard-changes-confirmation");
    assert.ok(confirmation);
    await clickAndFlush(buttons(confirmation).find((button) => button.textContent === "Cancel"));
    assert.equal(reopened.open, true);
    assert.equal(filterField(panel, "Filter name").value, "Unsaved modal filter");
    env.enable(false);
    await flush();
    await env.tick(550);
    assert.equal(env.document.body.querySelector(".qap-filter-modal"), null);
  });
}

test("custom filters apply temporarily, save to profiles, and clear temporary definitions on profile switch", async () => {
  const env = environment();
  env.status.hass.entities = {};
  env.status.hass.devices = {};
  env.status.hass.areas = {};
  env.status.hass.states = {
    "sensor.one": { entity_id: "sensor.one", state: "unknown", attributes: {} },
    "sensor.two": { entity_id: "sensor.two", state: "on", attributes: {} },
  };
  await openEntityStates(env);
  let panel = await editNewFilter(env, "My issues");
  assert.equal(panel.querySelector(".qap-filter-preview").textContent, "1 matching entity");
  await clickAndFlush(buttons(panel).find((button) => button.textContent === "Apply temporarily"));
  assert.equal(env.server.requests.length, 0);
  assert.equal(savedProfile(env).filters, undefined);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "1 entity");
  assert.ok(
    env.document.body
      .querySelector(".qap-state-tabs")
      .children.some((chip) => chip.dataset.domain === "temporary"),
  );
  await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
  panel = env.document.body.querySelector(".qap-filter-panel");
  await clickAndFlush(buttons(panel).find((button) => button.textContent === "Temporary filter"));
  await clickAndFlush(buttons(panel).find((button) => button.textContent === "Save"));
  assert.equal(savedProfile(env).filters.states.at(-1).name, "My issues");
  assert.equal(savedProfile(env).filters.states.at(-1).id === "temporary", false);
  assert.equal(
    Object.keys(savedProfile(env).filters.states.at(-1)).sort().join(","),
    "condition,hidden,id,name",
  );
  assert.equal(env.server.requests.length, 1);
  const other = { ...clone(savedProfile(env)), id: "other", name: "Other" };
  env.server.data("test-user").profiles.push(other);
  env.server.data("test-user").revision++;
  env.server.notify("test-user");
  await flush();
  const key = "quick_access_v1:test-instance:test-user:active-profile";
  env.storage.set(key, JSON.stringify("other"));
  await dispatchAndFlush(env.window, Object.assign(new Event("storage"), { key }));
  await clickAndFlush(env.fab());
  await clickAndFlush(env.document.body.querySelector(".qap-tile"));
  assert.equal(
    env.document.body
      .querySelector(".qap-state-tabs")
      .children.some((chip) => chip.dataset.domain === "temporary"),
    false,
  );
});

for (const [kind, id, label] of [
  ["states", "low_battery", "Low battery"],
  ["devices", "assigned", "With area"],
]) {
  test(`editing ${kind} filters preserves order and saving as new appends a copy`, async () => {
    const env = environment();
    const definitions = await filterDefinitions(env);
    savedProfile(env).filters = clone(definitions.profileFilters());
    const original = clone(savedProfile(env).filters[kind]);
    installDeviceRegistries(env);
    env.status.hass.entities = {};
    await (kind === "devices" ? openDevices(env) : openEntityStates(env));
    const edit = async (name, action = "edit") => {
      await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
      const panel = env.document.body.querySelector(".qap-filter-panel");
      await filterAction(env, panel, name, action);
      return panel;
    };
    let panel = await edit(label);
    let name = filterField(panel, "Filter name");
    name.value = "Edited filter";
    await dispatchAndFlush(name, new Event("input"));
    const color = iconColorInput(panel);
    assert.equal(color.type, "color");
    color.value = "#8e24aa";
    await dispatchAndFlush(color, new Event("input"));
    await clickAndFlush(buttons(panel).find((button) => button.textContent === "Save"));
    const edited = clone(savedProfile(env).filters[kind]);
    assert.deepEqual(
      edited,
      original.map((filter) =>
        filter.id === id ? { ...filter, name: "Edited filter", color: "#8e24aa" } : filter,
      ),
    );
    assert.deepEqual(
      env.document.body
        .querySelector(".qap-state-tabs")
        .children.map((chip) => chip.dataset.domain),
      original.map((filter) => filter.id),
    );

    panel = await edit("Edited filter", "duplicate");
    assert.equal(iconColorInput(panel).value, "#8e24aa");
    name = filterField(panel, "Filter name");
    name.value = "Copied filter";
    await dispatchAndFlush(name, new Event("input"));
    await clickAndFlush(buttons(panel).find((button) => button.textContent === "Save"));
    const copied = savedProfile(env).filters[kind];
    assert.deepEqual(copied.slice(0, -1), edited);
    assert.equal(copied.at(-1).name, "Copied filter");
    assert.ok(!original.some((filter) => filter.id === copied.at(-1).id));
    assert.deepEqual(copied.at(-1).condition, edited.find((filter) => filter.id === id).condition);
    assert.equal(copied.at(-1).color, "#8e24aa");
    await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
    const list = env.document.body.querySelector(".qap-filter-panel");
    const row = list.querySelectorAll(".qap-edit-item").find((item) => item.dataset.id === id);
    const symbol = row.querySelector(".qap-edit-symbol").querySelector("qap-icon");
    assert.equal(symbol.attributes.icon, "mdi:filter-variant");
    assert.equal(symbol.style.color, "#8e24aa");
    assert.equal(
      list
        .querySelectorAll(".qap-edit-item")
        .find((item) => item.dataset.id === "favorites")
        .querySelector(".qap-edit-symbol")
        .querySelector("qap-icon").attributes.icon,
      "mdi:star",
    );
    await filterAction(env, list, "Edited filter", "edit");
    assert.equal(iconColorInput(list).value, "#8e24aa");
    await clickAndFlush(list.querySelector(".qap-icon-color-reset"));
    await clickAndFlush(buttons(list).find((button) => button.textContent === "Save"));
    assert.equal(savedProfile(env).filters[kind].find((filter) => filter.id === id).color, "");
  });
}

test("filter management protects system filters, falls back to All, and never lets All be disabled", async () => {
  const env = environment();
  const definitions = await filterDefinitions(env);
  savedProfile(env).filters = clone(definitions.profileFilters());
  env.status.hass.entities = {};
  env.status.hass.devices = {};
  env.status.hass.areas = {};
  env.status.hass.states = {
    "sensor.one": { entity_id: "sensor.one", state: "unknown", attributes: {} },
    "sensor.two": { entity_id: "sensor.two", state: "on", attributes: {} },
  };
  await openEntityStates(env);
  await clickAndFlush(
    env.document.body
      .querySelector(".qap-state-tabs")
      .children.find((chip) => chip.dataset.domain === "unknown"),
  );
  await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
  const panel = env.document.body.querySelector(".qap-filter-panel");
  await filterAction(env, panel, "Unknown", "visibility");
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "2 entities");
  assert.equal(
    env.document.body
      .querySelector(".qap-state-tabs")
      .children.find((chip) => chip.dataset.domain === "all").attributes["aria-pressed"],
    "true",
  );
  for (let index = 0; index < 4; index++) {
    const row = panel
      .querySelectorAll(".qap-edit-item")
      .find((item) => !item.classList.contains("qap-filter-hidden") && item.dataset.id !== "all");
    await filterAction(env, panel, row.querySelector(".qap-filter-name").textContent, "visibility");
  }
  // Every other filter is disabled; All stays visible and active.
  const tabs = env.document.body.querySelector(".qap-state-tabs").children;
  assert.deepEqual(
    tabs.map((chip) => chip.dataset.domain),
    ["all"],
  );
  assert.equal(tabs[0].attributes["aria-pressed"], "true");
  assert.ok(env.document.body.querySelector(".qap-filter-action"));
  assert.equal(panel.querySelectorAll(".qap-filter-hidden").length, 5);
  await clickAndFlush(panel.querySelector(".qap-filter-overflow"));
  assert.deepEqual(
    buttons(profileMenuIn(env)).map((item) => item.textContent),
    ["Move down", "Set default", "Enable"],
  );
  const allRow = panel.querySelectorAll(".qap-edit-item").find((item) => item.dataset.id === "all");
  await clickAndFlush(allRow.querySelector(".qap-filter-overflow"));
  assert.equal(profileMenuIn(env).querySelector(".qap-visibility-filter"), null);
  assert.equal(
    savedProfile(env).filters.states.find((filter) => filter.id === "all").hidden,
    false,
  );
  assert.deepEqual(
    savedProfile(env)
      .filters.states.filter((filter) => ["all", "favorites"].includes(filter.id))
      .map((filter) => filter.name),
    ["Favorites", "All"],
  );
});

test("filter menus share localized actions for built-ins, templates and custom filters without changing default behavior", async () => {
  for (const kind of ["states", "devices"]) {
    for (const language of ["en", "hr"]) {
      const env = environment();
      installLocaleFetch(env);
      installDeviceRegistries(env);
      env.status.hass.entities = {};
      const definitions = await filterDefinitions(env);
      const profile = savedProfile(env);
      profile.filters = clone(definitions.profileFilters());
      profile.filters[kind].push({
        id: "custom",
        name: "Custom",
        hidden: true,
        condition: definitions.group([
          definitions.rule(kind === "states" ? "state" : "name", "equals", "on"),
        ]),
      });
      profile.filters.defaults = { [kind]: "all" };
      await (kind === "devices" ? openDevices(env) : openEntityStates(env));
      await changeLanguage(env, language);
      await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
      const panel = env.document.body.querySelector(".qap-filter-panel");
      const labels =
        language === "en"
          ? {
              "move-up": "Move up",
              "move-down": "Move down",
              default: "Default",
              setDefault: "Set default",
              duplicate: "Duplicate",
              enable: "Enable",
              disable: "Disable",
              delete: "Delete",
            }
          : {
              "move-up": "Pomakni gore",
              "move-down": "Pomakni dolje",
              default: "Zadani",
              setDefault: "Postavi kao zadani",
              duplicate: "Dupliciraj",
              enable: "Omogući",
              disable: "Onemogući",
              delete: "Izbriši",
            };
      const templateId = kind === "states" ? "unknown" : "assigned";
      for (const id of ["favorites", "all", templateId, "custom"]) {
        const rows = panel.querySelectorAll(".qap-edit-item");
        const row = rows.find((item) => item.dataset.id === id);
        const position = rows.indexOf(row);
        const moves = [
          ...(position > 0 ? ["move-up"] : []),
          ...(position < rows.length - 1 ? ["move-down"] : []),
        ];
        const trigger = row.querySelector(".qap-filter-overflow");
        await dispatchAndFlush(trigger, Object.assign(new Event("keydown"), { key: "ArrowDown" }));
        const menu = profileMenuIn(env);
        const system = ["all", "favorites"].includes(id);
        const defaultLabel = id === "all" ? labels.default : labels.setDefault;
        const visibilityLabel = id === "custom" ? labels.enable : labels.disable;
        // All can never be disabled, so it has no visibility action.
        const visibility = id === "all" ? [] : ["visibility"];
        assert.deepEqual(
          buttons(menu).map((item) => item.value),
          [
            ...moves,
            ...(system
              ? ["default", ...visibility]
              : ["default", "duplicate", "visibility", "delete"]),
          ],
        );
        assert.deepEqual(
          buttons(menu).map((item) => item.textContent),
          [
            ...moves.map((move) => labels[move]),
            ...(system
              ? [defaultLabel, ...(id === "all" ? [] : [visibilityLabel])]
              : [defaultLabel, labels.duplicate, visibilityLabel, labels.delete]),
          ],
        );
        assert.equal(
          menu.children.some((item) => item.attributes.role === "separator"),
          !system,
        );
        if (id === "all") {
          const writes = env.server.requests.length;
          await clickAndFlush(menu.querySelector(".qap-default-filter"));
          assert.equal(
            env.server.requests.length,
            writes,
            "the already-default action remains a no-op",
          );
        } else await clickAndFlush(trigger);
      }
      const row = panel
        .querySelectorAll(".qap-edit-item")
        .find((item) => item.dataset.id === "custom");
      await clickAndFlush(row.querySelector(".qap-filter-overflow"));
      await clickAndFlush(profileMenuIn(env).querySelector(".qap-default-filter"));
      const saved = savedProfile(env).filters;
      assert.equal(saved.defaults[kind], "custom");
      assert.equal(saved[kind].find((item) => item.id === "custom").hidden, false);
      assert.equal(saved[kind].find((item) => item.id === "custom").name, "Custom");
    }
  }
});

for (const kind of ["states", "devices"]) {
  test(`hidden ${kind} filters move through the menu, roll back failed saves and retain their order`, async () => {
    const env = environment();
    trackFocus(env);
    installDeviceRegistries(env);
    env.status.hass.entities = {};
    const definitions = await filterDefinitions(env);
    savedProfile(env).filters = clone(definitions.profileFilters());
    const otherKind = kind === "states" ? "devices" : "states";
    const otherFilters = clone(savedProfile(env).filters[otherKind]);
    await (kind === "devices" ? openDevices(env) : openEntityStates(env));
    await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
    const panel = env.document.body.querySelector(".qap-filter-panel");
    assert.equal(
      buttons(panel).some((item) => ["Manage filters", "Create filter"].includes(item.textContent)),
      false,
    );
    await filterAction(env, panel, "Favorites", "visibility");
    const list = panel.querySelector(".qap-filter-list");
    const hidden = list.children[0];
    assert.equal(hidden.dataset.id, "favorites");
    assert.ok(hidden.classList.contains("qap-filter-hidden"));
    assert.equal(hidden.querySelector(".qap-edit-content").localName, "div");
    assert.equal(
      hidden.querySelector(".qap-filter-apply").disabled,
      true,
      "hidden system filters disable Apply like other filters",
    );
    const original = clone(savedProfile(env).filters[kind]);
    const selected = () =>
      env.document.body
        .querySelector(".qap-state-tabs")
        .children.find((chip) => chip.attributes["aria-pressed"] === "true")?.dataset.domain;
    const applied = selected();
    await filterAction(env, panel, "Favorites", "move-down");
    const expected = [original[1], original[0], ...original.slice(2)];
    assert.deepEqual(
      savedProfile(env).filters[kind],
      expected,
      "only the order changes; IDs and properties are preserved",
    );
    assert.deepEqual(
      list.children.map((item) => item.dataset.id),
      expected.map((item) => item.id),
    );
    assert.equal(savedProfile(env).filters[kind][1].hidden, true);
    assert.equal(
      list.children[1].classList.contains("qap-drop-highlight"),
      true,
      "the moved filter is highlighted by ID",
    );
    assert.equal(
      list.children.filter((item) => item.classList.contains("qap-drop-highlight")).length,
      1,
    );
    assert.equal(
      env.document.activeElement,
      list.children[1].querySelector(".qap-filter-overflow"),
    );
    assert.equal(selected(), applied, "moving a filter never changes the applied filter");
    await env.tick(2000);
    assert.equal(list.children[1].classList.contains("qap-drop-highlight"), false);
    await filterAction(env, panel, "Favorites", "move-up");
    assert.deepEqual(savedProfile(env).filters[kind], original);
    await env.tick(2000);
    env.server.failWrites = true;
    const writes = env.server.requests.length;
    await filterAction(env, panel, "Favorites", "move-down");
    assert.equal(env.server.requests.length, writes + 1, "one logical write per movement");
    assert.deepEqual(savedProfile(env).filters[kind], original);
    assert.deepEqual(
      list.children.map((item) => item.dataset.id),
      original.map((item) => item.id),
    );
    assert.equal(
      list.querySelector(".qap-drop-highlight"),
      null,
      "failed moves show no success feedback",
    );
    assert.equal(
      panel.querySelector(".qap-error").textContent,
      "Could not save the filter. Check the profile status and retry.",
    );
    env.server.failWrites = false;
    await clickAndFlush(list.children.at(-1).querySelector(".qap-filter-overflow"));
    assert.equal(
      profileMenuIn(env).querySelector(".qap-move-down-filter"),
      null,
      "the last filter cannot move down",
    );
    assert.ok(profileMenuIn(env).querySelector(".qap-move-up-filter"));
    await clickAndFlush(list.children.at(-1).querySelector(".qap-filter-overflow"));
    assert.deepEqual(savedProfile(env).filters[otherKind], otherFilters);
    await clickAndFlush(env.document.body.querySelector(".qap-filter-close"));
    await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
    assert.deepEqual(
      panel.querySelector(".qap-filter-list").children.map((item) => item.dataset.id),
      original.map((item) => item.id),
    );
    assert.ok(panel.querySelector(".qap-filter-hidden"));
  });

  test(`${kind} overflow menus use profile dropdowns for editing, duplication and deletion`, async () => {
    const env = environment();
    installDeviceRegistries(env);
    env.status.hass.entities = {};
    await (kind === "devices" ? openDevices(env) : openEntityStates(env));
    await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
    const modal = env.document.body.querySelector(".qap-filter-modal");
    const panel = modal.querySelector(".qap-filter-panel");
    const rows = panel.querySelectorAll(".qap-edit-item");
    const preset = rows[2];
    const name = preset.querySelector(".qap-filter-name").textContent;
    const trigger = preset.querySelector(".qap-filter-overflow");
    await dispatchAndFlush(
      trigger,
      Object.assign(new Event("keydown", { cancelable: true }), { key: "ArrowDown" }),
    );
    const menu = profileMenuIn(env);
    assert.equal(menu.localName, "qap-menu");
    assert.ok(modal.contains(menu));
    assert.equal(trigger.attributes["aria-expanded"], "true");
    assert.ok(menu.querySelector(".qap-visibility-filter"));
    assert.equal(menu.querySelector(".qap-edit-filter"), null, "editing is the row's main action");
    assert.ok(menu.querySelector(".qap-delete-filter"));
    assert.deepEqual(
      buttons(menu).map((item) => item.textContent),
      ["Move up", "Move down", "Set default", "Duplicate", "Disable", "Delete"],
    );
    assert.equal(
      panel.querySelector(".qap-filter-metadata"),
      null,
      "opening the overflow menu never opens the editor",
    );
    assert.equal(
      menu.querySelector(".qap-delete-filter").previousElementSibling.attributes.role,
      "separator",
    );
    await clickAndFlush(menu.querySelector(".qap-duplicate-filter"));
    assert.equal(profileMenuIn(env), null);
    assert.equal(trigger.attributes["aria-expanded"], "false");
    assert.equal(filterField(panel, "Filter name").value, `${name} (Copy)`);
    await clickAndFlush(buttons(panel).find((item) => item.textContent === "Save"));
    const saved = savedProfile(env).filters[kind];
    const original = saved.find((item) => item.id === preset.dataset.id);
    const copy = saved.at(-1);
    assert.notEqual(copy.id, original.id);
    assert.equal(copy.name, `${name} (Copy)`);
    assert.equal(copy.hidden, false);
    assert.deepEqual(copy.condition, original.condition);
    await clickAndFlush(env.document.body.querySelector(".qap-filter-action"));
    await filterAction(env, panel, copy.name, "delete");
    let confirmation = env.document.body.querySelector(".qap-delete-filter-confirmation");
    await clickAndFlush(buttons(confirmation).find((item) => item.textContent === "Cancel"));
    assert.ok(savedProfile(env).filters[kind].some((item) => item.id === copy.id));
    await filterAction(env, panel, copy.name, "delete");
    confirmation = env.document.body.querySelector(".qap-delete-filter-confirmation");
    await clickAndFlush(confirmation.querySelector(".qap-button-danger"));
    assert.equal(
      savedProfile(env).filters[kind].some((item) => item.id === copy.id),
      false,
    );
    const reopened = env.document.body.querySelector(".qap-filter-modal");
    assert.ok(reopened.open);
    await clickAndFlush(panel.querySelector(".qap-filter-overflow"));
    assert.equal(profileMenuIn(env).querySelector(".qap-edit-filter"), null);
    assert.equal(profileMenuIn(env).querySelector(".qap-duplicate-filter"), null);
    assert.equal(profileMenuIn(env).querySelector(".qap-delete-filter"), null);
    await clickAndFlush(reopened.querySelector(".qap-filter-close"));
    assert.equal(profileMenuIn(env), null);
  });
}
