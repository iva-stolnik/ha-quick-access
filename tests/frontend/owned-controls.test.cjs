// Owned search, attributes, buttons, toasts, clipboard and entity icon controls.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  attributesValue,
  flush,
  clickAndFlush,
  dispatchAndFlush,
  savedProfile,
  environment,
  openEntityStates,
  nativeComponents,
  buttons,
  componentEnvironment,
  openSettingsScreen,
  openSettings,
  startProfiles,
  shortcutAction,
} = require("./harness.cjs");

test("owned search filters and clears results, remembers completed queries, and reuses recent searches", async () => {
  const env = environment();
  nativeComponents(env);
  env.status.hass.states = {
    "sensor.kitchen": { entity_id: "sensor.kitchen", state: "21", attributes: {} },
    "light.bedroom": { entity_id: "light.bedroom", state: "on", attributes: {} },
  };
  const search = await openEntityStates(env);
  assert.equal(search.localName, "qap-search");
  assert.equal(search.maxlength, 200);
  assert.equal(search.attributes["aria-label"], "Search entities...");
  search.value = "kitchen";
  search.dispatchEvent(new Event("input"));
  await env.tick(175);
  assert.deepEqual(
    env.document.body.querySelectorAll(".qap-state-row").map((row) => row.dataset.entity),
    ["sensor.kitchen"],
  );
  const internalFocus = new Event("focusout");
  internalFocus.relatedTarget = search;
  await dispatchAndFlush(search, internalFocus);
  const historyKey = `quick_access_v1:test-instance:test-user:test-profile:states-search-history`;
  assert.equal(env.storage.has(historyKey), false);
  await dispatchAndFlush(search, new Event("focusout"));
  assert.deepEqual(JSON.parse(env.storage.get(historyKey)), ["kitchen"]);
  search.value = "";
  await dispatchAndFlush(search, new Event("input"));
  assert.equal(env.document.body.querySelectorAll(".qap-state-row").length, 2);
  await clickAndFlush(env.document.body.querySelector(".qap-recent-search"));
  assert.equal(search.value, "kitchen");
  assert.equal(env.document.body.querySelectorAll(".qap-state-row").length, 1);
});

test("recent searches apply after native search focus synchronizes its rendered value", async () => {
  const env = environment();
  nativeComponents(env);
  const historyKey = `quick_access_v1:test-instance:test-user:test-profile:states-search-history`;
  env.storage.set(historyKey, JSON.stringify(["kitchen", "bedroom"]));
  env.status.hass.states = {
    "sensor.kitchen": { entity_id: "sensor.kitchen", state: "21", attributes: {} },
    "sensor.bedroom": { entity_id: "sensor.bedroom", state: "20", attributes: {} },
  };
  const search = await openEntityStates(env);
  for (const previous of ["", "bedroom"]) {
    search.value = previous;
    await dispatchAndFlush(search, new Event("input"));
    // HA can sync the previously rendered inner input during focus, before
    // a newly assigned component value has reached that inner input.
    search.focus = () => {
      search.value = previous;
      search.dispatchEvent(new Event("input"));
    };
    await clickAndFlush(
      env.document.body
        .querySelectorAll(".qap-recent-search")
        .find((chip) => chip.textContent === "kitchen"),
    );
    assert.equal(search.value, "kitchen");
    assert.deepEqual(
      env.document.body.querySelectorAll(".qap-state-row").map((row) => row.dataset.entity),
      ["sensor.kitchen"],
    );
    assert.equal(JSON.parse(env.storage.get(historyKey))[0], "kitchen");
  }
});

test("native filter chips keep one group and entity filter selected, including repeated clicks", async () => {
  const env = environment();
  nativeComponents(env);
  env.server.data("test-user").profiles[0].categories.push({ id: "tools", name: "My tools" });
  Object.assign(savedProfile(env).settings, {
    links: [
      {
        id: "states",
        name: "States",
        type: "quick-states",
        path: "",
        icon: "mdi:format-list-bulleted",
        color: "",
        group: "favorites",
      },
      {
        id: "logs",
        name: "Logs",
        type: "internal",
        path: "/config/logs",
        icon: "mdi:file-document-outline",
        color: "",
        group: "tools",
      },
    ],
  });
  env.status.hass.states = {
    "sensor.kitchen": { entity_id: "sensor.kitchen", state: "unknown", attributes: {} },
    "light.bedroom": { entity_id: "light.bedroom", state: "on", attributes: {} },
  };
  await startProfiles(env, false);
  await clickAndFlush(env.fab());
  const categories = env.document.body.querySelector(".qap-tabs");
  assert.equal(categories.attributes.role, "group");
  assert.equal(
    categories.children.every((chip) => chip.localName === "qap-chip"),
    true,
  );
  const tools = categories.children.find((chip) => chip.dataset.tab === "tools");
  const favorites = categories.children.find((chip) => chip.dataset.tab === "favorites");
  assert.equal(favorites.querySelector("qap-icon"), null);
  await clickAndFlush(tools);
  assert.equal(env.document.body.querySelector(".qap-tile-name").textContent, "Logs");
  assert.deepEqual(
    categories.children.filter((chip) => chip.selected),
    [tools],
  );
  tools.selected = false; // HA toggles its selection before emitting click.
  await clickAndFlush(tools);
  assert.equal(tools.selected, true);
  await clickAndFlush(favorites);
  await clickAndFlush(env.document.body.querySelector(".qap-tile"));
  const filters = env.document.body.querySelector(".qap-state-tabs");
  const unknown = filters.children.find((chip) => chip.dataset.domain === "unknown");
  await clickAndFlush(unknown);
  unknown.selected = false;
  await clickAndFlush(unknown);
  assert.deepEqual(
    filters.children.filter((chip) => chip.selected),
    [unknown],
  );
  assert.deepEqual(
    env.document.body.querySelectorAll(".qap-state-row").map((row) => row.dataset.entity),
    ["sensor.kitchen"],
  );
});

test("recent searches use native assist chips and remain actions when only HA buttons are loaded", async () => {
  for (const assistAvailable of [true, false]) {
    const env = environment();
    if (assistAvailable) nativeComponents(env);
    else nativeComponents(env, false).register("qap-search", "qap-button");
    env.storage.set(
      `quick_access_v1:test-instance:test-user:test-profile:states-search-history`,
      JSON.stringify(["kitchen"]),
    );
    env.status.hass.states = {
      "sensor.kitchen": { entity_id: "sensor.kitchen", state: "21", attributes: {} },
    };
    const search = await openEntityStates(env);
    const chip = env.document.body.querySelector(".qap-recent-search");
    assert.equal(chip.localName, "qap-chip");
    await clickAndFlush(chip);
    assert.equal(search.value, "kitchen");
    assert.equal(env.document.body.querySelectorAll(".qap-state-row").length, 1);
  }
});

test("owned attributes preserve nested YAML and refresh the same viewer only on changes", async () => {
  const env = environment();
  nativeComponents(env);
  const state = {
    entity_id: "sensor.kitchen",
    state: "21",
    attributes: {
      friendly_name: "Kitchen",
      list: ["on", null, false, 3],
      nested: { text: "a: b\n<test>" },
    },
  };
  env.status.hass.states = { [state.entity_id]: state };
  await openEntityStates(env);
  await clickAndFlush(env.document.body.querySelector(".qap-state-summary"));
  const modal = env.document.body.querySelector(".qap-state-modal");
  const editor = modal.querySelector("qap-attributes-viewer");
  assert.equal(editor.label, "Entity attributes");
  assert.deepEqual(attributesValue(editor), state.attributes);
  const previousValue = editor.value;
  await env.tick(3500);
  assert.equal(editor.value, previousValue);
  state.attributes.nested.text = "updated";
  await env.tick(3500);
  assert.equal(modal.querySelector("qap-attributes-viewer"), editor);
  assert.equal(attributesValue(editor).nested.text, "updated");
  delete env.status.hass.states[state.entity_id];
  await env.tick(3500);
  assert.deepEqual(attributesValue(editor), {});
  assert.equal(modal.querySelector(".qap-state-dialog-value").textContent, "Unavailable");
});

test("attributes load once on details use and a delayed load updates only the current dialog", async () => {
  const imports = [];
  let finishImport;
  const pending = new Promise((resolve) => {
    finishImport = resolve;
  });
  const env = environment(undefined, undefined, {
    onDynamicImport: async (specifier) => {
      imports.push(specifier);
      await pending;
    },
  });
  nativeComponents(env);
  const state = {
    entity_id: "sensor.kitchen",
    state: "21",
    attributes: { friendly_name: "Kitchen" },
  };
  env.status.hass.states = { [state.entity_id]: state };
  await openEntityStates(env);
  assert.equal(imports.length, 0, "opening the entity list does not load YAML");
  assert.equal(env.definitions.has("qap-attributes-viewer"), false);
  await clickAndFlush(env.document.body.querySelector(".qap-state-summary"));
  const previous = env.document.body.querySelector(".qap-state-modal");
  const previousViewer = previous.querySelector("qap-attributes-viewer");
  assert.equal(imports.length, 2, "presentation and serialization each load once");
  await dispatchAndFlush(previous, new Event("cancel"));
  await clickAndFlush(env.document.body.querySelector(".qap-state-summary"));
  const current = env.document.body.querySelector(".qap-state-modal");
  assert.notEqual(current, previous);
  state.attributes.updated = true;
  finishImport();
  await flush();
  assert.equal(imports.length, 2, "reopening shares the pending imports");
  assert.equal(env.definitions.has("qap-attributes-viewer"), true);
  assert.deepEqual(
    attributesValue(current.querySelector("qap-attributes-viewer")),
    state.attributes,
  );
  assert.equal(previousViewer.value, undefined, "late completion does not update a closed dialog");
});

test("serialization failures keep details usable and recover on the next valid update", async () => {
  const env = environment();
  nativeComponents(env);
  const state = {
    entity_id: "sensor.kitchen",
    state: "21",
    attributes: { friendly_name: "Kitchen" },
  };
  env.status.hass.states = { [state.entity_id]: state };
  await openEntityStates(env);
  await clickAndFlush(env.document.body.querySelector(".qap-state-summary"));
  const modal = env.document.body.querySelector(".qap-state-modal");
  const viewer = modal.querySelector("qap-attributes-viewer");
  const cycle = {};
  cycle.self = cycle;
  const invalid = {
    get broken() {
      throw Error("<img src=x onerror=alert(1)>");
    },
  };
  for (const attributes of [cycle, invalid, { unsupported: () => {} }]) {
    state.attributes = attributes;
    state.state = "22";
    await env.tick(3500);
    assert.equal(viewer.value, "Unavailable");
    assert.equal(modal.querySelector(".qap-state-dialog-value").textContent, "22");
    assert.notEqual(modal.querySelector(".qap-state-dialog-favorite").disabled, true);
    assert.equal(env.document.body.querySelector(".qap-state-modal"), modal);
  }
  state.attributes = { recovered: true };
  await env.tick(3500);
  assert.deepEqual(attributesValue(viewer), state.attributes);
  await dispatchAndFlush(modal, new Event("cancel"));
  assert.equal(env.document.body.querySelector(".qap-state-modal"), null);
});

test("delayed HA loading preserves typed search text and shares one loader between controls", async () => {
  const env = environment();
  const components = nativeComponents(env, false);
  let imports = 0;
  let finishImport;
  env.window.loadCardHelpers = async () => {
    imports++;
    await new Promise((resolve) => {
      finishImport = resolve;
    });
    return { createCardElement: () => ({ constructor: { getConfigElement: async () => {} } }) };
  };
  env.status.hass.states = {
    "sensor.kitchen": { entity_id: "sensor.kitchen", state: "21", attributes: {} },
  };
  const fallback = await openEntityStates(env);
  fallback.value = "kitchen";
  await dispatchAndFlush(fallback, new Event("input"));
  await clickAndFlush(env.document.body.querySelector(".qap-state-summary"));
  assert.equal(imports, 1);
  finishImport();
  await new Promise(setImmediate);
  const loader = env.document.body.querySelector("ha-form");
  assert.equal(loader.hidden, true);
  components.register();
  await new Promise(setImmediate);
  assert.equal(env.document.body.querySelector("ha-form"), null);
  const search = env.document.body.querySelector(".qap-search-input");
  assert.equal(search.localName, "qap-search");
  assert.equal(search.value, "kitchen");
  assert.ok(env.document.body.querySelector("qap-attributes-viewer"));
  await dispatchAndFlush(env.document.body.querySelector(".qap-state-modal"), new Event("cancel"));
  await clickAndFlush(env.document.body.querySelector(".qap-recent-search"));
  assert.equal(search.value, "kitchen");
});

test("retained native controls forward HA context requests from body-mounted hosts", async () => {
  const { env, api } = await componentEnvironment(true);
  const host = api.iconPicker();
  env.document.body.append(host);
  let forwarded;
  env.homeAssistant.addEventListener("context-request", (event) => {
    forwarded = event;
  });
  const request = new Event("context-request");
  Object.assign(request, { context: Symbol("i18n"), callback: () => {}, subscribe: true });
  await dispatchAndFlush(host, request);
  assert.equal(forwarded.context, request.context);
  assert.equal(forwarded.callback, request.callback);
  assert.equal(forwarded.subscribe, true);
  assert.equal(forwarded.contextTarget, host);
});

test("native action buttons and alerts preserve validation, disabled actions, and delete behavior", async () => {
  const env = environment();
  nativeComponents(env);
  await openSettings("/config/logs", undefined, env);
  const save = env.document.body.querySelector(".qap-save-settings");
  const paths = env.document.body.querySelector(".qap-textarea");
  const error = env.document.body.querySelector(".qap-error");
  assert.equal(save.localName, "qap-button");
  assert.equal(save.attributes.appearance, "accent");
  assert.equal(error.localName, "qap-alert");
  assert.equal(error.alertType, "error");
  paths.value = "invalid";
  await clickAndFlush(save);
  assert.equal(
    env.document.body.querySelector(".qap-url-paths").querySelector(".qap-field-error").textContent,
    "Every page path must start with /.",
  );
  assert.equal(error.textContent, "");
  paths.value = "/private/logs";
  save.disabled = true;
  await clickAndFlush(save);
  assert.equal(env.server.data("test-user").revision, 0);
  save.disabled = false;
  await clickAndFlush(save);
  assert.equal(savedProfile(env).settings.routes[0], "/private/logs");
  buttons(env.document.body)
    .find((button) => button.title === "Settings")
    .click();
  openSettingsScreen(env, "shortcuts");
  await flush();
  const add = env.document.body.querySelector(".qap-add-shortcut");
  assert.equal(add.localName, "qap-icon-button");
  assert.equal(add.querySelector("qap-icon").attributes.icon, "mdi:plus");
  await shortcutAction(env, "delete");
  const remove = env.document.body
    .querySelector(".qap-delete-confirmation")
    .querySelector(".qap-button-danger");
  assert.equal(remove.localName, "qap-button");
  assert.equal(remove.attributes.variant, "danger");
  assert.equal(
    savedProfile(env).settings.links.some((link) => link.id === "quick-states"),
    true,
  );
  await clickAndFlush(remove);
  assert.equal(
    savedProfile(env).settings.links.some((link) => link.id === "quick-states"),
    false,
  );
});

test("owned entity icons, favorite buttons, and More Info retain state and accessibility labels", async () => {
  const env = environment();
  nativeComponents(env);
  const state = { entity_id: "light.kitchen", state: "on", attributes: { icon: "mdi:desk-lamp" } };
  env.status.hass.states = { [state.entity_id]: state };
  await openEntityStates(env);
  const stateIcon = env.document.body.querySelector("qap-state-icon");
  assert.equal(stateIcon.stateObj, state);
  assert.equal(stateIcon.hass, env.status.hass);
  assert.equal(stateIcon.attributes["aria-hidden"], "true");
  let forwarded;
  env.homeAssistant.addEventListener("context-request", (event) => {
    forwarded = event;
  });
  await dispatchAndFlush(stateIcon.parentElement, new Event("context-request"));
  assert.equal(forwarded.contextTarget, stateIcon.parentElement);
  const updated = { ...state, state: "off" };
  env.status.hass.states[state.entity_id] = updated;
  await env.tick(3500);
  assert.equal(env.document.body.querySelector("qap-state-icon").stateObj, updated);
  await clickAndFlush(env.document.body.querySelector(".qap-state-summary"));
  const modal = env.document.body.querySelector(".qap-state-modal");
  const favorite = modal.querySelector(".qap-state-dialog-favorite");
  assert.equal(favorite.localName, "qap-icon-button");
  assert.equal(favorite.label, "Add to favorites");
  await clickAndFlush(favorite);
  assert.equal(favorite.selected, true);
  assert.equal(favorite.label, "Remove from favorites");
  assert.equal(favorite.querySelector("qap-icon").attributes.icon, "mdi:star");
  let info;
  env.homeAssistant.addEventListener("hass-more-info", (event) => {
    info = event.detail.entityId;
  });
  await clickAndFlush(modal.querySelector(".qap-state-dialog-info"));
  assert.equal(info, state.entity_id);
  const copy = modal.querySelector(".qap-state-dialog-state-copy");
  assert.equal(copy.localName, "qap-icon-button");
  assert.equal(copy.label, "Copy state");
  let copies = 0;
  env.window.isSecureContext = true;
  env.context.navigator.clipboard = {
    writeText: async () => {
      copies++;
    },
  };
  await clickAndFlush(copy);
  await new Promise(setImmediate);
  assert.equal(copies, 1);
  delete env.status.hass.states[state.entity_id];
  await env.tick(3500);
  assert.equal(copy.disabled, true);
  await clickAndFlush(copy);
  assert.equal(copies, 1);
});

test("copy confirmations reuse qap-toast with the same message and disconnect when details close", async () => {
  const env = environment();
  nativeComponents(env);
  const copied = [];
  env.window.isSecureContext = true;
  env.context.navigator.clipboard = { writeText: async (value) => copied.push(value) };
  env.status.hass.states = {
    "sensor.kitchen": { entity_id: "sensor.kitchen", state: "21", attributes: {} },
  };
  await openEntityStates(env);
  await clickAndFlush(env.document.body.querySelector(".qap-state-summary"));
  const modal = env.document.body.querySelector(".qap-state-modal");
  for (const selector of [
    ".qap-state-dialog-state-copy",
    ".qap-state-dialog-id-copy",
    ".qap-state-dialog-id-link",
  ]) {
    await clickAndFlush(modal.querySelector(selector));
    await new Promise(setImmediate);
  }
  assert.deepEqual(copied, ["21", "sensor.kitchen", "sensor.kitchen"]);
  const editor = modal.querySelector("qap-attributes-viewer");
  for (let index = 0; index < 2; index++) {
    await dispatchAndFlush(
      editor,
      new CustomEvent("copy-request", {
        detail: { value: "friendly_name: Kitchen\n" },
        bubbles: true,
        composed: true,
      }),
    );
  }
  assert.deepEqual(copied, [
    "21",
    "sensor.kitchen",
    "sensor.kitchen",
    "friendly_name: Kitchen\n",
    "friendly_name: Kitchen\n",
  ]);
  const feedback = modal.querySelector("qap-toast");
  assert.equal(env.document.body.querySelectorAll("qap-toast").length, 1);
  assert.equal(feedback.timeoutMs, 2200);
  assert.deepEqual(feedback.messages, Array(5).fill("Copied to clipboard"));
  assert.equal(modal.querySelector(".qap-toast"), null);
  assert.equal(
    [...env.timers.values()].some((timer) => timer.delay === 2200),
    false,
  );
  await clickAndFlush(buttons(modal).find((button) => button.title === "Back"));
  await dispatchAndFlush(editor, new CustomEvent("copy-request", { detail: { value: "stale" } }));
  assert.equal(feedback.isConnected, false);
  assert.equal(env.document.body.querySelector("qap-toast"), null);
});

test("copy feedback uses the owned toast without waiting for native HA registration", async () => {
  const env = environment();
  nativeComponents(env, false);
  env.window.isSecureContext = true;
  env.context.navigator.clipboard = { writeText: async () => {} };
  env.status.hass.states = {
    "sensor.kitchen": { entity_id: "sensor.kitchen", state: "21", attributes: {} },
  };
  await openEntityStates(env);
  await clickAndFlush(env.document.body.querySelector(".qap-state-summary"));
  const modal = env.document.body.querySelector(".qap-state-modal");
  await clickAndFlush(modal.querySelector(".qap-state-dialog-state-copy"));
  assert.equal(modal.querySelector("qap-toast").labelText, "Copied to clipboard");
  env.enable(false);
  await flush();
  assert.equal(env.document.body.querySelector("qap-toast"), null);
  assert.equal(env.timers.size, 0);
});

test("clipboard fallback success shows qap-toast while failed copying only opens manual copy", async () => {
  for (const succeeds of [true, false]) {
    const env = environment();
    nativeComponents(env);
    env.window.isSecureContext = true;
    env.context.navigator.clipboard = {
      writeText: async () => {
        throw new Error("Clipboard blocked");
      },
    };
    env.context.console.debug = () => {};
    env.document.execCommand = () => succeeds;
    const createElement = env.document.createElement;
    env.document.createElement = (tag) => {
      const element = createElement(tag);
      if (tag === "textarea") {
        element.select = () => {};
        element.setSelectionRange = () => {};
      }
      return element;
    };
    env.status.hass.states = {
      "sensor.kitchen": { entity_id: "sensor.kitchen", state: "21", attributes: {} },
    };
    await openEntityStates(env);
    await clickAndFlush(env.document.body.querySelector(".qap-state-summary"));
    await clickAndFlush(env.document.body.querySelector(".qap-state-dialog-state-copy"));
    await new Promise(setImmediate);
    if (succeeds) {
      assert.equal(env.document.body.querySelector("qap-toast").labelText, "Copied to clipboard");
      assert.equal(env.document.body.querySelector(".qap-manual-copy"), null);
    } else {
      assert.equal(env.document.body.querySelector("qap-toast"), null);
      assert.equal(env.document.body.querySelector(".qap-manual-input").value, "21");
    }
  }
});

for (const teardown of [false, true]) {
  test(`clipboard failure after details close ${teardown ? "stops after launcher teardown" : "opens manual copy in the launcher shell"}`, async () => {
    const env = environment();
    env.window.isSecureContext = true;
    let rejectCopy;
    const copied = [];
    env.context.navigator.clipboard = {
      writeText: (value) => {
        copied.push(value);
        return new Promise((resolve, reject) => {
          rejectCopy = reject;
        });
      },
    };
    env.context.console.debug = () => {};
    env.document.execCommand = () => false;
    const createElement = env.document.createElement;
    env.document.createElement = (tag) => {
      const element = createElement(tag);
      if (tag === "textarea") {
        element.focus = () => {
          env.document.activeElement = element;
        };
        element.select = () => {};
        element.setSelectionRange = () => {};
      }
      return element;
    };
    env.status.hass.states = {
      "sensor.kitchen": { entity_id: "sensor.kitchen", state: "21", attributes: {} },
    };
    await openEntityStates(env);
    const shell = env.document.body.querySelector(".qap-shell");
    env.document.body.querySelector(".qap-state-summary").click();
    const modal = env.document.body.querySelector(".qap-state-modal");
    modal.querySelector(".qap-state-dialog-state-copy").click();
    assert.deepEqual(copied, ["21"]);
    buttons(modal)
      .find((button) => button.title === "Back")
      .click();
    assert.equal(modal.isConnected, false);
    if (teardown) env.enable(false);
    rejectCopy(new Error("Clipboard blocked"));
    await flush();
    assert.equal(env.document.body.querySelector(".qap-toast"), null);
    if (teardown) {
      assert.equal(env.document.body.querySelector(".qap-manual-copy"), null);
      assert.equal(shell.querySelector(".qap-manual-copy"), null);
      assert.equal(env.document.body.children.length, 0);
    } else {
      const manual = shell.querySelector(".qap-manual-input");
      assert.equal(manual.value, "21");
      assert.equal(env.document.activeElement === manual, true);
      assert.equal(modal.querySelector(".qap-manual-copy"), null);
    }
  });
}

test("entity state colors receive attribute-only changes and state transitions without remounting", async () => {
  const env = environment();
  nativeComponents(env);
  const entityId = "light.kitchen";
  const initial = {
    entity_id: entityId,
    state: "on",
    attributes: { friendly_name: "Kitchen", rgb_color: [255, 0, 0], brightness: 255 },
  };
  env.status.hass.states = {
    [entityId]: initial,
    "switch.fan": { entity_id: "switch.fan", state: "on", attributes: {} },
    "binary_sensor.door": {
      entity_id: "binary_sensor.door",
      state: "on",
      attributes: { device_class: "door" },
    },
  };
  await openEntityStates(env);
  for (const badge of env.document.body.querySelectorAll("qap-state-icon")) {
    assert.equal(badge.stateObj, env.status.hass.states[badge.stateObj.entity_id]);
  }
  const row = env.document.body
    .querySelectorAll(".qap-state-row")
    .find((row) => row.dataset.entity === entityId);
  const badge = row.querySelector("qap-state-icon");
  const value = row.querySelector(".qap-state-value");
  const states = [
    { ...initial, attributes: { ...initial.attributes, rgb_color: [0, 0, 255] } },
    { ...initial, attributes: { ...initial.attributes, brightness: 64 } },
    { entity_id: entityId, state: "off", attributes: { friendly_name: "Kitchen" } },
    { ...initial, state: "unavailable" },
    initial,
  ];
  for (const state of states) {
    env.status.hass.states[entityId] = state;
    await env.tick(3500);
    assert.equal(row.querySelector("qap-state-icon"), badge);
    assert.equal(badge.stateObj, state);
    assert.equal(value.textContent, state.state);
  }
});

test("entity icons remain independent of late HA registration and preserve mounted actions", async () => {
  const env = environment();
  const components = nativeComponents(env, false);
  components.register("ha-form");
  const state = {
    entity_id: "sensor.kitchen",
    state: "21",
    attributes: { icon: "mdi:home-thermometer" },
  };
  env.status.hass.states = { [state.entity_id]: state };
  await openEntityStates(env);
  const summary = env.document.body.querySelector(".qap-state-summary");
  const iconHost = summary.querySelector(".qap-state-icon");
  const stateIcon = iconHost.querySelector("qap-state-icon");
  assert.equal(stateIcon.stateObj, state);
  assert.equal(components.definitionCalls.has("state-badge"), false);
  const back = env.document.body.querySelector(".qap-head-button");
  assert.equal(back.localName, "qap-icon-button");
  const updated = { ...state, state: "22" };
  env.status.hass.states[state.entity_id] = updated;
  components.register();
  await env.tick(3500);
  assert.equal(env.document.body.querySelector(".qap-state-summary"), summary);
  assert.equal(iconHost.querySelector("qap-state-icon").stateObj, updated);
  assert.equal(iconHost.querySelector("qap-state-icon"), stateIcon);
  assert.equal(env.document.body.querySelector(".qap-head-button"), back);
  await clickAndFlush(back);
  const settings = buttons(env.document.body).find((button) => button.title === "Settings");
  assert.equal(settings.localName, "qap-icon-button");
  settings.click();
  openSettingsScreen(env, "visibility");
  await flush();
  assert.equal(env.document.body.querySelector(".qap-save-settings").localName, "qap-button");
  assert.equal(env.document.body.querySelector(".qap-error").localName, "qap-alert");
  env.enable(false);
  await flush();
  assert.equal(env.document.body.children.length, 0);
});

test("an already loaded HA form loads selectors without card helpers and unload cancels its pending imports", async () => {
  const env = environment();
  const components = nativeComponents(env, false);
  components.register("ha-form");
  await openEntityStates(env);
  assert.equal(env.document.body.querySelector("ha-form").hidden, true);
  env.enable(false);
  await flush();
  assert.equal(env.document.body.children.length, 0);
  assert.equal(env.timers.size, 0);
  components.register();
  await new Promise(setImmediate);
  assert.equal(env.document.body.children.length, 0);
});
