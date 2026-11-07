import { effectiveDeviceArea } from "./device-area.js";

export function getDeviceName(device) {
  return device.name_by_user?.trim() || device.name?.trim() || device.id;
}

export function deviceSecondary(device) {
  return [device.manufacturer, device.model].filter(Boolean).join(" · ") || device.id;
}

export function deviceAreaName(device, devices, areas, unavailable) {
  const areaId = effectiveDeviceArea(device, devices);
  return areaId ? areas[areaId]?.name || areaId : unavailable;
}
