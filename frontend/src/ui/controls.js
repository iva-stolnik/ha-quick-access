import { registerUiComponents } from "./components/register.ts";
import { DEFAULT_ICON } from "../profiles/profile-defaults.js";
import { ICON_THEME_COLORS, normalizeIcon, normalizeIconColor } from "../utils/icons.js";
import { connectHaContext as forwardHaContext } from "../core/ha-context.js";

export function createControls({ l10n, node, getHass, getHaRoot, isEnabled }) {
  registerUiComponents();
  const connectHaContext = (host) => forwardHaContext(host, getHaRoot);
  const HA_COMPONENT_LOAD_TIMEOUT_MS = 5000;
  const HA_COMPONENT_LOAD_MAX_ATTEMPTS = 2;
  let haComponentsLoadAttempts = 0;
  let cancelHaComponentsLoading = null;
  const haComponentRegistrations = new Map();
  function createHaComponentRegistration(tag) {
    const listeners = new Set();
    haComponentRegistrations.set(tag, listeners);
    // Keep this promise's scope separate from the subscriber's call frame:
    // an indefinitely pending registration owns only a clearable listener set.
    void customElements
      .whenDefined(tag)
      .then(() => {
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch (error) {
            console.warn("[Quick Access] Could not upgrade a native HA control.", error);
          }
        }
        listeners.clear();
      })
      .catch((error) => {
        listeners.clear();
        console.warn("[Quick Access] Could not observe an HA component registration.", error);
      });
    return listeners;
  }

  function watchHaComponent(tag, callback) {
    if (customElements.get(tag) || !customElements.whenDefined) return () => {};
    const listeners = haComponentRegistrations.get(tag) || createHaComponentRegistration(tag);
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  function loadHaComponents(allowRetry = false) {
    // The icon picker remains an intentional native HA control.
    const tags = ["ha-icon-picker"];
    if (tags.every((tag) => customElements.get(tag))) return;
    if (
      !isEnabled() ||
      cancelHaComponentsLoading ||
      haComponentsLoadAttempts >= HA_COMPONENT_LOAD_MAX_ATTEMPTS ||
      (haComponentsLoadAttempts > 0 && !allowRetry)
    )
      return;
    if (!customElements.get("ha-form") && !window.loadCardHelpers) return;
    // Allow one retry on a later opening or reconnection, never during renders.
    // Keep the page-wide budget across teardown; registration watchers remain live.
    haComponentsLoadAttempts++;
    let loader;
    let finished = false;
    const subscriptions = [];
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      loader?.remove();
      loader = null;
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions.length = 0;
      cancelHaComponentsLoading = null;
    };
    const timeout = setTimeout(finish, HA_COMPONENT_LOAD_TIMEOUT_MS);
    cancelHaComponentsLoading = finish;
    for (const tag of tags)
      subscriptions.push(
        watchHaComponent(tag, () => {
          // This only releases the hidden loader; it never gates control upgrades.
          if (tags.every((name) => customElements.get(name))) finish();
        }),
      );
    void (async () => {
      try {
        // Let HA resolve its own versioned chunks, including selector imports.
        if (!customElements.get("ha-form")) {
          const helpers = await window.loadCardHelpers();
          if (finished) return;
          const card = helpers.createCardElement({ type: "button" });
          await card.constructor.getConfigElement();
        }
        if (finished || !isEnabled()) return;
        loader = node("ha-form");
        loader.hidden = true;
        connectHaContext(loader);
        loader.hass = getHass();
        loader.data = {};
        loader.schema = [{ name: "icon", selector: { icon: {} } }];
        document.body.append(loader);
      } catch (error) {
        console.warn(
          "[Quick Access] Could not load native HA controls; using basic controls.",
          error,
        );
        finish();
      }
    })();
  }

  function focusedElement() {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }

  function focusWhenReady(control, isCurrent = () => true, scroll = false) {
    if (!control) return;
    const focus = () => {
      if (control.isConnected && isCurrent()) {
        if (scroll) control.scrollIntoView({ block: "nearest" });
        control.focus({ preventScroll: true });
      }
    };
    // HA controls delegate focus to an inner element created by Lit's first
    // render. Connecting the host does not mean that inner element exists yet.
    if (control.updateComplete) {
      void control.updateComplete.then(focus).catch((error) => {
        console.warn("[Quick Access] Could not focus a rendered control.", error);
      });
    } else focus();
  }

  function icon(name = DEFAULT_ICON, cls = "") {
    const element = node("qap-icon", `qap-icon ${cls}`);
    element.setAttribute("icon", normalizeIcon(name));
    element.setAttribute("aria-hidden", "true");
    return element;
  }

  function coloredIcon(item) {
    const element = icon(item.icon);
    const color = normalizeIconColor(item.color);
    if (color) {
      element.style.color = ICON_THEME_COLORS.has(color) ? `var(--${color}-color)` : color;
    }
    return element;
  }

  function iconPicker() {
    const element = node("qap-icon-picker");
    element.hass = getHass();
    connectHaContext(element);
    loadHaComponents();
    return element;
  }

  function button(label, onClick, cls = "", tag = "qap-button") {
    const isComponent = tag !== "button";
    const b = node(isComponent ? tag : "button", `qap-button ${cls}`);
    b.type = "button";
    if (isComponent) {
      let appearance = "outlined";
      if (cls.includes("qap-button-primary")) appearance = "accent";
      else if (cls.includes("qap-button-secondary")) appearance = "filled";
      else if (
        cls.includes("qap-linkish") ||
        cls.includes("qap-menu-action") ||
        cls.includes("qap-state-dialog-id-link")
      )
        appearance = "plain";
      b.setAttribute("appearance", appearance);
      b.setAttribute("variant", cls.includes("qap-button-danger") ? "danger" : "brand");
    }
    l10n.text(b, label);
    b.addEventListener("click", (event) => {
      if (!b.disabled) onClick(event);
    });
    return b;
  }

  function leadingIcon(name) {
    const element = icon(name);
    element.slot = "start";
    return element;
  }

  function chipButton(label, onClick, cls = "", selectable = false) {
    const chip = node("qap-chip", `qap-chip ${cls}`, label);
    chip.selectable = selectable;
    l10n.property(chip, "label", label);
    chip.addEventListener("click", (event) => {
      if (!chip.disabled) onClick(event);
    });
    return chip;
  }

  function tabButton(key, label, onClick, cls = "") {
    const tab = chipButton(label, onClick, cls, true);
    if (key === "favorites") tab.classList.add("qap-favorites-tab");
    tab.addEventListener("focusin", () => scrollTabIntoView(tab));
    return tab;
  }

  function scrollTabIntoView(tab) {
    if (!tab.isConnected) return;
    const tabs = tab.parentElement;
    const bounds = tabs.getBoundingClientRect();
    const rect = tab.getBoundingClientRect();
    // Scroll only the tab row, preserving the list/dialog's vertical position.
    if (rect.left < bounds.left) tabs.scrollLeft += rect.left - bounds.left;
    else if (rect.right > bounds.right) tabs.scrollLeft += rect.right - bounds.right;
  }

  function setTabActive(tab, active) {
    tab.selected = active;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-pressed", String(active));
    if (active) {
      // Wait for mounting and the chip render before measuring its width.
      void Promise.resolve(tab.updateComplete)
        .then(() => {
          if (tab.classList.contains("is-active")) scrollTabIntoView(tab);
        })
        .catch((error) => {
          console.warn("[Quick Access] Could not reveal a selected tab.", error);
        });
    }
  }

  function setIconButtonLabel(control, label) {
    l10n.property(control, "label", label);
    l10n.attribute(control, "aria-label", label);
    l10n.property(control, "title", label);
  }

  function iconButton(name, title, onClick, cls = "", href, tag = "qap-icon-button") {
    const className = `qap-icon-button ${cls}`;
    const b = node(tag, className);
    if (href) b.href = href;
    else {
      b.type = "button";
      b.addEventListener("click", (event) => {
        if (!b.disabled) onClick(event);
      });
    }
    setIconButtonLabel(b, title);
    b.append(icon(name));
    return b;
  }

  function errorMessage() {
    const message = node("qap-alert", "qap-error");
    message.alertType = "error";
    message.setAttribute("role", "alert");
    return message;
  }

  return {
    loadHaComponents,
    focusedElement,
    focusWhenReady,
    icon,
    coloredIcon,
    iconPicker,
    button,
    leadingIcon,
    chipButton,
    tabButton,
    setTabActive,
    setIconButtonLabel,
    iconButton,
    errorMessage,
    connectHaContext,
    dispose() {
      cancelHaComponentsLoading?.();
    },
  };
}
