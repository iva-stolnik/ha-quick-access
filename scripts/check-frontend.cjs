// Check every shipped ES module, including generated shared chunks.
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { frontendFiles } = require("../tests/module-loader.cjs");
const frontend = path.resolve(__dirname, "../custom_components/quick_access/frontend");

for (const file of frontendFiles(frontend).filter((file) => file.endsWith(".js"))) {
  try {
    new vm.SourceTextModule(readFileSync(path.join(frontend, file), "utf8"), { identifier: file });
  } catch (error) {
    console.error(`${file}: ${error.stack}`);
    process.exitCode = 1;
  }
}
