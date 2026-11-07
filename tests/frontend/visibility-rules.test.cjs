// URL visibility rules and the URL paths editor.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const { getEventListeners } = require("node:events");
const path = require("node:path");
const test = require("node:test");
const {
  flush,
  clickAndFlush,
  dispatchAndFlush,
  savedProfile,
  environment,
  nativeComponents,
  buttons,
  respondToDiscard,
  openSettingsScreen,
  openSettings,
  startProfiles,
  deviceKey,
} = require("./harness.cjs");

test("URL visibility applies include and exclude rules to exact paths and subpages", async () => {
  const env = environment();
  await startProfiles(env);
  const profile = env.server.data("test-user").profiles[0];
  const cases = [
    { visibility: "exclude", routes: [], shown: [true, true, true] },
    { visibility: "exclude", routes: ["/config/*"], shown: [true, false, true] },
    { visibility: "include", routes: ["/config/*"], shown: [false, true, false] },
    { visibility: "include", routes: ["/lovelace/home"], shown: [true, false, false] },
    { visibility: "exclude", routes: ["/lovelace/home"], shown: [false, true, true] },
    { visibility: "include", routes: [], shown: [false, false, false] },
  ];
  const paths = ["/lovelace/home", "/config/logs", "/lovelace/cameras"];
  for (const { visibility, routes, shown } of cases) {
    Object.assign(profile.settings, { visibility, routes });
    env.server.notify("test-user");
    for (const [index, pathname] of paths.entries()) {
      env.context.location.pathname = pathname;
      await dispatchAndFlush(env.window, new Event("location-changed"));
      assert.equal(env.fab().hidden, !shown[index], `${visibility} ${routes} at ${pathname}`);
    }
  }
  assert.equal(env.server.requests.length, 0);
});

test("saved URL rules survive reload and apply independently of viewport width", async () => {
  const env = environment();
  await startProfiles(env, false);
  assert.equal(env.fab().hidden, false);
  env.resize(1025);
  assert.equal(env.fab().hidden, false);
  env.resize(1024);
  assert.equal(env.fab().hidden, false);
  const key = `${deviceKey(env)}:position`;
  Object.assign(savedProfile(env).settings, {
    visibility: "include",
    routes: ["/config/*"],
    links: [],
  });
  env.server.data("test-user").revision++;
  env.storage.set(key, JSON.stringify({ x: 0.25, y: 0.5 }));
  const stored = [...env.storage];
  env.enable(false);
  await flush();
  env.resize(390);
  env.enable(true);
  await flush();
  assert.equal(env.fab().hidden, true);
  env.context.location.pathname = "/config/devices/dashboard";
  await dispatchAndFlush(env.window, new Event("location-changed"));
  assert.equal(env.fab().hidden, false);
  assert.equal(env.fab().style.left, "85.5px");
  assert.deepEqual([...env.storage], stored);
});

test("URL paths editor keeps line numbers in sync with edits, scrolling, and current URL actions", async () => {
  const env = await openSettings("/config/logs");
  const paths = env.document.body.querySelector(".qap-textarea");
  const lines = env.document.body.querySelector(".qap-url-paths-lines");
  const description = env.document.body.querySelector("#qap-url-paths-description");
  assert.equal(paths.wrap, "off");
  assert.equal(paths.attributes["aria-describedby"], description.id);
  assert.equal(lines.textContent, "1\n2"); // Empty editor displays the two example paths.
  assert.equal(description.textContent, "List the page paths where the button should be hidden.");
  const mode = env.document.body.querySelectorAll("select, qap-select")[0];
  mode.value = "include";
  await dispatchAndFlush(mode, new Event("change"));
  assert.equal(description.textContent, "List the page paths where the button should be shown.");
  paths.value = "/config/automation/*\n/lovelace/cameras\n/config/devices/*";
  await dispatchAndFlush(paths, new Event("input"));
  assert.equal(lines.textContent, "1\n2\n3");
  paths.scrollTop = 20;
  await dispatchAndFlush(paths, new Event("scroll"));
  assert.equal(lines.style.transform, "translateY(-20px)");
  await clickAndFlush(env.document.body.querySelector(".qap-current-url-action"));
  assert.equal(lines.textContent, "1\n2\n3\n4");
  assert.equal(paths.value.split("\n")[3], "/config/logs");
  await clickAndFlush(env.document.body.querySelector(".qap-save-settings"));
  assert.deepEqual(savedProfile(env).settings.routes, [
    "/config/automation/*",
    "/lovelace/cameras",
    "/config/devices/*",
    "/config/logs",
  ]);
});

test("URL paths Learn more tooltip supports hover, keyboard dismissal, and tapping", async () => {
  const env = await openSettings("/config/logs");
  const help = env.document.body.querySelector(".qap-url-paths-help");
  const learnMore = help.querySelector("qap-button");
  const tooltip = help.querySelector(".qap-url-paths-tooltip");
  assert.equal(tooltip.open, false);
  assert.equal(tooltip.attributes.role, "tooltip");
  assert.equal(learnMore.attributes["aria-describedby"], tooltip.id);
  assert.equal(tooltip.querySelector("p").textContent, "Enter one page path per line.");
  assert.deepEqual(
    tooltip.querySelectorAll("code").map((example) => example.textContent),
    ["/config/automation/*", "/lovelace/cameras", "/config/example?view=advanced#section"],
  );
  const explanations = tooltip
    .querySelectorAll("p")
    .map((paragraph) => paragraph.textContent)
    .join(" ");
  assert.match(explanations, /ignoring query parameters/);
  assert.match(explanations, /in the same order/);
  await dispatchAndFlush(help, new Event("pointerenter"));
  assert.equal(tooltip.open, true);
  await dispatchAndFlush(help, new Event("pointerleave"));
  assert.equal(tooltip.open, false);
  await dispatchAndFlush(learnMore, new Event("focusin"));
  assert.equal(tooltip.open, true);
  const escape = new Event("keydown", { cancelable: true });
  escape.key = "Escape";
  await dispatchAndFlush(learnMore, escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(tooltip.open, false);
  assert.equal(env.document.body.querySelector("qap-dialog").open, true);
  await clickAndFlush(learnMore);
  await dispatchAndFlush(help, new Event("pointerleave"));
  assert.equal(tooltip.open, true);
  assert.equal(learnMore.attributes["aria-expanded"], "true");
  await clickAndFlush(learnMore);
  assert.equal(tooltip.open, false);
  await clickAndFlush(learnMore);
  await dispatchAndFlush(learnMore, new Event("focusout"));
  assert.equal(tooltip.open, false);
});

test("owned URL help preserves tap pinning, shadow focus and Escape dismissal through late HA registration", async () => {
  for (const delayed of [false, true]) {
    const env = environment();
    const components = nativeComponents(env, !delayed);
    if (delayed) components.register("ha-form");
    await openSettings("/config/logs", undefined, env);
    const help = env.document.body.querySelector(".qap-url-paths-help");
    const learnMore = help.querySelector(".qap-url-paths-learn-more");
    await clickAndFlush(learnMore);
    if (delayed) {
      assert.equal(help.querySelector(".qap-url-paths-tooltip").open, true);
      components.register();
      await new Promise(setImmediate);
      assert.equal(env.document.body.querySelector("ha-form"), null);
    }
    const tooltip = help.querySelector("qap-tooltip");
    assert.ok(tooltip);
    assert.equal(tooltip.anchorElement, learnMore);
    assert.equal(tooltip.open, true);
    assert.deepEqual(
      tooltip.querySelectorAll("code").map((example) => example.textContent),
      ["/config/automation/*", "/lovelace/cameras", "/config/example?view=advanced#section"],
    );
    await dispatchAndFlush(help, new Event("pointerleave"));
    assert.equal(tooltip.open, true);
    const internalFocus = new Event("focusout");
    internalFocus.relatedTarget = learnMore;
    await dispatchAndFlush(learnMore, internalFocus);
    assert.equal(tooltip.open, true);
    const escape = new Event("keydown", { cancelable: true });
    escape.key = "Escape";
    await dispatchAndFlush(learnMore, escape);
    assert.equal(escape.defaultPrevented, true);
    assert.equal(tooltip.open, false);
    assert.equal(learnMore.attributes["aria-expanded"], "false");
    assert.equal(env.document.body.querySelector("qap-dialog").open, true);
    await dispatchAndFlush(learnMore, new Event("focusin"));
    assert.equal(tooltip.open, true);
    await dispatchAndFlush(learnMore, new Event("focusout"));
    assert.equal(tooltip.open, false);
    env.enable(false);
    await flush();
    assert.equal(env.document.body.querySelector("ha-tooltip"), null);
  }
});

test("Add current URL uses the underlying pathname and applies visibility only after Save", async () => {
  for (const visibility of ["exclude", "include"]) {
    const pathname = "/developer-tools/state";
    const env = await openSettings(pathname, {
      visibility,
      routes: visibility === "include" ? [pathname] : [],
    });
    const originalSettings = JSON.stringify(savedProfile(env).settings);
    const paths = env.document.body.querySelector(".qap-textarea");
    const action = env.document.body.querySelector(".qap-current-url-action");
    const title = env.document.body.querySelector(".qap-current-url-title");
    assert.equal(title.textContent, "Current page");
    assert.equal(env.document.body.querySelector(".qap-current-url-path").textContent, pathname);
    if (visibility === "include") action.click(); // Start by removing the existing rule.
    assert.equal(action.querySelector("span").textContent, "Add");
    assert.equal(title.textContent, "Current page");
    await clickAndFlush(action);
    assert.equal(paths.value, pathname);
    assert.equal(action.querySelector("span").textContent, "Remove");
    assert.equal(title.textContent, "Current page");
    assert.equal(JSON.stringify(savedProfile(env).settings), originalSettings);
    await dispatchAndFlush(env.window, new Event("resize"));
    assert.equal(env.fab().hidden, false);
    await clickAndFlush(env.document.body.querySelector(".qap-save-settings"));
    assert.deepEqual(savedProfile(env).settings.routes, [pathname]);
    assert.equal(env.fab().hidden, visibility === "exclude");
    env.enable(false);
    await flush();
    env.enable(true);
    await flush();
    assert.equal(env.fab().hidden, visibility === "exclude");
  }
});

test("full URL visibility rules toggle independently and respond to query and fragment changes", async () => {
  const env = await openSettings("/config/example");
  const body = env.document.body;
  const pathname = env.window.location.pathname;
  const fullUrl = `${pathname}${env.window.location.search}${env.window.location.hash}`;
  const paths = body.querySelector(".qap-textarea");
  const actions = body.querySelectorAll(".qap-current-url-action");
  assert.equal(actions.length, 3);
  assert.equal(
    body.querySelectorAll(".qap-current-url-row")[2].querySelector("code").textContent,
    fullUrl,
  );
  actions[2].click();
  assert.equal(paths.value, fullUrl);
  assert.deepEqual(
    actions.map((action) => action.querySelector("span").textContent),
    ["Add", "Add", "Remove"],
  );
  actions[0].click();
  actions[2].click();
  assert.equal(paths.value, pathname);
  actions[0].click();
  actions[2].click();
  assert.deepEqual(savedProfile(env).settings.routes, [], "choices remain a draft until saved");
  await clickAndFlush(body.querySelector(".qap-save-settings"));
  assert.deepEqual(savedProfile(env).settings.routes, [fullUrl]);
  assert.equal(env.fab().hidden, true);
  env.window.location.hash = "#other";
  await dispatchAndFlush(env.window, new Event("hashchange"));
  assert.equal(env.fab().hidden, false);
  env.window.location.hash = "#details";
  await dispatchAndFlush(env.window, new Event("popstate"));
  assert.equal(env.fab().hidden, true);
  env.window.location.search = "?view=advanced";
  await dispatchAndFlush(env.window, new Event("location-changed"));
  assert.equal(env.fab().hidden, false);
  env.window.location.search = "?more-info-entity-id=sensor.temperature";
  await env.tick(15000);
  assert.equal(env.fab().hidden, true, "fallback polling also notices suffix-only changes");
});

test("visibility matches page paths independently of suffixes and full URL rules exactly", async () => {
  const env = environment();
  const { routeMatches } = await env.run("utils/urls.js");
  for (const [pattern, url, expected] of [
    ["/config/example", "/config/example?view=advanced#section", true],
    ["/config/*", "/config/example?view=advanced#section", true],
    ["/config/example", "/config/examples?view=advanced", false],
    ["/config/example?view=advanced#section", "/config/example?view=advanced#section", true],
    ["/config/example?view=advanced#section", "/config/example?view=basic#section", false],
    ["/config/example?view=advanced#section", "/config/example?view=advanced#other", false],
    ["/config/example?view=advanced", "/config/example?view=advanced#section", false],
    ["/config/example?view=advanced", "/config/example?view=advanced", true],
    ["/config/example#section", "/config/example#section", true],
    ["/config/example#section", "/config/example?view=advanced#section", false],
    ["/config/example?view=advanced*", "/config/example?view=advanced#section", true],
    ["/config/example?a=1&b=2", "/config/example?b=2&a=1", false],
    ["/config/example?name=a%20b", "/config/example?name=a+b", false],
  ])
    assert.equal(routeMatches(pattern, url), expected, `${pattern} against ${url}`);
});

test("current page section independently toggles exact and subpage entries with HTML controls", async () => {
  for (const removedIndex of [0, 1]) {
    const env = environment();
    const routes = ["/config/tools/yaml", "/config/tools/yaml/*"];
    const unrelated = "/lovelace/cameras";
    await openSettings(routes[0], { visibility: "include", routes: [...routes, unrelated] }, env);
    const originalSettings = JSON.stringify(savedProfile(env).settings);
    const paths = env.document.body.querySelector(".qap-textarea");
    const rows = env.document.body.querySelectorAll(".qap-current-url");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].querySelector(".qap-current-url-path").textContent, routes[0]);
    assert.equal(rows[0].querySelector(".qap-current-url-path").title, routes[0]);
    assert.deepEqual(
      rows[0]
        .querySelectorAll(".qap-current-url-row")
        .slice(0, 2)
        .map((row) => row.querySelector("code").textContent),
      routes,
    );
    const actions = rows[0].querySelectorAll(".qap-current-url-action").slice(0, 2);
    assert.deepEqual(
      actions.map((action) => action.title),
      routes,
    );
    assert.equal(
      getEventListeners(paths, "input").length,
      3,
      "Line numbers, validation and one shared current-page listener",
    );
    const labels = () => actions.map((action) => action.querySelector("span").textContent);
    assert.deepEqual(labels(), ["Remove", "Remove"]);
    await clickAndFlush(actions[removedIndex]);
    const remainingIndex = 1 - removedIndex;
    assert.equal(paths.value, `${routes[remainingIndex]}\n${unrelated}`);
    assert.equal(labels()[removedIndex], "Add");
    assert.equal(labels()[remainingIndex], "Remove");

    await clickAndFlush(actions[remainingIndex]);
    assert.equal(paths.value, unrelated);
    assert.deepEqual(labels(), ["Add", "Add"]);
    await clickAndFlush(actions[removedIndex]);
    assert.equal(paths.value, `${unrelated}\n${routes[removedIndex]}`);
    // Manual edits update both rows independently as well.
    paths.value = `${routes[remainingIndex]}\n${unrelated}`;
    await dispatchAndFlush(paths, new Event("input"));
    assert.equal(labels()[removedIndex], "Add");
    assert.equal(labels()[remainingIndex], "Remove");
    assert.equal(JSON.stringify(savedProfile(env).settings), originalSettings);
    await clickAndFlush(env.document.body.querySelector(".qap-save-settings"));
    assert.deepEqual(savedProfile(env).settings.routes, [routes[remainingIndex], unrelated]);
  }
});

test("Remove current page clears only the displayed entry, preserves overlapping rules and stays unsaved", async () => {
  const pathname = "/developer-tools/state";
  const env = await openSettings(pathname);
  const paths = env.document.body.querySelector(".qap-textarea");
  const action = env.document.body.querySelector(".qap-current-url-action");
  paths.value = ` /developer-tools/* \n${pathname}\n${pathname}\n${pathname}/*\n/lovelace/cameras\n/developer-tools/stateful`;
  await dispatchAndFlush(paths, new Event("input"));
  assert.equal(action.querySelector("span").textContent, "Remove");
  const title = env.document.body.querySelector(".qap-current-url-title");
  assert.equal(title.textContent, "Current page");
  await clickAndFlush(action);
  assert.equal(
    paths.value,
    `/developer-tools/*\n${pathname}/*\n/lovelace/cameras\n/developer-tools/stateful`,
  );
  assert.equal(action.querySelector("span").textContent, "Add");
  assert.equal(title.textContent, "Current page");
  assert.equal(env.server.data("test-user").revision, 0);
  // Leaving without saving asks before discarding the draft.
  buttons(env.document.body)
    .find((element) => element.title === "Back")
    .click();
  respondToDiscard(env);
  await flush();
  openSettingsScreen(env, "visibility");
  await flush();
  assert.equal(env.document.body.querySelector(".qap-textarea").value, "");
});

test("manually edited rules keep the current URL action in sync without duplicate additions", async () => {
  const env = await openSettings("/developer-tools/state");
  const paths = env.document.body.querySelector(".qap-textarea");
  const action = env.document.body.querySelector(".qap-current-url-action");
  paths.value = "/developer-tools/stateful\n/lovelace/cameras";
  await dispatchAndFlush(paths, new Event("input"));
  assert.equal(action.querySelector("span").textContent, "Add");
  await clickAndFlush(action);
  assert.equal(paths.value, "/developer-tools/stateful\n/lovelace/cameras\n/developer-tools/state");
  await clickAndFlush(action);
  assert.equal(paths.value, "/developer-tools/stateful\n/lovelace/cameras");
  paths.value = "/developer-tools/*";
  await dispatchAndFlush(paths, new Event("input"));
  assert.equal(action.querySelector("span").textContent, "Add");
  await clickAndFlush(action);
  assert.equal(paths.value, "/developer-tools/*\n/developer-tools/state");
});

test("page and subpages rules cover the parent and descendants without matching sibling names", async () => {
  for (const pathname of ["/developer-tools/state", "/developer-tools/state/", "/"]) {
    const env = await openSettings(pathname);
    const paths = env.document.body.querySelector(".qap-textarea");
    const basePath = pathname.replace(/\/+$/, "");
    paths.value = `${basePath}/*`; // Do not duplicate an existing descendant rule.
    await dispatchAndFlush(paths, new Event("input"));
    assert.equal(
      env.document.body.querySelectorAll(".qap-current-url-action")[1].querySelector("span")
        .textContent,
      "Remove",
    );
    await clickAndFlush(env.document.body.querySelector(".qap-current-url-action"));
    assert.deepEqual(paths.value.split("\n").sort(), [pathname, `${basePath}/*`].sort());
    await clickAndFlush(env.document.body.querySelector(".qap-save-settings"));
    assert.equal(env.fab().hidden, true);
    env.window.location.pathname = `${basePath}/child`;
    await dispatchAndFlush(env.window, new Event("location-changed"));
    assert.equal(env.fab().hidden, true);
    if (basePath) {
      env.window.location.pathname = `${basePath}ful`;
      await dispatchAndFlush(env.window, new Event("location-changed"));
      assert.equal(env.fab().hidden, false);
    }
  }
});

test("literal asterisks in actual paths retain wildcard semantics without regex", async () => {
  for (const [pattern, path, expected] of [
    ["/config/*", "/config/*abc", true],
    ["/config/*/edit", "/config/*/edit", true],
    ["/config/*/edit", "/config/**/edit", true],
    ["/config/*/edit", "/config/nope", false],
    ["/config/*", "/config", false],
    ["/config/*", "/config/", true],
  ]) {
    const env = environment();
    Object.assign(savedProfile(env).settings, {
      visibility: "include",
      routes: [pattern],
      links: [],
    });
    await startProfiles(env, false);
    env.context.location.pathname = path;
    await dispatchAndFlush(env.window, new Event("location-changed"));
    assert.equal(env.fab().hidden, !expected, `pattern=${pattern} path=${path}`);
  }
});
