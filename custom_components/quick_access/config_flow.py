"""UI setup for Quick Access."""

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.config_entries import ConfigFlowResult
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import DOMAIN, NAME, OPTION_MAXIMUMS
from .options import effective_options, validate_options


class QuickAccessConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle UI setup."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> "QuickAccessOptionsFlow":
        """Use HA's administrator-only options interface for global limits."""
        return QuickAccessOptionsFlow()

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Create the single config entry immediately, with no form."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        return self.async_create_entry(title=NAME, data={})


class QuickAccessOptionsFlow(config_entries.OptionsFlow):
    """Save resource limits through HA's config-entry persistence."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:
        """Keep the existing defaults, bounds and cross-field validation."""
        errors: dict[str, str] = {}
        if user_input is not None:
            # HA's number selector returns floats, including for whole numbers.
            user_input = {
                key: int(value) if type(value) is float and value.is_integer() else value
                for key, value in user_input.items()
            }
            errors = validate_options(user_input)
            if not errors:
                return self.async_create_entry(
                    title="", data={**self.config_entry.options, **user_input},
                )
        values = effective_options(self.config_entry.options)
        if user_input is not None:
            values.update(user_input)
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({
                vol.Required(key, default=values[key]): selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        min=1, max=maximum, step=1,
                        mode=selector.NumberSelectorMode.BOX,
                    ),
                )
                for key, maximum in OPTION_MAXIMUMS.items()
            }),
            errors=errors,
        )
