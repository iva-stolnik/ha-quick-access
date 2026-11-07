import {
  getDeviceName,
  deviceSecondary,
  deviceAreaName as formatDeviceAreaName,
} from "./device-formatting.js";
import { normalizeIcon } from "../utils/icons.js";

export function createDevicePresentation({ l10n, ui, getHass, getRegistries }) {
  const t = l10n.message;
  const { node, icon } = ui;
  function deviceAreaName(device) {
    return formatDeviceAreaName(
      device,
      getRegistries()?.devices || getHass()?.devices || {},
      getRegistries()?.areas || getHass()?.areas || {},
      t("devices.no_area"),
    );
  }

  function deviceIcon(device) {
    const host = node("span", "qap-state-icon");
    host.append(icon(normalizeIcon(device.icon, "mdi:devices")));
    return host;
  }

  function updateDeviceRow(entry, device) {
    l10n.text(entry.name, getDeviceName(device));
    l10n.text(entry.entityId, deviceSecondary(device));
    l10n.text(entry.value, () => deviceAreaName(getRegistries()?.devices[device.id] || device));
    entry.stateIcon
      .querySelector("qap-icon")
      ?.setAttribute("icon", normalizeIcon(device.icon, "mdi:devices"));
  }

  return { deviceAreaName, deviceIcon, updateDeviceRow };
}
