// Integration lifecycle: startup, recovery, reconnects and unload.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const { getEventListeners } = require("node:events");
const test = require("node:test");
const {
  flush,
  clickAndFlush,
  dispatchAndFlush,
  Element,
  environment,
  openEntityStates,
  buttons,
  respondToDiscard,
  openLauncherSettings,
  openSettingsScreen,
  startProfiles,
} = require("./harness.cjs");

test("dialog presets follow views without replacing the open surface", async () => {
  const env = environment();
  await openEntityStates(env);
  const dialog = env.document.body.querySelector("qap-dialog");
  const shell = dialog.querySelector(".qap-shell");
  function check(width, className) {
    assert.equal(dialog.attributes.width, width);
    assert.ok(dialog.className.split(" ").includes(className));
    assert.equal(dialog.querySelector(".qap-shell"), shell);
    assert.equal(dialog.open, true);
  }
  check("medium", "qap-states-dialog");
  buttons(dialog)
    .find((button) => button.title === "Back")
    .click();
  check("medium", "qap-home-dialog");
  assert.equal(dialog.className.split(" ").includes("qap-states-dialog"), false);
  buttons(dialog)
    .find((button) => button.title === "Settings")
    .click();
  check("large", "qap-settings-dialog");
  assert.equal(dialog.className.split(" ").includes("qap-home-dialog"), false);
  openSettingsScreen(env, "shortcuts");
  dialog.querySelector(".qap-add-shortcut").click();
  check("large", "qap-settings-dialog");
  const editor = env.document.body.querySelector(".qap-shortcut-editor");
  assert.notEqual(editor, dialog);
  assert.equal(editor.localName, "qap-dialog");
  const input = editor.querySelector("input, qap-input");
  input.value = "Resized draft";
  input.focus = () => {
    env.document.activeElement = input;
  };
  input.focus();
  for (const width of [320, 390, 768, 1024, 1440]) env.resize(width);
  check("large", "qap-settings-dialog");
  assert.equal(editor.querySelector("input, qap-input"), input);
  assert.equal(input.value, "Resized draft");
  assert.equal(env.document.activeElement, input);
  editor.querySelector(".qap-editor-close").click();
  respondToDiscard(env);
  buttons(dialog)
    .find((button) => button.title === "Back")
    .click();
  check("large", "qap-settings-dialog");
  dialog.querySelector(".qap-back-settings").click();
  check("medium", "qap-home-dialog");
  assert.equal(dialog.open, true);
  dialog.querySelector(".qap-head-button").click();
  env.fab().click();
  const reopened = env.document.body.querySelector("qap-dialog");
  assert.equal(reopened.attributes.width, "medium");
  assert.equal(reopened.className.split(" ").includes("qap-home-dialog"), true);
  assert.equal(env.document.body.querySelectorAll(".qap-shell").length, 1);
});

for (const stage of ["creation", "mount", "show", "render", "cleanup"]) {
  test(`fab dialog recovers from ${stage} failure`, async () => {
    const env = environment();
    await startProfiles(env, false);
    const dialogTag = "qap-dialog";
    env.context.customElements.get = (tag) => (tag === dialogTag ? Element : undefined);
    const open = () => env.fab().click();
    const timerCount = env.timers.size;
    const warnings = [];
    env.context.console.warn = (...args) => warnings.push(args);
    const createElement = env.document.createElement;
    let failedDialog;
    env.document.createElement = (tag) => {
      if (tag === dialogTag && stage === "creation") throw new Error("Dialog creation failed");
      const element = createElement(tag);
      if (tag === dialogTag) {
        failedDialog = element;
        if (stage === "mount") {
          const append = element.append.bind(element);
          element.append = (...children) => {
            append(...children);
            throw new Error("Dialog mount failed");
          };
        }
        if (stage === "show" || stage === "cleanup") {
          let open = false;
          Object.defineProperty(element, "open", {
            configurable: true,
            get: () => open,
            set: (value) => {
              if (stage === "show" || !value) throw new Error("Dialog visibility failed");
              open = value;
            },
          });
        }
      }
      if (tag === "div" && ["render", "cleanup"].includes(stage)) {
        const append = element.append.bind(element);
        element.append = (...children) => {
          append(...children);
          if (children.some((child) => child.className === "qap-feedback"))
            throw new Error("Dialog rendering failed");
        };
      }
      return element;
    };

    open();
    await flush();
    assert.equal(warnings[0][0], "[Quick Access] Could not open dialog.");
    if (stage === "cleanup")
      assert.equal(warnings[1][0], "[Quick Access] Could not clean up failed dialog.");
    assert.equal(env.document.body.querySelector(dialogTag), null);
    assert.equal(failedDialog?.isConnected ?? false, false);
    assert.equal(env.fab().className.split(" ").includes("qap-dialog-open"), false);
    assert.equal(env.timers.size, timerCount);

    env.document.createElement = createElement;
    open();
    const reopened = env.document.body.querySelector(dialogTag);
    assert.equal(reopened.open, true);
    assert.equal(reopened.headerTitle, "Quick Access");
    assert.equal(env.document.body.querySelectorAll(".qap-shell").length, 1);
    reopened.querySelector(".qap-head-button").click();
    assert.equal(env.document.body.querySelector(dialogTag), null);
    env.fab().click();
    assert.equal(env.document.body.querySelector("qap-dialog").headerTitle, "Quick Access");
  });
}

test("repeated frontend initialization failures clean partial listeners and retry without resubscribing", async () => {
  const env = environment();
  let fail = true;
  let attempts = 0;
  const addEventListener = env.window.addEventListener.bind(env.window);
  env.window.addEventListener = (...args) => {
    addEventListener(...args);
    if (args[0] === "popstate") {
      attempts++;
      if (fail) throw new Error("UI listeners failed");
    }
  };
  env.status.snapshot = { enabled: true, entry_id: "quick-access-entry" };
  await env.run();
  await env.tick();
  for (let attempt = 1; attempt <= 2; attempt++) {
    assert.equal(attempts, attempt);
    assert.equal(env.window.quickAccessDebug().initialized, false);
    assert.equal(env.window.quickAccessDebug().initializationError, "UI listeners failed");
    assert.equal(env.window.quickAccessDebug().profileContextReady, false);
    assert.equal(env.fab(), null);
    assert.equal(env.document.head.children.length, 0);
    for (const type of ["show-dialog", "location-changed", "popstate"]) {
      assert.equal(getEventListeners(env.window, type).length, 0);
    }
    if (attempt === 2) fail = false;
    await env.tick(5000);
    await env.tick();
  }
  assert.equal(attempts, 4, "the successful initialization registers history and route listeners");
  assert.equal(env.status.subscriptions, 1);
  assert.equal(env.server.listeners.size, 1);
  assert.equal(env.document.head.children.length, 1);
  assert.equal(env.document.body.querySelectorAll("#qap-fab").length, 1);
  assert.equal(getEventListeners(env.window, "show-dialog").length, 0);
  assert.equal(env.window.quickAccessDebug().initializationError, "");
  openLauncherSettings(env);
  assert.equal(env.document.body.querySelector(".qap-settings-dialog").open, true);
});

test("detached FAB or menu recovers without replacing settings drafts or subscriptions", async () => {
  for (const selector of ["#qap-fab", "#qap-menu"]) {
    const env = environment();
    await startProfiles(env, false);
    const originalFab = env.fab();
    const stylesheet = env.document.head.children[0];
    openLauncherSettings(env);
    const dialog = env.document.body.querySelector(".qap-settings-dialog");
    dialog.querySelector(".qap-textarea").value = "/private/settings";
    env.document.body.querySelector(selector).remove();
    await flush();
    assert.notEqual(env.fab(), originalFab);
    assert.equal(env.document.body.querySelectorAll("#qap-fab").length, 1);
    assert.equal(env.document.body.querySelectorAll("#qap-menu").length, 1);
    assert.equal(env.document.head.children[0], stylesheet);
    assert.equal(env.document.body.querySelector(".qap-settings-dialog"), dialog);
    assert.equal(dialog.querySelector(".qap-textarea").value, "/private/settings");
    assert.equal(env.status.subscriptions, 1);
    assert.equal(env.server.listeners.size, 1);
    assert.equal(getEventListeners(env.window, "show-dialog").length, 0);
  }
});

test("unload cancels retries after frontend or FAB initialization failures", async () => {
  for (const stage of ["frontend", "button"]) {
    const env = environment();
    const createElement = env.document.createElement;
    env.document.createElement = (tag) => {
      if (stage === "frontend" && tag === "link") throw new Error("Stylesheet creation failed");
      const element = createElement(tag);
      const setAttribute = element.setAttribute.bind(element);
      element.setAttribute = (name, value) => {
        if (stage === "button" && value === "Open Quick Access")
          throw new Error("FAB creation failed");
        setAttribute(name, value);
      };
      return element;
    };
    await startProfiles(env, false);
    env.enable(false);
    env.document.createElement = createElement;
    await env.tick(5000);
    await env.tick();
    await env.tick(15000);
    assert.equal(env.fab(), null);
    assert.equal(env.document.head.children.length, 0);
    assert.equal(getEventListeners(env.window, "show-dialog").length, 0);
    assert.equal(env.server.listeners.size, 0);
    assert.equal(env.timers.size, 0);
  }
});

test("waits for HA and activation; duplicate module/status do not inject twice", async () => {
  const env = environment();
  const hass = env.status.hass;
  env.status.hass = undefined;
  await env.run();
  await env.tick();
  assert.equal(env.status.subscriptions, 0);
  env.status.hass = hass;
  await env.tick();
  assert.equal(env.fab(), null);
  env.enable(true);
  await flush();
  env.enable(true);
  await flush();
  await env.run();
  await env.tick();
  assert.equal(env.status.subscriptions, 1);
  assert.equal(env.document.body.querySelectorAll("#qap-fab").length, 1);
  assert.equal(env.document.head.children.length, 1);
  assert.equal(env.window.quickAccessDebug().cssLoaded, true);
});

test("unload removes open dialog, Entity states refresh, CSS, listeners and timers; reload restores UI", async () => {
  const env = environment();
  await startProfiles(env, false);
  await clickAndFlush(env.fab());
  const quickStates = buttons(env.document.body).find(
    (element) => element.className === "qap-tile",
  );
  await clickAndFlush(quickStates);
  assert.ok([...env.timers.values()].some(({ delay }) => delay === 3500));
  assert.ok(env.document.body.querySelector("qap-dialog"));
  env.enable(false);
  await flush();
  assert.equal(env.fab(), null);
  assert.equal(env.document.body.children.length, 0);
  assert.equal(env.document.head.children.length, 0);
  assert.equal(env.timers.size, 0);
  for (const event of ["location-changed", "popstate", "resize", "show-dialog"]) {
    assert.equal(getEventListeners(env.window, event).length, 0);
  }
  assert.equal(getEventListeners(env.document, "pointerdown").length, 0);
  env.enable(true);
  await flush();
  assert.ok(env.fab());
  assert.equal(getEventListeners(env.window, "resize").length, 1);
  await dispatchAndFlush(env.connection, new Event("disconnected"));
  assert.ok(env.fab());
  await dispatchAndFlush(env.connection, new Event("ready"));
  await new Promise(setImmediate);
  assert.ok(env.fab());
  assert.equal(env.status.subscriptions, 2);
});

test("temporary disconnects preserve the launcher and open dialog", async () => {
  const env = environment();
  await startProfiles(env, false);
  const fab = env.fab();
  const stylesheet = env.document.head.children[0];
  await clickAndFlush(fab);
  const dialog = env.document.body.querySelector("qap-dialog");
  await dispatchAndFlush(env.connection, new Event("disconnected"));
  assert.equal(env.fab(), fab);
  assert.equal(env.document.head.children[0], stylesheet);
  assert.equal(env.document.body.querySelector("qap-dialog"), dialog);
  assert.equal(dialog.open, true);
  assert.equal(env.window.quickAccessDebug().integrationEnabled, true);

  await dispatchAndFlush(env.connection, new Event("ready"));
  await new Promise(setImmediate);
  assert.equal(env.fab(), fab);
  assert.equal(env.document.body.querySelector("qap-dialog"), dialog);
  assert.equal(env.status.subscriptions, 2);
  assert.equal(env.status.unsubscriptions, 1);
  assert.equal(env.status.subscriptionOptions.resubscribe, false);
  assert.equal(getEventListeners(env.connection, "ready").length, 1);
  env.enable(false);
  await flush();
  assert.equal(env.fab(), null);
  assert.equal(env.document.head.children.length, 0);
});

test("a failed reconnect subscription retries and applies a later disabled status", async () => {
  const env = environment();
  await startProfiles(env, false);
  const fab = env.fab();
  env.status.fail = true;
  await dispatchAndFlush(env.connection, new Event("disconnected"));
  await dispatchAndFlush(env.connection, new Event("ready"));
  await new Promise(setImmediate);
  assert.equal(env.status.subscriptions, 2);
  assert.equal(env.fab(), fab);
  assert.equal(getEventListeners(env.connection, "ready").length, 0);
  await env.tick();
  assert.equal(env.status.subscriptions, 2);
  env.status.fail = false;
  env.status.snapshot = { enabled: false };
  await env.tick(5000);
  await env.tick();
  assert.equal(env.status.subscriptions, 3);
  // The test server's initial snapshot is disabled, as after removal offline.
  assert.equal(env.fab(), null);
  assert.equal(env.document.head.children.length, 0);
  assert.equal(env.timers.size, 0);
  env.enable(true);
  await flush();
  assert.ok(env.fab());
  assert.equal(getEventListeners(env.connection, "ready").length, 1);
});

test("startup retries stalled status acknowledgements or initial snapshots and ignores their late callbacks", async () => {
  for (const stage of ["acknowledgement", "snapshot"]) {
    const env = environment("https://example.ui.nabu.casa");
    const subscribe = env.connection.subscribeMessage;
    let attempts = 0;
    let lateCallback;
    let finishLateSubscription;
    let lateUnsubscriptions = 0;
    const stopLateSubscription = async () => {
      lateUnsubscriptions++;
    };
    env.connection.subscribeMessage = (callback, message, options) => {
      if (message.type === "quick_access/subscribe_status" && ++attempts === 1) {
        lateCallback = callback;
        return stage === "snapshot"
          ? Promise.resolve(stopLateSubscription)
          : new Promise((resolve) => {
              finishLateSubscription = () => resolve(stopLateSubscription);
            });
      }
      return subscribe(callback, message, options);
    };
    env.status.snapshot = { enabled: true, entry_id: "quick-access-entry" };
    await env.run();
    await env.tick();
    assert.equal(env.fab(), null);
    assert.equal(env.window.quickAccessDebug().lifecyclePending, true);
    await env.tick(10000);
    assert.equal(env.window.quickAccessDebug().lifecyclePending, false);
    assert.equal(
      env.window.quickAccessDebug().lifecycleError,
      "Integration status request timed out",
    );
    lateCallback({ enabled: true, entry_id: "quick-access-entry" });
    assert.equal(env.fab(), null);
    await env.tick();
    assert.equal(attempts, 1);
    await env.tick(5000);
    await env.tick();
    assert.equal(attempts, 2);
    assert.ok(env.fab());
    assert.equal(env.window.quickAccessDebug().lifecycleError, "");
    assert.equal(env.window.quickAccessDebug().lifecycleSubscribed, true);
    assert.equal(env.window.quickAccessDebug().lifecyclePending, false);
    lateCallback({ enabled: false });
    finishLateSubscription?.();
    await flush();
    assert.ok(env.fab());
    assert.equal(lateUnsubscriptions, 1);
    assert.equal(env.document.body.querySelectorAll("#qap-fab").length, 1);
    assert.equal(getEventListeners(env.connection, "ready").length, 1);
    assert.equal(
      [...env.timers.values()].some(({ delay }) => delay === 10000),
      false,
    );
    openLauncherSettings(env);
    assert.equal(env.document.body.querySelector(".qap-settings-dialog").open, true);
    env.enable(false);
    await flush();
    assert.equal(env.timers.size, 0);
  }
});

test("ready supersedes an unfinished status request without letting stale completion unlock the new request", async () => {
  const env = environment();
  const subscribe = env.connection.subscribeMessage;
  const pending = [];
  let staleUnsubscriptions = 0;
  env.connection.subscribeMessage = (callback, message, options) => {
    if (message.type === "quick_access/subscribe_status") {
      return new Promise((resolve) => {
        pending.push({ callback, resolve });
      });
    }
    return subscribe(callback, message, options);
  };
  await env.run();
  await env.tick();
  await dispatchAndFlush(env.connection, new Event("ready"));
  assert.equal(pending.length, 2);
  pending[0].resolve(async () => {
    staleUnsubscriptions++;
  });
  await flush();
  await env.tick();
  assert.equal(pending.length, 2);
  assert.equal(env.window.quickAccessDebug().lifecyclePending, true);
  pending[1].callback({ enabled: true, entry_id: "quick-access-entry" });
  pending[1].resolve(async () => {});
  await flush();
  pending[0].callback({ enabled: false });
  assert.ok(env.fab());
  assert.equal(staleUnsubscriptions, 1);
  assert.equal(env.window.quickAccessDebug().lifecyclePending, false);
  assert.equal(env.window.quickAccessDebug().lifecycleSubscribed, true);
  assert.equal(getEventListeners(env.connection, "ready").length, 1);
});

test("a stalled unsubscribe cannot block reconnect recovery or replace open drafts", async () => {
  const env = environment();
  const subscribe = env.connection.subscribeMessage;
  let firstStatus = true;
  let finishUnsubscribe;
  env.connection.subscribeMessage = async (callback, message, options) => {
    const stop = await subscribe(callback, message, options);
    if (message.type !== "quick_access/subscribe_status" || !firstStatus) return stop;
    firstStatus = false;
    return () =>
      new Promise((resolve) => {
        finishUnsubscribe = async () => {
          await stop();
          resolve();
        };
      });
  };
  env.status.snapshot = { enabled: true, entry_id: "quick-access-entry" };
  await env.run();
  await env.tick();
  openLauncherSettings(env);
  const dialog = env.document.body.querySelector(".qap-settings-dialog");
  dialog.querySelector(".qap-textarea").value = "/private/settings";
  const fab = env.fab();
  await dispatchAndFlush(env.connection, new Event("ready"));
  await env.tick(10000);
  assert.equal(env.fab() === fab, true);
  await env.tick(5000);
  await env.tick();
  assert.equal(env.status.subscriptions, 2);
  await finishUnsubscribe();
  await flush();
  assert.equal(env.status.subscriptions, 2);
  assert.equal(env.fab() === fab, true);
  assert.equal(env.document.body.querySelector(".qap-settings-dialog") === dialog, true);
  assert.equal(dialog.querySelector(".qap-textarea").value, "/private/settings");
  assert.equal(env.window.quickAccessDebug().lifecycleSubscribed, true);
  assert.equal(env.server.listeners.size, 1);
});

test("ready keeps polling when HA user or states are temporarily unavailable", async () => {
  for (const key of ["user", "states"]) {
    const env = environment();
    await env.run();
    await env.tick();
    assert.equal(env.timers.size, 0);
    const previous = env.status.hass[key];
    env.status.hass[key] = null;
    await dispatchAndFlush(env.connection, new Event("ready"));
    assert.equal(env.status.subscriptions, 1);
    env.status.hass[key] = previous;
    env.status.snapshot = { enabled: true, entry_id: "quick-access-entry" };
    await env.tick();
    assert.equal(env.status.subscriptions, 2);
    assert.ok(env.fab());
    assert.equal(env.window.quickAccessDebug().profileContextReady, true);
  }
});

test("failed subscription retries without leaving duplicate ready listeners", async () => {
  const env = environment();
  env.status.fail = true;
  await env.run();
  await env.tick();
  assert.equal(getEventListeners(env.connection, "ready").length, 0);
  assert.equal(env.fab(), null);
  env.status.fail = false;
  await env.tick(5000);
  await env.tick();
  assert.equal(env.status.subscriptions, 2);
  assert.equal(getEventListeners(env.connection, "ready").length, 1);
  env.enable(true);
  await flush();
  assert.ok(env.fab());
});
