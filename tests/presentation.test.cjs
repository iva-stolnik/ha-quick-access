const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { createModuleLoader } = require("./module-loader.cjs");

// Exercise presentation lifecycles with deterministic timers. Real rendering,
// native input and the accessibility tree are covered by Chromium separately.
async function fixture(file) {
  const timers = new Map();
  let nextTimer = 0;
  class Element extends EventTarget {
    constructor() {
      super();
      this.isConnected = true;
      this.children = [];
      this.attributes = new Map();
      this.updateComplete = Promise.resolve(true);
      this.style = {};
      this.hidden = false;
    }
    requestUpdate() {}
    setAttribute(name, value) {
      this.attributes.set(name, value);
    }
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
    toggleAttribute(name, value) {
      if (value) this.attributes.set(name, "");
      else this.attributes.delete(name);
    }
    addEventListener(...args) {
      super.addEventListener(...args);
    }
    connectedCallback() {}
    disconnectedCallback() {}
    focus() {
      this.focused = true;
    }
    click() {
      this.dispatchEvent(new Event("click"));
    }
  }
  class DetailEvent extends Event {
    constructor(name, init = {}) {
      super(name, init);
      this.detail = init.detail;
    }
  }
  const document = new Element(),
    window = new Element();
  const context = vm.createContext({
    HTMLElement: Element,
    Event,
    EventTarget,
    InputEvent: Event,
    CustomEvent: DetailEvent,
    document,
    window,
    AbortController,
    performance,
    console,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  const module = await createModuleLoader(context).load(file);
  const flush = async () => {
    for (let index = 0; index < 12; index++) await Promise.resolve();
  };
  const tick = async (delay) => {
    for (const [id, timer] of [...timers])
      if (timer.delay === delay && timers.has(id)) {
        timers.delete(id);
        timer.callback();
      }
    await flush();
  };
  const surface = {
    opened: false,
    className: "",
    style: {},
    showPopover() {
      this.opened = true;
    },
    hidePopover() {
      this.opened = false;
    },
    matches() {
      return this.opened;
    },
    getBoundingClientRect() {
      return {};
    },
    getAnimations() {
      return [];
    },
  };
  const mount = (control) => {
    control.shadowRoot = { querySelector: () => surface };
    return control;
  };
  return { module, timers, flush, tick, mount, surface, Element };
}

test("toast restarts its duration for repeated messages, announces once, and closes once", async () => {
  const f = await fixture("ui/components/toast.ts"),
    toast = f.mount(new f.module.QapToast());
  const closed = [];
  toast.addEventListener("toast-closed", (event) =>
    closed.push([event.detail.reason, event.bubbles, event.composed]),
  );
  toast.labelText = "Copied";
  toast.timeoutMs = 2200;
  await toast.show();
  assert.equal(toast.announcing, true);
  const firstTimer = [...f.timers.keys()][0];
  const again = toast.show();
  assert.equal(
    toast.announcing,
    false,
    "repeat clears the persistent live region before repopulating it",
  );
  await again;
  assert.equal(f.timers.has(firstTimer), false);
  assert.equal(f.timers.size, 1);
  await f.tick(2200);
  assert.equal(f.surface.opened, false);
  assert.equal(toast.announcing, false);
  assert.deepEqual(closed, [["timeout", true, true]]);
  await toast.close();
  assert.equal(closed.length, 1);
});

test("toast rapid messages and disconnection invalidate pending transitions and timers", async () => {
  const f = await fixture("ui/components/toast.ts"),
    toast = f.mount(new f.module.QapToast());
  let finish;
  f.surface.getAnimations = () => [
    {
      finished: new Promise((resolve) => {
        finish = resolve;
      }),
    },
  ];
  toast.labelText = "First";
  const first = toast.show();
  await f.flush();
  toast.labelText = "Latest";
  const latest = toast.show();
  await f.flush();
  assert.equal(
    [...f.timers.values()].filter((timer) => timer.delay === 4000).length,
    1,
    "a visible notification restarts duration without awaiting an unfinished entrance",
  );
  finish();
  await latest;
  await first;
  assert.equal(toast.announcing && toast.labelText, "Latest");
  assert.equal([...f.timers.values()].filter((timer) => timer.delay === 4000).length, 1);
  toast.isConnected = false;
  toast.disconnectedCallback();
  assert.equal(f.surface.opened, false);
  assert.equal(f.timers.size, 0);
  await toast.show();
  assert.equal(f.surface.opened, false, "detached notifications stay inert");
  toast.isConnected = true;
  toast.connectedCallback();
  f.surface.getAnimations = () => [];
  toast.timeoutMs = 0;
  toast.announceText = "Accessible message";
  await toast.show();
  assert.equal(toast.announcing, true);
  assert.equal(f.timers.size, 0);
});

test("toast bounds unfinished transitions and a reopened toast ignores old hide completion", async () => {
  const f = await fixture("ui/components/toast.ts"),
    toast = f.mount(new f.module.QapToast());
  await toast.show();
  let finish;
  f.surface.getAnimations = () => [
    {
      finished: new Promise((resolve) => {
        finish = resolve;
      }),
    },
  ];
  const hiding = toast.hide();
  await f.flush();
  f.surface.getAnimations = () => [];
  await toast.show();
  finish();
  await hiding;
  assert.equal(f.surface.opened, true);
  f.surface.getAnimations = () => [{ finished: new Promise(() => {}) }];
  const closed = [];
  toast.addEventListener("toast-closed", (event) => closed.push(event.detail.reason));
  const bounded = toast.hide("dismiss");
  await f.flush();
  await f.tick(5000);
  await bounded;
  assert.equal(f.surface.opened, false);
  assert.deepEqual(closed, ["dismiss"]);
  assert.equal(f.timers.size, 0);
});

test("menu bounds paused opening/closing, invalidates stale callbacks, and emits one hide", async () => {
  const f = await fixture("ui/components/menu.ts"),
    menu = f.mount(new f.module.QapMenu());
  menu.anchorElement = new f.Element();
  menu.position = () => {};
  const events = [];
  for (const type of ["wa-after-show", "wa-after-hide"])
    menu.addEventListener(type, (event) => events.push([type, event.bubbles, event.composed]));
  let finish;
  f.surface.getAnimations = () => [
    {
      finished: new Promise((resolve) => {
        finish = resolve;
      }),
    },
  ];
  menu.open = true;
  const opening = menu.syncOpen();
  await f.tick(5000);
  assert.deepEqual(events, [["wa-after-show", true, true]]);
  finish();
  await opening;
  menu.open = false;
  const hiding = menu.syncOpen();
  await f.flush();
  const oldFinish = finish;
  menu.open = true;
  oldFinish();
  await hiding;
  assert.equal(f.surface.opened, true, "reopen invalidates hide before the next Lit update");
  f.surface.getAnimations = () => [];
  await menu.syncOpen();
  f.surface.getAnimations = () => [
    {
      finished: new Promise((resolve) => {
        finish = resolve;
      }),
    },
  ];
  menu.open = false;
  const bounded = menu.syncOpen();
  await f.tick(5000);
  finish();
  await bounded;
  assert.equal(events.filter(([type]) => type === "wa-after-hide").length, 1);
  assert.equal(f.surface.opened, false);
  assert.equal(f.timers.size, 0);
  menu.disconnectedCallback();
  assert.equal(f.timers.size, 0);
});

test("radio selection preserves input/change contracts and silent programmatic updates", async () => {
  const f = await fixture("ui/components/radio.ts"),
    { QapRadioGroup, QapRadioOption } = f.module;
  const group = new QapRadioGroup();
  group.children = ["first", "disabled", "last"].map((value) => {
    const option = new QapRadioOption();
    option.value = value;
    option.parentElement = group;
    return option;
  });
  group.children[1].disabled = true;
  group.value = "first";
  group.updated();
  const events = [];
  for (const type of ["input", "change"])
    group.addEventListener(type, (event) =>
      events.push([type, group.value, event.target === group, event.bubbles, event.composed]),
    );
  const key = (name, option = group.children.find((option) => option.checked)) => {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, { key: name, composedPath: () => [option, group] });
    group.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(key("ArrowDown"), true);
  assert.equal(group.value, "last");
  assert.equal(group.children[2].tabIndex, 0);
  assert.equal(group.children[0].tabIndex, -1);
  key("ArrowRight");
  assert.equal(group.value, "first");
  key("ArrowUp");
  assert.equal(group.value, "last");
  const count = events.length;
  key(" ");
  assert.equal(events.length, count, "Space on the selected radio is silent");
  assert.equal(key("Tab"), false);
  group.value = "first";
  group.updated();
  assert.equal(events.length, count);
  assert.deepEqual(events[0], ["input", "last", true, true, true]);
  assert.deepEqual(events[1], ["change", "last", true, true, true]);
  group.select(group.children[1]);
  assert.equal(group.value, "first");
  group.disabled = true;
  group.updated();
  key("ArrowDown");
  assert.equal(group.value, "first");
  assert.ok(group.children.every((option) => option.tabIndex === -1 && option.forceDisabled));
  group.disabled = false;
  group.value = "missing";
  group.updated();
  assert.equal(group.children[0].tabIndex, 0, "unselected groups keep one Tab stop");
});

test("menu focus callbacks cannot dispatch a stale show or premature hide", async () => {
  const f = await fixture("ui/components/menu.ts"),
    menu = f.mount(new f.module.QapMenu());
  menu.anchorElement = new f.Element();
  menu.position = () => {};
  const item = new f.module.QapMenuItem();
  item.focus = () => {
    menu.open = false;
  };
  menu.children = [item];
  const events = [];
  for (const type of ["wa-after-show", "wa-after-hide"])
    menu.addEventListener(type, () => events.push(type));
  menu.open = true;
  await menu.syncOpen();
  assert.deepEqual(events, []);
  await menu.syncOpen();
  assert.deepEqual(events, ["wa-after-hide"]);
});
