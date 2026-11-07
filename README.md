# Quick Access

<img src="custom_components/quick_access/brand/icon.png" width="64" height="64" alt="Quick Access icon">

A floating shortcut launcher for Home Assistant. Open dashboards, find entities and inspect devices from any page, on mobile, tablet or desktop. Follows your Home Assistant theme. No dashboard card or YAML required.

**Requires Home Assistant Core 2025.9.0 or newer.**

## Features

- Shortcuts to Home Assistant pages, external websites and saved filters.
- Searchable entity and device lists with live states, attributes and favorites.
- Built-in and custom filters, including unavailable entities, low batteries and updates.
- Shortcut groups, adjustable shortcut grids, custom icons and colors.
- Profiles synced across devices, with a movable button and page visibility rules.

## Installation

### HACS

Quick Access is not in the default HACS catalog yet, so add it as a custom repository:

[![Open in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=iva-stolnik&repository=ha-quick-access&category=integration)

1. In **HACS → ⋮ → Custom repositories**, add `https://github.com/iva-stolnik/ha-quick-access` and select **Integration**. The button above does this for you.
2. Find **Quick Access** and download it.
3. Restart Home Assistant.
4. Go to **Settings → Devices & services → Add integration** and add **Quick Access**.
5. Refresh your browser or Companion app.

### Manual

1. Download the [latest release](https://github.com/iva-stolnik/ha-quick-access/releases/latest) and copy `custom_components/quick_access` into your Home Assistant `config/custom_components/` directory.
2. Restart Home Assistant, add **Quick Access** under **Settings → Devices & services**, and refresh the frontend.

[![Add Quick Access to Home Assistant](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=quick_access)

## Usage

Tap **Set up Quick Access** to create or select a profile. Then tap the floating button to open your shortcuts.

- **Entity Explorer / Device Explorer:** search, inspect details and star favorites. These views are read-only; open Home Assistant's More Info dialog or device page for controls.
- **Save current page:** tap the bookmark-plus icon to add the page as a shortcut.
- **Settings:** manage profiles, shortcuts, groups and visibility.
- **Filters:** use the filter icon in an entity or device list to create or edit filters. Add a saved filter as a shortcut for quick access.
- **Button position:** press and hold, then drag. Use the position menu to reset it.

## Profiles

Profiles are saved in Home Assistant for each user and share shortcuts, filters, favorites and visibility rules across devices. Select the same profile on each device to keep them in sync.

The selected profile, button position, launcher toggle and recent searches stay local to each browser and address. When switching between a local and remote URL, select your profile at each address. Clearing browser data keeps your server profiles.

## Troubleshooting

- **Button missing?** Open **Quick Access** in the sidebar or visit `/quick-access-config`. Enable **Show floating launcher**, select a profile or reset its visibility rules.
- **Profiles won't load or save?** Check your Home Assistant connection and retry after reconnecting.
- **Something else?** [Open an issue](https://github.com/iva-stolnik/ha-quick-access/issues) with your Home Assistant version, browser or Companion app version, and steps to reproduce.

## Removal

Delete Quick Access under **Settings → Devices & services**. If installed through HACS, remove it there too and restart Home Assistant. Saved profiles and browser preferences are retained.

## Changelog and license

See the [Changelog](CHANGELOG.md) for release notes. Licensed under [MIT](LICENSE).
