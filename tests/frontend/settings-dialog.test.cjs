// Settings overview, owned dialog slots and dirty-form dismissal guards.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  loadDefaults,
  installLocaleFetch,
  changeLanguage,
  flush,
  clickAndFlush,
  dispatchAndFlush,
  defaultCategories,
  clone,
  Element,
  environment,
  nativeComponents,
  respondToDiscard,
  openLauncherSettings,
  navigationEnvironment,
  startProfiles,
  profileRowIn,
  openCategoriesManager,
  selectionKey,
  storageEvent,
  EventTargetDouble,
} = require("./harness.cjs");
let defaultLinks;
test.before(async () => ({ defaultLinks } = await loadDefaults()));

test("owned settings rows survive failed HA loading and late registration without taking focus", async () => {
  const env = environment();
  const components = nativeComponents(env, false);
  env.window.loadCardHelpers = async () => {
    throw new Error("offline");
  };
  installLocaleFetch(env);
  await startProfiles(env);
  openLauncherSettings(env, "settings");
  await flush();
  const root = env.document.body;
  const profile = root.querySelector(".qap-settings-profiles");
  assert.equal(profile.localName, "qap-list-item");
  profile.click();
  assert.ok(root.querySelector(".qap-profiles"));
  root.querySelector(".qap-head-button").click();
  const fallback = root.querySelector(".qap-settings-profiles");
  const host = fallback.parentElement;
  env.document.activeElement = fallback;
  components.register("qap-list-item");
  await flush();
  assert.equal(
    root.querySelector(".qap-settings-shortcuts").localName,
    "qap-list-item",
    "HA registration does not affect owned rows",
  );
  components.register("qap-list");
  await flush();
  assert.equal(
    root.querySelector(".qap-settings-profiles"),
    fallback,
    "Focused fallback remains usable",
  );
  assert.equal(env.document.activeElement, fallback);
  assert.equal(root.querySelector(".qap-settings-shortcuts").localName, "qap-list-item");
  env.document.activeElement = root;
  await dispatchAndFlush(host, new Event("focusout"));
  assert.equal(root.querySelector(".qap-settings-profiles").localName, "qap-list-item");
  assert.equal(
    root.querySelectorAll(".qap-settings-row").length,
    4,
    "Upgrade replaces the fallback actions",
  );
  await changeLanguage(env, "hr");
  assert.equal(
    root.querySelector(".qap-settings-shortcuts").querySelector("small").textContent,
    `${defaultLinks.length} prečaca`,
  );
  root.querySelector(".qap-settings-visibility").click();
  assert.ok(root.querySelector(".qap-save-settings"));
});

test("settings overview summaries follow profile selection, remote changes and backend limits", async () => {
  const env = await startProfiles(environment());
  const data = env.server.data("test-user");
  data.profiles.push({
    ...clone(data.profiles[0]),
    id: "phone",
    name: "Phone",
    icon: "mdi:cellphone",
    categories: [...defaultCategories(), { id: "room", name: "Room" }],
    settings: { visibility: "include", routes: ["/config/*", "/lovelace/home"], links: [] },
  });
  data.revision++;
  env.server.notify("test-user");
  openLauncherSettings(env, "settings");
  const root = env.document.body;
  assert.equal(
    root.querySelector(".qap-settings-shortcuts").querySelector("small").textContent,
    `${defaultLinks.length} shortcuts`,
  );
  assert.equal(
    root.querySelector(".qap-settings-visibility").querySelector("small").textContent,
    "Shown on all pages",
  );
  root.querySelector(".qap-manage-profiles").click();
  profileRowIn(root.querySelector(".qap-profiles"), "phone")
    .querySelector(".qap-profile-activate")
    .click();
  root.querySelector(".qap-head-button").click();
  assert.equal(
    root.querySelector(".qap-settings-profiles").querySelector("strong").textContent,
    "Phone",
  );
  assert.equal(
    root.querySelector(".qap-settings-profiles").querySelector("qap-icon").attributes.icon,
    "mdi:cellphone",
  );
  assert.equal(
    root.querySelector(".qap-settings-shortcuts").querySelector("small").textContent,
    "0 shortcuts",
  );
  assert.equal(
    root.querySelector(".qap-settings-categories").querySelector("small").textContent,
    "2 groups",
  );
  assert.equal(
    root.querySelector(".qap-settings-visibility").querySelector("small").textContent,
    "Shown only on 2 pages",
  );
  for (const [visibility, routes, summary] of [
    ["exclude", ["/private/*"], "Hidden on 1 page"],
    ["include", [], "Hidden on all pages"],
  ]) {
    const profile = { ...clone(env.server.data("test-user").profiles[1]), name: "Updated phone" };
    Object.assign(profile.settings, { visibility, routes });
    await env.server.mutate("test-user", {
      operation: "update",
      profile_id: profile.id,
      revision: data.revision,
      profile,
    });
    assert.equal(
      root.querySelector(".qap-settings-visibility").querySelector("small").textContent,
      summary,
    );
    assert.equal(
      root.querySelector(".qap-settings-profiles").querySelector("strong").textContent,
      "Updated phone",
    );
    assert.equal(root.querySelector(".qap-resource-info"), null);
  }
  installLocaleFetch(env);
  await changeLanguage(env, "hr");
  assert.equal(
    root.querySelectorAll(".qap-settings-section-title")[1].textContent,
    "Konfiguracija profila",
  );
  assert.equal(
    root.querySelector(".qap-settings-shortcuts").querySelector("small").textContent,
    "0 prečaca",
  );
  assert.equal(
    root.querySelector(".qap-settings-categories").querySelector("small").textContent,
    "2 grupe",
  );
});

test("owned dialog slots preserve dirty forms and localization", async () => {
  const env = environment();
  const components = nativeComponents(env, false);
  components.register("qap-button", "qap-icon-button", "qap-select");
  const create = env.document.createElement;
  env.document.createElement = (tag) => {
    const element = create(tag);
    element.focus = () => {
      env.document.activeElement = element;
    };
    return element;
  };
  installLocaleFetch(env);
  await startProfiles(env);
  openLauncherSettings(env, "visibility");
  const surface = env.document.body.querySelector("qap-dialog");
  const paths = surface.querySelector("textarea");
  const fallbackFooter = surface.querySelector(".qap-settings-footer");
  assert.equal(surface.attributes["without-header"], undefined);
  assert.equal(surface.attributes["hide-close-button"], undefined);
  assert.equal(surface.headerTitle, "Display rules");
  assert.equal(fallbackFooter.localName, "div");
  assert.equal(fallbackFooter.slot, "footer");
  assert.equal(fallbackFooter.parentElement, surface);
  assert.equal(fallbackFooter.querySelector(".qap-save-settings").attributes.appearance, "accent");
  for (const action of surface.querySelectorAll(".qap-current-url-action")) {
    assert.equal(action.attributes.appearance, "filled");
    assert.equal(action.attributes.variant, "brand");
  }
  paths.value = "/unsaved/*";
  // The small DOM double does not bubble/capture child events. Dispatch the
  // event at the surface that receives it in the browser.
  await dispatchAndFlush(surface, new Event("input"));
  assert.equal(surface.preventScrimClose, true);
  components.register("ha-dialog-footer");
  await flush();
  assert.equal(surface.querySelector(".qap-settings-footer"), fallbackFooter);
  const subscriptions = [...env.server.listeners];
  await changeLanguage(env, "hr");
  assert.equal(surface.headerTitle, "Pravila prikaza");
  assert.equal(surface.querySelector("textarea"), paths);
  assert.equal(paths.value, "/unsaved/*");
  assert.deepEqual([...env.server.listeners], subscriptions);
  surface.querySelector(".qap-head-button").click();
  assert.equal(surface.querySelector("textarea"), paths);
  respondToDiscard(env, false);
  surface.dispatchEvent(new Event("cancel", { cancelable: true }));
  assert.equal(surface.open, true);
  assert.equal(surface.querySelector("textarea"), paths);
  respondToDiscard(env, false);
  surface.querySelector(".qap-head-button").click();
  respondToDiscard(env);
  assert.equal(surface.headerTitle, "Postavke");
  assert.equal(surface.preventScrimClose, false);
  assert.equal(env.document.activeElement, surface.querySelector(".qap-settings-visibility"));
  surface.querySelector(".qap-settings-visibility").click();
  assert.equal(surface.querySelector(".qap-settings-footer").localName, "div");
  assert.equal(surface.querySelectorAll(".qap-settings-footer").length, 1);
  assert.equal(surface.querySelector("textarea").value, "");
  assert.equal(env.server.requests.length, 0);
  let acknowledge;
  env.connection.sendMessagePromise = (message) =>
    new Promise((resolve) => {
      acknowledge = async () => resolve(await env.server.mutate("test-user", message));
    });
  surface.querySelector("textarea").value = "/pending/*";
  const save = surface.querySelector(".qap-save-settings");
  save.click();
  assert.equal(save.disabled, true);
  assert.equal(save.loading, true);
  assert.equal(surface.preventScrimClose, true);
  surface.querySelector(".qap-head-button").click();
  assert.equal(surface.querySelector(".qap-save-settings"), save);
  await acknowledge();
  await flush();
  assert.equal(surface.headerTitle, "Quick Access");
  assert.equal(surface.preventScrimClose, false);
});

for (const screen of ["visibility", "shortcut", "category"]) {
  test(`unsaved ${screen} changes survive rejected Back, Escape and outside dismissal`, async () => {
    const env = await startProfiles(environment());
    openLauncherSettings(env, screen === "visibility" ? "visibility" : "shortcuts");
    const root = env.document.body;
    if (screen === "shortcut") root.querySelector(".qap-add-shortcut").click();
    if (screen === "category")
      openCategoriesManager(env).querySelector(".qap-create-category").click();
    const input = root.querySelector(
      screen === "visibility"
        ? ".qap-textarea"
        : screen === "shortcut"
          ? ".qap-shortcut-form"
          : ".qap-category-form",
    );
    const field = screen === "visibility" ? input : input.querySelector("input, qap-input");
    field.value = screen === "visibility" ? "/private/draft" : "Keep draft";
    const dialog = root.querySelector(".qap-settings-dialog");
    for (const dismiss of [
      () => root.querySelector(".qap-head-button").click(),
      () => dialog.dispatchEvent(new Event("cancel", { cancelable: true })),
      () =>
        dialog.dispatchEvent(
          new CustomEvent("cancel", { cancelable: true, detail: { source: "backdrop" } }),
        ),
    ]) {
      dismiss();
      assert.equal(root.querySelectorAll(".qap-discard-changes-confirmation").length, 1);
      respondToDiscard(env, false);
      assert.equal(field.isConnected, true);
      assert.equal(field.value, screen === "visibility" ? "/private/draft" : "Keep draft");
    }
    assert.equal(env.server.requests.length, 0);
    root.querySelector(".qap-head-button").click();
    respondToDiscard(env);
    assert.equal(field.isConnected, false);
    assert.equal(env.server.requests.length, 0);
  });
}

test("owned dismissal requests retain dirty controls when dismissal is rejected", async () => {
  const env = await startProfiles(environment());
  openLauncherSettings(env);
  const dialog = env.document.body.querySelector("qap-dialog");
  const paths = dialog.querySelector(".qap-textarea");
  paths.value = "/private/draft";
  dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector(".qap-textarea"), paths);
  respondToDiscard(env, false);
});

test("pending settings saves block Quick Access dismissal while HA navigation continues", async () => {
  const env = await startProfiles(navigationEnvironment());
  openLauncherSettings(env);
  const root = env.document.body;
  const dialog = root.querySelector(".qap-settings-dialog");
  root.querySelector(".qap-textarea").value = "/private/delayed";
  let finish;
  env.connection.sendMessagePromise = (message) =>
    new Promise((resolve) => {
      finish = async () => resolve(await env.server.mutate("test-user", message));
    });
  root.querySelector(".qap-save-settings").click();
  await env.back();
  assert.equal(root.querySelector(".qap-textarea").isConnected, true);
  for (let i = 0; i < 3; i++) root.querySelector(".qap-head-button").click();
  dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
  env.window.location.pathname = "/config/logs";
  env.window.dispatchEvent(new Event("location-changed"));
  assert.equal(env.window.location.pathname, "/config/logs");
  assert.equal(dialog.open, true);
  assert.equal(root.querySelector(".qap-textarea").value, "/private/delayed");
  assert.equal(root.querySelector(".qap-confirmation"), null);
  assert.equal(root.querySelector("qap-dialog").headerTitle, "Display rules");
  assert.equal(root.querySelector(".qap-body").inert, true);
  await finish();
  await flush();
  assert.equal(root.querySelector("qap-dialog").headerTitle, "Quick Access");
  openLauncherSettings(env, "settings");
  root.querySelector(".qap-settings-shortcuts").click();
  env.server.notify("test-user");
  assert.equal(root.querySelector("qap-dialog").headerTitle, "Shortcuts");
  root.querySelector(".qap-head-button").click();
  assert.equal(
    root.querySelector(".qap-settings-visibility").querySelector("small").textContent,
    "Hidden on 1 page",
  );
  assert.equal(root.querySelector(".qap-settings-dialog"), dialog);
});

for (const routeEvent of ["location-changed", "popstate", "currententrychange"]) {
  test(`${routeEvent} retains dirty settings until discard is confirmed`, async () => {
    const env = environment();
    if (routeEvent === "currententrychange") env.window.navigation = new EventTargetDouble();
    const routeTarget = routeEvent === "currententrychange" ? env.window.navigation : env.window;
    const notifyRoute = () => routeTarget.dispatchEvent(new Event(routeEvent));
    await startProfiles(env);
    openLauncherSettings(env);
    const dialog = env.document.body.querySelector(".qap-settings-dialog");
    const paths = dialog.querySelector(".qap-textarea");
    paths.value = "/private/draft";

    // HA dialog/query/hash history updates keep the same page and draft.
    env.window.location.search = "?dialog=1";
    env.window.location.hash = "#details";
    notifyRoute();
    assert.equal(env.document.body.querySelector(".qap-confirmation"), null);

    env.window.location.pathname = "/config/logs";
    notifyRoute();
    notifyRoute();
    assert.equal(env.document.body.querySelectorAll(".qap-discard-changes-confirmation").length, 1);
    assert.equal(dialog.open, true);
    respondToDiscard(env, false);
    assert.equal(paths.isConnected, true);
    assert.equal(paths.value, "/private/draft");
    assert.equal(
      env.window.location.pathname,
      "/config/logs",
      "keeping a draft does not undo HA navigation",
    );
    notifyRoute();
    assert.equal(
      env.document.body
        .querySelectorAll(".qap-discard-changes-confirmation")
        .filter((element) => element.open).length,
      0,
    );

    env.window.location.pathname = "/config/automation/dashboard";
    notifyRoute();
    // Another navigation while the prompt is open must never be replayed later.
    env.window.location.pathname = "/lovelace/other";
    notifyRoute();
    respondToDiscard(env);
    assert.equal(dialog.open, false);
    assert.equal(env.window.location.pathname, "/lovelace/other");
    assert.equal(env.server.requests.length, 0);
  });
}

test("browser unload still warns about dirty Quick Access forms without the Navigation API", async () => {
  const env = await startProfiles(environment());
  openLauncherSettings(env);
  const paths = env.document.body.querySelector(".qap-textarea");
  paths.value = "/private/draft";
  const unload = new Event("beforeunload", { cancelable: true });
  Object.defineProperty(unload, "returnValue", { value: "", writable: true });
  env.window.dispatchEvent(unload);
  assert.equal(unload.defaultPrevented, true);
  assert.equal(paths.isConnected, true);

  env.window.location.pathname = "/config/logs";
  env.window.dispatchEvent(new Event("location-changed"));
  respondToDiscard(env);
  assert.equal(paths.isConnected, false);
  const cleanUnload = new Event("beforeunload", { cancelable: true });
  env.window.dispatchEvent(cleanUnload);
  assert.equal(cleanUnload.defaultPrevented, false);
});

test("a delayed save cannot replace the selected profile or its overview after a device selection change", async () => {
  const env = await startProfiles(environment());
  const data = env.server.data("test-user");
  data.profiles.push({
    ...clone(data.profiles[0]),
    id: "tablet",
    name: "Tablet",
    icon: "mdi:tablet",
  });
  data.revision++;
  env.server.notify("test-user");
  openLauncherSettings(env);
  const root = env.document.body;
  root.querySelector(".qap-textarea").value = "/private/old-profile";
  let release;
  const acknowledged = new Promise((resolve) => {
    release = resolve;
  });
  const send = env.connection.sendMessagePromise;
  env.connection.sendMessagePromise = async (message) => {
    const result = await send(message);
    await acknowledged;
    return result;
  };
  await clickAndFlush(root.querySelector(".qap-save-settings"));
  env.storage.set(selectionKey(), JSON.stringify("tablet"));
  storageEvent(env, selectionKey());
  respondToDiscard(env);
  assert.equal(env.window.quickAccessDebug().activeProfileId, "tablet");
  openLauncherSettings(env, "settings");
  const overview = root.querySelector(".qap-settings-overview");
  release();
  await flush();
  assert.equal(root.querySelector(".qap-settings-overview"), overview);
  assert.equal(
    root.querySelector(".qap-settings-profiles").querySelector("strong").textContent,
    "Tablet",
  );
  assert.equal(
    root.querySelector(".qap-settings-visibility").querySelector("small").textContent,
    "Shown on all pages",
  );
  assert.equal(env.server.data("test-user").profiles[1].settings.routes.length, 0);
});
