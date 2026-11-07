// Sidebar Current device settings, selection and visibility reset.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const { getEventListeners } = require("node:events");
const test = require("node:test");
const {
  panelEnvironment,
  flush,
  clickAndFlush,
  clone,
  environment,
  nativeComponents,
  openLauncherSettings,
  startProfiles,
  useProfile,
  profileRowIn,
  selectionKey,
  deviceStatus,
  chooseDeviceProfile,
  confirmDevice,
  storageEvent,
  deviceEnvironment,
} = require("./harness.cjs");

test("Current device renders only own-user settings independently of the launcher", async () => {
  const env = panelEnvironment();
  env.server.data("other-user").profiles.push({
    ...clone(env.server.data("test-user").profiles[0]),
    id: "private",
    name: "Private",
  });
  const panel = await env.mountPanel();
  await flush();
  assert.deepEqual(
    panel.shadowRoot.querySelectorAll("h2").map((e) => e.textContent),
    ["This browser"],
  );
  assert.match(panel._deviceName.textContent, /Default/);
  assert.deepEqual(clone(panel._profileSelect.options.map((e) => e.value)), ["", "test-profile"]);
  assert.equal(panel.shadowRoot.querySelectorAll("a").length, 0);
});

for (const admin of [false, true]) {
  test(`sidebar device settings support switching and hidden-launcher recovery (admin=${admin})`, async () => {
    const env = panelEnvironment();
    env.status.hass.user.is_admin = admin;
    const data = env.server.data("test-user");
    const second = { ...clone(data.profiles[0]), id: "tablet", name: "Tablet" };
    second.settings = { ...second.settings, visibility: "exclude", routes: ["/*"] };
    data.profiles.push(second);
    const other = env.server.data("other-user");
    other.profiles.push({ ...clone(second), name: "Private" });
    const otherBefore = clone(other);
    const panel = await env.mountPanel();
    await flush();
    assert.equal(env.fab(), null, "the standalone panel needs no launcher");
    assert.equal(panel._profileSelect.disabled, false);
    chooseDeviceProfile(panel, "tablet");
    assert.equal(env.storage.get(selectionKey()), '"tablet"');
    assert.equal(env.server.requests.length, 0);
    panel._resetVisibility.click();
    assert.match(
      panel._confirmation.querySelector("p").textContent,
      /sync to other devices using the same profile/,
    );
    confirmDevice(panel);
    await flush();
    assert.deepEqual(data.profiles[1].settings, {
      ...second.settings,
      visibility: "exclude",
      routes: [],
    });
    assert.deepEqual(other, otherBefore);
    assert.equal(env.server.requests[0].profile_id, "tablet");
    assert.equal(Object.hasOwn(env.server.requests[0], "user_id"), false);
    assert.equal(panel.shadowRoot.querySelector("form,hass-subpage,partial-panel-resolver"), null);
    assert.deepEqual(
      panel.shadowRoot.querySelectorAll("h2").map((node) => node.textContent),
      ["This browser"],
    );
  });
}

test(`sidebar no-selection placeholder is disabled while a profile is selected`, async () => {
  const env = panelEnvironment();
  env.storage.delete(selectionKey());
  const panel = await env.mountPanel();
  await flush();
  const options = () => panel._profileSelect.options;
  const choose = (id) => chooseDeviceProfile(panel, id);
  assert.equal(panel._profileSelect.value, "");
  assert.equal(options()[0].value, "");
  assert.equal(options()[0].disabled, false);
  choose("test-profile");
  assert.equal(panel._profileSelect.value, "test-profile");
  assert.equal(options()[0].disabled, true);
  assert.equal(options()[1].disabled || false, false);
  choose("");
  assert.equal(panel._profileSelect.value, "test-profile");
  assert.equal(env.storage.get(selectionKey()), '"test-profile"');
  assert.equal(panel._confirmation, undefined);
  panel._removeSelection.click();
  confirmDevice(panel);
  assert.equal(panel._profileSelect.value, "");
  assert.equal(options()[0].disabled, false);
  assert.equal(env.storage.has(selectionKey()), false);
  choose("test-profile");
  assert.equal(options()[0].disabled, true);
  assert.equal(env.server.requests.length, 0);
});

test("sidebar clears private data on logout and reconnects once when reopened", async () => {
  const env = panelEnvironment();
  const panel = await env.mountPanel();
  await flush();
  const previous = [...env.server.listeners][0].callback;
  const snapshot = clone(env.server.data("test-user"));
  panel._resetVisibility.click();
  panel.hass = undefined;
  await flush();
  previous(snapshot);
  assert.equal(panel._profiles, undefined);
  assert.equal(panel._deviceKey, undefined);
  assert.equal(panel._confirmation, undefined);
  assert.equal(panel._profileSelect.disabled, true);
  assert.equal(env.server.listeners.size, 0);
  panel.hass = env.status.hass;
  await flush();
  for (let visit = 0; visit < 3; visit++) {
    panel.remove();
    panel.disconnectedCallback();
    await flush();
    assert.equal(env.server.listeners.size, 0);
    env.document.body.append(panel);
    panel.connectedCallback();
    await flush();
    assert.equal(env.server.listeners.size, 1);
    assert.equal(getEventListeners(env.connection, "ready").length, 1);
    assert.equal(getEventListeners(env.window, "storage").length, 1);
    assert.equal(panel.shadowRoot.querySelectorAll("header").length, 1);
  }
});

test("sidebar owned controls remain stable across delayed HA registration", async () => {
  const env = panelEnvironment();
  const components = nativeComponents(env, false);
  const panel = await env.mountPanel();
  await flush();
  const fallback = panel._profileSelect;
  panel.shadowRoot.activeElement = fallback;
  components.register("qap-select", "qap-button");
  await flush();
  assert.equal(panel._profileSelect, fallback);
  panel.shadowRoot.activeElement = null;
  fallback.dispatchEvent(new Event("focusout"));
  await flush();
  assert.equal(panel._profileSelect.localName, "qap-select");
  assert.equal(panel._profileSelect.value, "test-profile");
  assert.equal(panel._profileSelect.options[0].disabled, true);
  assert.equal(panel._removeSelection.localName, "qap-button");
  assert.equal(env.server.requests.length, 0);
});

test("removing selection confirms, deletes only its local key, shows Setup FAB and never reselects on updates", async () => {
  const env = await deviceEnvironment(),
    panel = env.panel;
  for (const [key, value] of [
    ["quick_access_v1:test-instance:test-user:test-profile:position", '{"x":0.3,"y":0.4}'],
    ["quick_access_v1:test-instance:test-user:test-profile:states-search-history", '["kitchen"]'],
    [selectionKey("test-instance", "other"), '"other-profile"'],
    [selectionKey("other-instance"), '"other-profile"'],
  ])
    env.storage.set(key, value);
  const before = [...env.storage].filter(([key]) => key !== selectionKey());
  const profiles = clone(env.server.data("test-user"));
  panel._removeSelection.click();
  assert.equal(
    panel.shadowRoot.querySelector(".device-confirmation").querySelector("h2").textContent,
    "Remove profile selection from this browser?",
  );
  assert.equal(panel.shadowRoot.querySelector(".confirm-device").textContent, "Remove selection");
  assert.equal(env.storage.has(selectionKey()), true);
  panel.shadowRoot
    .querySelector(".device-confirmation")
    .dispatchEvent(new Event("cancel", { cancelable: true }));
  assert.equal(env.storage.has(selectionKey()), true);
  panel._removeSelection.click();
  confirmDevice(panel);
  assert.equal(env.storage.has(selectionKey()), false);
  assert.deepEqual([...env.storage], before);
  assert.deepEqual(env.server.data("test-user"), profiles);
  assert.equal(env.server.requests.length, 0);
  assert.equal(env.window.quickAccessDebug().activeProfileId, null);
  assert.equal(env.fab().hidden, false);
  assert.equal(env.fab().attributes["aria-label"], "Set up Quick Access");
  assert.equal(panel._deviceName.textContent, "No profile selected in this browser");
  assert.equal(panel._resetVisibility.disabled, true);
  assert.equal(deviceStatus(panel), "");
  assert.equal(panel._deviceStatus.hidden, true);
  env.server.notify("test-user");
  assert.equal(env.window.quickAccessDebug().activeProfileId, null);
  env.enable(false);
  await flush();
  env.enable(true);
  await flush();
  assert.equal(env.window.quickAccessDebug().activeProfileId, null);
  assert.equal(env.fab().hidden, false);
  assert.equal(env.fab().attributes["aria-label"], "Set up Quick Access");
});

test("selecting a saved profile restores the FAB using its saved visibility and position without backend writes", async () => {
  const env = await deviceEnvironment(),
    panel = env.panel;
  const profile = env.server.data("test-user").profiles[0];
  env.storage.set(
    "quick_access_v1:test-instance:test-user:test-profile:position",
    '{"x":0.5,"y":0.5}',
  );
  profile.settings = { ...profile.settings, visibility: "include", routes: ["/missing"] };
  env.server.notify("test-user");
  panel._removeSelection.click();
  confirmDevice(panel);
  chooseDeviceProfile(panel, profile.id);
  assert.equal(env.storage.get(selectionKey()), JSON.stringify(profile.id));
  assert.equal(env.fab().style.left, "171px");
  assert.equal(env.fab().style.top, "398px");
  assert.equal(env.window.quickAccessDebug().activeProfileId, profile.id);
  assert.equal(env.fab().hidden, true);
  env.context.location.pathname = "/missing";
  env.window.dispatchEvent(new Event("location-changed"));
  assert.equal(env.fab().hidden, false);
  assert.equal(env.server.requests.length, 0);
  assert.equal(deviceStatus(panel), "");
  assert.equal(panel._deviceStatus.hidden, true);
});

test("same-tab launcher selections notify the device selector", async () => {
  const env = await deviceEnvironment(),
    panel = env.panel;
  const data = env.server.data("test-user");
  data.profiles.push({ ...clone(data.profiles[0]), id: "second", name: "Second" });
  env.server.notify("test-user");
  await useProfile(env, "second");
  assert.equal(panel._profileSelect.value, "second");
  assert.match(panel._deviceName.textContent, /Second/);
});

test("browser storage events synchronize selection, filter users/instances/storage areas, and handle clear", async () => {
  const env = await deviceEnvironment(),
    panel = env.panel;
  env.storage.delete(selectionKey());
  for (const key of [selectionKey("elsewhere"), selectionKey("test-instance", "elsewhere")])
    storageEvent(env, key);
  storageEvent(env, selectionKey(), {});
  assert.equal(env.window.quickAccessDebug().activeProfileId, "test-profile");
  storageEvent(env, selectionKey());
  assert.equal(env.window.quickAccessDebug().activeProfileId, null);
  assert.equal(panel._profileSelect.value, "");
  env.storage.set(selectionKey(), '"test-profile"');
  storageEvent(env, selectionKey());
  assert.equal(env.window.quickAccessDebug().activeProfileId, "test-profile");
  assert.equal(env.fab().hidden, false);
  env.storage.clear();
  storageEvent(env, null);
  assert.equal(env.window.quickAccessDebug().activeProfileId, null);
  assert.equal(panel._profileSelect.value, "");
});

for (const method of ["getItem", "setItem", "removeItem"]) {
  test(`Current device handles localStorage.${method} failures without false success or server changes`, async () => {
    const env = await deviceEnvironment(),
      panel = env.panel;
    const original = env.context.localStorage[method];
    if (method === "setItem") {
      panel._removeSelection.click();
      confirmDevice(panel);
    }
    env.context.localStorage[method] = () => {
      throw Error("Storage blocked");
    };
    if (method === "getItem") panel._renderDevice();
    else if (method === "setItem") chooseDeviceProfile(panel, "test-profile");
    else {
      panel._removeSelection.click();
      confirmDevice(panel);
    }
    assert.match(deviceStatus(panel), /Could not|storage/i);
    assert.doesNotMatch(deviceStatus(panel), /selection removed|Profile selected for/);
    assert.equal(env.server.requests.length, 0);
    assert.equal(
      env.window.quickAccessDebug().activeProfileId,
      method === "setItem" ? null : "test-profile",
    );
    env.context.localStorage[method] = original;
    panel._profileRetry.click();
    await flush();
    assert.equal(panel._profileSelect.disabled, false);
  });
}

test("deleted or unknown selections stay unselected and can be replaced by an available profile", async () => {
  const env = await deviceEnvironment(),
    panel = env.panel;
  env.storage.set(selectionKey(), '"missing"');
  storageEvent(env, selectionKey());
  assert.equal(env.window.quickAccessDebug().activeProfileId, null);
  assert.match(deviceStatus(panel), /deleted|unavailable/);
  assert.equal(panel._resetVisibility.disabled, true);
  chooseDeviceProfile(panel, "test-profile");
  assert.equal(env.window.quickAccessDebug().activeProfileId, "test-profile");
  const data = env.server.data("test-user");
  data.profiles = [];
  data.revision++;
  env.server.notify("test-user");
  assert.equal(panel._profileSelect.options.length, 1);
  assert.equal(panel._resetVisibility.disabled, true);
  assert.match(deviceStatus(panel), /deleted|unavailable/);
  assert.equal(env.window.quickAccessDebug().activeProfileId, null);
  assert.equal(env.server.requests.length, 0);
});

test("visibility reset sends only the selected ID and applies immediately to launcher after confirmation", async () => {
  const env = await deviceEnvironment(),
    panel = env.panel;
  const data = env.server.data("test-user"),
    profile = data.profiles[0];
  profile.settings = { ...profile.settings, visibility: "include", routes: ["/missing"] };
  profile.favorites = ["sensor.kitchen"];
  data.profiles.push({ ...clone(profile), id: "other", name: "Other" });
  env.server.notify("test-user");
  panel._resetVisibility.click();
  assert.equal(
    panel.shadowRoot.querySelector(".confirm-device").textContent,
    "Reset display rules",
  );
  assert.equal(env.server.requests.length, 0);
  profile.name = "Remote rename";
  profile.icon = "mdi:cat";
  data.revision++;
  env.server.notify("test-user");
  const before = clone(data.profiles);
  const local = [...env.storage];
  confirmDevice(panel);
  await flush();
  const request = env.server.requests[0];
  assert.deepEqual(request, {
    type: "quick_access/mutate_profile",
    operation: "reset_visibility",
    profile_id: "test-profile",
  });
  assert.deepEqual(data.profiles, [
    { ...before[0], settings: { ...before[0].settings, visibility: "exclude", routes: [] } },
    before[1],
  ]);
  assert.deepEqual([...env.storage], local);
  assert.equal(deviceStatus(panel), "");
  for (const width of [320, 390, 768, 1024, 1440, 5120]) {
    env.resize(width);
    assert.equal(env.fab().hidden, false);
  }
});

test("visibility reset preserves concurrent changes missing from the sidebar snapshot without retrying", async () => {
  const env = await deviceEnvironment(),
    panel = env.panel;
  const data = env.server.data("test-user");
  data.profiles[0].settings = {
    ...data.profiles[0].settings,
    visibility: "include",
    routes: ["/missing"],
  };
  env.server.notify("test-user");
  panel._resetVisibility.click();
  data.revision++;
  data.profiles[0].name = "Concurrent";
  data.profiles[0].settings.links[0].name = "Concurrent shortcut";
  data.profiles[0].favorites = ["light.bedroom"];
  data.profiles[0].device_favorites = ["device-2"];
  const before = clone(env.server.data("test-user"));
  confirmDevice(panel);
  await flush();
  assert.deepEqual(data.profiles, [
    {
      ...before.profiles[0],
      settings: { ...before.profiles[0].settings, visibility: "exclude", routes: [] },
    },
  ]);
  assert.equal(data.revision, before.revision + 1);
  assert.equal(env.server.requests.length, 1);
  assert.equal(env.fab().hidden, false);
  assert.equal(deviceStatus(panel), "");
});

test("failed and disconnected visibility resets preserve server data and show no success", async () => {
  for (const mode of ["failure", "disconnect"]) {
    const env = await deviceEnvironment(),
      panel = env.panel;
    const before = clone(env.server.data("test-user"));
    panel._resetVisibility.click();
    if (mode === "failure") env.server.failWrites = true;
    else env.connection.connected = false;
    confirmDevice(panel);
    await flush();
    assert.deepEqual(env.server.data("test-user"), before);
    assert.doesNotMatch(deviceStatus(panel), /reset saved/);
    assert.match(deviceStatus(panel), /Could not|disconnected/);
    assert.equal(panel._deviceBusy, false);
  }
});

test("reset waits for server confirmation and profile refresh remains usable", async () => {
  const env = await deviceEnvironment(),
    panel = env.panel;
  const mutate = env.connection.sendMessagePromise;
  let resolve;
  env.connection.sendMessagePromise = (request) =>
    new Promise((done) => {
      resolve = async () => done(await mutate(request));
    });
  panel._resetVisibility.click();
  confirmDevice(panel);
  assert.equal(panel._deviceStatus.hidden, true);
  assert.doesNotMatch(deviceStatus(panel), /reset saved/);
  assert.equal(panel._resetVisibility.disabled, true);
  await resolve();
  await flush();
  assert.equal(deviceStatus(panel), "");
  panel._removeSelection.click();
  confirmDevice(panel);
  chooseDeviceProfile(panel, "test-profile");
  env.server.notify("test-user");
  panel._profileRetry.click();
  await flush();
});

test("device profile requests stay quiet while pending and clear errors after recovery", async () => {
  const env = panelEnvironment();
  let receiveProfiles, resolveSubscription, rejectSubscription;
  env.connection.subscribeMessage = (callback) => {
    receiveProfiles = callback;
    return new Promise((resolve, reject) => {
      resolveSubscription = resolve;
      rejectSubscription = reject;
    });
  };
  const panel = await env.mountPanel();
  await flush();
  assert.equal(deviceStatus(panel), "");
  assert.equal(panel._deviceStatus.hidden, true);
  assert.equal(panel._profileSelect.disabled, true);
  rejectSubscription(new Error("Could not load profiles"));
  await flush();
  assert.match(deviceStatus(panel), /Could not load profiles/);
  assert.equal(panel._deviceStatus.hidden, false);
  panel._profileRetry.click();
  await flush();
  assert.match(
    deviceStatus(panel),
    /Could not load profiles/,
    "pending retries preserve the error",
  );
  receiveProfiles(clone(env.server.data("test-user")));
  assert.equal(deviceStatus(panel), "");
  assert.equal(panel._deviceStatus.hidden, true);
  assert.equal(panel._profileSelect.disabled, false);
  resolveSubscription(async () => {});
  await flush();
});

test("profile subscription failure, disconnect and reconnect offer retry", async () => {
  const env = panelEnvironment();
  env.server.failLoads = true;
  const panel = await env.mountPanel();
  await flush();
  assert.match(deviceStatus(panel), /load profiles/);
  assert.equal(panel._profileSelect.disabled, true);
  assert.equal(panel.shadowRoot.querySelector("form"), null);
  env.server.failLoads = false;
  panel._profileRetry.click();
  await flush();
  assert.equal(panel._profileSelect.disabled, false);
  env.connection.connected = false;
  env.connection.dispatchEvent(new Event("disconnected"));
  await flush();
  assert.equal(panel._resetVisibility.disabled, true);
  assert.match(deviceStatus(panel), /disconnected/);
  env.connection.connected = true;
  env.connection.dispatchEvent(new Event("ready"));
  await flush();
  assert.equal(panel._profileSelect.disabled, false);
  assert.equal(env.server.listeners.size, 1);
});

test("device context changes discard private data, ignore late results and clean up subscriptions and listeners", async () => {
  const env = panelEnvironment(),
    panel = await env.mountPanel();
  await flush();
  const previous = [...env.server.listeners][0].callback;
  const data = clone(env.server.data("test-user"));
  panel._resetVisibility.click();
  env.status.hass.user = { id: "bob", is_admin: true };
  env.storage.set(selectionKey("test-instance", "bob"), '"bob-profile"');
  env.server.data("bob").profiles.push({ ...data.profiles[0], id: "bob-profile", name: "Bob" });
  panel.hass = env.status.hass;
  await flush();
  previous(data);
  assert.match(panel._deviceName.textContent, /Bob/);
  assert.deepEqual(clone(panel._profileSelect.options.map((p) => p.value)), ["", "bob-profile"]);
  assert.equal(panel.shadowRoot.querySelector(".device-confirmation"), null);
  assert.equal(env.server.listeners.size, 1);
  panel._removeSelection.click();
  confirmDevice(panel);
  assert.equal(env.storage.get(selectionKey()), '"test-profile"');
  assert.equal(env.storage.has(selectionKey("test-instance", "bob")), false);
  panel.remove();
  panel.disconnectedCallback();
  await flush();
  assert.equal(env.server.listeners.size, 0);
  for (const event of ["storage", "quick-access-profile-selection-changed"])
    assert.equal(getEventListeners(env.window, event).length, 0);
  for (const event of ["ready", "disconnected"])
    assert.equal(getEventListeners(env.connection, event).length, 0);
});

test("reset applies confirmed visibility immediately even with an open launcher settings draft", async () => {
  const env = await deviceEnvironment(),
    panel = env.panel;
  openLauncherSettings(env);
  const paths = env.document.body.querySelector(".qap-textarea");
  paths.value = "/private/draft";
  panel._resetVisibility.click();
  confirmDevice(panel);
  await flush();
  assert.equal(env.window.quickAccessDebug().hiddenByRoute, false);
  assert.equal(env.window.quickAccessDebug().dialogOpen, true);
  assert.equal(env.document.body.querySelector(".qap-textarea"), paths);
  assert.equal(paths.value, "/private/draft");
  env.resize(5120);
  assert.equal(env.fab().hidden, false);
  assert.equal(deviceStatus(panel), "");
  env.document.body.querySelector(".qap-save-settings").click();
  await flush();
  assert.equal(env.server.data("test-user").profiles[0].settings.routes[0], undefined);
  assert.match(env.window.quickAccessDebug().profileError, /changed on another device/);
});

for (const fail of [false, true]) {
  test(`same-profile refresh releases the saving lock after a late ${fail ? "failure" : "acknowledgement"}`, async () => {
    const env = await deviceEnvironment(),
      panel = env.panel;
    openLauncherSettings(env);
    const send = env.connection.sendMessagePromise;
    let finish;
    env.connection.sendMessagePromise = async (request) => {
      const result = fail ? null : await send(request);
      return new Promise((resolve, reject) => {
        finish = () => (fail ? reject(Error("Response lost")) : resolve(result));
      });
    };
    const root = env.document.body;
    const paths = root.querySelector(".qap-textarea");
    const body = root.querySelector(".qap-body");
    const save = root.querySelector(".qap-save-settings");
    paths.value = "/private/draft";
    save.click();
    await flush();
    assert.equal(env.window.quickAccessDebug().profileSaving, true);

    env.connection.sendMessagePromise = send;
    panel._resetVisibility.click();
    confirmDevice(panel);
    await flush();
    assert.equal(env.window.quickAccessDebug().profileSaving, true);
    assert.equal(body.inert, true);
    assert.equal(save.disabled, true);

    finish();
    await flush();
    assert.equal(env.window.quickAccessDebug().profileSaving, false);
    assert.equal(body.inert, false);
    assert.equal(save.disabled, false);
    assert.equal(root.querySelector(".qap-textarea"), paths);
    assert.equal(paths.value, "/private/draft");
    assert.equal(env.window.quickAccessDebug().profileRevision, 0);
    assert.equal(env.window.quickAccessDebug().serverRevision, fail ? 1 : 2);
    assert.equal(env.window.quickAccessDebug().profileError, "");
    assert.deepEqual(env.server.data("test-user").profiles[0].settings.routes, []);

    const requests = env.server.requests.length;
    save.click();
    await flush();
    assert.equal(
      env.server.requests.length,
      requests + 1,
      "the form can submit again after refresh",
    );
    assert.match(env.window.quickAccessDebug().profileError, /changed on another device/);
    assert.equal(env.window.quickAccessDebug().profileSaving, false);
    assert.deepEqual(env.server.data("test-user").profiles[0].settings.routes, []);
  });
}

test("an older save cannot release a newer save's lock after reselecting the same profile", async () => {
  const env = await startProfiles(environment());
  openLauncherSettings(env);
  const send = env.connection.sendMessagePromise;
  const acknowledgements = [];
  env.connection.sendMessagePromise = async (request) => {
    const result = await send(request);
    return new Promise((resolve) => {
      acknowledgements.push(() => resolve(result));
    });
  };
  env.document.body.querySelector(".qap-save-settings").click();
  await flush();
  env.storage.delete(selectionKey());
  storageEvent(env, selectionKey());
  env.storage.set(selectionKey(), '"test-profile"');
  storageEvent(env, selectionKey());
  await flush();

  openLauncherSettings(env);
  const body = env.document.body.querySelector(".qap-body");
  const save = env.document.body.querySelector(".qap-save-settings");
  env.document.body.querySelector(".qap-textarea").value = "/new/save";
  save.click();
  await flush();
  assert.equal(acknowledgements.length, 2);
  acknowledgements[0]();
  await flush();
  assert.equal(env.window.quickAccessDebug().profileSaving, true);
  assert.equal(body.inert, true);
  assert.equal(save.disabled, true);

  acknowledgements[1]();
  await flush();
  assert.equal(env.window.quickAccessDebug().profileSaving, false);
  assert.equal(env.window.quickAccessDebug().profileRevision, 2);
  assert.deepEqual(env.server.data("test-user").profiles[0].settings.routes, ["/new/save"]);
});

test("late launcher save results cannot restore a removed selection or stale visibility after reselecting", async () => {
  const env = await deviceEnvironment(),
    panel = env.panel;
  openLauncherSettings(env);
  const mutate = env.connection.sendMessagePromise;
  let resolve;
  env.connection.sendMessagePromise = async (request) => {
    const result = await mutate(request);
    return new Promise((done) => {
      resolve = () => done(result);
    });
  };
  env.document.body.querySelector(".qap-textarea").value = "/private/draft";
  env.document.body.querySelector(".qap-save-settings").click();
  await flush();
  panel._removeSelection.click();
  confirmDevice(panel);
  chooseDeviceProfile(panel, "test-profile");
  env.connection.sendMessagePromise = mutate;
  panel._resetVisibility.click();
  confirmDevice(panel);
  await flush();
  assert.equal(env.window.quickAccessDebug().hiddenByRoute, false);
  resolve();
  await flush();
  assert.equal(env.window.quickAccessDebug().hiddenByRoute, false);
  assert.equal(env.window.quickAccessDebug().activeProfileId, "test-profile");
  assert.equal(deviceStatus(panel), "");
});

test("an empty own-user collection disables reset without a status notice", async () => {
  const env = panelEnvironment();
  env.server.data("test-user").profiles = [];
  env.server.data("test-user").revision = 1;
  env.storage.delete(selectionKey());
  const panel = await env.mountPanel();
  await flush();
  assert.equal(panel._deviceName.textContent, "No profile selected in this browser");
  assert.equal(panel._resetVisibility.disabled, true);
  assert.equal(panel._removeSelection.disabled, true);
  assert.equal(deviceStatus(panel), "");
  assert.equal(panel._deviceStatus.hidden, true);
  assert.equal(env.server.requests.length, 0);
});

test("late reset results and invalid profile snapshots cannot update a replacement context", async () => {
  const env = await deviceEnvironment(),
    panel = env.panel;
  let resolve;
  env.connection.sendMessagePromise = () =>
    new Promise((done) => {
      resolve = done;
    });
  panel._resetVisibility.click();
  confirmDevice(panel);
  const data = clone(env.server.data("test-user"));
  panel.remove();
  panel.disconnectedCallback();
  const status = deviceStatus(panel);
  resolve(data);
  await flush();
  assert.equal(deviceStatus(panel), status);
  assert.doesNotMatch(deviceStatus(panel), /reset saved/);
  const other = panelEnvironment();
  other.server.data("test-user").revision = -1;
  const invalidPanel = await other.mountPanel();
  await flush();
  assert.match(deviceStatus(invalidPanel), /Invalid profile data/);
  assert.equal(invalidPanel._profileSelect.disabled, true);
});

test("malformed local selections behave like no selection and allow choosing a saved profile", async () => {
  const env = await deviceEnvironment(),
    panel = env.panel;
  env.storage.set(selectionKey(), "broken JSON");
  storageEvent(env, selectionKey());
  assert.equal(env.window.quickAccessDebug().activeProfileId, null);
  assert.equal(panel._profileSelect.value, "");
  assert.equal(panel._profileSelect.disabled, false);
  chooseDeviceProfile(panel, "test-profile");
  assert.equal(env.window.quickAccessDebug().activeProfileId, "test-profile");
  assert.equal(env.fab().hidden, false);
});

test("removal remains local and available after a profile connection disconnects", async () => {
  const env = await deviceEnvironment(),
    panel = env.panel;
  env.connection.connected = false;
  env.connection.dispatchEvent(new Event("disconnected"));
  await flush();
  assert.equal(panel._removeSelection.disabled, false);
  assert.equal(panel._resetVisibility.disabled, true);
  panel._removeSelection.click();
  confirmDevice(panel);
  assert.equal(env.storage.has(selectionKey()), false);
  assert.equal(env.fab().hidden, false);
  assert.equal(env.fab().attributes["aria-label"], "Set up Quick Access");
  assert.equal(env.server.requests.length, 0);
});

for (const selection of [null, "deleted-profile"]) {
  test(`Setup ignores saved route restrictions for ${selection || "no local selection"}`, async () => {
    const env = environment();
    const profile = env.server.data("test-user").profiles[0];
    profile.settings = { ...profile.settings, visibility: "include", routes: ["/missing"] };
    if (selection) env.storage.set(selectionKey(), JSON.stringify(selection));
    else env.storage.delete(selectionKey());
    env.resize(5120);
    const before = clone(profile);
    await startProfiles(env, false);
    assert.equal(env.window.quickAccessDebug().activeProfileId, null);
    assert.equal(env.fab().hidden, false);
    env.fab().click();
    const manager = env.document.body.querySelector(".qap-profiles");
    await clickAndFlush(profileRowIn(manager, profile.id).querySelector(".qap-profile-activate"));
    assert.equal(env.window.quickAccessDebug().activeProfileId, profile.id);
    assert.equal(env.fab().hidden, true);
    assert.deepEqual(profile, before);
    assert.equal(env.server.requests.length, 0);
  });
}

test("deleting the selected profile switches to Setup without selecting another saved profile", async () => {
  const env = await startProfiles(environment());
  const data = env.server.data("test-user");
  const other = { ...clone(data.profiles[0]), id: "other", name: "Other" };
  data.profiles.push(other);
  await env.server.mutate("test-user", {
    operation: "delete",
    profile_id: "test-profile",
    revision: 0,
  });
  assert.equal(env.window.quickAccessDebug().activeProfileId, null);
  assert.equal(env.fab().hidden, false);
  env.fab().click();
  assert.ok(env.document.body.querySelector(".qap-profiles"));
  assert.deepEqual(data.profiles, [other]);
});
