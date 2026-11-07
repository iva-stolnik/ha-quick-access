"""Lifecycle tests using HA API doubles and the real integration requirements."""

import asyncio
from dataclasses import dataclass
from enum import StrEnum
import importlib
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

ROOT = Path(__file__).resolve().parents[1]
DOMAIN = "quick_access"


class AbortFlow(Exception):
    """Represent HA's duplicate-flow abort in the API double."""


class ConfigFlow:
    """Implement only the HA flow API exercised by this integration."""

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__()

    def __init__(self):
        self.unique_id = None
        self.existing_ids = set()

    async def async_set_unique_id(self, unique_id):
        self.unique_id = unique_id

    def _abort_if_unique_id_configured(self):
        if self.unique_id in self.existing_ids:
            raise AbortFlow("already_configured")

    def async_show_form(self, **kwargs):
        return {"type": "form", **kwargs}

    def async_create_entry(self, **kwargs):
        return {"type": "create_entry", **kwargs}


@dataclass
class StaticPathConfig:
    url_path: str
    path: str
    cache_headers: bool = True


class NumberSelectorMode(StrEnum):
    BOX = "box"


@dataclass
class NumberSelector:
    config: dict


def module(name, **members):
    result = ModuleType(name)
    result.__dict__.update(members)
    return result


def load_integration():
    """Load real integration code with isolated, minimal HA API doubles."""
    websocket_api = module(
        "homeassistant.components.websocket_api",
        websocket_command=lambda schema: lambda func: func,
        async_register_command=Mock(),
        ActiveConnection=object,
        async_response=lambda func: func,
    )
    frontend = module(
        "homeassistant.components.frontend",
        add_extra_js_url=Mock(),
        remove_extra_js_url=Mock(),
        async_remove_panel=Mock(),
    )
    modules = {
        "voluptuous": module(
            "voluptuous", Required=lambda key, **kwargs: (key, kwargs.get("default")), Optional=lambda key: key,
            In=lambda values: values, All=lambda *values: values,
            Range=lambda **kwargs: kwargs, Schema=lambda schema: schema,
        ),
        "homeassistant": module("homeassistant"),
        "homeassistant.components": module(
            "homeassistant.components", websocket_api=websocket_api
        ),
        "homeassistant.components.websocket_api": websocket_api,
        "homeassistant.components.websocket_api.messages": module(
            "homeassistant.components.websocket_api.messages",
            construct_event_message=lambda message_id, payload: (
                b'{"id":' + str(message_id).encode() + b',"type":"event","event":' + payload + b'}'
            ),
            construct_result_message=lambda message_id, payload: (
                b'{"id":' + str(message_id).encode()
                + b',"type":"result","success":true,"result":' + payload + b'}'
            ),
        ),
        "homeassistant.components.frontend": frontend,
        "homeassistant.components.panel_custom": module(
            "homeassistant.components.panel_custom", async_register_panel=AsyncMock(),
        ),
        "homeassistant.components.http": module(
            "homeassistant.components.http", StaticPathConfig=StaticPathConfig
        ),
        "homeassistant.config_entries": module(
            "homeassistant.config_entries",
            ConfigEntry=object, ConfigFlow=ConfigFlow, OptionsFlow=ConfigFlow,
            ConfigFlowResult=dict,
        ),
        "homeassistant.core": module(
            "homeassistant.core", HomeAssistant=object, Event=object,
            callback=lambda func: func,
        ),
        "homeassistant.helpers": module("homeassistant.helpers"),
        "homeassistant.helpers.selector": module(
            "homeassistant.helpers.selector",
            NumberSelector=NumberSelector, NumberSelectorConfig=dict,
            NumberSelectorMode=NumberSelectorMode,
        ),
        "homeassistant.helpers.config_validation": module(
            "homeassistant.helpers.config_validation",
            config_entry_only_config_schema=lambda domain: lambda config: config,
        ),
        "homeassistant.helpers.typing": module(
            "homeassistant.helpers.typing", ConfigType=dict
        ),
        "homeassistant.helpers.instance_id": module(
            "homeassistant.helpers.instance_id", async_get=AsyncMock(return_value="test-instance"),
        ),
        "homeassistant.helpers.json": module(
            "homeassistant.helpers.json", json_bytes=lambda value: json.dumps(value).encode("utf-8"),
        ),
        "homeassistant.helpers.storage": module(
            "homeassistant.helpers.storage", Store=MemoryStore,
        ),
    }
    with patch.dict(sys.modules, modules):
        integration = importlib.import_module(f"custom_components.{DOMAIN}")
        flow = importlib.import_module(f"custom_components.{DOMAIN}.config_flow")
        profiles = importlib.import_module(f"custom_components.{DOMAIN}.profiles")
        constants = importlib.import_module(f"custom_components.{DOMAIN}.const")
    return integration, flow, frontend, websocket_api, profiles, constants


class MemoryStore:
    """HA storage double: persisted data changes only after successful writes."""

    def __class_getitem__(cls, item):
        return cls

    def __init__(self, hass, version, key, **kwargs):
        self.key = key
        self.hass = hass
        self.options = kwargs
        self.fail = False
        self.path = key

    async def async_load(self):
        from copy import deepcopy
        return deepcopy(self.hass.data.setdefault("test_storage", {}).get(self.key))

    async def async_save(self, value):
        from copy import deepcopy
        await asyncio.sleep(0)
        if self.fail:
            raise OSError("Disk unavailable")
        self.hass.data.setdefault("test_storage", {})[self.key] = deepcopy(value)


integration, config_flow, frontend, websocket_api, profiles, constants = load_integration()


class IntegrationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.listeners = {}

        def listen(event, callback):
            self.listeners.setdefault(event, []).append(callback)
            return lambda: self.listeners[event].remove(callback)

        def fire(event):
            for callback in self.listeners.get(event, [])[:]:
                callback(SimpleNamespace())

        self.hass = SimpleNamespace(
            data={},
            is_stopping=False,
            http=SimpleNamespace(async_register_static_paths=AsyncMock()),
            bus=SimpleNamespace(async_listen=listen, async_fire=Mock(side_effect=fire)),
        )
        async def executor(function, *args):
            if function is profiles._read_storage:
                from copy import deepcopy
                value = self.hass.data.setdefault("test_storage", {}).get(args[0])
                return {"version": profiles.SCHEMA_VERSION, "data": deepcopy(value)} if value is not None else None
            return await asyncio.to_thread(function, *args)

        self.hass.async_add_executor_job = executor
        self.entry = self.make_entry("quick-access-entry")

        def update(entry, *, options):
            entry.options = options
            self.hass.data.setdefault("saved_options", {})[entry.entry_id] = dict(options)
            self.hass.pending_updates.append(integration.async_options_updated(self.hass, entry))

        self.hass.pending_updates = []
        self.hass.config_entries = SimpleNamespace(
            async_update_entry=Mock(side_effect=update),
        )
        frontend.add_extra_js_url.reset_mock()
        frontend.remove_extra_js_url.reset_mock()
        websocket_api.async_register_command.reset_mock()

    @staticmethod
    def make_entry(entry_id, options=None):
        return SimpleNamespace(entry_id=entry_id, options=options or {},
                               domain=DOMAIN,
                               async_on_unload=Mock(), add_update_listener=Mock(return_value=lambda: None))

    async def test_ui_setup_does_not_load_assets_until_entry_exists(self):
        self.assertTrue(await integration.async_setup(self.hass, {}))
        self.hass.http.async_register_static_paths.assert_not_awaited()
        frontend.add_extra_js_url.assert_not_called()
        self.assertEqual(websocket_api.async_register_command.call_count, 3)

    async def test_setup_reload_and_readd_do_not_duplicate_static_paths(self):
        await integration.async_setup(self.hass, {})
        await integration.async_setup_entry(self.hass, self.entry)
        await integration.async_setup_entry(self.hass, self.entry)
        self.hass.http.async_register_static_paths.assert_awaited_once()
        [paths], _ = self.hass.http.async_register_static_paths.call_args
        self.assertEqual(paths[0].url_path, f"/{DOMAIN}")
        self.assertTrue(Path(paths[0].path, "quick_access.js").is_file())
        self.assertFalse(paths[0].cache_headers)
        frontend.add_extra_js_url.assert_called_once_with(self.hass, integration.JS_URL)
        self.assertTrue(await integration.async_unload_entry(self.hass, self.entry))
        frontend.remove_extra_js_url.assert_called_once_with(self.hass, integration.JS_URL)
        self.assertIsNone(self.hass.data[DOMAIN].entry_id)
        await integration.async_setup_entry(self.hass, self.entry)
        await integration.async_unload_entry(self.hass, self.entry)
        await integration.async_setup_entry(self.hass, self.make_entry("new-entry"))
        self.hass.http.async_register_static_paths.assert_awaited_once()
        self.assertEqual(frontend.add_extra_js_url.call_count, 3)

    async def test_restart_registers_assets_for_persisted_entry(self):
        for _ in range(2):
            self.hass.data = {}
            await integration.async_setup(self.hass, {})
            await integration.async_setup_entry(self.hass, self.entry)
        self.assertEqual(self.hass.http.async_register_static_paths.await_count, 2)
        self.assertEqual(websocket_api.async_register_command.call_count, 6)

    async def test_subscription_initial_state_unload_reload_and_unsubscribe(self):
        await integration.async_setup(self.hass, {})
        connection = SimpleNamespace(subscriptions={}, send_result=Mock(), send_event=Mock())
        integration.websocket_subscribe_status(self.hass, connection, {"id": 17})
        connection.send_result.assert_called_once_with(17)
        connection.send_event.assert_called_with(17, {"enabled": False, "entry_id": None})
        await integration.async_setup_entry(self.hass, self.entry)
        connection.send_event.assert_called_with(17, {"enabled": True, "entry_id": self.entry.entry_id})
        await integration.async_unload_entry(self.hass, self.entry)
        connection.send_event.assert_called_with(17, {"enabled": False, "entry_id": None})
        await integration.async_setup_entry(self.hass, self.entry)
        connection.send_event.assert_called_with(17, {"enabled": True, "entry_id": self.entry.entry_id})
        connection.subscriptions[17]()
        connection.send_event.reset_mock()
        await integration.async_unload_entry(self.hass, self.entry)
        connection.send_event.assert_not_called()

    async def test_static_registration_failure_can_retry(self):
        await integration.async_setup(self.hass, {})
        self.hass.http.async_register_static_paths.side_effect = OSError("unavailable")
        with self.assertRaises(OSError):
            await integration.async_setup_entry(self.hass, self.entry)
        self.assertFalse(self.hass.data[DOMAIN].static_registered)
        self.assertIsNone(self.hass.data[DOMAIN].entry_id)
        frontend.add_extra_js_url.assert_not_called()
        self.hass.http.async_register_static_paths.side_effect = None
        self.assertTrue(await integration.async_setup_entry(self.hass, self.entry))

    async def test_ui_flow_sets_unique_id_and_aborts_duplicates(self):
        flow = config_flow.QuickAccessConfigFlow()
        result = await flow.async_step_user()
        self.assertEqual(result, {"type": "create_entry", "title": "Quick Access", "data": {}})
        self.assertEqual(flow.unique_id, DOMAIN)
        flow.existing_ids.add(DOMAIN)
        with self.assertRaisesRegex(AbortFlow, "already_configured"):
            await flow.async_step_user()

    async def test_sidebar_panel_is_accessible_to_nonadmins_and_reload_without_duplicates(self):
        await integration.async_setup(self.hass, {})
        with patch.object(integration, "async_register_panel", new_callable=AsyncMock) as register, patch.object(integration, "async_remove_panel") as remove:
            await integration.async_setup_entry(self.hass, self.entry)
            await integration.async_setup_entry(self.hass, self.entry)
            self.assertEqual(register.await_count, 1)
            register.assert_any_await(self.hass, frontend_url_path="quick-access-config",
                webcomponent_name="quick-access-config", module_url=integration.CONFIG_PANEL_JS_URL,
                sidebar_title="Quick Access", sidebar_icon="mdi:gesture-tap", require_admin=False)
            self.entry.add_update_listener.assert_called_once_with(integration.async_options_updated)
            self.entry.async_on_unload.assert_called_once()
            await integration.async_unload_entry(self.hass, self.entry)
            self.assertEqual(remove.call_count, 1)
            remove.assert_any_call(self.hass, "quick-access-config")
            await integration.async_setup_entry(self.hass, self.entry)
            self.assertEqual(register.await_count, 2)

    async def test_config_panel_registration_failure_can_retry(self):
        await integration.async_setup(self.hass, {})
        with patch.object(integration, "async_register_panel", new_callable=AsyncMock) as register, patch.object(integration, "async_remove_panel") as remove:
            register.side_effect = ValueError("failed")
            with self.assertRaisesRegex(ValueError, "failed"):
                await integration.async_setup_entry(self.hass, self.entry)
            remove.assert_not_called()
            self.assertIsNone(self.hass.data[DOMAIN].entry_id)
            register.side_effect = None
            await integration.async_setup_entry(self.hass, self.entry)
            self.hass.http.async_register_static_paths.assert_awaited_once()

    def options_flow(self):
        flow = config_flow.QuickAccessConfigFlow.async_get_options_flow(self.entry)
        flow.config_entry = self.entry  # HA attaches this before starting the step.
        return flow

    async def test_native_options_form_defaults_and_saved_values(self):
        for options, expected in (
            ({}, constants.DEFAULT_OPTIONS),
            ({"max_profiles": 27}, {**constants.DEFAULT_OPTIONS, "max_profiles": 27}),
        ):
            self.entry.options = options
            result = await self.options_flow().async_step_init()
            self.assertEqual(result["type"], "form")
            self.assertEqual(result["errors"], {})
            self.assertEqual(dict(result["data_schema"]), {
                (key, expected[key]): NumberSelector({
                    "min": 1, "max": maximum, "step": 1, "mode": "box",
                })
                for key, maximum in constants.OPTION_MAXIMUMS.items()
            })
            self.assertEqual(self.entry.options, options)

    async def test_native_options_validate_all_limits_and_preserve_invalid_input(self):
        defaults = constants.DEFAULT_OPTIONS
        for key, maximum in constants.OPTION_MAXIMUMS.items():
            for value in (0, maximum + 1, 1.5, True, "2", None):
                result = await self.options_flow().async_step_init({**defaults, key: value})
                self.assertEqual(result["type"], "form")
                self.assertEqual(result["errors"][key], "invalid_limit")
        result = await self.options_flow().async_step_init({**defaults, "max_user_mib": 1})
        self.assertEqual(result["errors"], {"max_profile_mib": "profile_exceeds_user"})
        self.assertEqual(self.entry.options, {})

    async def test_native_options_save_selector_whole_numbers_as_integers(self):
        values = {key: float(value) for key, value in constants.DEFAULT_OPTIONS.items()}
        result = await self.options_flow().async_step_init(values)
        self.assertEqual(result["type"], "create_entry")
        self.assertEqual(result["data"], constants.DEFAULT_OPTIONS)
        self.assertTrue(all(type(value) is int for value in result["data"].values()))

    async def test_native_options_save_apply_without_reload_and_survive_restart(self):
        await integration.async_setup(self.hass, {})
        await integration.async_setup_entry(self.hass, self.entry)
        manager = self.hass.data[DOMAIN].profiles
        options = {"max_profiles": 3, "max_categories": 5, "max_user_mib": 3, "max_profile_mib": 1}
        result = await self.options_flow().async_step_init(options)
        self.assertEqual(result, {"type": "create_entry", "title": "", "data": options})
        with patch.object(manager, "notify_limits", new=AsyncMock()) as notify:
            # HA's options manager persists the returned data and calls listeners.
            self.hass.config_entries.async_update_entry(self.entry, options=result["data"])
            for update in self.hass.pending_updates:
                await update
            self.hass.pending_updates.clear()
            notify.assert_awaited_once_with()
        self.assertIs(self.hass.data[DOMAIN].profiles, manager)
        self.assertEqual(manager.limits.max_profiles, 3)
        await integration.async_unload_entry(self.hass, self.entry)
        self.entry = SimpleNamespace(**{**vars(self.entry), "options": dict(self.entry.options)})
        await integration.async_setup_entry(self.hass, self.entry)
        self.assertEqual(self.hass.data[DOMAIN].profiles.limits.max_profiles, 3)

    async def test_native_options_preserve_unrelated_stored_options(self):
        self.entry.options = {"future_option": "preserved"}
        result = await self.options_flow().async_step_init(constants.DEFAULT_OPTIONS)
        self.assertEqual(result["data"], {**constants.DEFAULT_OPTIONS, "future_option": "preserved"})

    async def test_only_user_scoped_profile_and_lifecycle_commands_are_registered(self):
        with patch.object(websocket_api, "async_register_command") as register:
            await integration.async_setup(self.hass, {})
            await integration.async_setup(self.hass, {})
        self.assertEqual([call.args[1].__name__ for call in register.call_args_list], [
            "websocket_subscribe_profiles", "websocket_mutate_profile", "websocket_subscribe_status",
        ])

    def test_manifest_and_english_translations(self):
        directory = ROOT / "custom_components" / DOMAIN
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        translation = json.loads((directory / "translations/en.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["domain"], DOMAIN)
        self.assertTrue(manifest["config_flow"])
        self.assertTrue(manifest["single_config_entry"])
        self.assertEqual(manifest["name"], "Quick Access")
        self.assertRegex(manifest["version"], r"\A\d+\.\d+\.\d+\Z")
        self.assertEqual(constants.VERSION, manifest["version"])
        self.assertEqual(config_flow.QuickAccessConfigFlow.VERSION, 1)
        self.assertEqual(integration.JS_URL, f"/quick_access/quick_access.js?v={manifest['version']}")
        self.assertEqual(integration.CONFIG_PANEL_JS_URL, f"/quick_access/quick_access_config.js?v={manifest['version']}")
        self.assertIn("already_configured", translation["config"]["abort"])


if __name__ == "__main__":
    unittest.main()
