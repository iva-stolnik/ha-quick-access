import { effectiveDeviceArea } from "./device-area.js";
import { getDeviceName } from "./device-formatting.js";

const DEVICE_FILTERS = new Set(["all", "favorites", "assigned", "unassigned"]);

export function deviceMatches(device, view, searchTerm, registries) {
  // Like entityMatches, an unknown filter matches nothing rather than everything.
  if (!DEVICE_FILTERS.has(view.filter)) return false;
  if (view.filter === "favorites" && !view.favorites.has(device.id)) return false;
  const areaId = effectiveDeviceArea(device, registries.devices);
  if ((view.filter === "assigned" && !areaId) || (view.filter === "unassigned" && areaId))
    return false;
  if (!searchTerm) return true;
  return [
    device.id,
    getDeviceName(device),
    device.name,
    device.manufacturer,
    device.model,
    device.model_id,
    device.serial_number,
    areaId,
    areaId && registries.areas[areaId]?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase()
    .includes(searchTerm);
}
