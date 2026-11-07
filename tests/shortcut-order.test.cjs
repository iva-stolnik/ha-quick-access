const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { createModuleLoader } = require("./module-loader.cjs");
const load = () => createModuleLoader(vm.createContext({})).load("shortcuts/shortcut-order.js");
const item = (id, group = "a", hidden = false) => ({
  id,
  group,
  hidden,
  name: id,
  color: "red",
  filters: { preserved: true },
});
const ids = (links, group = "a") =>
  Array.from(
    links.filter((link) => link.group === group),
    (link) => link.id,
  );

test("shortcut section mutations work with interleaved category slots", async () => {
  const { upsertShortcut } = await load();
  const links = [
    item("a"),
    item("x", "b"),
    item("b"),
    item("d", "a", true),
    item("y", "b"),
    item("e", "a", true),
  ];
  const changed = (id, props) => ({ ...links.find((link) => link.id === id), ...props });
  assert.deepEqual(ids(upsertShortcut(links, changed("a", { hidden: true }))), [
    "b",
    "d",
    "e",
    "a",
  ]);
  assert.deepEqual(ids(upsertShortcut(links, changed("d", { hidden: false }))), [
    "a",
    "b",
    "d",
    "e",
  ]);
  for (const hidden of [false, true]) {
    const copy = { ...links[0], id: "copy", hidden };
    assert.deepEqual(
      ids(upsertShortcut(links, copy)),
      hidden ? ["a", "b", "d", "e", "copy"] : ["a", "b", "copy", "d", "e"],
    );
  }
  assert.deepEqual(ids(upsertShortcut(links, changed("x", { group: "a" }))), [
    "a",
    "b",
    "x",
    "d",
    "e",
  ]);
  const edited = upsertShortcut(links, changed("a", { name: "Renamed" }));
  assert.deepEqual(
    Array.from(edited, (link) => link.id),
    links.map((link) => link.id),
  );
  assert.deepEqual(ids(upsertShortcut(links, changed("a", { hidden: true })), "b"), ["x", "y"]);
  assert.equal(links[0].hidden, false);
});

test("enabled reorder preserves objects, other category slots and disabled order", async () => {
  const { reorderEnabledShortcuts } = await load();
  const links = [item("a"), item("x", "b"), item("b"), item("d", "a", true), item("y", "b")];
  const result = reorderEnabledShortcuts(links, "a", ["b", "a"]);
  assert.deepEqual(
    Array.from(result, (link) => link.id),
    ["b", "x", "a", "d", "y"],
  );
  for (const link of result)
    assert.equal(
      link,
      links.find((original) => original.id === link.id),
    );
  assert.equal(reorderEnabledShortcuts(links, "a", ["a", "b"]), links);
  for (const order of [["a"], ["a", "a"], ["a", "x"]])
    assert.throws(() => reorderEnabledShortcuts(links, "a", order));
});

test("bulk transfer appends both subsets and preserves source properties", async () => {
  const { transferCategoryShortcuts } = await load();
  const links = [
    item("a"),
    item("x", "b"),
    item("d", "a", true),
    item("z", "c"),
    item("y", "b", true),
    item("b"),
    item("e", "a", true),
  ];
  const result = transferCategoryShortcuts(links, "a", "b");
  assert.deepEqual(ids(result, "b"), ["x", "a", "b", "y", "d", "e"]);
  assert.deepEqual(ids(result, "c"), ["z"]);
  assert.deepEqual(ids(result), []);
  for (const original of links)
    assert.deepEqual(
      JSON.parse(JSON.stringify(result.find((link) => link.id === original.id))),
      original.group === "a" ? { ...original, group: "b" } : original,
    );
});
