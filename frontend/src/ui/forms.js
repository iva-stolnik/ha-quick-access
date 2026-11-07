import { DEFAULT_ICON } from "../profiles/profile-defaults.js";
import { normalizeIconColor } from "../utils/icons.js";
import { currentPageUrl, parseRoutes } from "../utils/urls.js";
import { newId } from "../utils/ids.js";

export function createForms({ l10n, ui, getShell }) {
  const t = l10n.message;
  const {
    node,
    focusWhenReady,
    coloredIcon,
    iconButton,
    button,
    leadingIcon,
    icon,
    replaceLocalizedChildren,
  } = ui;
  const DEFAULT_PICKER_COLOR = "#03a9f4";
  function fieldLabel(title, control, tip) {
    const group = node("div", "qap-field");
    const label = node("label", "qap-field-label", title);
    control.id = newId();
    label.setAttribute("for", control.id);
    group.append(label, control);
    if (tip) group.append(node("small", "qap-field-tip", tip));
    return group;
  }

  function formField(title, control) {
    const element = node("div", "qap-field");
    control.className = "qap-native-control";
    control.id = newId();
    l10n.property(control, "label", title);
    l10n.attribute(control, "aria-label", title);
    element.append(control);
    const listeners = [];
    const notifyChange = () => listeners.forEach((listener) => listener());
    // A select commits once; its native input event precedes the same change.
    if (control.localName !== "qap-select") control.addEventListener("input", notifyChange);
    control.addEventListener("change", notifyChange);
    return {
      element,
      control,
      get value() {
        return control.value ?? "";
      },
      set value(value) {
        control.value = value;
      },
      onChange: (listener) => listeners.push(listener),
    };
  }

  /** Options are `[value, label, group]` tuples or `{ value, label, group, disabled }`. */
  function select(title, options, value) {
    const s = node("qap-select");
    function renderOptions() {
      l10n.property(
        s,
        "options",
        options.map((option) => {
          if (!Array.isArray(option)) return option;
          const [value, label, group] = option;
          return { value, label, group };
        }),
      );
    }
    renderOptions();
    s.value = value;
    const field = formField(title, s);
    field.setOptions = (next) => {
      const value = field.value;
      options = next;
      renderOptions();
      field.value = value;
    };
    return field;
  }

  function selectorField(title, selector, value, tip, source) {
    if (selector.entity) {
      const control = node("qap-entity-selector", "qap-native-control");
      control.value = value;
      control.selector = selector;
      control.source = source;
      control.revision = source?.revision ?? 0;
      l10n.property(control, "label", title);
      l10n.attribute(control, "aria-label", title);
      l10n.property(control, "helper", tip || "");
      l10n.property(control, "clearLabel", t("common.clear"));
      l10n.property(control, "entityLabel", t("entities.entity"));
      l10n.property(control, "addLabel", t("entities.add"));
      l10n.property(control, "searchLabel", t("entities.search"));
      l10n.property(control, "noMatchLabel", t("entities.no_matches"));
      const element = node("div", "qap-field");
      element.append(control);
      const listeners = [];
      control.addEventListener("value-changed", (event) => {
        event.stopPropagation();
        control.value = event.detail?.value ?? (selector.entity.multiple ? [] : "");
        listeners.forEach((listener) => listener());
      });
      return {
        element,
        control,
        get value() {
          return control.value;
        },
        set value(next) {
          control.value = next;
        },
        setSelector(next) {
          selector = next;
          control.selector = next;
        },
        refresh() {
          control.revision = source?.revision ?? 0;
        },
        onChange: (listener) => listeners.push(listener),
      };
    }
    const control = node("qap-select-selector", "qap-native-control");
    control.value = value;
    control.selector = selector;
    control.required = false;
    l10n.property(control, "label", title);
    l10n.attribute(control, "aria-label", title);
    l10n.property(control, "helper", tip || "");
    l10n.property(control, "clearLabel", t("common.clear"));
    l10n.property(control, "searchLabel", t("common.search", {}, "ui.common.search"));
    l10n.property(control, "noMatchLabel", t("filters.values_empty"));
    const element = node("div", "qap-field");
    element.append(control);
    const listeners = [];
    control.addEventListener("value-changed", (event) => {
      event.stopPropagation();
      control.value = event.detail?.value ?? (selector.select.multiple ? [] : "");
      listeners.forEach((listener) => listener());
    });
    return {
      element,
      control,
      get value() {
        return control.value;
      },
      set value(next) {
        control.value = next;
      },
      setSelector(next) {
        selector = next;
        control.selector = next;
      },
      onChange: (listener) => listeners.push(listener),
    };
  }

  function input(title, type, value, properties = {}, tip) {
    const i = node("qap-input");
    const { maxlength, ...rest } = properties;
    l10n.properties(i, { type, ...rest });
    if (maxlength !== undefined) i.maxLength = maxlength;
    i.value = value;
    l10n.property(i, "hint", tip || "");
    return formField(title, i);
  }

  function iconPickerField(title, value, onChange) {
    const element = node("div", "qap-icon-field");
    const listeners = [onChange];
    const notifyChange = () => listeners.forEach((listener) => listener());
    const control = ui.iconPicker();
    control.value = value;
    l10n.property(control, "label", title);
    l10n.property(control, "placeholder", value || DEFAULT_ICON);
    l10n.property(control, "fallbackHint", t("shortcuts.icon_example"));
    control.addEventListener("value-changed", (event) => {
      if (event.target !== control) return;
      control.value = event.detail?.value || "";
      notifyChange();
    });
    element.append(control);
    return {
      element,
      get control() {
        return control;
      },
      get value() {
        return control.value;
      },
      set value(value) {
        control.value = value;
      },
      onChange: (listener) => listeners.push(listener),
    };
  }

  function fieldValidation(field, getError, errorHost) {
    const error = node("p", "qap-field-error");
    error.id = newId();
    error.hidden = true;
    error.setAttribute("aria-live", "polite");
    let pendingFocus = false;
    let focusIsCurrent = () => true;
    const activeControl = () => field.control ?? field;
    const focusControl = () => {
      const control = activeControl();
      focusWhenReady(
        control,
        () => {
          if (activeControl() !== control || error.hidden || !pendingFocus || !focusIsCurrent())
            return false;
          pendingFocus = false;
          return true;
        },
        true,
      );
    };
    const syncControl = () => {
      const control = activeControl();
      const descriptions = new Set(
        [...(control.getAttribute("aria-describedby") || "").split(/\s+/)].filter(
          (id) => id && id !== error.id,
        ),
      );
      if (error.hidden) control.removeAttribute("aria-invalid");
      else {
        control.setAttribute("aria-invalid", "true");
        descriptions.add(error.id);
      }
      if (descriptions.size) control.setAttribute("aria-describedby", [...descriptions].join(" "));
      else control.removeAttribute("aria-describedby");
      const host = errorHost ?? control.parentElement;
      if (!host.contains(error)) host.append(error);
    };
    const validate = () => {
      const message = getError();
      l10n.text(error, message);
      error.hidden = !message;
      if (!message) pendingFocus = false;
      syncControl();
      return !message;
    };
    const revalidate = () => {
      if (!error.hidden) validate();
    };
    if (field.onChange) field.onChange(revalidate);
    else {
      field.addEventListener("input", revalidate);
      field.addEventListener("change", revalidate);
    }
    syncControl();
    return {
      validate,
      revalidate,
      focus: (isCurrent = () => true) => {
        focusIsCurrent = isCurrent;
        pendingFocus = true;
        focusControl();
      },
    };
  }

  function validateFields(fields, isCurrent) {
    const invalid = fields.filter((field) => !field.validate());
    invalid[0]?.focus(isCurrent);
    return !invalid.length;
  }

  function iconColorField(value, onChange) {
    const element = node("div", "qap-field qap-icon-color-field");
    let selectedColor = normalizeIconColor(value);
    function pickerValue() {
      if (/^#[a-f0-9]{6}$/i.test(selectedColor)) return selectedColor;
      const probe = coloredIcon({ icon: DEFAULT_ICON, color: selectedColor });
      if (!selectedColor) probe.style.color = "var(--state-icon-color, var(--qap-blue))";
      getShell().append(probe);
      const resolved = globalThis.getComputedStyle?.(probe).color ?? "";
      probe.remove();
      const rgb = resolved.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
      return rgb
        ? `#${rgb
            .slice(1, 4)
            .map((channel) => Number(channel).toString(16).padStart(2, "0"))
            .join("")}`
        : DEFAULT_PICKER_COLOR;
    }
    const picker = input(t("shortcuts.icon_color"), "color", pickerValue());
    picker.element.classList.add("qap-color-picker");
    const row = node("div", "qap-color-row");
    const swatch = node("div", "qap-color-swatch");
    l10n.property(swatch, "title", t("shortcuts.choose_color"));
    const chip = node("span", "qap-color-chip");
    chip.setAttribute("aria-hidden", "true");
    swatch.append(chip, picker.element);
    const details = node("div", "qap-color-details");
    const status = node("span", "qap-color-value");
    details.append(node("span", "qap-field-label", t("shortcuts.icon_color")), status);
    function updateField() {
      chip.style.backgroundColor = picker.value;
      l10n.text(status, selectedColor || t("shortcuts.theme_default"));
      status.classList.toggle("is-custom", Boolean(selectedColor));
      reset.disabled = !selectedColor;
    }
    picker.onChange(() => {
      selectedColor = normalizeIconColor(picker.value);
      updateField();
      onChange();
    });
    const reset = iconButton(
      "mdi:restore",
      t("shortcuts.use_theme_color"),
      () => {
        selectedColor = "";
        picker.value = pickerValue();
        updateField();
        onChange();
      },
      "qap-icon-color-reset",
    );
    updateField();
    row.append(swatch, details, reset);
    element.append(row);
    return {
      element,
      get value() {
        return selectedColor;
      },
      set value(value) {
        selectedColor = normalizeIconColor(value);
        picker.value = pickerValue();
        updateField();
      },
    };
  }

  function helpControl(learnMore, tooltip) {
    const help = node("div", "qap-field-help");
    tooltip.id ||= newId();
    tooltip.open = false;
    tooltip.setAttribute("role", "tooltip");
    let pinned = false;
    let focused = false;
    let helpVisible = false;
    const showHelp = (visible) => {
      helpVisible = visible;
      tooltip.open = visible;
      learnMore.setAttribute("aria-expanded", String(visible));
    };
    tooltip.addEventListener("close", () => {
      pinned = false;
      showHelp(false);
    });
    learnMore.addEventListener("click", () => {
      pinned = !pinned;
      showHelp(pinned);
    });
    learnMore.setAttribute("aria-describedby", tooltip.id);
    learnMore.setAttribute("aria-controls", tooltip.id);
    learnMore.setAttribute("aria-expanded", "false");
    help.addEventListener("pointerenter", () => showHelp(true));
    help.addEventListener("pointerleave", () => {
      if (!pinned && !focused) showHelp(false);
    });
    learnMore.addEventListener("focusin", () => {
      focused = true;
      showHelp(true);
    });
    learnMore.addEventListener("focusout", (event) => {
      if (learnMore.contains(event.relatedTarget)) return;
      focused = false;
      pinned = false;
      showHelp(false);
    });
    learnMore.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !helpVisible) return;
      event.preventDefault();
      event.stopPropagation();
      pinned = false;
      showHelp(false);
    });
    tooltip.anchorElement = learnMore;
    help.append(learnMore, tooltip);
    return help;
  }

  function urlPathsField(paths, mode) {
    const group = node("div", "qap-field qap-url-paths");
    const heading = node("div", "qap-url-paths-heading");
    const label = node("label", "qap-field-label", t("visibility.url_paths"));
    paths.id = "qap-url-paths";
    paths.setAttribute("aria-describedby", "qap-url-paths-description");
    paths.wrap = "off";
    paths.spellcheck = false;
    paths.autocomplete = "off";
    label.setAttribute("for", paths.id);
    const tooltip = node("qap-tooltip", "qap-url-paths-tooltip");
    tooltip.id = "qap-url-paths-help";
    tooltip.append(node("p", "", t("visibility.one_per_line")));
    tooltip.append(
      node("code", "", "/config/automation/*"),
      node("p", "", t("visibility.wildcard_help")),
    );
    tooltip.append(
      node("code", "", "/lovelace/cameras"),
      node("p", "", t("visibility.exact_help")),
    );
    tooltip.append(
      node("code", "", "/config/example?view=advanced#section"),
      node("p", "", t("visibility.full_url_help")),
    );
    const learnMore = button("", () => {}, "qap-linkish qap-url-paths-learn-more");
    learnMore.id = newId();
    learnMore.append(
      leadingIcon("mdi:information-outline"),
      node("span", "", t("common.learn_more")),
    );
    const help = helpControl(learnMore, tooltip);
    help.classList.add("qap-url-paths-help");
    heading.append(label, help);
    const description = node("p", "qap-field-tip");
    description.id = "qap-url-paths-description";
    const updateDescription = () => {
      l10n.text(
        description,
        t(mode.value === "include" ? "visibility.routes_shown" : "visibility.routes_hidden"),
      );
    };
    mode.onChange(updateDescription);
    updateDescription();
    const editor = node("div", "qap-url-paths-editor");
    const gutter = node("div", "qap-url-paths-gutter");
    gutter.setAttribute("aria-hidden", "true");
    const lines = node("pre", "qap-url-paths-lines");
    gutter.append(lines);
    const syncScroll = () => {
      lines.style.transform = `translateY(-${paths.scrollTop || 0}px)`;
    };
    const updateLines = () => {
      const count = (paths.value || paths.placeholder).split("\n").length;
      l10n.text(lines, Array.from({ length: count }, (_, index) => index + 1).join("\n"));
      syncScroll();
    };
    paths.addEventListener("input", updateLines);
    paths.addEventListener("scroll", syncScroll);
    updateLines();
    editor.append(gutter, paths);
    group.append(heading, description, editor);
    return group;
  }

  function currentUrlCard(currentPath, label, onClick, description = t("visibility.current_path")) {
    const card = node("div", "qap-current-url-card");
    const identity = node("div", "qap-current-url-identity");
    const details = node("div", "qap-current-url-details");
    details.append(
      node("span", "qap-field-tip", description),
      node("strong", "qap-current-url-path", currentPath),
    );
    identity.append(icon("mdi:link-variant"), details);
    const action = button("", onClick, "qap-current-url-action");
    action.append(leadingIcon("mdi:plus"), node("span", "", label));
    card.append(identity, action);
    return { element: card, action };
  }

  function currentUrlRules(paths, currentPath) {
    const section = node("section", "qap-current-url");
    const title = node("h3", "qap-current-url-title", t("visibility.current_page_rules"));
    title.id = newId();
    section.setAttribute("aria-labelledby", title.id);
    const subpagePath = `${currentPath.replace(/\/+$/, "")}/*`;
    section.append(title);
    const fullUrl = currentPageUrl();
    const choices = [currentPath, subpagePath];
    if (!choices.includes(fullUrl)) choices.push(fullUrl);
    const updates = choices.map((route) => {
      const row = node("div", "qap-current-url-row");
      const path = node("code", "qap-current-url-path", route);
      path.id = newId();
      path.title = route;
      const action = button(
        "",
        () => {
          const routes = parseRoutes(paths.value);
          paths.value = (
            routes.includes(route) ? routes.filter((rule) => rule !== route) : [...routes, route]
          ).join("\n");
          paths.dispatchEvent(new Event("input", { bubbles: true }));
        },
        "qap-button-secondary qap-current-url-action",
      );
      action.title = route;
      const actionLabel = node("span");
      actionLabel.id = newId();
      action.setAttribute("aria-labelledby", `${actionLabel.id} ${path.id}`);
      if (route === fullUrl && route !== currentPath) {
        const details = node("div", "qap-current-url-details");
        details.append(node("span", "qap-field-tip", t("visibility.current_full_url")), path);
        row.append(details, action);
      } else row.append(path, action);
      section.append(row);
      return (routes) => {
        const listed = routes.includes(route);
        l10n.text(actionLabel, t(listed ? "common.remove" : "common.add"));
        replaceLocalizedChildren(
          action,
          leadingIcon(listed ? "mdi:minus" : "mdi:plus"),
          actionLabel,
        );
      };
    });
    const update = () => {
      const routes = parseRoutes(paths.value);
      updates.forEach((refresh) => refresh(routes));
    };
    paths.addEventListener("input", update);
    update();
    return section;
  }

  function searchField(placeholder, value, onChange, onCreate = () => {}) {
    const box = node("div", "qap-search");
    const control = node("qap-search", "qap-search-input");
    l10n.property(control, "placeholder", placeholder);
    l10n.property(control, "clearLabel", t("common.clear"));
    l10n.attribute(control, "aria-label", placeholder);
    control.value = value;
    control.addEventListener("input", () => onChange(control.value));
    onCreate(control);
    box.append(control);
    return box;
  }

  return {
    fieldLabel,
    formField,
    select,
    selectorField,
    input,
    iconPickerField,
    fieldValidation,
    validateFields,
    iconColorField,
    helpControl,
    urlPathsField,
    currentUrlCard,
    currentUrlRules,
    searchField,
  };
}
