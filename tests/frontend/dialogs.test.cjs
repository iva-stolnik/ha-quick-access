// Dialog cleanup, More Info, adaptive details and confirmation focus.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const { getEventListeners } = require("node:events");
const path = require("node:path");
const test = require("node:test");
const {
  clickAndFlush,
  dispatchAndFlush,
  Element,
  environment,
  openEntityStates,
  nativeComponents,
  buttons,
  openShortcutsSettings,
  delayNativeFocus,
  startProfiles,
  shortcutAction,
} = require("./harness.cjs");

test("dialog cleanup retains the surface through closing and cancels stale removal listeners", async () => {
  const env = environment();
  const { createDialogs } = await env.run("ui/dialogs.js");
  const dialogs = createDialogs({ l10n: { release() {} }, ui: {} });
  const modal = new Element("qap-dialog");
  env.document.body.append(modal);
  modal.open = false;
  modal.shadowRoot = { querySelector: () => ({ open: true }) };
  let closes = 0;
  modal.close = () => {
    closes++;
  };
  dialogs.cleanupDialogElement(modal);
  dialogs.cleanupDialogElement(modal);
  assert.equal(closes, 1, "an already closing surface waits for its completion event");
  assert.equal(modal.parentElement, env.document.body);
  assert.equal(getEventListeners(modal, "closed").length, 1);
  dialogs.cancelRemoval(modal);
  assert.equal(getEventListeners(modal, "closed").length, 0);
  modal.dispatchEvent(new Event("closed"));
  assert.equal(modal.parentElement, env.document.body);
  dialogs.cleanupDialogElement(modal);
  modal.dispatchEvent(new Event("closed"));
  assert.equal(modal.parentElement, null);
});

test("dialog cleanup preserves a reopened surface and releases listeners on disposal", async () => {
  const env = environment();
  const { createDialogs } = await env.run("ui/dialogs.js");
  const dialogs = createDialogs({ l10n: { release() {} }, ui: {} });
  const modal = new Element("qap-dialog");
  env.document.body.append(modal);
  modal.open = true;
  modal.close = () => {
    modal.open = false;
  };
  dialogs.cleanupDialogElement(modal);
  modal.open = true;
  modal.dispatchEvent(new Event("closed"));
  assert.equal(
    modal.parentElement,
    env.document.body,
    "a close listener can reopen before closed is dispatched",
  );
  dialogs.cleanupDialogElement(modal);
  dialogs.dispose();
  assert.equal(modal.parentElement, null);
  assert.equal(getEventListeners(modal, "closed").length, 0);
});

test("MDI More Info preserves entity details and Quick Access while route navigation closes them", async () => {
  const env = environment();
  env.status.hass.states = {
    "sensor.temperature": { entity_id: "sensor.temperature", state: "21", attributes: {} },
  };
  await startProfiles(env, false);
  await clickAndFlush(env.fab());
  await clickAndFlush(
    buttons(env.document.body).find((element) => element.className === "qap-tile"),
  );
  const quickAccess = env.document.body.querySelector("qap-dialog");
  await clickAndFlush(quickAccess.querySelector(".qap-state-summary"));
  const entityDetails = env.document.body.querySelector(".qap-state-modal");
  assert.equal(entityDetails.localName, "qap-dialog");
  assert.equal(
    entityDetails.querySelector(".qap-shell"),
    entityDetails.querySelector(".qap-state-modal-content"),
  );
  const moreInfo = entityDetails.querySelector(".qap-state-dialog-info");
  assert.equal(moreInfo.querySelector("qap-icon").attributes.icon, "mdi:information-outline");
  for (const selector of [".qap-state-dialog-id-copy", ".qap-state-dialog-state-copy"]) {
    assert.equal(
      entityDetails.querySelector(selector).querySelector("qap-icon").attributes.icon,
      "mdi:content-copy",
    );
  }
  let moreInfoEvent;
  env.homeAssistant.addEventListener("hass-more-info", (event) => {
    moreInfoEvent = event;
    env.context.location.search = "?more-info-entity-id=sensor.temperature";
    env.window.dispatchEvent(new Event("location-changed"));
  });
  await clickAndFlush(moreInfo);
  assert.equal(moreInfoEvent.detail.entityId, "sensor.temperature");
  assert.equal(moreInfoEvent.bubbles, true);
  assert.equal(moreInfoEvent.composed, true);
  assert.equal(quickAccess.open, true);
  assert.equal(entityDetails.open, true);
  // HA closing the more-info dialog restores history without changing path.
  env.context.location.search = "";
  await dispatchAndFlush(env.window, new Event("popstate"));
  await dispatchAndFlush(env.window, new Event("location-changed"));
  assert.equal(env.document.body.querySelector("qap-dialog"), quickAccess);
  assert.equal(quickAccess.open, true);
  assert.equal(env.document.body.querySelector(".qap-state-modal"), entityDetails);
  assert.equal(entityDetails.open, true);
  assert.ok([...env.timers.values()].some(({ delay }) => delay === 3500));
  env.context.location.pathname = "/config/devices/dashboard";
  await dispatchAndFlush(env.window, new Event("popstate"));
  assert.equal(quickAccess.open, false);
  assert.equal(entityDetails.open, false);
  assert.equal(
    [...env.timers.values()].some(({ delay }) => delay === 3500),
    false,
  );
});

test("adaptive entity details close with animations and restore focus without closing Entity states", async () => {
  const env = environment();
  env.status.hass.states = {
    "sensor.temperature": { entity_id: "sensor.temperature", state: "21", attributes: {} },
  };
  await openEntityStates(env);
  const quickAccess = env.document.body.querySelector("qap-dialog");
  const summary = quickAccess.querySelector(".qap-state-summary");
  let focused = false;
  summary.focus = () => {
    focused = true;
  };
  await clickAndFlush(summary);
  const details = env.document.body.querySelector(".qap-state-modal");
  await clickAndFlush(buttons(details).find((button) => button.title === "Back"));
  assert.equal(details.open, false);
  assert.equal(details.isConnected, false);
  assert.equal(focused, true);
  await dispatchAndFlush(details, new Event("closed"));
  assert.equal(details.isConnected, false);
  assert.equal(focused, true);
  assert.equal(quickAccess.open, true);

  // The dialog emits closed for Escape, backdrop clicks and bottom-sheet dismissal.
  await clickAndFlush(summary);
  const reopened = env.document.body.querySelector(".qap-state-modal");
  await dispatchAndFlush(reopened, new Event("cancel", { cancelable: true }));
  await env.tick(550);
  assert.equal(reopened.isConnected, false);
  assert.equal(quickAccess.open, true);
  await clickAndFlush(summary);
  const latest = env.document.body.querySelector(".qap-state-modal");
  assert.equal(latest.open, true);
  // A delayed event from an earlier dialog must not dismiss the current one.
  await dispatchAndFlush(details, new Event("closed"));
  assert.equal(latest.open, true);
  assert.equal(latest.isConnected, true);
});

test(`delete confirmation waits for the Cancel button to render`, async () => {
  const env = environment();
  nativeComponents(env);
  await openShortcutsSettings("/config", undefined, env);
  const pending = delayNativeFocus(env, "qap-button");
  await shortcutAction(env, "delete");
  const modal = env.document.body.querySelector(".qap-confirmation");
  const cancel = buttons(modal).find((element) => element.textContent === "Cancel");
  const state = pending.get(cancel);
  assert.equal(state.earlyFocus, 0);
  assert.equal(state.focusCalls, 0);
  assert.equal(modal.open, true);
  state.render();
  await new Promise(setImmediate);
  assert.equal(state.earlyFocus, 0);
  assert.equal(state.focusCalls, 1);
  assert.equal(env.document.activeElement, cancel);
  await clickAndFlush(cancel);
  assert.equal(modal.open, false);
});

test("a pending confirmation cannot steal focus after dismissal, replacement, or unload", async () => {
  for (const exit of ["cancel", "replace", "disable"]) {
    const env = environment();
    nativeComponents(env);
    await openShortcutsSettings("/config", undefined, env);
    const pending = delayNativeFocus(env, "qap-button");
    await shortcutAction(env, "delete");
    const modal = env.document.body.querySelector(".qap-confirmation");
    const cancel = buttons(modal).find((element) => element.textContent === "Cancel");
    const state = pending.get(cancel);
    if (exit === "disable") env.enable(false);
    else cancel.click();
    let replacement;
    if (exit === "replace") {
      await shortcutAction(env, "delete");
      replacement = env.document.body
        .querySelectorAll(".qap-confirmation")
        .find((element) => element !== modal);
      assert.equal(replacement.open, true);
    }
    state.render();
    await new Promise(setImmediate);
    assert.equal(state.earlyFocus, 0);
    assert.equal(state.focusCalls, 0);
    if (replacement) {
      const nextCancel = buttons(replacement).find((element) => element.textContent === "Cancel");
      pending.get(nextCancel).render();
      await new Promise(setImmediate);
      assert.equal(env.document.activeElement, nextCancel);
    }
  }
});

test("entity details wait for the Back button to render and skip focus if dismissed meanwhile", async () => {
  for (const dismiss of [false, true]) {
    const env = environment();
    nativeComponents(env);
    env.status.hass.states = {
      "sensor.kitchen": { entity_id: "sensor.kitchen", state: "21", attributes: {} },
    };
    await openEntityStates(env);
    const pending = delayNativeFocus(env, "qap-icon-button");
    await clickAndFlush(env.document.body.querySelector(".qap-state-summary"));
    const modal = env.document.body.querySelector(".qap-state-modal");
    const close = buttons(modal).find((element) => element.title === "Back");
    const state = pending.get(close);
    assert.equal(state.earlyFocus, 0);
    if (dismiss) close.click();
    state.render();
    await new Promise(setImmediate);
    assert.equal(state.focusCalls, dismiss ? 0 : 1);
  }
});
