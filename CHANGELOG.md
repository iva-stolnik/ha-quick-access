# Changelog

## 1.1.0 - 2026-11-10

- Choose Device entities directly from the condition selector when editing device filters, with conditions matching any or all of a device's entities.
- Set a custom percentage threshold for Low battery conditions in entity filters and device entity conditions. Existing filters keep the default of below 20%.
- Open entity details from the matching entities shown under a device, with live names, states and relevant attributes. Updates preserve keyboard focus, and closing details or using browser Back/Forward returns to the correct entity.
- Keep keyboard focus when an entity stops matching an expanded device filter, moving it to the next matching entity or back to the matching-count button.
- Show labels with their Home Assistant names and colors in entity and device details, including inherited device labels for entities. Entity details also show the device class when available.
- Use Exists for label conditions, including NONE groups to find entities or devices without labels.
- Correct filter matching so null values and empty lists or objects count as missing, while zero, false and blank strings remain valid values.
- Clarify filter editing by labeling negated groups NONE and hiding the redundant Equals comparison for smart filters.
- Hide the launcher's Move button action in the touch menu while keeping it available for mouse, pen and keyboard use.

## 1.0.0 - 2026-11-07

Initial release. Requires Home Assistant Core 2025.9.0 or newer.

- Floating launcher on every Home Assistant page, on phones, tablets and desktops. The button can be moved and follows your Home Assistant theme.
- Shortcuts to Home Assistant pages, external websites, scenes and saved filters, with groups, custom icons and colors, and adjustable shortcut grids.
- Entity Explorer and Device Explorer: search with live states, attributes, favorites and recent searches. Both are read-only and open Home Assistant's More Info dialog or device page for controls.
- Built-in and custom filters for entities and devices, including unavailable entities, low batteries, updates and devices with entity issues.
- Per-user profiles stored in Home Assistant and synced across devices, with copies, confirmed deletion and protection against overwriting changes made on another device.
- Page visibility rules to hide the launcher on chosen URLs.
- Quick Access sidebar page to choose each device's profile and recover a hidden launcher.
- Administrator options to limit profiles, groups and storage per user.
- English and Croatian translations.
- Installation through HACS (custom repository) or manually.
