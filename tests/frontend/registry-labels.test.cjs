const assert = require("node:assert/strict");
const test = require("node:test");
const {
  environment,
  installDeviceRegistries,
  deviceFixture,
  installLocaleFetch,
  changeLanguage,
  openDevices,
  openEntityStates,
  clickAndFlush,
  flush,
} = require("./harness.cjs");

for (const kind of ["devices", "states"]) {
  test(`${kind} details show resolved label names and remove the row when no names remain`, async () => {
    const env = environment();
    const getComputedStyle = env.context.getComputedStyle;
    env.context.getComputedStyle = (element) => ({
      ...getComputedStyle(element),
      backgroundColor:
        element.style.getPropertyValue("--ha-label-background-color") === "var(--red-color)"
          ? "rgb(164, 0, 0)"
          : "rgb(0, 0, 255)",
    });
    installLocaleFetch(env);
    installDeviceRegistries(env, [
      deviceFixture("device_a", { labels: ["shared", "second", "missing", "blank", "unknown"] }),
    ]);
    env.status.hass.entities = {
      "sensor.kitchen": { device_id: "device_a", labels: ["entity", "shared"] },
    };
    env.status.hass.states = {
      "sensor.kitchen": { entity_id: "sensor.kitchen", state: "21", attributes: {} },
    };
    let resolveLabels;
    env.status.hass.callWS = ({ type }) => {
      assert.equal(type, "config/label_registry/list");
      return new Promise((resolve) => {
        resolveLabels = resolve;
      });
    };
    await (kind === "devices" ? openDevices(env) : openEntityStates(env));
    await clickAndFlush(env.document.body.querySelector(".qap-state-summary"));
    const modal = env.document.body.querySelector(".qap-state-modal");
    assert.equal(modal.querySelector(".qap-state-dialog-labels"), null);

    resolveLabels([
      { label_id: "shared", name: " Battery, Type: CR2450, Count: 1 ", color: "#ff9800" },
      { label_id: "second", name: "Second label", color: "blue" },
      { label_id: "entity", name: "Entity label" },
      { label_id: "missing" },
      { label_id: "blank", name: "  " },
    ]);
    await flush();
    await env.tick(250);
    const labelRow = modal.querySelector(".qap-state-dialog-labels");
    assert.ok(modal.querySelector(".qap-state-dialog-attributes").contains(labelRow));
    assert.equal(labelRow.querySelector(".qap-state-dialog-state-label").textContent, "Labels");
    const values = labelRow.querySelectorAll(".qap-state-dialog-value");
    assert.deepEqual(
      values.map((value) => value.textContent),
      kind === "devices"
        ? ["Battery, Type: CR2450, Count: 1", "Second label"]
        : ["Entity label", "Battery, Type: CR2450, Count: 1", "Second label"],
    );
    const battery = values.find((value) => value.dataset.labelId === "shared");
    assert.equal(battery.style.getPropertyValue("--ha-label-background-color"), "#ff9800");
    assert.equal(battery.style.getPropertyValue("--primary-text-color"), "#000000");
    assert.equal(
      values.at(-1).style.getPropertyValue("--ha-label-background-color"),
      "var(--blue-color)",
    );
    assert.equal(values.at(-1).style.getPropertyValue("--primary-text-color"), "#ffffff");
    if (kind === "states") {
      assert.equal(values[0].style.getPropertyValue("--ha-label-background-color"), "");
      assert.equal(values[0].style.getPropertyValue("--primary-text-color"), "");
    }
    await changeLanguage(env, "hr");
    assert.equal(labelRow.querySelector(".qap-state-dialog-state-label").textContent, "Oznake");

    env.status.hass.labels = { shared: { name: "Renamed label" } };
    await env.tick(15000);
    await env.tick(250);
    assert.equal(modal.querySelector(".qap-state-dialog-labels"), labelRow);
    assert.equal(labelRow.querySelectorAll(".qap-state-dialog-value").length, 1);
    assert.equal(labelRow.querySelector(".qap-state-dialog-value"), battery);
    assert.equal(labelRow.querySelector(".qap-state-dialog-value").textContent, "Renamed label");
    assert.equal(battery.style.getPropertyValue("--ha-label-background-color"), "");
    assert.equal(battery.style.getPropertyValue("--primary-text-color"), "");

    env.status.hass.labels = { shared: { name: "Renamed label", color: "#00ff00" } };
    await env.tick(15000);
    await env.tick(250);
    assert.equal(battery.style.getPropertyValue("--ha-label-background-color"), "#00ff00");
    assert.equal(battery.style.getPropertyValue("--primary-text-color"), "#000000");

    for (const color of ["red", "#000", "#1234", "#123456ff"]) {
      env.status.hass.labels = { shared: { name: "Renamed label", color } };
      await env.tick(15000);
      await env.tick(250);
      assert.equal(battery.style.getPropertyValue("--primary-text-color"), "#ffffff");
    }

    env.status.hass.labels = {};
    await env.tick(15000);
    await env.tick(250);
    assert.equal(modal.querySelector(".qap-state-dialog-labels"), null);
    assert.equal(modal.open, true);
  });
}
