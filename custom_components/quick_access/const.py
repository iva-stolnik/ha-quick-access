"""Shared constants for Quick Access."""

import json
from pathlib import Path

DOMAIN = "quick_access"
NAME = "Quick Access"
FRONTEND_URL = f"/{DOMAIN}"
# manifest.json is the single release version. It also busts browser caches for
# the unhashed entry modules; Vite injects the same value into the frontend.
VERSION: str = json.loads(Path(__file__).with_name("manifest.json").read_text(encoding="utf-8"))["version"]
JS_URL = f"{FRONTEND_URL}/quick_access.js?v={VERSION}"
WS_SUBSCRIBE = f"{DOMAIN}/subscribe_status"
CONFIG_PATH = "quick-access-config"
CONFIG_PANEL_JS_URL = f"{FRONTEND_URL}/quick_access_config.js?v={VERSION}"
MIB = 1024 * 1024
DEFAULT_OPTIONS = {
    "max_profiles": 10,
    "max_categories": 20,
    "max_user_mib": 8,
    "max_profile_mib": 2,
}
# Bound memory, disk and UI work even when an administrator raises quotas.
OPTION_MAXIMUMS = {
    "max_profiles": 100,
    "max_categories": 200,
    "max_user_mib": 16,
    "max_profile_mib": 4,
}
