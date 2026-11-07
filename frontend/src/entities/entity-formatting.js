import { DEFAULT_ICON } from "../profiles/profile-defaults.js";

export function entityFallbackIconName(state) {
  const domain = state.entity_id.split(".")[0];
  if (state.attributes?.icon) return state.attributes.icon;
  switch (domain) {
    case "sensor":
      return "mdi:thermometer";
    case "light":
      return "mdi:lightbulb-outline";
    case "binary_sensor":
      return "mdi:eye-outline";
    default:
      return DEFAULT_ICON;
  }
}

export function formattedEntityName(state, hass) {
  const name =
    typeof hass?.formatEntityName === "function" ? hass.formatEntityName(state) : undefined;
  return typeof name === "string" && name.trim()
    ? name
    : state.attributes?.friendly_name || state.entity_id;
}

export function formattedState(state, hass, unavailable, includeUnit = true) {
  if (!state) return unavailable;
  if (typeof hass?.formatEntityState === "function") return hass.formatEntityState(state);
  const unit =
    includeUnit && typeof state.attributes?.unit_of_measurement === "string"
      ? state.attributes.unit_of_measurement
      : "";
  return `${state.state}${unit ? ` ${unit}` : ""}`;
}
