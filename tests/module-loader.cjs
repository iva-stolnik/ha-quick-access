// Execute the source ES module graph in each test's isolated realm.
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { stripTypeScriptTypes } = require("node:module");

const frontend = path.resolve(__dirname, "../frontend/src");
const { version } = JSON.parse(
  readFileSync(path.join(__dirname, "../custom_components/quick_access/manifest.json"), "utf8"),
);
if (typeof version !== "string" || !version)
  throw new Error("manifest.json must declare a version");

function frontendFiles(directory = frontend, root = directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory()
      ? frontendFiles(filename, root)
      : [path.relative(root, filename).split(path.sep).join("/")];
  });
}

// Sources do not change during a test run; each realm still compiles its own modules.
const sources = new Map();
function moduleSource(filename) {
  if (!sources.has(filename)) {
    const source = readFileSync(filename, "utf8");
    sources.set(filename, filename.endsWith(".ts") ? stripTypeScriptTypes(source) : source);
  }
  return sources.get(filename);
}

function createModuleLoader(context, { onDynamicImport } = {}) {
  if (!vm.SourceTextModule)
    throw new Error("Run Node with --experimental-vm-modules to test native ES modules.");
  context.__QUICK_ACCESS_VERSION__ ??= version;
  const modules = new Map();
  const pending = new Map();
  const base = pathToFileURL(`${frontend}${path.sep}`);
  // Controller tests intentionally use a small DOM double, like their HA
  // component doubles. Real Lit rendering and browser semantics run in Chromium.
  const lit = new vm.SourceTextModule(
    `
    export class LitElement extends (globalThis.HTMLElement ?? class {}) {}
    export const html = () => null, css = () => null, nothing = Symbol();
  `,
    { context },
  );
  const yamlExports = require("js-yaml");
  const yaml = new vm.SyntheticModule(
    Object.keys(yamlExports),
    function () {
      for (const [name, value] of Object.entries(yamlExports)) this.setExport(name, value);
    },
    { context },
  );
  function moduleAt(url) {
    let filename = fileURLToPath(url);
    if (!path.extname(filename)) {
      filename += ".ts";
      url = pathToFileURL(filename);
    }
    if (!filename.startsWith(`${frontend}${path.sep}`))
      throw new Error(`Module outside frontend: ${url}`);
    if (!modules.has(url.href)) {
      modules.set(
        url.href,
        new vm.SourceTextModule(moduleSource(filename), {
          context,
          identifier: url.href,
          initializeImportMeta: (meta) => {
            meta.url = url.href;
          },
          importModuleDynamically: async (specifier, parent) => {
            await onDynamicImport?.(specifier);
            return load(new URL(specifier, parent.identifier).href);
          },
        }),
      );
    }
    return modules.get(url.href);
  }
  async function load(file) {
    const url = new URL(file, base);
    if (!pending.has(url.href))
      pending.set(
        url.href,
        (async () => {
          const module = moduleAt(url);
          if (module.status === "unlinked")
            await module.link((specifier, parent) =>
              specifier === "lit"
                ? lit
                : specifier === "js-yaml"
                  ? yaml
                  : moduleAt(new URL(specifier, parent.identifier)),
            );
          if (module.status !== "evaluated") await module.evaluate();
          return module.namespace;
        })(),
      );
    return pending.get(url.href);
  }
  return { load };
}

module.exports = { assetVersion: version, createModuleLoader, frontend, frontendFiles };
