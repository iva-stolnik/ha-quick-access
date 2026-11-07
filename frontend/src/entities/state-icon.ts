import { entityFallbackIconName } from "./entity-formatting.js";
import { normalizeIcon } from "../utils/icons.js";

export interface EntityIconState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown> & { icon?: string; device_class?: string };
}
interface EntityIconEntry {
  icon?: string | null;
  platform?: string;
  translation_key?: string | null;
  disabled_by?: string | null;
}
export interface EntityIconContext {
  entities?: Readonly<Record<string, EntityIconEntry>>;
  connection?: object;
  config?: { components?: readonly string[] };
  callWS?: <T>(message: { type: string; category: string; integration?: string }) => Promise<T>;
  hassUrl?: (url: string) => string;
}
export interface StateIconPresentation {
  icon: string;
  color: string;
  filter: string;
  image: string;
  imageRadius: string;
  pulse: boolean;
}

const COLORED_DOMAINS = new Set([
  "alarm_control_panel",
  "alert",
  "automation",
  "binary_sensor",
  "calendar",
  "camera",
  "climate",
  "cover",
  "device_tracker",
  "fan",
  "group",
  "humidifier",
  "input_boolean",
  "lawn_mower",
  "light",
  "lock",
  "media_player",
  "person",
  "plant",
  "remote",
  "schedule",
  "script",
  "siren",
  "sun",
  "switch",
  "timer",
  "update",
  "vacuum",
  "valve",
  "water_heater",
  "weather",
]);
const DOMAIN_ICONS: Readonly<Record<string, string>> = {
  alarm_control_panel: "shield",
  alert: "alert",
  automation: "robot",
  binary_sensor: "checkbox-blank-circle-outline",
  button: "gesture-tap-button",
  calendar: "calendar",
  camera: "video",
  climate: "thermostat",
  conversation: "microphone-message",
  counter: "counter",
  cover: "window-shutter",
  date: "calendar",
  datetime: "calendar-clock",
  device_tracker: "account",
  event: "eye",
  fan: "fan",
  group: "google-circles-communities",
  humidifier: "air-humidifier",
  image: "image",
  image_processing: "image-filter-frames",
  input_boolean: "toggle-switch",
  input_button: "gesture-tap-button",
  input_datetime: "calendar-clock",
  input_number: "ray-vertex",
  input_select: "format-list-bulleted",
  input_text: "form-textbox",
  lawn_mower: "robot-mower",
  light: "lightbulb",
  lock: "lock",
  media_player: "cast",
  notify: "message",
  number: "ray-vertex",
  person: "account",
  plant: "flower",
  remote: "remote",
  scene: "palette",
  schedule: "calendar-clock",
  script: "script-text",
  select: "format-list-bulleted",
  sensor: "eye",
  siren: "bullhorn",
  stt: "microphone-message",
  sun: "white-balance-sunny",
  switch: "toggle-switch-variant",
  text: "form-textbox",
  time: "clock",
  timer: "timer-outline",
  todo: "clipboard-list",
  tts: "speaker-message",
  update: "package",
  vacuum: "robot-vacuum",
  valve: "valve",
  wake_word: "chat-sleep",
  water_heater: "thermometer",
  weather: "weather-partly-cloudy",
  zone: "map-marker-radius",
};
const BINARY_ICONS: Readonly<Record<string, readonly [string, string]>> = {
  battery: ["battery", "battery-outline"],
  battery_charging: ["battery", "battery-charging"],
  carbon_monoxide: ["smoke-detector", "smoke-detector-alert"],
  cold: ["thermometer", "snowflake"],
  connectivity: ["close-network-outline", "check-network-outline"],
  door: ["door-closed", "door-open"],
  garage_door: ["garage", "garage-open"],
  gas: ["check-circle", "alert-circle"],
  glass_break: ["window-closed", "window-open"],
  heat: ["thermometer", "fire"],
  light: ["brightness-5", "brightness-7"],
  lock: ["lock", "lock-open"],
  moisture: ["water-off", "water"],
  motion: ["motion-sensor-off", "motion-sensor"],
  moving: ["octagon", "octagon-outline"],
  occupancy: ["home-outline", "home"],
  opening: ["square", "square-outline"],
  plug: ["power-plug-off", "power-plug"],
  power: ["power-plug-off", "power-plug"],
  presence: ["home-outline", "home"],
  problem: ["check-circle", "alert-circle"],
  running: ["stop", "play"],
  safety: ["check-circle", "alert-circle"],
  smoke: ["smoke-detector-variant", "smoke-detector-variant-alert"],
  sound: ["volume-mute", "volume-high"],
  tamper: ["check-circle", "alert-circle"],
  update: ["package", "package-up"],
  vibration: ["crop-portrait", "vibrate"],
  window: ["window-closed", "window-open"],
};
const SENSOR_ICONS: Readonly<Record<string, string>> = {
  apparent_power: "flash",
  aqi: "air-filter",
  atmospheric_pressure: "thermometer-lines",
  carbon_dioxide: "molecule-co2",
  carbon_monoxide: "molecule-co",
  current: "current-ac",
  distance: "ruler",
  duration: "progress-clock",
  energy: "lightning-bolt",
  energy_storage: "lightning-bolt",
  frequency: "sine-wave",
  gas: "meter-gas",
  humidity: "water-percent",
  illuminance: "brightness-5",
  irradiance: "sun-wireless",
  moisture: "water-percent",
  monetary: "cash",
  pm1: "blur",
  pm10: "blur",
  pm25: "blur",
  power: "flash",
  power_factor: "angle-acute",
  precipitation: "weather-rainy",
  precipitation_intensity: "weather-pouring",
  pressure: "gauge",
  reactive_power: "flash",
  signal_strength: "wifi",
  sound_pressure: "ear-hearing",
  speed: "speedometer",
  temperature: "thermometer",
  timestamp: "clock",
  volatile_organic_compounds: "molecule",
  voltage: "sine-wave",
  volume: "car-coolant-level",
  volume_flow_rate: "waves-arrow-right",
  water: "water",
  weight: "weight",
  wind_speed: "weather-windy",
};
const HVAC_ACTIONS: Readonly<Record<string, string>> = {
  cooling: "cool",
  defrosting: "heat",
  drying: "dry",
  fan: "fan_only",
  heating: "heat",
  idle: "off",
  off: "off",
  preheating: "heat",
};
const DEFAULT_COLOR = "var(--state-icon-color)";
const LIGHT_MAX_BRIGHTNESS = 255;
const LIGHT_BRIGHTNESS_OFFSET = 245;
const LIGHT_BRIGHTNESS_DIVISOR = 5;

/** HA accepts custom icon sets; keep profile icon validation strict elsewhere. */
export function normalizeEntityIcon(icon: unknown, fallback = ""): string {
  if (typeof icon !== "string") return fallback;
  const value = icon.trim();
  if (/^[a-z][a-z0-9_-]*:[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) {
    return value.startsWith("mdi:") ? normalizeIcon(value, fallback) : value;
  }
  return fallback;
}

export function entityStateActive(state: EntityIconState, value = state.state): boolean {
  const domain = state.entity_id.split(".")[0];
  if (value === "unavailable" || value === "unknown" || (value === "off" && domain !== "alert"))
    return false;
  switch (domain) {
    case "alarm_control_panel":
      return value !== "disarmed";
    case "alert":
      return value !== "idle";
    case "cover":
    case "valve":
      return value !== "closed";
    case "device_tracker":
    case "person":
      return value !== "not_home";
    case "lawn_mower":
    case "vacuum":
      return !["docked", "paused", "idle"].includes(value);
    case "lock":
      return value !== "locked";
    case "media_player":
      return value !== "standby";
    case "plant":
      return value === "problem";
    case "group":
      return ["on", "home", "open", "locked", "problem"].includes(value);
    case "timer":
      return value === "active";
    case "camera":
      return ["streaming", "recording"].includes(value);
    default:
      return true;
  }
}

function stateColor(state: EntityIconState, value = state.state): string {
  if (value === "unavailable") return "var(--state-unavailable-color)";
  let domain = state.entity_id.split(".")[0];
  const deviceClass = state.attributes.device_class;
  if (domain === "sensor" && deviceClass === "battery" && Number.isFinite(Number(value))) {
    let level = "low";
    if (Number(value) >= 70) level = "high";
    else if (Number(value) >= 30) level = "medium";
    return `var(--state-sensor-battery-${level}-color)`;
  }
  if (domain === "group" && Array.isArray(state.attributes.entity_id)) {
    const domains = new Set(
      state.attributes.entity_id
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.split(".")[0]),
    );
    if (domains.size === 1 && COLORED_DOMAINS.has([...domains][0])) domain = [...domains][0];
  }
  if (!COLORED_DOMAINS.has(domain)) return DEFAULT_COLOR;
  const key = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const active = entityStateActive(state, value) ? "active" : "inactive";
  const variables = [
    ...(deviceClass ? [`--state-${domain}-${deviceClass}-${key}-color`] : []),
    `--state-${domain}-${key}-color`,
    `--state-${domain}-${active}-color`,
    `--state-${active}-color`,
  ];
  return variables.reduceRight(
    (fallback, variable) => `var(${variable}, ${fallback})`,
    DEFAULT_COLOR,
  );
}

/** Rules HA applies before component/integration icon metadata. */
export function specialStateIcon(state: EntityIconState): string | undefined {
  switch (state.entity_id.split(".")[0]) {
    case "update":
      if (state.attributes.in_progress) return "mdi:package-down";
      if (state.state === "on") return "mdi:package-up";
      return "mdi:package";
    case "sun":
      return state.state === "above_horizon" ? "mdi:white-balance-sunny" : "mdi:weather-night";
    case "device_tracker":
      if (state.attributes.source_type === "router")
        return state.state === "home" ? "mdi:lan-connect" : "mdi:lan-disconnect";
      if (["bluetooth", "bluetooth_le"].includes(String(state.attributes.source_type)))
        return state.state === "home" ? "mdi:bluetooth-connect" : "mdi:bluetooth";
      return state.state === "not_home" ? "mdi:account-arrow-right" : "mdi:account";
    case "input_datetime":
      if (!state.attributes.has_date) return "mdi:clock";
      if (!state.attributes.has_time) return "mdi:calendar";
  }
  return undefined;
}

function fallbackStateIcon(state: EntityIconState): string {
  const domain = state.entity_id.split(".")[0],
    dc = state.attributes.device_class ?? "",
    on = state.state === "on";
  if (domain === "binary_sensor")
    return `mdi:${BINARY_ICONS[dc]?.[on ? 1 : 0] ?? (on ? "checkbox-marked-circle" : "checkbox-blank-circle-outline")}`;
  if (domain === "sensor") {
    if (dc === "battery") {
      const level = Number(state.state);
      if (!Number.isFinite(level)) return "mdi:battery-unknown";
      if (level <= 5) return "mdi:battery-alert-variant-outline";
      if (level >= 95) return "mdi:battery";
      return `mdi:battery-${Math.round(level / 10) * 10}`;
    }
    if (SENSOR_ICONS[dc]) return `mdi:${SENSOR_ICONS[dc]}`;
  }
  if (domain === "light") return on ? "mdi:lightbulb" : "mdi:lightbulb-off";
  if (domain === "switch") {
    if (dc === "outlet") return "mdi:power-socket";
    return on ? "mdi:toggle-switch-variant" : "mdi:toggle-switch-variant-off";
  }
  if (domain === "cover") {
    const icons: Readonly<Record<string, readonly [string, string]>> = {
      garage: ["garage", "garage-open"],
      door: ["door-closed", "door-open"],
      gate: ["gate", "gate-open"],
      curtain: ["curtains-closed", "curtains"],
      blind: ["blinds-horizontal-closed", "blinds-horizontal"],
      shade: ["roller-shade-closed", "roller-shade"],
      window: ["window-closed", "window-open"],
    };
    return `mdi:${(icons[dc] ?? ["window-shutter", "window-shutter-open"])[state.state === "closed" ? 0 : 1]}`;
  }
  if (domain === "lock") {
    if (state.state === "locked") return "mdi:lock";
    if (state.state === "jammed") return "mdi:lock-alert";
    return "mdi:lock-open";
  }
  return DOMAIN_ICONS[domain]
    ? `mdi:${DOMAIN_ICONS[domain]}`
    : normalizeIcon(entityFallbackIconName(state));
}

/** Pure presentation, modeled on HA 20260930.4 state-badge/state_color. CSS stays live to theme changes. */
export function resolveStateIcon(
  state?: EntityIconState,
  context?: EntityIconContext,
  metadataIcon?: string,
  disabled = false,
): StateIconPresentation {
  const domain = state?.entity_id.split(".")[0] ?? "";
  const entry = state && context?.entities?.[state.entity_id];
  const icon =
    normalizeEntityIcon(entry?.icon) ||
    normalizeEntityIcon(state?.attributes.icon) ||
    normalizeEntityIcon(metadataIcon) ||
    (state ? specialStateIcon(state) || fallbackStateIcon(state) : "mdi:help-circle");
  let color = state ? stateColor(state) : "var(--state-unavailable-color)";
  let filter = "";
  if (state && state.state !== "unavailable" && state.state !== "unknown") {
    const rgb = state.attributes.rgb_color,
      brightness = state.attributes.brightness;
    if (
      Array.isArray(rgb) &&
      rgb.length === 3 &&
      rgb.every(
        (value) =>
          typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 255,
      )
    ) {
      color = `rgb(${rgb.join(",")})`;
    }
    if (
      typeof brightness === "number" &&
      Number.isFinite(brightness) &&
      brightness > 0 &&
      domain !== "plant"
    ) {
      filter = `brightness(${(Math.min(brightness, LIGHT_MAX_BRIGHTNESS) + LIGHT_BRIGHTNESS_OFFSET) / LIGHT_BRIGHTNESS_DIVISOR}%)`;
    }
    if (typeof state.attributes.hvac_action === "string" && state.attributes.hvac_action) {
      const mode = HVAC_ACTIONS[state.attributes.hvac_action];
      color = mode ? stateColor(state, mode) : DEFAULT_COLOR;
    }
  }
  if (disabled || entry?.disabled_by) {
    color = "var(--disabled-text-color)";
    filter = "";
  }
  const picture = state?.attributes.entity_picture_local || state?.attributes.entity_picture;
  let image = typeof picture === "string" ? picture : "";
  if (image) {
    // Brand URLs require HA's signed URL helper. Never issue unauthenticated requests.
    if (context?.hassUrl) image = context.hassUrl(image);
    else if (/^\/api\/brands\//.test(image)) image = "";
    if (domain === "camera" && image)
      image += `${image.includes("?") ? "&" : "?"}width=80&height=80`;
  }
  let imageRadius = "var(--state-badge-with-image-border-radius, 50%)";
  if (domain === "update") imageRadius = "var(--ha-border-radius-square, 0px)";
  else if (domain === "media_player" || domain === "camera")
    imageRadius = "var(--state-badge-with-media-image-border-radius, 8%)";
  return {
    icon,
    color,
    filter,
    image,
    imageRadius,
    pulse: Boolean(
      state &&
      ((domain === "alarm_control_panel" &&
        ["pending", "arming", "triggered"].includes(state.state)) ||
        (domain === "lock" && state.state === "jammed")),
    ),
  };
}

export function sameStateIcon(a: StateIconPresentation, b: StateIconPresentation): boolean {
  return (
    a.icon === b.icon &&
    a.color === b.color &&
    a.filter === b.filter &&
    a.image === b.image &&
    a.imageRadius === b.imageRadius &&
    a.pulse === b.pulse
  );
}
