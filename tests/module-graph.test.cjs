const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const {
  assetVersion,
  createModuleLoader,
  frontend,
  frontendFiles,
} = require("./module-loader.cjs");

test("states-source cleanup survives failed unsubscribe and ignores late snapshots", async () => {
  let request,
    releases = 0,
    snapshots = 0,
    polls = 0;
  const timers = new Set();
  const modules = createModuleLoader(
    vm.createContext({
      Event,
      setInterval: (callback) => {
        timers.add(callback);
        return callback;
      },
      clearInterval: (callback) => timers.delete(callback),
    }),
  );
  const { createEntityStatesSource } = await modules.load("data/entity-states-source.js");
  const source = createEntityStatesSource({
    getHaRoot: () => ({
      dispatchEvent: (event) => {
        request = event;
      },
    }),
    contextTarget: {},
    onStates: () => {
      snapshots++;
    },
    poll: () => {
      polls++;
    },
    pollInterval: 3500,
  });
  source.start();
  assert.equal(timers.size, 1);
  request.callback({}, () => {
    releases++;
    throw Error("provider removed");
  });
  assert.equal(timers.size, 0);
  assert.doesNotThrow(
    () => source.dispose(),
    "provider failure must not interrupt list observer/listener cleanup",
  );
  source.dispose();
  assert.equal(releases, 1, "disposal releases only once");
  assert.doesNotThrow(() =>
    request.callback({}, () => {
      releases++;
      throw Error("late provider removed");
    }),
  );
  request.callback({}, () => {
    releases++;
    return Promise.reject(Error("async provider removed"));
  });
  await new Promise((resolve) => setImmediate(resolve));
  source.start();
  assert.equal(releases, 3);
  assert.equal(snapshots, 1);
  assert.equal(timers.size, 0);
  assert.equal(polls, 0);
});

test("all native module imports resolve without versions and form an acyclic graph", () => {
  const files = frontendFiles().filter(
    (file) => /\.(js|ts)$/.test(file) && !file.endsWith(".d.ts"),
  );
  const base = pathToFileURL(`${frontend}${path.sep}`);
  const assets = new Set(files.map((file) => new URL(file, base).pathname));
  const edges = new Map();
  for (const file of files) {
    const url = new URL(file, base);
    const source = readFileSync(path.join(frontend, file), "utf8");
    const module = new vm.SourceTextModule(
      file.endsWith(".ts") ? stripTypeScriptTypes(source) : source,
    );
    const dynamicImports = [...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map(
      (match) => match[1],
    );
    edges.set(
      url.pathname,
      [...module.dependencySpecifiers, ...dynamicImports]
        .filter((specifier) => {
          if (specifier === "js-yaml") {
            assert.ok(
              ["utils/attributes.ts", "ui/components/attributes-viewer.ts"].includes(file),
              "YAML stays in attribute formatting and presentation",
            );
            return false;
          }
          if (specifier !== "lit") return true;
          assert.ok(file.startsWith("ui/components/"), "Only the presentation layer imports Lit");
          return false;
        })
        .map((specifier) => {
          assert.ok(
            specifier.startsWith("./") || specifier.startsWith("../"),
            `${file}: relative browser import`,
          );
          const dependency = new URL(specifier, url);
          if (!path.extname(dependency.pathname)) dependency.pathname += ".ts";
          assert.equal(dependency.search, "", `${file}: unversioned import ${specifier}`);
          assert.ok(assets.has(dependency.pathname), `${file}: shipped dependency ${specifier}`);
          return dependency.pathname;
        }),
    );
  }
  const visited = new Set();
  function visit(file, ancestors = new Set()) {
    assert.ok(!ancestors.has(file), `Circular dependency: ${file}`);
    if (visited.has(file)) return;
    for (const dependency of edges.get(file)) visit(dependency, new Set([...ancestors, file]));
    visited.add(file);
  }
  for (const file of edges.keys()) visit(file);
});

test("runtime assets use the injected asset version and paths on the current origin", async () => {
  for (const version of [assetVersion, `${assetVersion}-next-release`]) {
    const modules = createModuleLoader(vm.createContext({ __QUICK_ACCESS_VERSION__: version }));
    const { assetUrl, VERSION } = await modules.load("utils/assets.js");
    assert.equal(VERSION, version);
    for (const file of ["quick_access.css", "quick_access_config.css", "locales/hr.json"]) {
      assert.equal(assetUrl(file), `/quick_access/${file}?v=${version}`);
    }
  }
});

test("feature modules import without browser globals or initialization side effects", async () => {
  const modules = createModuleLoader(vm.createContext({}));
  for (const file of frontendFiles().filter(
    (file) => file.endsWith(".js") && !["quick_access.js", "quick_access_config.js"].includes(file),
  )) {
    await modules.load(file);
  }
});

test("dialog creation and guarded dismissal never consult HA component registration", async () => {
  class Dialog extends EventTarget {
    constructor(tag, className) {
      super();
      this.localName = tag;
      this.className = className;
      this.attributes = {};
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
      this.dispatchEvent(new Event("closed"));
    }
    remove() {
      this.removed = true;
    }
  }
  const released = [];
  const body = {
    append(element) {
      element.mounted = true;
    },
  };
  const modules = createModuleLoader(vm.createContext({ Event, document: { body } }));
  const { createDialogs } = await modules.load("ui/dialogs.js");
  const surfaces = createDialogs({
    l10n: {
      attribute: (element, name, value) => element.setAttribute(name, value),
      release: (element) => released.push(element),
    },
    ui: { node: (tag, className) => new Dialog(tag, className) },
  });
  const parent = surfaces.createDialogElement("Draft");
  const confirmation = surfaces.createDialogElement("Discard changes?", true);
  assert.equal(parent.localName, "qap-dialog");
  assert.equal(parent.adaptive, true);
  assert.equal(parent.attributes["aria-label"], "Draft");
  assert.equal(confirmation.localName, "qap-dialog");
  assert.equal(confirmation.adaptive, false);
  let requests = 0;
  surfaces.showDialogElement(parent, () => {
    requests++;
    return false;
  });
  const cancel = new Event("cancel", { cancelable: true });
  parent.dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented, true);
  assert.equal(requests, 1);
  assert.equal(parent.open, true, "a rejected dismissal retains the mounted surface");
  surfaces.cleanupDialogElement(parent);
  assert.equal(parent.open, false);
  assert.equal(parent.removed, true);
  assert.equal(requests, 1, "programmatic cleanup does not request dismissal again");
  assert.deepEqual(released, [parent]);
  // Unload also removes dialogs whose closing animation has not finished.
  surfaces.showDialogElement(confirmation, () => {});
  confirmation.close = () => {
    confirmation.open = false;
  };
  surfaces.cleanupDialogElement(confirmation);
  assert.equal(confirmation.removed, undefined);
  surfaces.dispose();
  assert.equal(confirmation.removed, true);
});

test("presentation source has no HA dialog component dependencies", () => {
  for (const file of frontendFiles().filter((file) => /\.(?:js|ts)$/.test(file))) {
    assert.doesNotMatch(
      readFileSync(path.join(frontend, file), "utf8"),
      /["'`]ha-(?:adaptive-dialog|dialog(?:-header|-footer)?)["'`]/,
      file,
    );
  }
});

test("simple presentation controls have no migrated HA component dependencies", () => {
  for (const file of frontendFiles().filter((file) => /\.(?:js|ts)$/.test(file))) {
    assert.doesNotMatch(
      readFileSync(path.join(frontend, file), "utf8"),
      /["'`]ha-(?:input-search|filter-chip|assist-chip|tooltip|dropdown(?:-item)?|list-base|list-item-button|toast|radio-group|radio-option|card)["'`]/,
      file,
    );
  }
});

test("entity and select selection have no internal HA picker or loader dependencies", () => {
  for (const file of frontendFiles().filter((file) => /\.(?:js|ts)$/.test(file))) {
    assert.doesNotMatch(
      readFileSync(path.join(frontend, file), "utf8"),
      /ha-(?:selector-(?:entity|select)|entit(?:y|ies)-picker|combo-box)/,
      file,
    );
  }
  const controls = readFileSync(path.join(frontend, "ui/controls.js"), "utf8");
  assert.doesNotMatch(controls, /selector:\s*\{ entity:/);
  assert.doesNotMatch(controls, /selector:\s*\{ select:/);
});

test("attributes use an independent viewer without an HA editor or object-selector loader", () => {
  for (const file of frontendFiles().filter((file) => /\.(?:js|ts)$/.test(file))) {
    assert.doesNotMatch(
      readFileSync(path.join(frontend, file), "utf8"),
      /ha-(?:yaml-editor|code-editor)/,
      file,
    );
  }
  assert.doesNotMatch(
    readFileSync(path.join(frontend, "ui/controls.js"), "utf8"),
    /selector:\s*\{ object:/,
  );
});
