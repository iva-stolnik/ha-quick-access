// Entity states virtualization, virtual search, scrolling and focus.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const { getEventListeners } = require("node:events");
const test = require("node:test");
const {
  flush,
  clickAndFlush,
  dispatchAndFlush,
  clone,
  savedProfile,
  environment,
  openEntityStates,
  nativeComponents,
  buttons,
  scrollStates,
  reachableStateIds,
  largeStates,
} = require("./harness.cjs");

test("entity states keep every match reachable beyond 65 in All, Favorites, and search", async () => {
  const env = environment();
  const states = Array.from({ length: 160 }, (_, index) => ({
    entity_id: `${index < 80 ? "sensor" : "light"}.entity_${String(index).padStart(3, "0")}`,
    state: "on",
    attributes: {},
  }));
  env.status.hass.states = Object.fromEntries(states.map((state) => [state.entity_id, state]));
  const favorites = states.slice(0, 80).map((state) => state.entity_id);
  savedProfile(env).favorites = favorites;
  const search = await openEntityStates(env);
  const rows = () =>
    env.document.body.querySelectorAll(".qap-state-row").map((row) => row.dataset.entity);
  const filters = env.document.body.querySelector(".qap-state-tabs");
  assert.deepEqual(
    filters.children.map((chip) => chip.dataset.domain),
    ["favorites", "all", "unavailable", "unknown", "low_battery", "updates"],
  );
  assert.deepEqual(await reachableStateIds(env), favorites);
  for (const filter of ["all", "favorites"]) {
    await clickAndFlush(filters.children.find((chip) => chip.dataset.domain === filter));
    const expected = states
      .filter((state) => filter === "all" || favorites.includes(state.entity_id))
      .map((state) => state.entity_id)
      .sort();
    assert.deepEqual(await reachableStateIds(env), expected);
    assert.equal(
      env.document.body.querySelector(".qap-count").textContent,
      `${expected.length} entities`,
    );
  }
  await clickAndFlush(filters.children.find((chip) => chip.dataset.domain === "all"));
  search.value = "entity_";
  search.dispatchEvent(new Event("input"));
  await env.tick(175);
  assert.equal((await reachableStateIds(env)).length, states.length);
  const added = { entity_id: "switch.entity_160", state: "off", attributes: {} };
  env.status.hass.states[added.entity_id] = added;
  await env.tick(3500);
  assert.equal((await reachableStateIds(env)).length, states.length + 1);
  assert.equal(rows().at(-1), added.entity_id);
  await clickAndFlush(
    env.document.body.querySelectorAll(".qap-state-row").at(-1).querySelector("button"),
  );
  assert.equal(env.document.body.querySelector(".qap-state-modal").dataset.entity, added.entity_id);
});

for (const size of [100, 10000]) {
  test(`Entity states virtualizes ${size} entities with bounded rows, correct ranges and complete reachability`, async () => {
    const env = environment();
    env.status.hass.states = largeStates(size);
    await openEntityStates(env);
    const list = env.document.body.querySelector(".qap-state-list");
    const rows = () => list.querySelectorAll(".qap-state-row");
    const ids = Object.keys(env.status.hass.states);
    const { rowHeight, rowGap, listOffset, viewportHeight } = env.layout;
    const stride = rowHeight + rowGap;
    const bound = Math.ceil(viewportHeight / stride) + 2 * 4 + 1;
    assert.equal(env.document.body.querySelector(".qap-count").textContent, `${size} entities`);
    assert.equal(list.style.height, `${size * stride - rowGap}px`);
    assert.ok(rows().length <= bound);
    const first = rows()[0];
    const overlap = rows()[5];
    await scrollStates(env, listOffset + 5 * stride);
    assert.equal(
      rows().find((row) => row.dataset.entity === overlap.dataset.entity),
      overlap,
    );
    await scrollStates(env, listOffset + 50 * stride);
    assert.equal(first.isConnected, false);
    assert.deepEqual(
      rows().map((row) => row.dataset.entity),
      ids.slice(46, 61),
    );
    assert.equal(rows()[0].attributes["aria-posinset"], "47");
    assert.equal(rows()[0].attributes["aria-setsize"], String(size));
    assert.equal(rows()[0].style.top, `${46 * stride}px`);
    assert.equal(new Set(rows().map((row) => row.dataset.entity)).size, rows().length);
    // Browser scrollTop is clamped at the real maximum; cover that exact edge.
    await scrollStates(
      env,
      listOffset + size * stride - rowGap + env.layout.paddingBottom - viewportHeight,
    );
    assert.equal(rows().at(-1).dataset.entity, ids.at(-1));
    assert.ok(rows().length <= bound);
    await scrollStates(env, 0);
    assert.equal(rows()[0].dataset.entity, ids[0]);
    assert.notEqual(rows()[0], first);
    assert.deepEqual(await reachableStateIds(env), ids);
    env.enable(false);
    await flush();
    assert.equal(env.resizeObservers.size, 0);
  });
}

test("virtual searches debounce, reject stale queries, clear immediately and reset the scroll range", async () => {
  const env = environment();
  env.status.hass.states = largeStates(10000);
  const search = await openEntityStates(env);
  await scrollStates(env, 400000);
  const count = () => env.document.body.querySelector(".qap-count").textContent;
  search.value = "entity_099";
  search.dispatchEvent(new Event("input"));
  const stale = [...env.timers.values()].find((timer) => timer.delay === 175);
  search.value = "entity_000";
  search.dispatchEvent(new Event("input"));
  assert.equal(count(), "10000 entities");
  assert.equal([...env.timers.values()].filter((timer) => timer.delay === 175).length, 1);
  assert.equal([...env.timers.values()].includes(stale), false);
  await env.tick(175);
  assert.equal(count(), "100 entities");
  assert.equal(env.document.body.querySelector(".qap-body").scrollTop, 0);
  assert.equal(
    env.document.body.querySelector(".qap-state-row").dataset.entity,
    "sensor.entity_00000",
  );
  await scrollStates(env, 5000);
  search.value = "no matches";
  search.dispatchEvent(new Event("input"));
  search.value = "";
  search.dispatchEvent(new Event("input"));
  assert.equal(count(), "10000 entities");
  assert.equal(env.document.body.querySelector(".qap-body").scrollTop, 0);
  await env.tick(175);
  assert.equal(count(), "10000 entities");
  search.value = "entity_09999";
  search.dispatchEvent(new Event("input"));
  search.dispatchEvent(Object.assign(new Event("keydown"), { key: "Enter" }));
  assert.equal(count(), "1 entity");
  assert.equal(
    env.document.body.querySelector(".qap-state-row").dataset.entity,
    "sensor.entity_09999",
  );
  assert.deepEqual(
    JSON.parse(
      env.storage.get(`quick_access_v1:test-instance:test-user:test-profile:states-search-history`),
    ),
    ["entity_09999"],
  );
});

test("virtual refresh updates mounted icons only and new ranges read the latest off-screen state", async () => {
  const env = environment();
  nativeComponents(env);
  env.status.hass.states = largeStates(5000);
  await openEntityStates(env);
  const list = env.document.body.querySelector(".qap-state-list");
  const first = list.querySelector(".qap-state-row");
  const badge = first.querySelector("qap-state-icon");
  const offscreen = env.status.hass.states["sensor.entity_04999"];
  offscreen.state = "updated off screen";
  env.status.hass.states[first.dataset.entity] = {
    ...env.status.hass.states[first.dataset.entity],
    state: "updated visible",
  };
  let moves = 0;
  let writes = 0;
  const insertBefore = list.insertBefore.bind(list);
  list.insertBefore = (...args) => {
    moves++;
    return insertBefore(...args);
  };
  for (const element of [list, ...list.querySelectorAll(".qap-state-row")]) {
    const setAttribute = element.setAttribute.bind(element);
    element.setAttribute = (...args) => {
      writes++;
      return setAttribute(...args);
    };
  }
  await env.tick(3500);
  assert.equal(list.querySelector(".qap-state-row"), first);
  assert.equal(first.querySelector("qap-state-icon"), badge);
  assert.equal(badge.stateObj.state, "updated visible");
  assert.equal(first.querySelector(".qap-state-value").textContent, "updated visible");
  assert.equal(
    list
      .querySelectorAll("qap-state-icon")
      .some((icon) => icon.stateObj.entity_id === offscreen.entity_id),
    false,
  );
  assert.equal(moves, 0);
  assert.equal(writes, 0);
  await scrollStates(env, 500000);
  assert.equal(
    list.querySelectorAll(".qap-state-row").at(-1).querySelector(".qap-state-value").textContent,
    offscreen.state,
  );
  env.connection.dispatchEvent(new Event("disconnected"));
  await dispatchAndFlush(env.connection, new Event("ready"));
  await env.tick(3500);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "5000 entities");
});

test("virtual membership changes preserve the scroll anchor and clamp removals at the bottom", async () => {
  const env = environment();
  env.status.hass.states = largeStates(1000);
  await openEntityStates(env);
  const stride = env.layout.rowHeight + env.layout.rowGap;
  const body = env.document.body.querySelector(".qap-body");
  await scrollStates(env, env.layout.listOffset + 100 * stride);
  env.status.hass.states["binary_sensor.first"] = {
    entity_id: "binary_sensor.first",
    state: "on",
    attributes: {},
  };
  await env.tick(3500);
  assert.equal(body.scrollTop, env.layout.listOffset + 101 * stride);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "1001 entities");
  await scrollStates(env, 100000);
  for (const id of Object.keys(env.status.hass.states).slice(100))
    delete env.status.hass.states[id];
  await env.tick(3500);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "100 entities");
  const rows = env.document.body.querySelectorAll(".qap-state-row");
  assert.equal(rows.at(-1).dataset.entity, "sensor.entity_00099");
  assert.equal(
    body.scrollTop,
    env.layout.listOffset +
      100 * stride -
      env.layout.rowGap +
      env.layout.paddingBottom -
      env.layout.viewportHeight,
  );
});

test("virtual resize remeasures rows, viewport and scrolling headers without measuring on scroll", async () => {
  const env = environment();
  env.status.hass.states = largeStates(1000);
  await openEntityStates(env);
  const list = env.document.body.querySelector(".qap-state-list");
  let reads = 0;
  const rect = list.getBoundingClientRect.bind(list);
  list.getBoundingClientRect = () => {
    reads++;
    return rect();
  };
  await scrollStates(env, 160 + 100 * 74);
  assert.equal(reads, 0);
  for (const observer of env.resizeObservers) {
    const sample = [...observer.targets].find((target) => target.className === "qap-state-row");
    observer.callback([{ target: sample, borderBoxSize: [{ blockSize: env.layout.rowHeight }] }]);
  }
  assert.equal(
    [...env.timers.values()].some((timer) => timer.delay === 16),
    false,
  );
  env.layout.rowHeight = 90;
  env.layout.rowGap = 9;
  env.layout.viewportHeight = 800;
  env.layout.listOffset = 260;
  env.notifyResize();
  env.resize(800);
  await env.tick(16);
  assert.equal(reads, 1);
  assert.equal(env.document.body.querySelector(".qap-body").scrollTop, 260 + 100 * 99);
  assert.equal(list.style.height, `${1000 * 99 - 9}px`);
  assert.deepEqual(
    list.querySelectorAll(".qap-state-row").map((row) => row.dataset.entity),
    Object.keys(env.status.hass.states).slice(96, 113),
  );
  // Expanding the viewport mounts more rows, even without a window resize.
  const before = list.children.length;
  env.layout.viewportHeight = 1200;
  env.notifyResize();
  await env.tick(16);
  assert.ok(list.children.length > before);
  await scrollStates(env, 1000000);
  assert.equal(list.children.at(-1).dataset.entity, "sensor.entity_00999");
});

test("virtual keyboard focus crosses render boundaries, stays mounted while scrolling and keeps detail clicks", async () => {
  const env = environment();
  const createElement = env.document.createElement;
  env.document.createElement = (tag) => {
    const element = createElement(tag);
    element.focus = () => {
      env.document.activeElement = element;
    };
    return element;
  };
  env.status.hass.states = largeStates(1000);
  await openEntityStates(env);
  const list = env.document.body.querySelector(".qap-state-list");
  const first = list.children[0];
  const summary = first.querySelector("button");
  summary.focus = () => {
    env.document.activeElement = summary;
  };
  summary.focus();
  await scrollStates(env, 160 + 500 * 74);
  assert.equal(first.isConnected, true);
  assert.ok(list.children.length <= 17);
  const tab = Object.assign(new Event("keydown", { cancelable: true }), { key: "Tab" });
  summary.dispatchEvent(tab);
  assert.equal(tab.defaultPrevented, true);
  assert.ok(
    list
      .querySelectorAll(".qap-state-row")
      .some((row) => row.dataset.entity === "sensor.entity_00001"),
  );
  const next = list
    .querySelectorAll(".qap-state-row")
    .find((row) => row.dataset.entity === "sensor.entity_00001")
    .querySelector("button");
  assert.equal(env.document.activeElement, next);
  const reverse = Object.assign(new Event("keydown", { cancelable: true }), {
    key: "Tab",
    shiftKey: true,
  });
  next.dispatchEvent(reverse);
  assert.equal(reverse.defaultPrevented, false, "mounted rows use native tab navigation");
  await scrollStates(env, 160 + 500 * 74);
  assert.equal(first.isConnected, false);
  const boundaryReverse = Object.assign(new Event("keydown", { cancelable: true }), {
    key: "Tab",
    shiftKey: true,
  });
  next.dispatchEvent(boundaryReverse);
  assert.equal(boundaryReverse.defaultPrevented, true);
  const restoredSummary = list.children
    .find((row) => row.dataset.entity === "sensor.entity_00000")
    .querySelector("button");
  assert.equal(env.document.activeElement, restoredSummary);
  const leave = Object.assign(new Event("keydown", { cancelable: true }), {
    key: "Tab",
    shiftKey: true,
  });
  restoredSummary.dispatchEvent(leave);
  assert.equal(leave.defaultPrevented, false);
  env.document.activeElement = null;
  await scrollStates(env, 1000000);
  const last = list.children.at(-1).querySelector("button");
  const exit = Object.assign(new Event("keydown", { cancelable: true }), { key: "Tab" });
  last.dispatchEvent(exit);
  assert.equal(exit.defaultPrevented, false);
  // Native buttons still own Enter/Space activation; their click handler survives remounts.
  last.click();
  assert.equal(
    env.document.body.querySelector(".qap-state-modal").dataset.entity,
    "sensor.entity_00999",
  );
  await scrollStates(env, 0);
  assert.ok(list.children.some((row) => row.dataset.entity === "sensor.entity_00999"));
  delete env.status.hass.states["sensor.entity_00999"];
  await env.tick(3500);
  assert.equal(
    env.document.body.querySelector(".qap-state-dialog-value").textContent,
    "Unavailable",
  );
  assert.equal(
    list.children.some((row) => row.dataset.entity === "sensor.entity_00999"),
    false,
  );
});

test("closing virtual states cancels pending search/frames, releases listeners and reopens without duplicates", async () => {
  const env = environment();
  env.status.hass.states = largeStates(1000);
  const search = await openEntityStates(env);
  const body = env.document.body.querySelector(".qap-body");
  search.value = "entity_009";
  search.dispatchEvent(new Event("input"));
  body.dispatchEvent(new Event("scroll"));
  assert.equal(getEventListeners(body, "scroll").length, 1);
  assert.equal(getEventListeners(env.window, "resize").length, 2);
  const back = env.document.body.querySelector(".qap-head-button");
  back.click();
  assert.equal(getEventListeners(body, "scroll").length, 0);
  assert.equal(getEventListeners(body, "focusout").length, 0);
  assert.equal(getEventListeners(env.window, "resize").length, 1);
  assert.equal(env.resizeObservers.size, 0);
  assert.equal(
    [...env.timers.values()].some((timer) => [175, 3500].includes(timer.delay)),
    false,
  );
  assert.equal(
    [...env.timers.values()].some((timer) => timer.delay === 16),
    false,
    "Leaving the list cancels pending animation frames",
  );
  await env.tick(175);
  await env.tick(16);
  assert.equal(
    [...env.timers.values()].some((timer) => timer.delay === 16),
    false,
  );
  env.document.body.querySelector(".qap-tile").click();
  const reopenedBody = env.document.body.querySelector(".qap-body");
  assert.equal(getEventListeners(reopenedBody, "scroll").length, 1);
  assert.equal(getEventListeners(env.window, "resize").length, 2);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "100 entities");
  assert.equal(env.document.body.querySelectorAll(".qap-state-list").length, 1);
  assert.equal([...env.timers.values()].filter((timer) => timer.delay === 3500).length, 1);
  env.enable(false);
  await flush();
  assert.equal(env.resizeObservers.size, 0);
  assert.equal(env.timers.size, 0);
});

test("virtual favorites can be removed while scrolled without losing details, rows or the scroll anchor", async () => {
  const env = environment();
  env.status.hass.states = largeStates(1000);
  savedProfile(env).favorites = Object.keys(env.status.hass.states);
  await openEntityStates(env);
  await scrollStates(env, 160 + 500 * 74);
  const list = env.document.body.querySelector(".qap-state-list");
  const row = list
    .querySelectorAll(".qap-state-row")
    .find((element) => element.dataset.entity === "sensor.entity_00502");
  row.querySelector("button").click();
  const modal = env.document.body.querySelector(".qap-state-modal");
  await clickAndFlush(modal.querySelector(".qap-state-dialog-favorite"));
  assert.equal(modal.open, true);
  assert.equal(row.isConnected, false);
  assert.equal(env.document.body.querySelector(".qap-body").scrollTop, 160 + 500 * 74);
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "999 entities");
  await clickAndFlush(modal.querySelector(".qap-state-dialog-favorite"));
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "1000 entities");
  assert.equal(
    list
      .querySelectorAll(".qap-state-row")
      .some((element) => element.dataset.entity === row.dataset.entity),
    true,
  );
  modal.dispatchEvent(new Event("cancel"));
  await scrollStates(env, 100000);
  assert.equal(list.children.at(-1).dataset.entity, "sensor.entity_00999");
});

test("replacing a states view releases its virtual listeners and does not let pending searches update the replacement", async () => {
  const env = environment();
  env.status.hass.states = largeStates(1000);
  const search = await openEntityStates(env);
  search.value = "entity_00999";
  search.dispatchEvent(new Event("input"));
  const oldBody = env.document.body.querySelector(".qap-body");
  const profile = clone(env.server.data("test-user").profiles[0]);
  profile.name = "Updated remotely";
  await env.server.mutate("test-user", {
    operation: "update",
    profile_id: profile.id,
    profile,
    revision: env.server.data("test-user").revision,
  });
  await flush();
  const newBody = env.document.body.querySelector(".qap-body");
  assert.notEqual(newBody, oldBody);
  assert.equal(getEventListeners(oldBody, "scroll").length, 0);
  assert.equal(getEventListeners(newBody, "scroll").length, 1);
  assert.equal(getEventListeners(env.window, "resize").length, 2);
  assert.equal(env.resizeObservers.size, 1);
  assert.equal([...env.timers.values()].filter((timer) => timer.delay === 3500).length, 1);
  assert.equal(
    [...env.timers.values()].some((timer) => timer.delay === 175),
    false,
  );
  assert.equal(env.document.body.querySelector(".qap-count").textContent, "1 entity");
  await env.tick(175);
  assert.equal(env.document.body.querySelector(".qap-body"), newBody);
});
