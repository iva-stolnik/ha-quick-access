"""Authenticated profile storage with durable, serialized compare-and-swap writes."""

import asyncio
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass, field
import json
import logging
from pathlib import Path
import re
from typing import Any, Literal, NotRequired, TypedDict

from ada_url import URL
import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.websocket_api.messages import (
    construct_event_message, construct_result_message,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.instance_id import async_get as async_get_instance_id
from homeassistant.helpers.json import json_bytes
from homeassistant.helpers.storage import Store

from .const import DEFAULT_OPTIONS, DOMAIN, MIB
from .filters import DEFAULT_FILTER_IDS, SYSTEM_FILTERS, ProfileFilters, valid_color, valid_filters
from .options import effective_options

_LOGGER = logging.getLogger(__name__)
SCHEMA_VERSION = 1
OPERATIONS = ("create", "update", "delete", "reset_visibility")
# Defaults come from the integration options so the two cannot drift apart.
MAX_PROFILES = DEFAULT_OPTIONS["max_profiles"]
MAX_CATEGORIES = DEFAULT_OPTIONS["max_categories"]
MAX_ITEMS = 10000
MAX_SHORTCUTS = 500
MAX_PROFILE_BYTES = DEFAULT_OPTIONS["max_profile_mib"] * MIB
MAX_USER_BYTES = DEFAULT_OPTIONS["max_user_mib"] * MIB
IDENTIFIER = re.compile(r"[A-Za-z0-9_-]{1,100}\Z")
ENTITY_ID = re.compile(r"[a-z0-9_]+\.[a-z0-9_]+\Z")
MDI_ICON = re.compile(r"mdi:[a-z0-9]+(?:-[a-z0-9]+)*\Z")
MAX_ICON_LENGTH = 64
MAX_CATEGORY_NAME_LENGTH = 50
MAX_SHORTCUT_GRID_DIMENSION = 10


class ShortcutGrid(TypedDict):
    """Shortcut page dimensions and optional icon-only display."""

    rows: int
    columns: int
    hideNames: NotRequired[bool]


class Category(TypedDict):
    """An ordered profile category with a stable shortcut reference."""

    id: str
    name: str
    grid: NotRequired[ShortcutGrid]


class Shortcut(TypedDict):
    """A navigation, registry or scene activation shortcut."""

    id: str
    name: str
    type: Literal["internal", "external", "quick-states", "quick-devices", "saved-filter", "scene"]
    path: str
    icon: str
    color: str
    group: str
    filterId: NotRequired[str]
    filterKind: NotRequired[Literal["states", "devices"]]


class Settings(TypedDict):
    """Only the settings shared by devices using a profile."""

    visibility: Literal["include", "exclude"]
    routes: list[str]
    links: list[Shortcut]


class Profile(TypedDict):
    """A named configuration; never contains device-local data."""

    id: str
    name: str
    icon: str
    color: NotRequired[str]
    settings: Settings
    favorites: list[str]
    device_favorites: NotRequired[list[str]]
    categories: list[Category]
    filters: NotRequired[ProfileFilters]


class ProfileData(TypedDict):
    """Versioned on-disk user document."""

    version: int
    revision: int
    profiles: list[Profile]


class ProfileUsage(TypedDict):
    """Byte and category accounting for one validated profile."""

    categories: int
    bytes: int


class DocumentUsage(TypedDict):
    """Quota accounting reusable for the mutation's outgoing snapshot."""

    profiles: int
    user_bytes: int
    by_profile: dict[str, ProfileUsage]


class ProfileError(ValueError):
    """A safe client-facing failure."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _read_storage(path: str) -> dict[str, Any] | None:
    """Read without HA's corrupt-file-to-empty recovery behavior."""
    file = Path(path)
    try:
        with file.open(encoding="utf-8") as stream:
            value = json.load(stream)
    except FileNotFoundError:
        return None
    if not isinstance(value, dict) or "data" not in value:
        raise ProfileError("invalid_data", "Invalid profile storage file. Restore it from backup before editing profiles.")
    return value


class ConfirmedStore(Store[ProfileData]):
    """HA Store logs some write failures instead of raising: verify the disk.

    All access is inside UserProfiles.lock. No other API writes this namespace.
    Preflight also stops a corrupt JSON file being interpreted as a new user.
    """

    async def async_load(self) -> ProfileData | None:
        saved = await self.hass.async_add_executor_job(_read_storage, self.path)
        if saved is not None:
            await self.hass.async_add_executor_job(_validate_storage, saved)
        loaded = await super().async_load()
        return await self.hass.async_add_executor_job(validate_document, loaded) if loaded is not None else None

    async def async_save(self, data: ProfileData) -> None:
        # HA defers saves during shutdown to its final-write event. Reject before
        # queuing data so a failed request cannot later change the disk revision.
        if self.hass.is_stopping:
            raise ProfileError("storage_error", "Home Assistant is stopping. Keep your draft and retry after it restarts.")
        await super().async_save(data)
        saved = await self.hass.async_add_executor_job(_read_storage, self.path)
        await self.hass.async_add_executor_job(_confirm_storage, saved, data)


def _validate_storage(saved: dict[str, Any]) -> None:
    """Validate preflight data in the executor before HA can recover a bad file."""
    _require(saved.get("version") == SCHEMA_VERSION, "Unsupported profile storage version.")
    validate_document(saved.get("data"))


def _confirm_storage(saved: dict[str, Any] | None, data: ProfileData) -> None:
    """Keep the full-document read-back comparison off the event loop too."""
    if saved is None or saved.get("version") != SCHEMA_VERSION or saved.get("data") != data:
        raise ProfileError("storage_error", "Could not confirm profile data on disk. Keep your draft and retry.")


def _require(condition: bool, message: str = "Invalid profile data.") -> None:
    if not condition:
        raise ProfileError("invalid_data", message)


def _identifier(value: Any) -> bool:
    return isinstance(value, str) and IDENTIFIER.fullmatch(value) is not None


def _valid_icon(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) < MAX_ICON_LENGTH
        and MDI_ICON.fullmatch(value) is not None
    )


def _valid_external_url(value: str) -> bool:
    """Match the frontend's WHATWG URL parser without rewriting saved text."""
    try:
        # URL takes a USVString in browsers: replace lone JSON surrogates.
        parsed_value = value.encode("utf-16", errors="surrogatepass").decode("utf-16", errors="replace")
        return URL(parsed_value).protocol in ("http:", "https:")
    except ValueError:
        return False


def validate_profile(value: Any) -> Profile:
    """Reject malformed data instead of replacing it with defaults."""
    _require(isinstance(value, dict))
    _require(set(value) - {"color", "device_favorites", "filters"} == {"id", "name", "icon", "settings", "favorites", "categories"})
    _require("filters" not in value or valid_filters(value["filters"]), "Invalid filter definitions.")
    _require(_valid_icon(value["icon"]), "Invalid profile icon. Choose a valid mdi: icon.")
    _require(isinstance(value.get("color", ""), str))
    _require(_identifier(value["id"]))
    _require(
        isinstance(value["name"], str)
        and bool(value["name"].strip())
        and len(value["name"]) <= 80
    )
    categories = value["categories"]
    _require(isinstance(categories, list) and bool(categories), "Invalid groups.")
    value = deepcopy(value)
    if "filters" in value:
        # "All" is every list's fallback and cannot be disabled. Re-enable it
        # on a copy so profiles saved before this rule still load.
        for kind in ("states", "devices"):
            for item in value["filters"][kind]:
                if item["id"] == "all":
                    item["hidden"] = False
    categories = value["categories"]
    category_ids: set[str] = set()
    category_names: set[str] = set()
    for category in categories:
        _require(isinstance(category, dict) and set(category) - {"grid"} == {"id", "name"}, "Invalid group structure.")
        if "grid" in category:
            grid = category["grid"]
            _require(
                isinstance(grid, dict) and set(grid) - {"hideNames"} == {"rows", "columns"}
                and all(type(grid[key]) is int and 1 <= grid[key] <= MAX_SHORTCUT_GRID_DIMENSION
                        for key in ("rows", "columns")),
                f"Grid rows and columns must be whole numbers from 1 to {MAX_SHORTCUT_GRID_DIMENSION}.",
            )
            _require("hideNames" not in grid or type(grid["hideNames"]) is bool,
                     "Grid hideNames must be a boolean.")
        category_id, name = category["id"], category["name"]
        _require(_identifier(category_id) and category_id not in category_ids, "Group IDs must be valid and unique.")
        _require(
            isinstance(name, str) and name == name.strip()
            and 1 <= len(name) <= MAX_CATEGORY_NAME_LENGTH
            and not any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in name),
            "Enter a group name of 1–50 characters without control characters.",
        )
        _require(name.lower() not in category_names, "A group with this name already exists.")
        _require(category_id != "favorites" or name == "Favorites", "Favorites cannot be renamed.")
        category_ids.add(category_id)
        category_names.add(name.lower())
    _require("favorites" in category_ids, "Favorites cannot be deleted.")
    settings = value["settings"]
    _require(isinstance(settings, dict))
    # Drop the retired preference on a copy so existing profiles still load.
    if "show_breadcrumbs" in settings:
        previous = settings.pop("show_breadcrumbs")
        _require(type(previous) is bool)
    _require(set(settings) == {"visibility", "routes", "links"})
    _require(settings["visibility"] in ("include", "exclude"))
    routes = settings["routes"]
    _require(isinstance(routes, list) and len(routes) <= MAX_ITEMS)
    _require(all(isinstance(route, str) and route.startswith("/") for route in routes))
    _require(
        settings["visibility"] != "include" or bool(routes),
        "Showing Quick Access only on listed pages requires at least one page path.",
    )
    links = settings["links"]
    _require(isinstance(links, list) and len(links) <= MAX_ITEMS)
    ids: set[str] = set()
    for link in links:
        _require(isinstance(link, dict))
        saved_filter = link.get("type") == "saved-filter"
        _require(set(link) - {"hidden"} == {"id", "name", "type", "path", "icon", "color", "group"} | ({"filterId", "filterKind"} if saved_filter else set()))
        _require("hidden" not in link or type(link["hidden"]) is bool)
        _require(isinstance(link["id"], str) and bool(link["id"]) and link["id"] not in ids)
        ids.add(link["id"])
        _require(isinstance(link["name"], str) and 0 < len(link["name"]) <= 50)
        _require(isinstance(link["path"], str))
        _require(link["type"] in ("internal", "external", "quick-states", "quick-devices", "saved-filter", "scene"))
        if link["type"] == "scene":
            _require(link["path"].startswith("scene.") and ENTITY_ID.fullmatch(link["path"]) is not None,
                     "Invalid scene entity ID.")
        if saved_filter:
            kind, filter_id = link["filterKind"], link["filterId"]
            _require(isinstance(kind, str) and kind in ("states", "devices")
                     and _identifier(filter_id) and filter_id != "temporary" and link["path"] == "",
                     "Invalid saved filter reference.")
            available = ({item["id"] for item in value["filters"][kind]} if "filters" in value else DEFAULT_FILTER_IDS[kind])
            _require(filter_id in available, "The referenced filter does not exist in this profile.")
        if link["type"] == "internal":
            _require(
                link["path"].startswith("/")
                and not link["path"].startswith("//")
                and "\\" not in link["path"]
            )
        if link["type"] == "external":
            _require(_valid_external_url(link["path"]), "Invalid shortcut URL.")
        _require(_valid_icon(link["icon"]), "Invalid shortcut icon. Choose a valid mdi: icon.")
        _require(isinstance(link["color"], str))
        _require(isinstance(link["group"], str) and link["group"] in category_ids, "Shortcut group does not exist in this profile.")
    favorites = value["favorites"]
    _require(isinstance(favorites, list) and len(favorites) <= MAX_ITEMS)
    _require(all(isinstance(item, str) and ENTITY_ID.fullmatch(item) is not None for item in favorites))
    _require(len(set(favorites)) == len(favorites))
    # Absent in older v1 documents: read as empty, without rewriting storage.
    device_favorites = value.get("device_favorites", [])
    _require(isinstance(device_favorites, list) and len(device_favorites) <= MAX_ITEMS)
    _require(all(_identifier(item) for item in device_favorites))
    _require(len(set(device_favorites)) == len(device_favorites))
    return value


def _clean_name(value: str) -> bool:
    return value == value.strip() and not any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in value)


def validate_written_profile(profile: Profile, previous: Profile | None) -> None:
    """Apply stricter checks to values a client writes.

    Storage loads keep the original v1 rules. Values unchanged since the stored
    profile are not rechecked, so legacy data never blocks unrelated edits.
    """
    if previous is None or profile["name"] != previous["name"]:
        _require(_clean_name(profile["name"]),
                 "Enter a profile name without surrounding spaces or control characters.")
    if "color" in profile and (previous is None or profile["color"] != previous.get("color")):
        _require(valid_color(profile["color"]), "Invalid profile color.")
    previous_links = {link["id"]: link for link in previous["settings"]["links"]} if previous else {}
    for link in profile["settings"]["links"]:
        old = previous_links.get(link["id"])
        if old == link:
            continue
        if old is None:
            _require(_identifier(link["id"]), "Invalid shortcut ID.")
        if old is None or link["name"] != old["name"]:
            _require(_clean_name(link["name"]),
                     "Enter a shortcut name without surrounding spaces or control characters.")
        if old is None or link["color"] != old["color"]:
            _require(valid_color(link["color"]), "Invalid shortcut color.")


def encoded_size(value: Any) -> int:
    """Retain JSON byte accounting, including escaped Unicode and metadata."""
    return len(json.dumps(value).encode("utf-8"))


def document_usage(data: ProfileData) -> DocumentUsage:
    """Calculate snapshot usage once, without retaining mutable profile data."""
    return {
        "profiles": len(data["profiles"]), "user_bytes": encoded_size(data),
        "by_profile": {
            item["id"]: {"categories": len(item["categories"]), "bytes": encoded_size(item)}
            for item in data["profiles"]
        },
    }


@dataclass(frozen=True)
class ResourceLimits:
    """Instance quotas, with storage converted from MiB to bytes."""

    max_profiles: int = MAX_PROFILES
    max_categories: int = MAX_CATEGORIES
    max_user_bytes: int = MAX_USER_BYTES
    max_profile_bytes: int = MAX_PROFILE_BYTES

    @classmethod
    def from_options(cls, options: dict[str, Any]) -> "ResourceLimits":
        values = effective_options(options)
        return cls(values["max_profiles"], values["max_categories"],
                   values["max_user_mib"] * MIB, values["max_profile_mib"] * MIB)


def enforce_quotas(current: ProfileData, updated: ProfileData, limits: ResourceLimits) -> DocumentUsage:
    """Prevent over-limit growth and return the updated document's accounting."""
    def check(usage: int, previous: int, maximum: int, code: str, message: str) -> None:
        if usage > maximum and usage > previous:
            raise ProfileError(code, message)

    check(len(updated["profiles"]), len(current["profiles"]), limits.max_profiles,
          "profile_limit", "Profile limit reached. Delete an existing profile or contact your Home Assistant administrator to increase the limit.")
    usage = document_usage(updated)
    previous_profiles = {item["id"]: item for item in current["profiles"]}
    for item in updated["profiles"]:
        previous = previous_profiles.get(item["id"])
        # Keep legacy profiles readable/editable while preventing further growth.
        check(len(item["settings"]["links"]), len(previous["settings"]["links"]) if previous else 0,
              MAX_SHORTCUTS, "shortcut_limit", f"Shortcut limit reached ({MAX_SHORTCUTS} per profile). Remove an existing shortcut before adding another.")
        previous_categories = previous["categories"] if previous else []
        category_ids = {category["id"] for category in previous_categories}
        if (len(item["categories"]) > limits.max_categories
                and any(category["id"] not in category_ids for category in item["categories"])):
            raise ProfileError("category_limit", "Group limit reached. Delete an existing group or contact your Home Assistant administrator to increase the limit.")
        profile_size = usage["by_profile"][item["id"]]["bytes"]
        if profile_size > limits.max_profile_bytes:
            check(profile_size, encoded_size(previous) if previous else 0, limits.max_profile_bytes,
                  "profile_storage_limit", "Storage limit reached for this profile. Remove unused data or contact your Home Assistant administrator to increase the limit.")
    # Revision digits are server bookkeeping. Above quota, size-neutral edits
    # must remain possible even at a revision boundary (e.g. 9 -> 10).
    updated_size = usage["user_bytes"]
    if updated_size > limits.max_user_bytes:
        current_size = encoded_size(current)
        comparable = {**updated, "revision": current["revision"]}
        baseline = encoded_size(comparable) if current_size > limits.max_user_bytes else updated_size
        check(baseline, current_size, limits.max_user_bytes,
              "user_storage_limit", "Total storage limit reached. Remove unused data or contact your Home Assistant administrator to increase the limit.")
    return usage


def validate_document(value: Any) -> ProfileData:
    """Validate the whole user profile document."""
    _require(isinstance(value, dict) and set(value) == {"version", "revision", "profiles"})
    _require(
        type(value["version"]) is int and value["version"] == SCHEMA_VERSION,
        "Unsupported profile storage version.",
    )
    _require(type(value["revision"]) is int and value["revision"] >= 0)
    _require(isinstance(value["profiles"], list))
    profiles = [validate_profile(item) for item in value["profiles"]]
    _require(len({item["id"] for item in profiles}) == len(profiles))
    # Each validated profile already owns a deep copy; the other fields are ints.
    return {"version": value["version"], "revision": value["revision"], "profiles": profiles}


@dataclass
class UserProfiles:
    """One lock protects load, revision comparison, persistence and notification."""

    store: ConfirmedStore
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    data: ProfileData | None = None
    profile_revisions: dict[str, int] = field(default_factory=dict)
    listeners: dict[tuple[websocket_api.ActiveConnection, int], Callable[[bytes], None]] = field(
        default_factory=dict
    )

    async def async_load(self) -> ProfileData:
        if self.data is None:
            loaded = await self.store.async_load()
            self.data = loaded if loaded is not None else {
                "version": SCHEMA_VERSION, "revision": 0, "profiles": [],
            }
            # History before this load is unknown. Require at least this
            # revision, including after a failed save forces a disk reload.
            self.profile_revisions = {
                item["id"]: self.data["revision"] for item in self.data["profiles"]
            }
        return self.data


class ProfileStore:
    """Keep user identity on the authenticated connection, never in messages."""

    def __init__(self, hass: HomeAssistant, instance_id: str) -> None:
        self.hass = hass
        self.instance_id = instance_id
        self.users: dict[str, UserProfiles] = {}
        self.options: Callable[[], dict[str, Any]] = lambda: {}

    def user(self, user_id: str) -> UserProfiles:
        if user_id not in self.users:
            self.users[user_id] = UserProfiles(ConfirmedStore(
                self.hass, SCHEMA_VERSION, f"{DOMAIN}.profiles_v{SCHEMA_VERSION}.{user_id}",
                private=True, atomic_writes=True, serialize_in_event_loop=False,
            ))
        return self.users[user_id]

    @property
    def limits(self) -> ResourceLimits:
        """Read options for each mutation, even before its listener runs."""
        return ResourceLimits.from_options(self.options())

    def snapshot(
        self, data: ProfileData, usage: DocumentUsage | None = None,
        limits: ResourceLimits | None = None,
    ) -> dict[str, Any]:
        """Borrow committed data only while encoding in the executor; never publish it."""
        limits = limits or self.limits
        return {
            **data, "instance_id": self.instance_id,
            "limits": {
                "max_profiles": limits.max_profiles, "max_categories": limits.max_categories,
                "max_user_bytes": limits.max_user_bytes, "max_profile_bytes": limits.max_profile_bytes,
            },
            "usage": usage if usage is not None else document_usage(data),
        }

    def _encode_snapshot(
        self, data: ProfileData, usage: DocumentUsage | None,
        limits: ResourceLimits, message_ids: list[int],
    ) -> tuple[bytes, dict[int, bytes]]:
        """Encode once and build immutable WS envelopes entirely in a worker."""
        payload = json_bytes(self.snapshot(data, usage, limits))
        return payload, {
            message_id: construct_event_message(message_id, payload)
            for message_id in set(message_ids)
        }

    async def _publish(
        self, user: UserProfiles, data: ProfileData, usage: DocumentUsage | None = None,
    ) -> bytes:
        """Called under the user lock; connection APIs always run on the loop."""
        listeners = list(user.listeners.items())
        payload, events = await self.hass.async_add_executor_job(
            self._encode_snapshot, data, usage, self.limits,
            [key[1] for key, _listener in listeners],
        )
        for key, listener in listeners:
            # Unsubscribe/unload can run while the executor is encoding.
            if user.listeners.get(key) is not listener:
                continue
            try:
                listener(events[key[1]])
            except Exception:
                _LOGGER.exception("Could not notify a Quick Access profile subscriber")
        return payload

    async def notify_limits(self) -> None:
        """Publish quotas without changing revisions or device selection."""
        for user in list(self.users.values()):
            if user.data is None or not user.listeners:
                continue
            try:
                async with user.lock:
                    if user.data is not None and user.listeners:
                        await self._publish(user, user.data)
            except Exception:
                _LOGGER.exception("Could not build a Quick Access quota snapshot")
                continue

    def close_subscriptions(self) -> None:
        """Unload removes profile listeners even if a tab is suspended."""
        for user in self.users.values():
            for connection, message_id in list(user.listeners):
                connection.subscriptions.pop(message_id, None)
            user.listeners.clear()

    async def mutate(self, user: UserProfiles, msg: dict[str, Any]) -> bytes:
        """Called with the user's lock held; commit only after disk confirms."""
        current = await user.async_load()
        updated, usage = await self.hass.async_add_executor_job(
            self._prepare_mutation, current, msg, self.limits, user.profile_revisions,
        )
        return await self._commit(user, updated, usage, msg["profile_id"])

    @staticmethod
    def _prepare_mutation(
        current: ProfileData, msg: dict[str, Any], limits: ResourceLimits,
        profile_revisions: dict[str, int],
    ) -> tuple[ProfileData, DocumentUsage]:
        """Validate/copy incoming data and account for quotas in a worker."""
        operation = msg["operation"]
        profile_id = msg["profile_id"]
        _require(operation in OPERATIONS)
        _require(_identifier(profile_id))
        # Reconcile only when the target profile has not changed since the
        # client's snapshot. Creation requires the collection revision.
        if operation != "reset_visibility":
            revision = msg.get("revision")
            _require(type(revision) is int and revision >= 0)
            required_revision = (
                current["revision"] if operation == "create"
                else profile_revisions.get(profile_id, current["revision"])
            )
            if not required_revision <= revision <= current["revision"]:
                raise ProfileError("conflict", "Profiles changed on another device. Keep your draft, or reload the saved profiles before retrying.")
        # Committed profiles are never mutated. Copy only the collection and
        # the replacement profile, retaining unrelated profiles.
        updated: ProfileData = {**current, "profiles": list(current["profiles"])}
        existing = next((item for item in updated["profiles"] if item["id"] == profile_id), None)
        if operation == "create":
            _require(existing is None, "This profile ID already exists.")
            profile = validate_profile(msg.get("profile"))
            _require(profile["id"] == profile_id)
            validate_written_profile(profile, None)
            updated["profiles"].append(profile)
        else:
            _require(existing is not None, "This profile no longer exists.")
            if operation == "delete":
                updated["profiles"] = [item for item in updated["profiles"] if item["id"] != profile_id]
            else:
                if operation == "reset_visibility":
                    # Derive this narrow recovery from the latest profile under
                    # the lock, preserving concurrent edits to every other field.
                    profile = {**existing, "settings": {
                        **existing["settings"], "visibility": "exclude", "routes": [],
                    }}
                else:
                    incoming = msg.get("profile")
                    if isinstance(incoming, dict) and "filters" in existing and "filters" not in incoming:
                        incoming = {**incoming, "filters": existing["filters"]}
                    profile = validate_profile(incoming)
                    _require(profile["id"] == profile_id)
                    validate_written_profile(profile, existing)
                    # A persisted custom ID cannot be moved to the other list.
                    if "filters" in profile:
                        for kind, other in (("states", "devices"), ("devices", "states")):
                            previous_ids = {item["id"] for item in existing["filters"][kind]} if "filters" in existing else DEFAULT_FILTER_IDS[kind]
                            previous_other_ids = {item["id"] for item in existing["filters"][other]} if "filters" in existing else DEFAULT_FILTER_IDS[other]
                            removed = previous_ids - {item["id"] for item in profile["filters"][kind]} - SYSTEM_FILTERS.keys()
                            added = {item["id"] for item in profile["filters"][other]} - previous_other_ids
                            _require(not removed & added, "Filter type cannot be changed.")
                updated["profiles"][updated["profiles"].index(existing)] = profile
        updated["revision"] += 1
        return updated, enforce_quotas(current, updated, limits)

    async def _commit(
        self, user: UserProfiles, updated: ProfileData, usage: DocumentUsage,
        profile_id: str | None,
    ) -> bytes:
        """Persist and publish with the user's lock held."""
        # Cancellation at any executor await must finish persistence and
        # publication before the caller releases the transaction's lock.
        save_task = asyncio.create_task(self._persist_and_publish(user, updated, usage, profile_id))
        try:
            return await asyncio.shield(save_task)
        except asyncio.CancelledError:
            await save_task
            raise

    async def _persist_and_publish(
        self, user: UserProfiles, updated: ProfileData, usage: DocumentUsage,
        profile_id: str | None,
    ) -> bytes:
        """Own the immutable transaction through disk confirmation and fanout."""
        try:
            await user.store.async_save(updated)
        finally:
            # A failed verification can follow a successful write. Reload disk
            # before another mutation can compare against an uncertain revision.
            user.data = None
        user.data = updated
        if profile_id is not None:
            if any(item["id"] == profile_id for item in updated["profiles"]):
                user.profile_revisions[profile_id] = updated["revision"]
            else:
                user.profile_revisions.pop(profile_id, None)
        return await self._publish(user, updated, usage)


async def async_register_profiles(hass: HomeAssistant) -> ProfileStore:
    """Set up the minimal API once per HA process."""
    manager = ProfileStore(hass, await async_get_instance_id(hass))
    websocket_api.async_register_command(hass, websocket_subscribe_profiles)
    websocket_api.async_register_command(hass, websocket_mutate_profile)
    return manager


def _manager(hass: HomeAssistant) -> ProfileStore:
    data = hass.data[DOMAIN]
    if data.entry_id is None:
        raise ProfileError("disabled", "Quick Access is disabled.")
    return data.profiles


@websocket_api.websocket_command({"type": f"{DOMAIN}/subscribe_profiles"})
@websocket_api.async_response
async def websocket_subscribe_profiles(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Subscribe and load under the same lock so changes cannot be missed."""
    try:
        manager = _manager(hass)
        user = manager.user(connection.user.id)
        async with user.lock:
            data = await user.async_load()
            _manager(hass)
            key = (connection, msg["id"])

            user.listeners[key] = connection.send_message
            connection.subscriptions[msg["id"]] = lambda: user.listeners.pop(key, None)
            try:
                _payload, events = await hass.async_add_executor_job(
                    manager._encode_snapshot, data, None, manager.limits, [msg["id"]],
                )
            except BaseException:
                connection.subscriptions.pop(msg["id"], None)
                user.listeners.pop(key, None)
                raise
            _manager(hass)
            if key not in user.listeners:
                return
            connection.send_result(msg["id"])
            connection.send_message(events[msg["id"]])
    except ProfileError as err:
        connection.send_error(msg["id"], err.code, str(err))
    except Exception:  # HA storage failures must be visible, never treated as empty data.
        _LOGGER.exception("Could not load Quick Access profiles")
        connection.send_error(msg["id"], "storage_error", "Could not load profiles. Saved data has not been reset; retry when the server is available.")


@websocket_api.websocket_command({
    "type": f"{DOMAIN}/mutate_profile",
    vol.Required("operation"): vol.In(OPERATIONS),
    vol.Required("profile_id"): str,
    vol.Optional("revision"): vol.All(int, vol.Range(min=0)),
    vol.Optional("profile"): dict,
})
@websocket_api.async_response
async def websocket_mutate_profile(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Serialize authenticated mutations, checking revisions for profile changes."""
    try:
        manager = _manager(hass)
        user = manager.user(connection.user.id)
        async with user.lock:
            _manager(hass)
            result = await manager.mutate(user, msg)
        response = await hass.async_add_executor_job(construct_result_message, msg["id"], result)
        connection.send_message(response)
    except ProfileError as err:
        connection.send_error(msg["id"], err.code, str(err))
    except Exception:
        _LOGGER.exception("Could not save Quick Access profile")
        connection.send_error(msg["id"], "storage_error", "Could not save changes on the server. Keep your draft and retry.")
