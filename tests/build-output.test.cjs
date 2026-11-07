const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { frontendFiles } = require("./module-loader.cjs");

const root = path.resolve(__dirname, "..");
const installed = path.join(root, "custom_components/quick_access/frontend");
const publicDirectory = path.join(root, "frontend/public");
const entries = ["quick_access.js", "quick_access_config.js"];
// ha-form is a temporary loader solely for HA's intentional icon-picker exception.
const retainedHaElements = new Set(["ha-icon", "ha-icon-picker", "ha-form"]);
let directory, output;

test.before(async () => {
  directory = mkdtempSync(path.join(tmpdir(), "quick-access-build-"));
  const { build } = await import("vite");
  ({ output } = await build({
    configFile: path.join(root, "vite.config.mts"),
    logLevel: "error",
    build: { outDir: directory },
  }));
});

test.after(() => {
  if (!directory) return;
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith("quick-access-build-"));
  rmSync(directory, { recursive: true, force: true });
});

test("installable frontend matches a clean production build, without stale files", () => {
  const files = frontendFiles(directory).sort();
  assert.deepEqual(
    frontendFiles(installed).sort(),
    files,
    "Run npm run build and include the complete frontend output",
  );
  for (const file of files) {
    assert.deepEqual(
      readFileSync(path.join(installed, file)),
      readFileSync(path.join(directory, file)),
      file,
    );
  }
});

test("entry names are stable and all module dependencies are bundled locally", () => {
  assert.deepEqual(
    output
      .filter((item) => item.type === "chunk" && item.isEntry)
      .map((item) => item.fileName)
      .sort(),
    entries,
  );
  const chunks = new Map(
    output.filter((item) => item.type === "chunk").map((item) => [item.fileName, item]),
  );
  for (const [file, chunk] of chunks) {
    for (const match of chunk.code.matchAll(
      /<((?:ha|hui|mwc)-[\w-]+)\b|["'`]((?:ha|hui|mwc)-[\w-]+)(?=["'`,\s])/g,
    )) {
      const tag = match[1] || match[2];
      assert.ok(retainedHaElements.has(tag), `${file}: unaudited HA component ${tag}`);
    }
    assert.ok(
      !chunk.code.includes("__QUICK_ACCESS_VERSION__"),
      `${file}: build constants replaced`,
    );
    assert.ok(!chunk.code.includes("import.meta.env"), `${file}: no Vite runtime environment`);
    assert.doesNotMatch(
      chunk.code,
      /["'`]state-badge["'`]/,
      `${file}: entity icons render independently`,
    );
    assert.doesNotMatch(
      chunk.code,
      /["'`]ha-(?:adaptive-dialog|dialog(?:-header|-footer)?)["'`]/,
      `${file}: owned dialog components only`,
    );
    assert.doesNotMatch(
      chunk.code,
      /["'`]ha-(?:toast|radio-group|radio-option|card|selector-entity|entit(?:y|ies)-picker|combo-box|yaml-editor|code-editor|sortable|button|icon-button)["'`]/,
      `${file}: migrated HA components are replaced locally`,
    );
    for (const dependency of [...chunk.imports, ...chunk.dynamicImports]) {
      assert.ok(chunks.has(dependency), `${file}: bundled dependency ${dependency}`);
      assert.ok(!entries.includes(dependency), `${file}: independent entry points`);
    }
    const module = new vm.SourceTextModule(chunk.code, { identifier: file });
    for (const specifier of module.dependencySpecifiers) {
      assert.ok(
        specifier.startsWith("./") || specifier.startsWith("../"),
        `${file}: local browser import`,
      );
      assert.ok(
        chunks.has(path.posix.join(path.posix.dirname(file), specifier)),
        `${file}: shipped import ${specifier}`,
      );
    }
    if (!entries.includes(file))
      assert.match(file, /^chunks\/[^/]+-[\w-]+\.js$/, "shared chunks use content hashes");
  }
});

test("stylesheets and lazy locale assets retain their paths and bytes", () => {
  for (const file of frontendFiles(publicDirectory)) {
    assert.deepEqual(
      readFileSync(path.join(directory, file)),
      readFileSync(path.join(publicDirectory, file)),
      file,
    );
  }
});

test("YAML presentation and serialization are loaded only through dynamic imports", () => {
  const chunks = new Map(
    output.filter((item) => item.type === "chunk").map((item) => [item.fileName, item]),
  );
  const eager = new Set();
  function visit(file) {
    if (eager.has(file)) return;
    eager.add(file);
    chunks.get(file).imports.forEach(visit);
  }
  entries.forEach(visit);
  const yamlModules = [];
  for (const [file, chunk] of chunks) {
    for (const module of Object.keys(chunk.modules)) {
      if (
        /(?:attributes-viewer\.ts|utils[/\\]attributes\.ts|node_modules[/\\]js-yaml[/\\])/.test(
          module,
        )
      ) {
        assert.ok(!eager.has(file), `${module} stays outside both entry points' static graphs`);
        yamlModules.push(module);
      }
    }
  }
  assert.ok(yamlModules.some((module) => module.includes("attributes-viewer.ts")));
  assert.ok(yamlModules.some((module) => module.includes("js-yaml")));
  assert.equal(
    new Set(yamlModules).size,
    yamlModules.length,
    "YAML modules are not duplicated across chunks",
  );
});

test("icons use HA's catalog without shipping a second MDI implementation", () => {
  for (const chunk of output.filter((item) => item.type === "chunk")) {
    assert.ok(
      !Object.keys(chunk.modules).some((file) => /node_modules[/\\]@mdi[/\\]/.test(file)),
      chunk.fileName,
    );
  }
  assert.ok(!frontendFiles(directory).some((file) => /(?:^|\/)mdi(?:[-/.]|$)/i.test(file)));
});
