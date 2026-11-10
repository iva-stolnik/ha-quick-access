"""Exercise the real profile API and lock against HA/storage doubles."""

import asyncio
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, PropertyMock, patch

import test_integration as fixtures

integration = fixtures.integration
profiles = fixtures.profiles
EXTERNAL_URL_CASES = json.loads(Path(__file__).with_name("external-url-cases.json").read_text(encoding="utf-8"))
FILTER_COLOR_CASES = json.loads(Path(__file__).with_name("filter-color-cases.json").read_text(encoding="utf-8"))


def profile(profile_id="phone", name="Phone"):
    return {"id": profile_id, "name": name, "icon": "mdi:devices", "favorites": ["sensor.kitchen"],
        "categories": [{"id": "favorites", "name": "Favorites"}], "settings": {
        "visibility": "exclude",
        "routes": ["/config/*"], "links": [{
            "id": "logs", "name": "Logs", "type": "internal", "path": "/config/logs",
            "icon": "mdi:hammer", "color": "#abcdef", "group": "favorites",
        }],
    }}


def profile_with_bytes(size, profile_id="phone"):
    value = profile(profile_id)
    value["settings"]["links"][0]["path"] += "x" * (size - len(json.dumps(value).encode("utf-8")))
    return value


def saved_document():
    """A version 1 collection with populated profile settings."""
    document = {"version": 1, "revision": 37, "profiles": []}
    for index in range(4):
        item = profile(f"saved_{index}", f"Saved {index}")
        item["icon"] = "mdi:home"
        item["categories"].append({"id": "rooms", "name": "Rooms"})
        item["favorites"].append("light.bedroom")
        item["settings"].update(visibility="include",
                                routes=["/lovelace/*", "/config/logs"])
        item["settings"]["links"][0]["group"] = "rooms"
        document["profiles"].append(item)
    return document


def check_new_document(document):
    profiles.validate_document(document)
    profiles.enforce_quotas({"version": 1, "revision": 0, "profiles": []}, document, profiles.ResourceLimits())
    return document


def check_new_profile(value):
    profiles.validate_profile(value)
    check_new_document({"version": 1, "revision": 0, "profiles": [value]})
    return value


def saved_filter_profile(profile_id="phone"):
    value = profile(profile_id)
    system = [{"id": "all", "name": "All", "hidden": False}, {"id": "favorites", "name": "Favorites", "hidden": True}]
    value["filters"] = {"version": 1, "states": deepcopy(system) + [{"id": "issues", "name": "Issues", "hidden": False,
        "icon": "mdi:alert", "condition": {"type": "group", "operator": "and", "conditions": [
            {"type": "rule", "field": "name", "operator": "contains", "value": "problem"}]}}], "devices": deepcopy(system)}
    value["settings"]["links"].append({"id": "pin", "name": "Pinned issues", "icon": "mdi:pin", "color": "", "group": "favorites",
        "type": "saved-filter", "path": "", "filterKind": "states", "filterId": "issues"})
    return value


class ProfileValidationTests(unittest.TestCase):
    def test_group_grids_are_optional_bounded_and_preserved(self):
        original = profile()
        self.assertEqual(profiles.validate_profile(original), original)
        self.assertNotIn("grid", original["categories"][0])
        value = deepcopy(original)
        value["categories"][0]["grid"] = {"columns": 7, "rows": 2, "hideNames": True}
        value["categories"].append({"id": "rooms", "name": "Rooms", "grid": {"columns": 4, "rows": 3, "hideNames": False}})
        validated = profiles.validate_profile(value)
        self.assertEqual(validated, value)
        validated["categories"][0]["grid"]["columns"] = 1
        self.assertEqual(value["categories"][0]["grid"]["columns"], 7)
        invalid_grids = [None, [], {}, {"columns": 4}, {"rows": 2}, {"columns": 4, "rows": 2, "extra": 1}]
        for invalid in (None, 0, 1, "true", [], {}):
            invalid_grids.append({"columns": 4, "rows": 2, "hideNames": invalid})
        for dimension in ("columns", "rows"):
            for invalid in (True, False, 0, -1, 1.5, "4", None, profiles.MAX_SHORTCUT_GRID_DIMENSION + 1):
                invalid_grids.append({"columns": 4, "rows": 2, dimension: invalid})
        for grid in invalid_grids:
            invalid = deepcopy(value)
            invalid["categories"][0]["grid"] = grid
            with self.subTest(grid=grid), self.assertRaises(profiles.ProfileError):
                profiles.validate_profile(invalid)
        value["categories"][0]["grid"] = {"columns": 1, "rows": profiles.MAX_SHORTCUT_GRID_DIMENSION}
        self.assertEqual(profiles.validate_profile(value), value)
        self.assertEqual(profiles.MAX_SHORTCUT_GRID_DIMENSION, 10)
        value["categories"][0]["grid"] = {"columns": 10, "rows": 10}
        self.assertEqual(profiles.validate_profile(value), value)
        for dimension in ("columns", "rows"):
            invalid = deepcopy(value)
            invalid["categories"][0]["grid"][dimension] = 11
            with self.subTest(dimension=dimension), self.assertRaises(profiles.ProfileError) as error:
                profiles.validate_profile(invalid)
            self.assertIn("1 to 10", str(error.exception))

    def test_shortcut_visibility_is_optional_and_requires_a_boolean(self):
        for make_profile in (profile, saved_filter_profile):
            value = make_profile()
            self.assertEqual(profiles.validate_profile(value), value)
            for hidden in (True, False):
                with self.subTest(saved_filter=make_profile == saved_filter_profile, hidden=hidden):
                    changed = deepcopy(value)
                    for link in changed["settings"]["links"]:
                        link["hidden"] = hidden
                    self.assertEqual(profiles.validate_profile(changed), changed)
            for hidden in (None, 0, 1, "true", {}, []):
                with self.subTest(saved_filter=make_profile == saved_filter_profile, hidden=hidden):
                    changed = deepcopy(value)
                    changed["settings"]["links"][-1]["hidden"] = hidden
                    with self.assertRaises(profiles.ProfileError):
                        profiles.validate_profile(changed)

    def test_saved_filter_references_are_bounded_and_resolve_in_their_own_profile_and_kind(self):
        value = saved_filter_profile()
        value["filters"]["states"][-1]["templateId"] = "unknown"
        self.assertEqual(profiles.validate_profile(value), value)
        value["filters"]["states"][-1]["hidden"] = True
        self.assertEqual(profiles.validate_profile(value), value)
        for kind in ("states", "devices"):
            for filter_id in ("all", "favorites"):
                system = deepcopy(value)
                system["settings"]["links"][-1].update(filterKind=kind, filterId=filter_id)
                self.assertEqual(profiles.validate_profile(system), system)
                del system["filters"]
                self.assertEqual(profiles.validate_profile(system), system)
        for change in ({"filterId": "missing"}, {"filterId": "temporary"}, {"filterId": []}, {"filterKind": "other"},
                       {"filterKind": "devices"}, {"filterKind": []}, {"path": "/config"}, {"rules": []}, {"type": "quick-states"}):
            invalid = deepcopy(value)
            invalid["settings"]["links"][-1].update(change)
            with self.subTest(change=change), self.assertRaises(profiles.ProfileError):
                profiles.validate_profile(invalid)
        for icon in (None, "javascript:alert", "mdi:Bad", "mdi:" + "x" * 60):
            invalid = deepcopy(value)
            invalid["filters"]["states"][-1]["icon"] = icon
            with self.subTest(icon=icon), self.assertRaises(profiles.ProfileError):
                profiles.validate_profile(invalid)
        for template_id in (None, [], "missing", "assigned", "all"):
            invalid = deepcopy(value)
            invalid["filters"]["states"][-1]["templateId"] = template_id
            with self.subTest(template_id=template_id), self.assertRaises(profiles.ProfileError):
                profiles.validate_profile(invalid)

    def test_optional_filter_colors_preserve_supported_formats_and_reject_invalid_values(self):
        for kind in ("states", "devices"):
            for color in FILTER_COLOR_CASES["valid"]:
                value = saved_filter_profile()
                for item in value["filters"][kind]:
                    item["color"] = color
                with self.subTest(kind=kind, color=color):
                    self.assertEqual(profiles.validate_profile(value), value)
            for color in [*FILTER_COLOR_CASES["invalid"], " " * 257, "var(--" + "x" * 250 + ")"]:
                value = saved_filter_profile()
                value["filters"][kind][-1]["color"] = color
                with self.subTest(kind=kind, color=color), self.assertRaises(profiles.ProfileError):
                    profiles.validate_profile(value)

    def test_low_battery_thresholds_are_optional_bounded_and_specific_to_battery_rules(self):
        value = saved_filter_profile()
        condition = value["filters"]["states"][-1]["condition"]
        battery = {"type": "rule", "field": "smart", "operator": "equals", "value": "low_battery"}
        condition["conditions"] = [battery]
        self.assertEqual(profiles.validate_profile(value), value)
        for threshold in (0, 10, 15, 15.5, 20, 100):
            battery["threshold"] = threshold
            with self.subTest(threshold=threshold):
                self.assertEqual(profiles.validate_profile(value), value)
        for threshold in (None, True, False, "15", [], {}, -1, 100.01, float("nan"), float("inf")):
            battery["threshold"] = threshold
            with self.subTest(threshold=threshold), self.assertRaises(profiles.ProfileError):
                profiles.validate_profile(value)
        battery["threshold"] = 15
        for field, expected in (("smart", "unknown"), ("state", "low_battery")):
            battery.update(field=field, value=expected)
            with self.subTest(field=field), self.assertRaises(profiles.ProfileError):
                profiles.validate_profile(value)
        battery.update(field="smart", value="low_battery")
        value["filters"]["devices"].append(value["filters"]["states"].pop())
        value["settings"]["links"][-1]["filterKind"] = "devices"
        with self.assertRaises(profiles.ProfileError):
            profiles.validate_profile(value)
        device_condition = value["filters"]["devices"][-1]["condition"]
        device_condition["conditions"] = [{"type": "entities", "quantifier": "any",
                                           "condition": {"type": "group", "operator": "and", "conditions": [battery]}}]
        self.assertEqual(profiles.validate_profile(value), value)

    def test_not_filter_groups_validate_and_preserve_the_existing_limits(self):
        system = [{"id": "all", "name": "All", "hidden": False}, {"id": "favorites", "name": "Favorites", "hidden": False}]
        rule = {"type": "rule", "field": "name", "operator": "equals", "value": "Excluded"}
        group = {"type": "group", "operator": "not", "conditions": [rule]}
        value = {**profile(), "filters": {"version": 1, **{kind: deepcopy(system) + [
            {"id": "excluded", "name": "Excluded", "hidden": False, "condition": deepcopy(group)}
        ] for kind in ("states", "devices")}}}
        self.assertEqual(profiles.validate_profile(value), value)
        for operator, conditions in (("not", []), ("not", [deepcopy(rule) for _ in range(11)]), ("xor", [rule])):
            invalid = deepcopy(value)
            invalid["filters"]["states"][-1]["condition"].update(operator=operator, conditions=conditions)
            with self.subTest(operator=operator, count=len(conditions)), self.assertRaises(profiles.ProfileError):
                profiles.validate_profile(invalid)

    def test_filter_defaults_reference_their_own_collection(self):
        system = [{"id": "all", "name": "All", "hidden": False}, {"id": "favorites", "name": "Favorites", "hidden": False}]
        value = {**profile(), "filters": {"version": 1, "states": deepcopy(system), "devices": deepcopy(system),
            "defaults": {"states": "favorites", "devices": "all"}}}
        self.assertEqual(profiles.validate_profile(value), value)
        value["filters"]["defaults"] = {"states": "all"}
        self.assertEqual(profiles.validate_profile(value), value)
        for defaults in (None, [], "all", {"states": None}, {"states": 1}, {"states": []},
                         {"states": "missing"}, {"devices": "temporary"}, {"other": "all"}):
            invalid = deepcopy(value)
            invalid["filters"]["defaults"] = defaults
            with self.subTest(defaults=defaults), self.assertRaisesRegex(profiles.ProfileError, "Invalid filter definitions"):
                profiles.validate_profile(invalid)

    def test_filter_validation_is_bounded_and_protects_system_entries(self):
        system = [{"id": "all", "name": "All", "hidden": False}, {"id": "favorites", "name": "Favorites", "hidden": True}]
        rule = {"type": "rule", "field": "state", "operator": "any_of", "value": ["unknown", "unavailable"]}
        group = {"type": "group", "operator": "or", "conditions": [rule]}
        value = {**profile(), "filters": {"version": 1, "states": deepcopy(system), "devices": deepcopy(system) + [
            {"id": "issues", "name": "Issues", "hidden": False, "condition": {"type": "group", "operator": "and", "conditions": [
                {"type": "entities", "quantifier": "any", "condition": group}]}}]}}
        self.assertEqual(profiles.validate_profile(value), value)
        invalid = []
        for change in ("rename", "delete", "results", "executable", "wrong_scope", "too_many", "deep", "duplicate", "oversize", "payload"):
            item = deepcopy(value)
            filters = item["filters"]
            if change == "rename": filters["states"][0]["name"] = "Other"
            elif change == "delete": filters["states"].pop(0)
            elif change == "results": filters["devices"][2]["matches"] = ["sensor.kitchen"]
            elif change == "executable": filters["devices"][2]["condition"]["conditions"][0]["condition"]["conditions"][0]["operator"] = "jinja"
            elif change == "wrong_scope": filters["states"].append(deepcopy(filters["devices"][2]))
            elif change == "too_many":
                filters["states"] += [{"id": f"custom_{i}", "name": f"Custom {i}", "hidden": False, "condition": deepcopy(group)} for i in range(11)]
            elif change == "deep":
                nested = deepcopy(group)
                for _ in range(3): nested = {"type": "group", "operator": "and", "conditions": [nested]}
                filters["devices"][2]["condition"] = nested
            elif change == "duplicate": filters["devices"][2]["name"] = "ALL"
            elif change == "payload":
                for kind in ("states", "devices"):
                    filters[kind] = deepcopy(system) + [{"id": f"custom_{i}", "name": f"Custom {i}", "hidden": False,
                        "condition": {"type": "group", "operator": "and", "conditions": [
                            {"type": "rule", "field": "name", "operator": "equals", "value": "x" * 256} for _ in range(10)]}} for i in range(10)]
            else: filters["devices"][2]["condition"]["conditions"] = [{"type": "rule", "field": "name", "operator": "equals", "value": "x" * 257}]
            invalid.append(item)
        for kind in ("states", "devices"):
            item = deepcopy(value)
            item["filters"][kind].append({"id": "disabled", "name": "Disabled", "hidden": False,
                "condition": {"type": "group", "operator": "and", "conditions": [
                    {"type": "rule", "field": "disabled_by", "operator": "equals", "value": "user"}]}})
            invalid.append(item)
        for item in invalid:
            with self.subTest(item=item), self.assertRaisesRegex(profiles.ProfileError, "Invalid filter definitions"):
                profiles.validate_profile(item)

    def test_external_urls_match_shared_browser_cases_without_rewriting(self):
        for valid, paths in EXTERNAL_URL_CASES.items():
            for path in paths:
                with self.subTest(valid=valid, path=path):
                    value = profile()
                    value["settings"]["links"][0].update(type="external", path=path)
                    before = deepcopy(value)
                    if valid == "valid":
                        self.assertEqual(profiles.validate_profile(value), before)
                    else:
                        with self.assertRaises(profiles.ProfileError) as error:
                            profiles.validate_profile(value)
                        self.assertEqual(error.exception.code, "invalid_data")
                        self.assertEqual(str(error.exception), "Invalid shortcut URL.")
                    self.assertEqual(value, before)

    def test_device_shortcuts_and_optional_favorites(self):
        value = profile()
        value["settings"]["links"][0].update(type="quick-devices", path="")
        value["device_favorites"] = ["a123", "device-2"]
        self.assertEqual(profiles.validate_profile(value), value)
        self.assertEqual(profiles.validate_profile(value)["favorites"], ["sensor.kitchen"])
        for invalid in (None, "a123", ["a123", "a123"], [7], [""], ["a/b"], ["x" * 101]):
            with self.subTest(invalid=invalid), self.assertRaises(profiles.ProfileError):
                profiles.validate_profile({**value, "device_favorites": invalid})
        value["device_favorites"] = [f"device_{index}" for index in range(profiles.MAX_ITEMS)]
        self.assertEqual(profiles.validate_profile(value), value)
        value["device_favorites"].append("too_many")
        with self.assertRaises(profiles.ProfileError):
            profiles.validate_profile(value)

    def test_scene_shortcuts_require_a_single_scene_entity_id(self):
        value = profile()
        value["settings"]["links"][0].update(type="scene", path="scene.evening")
        self.assertEqual(profiles.validate_profile(value), value)
        for path in ("", "scene.", "light.desk", "scene.all,scene.other", "scene.bad/name", "scene.UPPER", "scene.name\n", None, []):
            invalid = deepcopy(value)
            invalid["settings"]["links"][0]["path"] = path
            with self.subTest(path=path), self.assertRaises(profiles.ProfileError):
                profiles.validate_profile(invalid)

    def test_document_validation_preserves_data_without_mutating_input(self):
        document = saved_document()
        before = deepcopy(document)
        validated = profiles.validate_document(document)
        self.assertEqual(validated, before)
        validated["profiles"][0]["settings"]["routes"].clear()
        self.assertEqual(document, before)

    def test_document_validation_rejects_invalid_fields(self):
        invalid_documents = []
        for change in (
            lambda item: item["settings"].update(unexpected=True),
            lambda item: item["settings"].update(position=1024),
            lambda item: item["settings"].update(routes=["invalid"]),
            lambda item: item["settings"].pop("links"),
            lambda item: item.update(icon="invalid"),
            lambda item: item["categories"].clear(),
            lambda item: item.update(favorites=["invalid"]),
            lambda item: item["settings"]["links"][0].update(group="missing"),
        ):
            invalid = saved_document()
            change(invalid["profiles"][0])
            invalid_documents.append(invalid)
        for key, value in (("version", 2), ("revision", -1), ("unexpected", True)):
            invalid_documents.append({**saved_document(), key: value})
        for invalid in invalid_documents:
            with self.subTest(document=invalid), self.assertRaises(profiles.ProfileError):
                profiles.validate_document(invalid)

    def test_optional_profile_color_accepts_strings_and_rejects_other_types(self):
        for color in ("", "#8e24aa", "red", "rgb(12, 34, 56)"):
            with self.subTest(color=color):
                value = {**profile(), "color": color}
                self.assertEqual(profiles.validate_profile(value), value)
        for color in (None, 7, {}, []):
            with self.subTest(color=color), self.assertRaises(profiles.ProfileError):
                profiles.validate_profile({**profile(), "color": color})

    def test_valid_visibility_route_combinations(self):
        for visibility, routes in (
            ("include", ["/lovelace/*"]),
            ("exclude", []),
            ("exclude", ["/config/*"]),
        ):
            with self.subTest(visibility=visibility, routes=routes):
                value = profile()
                value["settings"].update(visibility=visibility, routes=routes)
                self.assertEqual(profiles.validate_profile(value), value)

    def test_profile_and_category_count_boundaries(self):
        document = {"version": 1, "revision": 0, "profiles": [
            profile(f"profile_{index}") for index in range(profiles.MAX_PROFILES)
        ]}
        self.assertEqual(check_new_document(document), document)
        document["profiles"].append(profile("extra"))
        with self.assertRaisesRegex(profiles.ProfileError, "Profile limit reached"):
            check_new_document(document)

        value = profile()
        value["categories"].extend(
            {"id": f"category_{index}", "name": f"Category {index}"}
            for index in range(profiles.MAX_CATEGORIES - 1)
        )
        self.assertEqual(check_new_profile(value), value)
        value["categories"].append({"id": "extra", "name": "Extra"})
        with self.assertRaisesRegex(profiles.ProfileError, "Group limit reached"):
            check_new_profile(value)

    def test_profile_byte_boundary_includes_encoded_unicode(self):
        value = profile_with_bytes(profiles.MAX_PROFILE_BYTES)
        self.assertEqual(check_new_profile(value), value)
        value["settings"]["links"][0]["path"] += "x"
        with self.assertRaisesRegex(profiles.ProfileError, "Storage limit reached"):
            check_new_profile(value)

        value = profile_with_bytes(profiles.MAX_PROFILE_BYTES - 2)
        value["settings"]["links"][0]["path"] += "ž"
        self.assertLess(len(json.dumps(value, ensure_ascii=False)), profiles.MAX_PROFILE_BYTES)
        with self.assertRaisesRegex(profiles.ProfileError, "Storage limit reached"):
            check_new_profile(value)

    def test_user_byte_boundary_includes_document_metadata(self):
        document = {"version": 1, "revision": 1, "profiles": [
            profile_with_bytes(profiles.MAX_PROFILE_BYTES, f"profile_{index}")
            for index in range(3)
        ]}
        last = profile("last")
        document["profiles"].append(last)
        last["settings"]["links"][0]["path"] += "x" * (
            profiles.MAX_USER_BYTES - len(json.dumps(document).encode("utf-8"))
        )
        self.assertLess(len(json.dumps(last).encode("utf-8")), profiles.MAX_PROFILE_BYTES)
        self.assertEqual(check_new_document(document), document)
        last["settings"]["links"][0]["path"] += "x"
        with self.assertRaisesRegex(profiles.ProfileError, "Total storage limit reached"):
            check_new_document(document)


class Connection:
    def __init__(self, user="alice"):
        self.user = SimpleNamespace(id=user)
        self.subscriptions = {}
        self.send_result = Mock()
        self.send_error = Mock()
        self.send_event = Mock()
        self.send_message = Mock(side_effect=self.receive_message)

    def receive_message(self, payload):
        """Decode a real pre-encoded envelope as an independent WS receiver."""
        message = json.loads(payload)
        if message["type"] == "event":
            self.send_event(message["id"], message["event"])
        else:
            assert message["type"] == "result" and message["success"] is True
            self.send_result(message["id"], message["result"])


class ProfileTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        # Share lifecycle doubles without inheriting/re-running its test cases.
        fixture = fixtures.IntegrationTests()
        fixture.setUp()
        self.hass = fixture.hass
        self.entry = fixture.entry
        self.alice = Connection()
        self.bob = Connection("bob")

    async def asyncSetUp(self):
        await integration.async_setup(self.hass, {})
        await integration.async_setup_entry(self.hass, self.entry)
        self.manager = self.hass.data["quick_access"].profiles

    async def mutate(self, connection=None, operation="create", value=None, revision=None, **extra):
        connection = connection or self.alice
        value = value or profile()
        if revision is None and operation != "reset_visibility":
            user = self.manager.user(connection.user.id)
            revision = (await user.async_load())["revision"]
        message = {"id": 12, "operation": operation, "profile_id": value["id"], **extra}
        if revision is not None:
            message["revision"] = revision
        if operation not in ("delete", "reset_visibility"):
            message["profile"] = value
        connection.send_result.reset_mock()
        connection.send_error.reset_mock()
        await profiles.websocket_mutate_profile(self.hass, connection, message)
        return connection

    async def subscribe(self, connection, message_id=7):
        await profiles.websocket_subscribe_profiles(self.hass, connection, {"id": message_id})

    async def test_filter_colors_round_trip_through_profile_storage(self):
        value = saved_filter_profile()
        value["filters"]["states"][-1]["color"] = "#8e24aa"
        value["filters"]["devices"][-1]["color"] = "teal"
        await self.mutate(value=value)
        self.alice.send_error.assert_not_called()
        user = self.manager.user("alice")
        self.assertEqual(user.data["profiles"][0]["filters"], value["filters"])
        self.assertEqual(self.hass.data["test_storage"][user.store.key]["profiles"][0]["filters"], value["filters"])
        user.data = None
        self.assertEqual((await user.async_load())["profiles"][0]["filters"], value["filters"])

    async def test_low_battery_threshold_round_trips_through_profile_storage(self):
        value = saved_filter_profile()
        value["filters"]["states"][-1]["condition"]["conditions"] = [
            {"type": "rule", "field": "smart", "operator": "equals", "value": "low_battery", "threshold": 15.5}]
        await self.mutate(value=value)
        self.alice.send_error.assert_not_called()
        user = self.manager.user("alice")
        self.assertEqual(user.data["profiles"][0]["filters"], value["filters"])
        self.assertEqual(self.hass.data["test_storage"][user.store.key]["profiles"][0]["filters"], value["filters"])
        user.data = None
        self.assertEqual((await user.async_load())["profiles"][0]["filters"], value["filters"])

    async def test_not_filter_groups_round_trip_through_profile_storage(self):
        value = saved_filter_profile()
        value["filters"]["states"][-1]["condition"]["operator"] = "not"
        await self.mutate(value=value)
        self.alice.send_error.assert_not_called()
        user = self.manager.user("alice")
        self.assertEqual(user.data["profiles"][0]["filters"], value["filters"])
        self.assertEqual(self.hass.data["test_storage"][user.store.key]["profiles"][0]["filters"], value["filters"])
        user.data = None
        self.assertEqual((await user.async_load())["profiles"][0]["filters"], value["filters"])

    async def test_filter_deletion_requires_atomic_shortcut_removal_and_preserves_data_on_conflict_or_failure(self):
        value = saved_filter_profile()
        await self.mutate(value=value)
        await self.subscribe(self.alice)
        user = self.manager.user("alice")
        before = deepcopy(user.data)
        deleted = deepcopy(value)
        deleted["filters"]["states"].pop()
        await self.mutate(operation="update", value=deleted)
        self.assertEqual(self.alice.send_error.call_args.args[1], "invalid_data")
        self.assertEqual(user.data, before)
        deleted["settings"]["links"].pop()
        await self.mutate(operation="update", value=deleted, revision=0)
        self.assertEqual(self.alice.send_error.call_args.args[1], "conflict")
        self.assertEqual(user.data, before)
        self.alice.send_event.reset_mock()
        with patch.object(user.store, "async_save", new=AsyncMock(side_effect=OSError("disk full"))):
            with self.assertLogs(profiles._LOGGER, level="ERROR"):
                await self.mutate(operation="update", value=deleted)
        self.assertEqual(self.alice.send_error.call_args.args[1], "storage_error")
        self.alice.send_event.assert_not_called()
        self.assertEqual(await user.async_load(), before)
        self.assertEqual(self.hass.data["test_storage"][user.store.key], before)
        with patch.object(user.store, "async_save", wraps=user.store.async_save) as save:
            await self.mutate(operation="update", value=deleted)
        self.alice.send_error.assert_not_called()
        save.assert_awaited_once()
        self.assertEqual(user.data["revision"], before["revision"] + 1)
        self.assertEqual(user.data["profiles"], [deleted])
        self.assertEqual(self.alice.send_event.call_args.args[1]["profiles"], [deleted])

    async def test_filter_ids_and_independent_shortcut_metadata_survive_updates_and_profile_duplication(self):
        original = saved_filter_profile()
        await self.mutate(value=original)
        copied = deepcopy(original)
        copied.update(id="copy", name="Copy")
        await self.mutate(value=copied)
        changed = deepcopy(copied)
        changed["filters"]["states"][-1].update(name="Renamed", icon="mdi:star", hidden=True)
        changed["filters"]["states"][-1]["condition"]["conditions"][0]["value"] = "changed"
        await self.mutate(operation="update", value=changed)
        self.alice.send_error.assert_not_called()
        saved = await self.manager.user("alice").async_load()
        self.assertEqual(saved["profiles"], [original, changed])
        self.assertEqual(changed["settings"]["links"][-1], original["settings"]["links"][-1])
        self.assertEqual(changed["filters"]["states"][-1]["id"], "issues")
        moved = deepcopy(changed)
        moved["filters"]["devices"].append(moved["filters"]["states"].pop())
        moved["settings"]["links"][-1]["filterKind"] = "devices"
        await self.mutate(operation="update", value=moved)
        self.assertEqual(self.alice.send_error.call_args.args[1], "invalid_data")
        self.assertEqual((await self.manager.user("alice").async_load())["profiles"], [original, changed])

    async def test_invalid_external_urls_cannot_create_or_replace_saved_shortcuts(self):
        await self.mutate()
        await self.subscribe(self.alice)
        self.alice.send_event.reset_mock()
        user = self.manager.user("alice")
        before = deepcopy(user.data)
        with patch.object(user.store, "async_save", new=AsyncMock()) as save:
            for operation in ("create", "update"):
                for path in EXTERNAL_URL_CASES["invalid"]:
                    with self.subTest(operation=operation, path=path):
                        value = profile("new" if operation == "create" else "phone")
                        value["settings"]["links"][0].update(type="external", path=path)
                        await self.mutate(operation=operation, value=value)
                        self.assertEqual(self.alice.send_error.call_args.args[1], "invalid_data")
                        self.alice.send_result.assert_not_called()
                        self.alice.send_event.assert_not_called()
                        save.assert_not_awaited()
                        self.assertEqual(user.data, before)
                        self.assertEqual(self.hass.data["test_storage"][user.store.key], before)

    async def test_supported_external_urls_survive_save_reload_and_subscription(self):
        value = profile()
        template = value["settings"]["links"][0]
        value["settings"]["links"] = [
            {**template, "id": f"url_{index}", "type": "external", "path": path}
            for index, path in enumerate(EXTERNAL_URL_CASES["valid"])
        ]
        before = deepcopy(value)
        await self.mutate(value=value)
        self.alice.send_error.assert_not_called()
        self.assertEqual(self.alice.send_result.call_args.args[1]["profiles"], [before])
        user = self.manager.user("alice")
        self.assertEqual((await user.store.async_load())["profiles"], [before])
        user.data = None
        await self.subscribe(self.alice)
        self.assertEqual(self.alice.send_event.call_args.args[1]["profiles"], [before])
        self.assertEqual(value, before)

    async def test_mutation_builds_one_snapshot_and_reuses_quota_accounting(self):
        await self.mutate()
        clients = [self.alice, Connection(), Connection()]
        for client in clients:
            await self.subscribe(client)
            client.send_event.reset_mock()
        changed = {**profile(), "favorites": ["light.bedroom"], "device_favorites": ["device_a"]}
        with patch.object(self.manager, "snapshot", wraps=self.manager.snapshot) as snapshot, \
                patch.object(profiles, "encoded_size", wraps=profiles.encoded_size) as size:
            await self.mutate(operation="update", value=changed)
        snapshot.assert_called_once()
        # One profile and one document encode; previous usage is only needed
        # when the updated resource is over quota.
        self.assertEqual(size.call_count, 2)
        result = self.alice.send_result.call_args.args[1]
        for client in clients:
            client.send_event.assert_called_once_with(7, result)
            self.assertIsNot(client.send_event.call_args.args[1], result)
        self.assertEqual(result["usage"], profiles.document_usage(self.manager.user("alice").data))
        self.assertEqual((await self.manager.user("alice").store.async_load())["profiles"], [changed])

    async def test_profile_cpu_work_runs_in_workers_and_sends_run_on_loop(self):
        await self.mutate()
        await self.mutate(value=profile("tablet"))
        await self.subscribe(self.alice)
        user = self.manager.user("alice")
        previous = user.data
        loop_thread = threading.get_ident()
        self.assertFalse(user.store.options["serialize_in_event_loop"])

        def in_worker(function):
            def checked(*args, **kwargs):
                self.assertNotEqual(threading.get_ident(), loop_thread)
                return function(*args, **kwargs)
            return checked

        def receive(payload):
            self.assertEqual(threading.get_ident(), loop_thread)
            self.assertIsInstance(payload, bytes)
            self.alice.receive_message(payload)

        self.alice.send_message.side_effect = receive
        with patch.object(profiles, "validate_profile", side_effect=in_worker(profiles.validate_profile)), \
                patch.object(profiles, "deepcopy", side_effect=in_worker(profiles.deepcopy)), \
                patch.object(profiles, "encoded_size", side_effect=in_worker(profiles.encoded_size)), \
                patch.object(profiles, "json_bytes", side_effect=in_worker(profiles.json_bytes)), \
                patch.object(profiles, "_confirm_storage", side_effect=in_worker(profiles._confirm_storage)), \
                patch.object(self.manager, "snapshot", side_effect=in_worker(self.manager.snapshot)), \
                patch.object(profiles, "construct_event_message", side_effect=in_worker(profiles.construct_event_message)), \
                patch.object(profiles, "construct_result_message", side_effect=in_worker(profiles.construct_result_message)):
            await self.mutate(operation="update", value=profile(name="Changed"))
            await self.manager.notify_limits()
        self.alice.send_error.assert_not_called()
        self.assertIs(user.data["profiles"][1], previous["profiles"][1])
        self.assertEqual(previous["profiles"][0]["name"], "Phone")
        self.assertEqual(user.data["profiles"][0]["name"], "Changed")

    async def test_cancellation_during_encoding_finishes_publication_under_lock(self):
        await self.mutate()
        await self.subscribe(self.alice)
        self.alice.send_event.reset_mock()
        user = self.manager.user("alice")
        entered, release = threading.Event(), threading.Event()
        encode = self.manager._encode_snapshot

        def slow_encode(*args):
            entered.set()
            if not release.wait(5):
                raise TimeoutError("Test did not release encoding")
            return encode(*args)

        with patch.object(self.manager, "_encode_snapshot", side_effect=slow_encode):
            request = asyncio.create_task(self.mutate(operation="update", value=profile(name="Committed")))
            try:
                self.assertTrue(await asyncio.to_thread(entered.wait, 5))
                request.cancel()
                await asyncio.sleep(0)
                self.assertTrue(user.lock.locked())
                self.assertFalse(request.done())
                self.alice.send_event.assert_not_called()
            finally:
                release.set()
            with self.assertRaises(asyncio.CancelledError):
                await request
        self.assertEqual(user.data["revision"], 2)
        self.assertEqual(await user.store.async_load(), user.data)
        self.alice.send_event.assert_called_once()
        self.alice.send_result.assert_not_called()
        self.assertFalse(user.lock.locked())

    async def test_unload_during_encoding_drops_queued_subscriber_events(self):
        await self.mutate()
        await self.subscribe(self.alice)
        self.alice.send_event.reset_mock()
        entered, release = threading.Event(), threading.Event()
        encode = self.manager._encode_snapshot

        def slow_encode(*args):
            entered.set()
            if not release.wait(5):
                raise TimeoutError("Test did not release encoding")
            return encode(*args)

        with patch.object(self.manager, "_encode_snapshot", side_effect=slow_encode):
            update = asyncio.create_task(self.manager.notify_limits())
            try:
                self.assertTrue(await asyncio.to_thread(entered.wait, 5))
                self.manager.close_subscriptions()
            finally:
                release.set()
            await update
        self.alice.send_event.assert_not_called()
        self.assertEqual(self.alice.subscriptions, {})
        self.assertEqual(self.manager.user("alice").listeners, {})

    async def test_failed_initial_encoding_cleans_up_subscription(self):
        with patch.object(self.manager, "_encode_snapshot", side_effect=TypeError("Cannot encode")), \
                self.assertLogs(profiles._LOGGER, level="ERROR"):
            await self.subscribe(self.alice)
        self.assertEqual(self.alice.subscriptions, {})
        self.assertEqual(self.manager.user("alice").listeners, {})
        self.alice.send_result.assert_not_called()
        self.alice.send_event.assert_not_called()
        self.assertEqual(self.alice.send_error.call_args.args[1], "storage_error")

    async def test_subscriber_mutation_and_failure_cannot_affect_other_payloads_or_storage(self):
        await self.mutate()
        other = Connection()
        await self.subscribe(self.alice)
        await self.subscribe(other)
        original_event = other.send_event.call_args.args[1]
        original_snapshot = deepcopy(original_event)

        def damage_payload(message_id, payload):
            payload["profiles"][0]["settings"]["routes"].clear()
            payload["profiles"][0]["favorites"].clear()
            payload["limits"].clear()
            payload["usage"]["by_profile"].clear()
            raise RuntimeError("Subscriber failed after modifying its payload")

        self.alice.send_event.side_effect = damage_payload
        changed = {**profile(), "device_favorites": ["device_a"]}
        with self.assertLogs(profiles._LOGGER, level="ERROR"):
            await self.mutate(operation="update", value=changed)
        result = self.alice.send_result.call_args.args[1]
        event = other.send_event.call_args.args[1]
        expected = deepcopy(result)
        self.assertEqual(event, expected)
        self.assertEqual(event["profiles"], [changed])
        self.assertEqual(original_event, original_snapshot)
        result["profiles"][0]["device_favorites"].clear()
        result["limits"].clear()
        result["usage"]["by_profile"].clear()
        self.assertEqual(event, expected)
        user = self.manager.user("alice")
        self.assertEqual(user.data["profiles"], [changed])
        self.assertEqual(await user.store.async_load(), user.data)
        self.alice.send_event.side_effect = None
        await self.mutate(operation="update", value=profile(name="Later revision"))
        self.assertEqual(event, expected)
        self.assertEqual(original_event, original_snapshot)

    async def test_limits_fanout_builds_one_isolated_snapshot_without_advancing_revision(self):
        await self.mutate()
        other = Connection()
        await self.subscribe(self.alice)
        await self.subscribe(other)
        # A user without subscriptions does not need quota accounting.
        await self.manager.user("idle").async_load()
        user = self.manager.user("alice")
        before = deepcopy(user.data)
        self.entry.options = {"max_categories": 30}
        with patch.object(self.manager, "snapshot", wraps=self.manager.snapshot) as snapshot:
            await self.manager.notify_limits()
        snapshot.assert_called_once()
        left = self.alice.send_event.call_args.args[1]
        right = other.send_event.call_args.args[1]
        self.assertEqual(left, right)
        self.assertEqual(left["limits"]["max_categories"], 30)
        self.assertEqual(left["revision"], before["revision"])
        left["profiles"].clear()
        left["limits"].clear()
        left["usage"]["by_profile"].clear()
        self.assertEqual(right, self.manager.snapshot(before))
        self.assertEqual(user.data, before)
        self.assertEqual(await user.store.async_load(), before)

    async def test_limits_snapshot_failure_does_not_interrupt_other_users(self):
        await self.mutate()
        await self.subscribe(self.alice)
        await self.mutate(connection=self.bob)
        await self.subscribe(self.bob)
        self.alice.send_event.reset_mock()
        self.bob.send_event.reset_mock()
        snapshot = self.manager.snapshot
        alice = self.manager.user("alice")

        def fail_for_alice(data, usage=None, limits=None):
            if data is alice.data:
                raise TypeError("Cannot serialize")
            return snapshot(data, usage, limits)

        self.entry.options = {"max_categories": 30}
        with patch.object(self.manager, "snapshot", side_effect=fail_for_alice), \
                self.assertLogs(profiles._LOGGER, level="ERROR"):
            await self.manager.notify_limits()
        self.alice.send_event.assert_not_called()
        self.bob.send_event.assert_called_once_with(7, snapshot(self.manager.user("bob").data))
        self.assertEqual(alice.data["revision"], 1)

    async def test_snapshot_remains_consistent_when_input_and_limits_change_during_save(self):
        await self.mutate()
        await self.subscribe(self.alice)
        user = self.manager.user("alice")
        entered, finish = asyncio.Event(), asyncio.Event()
        save = user.store.async_save

        async def slow_save(data):
            entered.set()
            await finish.wait()
            await save(data)

        user.store.async_save = slow_save
        changed = {**profile(), "device_favorites": ["device_a"]}
        expected = deepcopy(changed)
        request = asyncio.create_task(self.mutate(operation="update", value=changed))
        await entered.wait()
        try:
            changed["favorites"].clear()
            changed["device_favorites"].clear()
            changed["settings"]["routes"].clear()
            self.entry.options = {"max_categories": 30}
            limit_update = asyncio.create_task(self.manager.notify_limits())
            await asyncio.sleep(0)
            self.assertFalse(limit_update.done())
            pending = self.alice.send_event.call_args.args[1]
            self.assertEqual(pending["revision"], 1)
        finally:
            finish.set()
            await request
            await limit_update
        result = self.alice.send_result.call_args.args[1]
        self.assertEqual(result, self.alice.send_event.call_args.args[1])
        self.assertEqual(result["profiles"], [expected])
        self.assertEqual(result["revision"], 2)
        self.assertEqual(result["limits"]["max_categories"], 30)
        self.assertEqual(result["usage"], profiles.document_usage(user.data))
        self.assertEqual(await user.store.async_load(), user.data)
        self.assertEqual(pending["revision"], 1)
        self.assertEqual(pending["profiles"], [profile()])

    async def test_size_serialization_failure_never_saves_or_publishes(self):
        await self.mutate()
        await self.subscribe(self.alice)
        self.alice.send_event.reset_mock()
        user = self.manager.user("alice")
        before = deepcopy(user.data)
        with patch.object(profiles, "encoded_size", side_effect=TypeError("Cannot serialize")), \
                patch.object(user.store, "async_save", wraps=user.store.async_save) as save, \
                self.assertLogs(profiles._LOGGER, level="ERROR"):
            await self.mutate(operation="update", value=profile(name="Not saved"))
        save.assert_not_awaited()
        self.alice.send_event.assert_not_called()
        self.alice.send_result.assert_not_called()
        self.assertEqual(self.alice.send_error.call_args.args[1], "storage_error")
        self.assertEqual(user.data, before)
        self.assertEqual(await user.store.async_load(), before)

    async def test_store_serialization_failure_reloads_disk_without_publishing(self):
        await self.mutate()
        await self.subscribe(self.alice)
        self.alice.send_event.reset_mock()
        user = self.manager.user("alice")
        before = deepcopy(user.data)
        with patch.object(fixtures.MemoryStore, "async_save", side_effect=TypeError("Cannot serialize")), \
                patch.object(self.manager, "snapshot", wraps=self.manager.snapshot) as snapshot, \
                self.assertLogs(profiles._LOGGER, level="ERROR"):
            await self.mutate(operation="update", value=profile(name="Not saved"))
        snapshot.assert_not_called()
        self.alice.send_event.assert_not_called()
        self.alice.send_result.assert_not_called()
        self.assertEqual(self.alice.send_error.call_args.args[1], "storage_error")
        self.assertIsNone(user.data)
        self.assertEqual(await user.async_load(), before)
        self.assertEqual(await user.store.async_load(), before)

    async def test_maximum_shortcut_profile_roundtrip_and_overflow_are_atomic(self):
        value = profile()
        value["categories"].extend(
            {"id": f"group_{index}", "name": f"Group {index}"}
            for index in range(1, profiles.MAX_CATEGORIES)
        )
        value["settings"]["links"] = [
            {"id": f"s{index}", "name": "S", "type": "internal", "path": "/",
             "icon": "mdi:home", "color": "", "group": "favorites"}
            for index in range(profiles.MAX_SHORTCUTS)
        ]
        value["settings"]["routes"] = ["/"] * profiles.MAX_ITEMS
        value["favorites"] = [f"sensor.e{index}" for index in range(profiles.MAX_ITEMS)]
        self.assertLess(profiles.encoded_size(value), profiles.MAX_PROFILE_BYTES)
        await self.mutate(value=value)
        self.alice.send_error.assert_not_called()
        user = self.manager.user("alice")
        before = deepcopy(user.data)
        user.data = None
        await self.subscribe(self.alice)
        self.assertEqual(self.alice.send_event.call_args.args[1]["profiles"], [value])
        self.assertEqual(await user.async_load(), before)
        self.alice.send_event.reset_mock()
        for resource in ("links", "routes", "favorites"):
            overflow = deepcopy(value)
            target = overflow if resource == "favorites" else overflow["settings"]
            extra = ({**target[resource][0], "id": "overflow"} if resource == "links"
                     else "sensor.overflow" if resource == "favorites" else "/overflow")
            target[resource].append(extra)
            with self.subTest(resource=resource):
                await self.mutate(operation="update", value=overflow)
                self.alice.send_result.assert_not_called()
                self.assertEqual(self.alice.send_error.call_args.args[1], "shortcut_limit" if resource == "links" else "invalid_data")
                self.assertEqual(user.data, before)
                self.assertEqual(self.hass.data["test_storage"][user.store.key], before)
                self.alice.send_event.assert_not_called()

    async def test_device_favorites_persist_separately_and_stale_updates_cannot_overwrite_them(self):
        legacy = profile()
        await self.mutate(value=legacy)
        updated = {**legacy, "device_favorites": ["device_a"]}
        await self.mutate(operation="update", value=updated, revision=1)
        self.alice.send_error.assert_not_called()
        user = self.manager.user("alice")
        saved = deepcopy(user.data)
        self.assertEqual(saved["profiles"][0]["favorites"], legacy["favorites"])
        self.assertEqual(saved["profiles"][0]["device_favorites"], ["device_a"])
        await self.mutate(operation="update", value=legacy, revision=1)
        self.assertEqual(self.alice.send_error.call_args.args[1], "conflict")
        self.assertEqual(user.data, saved)
        user.data = None
        self.assertEqual(await user.async_load(), saved)
        await self.mutate(operation="update", value={**updated, "device_favorites": []}, revision=2)
        self.alice.send_error.assert_not_called()
        self.assertEqual(user.data["profiles"][0]["device_favorites"], [])
        self.assertEqual(user.data["profiles"][0]["favorites"], legacy["favorites"])

    async def test_saved_profiles_load_edit_save_reload_and_reject_stale_revisions(self):
        user = self.manager.user("alice")
        saved = saved_document()
        expected = deepcopy(saved)
        self.assertEqual(user.store.key, "quick_access.profiles_v1.alice")
        self.hass.data.setdefault("test_storage", {})[user.store.key] = deepcopy(saved)
        with patch.object(user.store, "async_save", new=AsyncMock(wraps=user.store.async_save)) as save:
            await self.subscribe(self.alice)
            self.alice.send_error.assert_not_called()
            self.assertEqual(user.data, expected)
            self.assertEqual(self.alice.send_event.call_args.args[1]["profiles"], expected["profiles"])
            save.assert_not_awaited()
        self.assertEqual(self.hass.data["test_storage"][user.store.key], saved)
        for index, item in enumerate(expected["profiles"]):
            item["name"] += " edited"
            expected["revision"] += 1
            await self.mutate(operation="update", value=item, revision=37 + index)
            self.alice.send_error.assert_not_called()
            self.assertEqual(user.data, expected)
            self.assertEqual(self.hass.data["test_storage"][user.store.key], expected)
            await self.mutate(operation="update", value=item, revision=37 + index)
            self.assertEqual(self.alice.send_error.call_args.args[1], "conflict")
            self.assertEqual(self.hass.data["test_storage"][user.store.key], expected)
        user.data = None
        self.assertEqual(await user.async_load(), expected)

    async def test_malformed_storage_is_never_replaced(self):
        user = self.manager.user("alice")
        saved = saved_document()
        saved["profiles"][0]["settings"]["unexpected"] = True
        self.hass.data.setdefault("test_storage", {})[user.store.key] = deepcopy(saved)
        await self.subscribe(self.alice)
        self.assertEqual(self.alice.send_error.call_args.args[1], "invalid_data")
        self.assertIsNone(user.data)
        await self.mutate(revision=0)
        self.alice.send_result.assert_not_called()
        self.assertEqual(self.hass.data["test_storage"][user.store.key], saved)

    async def test_user_quota_rejects_create_and_update_without_side_effects(self):
        await self.mutate()
        await self.subscribe(self.alice)
        self.alice.send_event.reset_mock()
        user = self.manager.user("alice")
        before = deepcopy(user.data)
        user.store.async_save = AsyncMock(wraps=user.store.async_save)
        changed = profile()
        changed["settings"]["links"][0]["path"] += "x" * 100
        with patch.object(profiles.ProfileStore, "limits", new_callable=PropertyMock, return_value=profiles.ResourceLimits(max_user_bytes=profiles.encoded_size(before) + 50)):
            for operation, value in (("create", profile("tablet")), ("update", changed)):
                with self.subTest(operation=operation):
                    await self.mutate(operation=operation, value=value)
                    self.assertEqual(self.alice.send_error.call_args.args[1], "user_storage_limit")
                    self.assertIn("Total storage limit reached", self.alice.send_error.call_args.args[2])
                    self.alice.send_result.assert_not_called()
                    self.assertEqual(user.data, before)
                    self.assertEqual(await user.store.async_load(), before)
                    user.store.async_save.assert_not_awaited()
                    self.alice.send_event.assert_not_called()
            await self.mutate(connection=self.bob)
            self.bob.send_error.assert_not_called()
            await self.mutate(operation="delete")
            self.alice.send_error.assert_not_called()
            await self.mutate(value=profile("tablet"))
            self.alice.send_error.assert_not_called()
            self.assertEqual(user.data["profiles"], [profile("tablet")])

    async def test_user_quota_checks_the_incremented_revision(self):
        await self.mutate()
        user = self.manager.user("alice")
        user.data["revision"] = 9
        await user.store.async_save(user.data)
        before = deepcopy(user.data)
        user.store.async_save = AsyncMock(wraps=user.store.async_save)
        with patch.object(profiles.ProfileStore, "limits", new_callable=PropertyMock, return_value=profiles.ResourceLimits(max_user_bytes=profiles.encoded_size(before))):
            await self.mutate(operation="update")
        self.assertEqual(self.alice.send_error.call_args.args[1], "user_storage_limit")
        self.assertEqual(user.data, before)
        self.assertEqual(await user.store.async_load(), before)
        user.store.async_save.assert_not_awaited()

    async def test_saved_documents_above_current_limits_load_and_allow_cleanup(self):
        user = self.manager.user("alice")
        saved = {"version": 1, "revision": 1, "profiles": [profile(f"p{i}") for i in range(12)]}
        saved["profiles"][0]["categories"].extend({"id": f"c{i}", "name": f"C{i}"} for i in range(22))
        self.hass.data.setdefault("test_storage", {})[user.store.key] = deepcopy(saved)
        self.entry.options = {"max_profiles": 1, "max_categories": 1}
        await self.subscribe(self.alice)
        self.alice.send_error.assert_not_called()
        self.assertEqual(user.data, saved)
        snapshot = self.alice.send_event.call_args.args[1]
        self.assertEqual(snapshot["usage"]["profiles"], 12)
        self.assertEqual(snapshot["limits"]["max_profiles"], 1)
        await self.mutate(operation="delete", value=saved["profiles"][-1])
        self.alice.send_error.assert_not_called()
        self.assertEqual(len(user.data["profiles"]), 11)

    async def test_limits_broadcast_immediately_and_enforce_before_listener(self):
        await self.mutate()
        await self.subscribe(self.alice)
        await self.subscribe(self.bob)
        before = deepcopy(self.manager.user("alice").data)
        self.entry.options = {"max_profiles": 1, "max_categories": 2, "max_user_mib": 4, "max_profile_mib": 1}
        # No listener or browser refresh has run: a new mutation sees new options.
        await self.mutate(value=profile("second"))
        self.assertEqual(self.alice.send_error.call_args.args[1], "profile_limit")
        await integration.async_options_updated(self.hass, self.entry)
        for connection in (self.alice, self.bob):
            self.assertEqual(connection.send_event.call_args.args[1]["limits"]["max_profiles"], 1)
        self.assertEqual(self.manager.user("alice").data, before)
        self.assertEqual(self.bob.send_event.call_args.args[1]["usage"]["profiles"], 0)
        self.entry.options["max_profiles"] = 2
        await integration.async_options_updated(self.hass, self.entry)
        await self.mutate(value=profile("second"))
        self.alice.send_error.assert_not_called()
        await self.mutate(connection=self.bob)
        self.bob.send_error.assert_not_called()
        self.assertEqual(self.alice.send_event.call_args.args[1]["usage"]["profiles"], 2)
        self.assertEqual(self.bob.send_event.call_args.args[1]["usage"]["profiles"], 1)

    async def test_reduced_categories_allow_rename_reorder_delete_but_no_new_ids(self):
        value = profile()
        value["categories"].extend({"id": f"c{i}", "name": f"Category {i}"} for i in range(14))
        await self.mutate(value=value)
        self.entry.options = {"max_categories": 10}
        value["categories"][1]["name"] = "Renamed"
        value["categories"].reverse()
        await self.mutate(operation="update", value=value)
        self.alice.send_error.assert_not_called()
        self.assertEqual(len(self.manager.user("alice").data["profiles"][0]["categories"]), 15)
        value["categories"].pop(0)
        await self.mutate(operation="update", value=value)
        self.alice.send_error.assert_not_called()
        changed = deepcopy(value)
        changed["categories"][0] = {"id": "new", "name": "New"}
        await self.mutate(operation="update", value=changed)
        self.assertEqual(self.alice.send_error.call_args.args[1], "category_limit")
        self.assertEqual(self.manager.user("alice").data["profiles"][0], value)

    async def test_reduced_profile_count_preserves_updates_and_deletions(self):
        for i in range(3):
            await self.mutate(value=profile(f"p{i}"))
        self.entry.options = {"max_profiles": 1}
        await self.mutate(operation="update", value=profile("p0", "Rename"))
        self.alice.send_error.assert_not_called()
        await self.mutate(operation="delete", value=profile("p2"))
        self.alice.send_error.assert_not_called()
        await self.mutate(value=profile("new"))
        self.assertEqual(self.alice.send_error.call_args.args[1], "profile_limit")
        self.assertEqual(len(self.manager.user("alice").data["profiles"]), 2)

    async def test_storage_reduction_allows_progressive_cleanup_and_size_neutral_updates(self):
        value = profile_with_bytes(1500000)
        await self.mutate(value=value)
        self.entry.options = {"max_profile_mib": 1, "max_user_mib": 1}
        await self.mutate(operation="update", value=value)
        self.alice.send_error.assert_not_called()
        value["settings"]["links"][0]["path"] = value["settings"]["links"][0]["path"][:-100]
        await self.mutate(operation="update", value=value)
        self.alice.send_error.assert_not_called()
        changed = deepcopy(value)
        changed["settings"]["links"][0]["path"] += "x"
        await self.mutate(operation="update", value=changed)
        self.assertEqual(self.alice.send_error.call_args.args[1], "profile_storage_limit")
        self.assertEqual(self.manager.user("alice").data["profiles"][0], value)
        # Grow a different, individually-small profile: total storage blocks it.
        await self.mutate(value=profile("small"))
        self.assertEqual(self.alice.send_error.call_args.args[1], "user_storage_limit")
        await self.mutate(operation="delete", value=value)
        self.alice.send_error.assert_not_called()

    async def test_authoritative_usage_counts_unicode_and_document_metadata(self):
        value = profile(name="Željko")
        await self.mutate(value=value)
        await self.subscribe(self.alice)
        snapshot = self.alice.send_event.call_args.args[1]
        self.assertEqual(snapshot["usage"]["by_profile"][value["id"]], {"categories": 1, "bytes": profiles.encoded_size(value)})
        self.assertEqual(snapshot["usage"]["user_bytes"], profiles.encoded_size(self.manager.user("alice").data))
        self.assertEqual(set(self.manager.user("alice").data), {"version", "revision", "profiles"})

    async def test_profile_api_cannot_modify_limits_or_select_another_user(self):
        await self.mutate(user_id="bob", options={"max_profiles": 100})
        self.assertEqual(self.entry.options, {})
        self.assertEqual(len(self.manager.user("alice").data["profiles"]), 1)
        self.assertEqual((await self.manager.user("bob").async_load())["profiles"], [])

    async def test_visibility_recovery_preserves_profile_and_is_confirmed_on_disk(self):
        original = profile()
        await self.mutate(value=original)
        reset = deepcopy(original)
        reset["settings"].update(visibility="exclude", routes=[])
        await self.mutate(operation="reset_visibility")
        self.alice.send_error.assert_not_called()
        saved = (await self.manager.user("alice").store.async_load())["profiles"][0]
        self.assertEqual(saved, reset)
        self.assertEqual(saved["categories"], original["categories"])
        self.assertEqual(saved["settings"]["links"], original["settings"]["links"])
        self.assertEqual(saved["favorites"], original["favorites"])

    async def test_visibility_recovery_waits_for_concurrent_edit_and_preserves_latest_fields(self):
        await self.mutate()
        await self.subscribe(self.alice)
        other = Connection("alice")
        latest = profile(name="Concurrent rename")
        latest.update(icon="mdi:cat", color="#123456", favorites=["light.bedroom"],
                      device_favorites=["device-2"])
        latest["categories"].append({"id": "rooms", "name": "Rooms"})
        latest["settings"].update(visibility="include", routes=["/missing"])
        latest["settings"]["links"][0].update(name="Concurrent shortcut", group="rooms")
        user = self.manager.user("alice")
        previous = deepcopy(user.data)
        save = user.store.async_save
        saving, release = asyncio.Event(), asyncio.Event()

        async def delayed_save(document):
            saving.set()
            await release.wait()
            await save(document)

        with patch.object(user.store, "async_save", side_effect=delayed_save):
            update = asyncio.create_task(self.mutate(connection=other, operation="update", value=latest))
            await saving.wait()
            reset = asyncio.create_task(self.mutate(operation="reset_visibility"))
            await asyncio.sleep(0)
            self.assertFalse(reset.done())
            release.set()
            await asyncio.gather(update, reset)

        self.alice.send_error.assert_not_called()
        other.send_error.assert_not_called()
        expected = {**latest, "settings": {**latest["settings"], "visibility": "exclude", "routes": []}}
        self.assertEqual(user.data, {**previous, "revision": 3, "profiles": [expected]})
        self.assertEqual(previous["profiles"], [profile()])
        self.assertEqual(await user.store.async_load(), user.data)
        self.assertEqual(self.alice.send_result.call_args.args[1]["profiles"], [expected])
        self.assertEqual(self.alice.send_event.call_args.args[1]["revision"], 3)
        await self.mutate(operation="update", value=latest, revision=2)
        self.assertEqual(self.alice.send_error.call_args.args[1], "conflict")

    async def test_failed_visibility_recovery_preserves_disk_and_does_not_publish(self):
        await self.mutate()
        await self.subscribe(self.alice)
        self.alice.send_event.reset_mock()
        user = self.manager.user("alice")
        before = deepcopy(user.data)
        user.store.fail = True
        with self.assertLogs(profiles._LOGGER, level="ERROR"):
            await self.mutate(operation="reset_visibility")
        self.alice.send_error.assert_called_once()
        self.alice.send_result.assert_not_called()
        self.alice.send_event.assert_not_called()
        self.assertEqual(await user.async_load(), before)

    async def test_full_profile_mutations_still_require_a_revision(self):
        await self.mutate()
        user = self.manager.user("alice")
        before = deepcopy(user.data)
        for operation in ("create", "update", "delete"):
            with self.subTest(operation=operation):
                self.alice.send_error.reset_mock()
                await profiles.websocket_mutate_profile(self.hass, self.alice, {
                    "id": 12, "operation": operation, "profile_id": "phone", "profile": profile(),
                })
                self.assertEqual(self.alice.send_error.call_args.args[1], "invalid_data")
                self.assertEqual(user.data, before)

    async def test_visibility_recovery_rejects_invalid_and_deleted_profile_ids(self):
        await self.mutate()
        await self.mutate(operation="delete")
        user = self.manager.user("alice")
        before = deepcopy(user.data)
        for profile_id in ("phone", "missing", "../bob", "", None):
            with self.subTest(profile_id=profile_id):
                await self.mutate(operation="reset_visibility", value={"id": profile_id})
                self.assertEqual(self.alice.send_error.call_args.args[1], "invalid_data")
                self.assertEqual(user.data, before)

    async def test_profile_limit_allows_updates_deletions_and_reusing_capacity(self):
        for index in range(profiles.MAX_PROFILES):
            await self.mutate(value=profile(f"profile_{index}"))
            self.alice.send_error.assert_not_called()
        await self.subscribe(self.alice)
        self.alice.send_event.reset_mock()
        user = self.manager.user("alice")
        before = deepcopy(user.data)
        await self.mutate(value=profile("extra"))
        self.assertEqual(self.alice.send_error.call_args.args[1], "profile_limit")
        self.assertIn("Profile limit reached", self.alice.send_error.call_args.args[2])
        self.assertEqual(user.data, before)
        self.assertEqual(await user.store.async_load(), before)
        self.alice.send_event.assert_not_called()
        await self.mutate(operation="update", value=profile("profile_0", "Renamed"))
        self.alice.send_error.assert_not_called()
        await self.mutate(operation="delete", value=profile("profile_0"))
        await self.mutate(value=profile("extra"))
        self.alice.send_error.assert_not_called()
        self.assertEqual(len(user.data["profiles"]), profiles.MAX_PROFILES)

    async def test_category_limit_rejects_updates_without_changing_saved_data(self):
        value = profile()
        value["categories"].extend(
            {"id": f"category_{index}", "name": f"Category {index}"}
            for index in range(profiles.MAX_CATEGORIES - 1)
        )
        await self.mutate(value=value)
        await self.subscribe(self.alice)
        self.alice.send_event.reset_mock()
        user = self.manager.user("alice")
        before = deepcopy(user.data)
        value["categories"].append({"id": "extra", "name": "Extra"})
        await self.mutate(operation="update", value=value)
        self.assertEqual(self.alice.send_error.call_args.args[1], "category_limit")
        self.assertEqual(user.data, before)
        self.assertEqual(await user.store.async_load(), before)
        self.alice.send_event.assert_not_called()

    async def test_category_changes_sync_after_persistence_and_reject_stale_writes(self):
        other = Connection()
        await self.subscribe(self.alice)
        await self.subscribe(other)
        await self.mutate()
        created = profile()
        created["categories"].extend([{"id": "rooms", "name": "Rooms"}, {"id": "work", "name": "Work"}])
        created["settings"]["links"][0]["group"] = "rooms"
        await self.mutate(operation="update", value=created, revision=1)
        self.assertEqual(other.send_event.call_args.args[1]["profiles"][0], created)
        user = self.manager.user("alice")
        self.assertEqual((await user.store.async_load())["profiles"][0], created)

        renamed = deepcopy(created)
        renamed["categories"][1]["name"] = "Living room"
        renamed["categories"] = [renamed["categories"][0], renamed["categories"][2], renamed["categories"][1]]
        await self.mutate(operation="update", value=renamed, revision=2)
        await self.mutate(connection=other, operation="update", value=created, revision=2)
        self.assertEqual(other.send_error.call_args.args[1], "conflict")
        self.assertEqual(user.data["profiles"][0], renamed)
        self.assertEqual(renamed["settings"]["links"][0]["group"], "rooms")

        copied = deepcopy(renamed)
        copied.update(id="tablet", name="Tablet")
        await self.mutate(value=copied)
        deleted = deepcopy(renamed)
        deleted["categories"] = [item for item in deleted["categories"] if item["id"] != "rooms"]
        deleted["settings"]["links"][0]["group"] = "favorites"
        await self.mutate(operation="update", value=deleted)
        self.assertEqual(user.data["profiles"], [deleted, copied])
        self.assertEqual(len(deleted["settings"]["links"]), len(created["settings"]["links"]))
        self.assertEqual(other.send_event.call_args.args[1]["profiles"], [deleted, copied])

    async def test_invalid_categories_and_references_never_change_saved_data(self):
        await self.mutate()
        invalid_categories = [None, {}, [], [{"id": "rooms", "name": "Rooms"}],
            [{"id": "favorites", "name": "Renamed"}],
            [{"id": "favorites", "name": "Favorites", "extra": True}],
        ]
        for category in [
            {"id": "favorites", "name": "Other"}, {"id": "bad id", "name": "Other"},
            {"id": "work", "name": "favorites"}, {"id": "work", "name": ""},
            {"id": "work", "name": " Leading"}, {"id": "work", "name": "x" * 51},
            {"id": "work", "name": "Bad\nname"}, {"id": "work", "name": "Bad\x7fname"},
            {"id": "work", "name": 3}, {"id": [], "name": "Bad"},
        ]:
            invalid_categories.append([{"id": "favorites", "name": "Favorites"}, category])
        before = deepcopy(self.manager.user("alice").data)
        for categories in invalid_categories:
            with self.subTest(categories=categories):
                value = profile()
                value["categories"] = categories
                await self.mutate(operation="update", value=value)
                self.assertEqual(self.alice.send_error.call_args.args[1], "invalid_data")
                self.assertEqual(self.manager.user("alice").data, before)
        for group in ("missing", "tools", "devices", "scenes", [], None):
            value = profile()
            value["settings"]["links"][0]["group"] = group
            await self.mutate(operation="update", value=value)
            self.assertEqual(self.alice.send_error.call_args.args[1], "invalid_data")
            self.assertEqual(self.manager.user("alice").data, before)

    async def test_first_load_uses_version_one_and_reloads_saved_profiles(self):
        user = self.manager.user("alice")
        self.assertEqual(profiles.SCHEMA_VERSION, 1)
        self.assertEqual(user.store.key, "quick_access.profiles_v1.alice")
        await self.subscribe(self.alice)
        self.assertEqual(user.data, {"version": 1, "revision": 0, "profiles": []})
        await self.mutate()
        self.manager.users.clear()
        reloaded = await self.manager.user("alice").async_load()
        self.assertEqual(reloaded, {"version": 1, "revision": 1, "profiles": [profile()]})

    async def test_incomplete_profiles_are_rejected_without_changing_saved_data(self):
        await self.mutate()
        before = deepcopy(self.manager.user("alice").data)
        for field in profile():
            with self.subTest(field=field):
                incomplete = profile()
                del incomplete[field]
                await profiles.websocket_mutate_profile(self.hass, self.alice, {
                    "id": 12, "operation": "update", "profile_id": "phone",
                    "revision": before["revision"], "profile": incomplete,
                })
                self.assertEqual(self.alice.send_error.call_args.args[1], "invalid_data")
                self.assertEqual(self.manager.user("alice").data, before)

    async def test_authenticated_user_isolation_and_per_user_notifications(self):
        await self.subscribe(self.alice)
        await self.subscribe(self.bob)
        self.alice.send_event.reset_mock()
        self.bob.send_event.reset_mock()
        # Even a forged user_id never selects another user's store.
        await self.mutate(user_id="bob")
        self.assertEqual(len(self.manager.user("alice").data["profiles"]), 1)
        self.assertEqual(self.manager.user("bob").data["profiles"], [])
        self.alice.send_event.assert_called_once()
        self.bob.send_event.assert_not_called()
        self.assertTrue(self.manager.user("alice").store.options["atomic_writes"])
        self.assertTrue(self.manager.user("alice").store.options["private"])

    async def test_visibility_recovery_changes_only_authenticated_users_selected_profile(self):
        hidden = profile()
        hidden["settings"].update(visibility="exclude", routes=["/*"])
        await self.mutate(value=hidden)
        await self.mutate(value=profile("tablet", "Tablet"))
        await self.mutate(connection=self.bob, value=hidden)
        await self.subscribe(self.alice)
        await self.subscribe(self.bob)
        before = deepcopy(self.manager.user("alice").data)
        other_before = deepcopy(self.manager.user("bob").data)
        self.bob.send_event.reset_mock()
        recovered = {**hidden, "settings": {**hidden["settings"], "visibility": "exclude", "routes": []}}
        await self.mutate(operation="reset_visibility", user_id="bob")
        self.alice.send_error.assert_not_called()
        self.assertEqual(self.manager.user("alice").data, {
            **before, "revision": before["revision"] + 1,
            "profiles": [recovered, before["profiles"][1]],
        })
        self.assertEqual(self.manager.user("bob").data, other_before)
        self.bob.send_event.assert_not_called()

    async def test_visibility_recovery_cannot_update_a_profile_owned_only_by_another_user(self):
        hidden = profile("private", "Private")
        hidden["settings"].update(visibility="exclude", routes=["/*"])
        await self.mutate(connection=self.bob, value=hidden)
        before = deepcopy(self.manager.user("bob").data)
        await self.mutate(operation="reset_visibility", value=hidden, user_id="bob")
        self.assertEqual(self.alice.send_error.call_args.args[1], "invalid_data")
        self.assertEqual(self.manager.user("bob").data, before)
        self.assertEqual(self.manager.user("alice").data["profiles"], [])

    async def test_create_rename_copy_update_and_delete_preserve_other_profiles(self):
        await self.mutate()
        copied = profile("tablet", "Tablet")
        await self.mutate(value=copied)
        copied["settings"]["links"][0]["name"] = "Tablet logs"
        copied["name"] = "New tablet"
        copied["icon"] = "mdi:tablet"
        copied["favorites"] = []
        await self.mutate(operation="update", value=copied)
        data = self.manager.user("alice").data
        self.assertEqual(data["profiles"][0], profile())
        self.assertEqual(data["profiles"][1], copied)
        await self.mutate(operation="delete", value=copied)
        self.assertEqual(self.manager.user("alice").data["profiles"], [profile()])
        # Empty collections remain initialized, so devices don't re-create deleted defaults.
        await self.mutate(operation="delete")
        self.assertEqual(self.manager.user("alice").data["profiles"], [])
        self.assertGreater(self.manager.user("alice").data["revision"], 0)

    async def test_removed_reorder_operation_is_rejected_without_changes(self):
        await self.mutate()
        await self.mutate(value=profile("tablet"))
        user = self.manager.user("alice")
        previous = deepcopy(user.data)
        await self.mutate(operation="reorder", profile_ids=["tablet", "phone"])
        self.assertEqual(self.alice.send_error.call_args.args[1], "invalid_data")
        self.assertEqual(user.data, previous)

    async def test_all_filter_is_always_enabled_on_write_and_load(self):
        value = saved_filter_profile()
        for kind in ("states", "devices"):
            next(item for item in value["filters"][kind] if item["id"] == "all")["hidden"] = True
        await self.mutate(value=value)
        self.alice.send_error.assert_not_called()
        user = self.manager.user("alice")
        for kind in ("states", "devices"):
            stored = next(item for item in user.data["profiles"][0]["filters"][kind] if item["id"] == "all")
            self.assertIs(stored["hidden"], False)
        # Documents saved before the rule load with "All" re-enabled.
        legacy = profiles.validate_profile(value)
        self.assertFalse(any(item["hidden"] for item in legacy["filters"]["states"] if item["id"] == "all"))
        self.assertTrue(next(item for item in value["filters"]["states"] if item["id"] == "all")["hidden"])

    async def test_written_names_colors_and_shortcut_ids_are_checked(self):
        link = profile()["settings"]["links"][0]
        invalid = {
            "profile name": {**profile(), "name": "Phone\u0007"},
            "profile spaces": {**profile(), "name": " Phone"},
            "profile color": {**profile(), "color": "not-a-color"},
            "shortcut id": {**profile(), "settings": {**profile()["settings"], "links": [{**link, "id": "bad id"}]}},
            "shortcut name": {**profile(), "settings": {**profile()["settings"], "links": [{**link, "name": "Logs\n"}]}},
            "shortcut color": {**profile(), "settings": {**profile()["settings"], "links": [{**link, "color": "nope"}]}},
        }
        for label, value in invalid.items():
            with self.subTest(label):
                await self.mutate(value=value)
                self.assertEqual(self.alice.send_error.call_args.args[1], "invalid_data")
                self.assertEqual(self.manager.user("alice").data["profiles"], [])
        await self.mutate(value={**profile(), "color": "indigo"})
        self.alice.send_error.assert_not_called()

    async def test_unchanged_legacy_values_do_not_block_unrelated_edits(self):
        user = self.manager.user("alice")
        await user.async_load()
        legacy = profile()
        legacy["color"] = "legacy color"
        legacy["settings"]["links"][0].update(id="legacy id", name=" Logs", color="legacy color")
        user.data = {"version": 1, "revision": 0, "profiles": [profiles.validate_profile(legacy)]}
        await self.mutate(operation="update", value={**deepcopy(legacy), "name": "Renamed"})
        self.alice.send_error.assert_not_called()
        self.assertEqual(user.data["profiles"][0]["name"], "Renamed")
        changed = {**deepcopy(legacy), "name": "Renamed"}
        changed["settings"]["links"][0]["color"] = "still not a color"
        await self.mutate(operation="update", value=changed)
        self.assertEqual(self.alice.send_error.call_args.args[1], "invalid_data")
        changed["settings"]["links"][0]["color"] = "teal"
        await self.mutate(operation="update", value=changed)
        self.alice.send_error.assert_not_called()

    async def test_profile_icons_and_colors_persist_and_sync_only_to_the_authenticated_user(self):
        await self.subscribe(self.alice)
        await self.subscribe(self.bob)
        self.bob.send_event.reset_mock()
        value = {**profile(), "icon": "mdi:rocket", "color": "#8e24aa"}
        await self.mutate(value=value)
        self.assertEqual(self.alice.send_event.call_args.args[1]["profiles"][0]["icon"], "mdi:rocket")
        self.assertEqual(self.alice.send_event.call_args.args[1]["profiles"][0]["color"], "#8e24aa")
        self.bob.send_event.assert_not_called()
        self.manager.users.clear()
        reloaded = await self.manager.user("alice").async_load()
        self.assertEqual(reloaded["profiles"][0]["icon"], "mdi:rocket")
        self.assertEqual(reloaded["profiles"][0]["color"], "#8e24aa")
        self.assertEqual((await self.manager.user("bob").async_load())["profiles"], [])

    async def test_invalid_profile_icons_are_rejected_without_changing_saved_data(self):
        await self.mutate(value={**profile(), "icon": "mdi:rocket"})
        before = deepcopy(self.manager.user("alice").data)
        for invalid in ("", "javascript:alert(1)", "<svg>", "mdi:", "mdi:" + "x" * 64, None, 7, {}):
            with self.subTest(icon=invalid):
                await self.mutate(operation="update", value={**profile(), "icon": invalid})
                self.assertEqual(self.alice.send_error.call_args.args[1], "invalid_data")
                self.assertEqual(self.manager.user("alice").data, before)

    async def test_invalid_shortcut_icons_are_rejected_without_writes_or_notifications(self):
        await self.mutate()
        await self.subscribe(self.alice)
        self.alice.send_event.reset_mock()
        user = self.manager.user("alice")
        before = deepcopy(user.data)
        user.store.async_save = AsyncMock(wraps=user.store.async_save)
        for invalid in ("", "   ", "unknown", "mdi:", "mdi:Bad", "mdi:bad--icon", "mdi:" + "x" * 60, None, 7, {}):
            with self.subTest(icon=invalid):
                changed = profile()
                changed["settings"]["links"][0]["icon"] = invalid
                await self.mutate(operation="update", value=changed)
                self.assertEqual(self.alice.send_error.call_args.args[1], "invalid_data")
                self.assertIn("Invalid shortcut icon", self.alice.send_error.call_args.args[2])
                self.alice.send_result.assert_not_called()
                self.assertEqual(user.data, before)
                user.store.async_save.assert_not_awaited()
                self.alice.send_event.assert_not_called()

    async def test_include_without_routes_rejects_create_and_update_without_side_effects(self):
        await self.mutate()
        await self.subscribe(self.alice)
        self.alice.send_event.reset_mock()
        user = self.manager.user("alice")
        before = deepcopy(user.data)
        user.store.async_save = AsyncMock(wraps=user.store.async_save)
        for operation, profile_id in (("create", "tablet"), ("update", "phone")):
            with self.subTest(operation=operation):
                changed = profile(profile_id)
                changed["settings"].update(visibility="include", routes=[])
                await self.mutate(operation=operation, value=changed)
                self.assertEqual(self.alice.send_error.call_args.args[1], "invalid_data")
                self.assertIn("at least one page path", self.alice.send_error.call_args.args[2])
                self.alice.send_result.assert_not_called()
                self.assertEqual(user.data, before)
                self.assertEqual(await user.store.async_load(), before)
                user.store.async_save.assert_not_awaited()
                self.alice.send_event.assert_not_called()

    async def test_simultaneous_updates_are_atomic_and_loser_cannot_overwrite(self):
        await self.mutate()
        left, right = profile(), profile()
        left["name"], right["name"] = "Left", "Right"
        other = Connection()
        await asyncio.gather(
            self.mutate(operation="update", value=left, revision=1),
            self.mutate(connection=other, operation="update", value=right, revision=1),
        )
        errors = self.alice.send_error.call_count + other.send_error.call_count
        self.assertEqual(errors, 1)
        loser = self.alice if self.alice.send_error.called else other
        self.assertEqual(loser.send_error.call_args.args[1], "conflict")
        self.assertEqual(self.manager.user("alice").data["revision"], 2)

    async def test_simultaneous_shortcut_updates_to_different_profiles_are_reconciled(self):
        left, right = profile(), profile("tablet", "Tablet")
        await self.mutate(value=left)
        await self.mutate(value=right)
        other = Connection()
        await self.subscribe(self.alice)
        await self.subscribe(other)
        left["settings"]["links"][0]["name"] = "Left shortcut"
        right["settings"]["links"][0]["name"] = "Right shortcut"

        await asyncio.gather(
            self.mutate(operation="update", value=left, revision=2),
            self.mutate(connection=other, operation="update", value=right, revision=2),
        )

        user = self.manager.user("alice")
        self.alice.send_error.assert_not_called()
        other.send_error.assert_not_called()
        self.assertEqual(user.data, {"version": 1, "revision": 4, "profiles": [left, right]})
        self.assertEqual(await user.store.async_load(), user.data)
        for connection in (self.alice, other):
            snapshot = connection.send_event.call_args.args[1]
            self.assertEqual(snapshot["revision"], 4)
            self.assertEqual(snapshot["profiles"], [left, right])
            self.assertEqual(snapshot["usage"], profiles.document_usage(user.data))
        self.assertEqual(sorted(connection.send_result.call_args.args[1]["revision"]
                                for connection in (self.alice, other)), [3, 4])

    async def test_same_profile_changes_and_deletions_still_conflict(self):
        await self.mutate()
        changed = profile(name="Confirmed name")
        await self.mutate(operation="update", value=changed, revision=1)
        other_field = profile()
        other_field["settings"]["links"][0]["name"] = "Competing shortcut"
        user = self.manager.user("alice")
        saved = deepcopy(user.data)
        for operation in ("update", "delete"):
            with self.subTest(operation=operation):
                await self.mutate(operation=operation, value=other_field, revision=1)
                self.assertEqual(self.alice.send_error.call_args.args[1], "conflict")
                self.assertEqual(user.data, saved)
                self.assertEqual(await user.store.async_load(), saved)

    async def test_unrelated_changes_allow_delete_but_not_edits_to_recreated_profile(self):
        await self.mutate()
        await self.mutate(value=profile("tablet"))
        await self.mutate(operation="update", value=profile(name="Changed"), revision=2)
        await self.mutate(operation="delete", value=profile("tablet"), revision=2)
        self.alice.send_error.assert_not_called()
        user = self.manager.user("alice")
        self.assertEqual(user.data["profiles"], [profile(name="Changed")])
        await self.mutate(operation="update", value=profile("tablet"), revision=2)
        self.assertEqual(self.alice.send_error.call_args.args[1], "conflict")
        await self.mutate(value=profile("tablet", "Recreated"))
        self.alice.send_error.assert_not_called()
        saved = deepcopy(user.data)
        for operation in ("update", "delete"):
            with self.subTest(operation=operation):
                await self.mutate(operation=operation, value=profile("tablet"), revision=2)
                self.assertEqual(self.alice.send_error.call_args.args[1], "conflict")
                self.assertEqual(user.data, saved)

    async def test_loaded_profiles_reconcile_only_revisions_since_the_load(self):
        user = self.manager.user("alice")
        saved = saved_document()
        self.hass.data.setdefault("test_storage", {})[user.store.key] = deepcopy(saved)
        await self.subscribe(self.alice)
        changed = deepcopy(saved["profiles"][0])
        changed["name"] = "First changed"
        await self.mutate(operation="update", value=changed, revision=37)
        second = deepcopy(saved["profiles"][1])
        second["name"] = "Second changed"
        await self.mutate(operation="update", value=second, revision=36)
        self.assertEqual(self.alice.send_error.call_args.args[1], "conflict")
        await self.mutate(operation="update", value=second, revision=37)
        self.alice.send_error.assert_not_called()
        self.assertEqual(user.data["profiles"][:2], [changed, second])

        # A reload cannot prove whether a previously untouched profile changed
        # before loading, even if other profiles have since advanced revisions.
        user.data = None
        await user.async_load()
        await self.mutate(operation="update", value=changed, revision=39)
        third = deepcopy(saved["profiles"][2])
        third["name"] = "Third changed"
        await self.mutate(operation="update", value=third, revision=38)
        self.assertEqual(self.alice.send_error.call_args.args[1], "conflict")
        await self.mutate(operation="update", value=third, revision=39)
        self.alice.send_error.assert_not_called()
        self.assertEqual(await user.store.async_load(), user.data)

    async def test_reconciled_updates_still_enforce_current_collection_quotas(self):
        await self.mutate()
        await self.mutate(value=profile("tablet"))
        await self.mutate(operation="update", value=profile(name="Changed"), revision=2)
        await self.subscribe(self.alice)
        self.alice.send_event.reset_mock()
        user = self.manager.user("alice")
        saved = deepcopy(user.data)
        limits = profiles.ResourceLimits(max_user_bytes=profiles.encoded_size(saved))
        with patch.object(type(self.manager), "limits", new_callable=PropertyMock, return_value=limits):
            await self.mutate(operation="update", value=profile("tablet", "Longer tablet name"), revision=2)
        self.assertEqual(self.alice.send_error.call_args.args[1], "user_storage_limit")
        self.assertEqual(user.data, saved)
        self.assertEqual(await user.store.async_load(), saved)
        self.alice.send_event.assert_not_called()

    async def test_future_revisions_cannot_mutate_profiles(self):
        await self.mutate()
        user = self.manager.user("alice")
        saved = deepcopy(user.data)
        for operation in ("create", "update", "delete"):
            with self.subTest(operation=operation):
                await self.mutate(operation=operation, revision=2)
                self.assertEqual(self.alice.send_error.call_args.args[1], "conflict")
                self.assertEqual(user.data, saved)

    async def test_two_first_time_devices_create_only_one_default_on_same_revision(self):
        other = Connection()
        await asyncio.gather(self.mutate(revision=0), self.mutate(connection=other, value=profile("desktop"), revision=0))
        self.assertEqual(len(self.manager.user("alice").data["profiles"]), 1)

    async def test_cancelled_request_finishes_its_transaction_before_releasing_lock(self):
        user = self.manager.user("alice")
        started, finish = asyncio.Event(), asyncio.Event()
        save = user.store.async_save

        async def slow_save(value):
            started.set()
            await finish.wait()
            await save(value)

        user.store.async_save = slow_save
        request = asyncio.create_task(self.mutate(revision=0))
        await started.wait()
        request.cancel()
        await asyncio.sleep(0)
        self.assertTrue(user.lock.locked())
        finish.set()
        with self.assertRaises(asyncio.CancelledError):
            await request
        self.assertFalse(user.lock.locked())
        self.assertEqual(user.data["revision"], 1)
        self.assertEqual(user.data["profiles"], [profile()])

    async def test_failed_write_keeps_previous_revision_and_sends_no_notification(self):
        await self.mutate()
        await self.subscribe(self.alice)
        self.alice.send_event.reset_mock()
        user = self.manager.user("alice")
        before = deepcopy(user.data)
        user.store.fail = True
        with self.assertLogs(profiles._LOGGER, level="ERROR"):
            await self.mutate(operation="update", value=profile(name="Changed"))
        self.assertIsNone(user.data)
        self.assertEqual(await user.async_load(), before)
        self.alice.send_event.assert_not_called()
        self.alice.send_error.assert_called_once()
        user.store.fail = False
        await self.mutate(operation="update", value=profile(name="Changed"))
        self.assertEqual(user.data["profiles"][0]["name"], "Changed")

    async def test_logged_but_swallowed_storage_failure_is_detected_by_readback(self):
        user = self.manager.user("alice")
        # Simulate Store.async_save returning normally without writing the file.
        with patch.object(fixtures.MemoryStore, "async_save", new=AsyncMock()):
            await self.mutate()
        self.assertEqual(self.alice.send_error.call_args.args[1], "storage_error")
        self.assertIsNone(user.data)
        self.assertEqual((await user.async_load())["revision"], 0)

    async def test_shutdown_during_mutation_preparation_rejects_without_writing_or_notifying(self):
        await self.mutate()
        await self.subscribe(self.alice)
        self.alice.send_event.reset_mock()
        user = self.manager.user("alice")
        before = deepcopy(user.data)
        prepare = self.manager._prepare_mutation

        async def executor(function, *args):
            result = await asyncio.to_thread(function, *args)
            if function is prepare:
                self.hass.is_stopping = True
            return result

        with patch.object(self.hass, "async_add_executor_job", side_effect=executor), \
                patch.object(fixtures.MemoryStore, "async_save", new=AsyncMock()) as save:
            await self.mutate(operation="update", value=profile(name="Changed"))
        save.assert_not_awaited()
        self.alice.send_error.assert_called_once_with(12, "storage_error",
            "Home Assistant is stopping. Keep your draft and retry after it restarts.")
        self.alice.send_result.assert_not_called()
        self.alice.send_event.assert_not_called()
        self.assertIsNone(user.data)
        self.assertEqual(self.hass.data["test_storage"][user.store.key], before)
        self.assertEqual(await user.async_load(), before)

    async def test_invalid_server_document_is_never_replaced_with_defaults(self):
        user = self.manager.user("alice")
        for invalid in ({}, {"version": 7}, {"version": profiles.SCHEMA_VERSION, "revision": 0, "profiles": {}}):
            with self.subTest(invalid=invalid):
                self.hass.data.setdefault("test_storage", {})[user.store.key] = deepcopy(invalid)
                user.data = None
                await self.subscribe(self.alice)
                self.assertEqual(self.alice.send_error.call_args.args[1], "invalid_data")
                self.assertIsNone(user.data)
                await self.mutate(revision=0)
                self.assertEqual(self.hass.data["test_storage"][user.store.key], invalid)

    async def test_storage_load_failures_are_not_reported_as_first_time_setup(self):
        self.hass.async_add_executor_job = AsyncMock(side_effect=OSError("Disk offline"))
        with self.assertLogs(profiles._LOGGER, level="ERROR"):
            await self.subscribe(self.alice)
        self.assertEqual(self.alice.send_error.call_args.args[1], "storage_error")
        self.assertIsNone(self.manager.user("alice").data)
        self.alice.send_event.assert_not_called()

    async def test_bad_profile_values_and_mismatched_ids_cannot_change_saved_data(self):
        await self.mutate()
        before = deepcopy(self.manager.user("alice").data)
        invalid_values = []
        for key, value in [("visibility", "invalid"), ("routes", ["invalid"]), ("unexpected_setting", True)]:
            invalid = profile()
            invalid["settings"][key] = value
            invalid_values.append(invalid)
        invalid = profile()
        invalid["position"] = {"x": 0.5}
        invalid_values.append(invalid)
        for path in ("//evil.test", "/\\evil.test", "javascript:alert(1)"):
            invalid = profile()
            invalid["settings"]["links"][0]["path"] = path
            invalid_values.append(invalid)
        for invalid in invalid_values:
            await self.mutate(operation="update", value=invalid)
            self.assertEqual(self.alice.send_error.call_args.args[1], "invalid_data")
            self.assertEqual(self.manager.user("alice").data, before)

    async def test_subscribe_unsubscribe_reload_disable_and_readd(self):
        await self.mutate()
        await self.subscribe(self.alice)
        self.alice.subscriptions.pop(7)()
        self.assertFalse(self.manager.user("alice").listeners)
        await self.subscribe(self.alice, 8)
        await integration.async_unload_entry(self.hass, self.entry)
        self.assertFalse(self.manager.user("alice").listeners)
        self.assertFalse(self.alice.subscriptions)
        await self.mutate(operation="delete")
        self.assertEqual(self.alice.send_error.call_args.args[1], "disabled")
        await integration.async_setup_entry(self.hass, self.entry)
        await self.subscribe(self.alice, 9)
        self.assertEqual(self.alice.send_event.call_args.args[1]["profiles"], [profile()])
        self.assertEqual(len(self.manager.user("alice").listeners), 1)


class ConfirmedStorageTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "profiles"
        self.hass = SimpleNamespace(data={}, is_stopping=False, async_add_executor_job=asyncio.to_thread)
        self.store = profiles.ConfirmedStore(self.hass, profiles.SCHEMA_VERSION, "profiles")
        self.store.path = str(self.path)
        self.document = {"version": profiles.SCHEMA_VERSION, "revision": 1, "profiles": [profile()]}

    async def test_invalid_saved_external_urls_leave_storage_untouched(self):
        manager = profiles.ProfileStore(self.hass, "test-instance")
        for path in EXTERNAL_URL_CASES["invalid"]:
            with self.subTest(path=path):
                document = deepcopy(self.document)
                document["profiles"][0]["settings"]["links"][0].update(type="external", path=path)
                self.path.write_text(json.dumps({"version": 1, "data": document}), encoding="utf-8")
                before = self.path.read_bytes(), self.path.stat().st_mtime_ns
                user = profiles.UserProfiles(self.store)
                with patch.object(fixtures.MemoryStore, "async_load", new=AsyncMock()) as load, \
                        patch.object(fixtures.MemoryStore, "async_save", new=AsyncMock()) as save:
                    with self.assertRaises(profiles.ProfileError):
                        await user.async_load()
                    with self.assertRaises(profiles.ProfileError):
                        await manager.mutate(user, {"operation": "create", "profile_id": "new",
                                                    "revision": 0, "profile": profile("new")})
                    load.assert_not_awaited()
                    save.assert_not_awaited()
                self.assertIsNone(user.data)
                self.assertEqual((self.path.read_bytes(), self.path.stat().st_mtime_ns), before)

    async def test_real_storage_preflight_and_confirmed_save(self):
        saved = saved_document()
        self.path.write_text(json.dumps({"version": 1, "minor_version": 1,
                                         "key": self.store.key, "data": saved}), encoding="utf-8")
        before = self.path.read_bytes(), self.path.stat().st_mtime_ns

        async def load_disk(store):
            saved = await store.hass.async_add_executor_job(profiles._read_storage, store.path)
            return saved["data"]

        async def save_disk(store, data):
            self.path.write_text(json.dumps({"version": 1, "minor_version": 1,
                                             "key": store.key, "data": data}), encoding="utf-8")

        user = profiles.UserProfiles(self.store)
        with patch.object(fixtures.MemoryStore, "async_load", new=load_disk), \
                patch.object(fixtures.MemoryStore, "async_save", new=save_disk):
            loaded = await user.async_load()
            expected = deepcopy(saved)
            self.assertEqual(loaded, expected)
            self.assertEqual((self.path.read_bytes(), self.path.stat().st_mtime_ns), before)
            manager = profiles.ProfileStore(self.hass, "test-instance")
            edited = deepcopy(expected["profiles"][0])
            edited["name"] = "Edited profile"
            async with user.lock:
                await manager.mutate(user, {"operation": "update", "profile_id": edited["id"],
                                             "revision": 37, "profile": edited})
            expected["profiles"][0] = edited
            expected["revision"] = 38
            self.assertEqual(json.loads(self.path.read_text(encoding="utf-8"))["data"], expected)
            user.data = None
            self.assertEqual(await user.async_load(), expected)

    async def test_real_readback_rejects_a_swallowed_write_failure(self):
        previous = {**self.document, "revision": 0}
        self.path.write_text(json.dumps({"version": profiles.SCHEMA_VERSION, "data": previous}), encoding="utf-8")
        with patch.object(fixtures.MemoryStore, "async_save", new=AsyncMock()):
            with self.assertRaisesRegex(profiles.ProfileError, "confirm profile data"):
                await self.store.async_save(self.document)
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8"))["data"], previous)

    async def test_shutdown_rejects_saves_before_queuing_or_reading_storage(self):
        self.hass.is_stopping = True
        for previous in (None, {**self.document, "revision": 0}):
            with self.subTest(previous=previous):
                if previous is not None:
                    self.path.write_text(json.dumps({"version": 1, "data": previous}), encoding="utf-8")
                before = self.path.read_bytes() if self.path.exists() else None
                with patch.object(fixtures.MemoryStore, "async_save", new=AsyncMock()) as save, \
                        patch.object(self.hass, "async_add_executor_job", new=AsyncMock()) as executor:
                    with self.assertRaisesRegex(profiles.ProfileError, "Home Assistant is stopping") as error:
                        await self.store.async_save(self.document)
                self.assertEqual(error.exception.code, "storage_error")
                save.assert_not_awaited()
                executor.assert_not_awaited()
                self.assertEqual(self.path.read_bytes() if self.path.exists() else None, before)

    async def test_shutdown_after_write_starts_still_requires_disk_confirmation(self):
        for write_succeeds in (False, True):
            with self.subTest(write_succeeds=write_succeeds):
                self.hass.is_stopping = False
                previous = {**self.document, "revision": 0}
                self.path.write_text(json.dumps({"version": 1, "data": previous}), encoding="utf-8")

                async def save_disk(data):
                    self.hass.is_stopping = True
                    await asyncio.sleep(0)
                    if write_succeeds:
                        self.path.write_text(json.dumps({"version": 1, "data": data}), encoding="utf-8")

                with patch.object(fixtures.MemoryStore, "async_save", new=AsyncMock(side_effect=save_disk)):
                    if write_succeeds:
                        await self.store.async_save(self.document)
                    else:
                        with self.assertRaisesRegex(profiles.ProfileError, "confirm profile data") as error:
                            await self.store.async_save(self.document)
                        self.assertEqual(error.exception.code, "storage_error")
                expected = self.document if write_succeeds else previous
                self.assertEqual(json.loads(self.path.read_text(encoding="utf-8"))["data"], expected)

    async def test_uncertain_commit_reloads_disk_before_accepting_another_mutation(self):
        async def load_disk():
            saved = profiles._read_storage(str(self.path))
            return saved["data"] if saved is not None else None

        async def save_disk(data):
            self.path.write_text(json.dumps({"version": profiles.SCHEMA_VERSION, "data": data}), encoding="utf-8")

        manager = profiles.ProfileStore(self.hass, "test-instance")
        for readback in (OSError("Read-back unavailable"), None, {"version": 1, "data": self.document}):
            with self.subTest(readback=readback), \
                    patch.object(fixtures.MemoryStore, "async_load", new=AsyncMock(side_effect=load_disk)), \
                    patch.object(fixtures.MemoryStore, "async_save", new=AsyncMock(side_effect=save_disk)) as save:
                await save_disk(self.document)
                user = profiles.UserProfiles(self.store)
                notify = Mock()
                user.listeners[(Mock(), 7)] = notify
                async with user.lock:
                    await user.async_load()
                    edited = profile(name="Committed on disk")
                    message = {"operation": "update", "profile_id": edited["id"],
                               "revision": 1, "profile": edited}
                    verification = (Mock(side_effect=readback) if isinstance(readback, Exception)
                                    else Mock(return_value=readback))
                    with patch.object(profiles, "_read_storage", new=verification):
                        with self.assertRaises((OSError, profiles.ProfileError)):
                            await manager.mutate(user, message)
                    committed = {**self.document, "revision": 2, "profiles": [edited]}
                    self.assertEqual(json.loads(self.path.read_text(encoding="utf-8"))["data"], committed)
                    notify.assert_not_called()

                    stale = {**message, "profile": profile(name="Stale overwrite")}
                    with patch.object(self.hass, "async_add_executor_job", side_effect=OSError("Still unavailable")):
                        with self.assertRaises(OSError):
                            await manager.mutate(user, stale)
                    save.assert_awaited_once()

                    with self.assertRaises(profiles.ProfileError) as error:
                        await manager.mutate(user, stale)
                    self.assertEqual(error.exception.code, "conflict")
                    self.assertEqual(user.data, committed)
                    self.assertEqual(json.loads(self.path.read_text(encoding="utf-8"))["data"], committed)
                    save.assert_awaited_once()
                    notify.assert_not_called()

                    await manager.mutate(user, {**stale, "revision": 2})
                    self.assertEqual(user.data["revision"], 3)
                    self.assertEqual(user.data["profiles"], [stale["profile"]])
                    self.assertEqual(json.loads(self.path.read_text(encoding="utf-8"))["data"], user.data)
                    notify.assert_called_once()

    async def test_readback_accepts_only_matching_version_and_document(self):
        async def write(value):
            self.path.write_text(json.dumps({"version": profiles.SCHEMA_VERSION, "data": value}), encoding="utf-8")

        with patch.object(fixtures.MemoryStore, "async_save", new=AsyncMock(side_effect=write)):
            await self.store.async_save(self.document)

    async def test_corrupt_or_null_existing_file_cannot_be_loaded_as_empty(self):
        invalid_document = deepcopy(self.document)
        invalid_document["profiles"][0]["settings"]["unexpected_setting"] = True
        for raw in ("{", "{}", '{"version":1,"data":null}', '{"version":2,"data":{}}',
                    json.dumps({"version": 1, "data": invalid_document})):
            with self.subTest(raw=raw):
                self.path.write_text(raw, encoding="utf-8")
                with patch.object(fixtures.MemoryStore, "async_load", new=AsyncMock()) as load:
                    with self.assertRaises((profiles.ProfileError, json.JSONDecodeError)):
                        await self.store.async_load()
                    load.assert_not_awaited()
                self.assertEqual(self.path.read_text(encoding="utf-8"), raw)


if __name__ == "__main__":
    unittest.main()
