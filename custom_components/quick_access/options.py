"""Resource-limit defaults and validation for integration configuration."""

from collections.abc import Mapping
from typing import Any

from .const import DEFAULT_OPTIONS, OPTION_MAXIMUMS


def effective_options(options: Mapping[str, Any]) -> dict[str, int]:
    """Apply current ceilings to old options without discarding saved profiles."""
    return {key: min(options.get(key, default), OPTION_MAXIMUMS[key])
            for key, default in DEFAULT_OPTIONS.items()}


def validate_options(options: Mapping[str, Any]) -> dict[str, str]:
    """Reject missing, noninteger and out-of-range quotas before any update."""
    errors = {}
    for key, maximum in OPTION_MAXIMUMS.items():
        value = options.get(key)
        if type(value) is not int or not 1 <= value <= maximum:
            errors[key] = "invalid_limit"
    if not errors and options["max_profile_mib"] > options["max_user_mib"]:
        errors["max_profile_mib"] = "profile_exceeds_user"
    return errors
