// Arrangement long press, keyboard ordering, cancellation and stale saves.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  installLocaleFetch,
  changeLanguage,
  flush,
  clickAndFlush,
  dispatchAndFlush,
  clone,
  savedProfile,
  environment,
  nativeComponents,
  buttons,
  respondToDiscard,
  navigationEnvironment,
  openShortcutsSettings,
  manyShortcuts,
  openArrangement,
  arrangementGeometry,
  arrangementPointer,
  arrangeKey,
  trackFocus,
  categorySelect,
  selectAndFlush,
  confirmMove,
} = require("./harness.cjs");

{
  test("arrangement long press, scrolling, cancellation, keyboard motion and feedback", async () => {
    const env = environment();
    trackFocus(env);
    const profile = savedProfile(env);
    profile.categories.push({ id: "tools", name: "Tools" });
    env.server
      .data("test-user")
      .profiles.push(...["one", "two"].map((id) => ({ ...clone(profile), id, name: id })));
    await openShortcutsSettings("/config", undefined, env);
    const view = await openArrangement(env);
    const list = view.list;
    const dispose = () => view.form.querySelector(".qap-category-cancel").click();
    const original = [...list.children],
      item = original[0],
      other = original[1];
    const initialRequests = env.server.requests.length;
    const pointer = arrangementPointer(env, item);
    for (const row of original) {
      row.closest = () => row;
      row.getBoundingClientRect = () => {
        const index = list.children.indexOf(row),
          top = 128 + index * 60;
        return { left: 0, right: 90, top, bottom: top + 50, width: 90, height: 50 };
      };
    }
    list.getBoundingClientRect = () => ({ left: 0, right: 90, top: 128, bottom: 1000 });
    let hit = item;
    env.document.elementFromPoint = () => hit;
    pointer("pointerdown");
    pointer("pointerup");
    await env.tick(400);
    assert.equal(item.classList.contains("qap-dragging"), false);
    pointer("pointerdown");
    const scrolling = new Event("touchmove", { cancelable: true });
    env.document.dispatchEvent(scrolling);
    assert.equal(scrolling.defaultPrevented, false);
    pointer("pointermove", 45, 170);
    await env.tick(400);
    assert.equal(item.classList.contains("qap-dragging"), false);
    for (const reason of ["pointercancel", "Escape"]) {
      pointer("pointerdown");
      await env.tick(399);
      assert.equal(item.classList.contains("qap-dragging"), false);
      await env.tick(400);
      assert.equal(item.classList.contains("qap-dragging"), true);
      const origin = env.document.body.querySelector(".qap-drag-origin");
      assert.ok(origin);
      assert.equal(origin.parentElement.classList.contains("qap-reorder-scroller"), true);
      assert.equal(
        list.children.includes(origin),
        false,
        "origin stays outside the sortable order",
      );
      const originPosition = { ...origin.style };
      const touch = new Event("touchmove", { cancelable: true });
      env.document.dispatchEvent(touch);
      assert.equal(touch.defaultPrevented, true);
      hit = other;
      pointer("pointermove", 45, 210);
      assert.deepEqual(origin.style, originPosition, "the marker retains its original position");
      if (reason === "Escape")
        env.document.dispatchEvent(
          Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" }),
        );
      else pointer(reason);
      assert.deepEqual(list.children, original);
      assert.equal(env.document.body.querySelector(".qap-drag-origin"), null);
      assert.equal(env.server.requests.length, initialRequests);
      hit = item;
    }
    const animations = [];
    for (const row of original)
      row.animate = (frames, options) => {
        const motion = { options, cancelled: false };
        animations.push(motion);
        return {
          cancel: () => {
            motion.cancelled = true;
          },
        };
      };
    await arrangeKey(item, "ArrowRight");
    assert.equal(item.classList.contains("qap-drop-highlight"), true);
    assert.ok(animations.length > 0);
    assert.ok(
      animations.every(
        ({ options }) =>
          options.duration === 240 && options.easing === "cubic-bezier(.22, 1, .36, 1)",
      ),
    );
    env.context.matchMedia = () => ({ matches: true });
    const count = animations.length;
    await arrangeKey(item, "ArrowLeft");
    assert.equal(animations.length, count);
    assert.ok(animations.every((motion) => motion.cancelled));
    await env.tick(1999);
    assert.equal(item.classList.contains("qap-drop-highlight"), true);
    await env.tick(2000);
    assert.equal(item.classList.contains("qap-drop-highlight"), false);
    pointer("pointerdown");
    await env.tick(400);
    assert.ok(env.document.body.querySelector(".qap-drag-origin"));
    dispose();
    assert.equal(env.document.body.querySelector(".qap-drag-origin"), null);
    assert.equal(
      [...env.timers.values()].some((timer) => [400, 2000].includes(timer.delay)),
      false,
    );
    await env.tick(400);
    assert.equal(item.classList.contains("qap-dragging"), false);
  });
}

test("shortcut reassignment appends through the editor, including empty categories", async () => {
  const env = environment();
  const profile = savedProfile(env);
  profile.categories.push({ id: "tools", name: "Tools" }, { id: "empty", name: "Empty" });
  profile.settings.links = [
    manyShortcuts(1)[0],
    ...manyShortcuts(2, "tools").map((link) => ({ ...link, id: "tools-" + link.id })),
  ];
  const original = clone(profile.settings.links[0]);
  await openShortcutsSettings("/config", undefined, env);
  assert.equal(
    env.document.body.querySelector(".qap-shortcut-groups").querySelector(".qap-grip"),
    null,
  );
  for (const destination of ["tools", "empty", "favorites"]) {
    const row = env.document.body
      .querySelectorAll(".qap-edit-item")
      .find((item) => item.dataset.id === original.id);
    await clickAndFlush(row.querySelector(".qap-shortcut-row"));
    const editor = env.document.body.querySelector(".qap-shortcut-form");
    await selectAndFlush(categorySelect(editor), "category:" + destination);
    const writes = env.server.requests.length;
    env.server.failWrites = true;
    await clickAndFlush(buttons(editor).find((button) => button.textContent === "Save"));
    await confirmMove(env);
    assert.equal(editor.isConnected, true);
    assert.equal(categorySelect(editor).value, "category:" + destination);
    env.server.failWrites = false;
    await clickAndFlush(buttons(editor).find((button) => button.textContent === "Save"));
    await confirmMove(env);
    const assigned = savedProfile(env).settings.links.filter((link) => link.group === destination);
    assert.deepEqual(assigned.at(-1), { ...original, group: destination });
    assert.equal(env.server.requests.length, writes + 2);
  }
});

test("continuous arrangement stages dimensions, labels and cross-page keyboard order atomically", async () => {
  const env = environment();
  const profile = savedProfile(env);
  profile.categories.push({ id: "tools", name: "Tools" });
  profile.categories[0].grid = { columns: 2, rows: 2 };
  profile.settings.links = manyShortcuts(101);
  profile.settings.links[100].hidden = true;
  profile.settings.links.splice(4, 0, { ...manyShortcuts(1, "tools")[0], id: "other" });
  const before = clone(profile);
  await openShortcutsSettings("/config", undefined, env);
  trackFocus(env);
  const view = await openArrangement(env);
  const { form, list, ids } = view;
  assert.equal(list.children.length, 100);
  // 100 cards fill 25 pages exactly; Add opens page 26 and the rest of it stays empty.
  assert.equal(form.querySelectorAll(".qap-grid-placeholder").length, 3);
  const add = form.querySelector(".qap-arrangement-add-row");
  assert.equal(add.classList.contains("qap-page-start"), true);
  assert.ok(
    form
      .querySelector("style")
      .textContent.includes(
        `.qap-arrangement-add::before { content: attr(data-page-label) " 26"; }`,
      ),
  );
  const nodes = [...list.children];
  const moving = nodes[0];
  await arrangeKey(moving, "ArrowDown");
  await arrangeKey(moving, "ArrowDown");
  await arrangeKey(moving, "ArrowRight");
  assert.equal(ids()[5], moving.dataset.id, "vertical and horizontal keys cross the page boundary");
  assert.equal(env.document.activeElement, moving);
  assert.match(list.parentElement.announcement, /Position 6 of 100/);
  assert.equal(env.server.requests.length, 0);
  const draft = [...ids()];
  const [columns, rows] = form.querySelector(".qap-grid-fields").querySelectorAll("qap-input");
  for (const [field, value] of [
    [columns, "3"],
    [rows, "1"],
  ]) {
    field.value = value;
    field.dispatchEvent(new Event("input"));
  }
  assert.deepEqual(ids(), draft);
  assert.ok(
    nodes.every((node) => list.children.includes(node)),
    "dimension changes reuse every tile and wrapper",
  );
  assert.match(form.querySelector("style").textContent, /nth-child\(3n \+ 1\)/);
  const disabled = form.querySelector(".qap-arrangement-disabled").querySelector("qap-select");
  assert.equal(disabled.label, "Disabled shortcuts (1)");
  assert.deepEqual(
    clone(disabled.options).map((option) => option.value),
    ["shortcut-100"],
  );
  assert.equal(
    form.querySelector(".qap-arrangement-disabled").querySelectorAll(".qap-tile").length,
    0,
  );
  assert.equal(form.querySelector(".qap-grip"), null);
  await selectAndFlush(disabled, "shortcut-100");
  assert.deepEqual(ids(), draft);
  assert.deepEqual(savedProfile(env), before);
  const labels = form.querySelector(".qap-grid-labels");
  labels.checked = false;
  await dispatchAndFlush(labels, new Event("change"));
  assert.equal(list.querySelector(".qap-tile-name"), null);
  assert.ok(
    list
      .querySelectorAll(".qap-tile")
      .every((tile) => tile.inert && tile.tabIndex === -1 && !tile.href),
  );
  env.server.failWrites = true;
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.equal(form.isConnected, true);
  assert.deepEqual(ids(), draft);
  assert.deepEqual(savedProfile(env), before);
  env.server.failWrites = false;
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.equal(form.isConnected, false);
  assert.equal(env.server.requests.length, 2);
  const saved = savedProfile(env);
  assert.deepEqual(saved.categories[0].grid, { columns: 3, rows: 1, hideNames: true });
  assert.deepEqual(
    saved.settings.links
      .filter((link) => link.group === "favorites" && !link.hidden)
      .map((link) => link.id),
    draft,
  );
  assert.deepEqual(
    saved.settings.links.find((link) => link.id === "other"),
    before.settings.links.find((link) => link.id === "other"),
  );
  for (const link of saved.settings.links)
    assert.deepEqual(
      link,
      before.settings.links.find((original) => original.id === link.id),
    );
  assert.equal(saved.settings.links.filter((link) => link.hidden).at(-1).id, "shortcut-100");
});

for (const exit of ["cancel", "Escape", "close", "back"]) {
  test(
    "arrangement-only dirty draft survives rejected discard and is discarded through " + exit,
    async () => {
      const env = navigationEnvironment();
      savedProfile(env).categories[0].grid = { columns: 2, rows: 2 };
      savedProfile(env).settings.links = manyShortcuts(9);
      await openShortcutsSettings("/config", undefined, env);
      const { form, list, ids } = await openArrangement(env);
      const initial = ids();
      assert.equal(form.querySelector(".qap-arrangement-disabled"), null);
      await arrangeKey(list.children[0], "ArrowRight");
      const draft = ids();
      if (exit === "cancel") form.querySelector(".qap-category-cancel").click();
      if (exit === "Escape")
        form.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
      if (exit === "close")
        env.document.body
          .querySelector(".qap-category-modal")
          .querySelector(".qap-editor-close")
          .click();
      if (exit === "back") await env.back();
      assert.ok(env.document.body.querySelector(".qap-discard-changes-confirmation"));
      respondToDiscard(env, false);
      assert.deepEqual(ids(), draft);
      form.querySelector(".qap-category-cancel").click();
      respondToDiscard(env, true);
      assert.equal(form.isConnected, false);
      assert.deepEqual(
        savedProfile(env).settings.links.map((link) => link.id),
        initial,
      );
      assert.equal(env.server.requests.length, 0);
    },
  );
}

test("restoring original order is clean; focus, drop feedback and scrolling are never dirty", async () => {
  const env = await openShortcutsSettings("/config");
  const { form, list, surface } = await openArrangement(env);
  const item = list.children[0];
  await arrangeKey(item, "ArrowRight");
  await arrangeKey(item, "ArrowLeft");
  assert.equal(item.classList.contains("qap-drop-highlight"), true);
  surface.scrollTop = 100;
  item.focus();
  form.querySelector(".qap-category-cancel").click();
  assert.equal(form.isConnected, false);
  assert.equal(env.document.body.querySelector(".qap-discard-changes-confirmation"), null);
  assert.equal(env.server.requests.length, 0);
});

for (const reason of ["Escape", "pointercancel", "lostpointercapture", "blur", "pagehide"]) {
  test(
    "grid pointer cancellation restores all DOM nodes without persisting on " + reason,
    async () => {
      const env = environment();
      savedProfile(env).categories[0].grid = { columns: 2, rows: 2 };
      savedProfile(env).settings.links = manyShortcuts(9);
      await openShortcutsSettings("/config", undefined, env);
      const view = await openArrangement(env);
      arrangementGeometry(view);
      const original = [...view.list.children];
      const pointer = arrangementPointer(env, original[0]);
      pointer("pointerdown");
      await env.tick(400);
      pointer("pointermove", 145, 153);
      assert.notDeepEqual(
        view.list.children,
        original,
        "horizontal hit testing moves to the second column",
      );
      pointer("pointermove", 45, 273);
      assert.equal(
        view.list.children.indexOf(original[0]),
        4,
        "vertical hit testing crosses into page two",
      );
      if (reason === "Escape")
        env.document.dispatchEvent(
          Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" }),
        );
      else if (["blur", "pagehide"].includes(reason)) env.window.dispatchEvent(new Event(reason));
      else if (reason === "lostpointercapture") {
        original[0].hasPointerCapture = () => false;
        pointer(reason);
      } else pointer(reason);
      pointer("pointerup");
      await flush();
      assert.deepEqual(view.list.children, original);
      assert.equal(env.server.requests.length, 0);
      view.form.querySelector(".qap-category-cancel").click();
      assert.equal(env.document.body.querySelector(".qap-discard-changes-confirmation"), null);
    },
  );
}

test("long grid scrolls at both edges, stages a drop and retains nodes for pointer moves", async () => {
  const env = environment();
  savedProfile(env).categories[0].grid = { columns: 2, rows: 2 };
  savedProfile(env).settings.links = manyShortcuts(100);
  await openShortcutsSettings("/config", undefined, env);
  const view = await openArrangement(env);
  arrangementGeometry(view);
  const original = [...view.list.children];
  const pointer = arrangementPointer(env, original[0]);
  pointer("pointerdown");
  await env.tick(400);
  pointer("pointermove", 145, 390);
  await env.tick(16);
  const down = view.surface.scrollTop;
  assert.ok(down > 0);
  await env.tick(16);
  assert.ok(view.surface.scrollTop > down);
  pointer("pointermove", 145, 110);
  const beforeUp = view.surface.scrollTop;
  await env.tick(16);
  assert.ok(view.surface.scrollTop < beforeUp);
  pointer("pointermove", 145, 250);
  const middle = view.surface.scrollTop;
  await env.tick(32);
  assert.equal(view.surface.scrollTop, middle);
  assert.ok(original.every((node) => view.list.children.includes(node)));
  assert.equal(view.list.children.length, 100);
  pointer("pointerup");
  await flush();
  assert.equal(env.server.requests.length, 0);
  assert.notDeepEqual(
    view.ids(),
    original.map((item) => item.dataset.id),
  );
  view.form.querySelector(".qap-category-cancel").click();
  respondToDiscard(env, true);
  assert.deepEqual(
    savedProfile(env).settings.links.map((link) => link.id),
    original.map((item) => item.dataset.id),
  );
});

for (const reason of [
  "tap",
  "movement",
  "pointercancel",
  "pointerleave",
  "blur",
  "pagehide",
  "Escape",
  "close",
]) {
  test(
    "arrangement pending long press stays inert and releases its timer on " + reason,
    async () => {
      const env = await openShortcutsSettings("/config");
      const view = await openArrangement(env);
      arrangementGeometry(view);
      const original = [...view.list.children];
      const item = original[0],
        pointer = arrangementPointer(env, item);
      assert.equal(pointer("pointerdown").defaultPrevented, false);
      assert.equal(item.hasPointerCapture(7), false, "pending press does not capture the pointer");
      assert.equal(item.classList.contains("qap-dragging"), false);
      const touchMove = new Event("touchmove", { cancelable: true });
      env.document.dispatchEvent(touchMove);
      assert.equal(touchMove.defaultPrevented, false, "scrolling is allowed before activation");
      if (reason === "tap") {
        pointer("pointerup");
        item.click();
      }
      if (reason === "movement")
        assert.equal(pointer("pointermove", 45, 170).defaultPrevented, false);
      if (["pointercancel", "pointerleave"].includes(reason)) pointer(reason);
      if (["blur", "pagehide"].includes(reason)) env.window.dispatchEvent(new Event(reason));
      if (reason === "Escape")
        env.document.dispatchEvent(
          Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" }),
        );
      if (reason === "close") view.form.querySelector(".qap-category-cancel").click();
      assert.equal(
        [...env.timers.values()].some((timer) => timer.delay === 400),
        false,
      );
      await env.tick(400);
      assert.equal(item.classList.contains("qap-dragging"), false);
      assert.equal(item.hasPointerCapture(7), false);
      assert.deepEqual(view.list.children, original);
      assert.equal(env.server.requests.length, 0);
      if (reason !== "close") view.form.querySelector(".qap-category-cancel").click();
      assert.equal(env.document.body.querySelector(".qap-discard-changes-confirmation"), null);
    },
  );
}

test("arrangement long press activates, blocks native scroll and highlights only successful drops", async () => {
  const env = await openShortcutsSettings("/config");
  const view = await openArrangement(env);
  arrangementGeometry(view);
  const first = view.list.children[0],
    pointer = arrangementPointer(env, first);
  pointer("pointerdown");
  await env.tick(400);
  assert.equal(first.classList.contains("qap-dragging"), true);
  assert.equal(first.hasPointerCapture(7), true);
  assert.equal(first.getAttribute("aria-pressed"), "true");
  assert.equal(view.surface.querySelector(".qap-drag-origin").parentElement, view.surface);
  assert.equal(view.list.children.length, 2, "origin marker is outside the sortable sequence");
  const touchMove = new Event("touchmove", { cancelable: true });
  env.document.dispatchEvent(touchMove);
  assert.equal(touchMove.defaultPrevented, true);
  pointer("pointermove", 145, 150);
  pointer("pointerup");
  await flush();
  assert.equal(view.surface.querySelector(".qap-drag-origin"), null);
  assert.equal(first.classList.contains("qap-drop-highlight"), true);
  assert.equal(env.server.requests.length, 0);
  const oldTimer = [...env.timers].find(([, timer]) => timer.delay === 2000)[0];
  pointer("pointerdown", 145, 150);
  await env.tick(400);
  assert.equal(first.classList.contains("qap-drop-highlight"), false);
  assert.equal(env.timers.has(oldTimer), false, "a new drag clears old drop feedback");
  pointer("pointercancel");
  await flush();
  assert.equal(first.classList.contains("qap-drop-highlight"), false, "cancel does not highlight");
  await arrangeKey(first, "ArrowLeft");
  assert.equal(first.classList.contains("qap-drop-highlight"), true);
  await env.tick(2000);
  assert.equal(first.classList.contains("qap-drop-highlight"), false);
  await arrangeKey(first, "ArrowRight");
  await arrangeKey(first, "ArrowLeft");
  view.form.querySelector(".qap-category-cancel").click();
  assert.equal(env.document.body.querySelector(".qap-discard-changes-confirmation"), null);
  assert.equal(
    [...env.timers.values()].some((timer) => [400, 2000].includes(timer.delay)),
    false,
  );
  assert.equal(first.classList.contains("qap-drop-highlight"), false);
});

test("disabled shortcut selection preserves its source order and is never a draft change", async () => {
  const env = environment();
  savedProfile(env).settings.links = manyShortcuts(4);
  savedProfile(env).settings.links[2].hidden = savedProfile(env).settings.links[3].hidden = true;
  const before = clone(savedProfile(env));
  await openShortcutsSettings("/config", undefined, env);
  const view = await openArrangement(env);
  const field = view.form.querySelector(".qap-arrangement-disabled").querySelector("qap-select");
  assert.deepEqual(
    clone(field.options).map((option) => [option.value, option.label]),
    [
      ["shortcut-2", "Shortcut 2"],
      ["shortcut-3", "Shortcut 3"],
    ],
  );
  await selectAndFlush(field, "shortcut-3");
  assert.deepEqual(view.ids(), ["shortcut-0", "shortcut-1"]);
  assert.equal(view.form.querySelectorAll(".qap-tile").length, 2);
  view.form.querySelector(".qap-category-cancel").click();
  assert.equal(env.document.body.querySelector(".qap-discard-changes-confirmation"), null);
  assert.deepEqual(savedProfile(env), before);
  assert.equal(env.server.requests.length, 0);
});

test("arrangement FLIP animations replace ongoing motion and respect reduced motion", async () => {
  const env = await openShortcutsSettings("/config");
  const view = await openArrangement(env);
  arrangementGeometry(view);
  const calls = [];
  let reduced = false;
  env.context.matchMedia = () => ({ matches: reduced });
  for (const item of view.list.children)
    item.animate = (frames, options) => {
      const call = { frames, options, cancelled: false };
      calls.push(call);
      return {
        cancel: () => {
          call.cancelled = true;
        },
      };
    };
  const first = view.list.children[0];
  await arrangeKey(first, "ArrowRight");
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(
      (call) =>
        call.options.duration === 240 && call.options.easing === "cubic-bezier(.22, 1, .36, 1)",
    ),
  );
  await arrangeKey(first, "ArrowLeft");
  assert.ok(
    calls.slice(0, 2).every((call) => call.cancelled),
    "old transforms cannot compete with new motion",
  );
  reduced = true;
  await arrangeKey(first, "ArrowRight");
  assert.equal(calls.length, 4, "reduced motion still reorders immediately without animations");
  assert.ok(calls.every((call) => call.cancelled));
  assert.equal(view.ids()[1], first.dataset.id);
  assert.equal(env.server.requests.length, 0);
  await arrangeKey(first, "ArrowLeft");
  view.form.querySelector(".qap-category-cancel").click();
});

for (const remote of ["edit", "move", "delete"]) {
  test("stale category Save preserves its full draft after remote shortcut " + remote, async () => {
    const env = environment();
    const profile = savedProfile(env);
    profile.categories.push({ id: "tools", name: "Tools" });
    profile.categories[0].grid = { columns: 2, rows: 2 };
    profile.settings.links = manyShortcuts(9);
    await openShortcutsSettings("/config", undefined, env);
    const { form, list, ids } = await openArrangement(env);
    await arrangeKey(list.children[0], "ArrowRight");
    const draft = ids();
    const columns = form.querySelector(".qap-grid-fields").querySelector("qap-input");
    columns.value = "3";
    columns.dispatchEvent(new Event("input"));
    const latest = clone(savedProfile(env));
    if (remote === "edit") latest.settings.links[0].name = "Remote name";
    if (remote === "move") latest.settings.links[0].group = "tools";
    if (remote === "delete") latest.settings.links.shift();
    await env.server.mutate("test-user", {
      operation: "update",
      profile_id: latest.id,
      revision: env.server.data("test-user").revision,
      profile: latest,
    });
    await clickAndFlush(form.querySelector(".qap-category-submit"));
    assert.equal(form.isConnected, true);
    assert.deepEqual(ids(), draft);
    assert.equal(columns.value, "3");
    assert.match(form.querySelector(".qap-error").textContent, /changed|reload|conflict/i);
    assert.deepEqual(savedProfile(env), latest);
    assert.equal(env.server.requests.at(-1).revision, 0);
  });
}

test("order-only category Save preserves category properties; settings-only Save preserves interleaved links exactly", async () => {
  const env = environment();
  const profile = savedProfile(env);
  profile.categories.push({ id: "tools", name: "Tools" });
  profile.settings.links = [
    manyShortcuts(2)[0],
    { ...manyShortcuts(1, "tools")[0], id: "other" },
    manyShortcuts(2)[1],
  ];
  const before = clone(profile);
  await openShortcutsSettings("/config", undefined, env);
  let view = await openArrangement(env);
  await arrangeKey(view.list.children[0], "ArrowRight");
  await clickAndFlush(view.form.querySelector(".qap-category-submit"));
  assert.deepEqual(
    savedProfile(env).categories,
    before.categories,
    "no default grid property is added on an order-only Save",
  );
  const ordered = clone(savedProfile(env).settings.links);
  view = await openArrangement(env);
  const columns = view.form.querySelector(".qap-grid-fields").querySelector("qap-input");
  columns.value = "4";
  await clickAndFlush(view.form.querySelector(".qap-category-submit"));
  assert.deepEqual(savedProfile(env).settings.links, ordered);
});

test("arrangement instructions, inert tile actions and Enter/Space cannot submit the category form", async () => {
  const env = environment();
  installLocaleFetch(env);
  await openShortcutsSettings("/config", undefined, env);
  const { form, list } = await openArrangement(env);
  const handle = list.children[0];
  assert.equal(handle.inert, undefined);
  assert.match(handle.getAttribute("aria-keyshortcuts"), /Alt\+ArrowRight/);
  assert.match(handle.getAttribute("aria-description"), /one row/);
  for (const key of ["Enter", " "]) {
    const event = Object.assign(new Event("keydown", { bubbles: true, cancelable: true }), { key });
    Object.defineProperty(event, "target", { value: handle });
    event.composedPath = () => [
      handle,
      list.children[0],
      list,
      form.querySelector(".qap-arrangement"),
      form,
    ];
    form.dispatchEvent(event);
    handle.click();
    list.querySelector(".qap-tile").click();
    assert.equal(form.isConnected, true);
    assert.equal(env.server.requests.length, 0);
  }
  await changeLanguage(env, "hr");
  assert.match(handle.getAttribute("aria-description"), /redak/);
  await changeLanguage(env, "en");
  const touch = new Event("touchstart", { cancelable: true });
  let stopped = false;
  touch.composedPath = () => [handle, list];
  touch.stopPropagation = () => {
    stopped = true;
  };
  list.dispatchEvent(touch);
  assert.equal(stopped, true);
  assert.equal(touch.defaultPrevented, false);
});
