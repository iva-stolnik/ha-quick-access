// Profile, group and shortcut form validation.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const {
  flush,
  clickAndFlush,
  savedProfile,
  openSettings,
  openShortcutsSettings,
  changeValidationControl,
  validationEnvironment,
  shortcutValidationEditor,
  delayNativeFocus,
  startProfiles,
  profileManager,
  activeProfileEditor,
  profileNameInput,
  chooseProfileCopy,
  profileIconControl,
  categoryInput,
  openCategoriesManager,
  categoryAction,
  createModuleLoader,
} = require("./harness.cjs");

test("profile, group, icon and shortcut rules enforce current input boundaries", async () => {
  const modules = createModuleLoader(
    vm.createContext({ URL, location: { origin: "https://ha.example" } }),
  );
  const { createLocalizer } = await modules.load("localize.js");
  const { createProfileValidation } = await modules.load("profiles/profile-validation.js");
  const { normalizeIcon } = await modules.load("utils/icons.js");
  const { profileNameError, categoryNameError, shortcutPathError } =
    createProfileValidation(createLocalizer());
  for (const name of ["", " ", "x".repeat(81)])
    assert.match(String(profileNameError(name)), /Enter a profile name/);
  for (const name of ["  Phone  ", "x".repeat(80)])
    assert.equal(String(profileNameError(name)), "");
  const categories = [{ id: "rooms", name: "Rooms" }];
  for (const name of ["", " ", "x".repeat(51), "Bad\nname", "Bad\u007fname"]) {
    assert.match(String(categoryNameError(name, categories)), /1–50 characters/);
  }
  assert.match(String(categoryNameError("  rOoMs  ", categories)), /already exists/);
  assert.equal(String(categoryNameError("Rooms", categories, "rooms")), "");
  assert.equal(String(categoryNameError("😀".repeat(50), categories)), "");
  assert.notEqual(String(categoryNameError("😀".repeat(51), categories)), "");
  for (const icon of [
    "",
    " ",
    "unknown",
    "javascript:alert(1)",
    "<svg>",
    "mdi:",
    "mdi:Bad",
    "mdi:bad--icon",
    "mdi:" + "x".repeat(60),
  ]) {
    assert.equal(normalizeIcon(icon, ""), "", icon);
  }
  assert.equal(normalizeIcon(" mdi:star-outline ", ""), "mdi:star-outline");
  for (const path of ["//example.com", "/\\example.com", "javascript:alert(1)"])
    assert.notEqual(String(shortcutPathError("internal", path)), "");
  assert.equal(String(shortcutPathError("internal", "/config/logs")), "");
  for (const type of ["quick-states", "quick-devices"])
    assert.equal(String(shortcutPathError(type, "")), "");
});

test("profile validation keeps invalid drafts and focuses the first unresolved field", async () => {
  const { env } = validationEnvironment("fallback");
  await startProfiles(env);
  (await profileManager(env)).querySelector(".qap-create-profile").click();
  const editor = activeProfileEditor(env);
  const name = profileNameInput(editor);
  const icon = profileIconControl(editor);
  changeValidationControl(name, " ");
  changeValidationControl(icon, "mdi:Bad");
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  const nameError = name.parentElement.querySelector(".qap-field-error");
  const iconError = icon.parentElement.querySelector(".qap-field-error");
  assert.match(nameError.textContent, /Enter a profile name/);
  assert.match(iconError.textContent, /Choose a valid profile icon/);
  assert.equal(env.document.activeElement, name);
  assert.equal(name.value, " ");
  assert.equal(icon.value, "mdi:Bad");
  changeValidationControl(name, "Unsaved profile");
  assert.equal(nameError.hidden, true);
  assert.equal(iconError.hidden, false);
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.equal(env.document.activeElement, icon);
  assert.equal(env.server.requests.length, 0);
});

test("required field validation: copy source errors are inline and clear when copying is disabled", async () => {
  const { env } = validationEnvironment("HA picker");
  await startProfiles(env);
  (await profileManager(env)).querySelector(".qap-create-profile").click();
  const editor = activeProfileEditor(env);
  await flush();
  changeValidationControl(profileNameInput(editor), "Draft");
  chooseProfileCopy(editor);
  const source = editor.querySelector("qap-select") || editor.querySelector("select, qap-select");
  source.value = "missing";
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  const error = source.parentElement.querySelector(".qap-field-error");
  assert.match(error.textContent, /available source profile/);
  assert.equal(source.getAttribute("aria-invalid"), "true");
  assert.equal(source.getAttribute("aria-describedby"), error.id);
  assert.equal(env.document.activeElement, source);
  changeValidationControl(editor.querySelector("qap-radio-group"), "default", "change");
  assert.equal(editor.querySelector(".qap-profile-source").hidden, true);
  assert.equal(error.hidden, true);
  assert.equal(source.getAttribute("aria-invalid"), null);
  assert.equal(source.getAttribute("aria-describedby"), null);
  assert.equal(profileNameInput(editor).value, "Draft");
});

test("group rename validation preserves its draft and separates server errors", async () => {
  const { env } = validationEnvironment("HA input");
  savedProfile(env).categories.push({ id: "rooms", name: "Rooms" });
  await openShortcutsSettings("/config", undefined, env);
  await clickAndFlush(
    categoryAction(
      env,
      openCategoriesManager(env)
        .querySelectorAll(".qap-category-row")
        .find((row) => row.dataset.id === "rooms"),
      "edit",
    ),
  );
  const form = env.document.body.querySelector(".qap-category-form");
  assert.equal(form.querySelector(".qap-category-submit").textContent, "Save");
  const name = categoryInput(form);
  changeValidationControl(name, "fAvOrItEs");
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  const error = name.parentElement.querySelector(".qap-field-error");
  assert.equal(error.hidden, false);
  assert.equal(name.getAttribute("aria-describedby"), error.id);
  assert.equal(env.document.activeElement, name);
  assert.equal(env.server.requests.length, 0);
  changeValidationControl(name, "  My room  ");
  assert.equal(error.hidden, true);
  env.server.failWrites = true;
  await clickAndFlush(form.querySelector(".qap-category-submit"));
  assert.match(form.querySelector(".qap-error").textContent, /Could not save/);
  assert.equal(name.value, "  My room  ");
  assert.equal(name.getAttribute("aria-invalid"), null);
  assert.equal(form.isConnected, true);
});

test("required field validation: URL rules validate, preserve descriptions and clear conditional errors", async () => {
  const { env } = validationEnvironment("HA picker");
  await openSettings("/config/logs", undefined, env);
  const paths = env.document.body.querySelector(".qap-textarea");
  const mode =
    env.document.body.querySelector("qap-select") ||
    env.document.body.querySelector("select, qap-select");
  const save = env.document.body.querySelector(".qap-save-settings");
  const pathError = env.document.body
    .querySelector(".qap-url-paths")
    .querySelector(".qap-field-error");
  changeValidationControl(mode, "include", "change");
  const writes = env.server.requests.length;
  await clickAndFlush(save);
  assert.equal(pathError.hidden, false);
  assert.equal(paths.getAttribute("aria-invalid"), "true");
  assert.equal(env.document.activeElement, paths);
  assert.equal(paths.getAttribute("aria-describedby"), `qap-url-paths-description ${pathError.id}`);
  assert.equal(env.server.requests.length, writes);
  assert.equal(paths.lastScrollOptions.block, "nearest");
  changeValidationControl(mode, "exclude", "change");
  assert.equal(pathError.hidden, true);
  assert.equal(paths.getAttribute("aria-invalid"), null);
  assert.equal(paths.getAttribute("aria-describedby"), "qap-url-paths-description");
  changeValidationControl(paths, "invalid");
  await clickAndFlush(save);
  assert.equal(pathError.textContent, "Every page path must start with /.");
  changeValidationControl(paths, "");
  assert.equal(pathError.hidden, true);
  changeValidationControl(mode, "include", "change");
  await clickAndFlush(save);
  assert.equal(pathError.hidden, false);
  env.document.body.querySelector(".qap-current-url-action").click();
  assert.equal(pathError.hidden, true);
  assert.equal(paths.getAttribute("aria-describedby"), "qap-url-paths-description");
  env.server.failWrites = true;
  await clickAndFlush(save);
  assert.match(
    env.document.body.querySelector(".qap-visibility").querySelector(".qap-error").textContent,
    /Could not save/,
  );
  assert.equal(paths.value, "/config/logs");
  assert.equal(paths.getAttribute("aria-invalid"), null);
});

test("required field validation: profile errors survive delayed native control replacement", async () => {
  const { env, components } = validationEnvironment("HA picker", true);
  await startProfiles(env);
  (await profileManager(env)).querySelector(".qap-create-profile").click();
  const editor = activeProfileEditor(env);
  const name = profileNameInput(editor);
  changeValidationControl(name, " ");
  changeValidationControl(profileIconControl(editor), "invalid");
  editor.querySelector(".qap-profile-submit").click();
  const nameError = name.parentElement.querySelector(".qap-field-error");
  const iconError = profileIconControl(editor).parentElement.querySelector(".qap-field-error");
  env.document.activeElement = null;
  components.register();
  await flush();
  const nativeName = profileNameInput(editor);
  const picker = profileIconControl(editor);
  assert.equal(nativeName.localName, "qap-input");
  assert.equal(picker.localName, "qap-icon-picker");
  assert.equal(nativeName.value, " ");
  assert.equal(picker.value, "invalid");
  assert.equal(nativeName.getAttribute("aria-invalid"), "true");
  assert.equal(nativeName.getAttribute("aria-describedby"), nameError.id);
  assert.equal(picker.getAttribute("aria-invalid"), "true");
  assert.equal(picker.getAttribute("aria-describedby"), iconError.id);
  changeValidationControl(nativeName, "Draft");
  assert.equal(nameError.hidden, true);
  assert.equal(iconError.hidden, false);
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.equal(env.document.activeElement, picker);
});

test("required field validation: dismissed native profile forms cannot claim pending validation focus", async () => {
  const { env } = validationEnvironment("HA picker");
  await startProfiles(env);
  const manager = await profileManager(env);
  const pending = delayNativeFocus(env, "qap-input");
  manager.querySelector(".qap-create-profile").click();
  const editor = activeProfileEditor(env);
  const name = profileNameInput(editor);
  editor.querySelector(".qap-profile-submit").click();
  assert.equal(name.getAttribute("aria-invalid"), "true");
  editor.querySelector(".qap-profile-cancel").click();
  assert.equal(
    editor.isConnected,
    false,
    "the controller double closes synchronously; animation is exercised in Chromium",
  );
  pending.get(name).render();
  await flush();
  assert.equal(pending.get(name).focusCalls, 0);
});

test("shortcut editor validation: all errors appear and corrections preserve other errors and descriptions", async () => {
  const { env, editor, fields, change, errorFor, save } =
    await shortcutValidationEditor("fallback");
  const { name, icon, route, type } = fields();
  const description = env.document.createElement("small");
  description.id = "shortcut-name-help";
  editor.append(description);
  name.setAttribute("aria-describedby", description.id);
  change(name, " ");
  change(icon, "invalid");
  change(route, "invalid path");
  const writes = env.server.requests.length;
  await clickAndFlush(save);
  const errors = [name, icon, route].map(errorFor);
  assert.equal(new Set(errors.map((error) => error.id)).size, 3);
  assert.ok(errors.every((error) => !error.hidden));
  for (const [index, field] of [name, icon, route].entries()) {
    assert.equal(field.getAttribute("aria-invalid"), "true");
    assert.equal(errors[index].getAttribute("aria-live"), "polite");
    assert.ok(field.getAttribute("aria-describedby").split(/\s+/).includes(errors[index].id));
  }
  assert.equal(env.document.activeElement, name);
  assert.equal(name.getAttribute("aria-describedby"), `${description.id} ${errors[0].id}`);
  change(name, "  Unsaved name  ");
  assert.equal(errors[0].hidden, true);
  assert.equal(name.getAttribute("aria-invalid"), null);
  assert.equal(name.getAttribute("aria-describedby"), description.id);
  assert.equal(errors[1].hidden, false);
  assert.equal(errors[2].hidden, false);
  await clickAndFlush(save);
  assert.equal(env.document.activeElement, icon, "focus follows visual order after Name is valid");
  change(type, "external", "change");
  assert.equal(errors[2].textContent, "Enter a full http:// or https:// URL.");
  change(type, "quick-states", "change");
  assert.equal(route.parentElement.hidden, true);
  assert.equal(errors[2].hidden, true);
  assert.equal(route.getAttribute("aria-invalid"), null);
  assert.equal(route.getAttribute("aria-describedby"), null);
  assert.equal(errors[1].hidden, false);
  assert.equal(route.value, "invalid path", "hiding URL must preserve its draft");
  assert.equal(name.value, "  Unsaved name  ");
  assert.equal(env.server.requests.length, writes);
  change(icon, "mdi:star");
  assert.equal(errors[1].hidden, true);
  assert.equal(icon.getAttribute("aria-invalid"), null);
  assert.equal(icon.getAttribute("aria-describedby"), null);
  await clickAndFlush(save);
  assert.equal(env.document.body.querySelector(".qap-shortcut-form"), null);
  const saved = env.server.data("test-user").profiles[0].settings.links.at(-1);
  assert.equal(saved.name, "Unsaved name");
  assert.equal(saved.type, "quick-states");
  assert.equal(saved.path, "", "Entity Explorer saves without validating the unused URL");
});

test("shortcut editor validation: errors and descriptions follow delayed HA inputs and icon picker upgrades", async () => {
  const { env, components, editor, fields, change, errorFor, save } =
    await shortcutValidationEditor("HA picker", true);
  const fallback = fields();
  const description = env.document.createElement("small");
  description.id = "shortcut-icon-help";
  editor.append(description);
  fallback.icon.setAttribute("aria-describedby", description.id);
  change(fallback.name, " ");
  change(fallback.icon, "mdi:Bad");
  change(fallback.route, "invalid");
  await clickAndFlush(save);
  const errors = [fallback.name, fallback.icon, fallback.route].map(errorFor);
  env.document.activeElement = null;
  components.register("qap-input", "qap-select");
  await flush();
  const inputs = fields();
  for (const [index, key] of ["name", "icon", "route"].entries()) {
    assert.equal(inputs[key].localName, key === "icon" ? "qap-icon-picker" : "qap-input");
    assert.equal(inputs[key].value, fallback[key].value);
    assert.equal(errorFor(inputs[key]), errors[index]);
    assert.equal(inputs[key].getAttribute("aria-invalid"), "true");
    assert.ok(inputs[key].getAttribute("aria-describedby").split(" ").includes(errors[index].id));
  }
  assert.equal(inputs.icon.getAttribute("aria-describedby"), `${description.id} ${errors[1].id}`);
  change(inputs.name, "Draft");
  const picker = fields().icon;
  await clickAndFlush(save);
  assert.equal(env.document.activeElement, picker);
  assert.equal(picker, inputs.icon, "HA registration preserves the owned control");

  env.document.activeElement = null;
  let finishRender;
  picker.updateComplete = new Promise((resolve) => {
    finishRender = resolve;
  });
  save.click();
  assert.equal(env.document.activeElement, null, "focus waits for the native control to render");
  finishRender();
  await flush();
  assert.equal(env.document.activeElement, picker);
  assert.equal(picker.lastScrollOptions.block, "nearest");
  change(picker, "mdi:star");
  assert.equal(errors[1].hidden, true);
  assert.equal(picker.getAttribute("aria-invalid"), null);
  assert.equal(picker.getAttribute("aria-describedby"), description.id);
  assert.equal(errors[2].hidden, false);
  editor.querySelector(".qap-current-url-action").click();
  assert.equal(errors[2].hidden, true);
  assert.equal(inputs.route.getAttribute("aria-invalid"), null);
  assert.equal(inputs.route.value, "/config/logs");
});
