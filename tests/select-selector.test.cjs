const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { createModuleLoader } = require("./module-loader.cjs");

async function fixture() {
  class HTMLElement extends EventTarget {
    updateComplete = Promise.resolve();
  }
  class CustomEvent extends Event {
    constructor(name, options) {
      super(name, options);
      this.detail = options.detail;
    }
  }
  const { QapSelectSelector } = await createModuleLoader(
    vm.createContext({ HTMLElement, Event, CustomEvent }),
  ).load("ui/components/select-selector.ts");
  const control = new QapSelectSelector();
  const events = [];
  for (const type of ["value-changed", "input", "change"])
    control.addEventListener(type, (event) =>
      events.push([event.type, event.detail?.value, event.bubbles, event.composed]),
    );
  return { control, events, CustomEvent };
}

test("select selector commits labeled options once with composed value/input/change contracts", async () => {
  const { control, events } = await fixture();
  control.selector = {
    select: {
      options: [
        "one",
        { value: "two", label: "Second" },
        { value: "off", label: "Disabled", disabled: true },
      ],
    },
  };
  control.commit("two");
  control.commit("two");
  control.commit("off");
  control.commit("unknown");
  assert.deepEqual(events, [
    ["value-changed", "two", true, true],
    ["input", undefined, true, true],
    ["change", undefined, true, true],
  ]);
  assert.equal(control.value, "two");
  assert.deepEqual(
    Array.from(control.searchOptions("second"), (option) => option.value),
    ["two"],
  );
  control.composing = true;
  control.commit("one");
  assert.equal(control.value, "two");
  control.composing = false;
  control.disabled = true;
  control.commit("one");
  assert.equal(control.value, "two");
  control.disabled = false;
  control.commit(undefined);
  assert.equal(control.value, undefined);
});

test("dynamic select options preserve values and custom input cannot bypass disabled options", async () => {
  const { control, events } = await fixture();
  control.selector = { select: { options: ["before"], custom_value: true } };
  control.value = "before";
  control.selector = {
    select: {
      options: [
        { value: "after", label: "New label" },
        { value: "blocked", label: "Blocked", disabled: true },
      ],
      custom_value: true,
    },
  };
  assert.equal(control.value, "before");
  assert.equal(events.length, 0);
  assert.equal(control.accepts("blocked"), false);
  control.commit("ACME, Inc.");
  assert.equal(control.value, "ACME, Inc.");
  control.required = true;
  assert.equal(control.checkValidity(), true);
  control.value = "";
  assert.equal(control.checkValidity(), false);
});

test("multiple selects preserve order and missing values, reject duplicates and reset rejected additions", async () => {
  const { control, events } = await fixture();
  control.selector = { select: { options: ["one", "two"], multiple: true } };
  control.value = ["deleted", "one"];
  const child = { value: "two" };
  const add = (value) =>
    control.addValue({ detail: { value }, currentTarget: child, stopPropagation() {} });
  add("two");
  add("one");
  add("invalid");
  assert.deepEqual(Array.from(control.value), ["deleted", "one", "two"]);
  assert.equal(events.length, 3);
  assert.equal(child.value, "");
  control.removeValue("one");
  assert.deepEqual(Array.from(control.value), ["deleted", "two"]);
  control.disabled = true;
  control.removeValue("deleted");
  assert.equal(control.value.length, 2);
  control.disabled = false;
  const accepted = control.value;
  control.addEventListener("value-changed", () => {
    control.value = accepted;
  });
  add("one");
  assert.equal(control.value, accepted);
  assert.equal(child.value, "");
});
