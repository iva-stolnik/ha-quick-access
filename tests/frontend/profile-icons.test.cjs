// Profile icons and icon colors.
// Shared DOM/HA doubles live in ./harness.cjs.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  flush,
  clickAndFlush,
  clone,
  ProfileServer,
  environment,
  nativeComponents,
  iconColorInput,
  respondToDiscard,
  openSettingsScreen,
  startProfiles,
  profileManager,
  useProfile,
  activeProfileEditor,
  profileNameInput,
  manageProfile,
  chooseProfileCopy,
  profileIconControl,
  setProfileIcon,
} = require("./harness.cjs");

test("profile icon color reuses shortcut controls, persists, syncs and resets", async () => {
  const server = new ProfileServer();
  const env = environment(undefined, server);
  nativeComponents(env);
  await startProfiles(env);
  const editor = await manageProfile(env, "test-profile", "edit");
  assert.equal(profileIconControl(editor).localName, "qap-icon-picker");
  const color = iconColorInput(editor);
  assert.equal(color.localName, "qap-input");
  assert.equal(color.type, "color");
  color.value = "#8e24aa";
  color.dispatchEvent(new Event("input"));
  setProfileIcon(editor, "mdi:cat");
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.equal(server.data("test-user").profiles[0].color, "#8e24aa");
  assert.equal(
    env.document.body.querySelector(".qap-current-profile").querySelector("qap-icon").style.color,
    "#8e24aa",
  );
  openSettingsScreen(env, "settings");
  await flush();
  assert.equal(
    env.document.body.querySelector(".qap-settings-profiles").querySelector("qap-icon").style.color,
    "#8e24aa",
  );

  const remote = await startProfiles(
    environment("https://ha.example.org", server, { fresh: true }),
  );
  await useProfile(remote, "test-profile");
  assert.equal(
    (await profileManager(remote)).querySelector(".qap-current-profile").querySelector("qap-icon")
      .style.color,
    "#8e24aa",
  );
  const reopened = await manageProfile(env, "test-profile", "edit");
  assert.equal(iconColorInput(reopened).value, "#8e24aa");
  reopened.querySelector(".qap-icon-color-reset").click();
  assert.equal(reopened.querySelector(".qap-icon-color-reset").disabled, true);
  await clickAndFlush(reopened.querySelector(".qap-profile-submit"));
  assert.equal(server.data("test-user").profiles[0].color, "");
  assert.equal(
    remote.document.body.querySelector(".qap-current-profile").querySelector("qap-icon").style
      .color ?? "",
    "",
  );
  env.enable(false);
  env.enable(true);
  await flush();
  assert.equal(
    (await profileManager(env)).querySelector(".qap-current-profile").querySelector("qap-icon")
      .style.color ?? "",
    "",
  );
});

test("profile copy colors follow the source until customized and duplicates remain independent", async () => {
  const env = environment();
  const data = env.server.data("test-user");
  data.profiles[0].color = "#8e24aa";
  data.profiles.push({ ...clone(data.profiles[0]), id: "other", name: "Other", color: "#0c2238" });
  await startProfiles(env);
  (await profileManager(env)).querySelector(".qap-create-profile").click();
  let editor = activeProfileEditor(env);
  profileNameInput(editor).value = "Custom copy";
  assert.equal(editor.querySelector(".qap-icon-color-reset").disabled, false);
  chooseProfileCopy(editor);
  assert.equal(iconColorInput(editor).value, "#8e24aa");
  const source = editor.querySelector("select, qap-select");
  source.value = "other";
  source.dispatchEvent(new Event("change"));
  assert.equal(iconColorInput(editor).value, "#0c2238");
  const picker = iconColorInput(editor);
  picker.value = "#abcdef";
  picker.dispatchEvent(new Event("input"));
  source.value = "test-profile";
  source.dispatchEvent(new Event("change"));
  assert.equal(iconColorInput(editor).value, "#abcdef");
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.equal(data.profiles.at(-1).color, "#abcdef");
  editor = await manageProfile(env, "test-profile", "duplicate");
  assert.equal(iconColorInput(editor).value, "#8e24aa");
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.equal(data.profiles.at(-1).color, "#8e24aa");
  editor = await manageProfile(env, data.profiles.at(-1).id, "edit");
  editor.querySelector(".qap-icon-color-reset").click();
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.equal(data.profiles.at(-1).color, "");
  assert.equal(data.profiles[0].color, "#8e24aa");
});

test("profile color drafts survive native upgrades and failed saves and prompt before discard", async () => {
  const env = await startProfiles(environment());
  const components = nativeComponents(env, false);
  components.register("ha-form");
  const editor = await manageProfile(env, "test-profile", "edit");
  const picker = iconColorInput(editor);
  picker.value = "#abcdef";
  picker.dispatchEvent(new Event("input"));
  components.register();
  await flush();
  assert.equal(iconColorInput(editor).localName, "qap-input");
  assert.equal(iconColorInput(editor).value, "#abcdef");
  env.server.failWrites = true;
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.equal(activeProfileEditor(env), editor);
  assert.equal(iconColorInput(editor).value, "#abcdef");
  assert.equal(env.server.data("test-user").profiles[0].color, undefined);
  editor.querySelector(".qap-profile-close").click();
  assert.equal(activeProfileEditor(env), editor);
  respondToDiscard(env);
  assert.equal(activeProfileEditor(env), undefined);
});

test("profile colors use shortcut theme tokens and ignore unsafe stored CSS", async () => {
  for (const [color, expected] of [
    [undefined, ""],
    ["", ""],
    ["red", "var(--red-color)"],
    ["url(example)", ""],
    ["red; background: url(example)", ""],
  ]) {
    const env = environment();
    if (color !== undefined) env.server.data("test-user").profiles[0].color = color;
    await startProfiles(env);
    const manager = await profileManager(env);
    assert.equal(
      manager.querySelector(".qap-current-profile").querySelector("qap-icon").style.color ?? "",
      expected,
    );
    assert.equal(env.server.requests.length, 0);
  }
  for (const color of [null, 7, {}, []]) {
    const env = environment();
    env.server.data("test-user").profiles[0].color = color;
    await startProfiles(env);
    assert.match(env.window.quickAccessDebug().profileError, /Invalid server profile data/);
    assert.equal(env.server.requests.length, 0);
  }
});

test("creating a profile persists its chosen icon across reloads and other Home Assistant URLs", async () => {
  const server = new ProfileServer();
  const env = await startProfiles(environment(undefined, server));
  const manager = await profileManager(env);
  manager.querySelector(".qap-create-profile").click();
  const editor = activeProfileEditor(env);
  profileNameInput(editor).value = "Phone";
  setProfileIcon(editor, "mdi:rocket");
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  const saved = server.data("test-user").profiles.at(-1);
  assert.equal(saved.icon, "mdi:rocket");
  assert.equal(JSON.stringify([...env.storage]).includes("mdi:rocket"), false);
  env.enable(false);
  env.enable(true);
  await flush();
  assert.equal(
    (await profileManager(env))
      .querySelector(".qap-current-profile")
      .querySelector(".qap-edit-symbol")
      .querySelector("qap-icon").attributes.icon,
    "mdi:rocket",
  );
  const remote = await startProfiles(
    environment("https://ha.example.org", server, { fresh: true }),
  );
  await useProfile(remote, saved.id);
  const remoteManager = await profileManager(remote);
  assert.equal(
    remoteManager
      .querySelector(".qap-current-profile")
      .querySelector(".qap-edit-symbol")
      .querySelector("qap-icon").attributes.icon,
    "mdi:rocket",
  );
});

test("Edit profile saves the managed name and icon together and rejects invalid icons without silently replacing them", async () => {
  const env = await startProfiles(environment());
  const original = clone(env.server.data("test-user").profiles[0]);
  const other = { ...clone(original), id: "other", name: "Other", icon: "mdi:home" };
  await env.server.mutate("test-user", {
    operation: "create",
    profile_id: other.id,
    profile: other,
    revision: 0,
  });
  const editor = await manageProfile(env, other.id, "edit");
  assert.equal(editor.querySelector(".qap-title").textContent, "Edit profile");
  assert.equal(profileNameInput(editor).value, other.name);
  profileNameInput(editor).value = "Updated profile";
  assert.equal(profileIconControl(editor).value, "mdi:home");
  const requests = env.server.requests.length;
  for (const invalid of ["", "javascript:alert(1)", "<svg>", "mdi:", "mdi:" + "x".repeat(64)]) {
    setProfileIcon(editor, invalid);
    editor.querySelector(".qap-profile-submit").click();
    assert.match(
      editor.querySelector(".qap-profile-icon-field").querySelector(".qap-field-error").textContent,
      /Choose a valid profile icon/,
    );
    assert.equal(env.server.requests.length, requests);
  }
  setProfileIcon(editor, "mdi:weather-night");
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.deepEqual(env.server.data("test-user").profiles[0], original);
  assert.equal(env.server.data("test-user").profiles[1].name, "Updated profile");
  assert.equal(env.server.data("test-user").profiles[1].icon, "mdi:weather-night");
  assert.deepEqual(env.server.data("test-user").profiles[1].settings, other.settings);
  assert.deepEqual(env.server.data("test-user").profiles[1].favorites, other.favorites);
});

test("native profile icon picker saves the selected MDI icon and renaming does not infer a different icon", async () => {
  const env = await startProfiles(environment());
  nativeComponents(env);
  const editor = await manageProfile(env, "test-profile", "edit");
  const picker = profileIconControl(editor);
  assert.equal(picker.localName, "qap-icon-picker");
  assert.equal(picker.label, "Icon");
  profileNameInput(editor).value = "Desktop tablet";
  setProfileIcon(editor, "mdi:cat");
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.equal(env.server.data("test-user").profiles[0].icon, "mdi:cat");
  editor.dispatchEvent(new Event("closed"));
  const renamed = await manageProfile(env, "test-profile", "edit");
  assert.equal(profileIconControl(renamed).value, "mdi:cat");
  profileNameInput(renamed).value = "Phone";
  await clickAndFlush(renamed.querySelector(".qap-profile-submit"));
  assert.equal(env.server.data("test-user").profiles[0].icon, "mdi:cat");
});

test("copy dialogs inherit source icons until explicitly edited and copies retain independent icon choices", async () => {
  const env = environment();
  const original = env.server.data("test-user").profiles[0];
  original.icon = "mdi:cellphone";
  const alternate = { ...clone(original), id: "alternate", name: "Tablet", icon: "mdi:tablet" };
  env.server.data("test-user").profiles.push(alternate);
  await startProfiles(env);
  const manager = await profileManager(env);
  manager.querySelector(".qap-create-profile").click();
  let editor = activeProfileEditor(env);
  profileNameInput(editor).value = "Independent icon";
  assert.equal(profileIconControl(editor).value, "mdi:devices");
  chooseProfileCopy(editor);
  assert.equal(profileIconControl(editor).value, original.icon);
  const source = editor.querySelector("select, qap-select");
  source.value = alternate.id;
  source.dispatchEvent(new Event("change"));
  assert.equal(profileIconControl(editor).value, alternate.icon);
  setProfileIcon(editor, "mdi:star");
  source.value = original.id;
  source.dispatchEvent(new Event("change"));
  assert.equal(profileIconControl(editor).value, "mdi:star");
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.equal(env.server.data("test-user").profiles.at(-1).icon, "mdi:star");
  editor = await manageProfile(env, original.id, "duplicate");
  assert.equal(profileIconControl(editor).value, original.icon);
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  const copied = env.server.data("test-user").profiles.at(-1);
  assert.equal(copied.icon, original.icon);
  editor = await manageProfile(env, copied.id, "edit");
  setProfileIcon(editor, "mdi:flower");
  await clickAndFlush(editor.querySelector(".qap-profile-submit"));
  assert.equal(
    env.server.data("test-user").profiles.find((item) => item.id === original.id).icon,
    original.icon,
  );
  assert.equal(env.server.data("test-user").profiles.at(-1).icon, "mdi:flower");
});

test("invalid saved profile icons are reported without resetting or rewriting server data", async () => {
  for (const invalid of [
    undefined,
    "",
    "javascript:alert(1)",
    null,
    7,
    {},
    "mdi:" + "x".repeat(64),
  ]) {
    const env = environment();
    const saved = env.server.data("test-user").profiles[0];
    if (invalid === undefined) delete saved.icon;
    else saved.icon = invalid;
    await startProfiles(env);
    assert.match(env.window.quickAccessDebug().profileError, /Invalid server profile data/);
    assert.equal(env.server.requests.length, 0);
    assert.equal(env.server.data("test-user").profiles[0].icon, invalid);
  }
});
