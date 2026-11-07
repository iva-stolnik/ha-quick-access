const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { load, YAML11_SCHEMA } = require("js-yaml");
const { createModuleLoader } = require("./module-loader.cjs");

test("attributes retain HA YAML formatting, empty display, scalar types and shared structures", async () => {
  const { serializeAttributes } = await createModuleLoader(vm.createContext({})).load(
    "utils/attributes.ts",
  );
  const shared = { nested: [null, false, 3, "", {}, []] };
  const value = {
    text: "line 1\nline 2\n",
    quoted: "on",
    number: "12",
    empty: "",
    one: shared,
    two: shared,
  };
  const text = serializeAttributes(value);
  assert.match(text, /^text: \|\n  line 1\n  line 2\nquoted: 'on'\nnumber: '12'\nempty: ''\n/);
  assert.doesNotMatch(text, /[&*]ref/);
  assert.deepEqual(load(text, { schema: YAML11_SCHEMA }), value);
  for (const empty of [{}, []]) assert.equal(serializeAttributes(empty), "");
  assert.equal(serializeAttributes(null), "null\n");
  const large = Object.fromEntries(
    Array.from({ length: 5000 }, (_, index) => [`attribute_${index}`, { list: [index, "value"] }]),
  );
  assert.deepEqual(load(serializeAttributes(large), { schema: YAML11_SCHEMA }), large);
});

test("viewer preserves every YAML byte while highlighting safely and emits only copy requests", async () => {
  class HTMLElement extends EventTarget {}
  class CustomEvent extends Event {
    constructor(name, options) {
      super(name, options);
      this.detail = options.detail;
    }
  }
  const modules = createModuleLoader(vm.createContext({ HTMLElement, Event, CustomEvent }));
  const { QapAttributesViewer } = await modules.load("ui/components/attributes-viewer.ts");
  const { serializeAttributes } = await modules.load("utils/attributes.ts");
  const viewer = new QapAttributesViewer();
  const events = [];
  viewer.addEventListener("copy-request", (event) =>
    events.push([event.detail.value, event.bubbles, event.composed]),
  );
  for (const value of [
    {},
    {
      nested: [
        null,
        false,
        12,
        "123abc",
        "<img src=x onerror=alert(1)>",
        "a\nb\n",
        "",
        { "a: b": "'quoted'" },
      ],
    },
  ]) {
    viewer.value = serializeAttributes(value);
    viewer.willUpdate(new Map([["value", ""]]));
    assert.equal(Array.from(viewer.parts, (part) => part.text).join(""), viewer.value);
    assert.equal(events.length, 0, "updates never write to clipboard or emit form changes");
  }
  assert.equal(viewer.parts.find((part) => part.text === "123abc").kind, "string");
  viewer.requestCopy();
  assert.deepEqual(events, [[viewer.value, true, true]]);
  viewer.value = "not: [valid";
  viewer.willUpdate(new Map([["value", ""]]));
  assert.equal(
    Array.from(viewer.parts, (part) => part.text).join(""),
    viewer.value,
    "highlight failure keeps all text visible",
  );
});

test("large YAML skips highlighting and returns to highlighting when it shrinks", async () => {
  const { QapAttributesViewer } = await createModuleLoader(vm.createContext({})).load(
    "ui/components/attributes-viewer.ts",
  );
  const viewer = new QapAttributesViewer();
  viewer.value = `unsafe: <img src=x onerror=alert(1)>\nlong: ${"x".repeat(100_000)}`;
  viewer.willUpdate(new Map([["value", ""]]));
  assert.equal(viewer.parts.length, 0, "large documents create no highlighted parts");
  assert.equal(viewer.lineNumbers, "1\n2");
  viewer.value = "key: value\n";
  viewer.willUpdate(new Map([["value", ""]]));
  assert.equal(Array.from(viewer.parts, (part) => part.text).join(""), viewer.value);
  assert.ok(viewer.parts.some((part) => part.kind === "key"));
});
