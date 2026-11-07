import {
  formattedEntityName as formatEntityName,
  formattedState as formatState,
} from "./entity-formatting.js";

export function createEntityPresentation({ l10n, ui, getHass }) {
  const t = l10n.message;
  const { node, connectHaContext } = ui;
  const formattedEntityName = (state) => formatEntityName(state, getHass());
  const formattedState = (state, includeUnit = true) =>
    formatState(state, getHass(), t("common.unavailable"), includeUnit);
  function entityIcon(state) {
    const host = node("span", "qap-state-icon");
    const control = node("qap-state-icon", "qap-icon");
    control.hass = getHass();
    control.stateObj = getHass()?.states?.[state?.entity_id] || state;
    control.setAttribute("aria-hidden", "true");
    connectHaContext(host);
    host.append(control);
    return host;
  }

  function updateEntityRow(entry, state) {
    const name = formattedEntityName(state);
    const value = formattedState(state);
    if (entry.lastName !== name) {
      l10n.text(entry.name, () =>
        formattedEntityName(getHass()?.states?.[state.entity_id] || state),
      );
      l10n.property(
        entry.entityId,
        "hidden",
        () =>
          formattedEntityName(getHass()?.states?.[state.entity_id] || state) === state.entity_id,
      );
    }
    if (entry.lastValue !== value)
      l10n.text(entry.value, () => formattedState(getHass()?.states?.[state.entity_id] || state));
    entry.lastName = name;
    entry.lastValue = value;

    const stateIcon = entry.stateIcon.querySelector("qap-state-icon");
    if (stateIcon) {
      stateIcon.hass = getHass();
      stateIcon.stateObj = state;
    }
  }

  return { formattedEntityName, formattedState, entityIcon, updateEntityRow };
}
