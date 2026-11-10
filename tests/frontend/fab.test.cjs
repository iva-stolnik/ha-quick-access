// Floating action button position, dragging and local state.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  loadDefaults,
  flush,
  clickAndFlush,
  dispatchAndFlush,
  clone,
  environment,
  openEntityStates,
  buttons,
  openSettings,
  fabPointer,
  dragFab,
  startProfiles,
  deviceKey,
} = require("./harness.cjs");
let defaultLinks;
test.before(async () => ({ defaultLinks } = await loadDefaults()));

test("FAB menu hides Move button for touch and shows it for mouse and keyboard", async () => {
  const env = await startProfiles(environment());
  const menu = env.document.body.querySelector("#qap-menu");
  const [move, reset, reload] = buttons(menu);
  let focused;
  for (const item of [move, reset, reload]) item.focus = () => (focused = item);
  const visibleActions = () => buttons(menu).filter((item) => !item.hidden);

  for (const pointerType of ["mouse", "touch", "pen", "touch"]) {
    fabPointer(env, "pointerdown", 320, 720, pointerType);
    await env.tick(480);
    assert.equal(menu.hidden, true, "holding must keep the menu hidden");
    assert.equal(env.fab().attributes["aria-expanded"], "false");
    await env.tick(480);
    assert.equal(menu.hidden, true, "continuing to hold must keep the menu hidden");
    fabPointer(env, "pointerup", 320, 720, pointerType);
    assert.equal(menu.hidden, false);
    assert.equal(env.fab().attributes["aria-expanded"], "true");
    assert.deepEqual(
      visibleActions(),
      pointerType === "touch" ? [reset, reload] : [move, reset, reload],
    );
  }

  for (const key of ["Enter", " ", "F10"]) {
    env
      .fab()
      .dispatchEvent(
        Object.assign(new Event("keydown", { cancelable: true }), { key, shiftKey: true }),
      );
    assert.deepEqual(visibleActions(), [move, reset, reload]);
    assert.equal(focused, move);
    for (const [key, expected] of [
      ["ArrowUp", reload],
      ["ArrowDown", move],
      ["ArrowDown", reset],
      ["End", reload],
      ["Home", move],
    ]) {
      const target = focused;
      menu.dispatchEvent(
        Object.assign(new Event("keydown", { cancelable: true }), {
          key,
          composedPath: () => [target, menu],
        }),
      );
      assert.equal(focused, expected);
    }
  }
});

test("FAB drag and cancelled holds never open the menu", async () => {
  const env = await startProfiles(environment());
  const menu = env.document.body.querySelector("#qap-menu");
  for (const pointerType of ["mouse", "touch", "pen"]) {
    for (const finish of ["pointerup", "pointercancel", "lostpointercapture"]) {
      fabPointer(env, "pointerdown", 320, 720, pointerType);
      await env.tick(480);
      assert.equal(menu.hidden, true);
      fabPointer(env, "pointermove", 160, 420, pointerType);
      assert.equal(menu.hidden, true);
      // Returning to the starting point still counts as a drag.
      fabPointer(env, "pointermove", 320, 720, pointerType);
      fabPointer(env, finish, 320, 720, pointerType);
      assert.equal(menu.hidden, true);
      assert.equal(env.document.body.querySelector("qap-dialog"), null);
    }
    for (const finish of ["pointercancel", "lostpointercapture"]) {
      fabPointer(env, "pointerdown", 320, 720, pointerType);
      await env.tick(480);
      fabPointer(env, finish, 320, 720, pointerType);
      assert.equal(menu.hidden, true);
      assert.equal(env.document.body.querySelector("qap-dialog"), null);
    }
  }
});

test("position auto-saving and resetting report errors without pretending to persist", async () => {
  const env = environment();
  await startProfiles(env, false);
  const menu = env.document.body.querySelector("#qap-menu");
  menu.hidden = false;
  assert.equal(
    buttons(menu).some((element) => element.textContent === "Save position"),
    false,
  );
  const reset = buttons(menu).find((element) => element.textContent === "Reset position");
  const setItem = env.context.localStorage.setItem;
  env.context.localStorage.setItem = () => {
    throw new Error("Storage unavailable");
  };
  await dragFab(env);
  await flush();
  assert.equal(menu.hidden, false);
  assert.match(menu.querySelector(".qap-storage-error").textContent, /Could not save changes/);
  assert.equal(
    env.storage.has(`quick_access_v1:test-instance:test-user:test-profile:position`),
    false,
  );
  assert.equal(env.fab().style.left, "auto");
  env.context.localStorage.setItem = setItem;
  await dragFab(env);
  await flush();
  const key = `quick_access_v1:test-instance:test-user:test-profile:position`;
  assert.ok(env.storage.has(key));
  assert.equal(menu.querySelector(".qap-storage-error"), null);
  menu.hidden = false;
  const removeItem = env.context.localStorage.removeItem;
  env.context.localStorage.removeItem = () => {
    throw new Error("Storage unavailable");
  };
  await clickAndFlush(reset);
  assert.equal(env.storage.has(key), true);
  assert.match(menu.querySelector(".qap-storage-error").textContent, /Could not save changes/);
  env.context.localStorage.removeItem = removeItem;
  await clickAndFlush(reset);
  assert.equal(env.storage.has(key), false);
  assert.equal(menu.querySelector(".qap-storage-error"), null);
});

test("settings and profile synchronization preserve local searches and position", async () => {
  const env = environment();
  const historyKey = `quick_access_v1:test-instance:test-user:test-profile:states-search-history`;
  env.storage.set(historyKey, '["existing search"]');
  env.storage.set(
    `quick_access_v1:test-instance:test-user:test-profile:position`,
    '{"x":0.1,"y":0.2}',
  );
  await openSettings("/config", {}, env);
  const stored = [...env.storage];
  env.document.body.querySelector(".qap-textarea").value = "/private/settings";
  await clickAndFlush(env.document.body.querySelector(".qap-save-settings"));
  assert.deepEqual([...env.storage], stored);

  const search = await openEntityStates(env);
  assert.equal(
    env.document.body.querySelector(".qap-recent-search").textContent,
    "existing search",
  );
  search.value = "new search";
  search.dispatchEvent(new Event("input"));
  await dispatchAndFlush(search, Object.assign(new Event("keydown"), { key: "Enter" }));
  const profile = clone(env.server.data("test-user").profiles[0]);
  profile.settings.routes = ["/private/remote"];
  await env.server.mutate("test-user", {
    operation: "update",
    profile_id: profile.id,
    revision: env.server.data("test-user").revision,
    profile,
  });
  await flush();
  assert.deepEqual(JSON.parse(env.storage.get(historyKey)), ["new search", "existing search"]);
  assert.equal(JSON.stringify(env.server.data("test-user")).includes("new search"), false);
  await clickAndFlush(env.document.body.querySelector(".qap-clear-searches"));
  assert.deepEqual(JSON.parse(env.storage.get(historyKey)), []);
  assert.equal(
    env.storage.get(`quick_access_v1:test-instance:test-user:test-profile:position`),
    '{"x":0.1,"y":0.2}',
  );
});

test("search keyboard resizing and closing preserve the saved FAB position", async () => {
  const env = environment();
  const key = `${deviceKey(env, "test-user", "test-profile")}:position`;
  const position = JSON.stringify({ x: 0.99, y: 0.99 });
  env.storage.set(key, position);
  await startProfiles(env);
  const original = { left: env.fab().style.left, top: env.fab().style.top };
  env.fab().click();
  env.document.body.querySelector(".qap-search-shortcuts").click();
  const search = env.document.body.querySelector(".qap-search-input");
  search.value = "no such shortcut";
  search.dispatchEvent(new Event("input"));
  for (const [width, height] of [
    [390, 340],
    [320, 300],
    [390, 100],
  ])
    env.resize(width, height);
  env.document.body.querySelector(".qap-head-button").click();
  env.resize(390, 844);
  assert.deepEqual({ left: env.fab().style.left, top: env.fab().style.top }, original);
  assert.equal(env.storage.get(key), position);
  env.fab().click();
  assert.equal(env.document.body.querySelector(".qap-search-input").value, "");
  assert.equal(env.document.body.querySelectorAll(".qap-tile").length, defaultLinks.length);
});

test("FAB tap and hold do not save; drag saves on release and cancellation restores the saved position", async () => {
  const env = await startProfiles(environment());
  const key = `${deviceKey(env)}:position`;
  const requests = env.server.requests.length;
  fabPointer(env, "pointerdown");
  fabPointer(env, "pointerup");
  assert.equal(env.storage.has(key), false);
  buttons(env.document.body)
    .find((item) => item.title === "Close")
    .click();
  fabPointer(env, "pointerdown");
  await env.tick(480);
  fabPointer(env, "pointerup");
  assert.equal(env.storage.has(key), false);
  fabPointer(env, "pointerdown");
  await env.tick(480);
  fabPointer(env, "pointermove", 160, 420);
  assert.equal(env.storage.has(key), false);
  fabPointer(env, "pointerup", 160, 420);
  const position = env.storage.get(key);
  assert.ok(position);
  const left = env.fab().style.left;
  const top = env.fab().style.top;
  env.resize(390, 60);
  env.resize(390, 844);
  assert.ok(Math.abs(parseFloat(env.fab().style.left) - parseFloat(left)) < 0.001);
  assert.ok(Math.abs(parseFloat(env.fab().style.top) - parseFloat(top)) < 0.001);
  assert.equal(env.storage.get(key), position);
  for (const event of ["pointercancel", "lostpointercapture"]) {
    fabPointer(env, "pointerdown", 160, 420);
    await env.tick(480);
    fabPointer(env, "pointermove", 250, 600);
    fabPointer(env, event, 250, 600);
    assert.equal(env.storage.get(key), position);
    assert.ok(Math.abs(parseFloat(env.fab().style.left) - parseFloat(left)) < 0.001);
    assert.ok(Math.abs(parseFloat(env.fab().style.top) - parseFloat(top)) < 0.001);
  }
  assert.equal(env.server.requests.length, requests, "position must never be written to HA");
});
