// Entity favorites and recent entity searches.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
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
} = require("./harness.cjs");

test("entity details toggle a favorite star, persist it, and reopen on Favorites", async () => {
  const env = environment();
  env.status.hass.states = {
    "sensor.kitchen": { entity_id: "sensor.kitchen", state: "21", attributes: {} },
    "light.bedroom": { entity_id: "light.bedroom", state: "on", attributes: {} },
  };
  await openEntityStates(env);
  const filters = env.document.body.querySelector(".qap-state-tabs");
  assert.equal(filters.children[0].dataset.domain, "favorites");
  assert.equal(filters.children[0].querySelector("qap-icon"), null);
  assert.equal(
    filters.children.find((chip) => chip.dataset.domain === "all").attributes["aria-pressed"],
    "true",
  );
  await clickAndFlush(
    env.document.body
      .querySelectorAll(".qap-state-row")
      .find((row) => row.dataset.entity === "sensor.kitchen")
      .querySelector("button"),
  );
  const modal = env.document.body.querySelector(".qap-state-modal");
  const star = modal.querySelector(".qap-state-dialog-favorite");
  assert.equal(star.attributes["aria-pressed"], "false");
  assert.equal(star.attributes["aria-label"], "Add to favorites");
  assert.equal(star.querySelector("qap-icon").attributes.icon, "mdi:star-outline");
  await clickAndFlush(star);
  assert.equal(modal.open, true);
  assert.equal(star.attributes["aria-pressed"], "true");
  assert.equal(star.attributes["aria-label"], "Remove from favorites");
  assert.equal(star.querySelector("qap-icon").attributes.icon, "mdi:star");
  assert.deepEqual(savedProfile(env).favorites, ["sensor.kitchen"]);
  env.status.hass.states["sensor.kitchen"].state = "22";
  await env.tick(3500);
  assert.equal(modal.querySelector(".qap-state-dialog-value").textContent, "22");
  assert.equal(modal.querySelector(".qap-state-dialog-favorite"), star);
  await clickAndFlush(buttons(modal).find((b) => b.attributes["aria-label"] === "Back"));
  await clickAndFlush(env.document.body.querySelector(".qap-head-button"));
  await clickAndFlush(env.document.body.querySelector(".qap-tile"));
  assert.equal(
    env.document.body.querySelector(".qap-favorites-tab").attributes["aria-pressed"],
    "true",
  );
  assert.deepEqual(
    env.document.body.querySelectorAll(".qap-state-row").map((row) => row.dataset.entity),
    ["sensor.kitchen"],
  );
});

for (const visibility of ["include", "exclude"]) {
  test(`delayed Favorites acknowledgements preserve newer ${visibility} visibility and conflict protection`, async () => {
    const env = environment();
    env.status.hass.states = {
      "sensor.kitchen": { entity_id: "sensor.kitchen", state: "21", attributes: {} },
    };
    await openEntityStates(env);
    env.document.body.querySelector(".qap-state-summary").click();
    const star = env.document.body.querySelector(".qap-state-dialog-favorite");
    const send = env.connection.sendMessagePromise;
    let acknowledge;
    env.connection.sendMessagePromise = async (message) => {
      const result = await send(message);
      return new Promise((resolve) => {
        acknowledge = () => resolve(result);
      });
    };
    await clickAndFlush(star);
    assert.equal(env.window.quickAccessDebug().profileSaving, true);
    assert.equal(env.fab().hidden, false);

    const data = env.server.data("test-user");
    const profile = clone(data.profiles[0]);
    profile.settings = {
      ...profile.settings,
      visibility,
      routes: [visibility === "include" ? "/missing" : env.context.location.pathname],
    };
    await env.server.mutate("test-user", {
      operation: "update",
      profile_id: profile.id,
      revision: data.revision,
      profile,
    });
    assert.equal(env.fab().hidden, true);

    acknowledge();
    await flush();
    assert.equal(env.fab().hidden, true);
    assert.equal(env.window.quickAccessDebug().hiddenByRoute, true);
    assert.equal(env.window.quickAccessDebug().profileSaving, false);
    assert.equal(env.window.quickAccessDebug().profileRevision, 1);
    assert.equal(env.window.quickAccessDebug().serverRevision, 2);
    assert.equal(star.attributes["aria-pressed"], "true");
    assert.equal(env.document.body.querySelector(".qap-state-modal").open, true);

    env.connection.sendMessagePromise = send;
    await clickAndFlush(star);
    assert.match(env.window.quickAccessDebug().profileError, /changed on another device/);
    assert.match(
      env.document.body.querySelector(".qap-state-modal").querySelector(".qap-error").textContent,
      /changed on another device/,
    );
    assert.equal(env.fab().hidden, true);
    assert.deepEqual(env.server.data("test-user").profiles[0], profile);
    assert.equal(star.attributes["aria-pressed"], "true");
  });
}

test("delayed Favorites acknowledgements cannot restore a remotely deleted active profile", async () => {
  const env = environment();
  env.status.hass.states = {
    "sensor.kitchen": { entity_id: "sensor.kitchen", state: "21", attributes: {} },
  };
  await openEntityStates(env);
  env.document.body.querySelector(".qap-state-summary").click();
  const send = env.connection.sendMessagePromise;
  let acknowledge;
  env.connection.sendMessagePromise = async (message) => {
    const result = await send(message);
    return new Promise((resolve) => {
      acknowledge = () => resolve(result);
    });
  };
  await clickAndFlush(env.document.body.querySelector(".qap-state-dialog-favorite"));
  assert.equal(env.window.quickAccessDebug().profileSaving, true);
  assert.deepEqual(env.server.data("test-user").profiles[0].favorites, ["sensor.kitchen"]);

  await env.server.mutate("test-user", {
    operation: "delete",
    profile_id: "test-profile",
    revision: env.server.data("test-user").revision,
  });
  assert.equal(env.window.quickAccessDebug().serverRevision, 2);
  acknowledge();
  await flush();

  const debug = env.window.quickAccessDebug();
  assert.equal(debug.activeProfileId, null);
  assert.equal(debug.profileSaving, false);
  assert.equal(debug.profileRevision, debug.serverRevision);
  assert.equal(debug.profileError, "");
  assert.equal(env.document.body.querySelector(".qap-state-modal"), null);
  assert.equal(env.document.body.querySelector(".qap-state-list"), null);
  assert.ok(env.document.body.querySelector(".qap-create-default-profile"));
  assert.equal(env.fab().hidden, false);
  assert.equal(env.fab().attributes["aria-label"], "Set up Quick Access");
  assert.deepEqual(env.server.data("test-user").profiles, []);
  assert.equal(
    env.server.requests.filter((request) => !request.type?.startsWith("config/")).length,
    2,
  );
});

test("saved favorites filter searches and removal updates the list without closing details", async () => {
  const env = environment();
  savedProfile(env).favorites = ["sensor.kitchen", "light.bedroom"];
  env.status.hass.states = {
    "sensor.kitchen": {
      entity_id: "sensor.kitchen",
      state: "21",
      attributes: { friendly_name: "Kitchen temperature" },
    },
    "sensor.outside": { entity_id: "sensor.outside", state: "15", attributes: {} },
    "light.bedroom": { entity_id: "light.bedroom", state: "on", attributes: {} },
  };
  const search = await openEntityStates(env);
  const rows = () =>
    env.document.body.querySelectorAll(".qap-state-row").map((row) => row.dataset.entity);
  assert.deepEqual(rows(), ["light.bedroom", "sensor.kitchen"]);
  search.value = "temperature";
  search.dispatchEvent(new Event("input"));
  await env.tick(175);
  assert.deepEqual(rows(), ["sensor.kitchen"]);
  await clickAndFlush(env.document.body.querySelector(".qap-state-summary"));
  let modal = env.document.body.querySelector(".qap-state-modal");
  await clickAndFlush(modal.querySelector(".qap-state-dialog-favorite"));
  assert.equal(modal.open, true);
  assert.deepEqual(rows(), []);
  assert.equal(
    env.document.body.querySelector(".qap-favorites-tab").attributes["aria-pressed"],
    "true",
  );
  assert.deepEqual(savedProfile(env).favorites, ["light.bedroom"]);
  await dispatchAndFlush(modal, new Event("cancel"));
  search.value = "";
  await dispatchAndFlush(search, new Event("input"));
  await clickAndFlush(env.document.body.querySelector(".qap-state-summary"));
  modal = env.document.body.querySelector(".qap-state-modal");
  await clickAndFlush(modal.querySelector(".qap-state-dialog-favorite"));
  assert.equal(modal.open, true);
  assert.deepEqual(savedProfile(env).favorites, []);
  assert.deepEqual(rows(), ["light.bedroom", "sensor.kitchen", "sensor.outside"]);
  assert.equal(
    env.document.body
      .querySelector(".qap-state-tabs")
      .children.find((chip) => chip.dataset.domain === "all").attributes["aria-pressed"],
    "true",
  );
});

test("favorites survive unavailable and missing entities and stay isolated per user", async () => {
  const env = environment();
  savedProfile(env).favorites = ["sensor.kitchen", "sensor.missing"];
  env.status.hass.states = {
    "sensor.kitchen": { entity_id: "sensor.kitchen", state: "unavailable", attributes: {} },
    "sensor.outside": { entity_id: "sensor.outside", state: "15", attributes: {} },
  };
  await openEntityStates(env);
  assert.deepEqual(
    env.document.body.querySelectorAll(".qap-state-row").map((row) => row.dataset.entity),
    ["sensor.kitchen"],
  );
  await clickAndFlush(env.document.body.querySelector(".qap-state-summary"));
  delete env.status.hass.states["sensor.kitchen"];
  await env.tick(3500);
  await clickAndFlush(env.document.body.querySelector(".qap-state-dialog-favorite"));
  assert.deepEqual(savedProfile(env).favorites, ["sensor.missing"]);
  env.enable(false);
  await flush();
  env.status.hass.user = { id: "another-user" };
  env.enable(true);
  await flush();
  await clickAndFlush(env.fab());
  await clickAndFlush(env.document.body.querySelector(".qap-create-default-profile"));
  await clickAndFlush(env.document.body.querySelector(".qap-tile"));
  assert.equal(
    env.document.body
      .querySelector(".qap-state-tabs")
      .children.find((chip) => chip.dataset.domain === "all").attributes["aria-pressed"],
    "true",
  );
  assert.deepEqual(
    env.document.body.querySelectorAll(".qap-state-row").map((row) => row.dataset.entity),
    ["sensor.outside"],
  );
  assert.deepEqual(env.server.data("another-user").profiles[0].favorites, []);
  env.enable(false);
  await flush();
  env.status.hass.user = { id: "test-user" };
  env.enable(true);
  await flush();
  await clickAndFlush(env.fab());
  await clickAndFlush(env.document.body.querySelector(".qap-tile"));
  assert.equal(
    env.document.body.querySelector(".qap-favorites-tab").attributes["aria-pressed"],
    "true",
  );
  assert.ok(env.document.body.querySelector(".qap-state-empty"));
});

for (const savedFavorite of [false, true]) {
  test(`Favorites failures appear in the active entity dialog and clear on retry (${savedFavorite ? "remove" : "add"})`, async () => {
    const env = environment();
    if (savedFavorite) env.server.data("test-user").profiles[0].favorites = ["sensor.kitchen"];
    env.status.hass.states = {
      "sensor.kitchen": { entity_id: "sensor.kitchen", state: "21", attributes: {} },
    };
    await openEntityStates(env);
    env.document.body.querySelector(".qap-state-summary").click();
    const modal = env.document.body.querySelector(".qap-state-modal");
    const star = modal.querySelector(".qap-state-dialog-favorite");
    env.server.failWrites = true;
    await clickAndFlush(star);

    const error = modal.querySelector(".qap-error");
    assert.ok(error, "the active modal must contain the save failure");
    assert.match(error.textContent, /Could not save changes/);
    assert.equal(error.alertType, "error");
    assert.equal(error.attributes.role, "alert");
    assert.equal(modal.open, true);
    assert.equal(star.disabled, false);
    assert.equal(star.attributes["aria-pressed"], String(savedFavorite));
    assert.deepEqual(
      env.server.data("test-user").profiles[0].favorites,
      savedFavorite ? ["sensor.kitchen"] : [],
    );

    env.server.failWrites = false;
    const send = env.connection.sendMessagePromise;
    let acknowledge;
    env.connection.sendMessagePromise = (message) =>
      new Promise((resolve) => {
        acknowledge = async () => resolve(await send(message));
      });
    star.click();
    assert.equal(error.textContent, "");
    assert.equal(star.disabled, true);
    await acknowledge();
    await flush();
    assert.equal(modal.querySelector(".qap-error"), error);
    assert.equal(error.textContent, "");
    assert.equal(modal.open, true);
    assert.equal(star.disabled, false);
    assert.equal(star.attributes["aria-pressed"], String(!savedFavorite));
    assert.deepEqual(
      env.server.data("test-user").profiles[0].favorites,
      savedFavorite ? [] : ["sensor.kitchen"],
    );
  });
}

test("recent entity searches save completed queries, survive reload, and apply to the entity list", async () => {
  const key = `quick_access_v1:test-instance:test-user:test-profile:states-search-history`;
  const env = environment();
  const search = await openEntityStates(env);
  search.value = " kitchen ";
  await dispatchAndFlush(search, new Event("input"));
  assert.equal(env.storage.has(key), false);
  await dispatchAndFlush(search, new Event("focusout"));
  assert.deepEqual(JSON.parse(env.storage.get(key)), ["kitchen"]);
  search.value = "bedroom";
  await dispatchAndFlush(search, new Event("input"));
  const enter = new Event("keydown");
  enter.key = "Enter";
  await dispatchAndFlush(search, enter);
  assert.deepEqual(JSON.parse(env.storage.get(key)), ["bedroom", "kitchen"]);
  search.value = "outside";
  await dispatchAndFlush(search, new Event("input"));
  env.enable(false);
  await flush();
  assert.deepEqual(JSON.parse(env.storage.get(key)), ["outside", "bedroom", "kitchen"]);

  const restored = environment(undefined, env.server, { fresh: true });
  for (const [storageKey, value] of env.storage) restored.storage.set(storageKey, value);
  restored.status.hass.states = {
    "sensor.kitchen": { entity_id: "sensor.kitchen", state: "unknown", attributes: {} },
    "sensor.bedroom": { entity_id: "sensor.bedroom", state: "unknown", attributes: {} },
  };
  const restoredSearch = await openEntityStates(restored);
  await clickAndFlush(
    restored.document.body
      .querySelector(".qap-state-tabs")
      .children.find((chip) => chip.dataset.domain === "unknown"),
  );
  const chip = restored.document.body
    .querySelectorAll(".qap-recent-search")
    .find((element) => element.textContent === "kitchen");
  // Blurring into a history button must preserve it until its click fires.
  restoredSearch.value = "new search";
  await dispatchAndFlush(restoredSearch, new Event("input"));
  const blur = new Event("blur");
  blur.relatedTarget = chip;
  await dispatchAndFlush(restoredSearch, blur);
  assert.ok(chip.parentElement);
  await clickAndFlush(chip);
  assert.equal(restoredSearch.value, "kitchen");
  assert.equal(
    restored.document.body
      .querySelector(".qap-state-tabs")
      .children.find((chip) => chip.dataset.domain === "unknown").attributes["aria-pressed"],
    "true",
  );
  assert.deepEqual(
    restored.document.body.querySelectorAll(".qap-state-row").map((row) => row.dataset.entity),
    ["sensor.kitchen"],
  );
  assert.equal(JSON.parse(restored.storage.get(key))[0], "kitchen");
});

test("opening entity details saves the query without replacing its clicked row on blur", async () => {
  const env = environment();
  env.status.hass.states = {
    "sensor.kitchen": { entity_id: "sensor.kitchen", state: "21", attributes: {} },
  };
  const search = await openEntityStates(env);
  search.value = "kitchen";
  await dispatchAndFlush(search, new Event("input"));
  const summary = env.document.body.querySelector(".qap-state-summary");
  const blur = new Event("blur");
  blur.relatedTarget = summary;
  await dispatchAndFlush(search, blur);
  assert.equal(env.document.body.querySelector(".qap-recent-searches").hidden, true);
  assert.equal(env.document.body.querySelector(".qap-state-summary"), summary);
  await clickAndFlush(summary);
  assert.deepEqual(
    JSON.parse(
      env.storage.get(`quick_access_v1:test-instance:test-user:test-profile:states-search-history`),
    ),
    ["kitchen"],
  );
  assert.equal(
    env.document.body.querySelector(".qap-state-modal").dataset.entity,
    "sensor.kitchen",
  );
  assert.equal(env.document.body.querySelector(".qap-recent-search").textContent, "kitchen");
});

test("recent entity searches are bounded, case-insensitive, validated, and stay cleared on close", async () => {
  const key = `quick_access_v1:test-instance:test-user:test-profile:states-search-history`;
  const env = environment();
  const original = ["Kitchen", ...Array.from({ length: 14 }, (_, index) => `query ${index}`)];
  env.storage.set(
    key,
    JSON.stringify([null, {}, "", "  Kitchen  ", "kitchen", "x".repeat(201), ...original.slice(1)]),
  );
  const search = await openEntityStates(env);
  assert.deepEqual(
    env.document.body.querySelectorAll(".qap-recent-search").map((chip) => chip.textContent),
    original.slice(0, 10),
  );
  assert.deepEqual(JSON.parse(env.storage.get(key)), original.slice(0, 10));
  for (const term of ["attic", "KITCHEN", "  ", "x".repeat(201)]) {
    search.value = term;
    await dispatchAndFlush(search, new Event("input"));
    await dispatchAndFlush(search, new Event("focusout"));
  }
  assert.deepEqual(JSON.parse(env.storage.get(key)), ["KITCHEN", "attic", ...original.slice(1, 9)]);
  search.value = "KITCHEN";
  await dispatchAndFlush(search, new Event("input"));
  await clickAndFlush(env.document.body.querySelector(".qap-clear-searches"));
  assert.equal(env.document.body.querySelector(".qap-recent-searches").hidden, true);
  env.enable(false);
  await flush();
  assert.deepEqual(JSON.parse(env.storage.get(key)), []);
});

test("loading oversized search history stays bounded when storage normalization cannot be saved", async () => {
  const env = environment();
  const key = `quick_access_v1:test-instance:test-user:test-profile:states-search-history`;
  const original = Array.from({ length: 15 }, (_, index) => `query ${index}`);
  env.storage.set(key, JSON.stringify(original));
  env.context.localStorage.setItem = () => {
    throw new Error("Storage full");
  };
  await openEntityStates(env);
  assert.deepEqual(
    env.document.body.querySelectorAll(".qap-recent-search").map((chip) => chip.textContent),
    original.slice(0, 10),
  );
  assert.deepEqual(
    JSON.parse(env.storage.get(key)),
    original,
    "a failed write must leave the saved value intact",
  );
});

test("recent entity searches handle malformed or unavailable storage and isolate users", async () => {
  const key = `quick_access_v1:test-instance:test-user:test-profile:states-search-history`;
  for (const value of ["{", "{}", "null"]) {
    const env = environment();
    env.storage.set(key, value);
    const search = await openEntityStates(env);
    assert.equal(env.document.body.querySelector(".qap-recent-searches").hidden, true);
    env.context.localStorage.setItem = () => {
      throw new Error("storage blocked");
    };
    search.value = "kitchen";
    await dispatchAndFlush(search, new Event("input"));
    await dispatchAndFlush(search, new Event("focusout"));
    assert.equal(env.document.body.querySelector(".qap-recent-search").textContent, "kitchen");
    await clickAndFlush(env.document.body.querySelector(".qap-clear-searches"));
    assert.equal(env.document.body.querySelector(".qap-recent-searches").hidden, true);
  }
  const env = environment();
  const search = await openEntityStates(env);
  search.value = "private search";
  await dispatchAndFlush(search, new Event("input"));
  env.enable(false);
  await flush();
  env.status.hass.user.id = "another-user";
  const otherSearch = await openEntityStates(env);
  assert.equal(otherSearch.value, "");
  assert.equal(env.document.body.querySelector(".qap-recent-searches").hidden, true);
  assert.equal(
    env.storage.has(
      `quick_access_v1:test-instance:another-user:test-profile:states-search-history`,
    ),
    false,
  );
});
