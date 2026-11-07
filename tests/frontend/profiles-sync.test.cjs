// Profile collection synchronization, limits, conflicts and storage.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const { getEventListeners } = require("node:events");
const path = require("node:path");
const test = require("node:test");
const {
  flush,
  clickAndFlush,
  dispatchAndFlush,
  defaultCategories,
  defaultSettings,
  clone,
  ProfileServer,
  savedProfile,
  environment,
  buttons,
  respondToDiscard,
  openLauncherSettings,
  openSettingsScreen,
  returnToLauncher,
  openShortcutsSettings,
  openArrangement,
  arrangeKey,
  startProfiles,
  profileManager,
  useProfile,
  profileRowIn,
  activeProfileEditor,
  profileNameInput,
  manageProfile,
  createProfileInDialog,
  deviceKey,
} = require("./harness.cjs");

test("profile limit permits the tenth profile and editing but blocks create and duplicate", async () => {
  const env = environment();
  const data = env.server.data("test-user");
  const original = clone(data.profiles[0]);
  for (let index = 1; index < 9; index++)
    data.profiles.push({ ...clone(original), id: `profile_${index}`, name: `Profile ${index}` });
  await startProfiles(env);
  await createProfileInDialog(env, "Tenth");
  assert.equal(data.profiles.length, 10);
  const before = clone(data);
  const requests = env.server.requests.length;
  await createProfileInDialog(env, "Eleventh");
  let editor = activeProfileEditor(env);
  assert.equal(profileNameInput(editor).value, "Eleventh");
  assert.match(
    editor.querySelector(".qap-profile-status").querySelector(".qap-error").textContent,
    /Profile limit reached/,
  );
  assert.equal(env.server.requests.length, requests);
  assert.deepEqual(data, before);
  editor.querySelector(".qap-profile-cancel").click();
  respondToDiscard(env);
  await flush();
  editor = await manageProfile(env, original.id, "duplicate");
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.match(
    editor.querySelector(".qap-profile-status").querySelector(".qap-error").textContent,
    /Profile limit reached/,
  );
  assert.equal(env.server.requests.length, requests);
  await clickAndFlush(editor.querySelector(".qap-profile-cancel"));
  editor = await manageProfile(env, original.id, "edit");
  profileNameInput(editor).value = "Renamed at limit";
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.equal(data.profiles[0].name, "Renamed at limit");
  assert.equal(data.profiles.length, 10);
});

test("first installation explicitly creates one confirmed Default profile and stores only device data locally", async () => {
  const env = await startProfiles(environment(undefined, new ProfileServer(), { fresh: true }));
  const data = env.server.data("test-user");
  assert.equal(data.profiles.length, 1);
  assert.equal(data.profiles[0].name, "Default");
  assert.equal(data.profiles[0].color, "indigo");
  assert.deepEqual(data.profiles[0].settings, defaultSettings());
  assert.deepEqual(
    data.profiles[0].settings.links.map(({ name, type, path }) => ({ name, type, path })),
    [
      { name: "Entity Explorer", type: "quick-states", path: "" },
      { name: "Device Explorer", type: "quick-devices", path: "" },
    ],
  );
  assert.deepEqual(data.profiles[0].categories, defaultCategories());
  assert.equal(env.window.quickAccessDebug().activeProfileId, data.profiles[0].id);
  assert.deepEqual(
    [...env.storage.keys()],
    ["quick_access_v1:test-instance:test-user:active-profile"],
  );
  env.fab().click();
  assert.deepEqual(
    env.document.body
      .querySelectorAll(".qap-tile-icon")
      .map((tile) => tile.querySelector("qap-icon").style.color),
    ["var(--cyan-color)", "var(--teal-color)"],
  );
  const manager = await profileManager(env);
  assert.equal(
    manager.querySelector(".qap-current-profile").querySelector("qap-icon").style.color,
    "var(--indigo-color)",
  );
  env.enable(true);
  await dispatchAndFlush(env.connection, new Event("ready"));
  assert.equal(data.profiles.length, 1);
  assert.equal(env.server.listeners.size, 1);
});

test("shared profiles synchronize favorites/settings across active devices and local data stays separate", async () => {
  const server = new ProfileServer();
  const a = await startProfiles(environment(undefined, server, { fresh: true }));
  const id = server.data("test-user").profiles[0].id;
  const b = await startProfiles(environment("https://ha.example.org", server, { fresh: true }));
  await useProfile(b, id);
  await clickAndFlush(b.document.body.querySelector(".qap-head-button"));
  a.storage.set(`${deviceKey(a)}:position`, JSON.stringify({ x: 0.2, y: 0.3 }));
  a.storage.set(`${deviceKey(a)}:states-search-history`, JSON.stringify(["private"]));
  await useProfile(a, id);
  openSettingsScreen(a, "visibility");
  a.document.body.querySelector(".qap-textarea").value = "/lovelace/*";
  await clickAndFlush(a.document.body.querySelector(".qap-save-settings"));
  assert.equal(b.window.quickAccessDebug().hiddenByRoute, true);
  assert.equal(b.storage.has(`${deviceKey(b)}:position`), false);
  assert.equal(b.storage.has(`${deviceKey(b)}:states-search-history`), false);
  const updated = clone(server.data("test-user").profiles[0]);
  updated.favorites = ["sensor.shared"];
  await server.mutate("test-user", {
    operation: "update",
    profile_id: id,
    revision: server.data("test-user").revision,
    profile: updated,
  });
  b.status.hass.states = {
    "sensor.shared": { entity_id: "sensor.shared", state: "21", attributes: {} },
  };
  // Leave the hidden route before inspecting the synchronized favorite.
  b.window.location.pathname = "/config";
  b.window.dispatchEvent(new Event("location-changed"));
  openLauncherSettings(b);
  returnToLauncher(b);
  await flush();
  b.fab().click();
  b.document.body.querySelector(".qap-tile").click();
  assert.equal(
    b.document.body.querySelector(".qap-favorites-tab").attributes["aria-pressed"],
    "true",
  );
});

test("local position and searches are isolated between profiles, users and instance IDs", async () => {
  const env = await startProfiles(environment());
  env.storage.set(`${deviceKey(env)}:position`, JSON.stringify({ x: 0.2, y: 0.3 }));
  env.storage.set(`${deviceKey(env)}:states-search-history`, JSON.stringify(["phone search"]));
  await createProfileInDialog(env, "Tablet");
  assert.equal(env.storage.has(`${deviceKey(env)}:position`), false);
  await useProfile(env, "test-profile");
  assert.equal(env.fab().style.left, "68.4px");
  env.status.hass.user = { id: "bob" };
  await env.tick(15000);
  await flush();
  assert.notEqual(env.window.quickAccessDebug().activeProfileId, "test-profile");
  assert.equal(env.fab().style.left, "auto");
  assert.equal(env.server.data("bob").profiles.length, 0);
  assert.equal(env.fab().attributes["aria-label"], "Set up Quick Access");
  const other = environment(undefined, new ProfileServer("other-instance"), { fresh: true });
  for (const [key, value] of env.storage) other.storage.set(key, value);
  await startProfiles(other);
  assert.notEqual(other.window.quickAccessDebug().activeProfileId, "test-profile");
  assert.equal(other.fab().style.left, "auto");
});

test("concurrent editing preserves the losing draft until explicit reload and never overwrites the winner", async () => {
  const server = new ProfileServer();
  const a = await startProfiles(environment(undefined, server, { fresh: true }));
  const id = server.data("test-user").profiles[0].id;
  const b = await startProfiles(environment(undefined, server, { fresh: true }));
  await useProfile(a, id);
  await useProfile(b, id);
  openSettingsScreen(a, "visibility");
  openSettingsScreen(b, "visibility");
  const draft = b.document.body.querySelector(".qap-textarea");
  draft.value = "/private/concurrent";
  a.document.body.querySelector(".qap-textarea").value = "/private/shared";
  await clickAndFlush(a.document.body.querySelector(".qap-save-settings"));
  assert.equal(b.document.body.querySelector(".qap-textarea"), draft);
  assert.equal(draft.value, "/private/concurrent");
  await clickAndFlush(b.document.body.querySelector(".qap-save-settings"));
  assert.equal(draft.value, "/private/concurrent");
  assert.match(b.window.quickAccessDebug().profileError, /changed on another device/);
  assert.equal(server.data("test-user").profiles[0].settings.routes[0], "/private/shared");
  buttons(b.document.body)
    .find((button) => button.textContent === "Reload saved profiles")
    .click();
  const confirmation = b.document.body.querySelector(".qap-reload-profiles-confirmation");
  await clickAndFlush(confirmation.querySelector(".qap-button-danger"));
  assert.equal(b.document.body.querySelector(".qap-textarea").value, "/private/shared");
});

test("disconnect/reconnect reloads profiles, preserves drafts, retries failures and cleans subscriptions", async () => {
  const env = await startProfiles(environment());
  openLauncherSettings(env);
  const draft = env.document.body.querySelector(".qap-textarea");
  draft.value = "/private/settings";
  env.connection.connected = false;
  env.connection.dispatchEvent(new Event("disconnected"));
  await clickAndFlush(env.document.body.querySelector(".qap-save-settings"));
  assert.equal(draft.value, "/private/settings");
  assert.equal(env.server.data("test-user").profiles[0].settings.routes[0], undefined);
  const changed = clone(env.server.data("test-user").profiles[0]);
  changed.settings.routes = ["/lovelace/*"];
  await env.server.mutate("test-user", {
    operation: "update",
    profile_id: changed.id,
    revision: 0,
    profile: changed,
  });
  env.server.failLoads = true;
  env.connection.connected = true;
  await dispatchAndFlush(env.connection, new Event("ready"));
  assert.equal(env.server.listeners.size, 0);
  assert.equal(env.document.body.querySelector(".qap-textarea"), draft);
  env.server.failLoads = false;
  await env.tick(5000);
  assert.equal(env.server.listeners.size, 1);
  assert.equal(draft.value, "/private/settings");
  env.enable(false);
  await flush();
  assert.equal(env.server.listeners.size, 0);
  assert.equal(env.timers.size, 0);
  env.enable(true);
  await flush();
  assert.equal(env.server.listeners.size, 1);
  assert.equal(env.window.quickAccessDebug().hiddenByRoute, true);
});

test("profile unsubscribe failures cannot interrupt teardown or prevent reactivation", async () => {
  for (const mode of ["throw", "reject"]) {
    const env = environment();
    const subscribe = env.connection.subscribeMessage;
    let calls = 0;
    env.connection.subscribeMessage = async (...args) => {
      const unsubscribe = await subscribe(...args);
      if (args[1].type !== "quick_access/subscribe_profiles") return unsubscribe;
      return () => {
        calls++;
        const cleanup = unsubscribe();
        const error = new Error("HA unsubscribe failed");
        if (mode === "throw") throw error;
        return cleanup.then(() => {
          throw error;
        });
      };
    };
    await startProfiles(env);
    await profileManager(env);
    assert.doesNotThrow(() => env.enable(false));
    await flush();
    assert.equal(calls, 1);
    assert.equal(env.server.listeners.size, 0);
    assert.equal(env.document.body.children.length, 0);
    assert.equal(env.document.head.children.length, 0);
    assert.equal(env.timers.size, 0);
    assert.equal(getEventListeners(env.window, "show-dialog").length, 0);
    env.enable(true);
    await flush();
    assert.ok(env.fab());
    assert.equal(env.server.listeners.size, 1);
  }
});

test("late save responses and subscription events cannot apply to another authenticated user", async () => {
  const env = await startProfiles(environment());
  openLauncherSettings(env);
  let resolveSave;
  const oldData = clone(env.server.data("test-user"));
  env.connection.sendMessagePromise = () =>
    new Promise((resolve) => {
      resolveSave = resolve;
    });
  env.document.body.querySelector(".qap-textarea").value = "/private/shared";
  env.document.body.querySelector(".qap-save-settings").click();
  const oldCallback = [...env.server.listeners][0].callback;
  env.status.hass.user = { id: "bob" };
  await env.tick(15000);
  env.connection.sendMessagePromise = (message) => env.server.mutate("bob", message);
  await flush();
  resolveSave(oldData);
  oldCallback(oldData);
  await flush();
  assert.notEqual(env.window.quickAccessDebug().activeProfileId, "test-profile");
  assert.equal(env.window.quickAccessDebug().hiddenByRoute, false);
  assert.equal(env.server.listeners.size, 1);
});

test("unavailable browser storage preserves launcher profile selection and editing for the session", async () => {
  const env = environment();
  await startProfiles(env);
  openLauncherSettings(env);
  const original = clone(env.server.data("test-user").profiles[0]);
  env.server.data("test-user").profiles.push({ ...original, id: "alternate", name: "Alternate" });
  env.server.notify("test-user");
  for (const method of ["getItem", "setItem", "removeItem"])
    env.context.localStorage[method] = () => {
      throw new Error("Storage blocked");
    };
  await useProfile(env, "alternate");
  assert.equal(env.window.quickAccessDebug().activeProfileId, "alternate");
  openSettingsScreen(env, "visibility");
  env.document.body.querySelector(".qap-textarea").value = "/private/settings";
  await clickAndFlush(env.document.body.querySelector(".qap-save-settings"));
  assert.equal(env.server.data("test-user").profiles[1].settings.routes[0], "/private/settings");
});

test("load failures and invalid server data never create or overwrite profiles with defaults", async () => {
  for (const mode of ["offline", "invalid"]) {
    const server = new ProfileServer();
    server.failLoads = mode === "offline";
    if (mode === "invalid") server.data("test-user").version = 999;
    const env = await startProfiles(environment(undefined, server, { fresh: true }));
    assert.equal(server.requests.length, 0);
    assert.match(env.window.quickAccessDebug().profileError, /load profiles|Invalid/);
    env.enable(false);
    await flush();
    assert.equal(env.timers.size, 0);
  }
});

test("invalid saved shortcuts are rejected without repairing or overwriting the collection", async () => {
  const invalidLinks = [
    (link) => {
      delete link.icon;
    },
    (link) => {
      delete link.color;
    },
    (link) => {
      link.color = 123;
    },
    (link) => {
      link.color = {};
    },
    ...[null, 0, 1, "true", {}, []].map((hidden) => (link) => {
      link.hidden = hidden;
    }),
    (link) => {
      delete link.group;
    },
    (link) => {
      link.id = "";
    },
    (link) => {
      link.name = "";
    },
    (link) => {
      link.name = "x".repeat(51);
    },
    (link) => {
      link.icon = " mdi:hammer ";
    },
    (link) => {
      link.icon = "unknown";
    },
    (link) => {
      link.icon = "";
    },
    (link) => {
      link.icon = null;
    },
    (link) => {
      link.type = "unknown";
    },
    (link) => {
      link.path = null;
    },
    (link) => {
      link.extra = true;
    },
    (link, links) => {
      links.push(clone(link));
    },
  ];
  for (const invalidate of invalidLinks) {
    const env = environment();
    const data = env.server.data("test-user");
    const links = data.profiles[0].settings.links;
    invalidate(links[0], links);
    const saved = clone(data.profiles);
    await startProfiles(env, false);
    assert.match(env.window.quickAccessDebug().profileError, /Invalid server profile data/);
    assert.equal(env.window.quickAccessDebug().activeProfileId, null);
    assert.equal(env.server.requests.length, 0);
    assert.deepEqual(data.profiles, saved);
    env.enable(false);
    await flush();
  }
});

test("deletion requires confirmation, affects shared devices and preserves unrelated profiles", async () => {
  const server = new ProfileServer();
  const a = await startProfiles(environment(undefined, server, { fresh: true }));
  const id = server.data("test-user").profiles[0].id;
  const other = {
    id: "other",
    name: "Other",
    icon: "mdi:devices",
    settings: defaultSettings(),
    favorites: ["sensor.other"],
    categories: defaultCategories(),
  };
  await server.mutate("test-user", {
    operation: "create",
    profile_id: other.id,
    revision: server.data("test-user").revision,
    profile: other,
  });
  const b = await startProfiles(environment(undefined, server, { fresh: true }));
  await useProfile(b, id);
  b.document.body.querySelector(".qap-head-button").click();
  const localData = new Map();
  for (const env of [a, b]) {
    const entries = [
      [
        `${deviceKey(env)}:states-search-history`,
        JSON.stringify([env === a ? "phone search" : "tablet search"]),
      ],
      [`${deviceKey(env)}:position`, JSON.stringify({ x: 0.2, y: 0.3 })],
      [`${deviceKey(env, "test-user", other.id)}:states-search-history`, '["other search"]'],
      ["hassTokens", "unrelated HA data"],
    ];
    for (const [key, value] of entries) env.storage.set(key, value);
    localData.set(env, entries);
  }
  await manageProfile(a, id, "delete");
  let confirmation = a.document.body.querySelector(".qap-delete-profile-confirmation");
  buttons(confirmation)
    .find((button) => button.textContent === "Cancel")
    .click();
  assert.equal(server.data("test-user").profiles.length, 2);
  await manageProfile(a, id, "delete");
  confirmation = a.document.body.querySelector(".qap-delete-profile-confirmation");
  assert.match(
    confirmation.querySelector("#qap-delete-profile-description").textContent,
    /from Home Assistant/,
  );
  assert.match(
    confirmation.querySelector(".qap-profile-notice").querySelector("span").textContent,
    /all devices/,
  );
  await clickAndFlush(confirmation.querySelector(".qap-button-danger"));
  assert.deepEqual(server.data("test-user").profiles, [other]);
  assert.equal(b.window.quickAccessDebug().activeProfileId, null);
  assert.equal(a.window.quickAccessDebug().activeProfileId, null);
  for (const env of [a, b]) {
    for (const [key, value] of localData.get(env)) assert.equal(env.storage.get(key), value);
    assert.equal(profileRowIn(await profileManager(env), id), undefined);
    await useProfile(env, other.id);
    assert.equal(env.window.quickAccessDebug().activeProfileId, other.id);
    assert.deepEqual(JSON.parse(env.storage.get(`${deviceKey(env)}:states-search-history`)), [
      "other search",
    ]);
  }
});

test("pending saves keep the form inert and do not navigate or announce success before acknowledgement", async () => {
  const env = await startProfiles(environment());
  openLauncherSettings(env);
  let acknowledge;
  env.connection.sendMessagePromise = (message) =>
    new Promise((resolve) => {
      acknowledge = async () => {
        const result = await env.server.mutate("test-user", message);
        assert.equal(
          env.document.body.querySelector(".qap-profile-status").children.length,
          0,
          "the save notification must not flash a remote-change warning before acknowledgement",
        );
        resolve(result);
      };
    });
  const body = env.document.body.querySelector(".qap-body");
  env.document.body.querySelector(".qap-textarea").value = "/private/settings";
  env.document.body.querySelector(".qap-save-settings").click();
  assert.equal(body.inert, true);
  assert.equal(
    env.document.body.querySelector(".qap-save-settings").disabled,
    true,
    "The fixed footer action is disabled during saves too",
  );
  assert.equal(env.document.body.querySelector(".qap-profile-status").children.length, 0);
  assert.equal(env.window.quickAccessDebug().hiddenByRoute, false);
  assert.equal(env.document.body.querySelector("qap-dialog").headerTitle, "Display rules");
  await acknowledge();
  await flush();
  assert.equal(env.window.quickAccessDebug().profileRevision, 1);
  assert.equal(env.window.quickAccessDebug().profileSaving, false);
});

test("remote profile updates preserve typed profile names and newly opened chooser drafts", async () => {
  for (const selected of [true, false]) {
    const env = await startProfiles(environment());
    if (!selected) {
      env.storage.delete("quick_access_v1:test-instance:test-user:active-profile");
      env.enable(false);
      env.enable(true);
      await flush();
    }
    const manager = await profileManager(env);
    manager.querySelector(".qap-create-profile").click();
    const editor = activeProfileEditor(env);
    const draft = profileNameInput(editor);
    draft.value = "Unsaved tablet name";
    const saved = clone(env.server.data("test-user").profiles[0]);
    saved.name = "Remote rename";
    await env.server.mutate("test-user", {
      operation: "update",
      profile_id: saved.id,
      revision: 0,
      profile: saved,
    });
    assert.equal(
      env.document.body.querySelector(".qap-profiles"),
      manager.querySelector(".qap-profiles"),
    );
    assert.equal(activeProfileEditor(env), editor);
    assert.equal(draft.value, "Unsaved tablet name");
  }
});

test("retrying a create after its acknowledgement is lost uses the confirmed profile even at the limit", async () => {
  const env = environment();
  const data = env.server.data("test-user");
  for (let index = 1; index < 9; index++)
    data.profiles.push({
      ...clone(data.profiles[0]),
      id: `profile_${index}`,
      name: `Profile ${index}`,
    });
  await startProfiles(env);
  const manager = await profileManager(env);
  manager.querySelector(".qap-create-profile").click();
  const editor = activeProfileEditor(env);
  profileNameInput(editor).value = "Tablet";
  env.connection.sendMessagePromise = async (message) => {
    await env.server.mutate("test-user", message);
    throw new Error("Response lost");
  };
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.equal(data.profiles.length, 10);
  env.connection.sendMessagePromise = (message) => env.server.mutate("test-user", message);
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.equal(data.profiles.length, 10);
  assert.equal(env.window.quickAccessDebug().activeProfileId, data.profiles.at(-1).id);
});

test("arrangement cancellation and failed Save preserve unrelated visibility settings", async () => {
  for (const cancel of [true, false]) {
    const env = await openShortcutsSettings("/config");
    const before = clone(savedProfile(env));
    const view = await openArrangement(env);
    await arrangeKey(view.list.children[0], "ArrowRight");
    if (cancel) {
      view.form.querySelector(".qap-category-cancel").click();
      respondToDiscard(env, true);
    } else {
      env.server.failWrites = true;
      await clickAndFlush(view.form.querySelector(".qap-category-submit"));
    }
    assert.deepEqual(savedProfile(env), before);
    assert.equal(env.server.requests.length, cancel ? 0 : 1);
  }
});

test("an initial lifecycle subscription resolving for an old user is cleaned up and retried for the current user", async () => {
  const env = environment();
  const subscribe = env.connection.subscribeMessage;
  let finish;
  let delayed = false;
  env.connection.subscribeMessage = async (...args) => {
    const unsubscribe = await subscribe(...args);
    if (args[1].type === "quick_access/subscribe_status" && !delayed) {
      delayed = true;
      await new Promise((resolve) => {
        finish = resolve;
      });
    }
    return unsubscribe;
  };
  await env.run();
  await env.tick();
  env.status.hass.user = { id: "bob" };
  finish();
  await flush();
  await env.tick();
  env.enable(true);
  await flush();
  assert.equal(env.status.subscriptions, 2);
  assert.equal(env.status.unsubscriptions, 1);
  assert.notEqual(env.window.quickAccessDebug().activeProfileId, "test-profile");
  assert.equal(env.server.listeners.size, 1);
});
