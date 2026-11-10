"""Bounded, declarative profile filters. No runtime state is stored here."""

import json
import math
import re
from sys import float_info
from typing import Literal, NotRequired, TypedDict

FILTER_LIMIT = 10
CONDITION_LIMIT = 10
MAX_DEPTH = 2
MAX_FILTER_BYTES = 32768
SYSTEM_FILTERS = {"all": "All", "favorites": "Favorites"}
DEFAULT_FILTER_IDS = {"states": {*SYSTEM_FILTERS, "unavailable", "unknown", "low_battery", "updates"},
                      "devices": {*SYSTEM_FILTERS, "assigned", "unassigned", "entity_issues"}}
ENTITY_FIELDS = {"state", "attribute", "id", "name", "domain", "area", "label", "manufacturer", "model", "platform", "device_class", "hidden_by", "entity_category", "smart"}
DEVICE_FIELDS = {"id", "name", "area", "label", "manufacturer", "model", "model_id", "serial_number", "sw_version", "hw_version", "entry_type", "smart"}
SMART_FILTERS = {"states": {"unavailable", "unknown", "low_battery", "updates"}, "devices": {"assigned", "unassigned"}}
OPERATORS = {"equals", "not_equals", "contains", "any_of", "greater_than", "less_than", "exists"}
COLOR_MAX_LENGTH = 256
# Keep HA's icon palette and CSS color syntax in sync with utils/icons.js.
THEME_COLORS = {"primary", "accent", "amber", "deep-purple", "light-blue", "light-green", "deep-orange",
                "light-grey", "dark-grey", "blue-grey"}
CSS_COLOR_NAMES = set("""
aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown
burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan
darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid
darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet
deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro
ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow
lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine
mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise
mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab
orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru
pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown
seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan
teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent currentcolor
inherit initial revert revert-layer unset canvas canvastext linktext visitedtext activetext buttonface
buttontext buttonborder field fieldtext highlight highlighttext selecteditem selecteditemtext mark
marktext graytext accentcolor accentcolortext
""".split())
COLOR_NUMBER = r"[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:e[+-]?[0-9]+)?"
COLOR_CHANNEL = rf"(?:{COLOR_NUMBER}%?|none)"
COLOR_HUE = rf"(?:{COLOR_NUMBER}(?:deg|grad|rad|turn)?|none)"


class Rule(TypedDict):
    """One non-executable comparison."""

    type: Literal["rule"]
    field: str
    operator: str
    value: str | bool | float | list[str | bool | float]
    attribute: NotRequired[str]
    threshold: NotRequired[float]


class ConditionGroup(TypedDict):
    """A bounded boolean group."""

    type: Literal["group"]
    operator: Literal["and", "or", "not"]
    conditions: list["Rule | ConditionGroup | EntityCondition"]


class EntityCondition(TypedDict):
    """A same-entity condition applied to a device's eligible entities."""

    type: Literal["entities"]
    quantifier: Literal["any", "all"]
    condition: ConditionGroup


class SavedFilter(TypedDict):
    """System filters have no editable condition."""

    id: str
    name: str
    hidden: bool
    icon: NotRequired[str]
    color: NotRequired[str]
    templateId: NotRequired[str]
    condition: NotRequired[ConditionGroup]


class FilterDefaults(TypedDict):
    """Optional per-list defaults; absence preserves the existing opening choice."""

    states: NotRequired[str]
    devices: NotRequired[str]


class ProfileFilters(TypedDict):
    """Explicit collections are authoritative, even after preset deletion."""

    version: int
    states: list[SavedFilter]
    devices: list[SavedFilter]
    defaults: NotRequired[FilterDefaults]


def _scalar(value: object) -> bool:
    return (type(value) is bool or isinstance(value, str) and len(value) <= 256
            or type(value) in (int, float) and abs(value) <= float_info.max and math.isfinite(value))


def _color_arguments(value: str) -> list[str] | None:
    """Split CSS function arguments without splitting nested functions."""
    parts: list[str] = []
    depth = start = 0
    for index, char in enumerate(value):
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth < 0:
                return None
        elif char == "," and depth == 0:
            parts.append(value[start:index].strip())
            start = index + 1
    return None if depth else [*parts, value[start:].strip()]


def valid_color(value: object) -> bool:
    """Validate bounded HA palette names and CSS color values."""
    if (not isinstance(value, str) or len(value) > COLOR_MAX_LENGTH
            or any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in value)):
        return False
    value = value.strip()
    if not value or value in THEME_COLORS or value.lower() in CSS_COLOR_NAMES:
        return True
    if re.fullmatch(r"#(?:[a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})", value, re.I):
        return True
    variable = re.fullmatch(r"var\( *(--[\w-]+) *(?:,(.*))?\)", value)
    if variable:
        # CSS checks variable fallbacks as component values, not as colors until
        # substitution. Keep valid stored fallbacks even if they are not colors.
        return variable[2] is None or (re.fullmatch(r"[\w +#.,%()/\-]*", variable[2]) is not None
                                       and _color_arguments(variable[2]) is not None)
    combined = re.fullmatch(r"(light-dark|color-mix)\((.*)\)", value, re.I)
    if combined:
        arguments = _color_arguments(combined[2])
        if not arguments:
            return False
        if combined[1].lower() == "light-dark":
            return len(arguments) == 2 and all(argument and valid_color(argument) for argument in arguments)
        if (len(arguments) != 3 or not re.fullmatch(
                r"in +(?:srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65|lab|oklab|(?:hsl|hwb|lch|oklch)(?: +(?:shorter|longer|increasing|decreasing) +hue)?)",
                arguments[0], re.I)):
            return False
        for argument in arguments[1:]:
            stop = re.fullmatch(rf"(.+?)(?: +({COLOR_NUMBER})%)?", argument, re.I)
            if not stop or not valid_color(stop[1]):
                return False
            percentage = float(stop[2]) if stop[2] is not None else None
            if percentage is not None and not 0 <= percentage <= 100:
                return False
        return True
    function = re.fullmatch(r"(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\((.*)\)", value, re.I)
    if not function:
        return False
    name, channels = function[1].lower(), function[2].strip()
    if "," in channels:
        if name not in {"rgb", "rgba", "hsl", "hsla"}:
            return False
        parts = [part.strip() for part in channels.split(",")]
        if len(parts) not in (3, 4) or any(part.lower() == "none" for part in parts):
            return False
        if name in {"rgb", "rgba"}:
            # Legacy RGB cannot mix percentages and numbers.
            channel = rf"{COLOR_NUMBER}%" if parts[0].endswith("%") else COLOR_NUMBER
            patterns = [channel] * 3
        else:
            patterns = [COLOR_HUE, rf"{COLOR_NUMBER}%", rf"{COLOR_NUMBER}%"]
        if len(parts) == 4:
            patterns.append(COLOR_CHANNEL)
    else:
        components = channels.split("/")
        if len(components) > 2:
            return False
        parts = components[0].split()
        patterns = [COLOR_CHANNEL] * 3
        if name == "color":
            if not parts or parts.pop(0).lower() not in {"srgb", "srgb-linear", "display-p3", "a98-rgb", "prophoto-rgb", "rec2020", "xyz", "xyz-d50", "xyz-d65"}:
                return False
        elif name in {"hsl", "hsla", "hwb"}:
            patterns[0] = COLOR_HUE
        elif name in {"lch", "oklch"}:
            patterns[2] = COLOR_HUE
        if len(components) == 2:
            parts.append(components[1].strip())
            patterns.append(COLOR_CHANNEL)
    return len(parts) == len(patterns) and all(re.fullmatch(pattern, part, re.I) for pattern, part in zip(patterns, parts))


def valid_condition(condition: object, kind: str) -> bool:
    """Validate structure, supported fields, complexity and scalar values."""
    count = 0

    def valid(item: object, scope: str, depth: int) -> bool:
        nonlocal count
        if not isinstance(item, dict) or depth > MAX_DEPTH:
            return False
        if item.get("type") == "group":
            return (set(item) == {"type", "operator", "conditions"}
                    and item["operator"] in ("and", "or", "not")
                    and isinstance(item["conditions"], list)
                    and 0 < len(item["conditions"]) <= CONDITION_LIMIT
                    and all(valid(child, scope, depth + (not isinstance(child, dict) or child.get("type") != "rule")) for child in item["conditions"]))
        if item.get("type") == "entities":
            return (scope == "devices" and set(item) == {"type", "quantifier", "condition"}
                    and item["quantifier"] in ("any", "all")
                    and isinstance(item["condition"], dict) and item["condition"].get("type") == "group"
                    and valid(item["condition"], "states", depth))
        count += 1
        if (item.get("type") != "rule" or count > CONDITION_LIMIT
                or not isinstance(item.get("field"), str)
                or item["field"] not in (DEVICE_FIELDS if scope == "devices" else ENTITY_FIELDS)
                or not isinstance(item.get("operator"), str) or item["operator"] not in OPERATORS
                or set(item) != {"type", "field", "operator", "value"}
                | ({"attribute"} if item["field"] == "attribute" else set())
                | ({"threshold"} if item["field"] == "smart" and item.get("value") == "low_battery" and "threshold" in item else set())):
            return False
        if item["field"] == "attribute" and not (isinstance(item["attribute"], str) and 0 < len(item["attribute"]) <= 100):
            return False
        value, operator = item["value"], item["operator"]
        if item["field"] == "smart":
            return (operator == "equals" and isinstance(value, str) and value in SMART_FILTERS[scope]
                    and ("threshold" not in item or type(item["threshold"]) in (int, float) and 0 <= item["threshold"] <= 100))
        if operator == "exists":
            return value is True
        if operator in ("greater_than", "less_than"):
            return type(value) in (int, float) and _scalar(value)
        if operator == "any_of":
            return isinstance(value, list) and 0 < len(value) <= 20 and all(_scalar(entry) for entry in value)
        return _scalar(value)

    return isinstance(condition, dict) and condition.get("type") == "group" and valid(condition, kind, 0)


def valid_filters(value: object) -> bool:
    """Reject unknown keys, including accidental calculated matching data."""
    if (not isinstance(value, dict) or set(value) != {"version", "states", "devices"} | ({"defaults"} if "defaults" in value else set())
            or type(value["version"]) is not int or value["version"] != 1):
        return False
    defaults = value.get("defaults", {})
    if not isinstance(defaults, dict) or not defaults.keys() <= {"states", "devices"}:
        return False
    for kind in ("states", "devices"):
        entries = value[kind]
        if not isinstance(entries, list) or len(entries) > FILTER_LIMIT + len(SYSTEM_FILTERS):
            return False
        ids: set[str] = set()
        names: set[str] = set()
        for item in entries:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                return False
            filter_id = item["id"]
            system = filter_id in SYSTEM_FILTERS
            if (set(item) != {"id", "name", "hidden"} | (set() if system else {"condition"}) | (item.keys() & {"icon", "color", "templateId"})
                    or "icon" in item and (not isinstance(item["icon"], str) or len(item["icon"]) >= 64
                                           or not re.fullmatch(r"mdi:[a-z0-9]+(?:-[a-z0-9]+)*", item["icon"]))
                    or "color" in item and not valid_color(item["color"])
                    or "templateId" in item and (system or not isinstance(item["templateId"], str)
                                                  or item["templateId"] not in DEFAULT_FILTER_IDS[kind] - SYSTEM_FILTERS.keys())
                    or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", filter_id) or filter_id == "temporary" or filter_id in ids
                    or not isinstance(item["name"], str) or item["name"] != item["name"].strip()
                    or not 0 < len(item["name"]) <= 50 or any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in item["name"])
                    or item["name"].lower() in names or type(item["hidden"]) is not bool
                    or (item["name"] != SYSTEM_FILTERS[filter_id] if system else not valid_condition(item["condition"], kind))):
                return False
            ids.add(filter_id)
            names.add(item["name"].lower())
        if not SYSTEM_FILTERS.keys() <= ids:
            return False
        if kind in defaults and (not isinstance(defaults[kind], str) or defaults[kind] not in ids):
            return False
    # Structure validation bounds depth and values before serialization.
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8", errors="surrogatepass")) <= MAX_FILTER_BYTES
