import { QapButton, QapIconButton } from "./button";
import { QapInput, QapSelect, QapCheckbox } from "./fields";
import { QapAlert } from "./alert";
import { QapDialog } from "./dialog";
import { QapIcon, QapIconPicker } from "./icons";
import { QapStateIcon } from "./state-icon";
import { QapSearch } from "./search";
import { QapChip } from "./chip";
import { QapTooltip } from "./tooltip";
import { QapList, QapListItem } from "./list";
import { QapMenu, QapMenuItem } from "./menu";
import { QapToast } from "./toast";
import { QapRadioGroup, QapRadioOption } from "./radio";
import { QapEntitySelector } from "./entity-selector";
import { QapSelectSelector } from "./select-selector";
import type { QapAttributesViewer } from "./attributes-viewer";
import { QapSortable } from "./sortable";

// Importing a feature remains inert; its UI owner registers on first use.
export function registerUiComponents() {
  const components = {
    "qap-button": QapButton,
    "qap-icon-button": QapIconButton,
    "qap-input": QapInput,
    "qap-select": QapSelect,
    "qap-checkbox": QapCheckbox,
    "qap-alert": QapAlert,
    "qap-dialog": QapDialog,
    "qap-icon": QapIcon,
    "qap-state-icon": QapStateIcon,
    "qap-icon-picker": QapIconPicker,
    "qap-search": QapSearch,
    "qap-chip": QapChip,
    "qap-tooltip": QapTooltip,
    "qap-list": QapList,
    "qap-list-item": QapListItem,
    "qap-menu": QapMenu,
    "qap-menu-item": QapMenuItem,
    "qap-toast": QapToast,
    "qap-radio-group": QapRadioGroup,
    "qap-radio-option": QapRadioOption,
    "qap-entity-selector": QapEntitySelector,
    "qap-select-selector": QapSelectSelector,
    "qap-sortable": QapSortable,
  };
  for (const [tag, component] of Object.entries(components)) {
    if (!customElements.get(tag)) customElements.define(tag, component);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "qap-button": QapButton;
    "qap-icon-button": QapIconButton;
    "qap-input": QapInput;
    "qap-select": QapSelect;
    "qap-checkbox": QapCheckbox;
    "qap-alert": QapAlert;
    "qap-dialog": QapDialog;
    "qap-icon": QapIcon;
    "qap-icon-picker": QapIconPicker;
    "qap-state-icon": QapStateIcon;
    "qap-search": QapSearch;
    "qap-chip": QapChip;
    "qap-tooltip": QapTooltip;
    "qap-list": QapList;
    "qap-list-item": QapListItem;
    "qap-menu": QapMenu;
    "qap-menu-item": QapMenuItem;
    "qap-toast": QapToast;
    "qap-radio-group": QapRadioGroup;
    "qap-radio-option": QapRadioOption;
    "qap-entity-selector": QapEntitySelector;
    "qap-select-selector": QapSelectSelector;
    "qap-attributes-viewer": QapAttributesViewer;
    "qap-sortable": QapSortable;
  }
}
