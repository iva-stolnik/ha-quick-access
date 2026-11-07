"""Set up the Quick Access frontend from a config entry."""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.components.frontend import (
    add_extra_js_url,
    async_remove_panel,
    remove_extra_js_url,
)
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import (
    CONFIG_PANEL_JS_URL, CONFIG_PATH, DOMAIN, FRONTEND_URL, JS_URL, NAME,
    WS_SUBSCRIBE,
)
from .profiles import ProfileStore, async_register_profiles

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
EVENT_FRONTEND_UPDATED = f"{DOMAIN}_frontend_updated"


@dataclass
class FrontendData:
    """Keep registrations for the HA process, separately from entry activation."""

    profiles: ProfileStore
    static_registered: bool = False
    entry_id: str | None = None


@websocket_api.websocket_command({"type": WS_SUBSCRIBE})
@callback
def websocket_subscribe_status(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Send initial activation state and subsequent unload/reload updates."""

    @callback
    def send_status(event: Event | None = None) -> None:
        data: FrontendData = hass.data[DOMAIN]
        connection.send_event(
            msg["id"],
            {"enabled": data.entry_id is not None, "entry_id": data.entry_id},
        )

    connection.subscriptions[msg["id"]] = hass.bus.async_listen(
        EVENT_FRONTEND_UPDATED, send_status
    )
    connection.send_result(msg["id"])
    send_status()


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the lifecycle API."""
    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = FrontendData(profiles=await async_register_profiles(hass))
        websocket_api.async_register_command(hass, websocket_subscribe_status)

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Register assets once and activate the frontend on each entry setup."""
    data: FrontendData = hass.data[DOMAIN]
    if data.entry_id == entry.entry_id:
        return True

    if not data.static_registered:
        frontend_dir = Path(__file__).parent / "frontend"
        await hass.http.async_register_static_paths(
            [StaticPathConfig(FRONTEND_URL, str(frontend_dir), cache_headers=False)]
        )
        data.static_registered = True

    await async_register_panel(
        hass,
        frontend_url_path=CONFIG_PATH,
        webcomponent_name="quick-access-config",
        module_url=CONFIG_PANEL_JS_URL,
        sidebar_title=NAME,
        sidebar_icon="mdi:gesture-tap",
        require_admin=False,
    )
    data.profiles.options = lambda: dict(entry.options)
    entry.async_on_unload(entry.add_update_listener(async_options_updated))
    add_extra_js_url(hass, JS_URL)
    data.entry_id = entry.entry_id
    hass.bus.async_fire(EVENT_FRONTEND_UPDATED)
    return True


async def async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Apply saved options to connected users without reloading the entry."""
    data: FrontendData = hass.data[DOMAIN]
    if data.entry_id == entry.entry_id:
        await data.profiles.notify_limits()


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Stop frontend loading and deactivate already connected clients."""
    data: FrontendData = hass.data[DOMAIN]
    if data.entry_id == entry.entry_id:
        remove_extra_js_url(hass, JS_URL)
        async_remove_panel(hass, CONFIG_PATH)
        data.entry_id = None
        data.profiles.close_subscriptions()
        hass.bus.async_fire(EVENT_FRONTEND_UPDATED)
    # HA has no public static-path unregister API. Retain the route and lifecycle
    # command until restart so reloading does not register duplicate routes and
    # existing clients can receive the next activation state.
    return True
