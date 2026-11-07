import { profilesByName } from "./profiles/profile-order.ts";
import { registerUiComponents } from "./ui/components/register.ts";
import { subscribeProfiles, resetProfileVisibility } from "./data/profile-api.js";
import { PROFILE_SELECTION_EVENT, LAUNCHER_PREFERENCE_EVENT } from "./profiles/profile-defaults.js";
import {
  profileSelectionKey,
  readProfileSelection,
  writeProfileSelection,
  launcherEnabledKey,
  readLauncherEnabled,
  writeLauncherEnabled,
} from "./utils/storage.js";
import { createLocalizer } from "./localize.js";
import { createDom } from "./ui/dom.js";
import { createForms } from "./ui/forms.js";
import { assetUrl } from "./utils/assets.js";

// Standalone sidebar panel: all profile operations use the authenticated user.
(() => {
  const ELEMENT = "quick-access-config";
  if (customElements.get(ELEMENT)) return;
  registerUiComponents();

  class QuickAccessConfig extends HTMLElement {
    constructor() {
      super();
      this._localizer = createLocalizer();
      this._t = this._localizer.message;
      this._forms = createForms({
        l10n: this._localizer,
        ui: createDom(this._localizer),
        getShell: () => this.shadowRoot,
      });
      this.attachShadow({ mode: "open" });
      this._profileGeneration = 0;
      this._selectionChanged = (event) => {
        if (!this._deviceKey) return;
        if (event.type === "storage") {
          if (event.storageArea && event.storageArea !== localStorage) return;
          if (
            event.key !== null &&
            event.key !== this._deviceKey &&
            event.key !== this._launcherKey
          )
            return;
        } else if (event.detail?.key !== this._deviceKey && event.detail?.key !== this._launcherKey)
          return;
        this._renderDevice();
      };
      this._profilesReady = () => this._connectProfiles();
      this._profilesDisconnected = () => {
        this._stopProfiles();
        this._deviceMessage(this._t("config.errors.disconnected"), true);
        this._renderDevice();
      };
    }

    set hass(value) {
      this._hass = value;
      void this._localizer.setHass(value);
      if (this.isConnected) this._syncContext();
    }

    get hass() {
      return this._hass;
    }

    connectedCallback() {
      if (!this._deviceStatus) this._build();
      window.addEventListener(PROFILE_SELECTION_EVENT, this._selectionChanged);
      window.addEventListener(LAUNCHER_PREFERENCE_EVENT, this._selectionChanged);
      window.addEventListener("storage", this._selectionChanged);
      this._syncContext();
    }

    disconnectedCallback() {
      this._stopProfiles();
      this._detachConnection();
      window.removeEventListener(PROFILE_SELECTION_EVENT, this._selectionChanged);
      window.removeEventListener(LAUNCHER_PREFERENCE_EVENT, this._selectionChanged);
      window.removeEventListener("storage", this._selectionChanged);
      this._context = undefined;
    }

    _build() {
      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = new URL(assetUrl("quick_access_config.css"), location.origin).href;
      const header = document.createElement("header");
      const menu = document.createElement("button");
      menu.className = "menu";
      menu.type = "button";
      menu.textContent = "☰";
      this._localizer.attribute(menu, "aria-label", this._t("config.open_sidebar"));
      menu.addEventListener("click", () =>
        this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true })),
      );
      const title = document.createElement("h1");
      this._localizer.text(title, this._t("launcher.title"));
      header.append(menu, title);
      const main = document.createElement("main");
      this._buildDevice(main);
      this.shadowRoot.append(stylesheet, header, main);
    }

    _section(title) {
      const section = document.createElement("section");
      section.className = "qap-config-card";
      const heading = document.createElement("h2");
      this._localizer.text(heading, title);
      section.append(heading);
      return section;
    }

    _syncContext() {
      if (!this._deviceStatus) return;
      const user = this._hass?.user?.id;
      const connection = this._hass?.connection;
      if (this._context && this._context.user === user && this._context.connection === connection)
        return;
      this._stopProfiles();
      this._detachConnection();
      this._profiles = undefined;
      this._deviceKey = undefined;
      this._launcherKey = undefined;
      this._context = { user, connection };
      const disconnected = !user || !connection || connection.connected === false;
      this._deviceMessage(disconnected ? this._t("config.errors.disconnected") : "", disconnected);
      this._renderDevice();
      if (!user || !connection) return;
      this._profileConnection = connection;
      connection.addEventListener("ready", this._profilesReady);
      connection.addEventListener("disconnected", this._profilesDisconnected);
      void this._connectProfiles();
    }

    _control(tag, configure, install = () => {}) {
      const element = document.createElement(tag);
      configure(element);
      install(element);
      return element;
    }

    _button(property, label, onClick, primary = false) {
      return this._control(
        "qap-button",
        (control) => {
          control.type = "button";
          if (primary) control.className = "primary";
          control.setAttribute("appearance", primary ? "accent" : "outlined");
          this._localizer.text(control, label);
          control.addEventListener("click", () => {
            if (!control.disabled) onClick();
          });
        },
        (control) => {
          if (property) this[property] = control;
        },
      );
    }

    _buildDevice(main) {
      const card = this._section(this._t("config.current_device"));
      this._deviceName = document.createElement("p");
      const help = document.createElement("p");
      this._localizer.text(help, this._t("config.device.description"));
      const launcherSetting = document.createElement("div");
      launcherSetting.className = "launcher-setting";
      const launcherLabel = document.createElement("label");
      launcherLabel.htmlFor = "show-floating-launcher";
      this._localizer.text(launcherLabel, this._t("config.show_floating_launcher"));
      const launcherToggle = this._control(
        "qap-checkbox",
        (control) => {
          control.id = "show-floating-launcher";
          control.switch = true;
          this._localizer.attribute(
            control,
            "aria-label",
            this._t("config.show_floating_launcher"),
          );
          control.addEventListener("change", () => this._setLauncherEnabled(control));
        },
        (control) => {
          this._launcherToggle = control;
        },
      );
      launcherLabel.addEventListener("click", () => launcherToggle.click());
      launcherSetting.append(launcherLabel, launcherToggle);
      // Same select field as the shortcut editor's Shortcut type.
      this._profileField = this._forms.select(this._t("config.select_profile"), [], "");
      this._profileField.control.id = "device-profile";
      this._profileField.onChange(() => this._selectProfile());
      this._profileSelect = this._profileField.control;
      this._deviceStatus = document.createElement("p");
      this._deviceStatus.className = "status device-status";
      this._deviceStatus.hidden = true;
      this._deviceStatus.setAttribute("aria-live", "polite");
      this._button("_profileRetry", this._t("config.refresh_profiles"), () =>
        this._connectProfiles(),
      );
      this._button("_removeSelection", this._t("config.remove_device_selection"), () =>
        this._confirmDeviceAction(false),
      );
      this._button("_resetVisibility", this._t("config.reset_profile_visibility"), () =>
        this._confirmDeviceAction(true),
      );
      const actions = document.createElement("div");
      actions.className = "actions device-actions";
      actions.append(this._removeSelection, this._resetVisibility, this._profileRetry);
      const resetHelp = document.createElement("p");
      this._localizer.text(resetHelp, this._t("config.recovery.sync_info"));
      card.append(
        this._deviceName,
        help,
        launcherSetting,
        this._profileField.element,
        resetHelp,
        actions,
        this._deviceStatus,
      );
      main.append(card);
      this._renderDevice();
    }

    _detachConnection() {
      this._profileConnection?.removeEventListener("ready", this._profilesReady);
      this._profileConnection?.removeEventListener("disconnected", this._profilesDisconnected);
      this._profileConnection = undefined;
    }

    _stopProfiles() {
      this._closeConfirmation();
      this._profileGeneration++;
      const unsubscribe = this._profileUnsubscribe;
      this._profileUnsubscribe = undefined;
      if (unsubscribe)
        void Promise.resolve()
          .then(unsubscribe)
          .catch(() => {});
      this._profilesAvailable = false;
      this._deviceBusy = false;
    }

    _profileContextCurrent(generation) {
      return (
        this.isConnected &&
        generation === this._profileGeneration &&
        this._hass?.user?.id &&
        this._context?.user === this._hass.user.id &&
        this._context.connection === this._hass.connection
      );
    }

    _acceptProfiles(data) {
      if (
        !data ||
        !Number.isSafeInteger(data.revision) ||
        data.revision < 0 ||
        typeof data.instance_id !== "string" ||
        !data.instance_id ||
        !Array.isArray(data.profiles) ||
        data.profiles.some(
          (p) =>
            !p ||
            typeof p.id !== "string" ||
            !p.id ||
            typeof p.name !== "string" ||
            !p.name.trim() ||
            !p.settings ||
            typeof p.settings !== "object" ||
            Array.isArray(p.settings),
        )
      ) {
        throw this._localizer.error(this._t("config.errors.invalid_profiles"));
      }
      if (this._profiles && data.instance_id !== this._profiles.instance_id) {
        throw this._localizer.error(this._t("config.errors.instance_changed"));
      }
      if (this._profiles && data.revision < this._profiles.revision) return;
      this._profiles = JSON.parse(JSON.stringify(data));
      this._deviceKey = profileSelectionKey(data.instance_id, this._context.user);
      this._launcherKey = launcherEnabledKey(data.instance_id, this._context.user);
      this._profilesAvailable = true;
    }

    async _connectProfiles() {
      this._stopProfiles();
      const generation = this._profileGeneration;
      if (!this._profileContextCurrent(generation)) return;
      this._renderDevice();
      try {
        if (this._hass.connection.connected === false)
          throw this._localizer.error(this._t("config.errors.profiles_disconnected"));
        const unsubscribe = await subscribeProfiles(this._hass.connection, (data) => {
          if (!this._profileContextCurrent(generation)) return;
          try {
            this._acceptProfiles(data);
            this._deviceMessage("", false);
          } catch (error) {
            this._profilesAvailable = false;
            this._deviceMessage(this._localizer.errorMessage(error), true);
          }
          this._renderDevice();
        });
        if (!this._profileContextCurrent(generation)) {
          await unsubscribe();
          return;
        }
        this._profileUnsubscribe = unsubscribe;
      } catch (error) {
        if (!this._profileContextCurrent(generation)) return;
        this._profilesAvailable = false;
        this._deviceMessage(
          this._localizer.errorMessage(error) || this._t("config.errors.profiles_failed"),
          true,
        );
        this._renderDevice();
      }
    }

    _selectedId() {
      if (!this._deviceKey) return null;
      return readProfileSelection(this._deviceKey);
    }

    _renderDevice() {
      if (!this._profileSelect) return;
      let selected = null;
      let storageFailed = false;
      try {
        this._launcherToggle.checked = this._launcherKey
          ? readLauncherEnabled(this._launcherKey)
          : true;
      } catch {
        storageFailed = true;
        this._deviceMessage(this._t("config.errors.launcher_read_failed"), true);
      }
      try {
        selected = this._selectedId();
      } catch {
        storageFailed = true;
        this._deviceMessage(this._t("profiles.errors.selection_read_failed"), true);
      }
      const profile = this._profiles?.profiles.find((p) => p.id === selected);
      this._localizer.text(
        this._deviceName,
        profile
          ? this._t("config.selected_profile", { name: profile.name })
          : this._t("config.no_selection"),
      );
      if (selected && !profile && this._profilesAvailable) {
        this._deviceMessage(this._t("config.errors.selection_unavailable"), true);
      }
      this._profileField.setOptions([
        { value: "", label: this._t("config.no_selection"), disabled: Boolean(selected) },
        ...profilesByName(this._profiles?.profiles || []).map((profile) => ({
          value: profile.id,
          label: profile.name,
        })),
      ]);
      this._profileField.value = profile?.id || "";
      const disabled =
        !this._hass?.user?.id || !this._profilesAvailable || this._deviceBusy || storageFailed;
      this._profileSelect.disabled = disabled;
      this._launcherToggle.disabled = !this._hass?.user?.id || !this._launcherKey || storageFailed;
      this._removeSelection.disabled =
        !this._hass?.user?.id || !this._deviceKey || this._deviceBusy || storageFailed || !selected;
      this._resetVisibility.disabled = disabled || !profile;
      this._profileRetry.disabled = Boolean(this._deviceBusy || !this._hass?.user?.id);
    }

    _setLauncherEnabled(control) {
      if (control.disabled) return;
      try {
        writeLauncherEnabled(this._launcherKey, control.checked);
        this._deviceMessage("", false);
      } catch {
        this._deviceMessage(this._t("errors.browser_storage"), true);
      }
      this._renderDevice();
    }

    _writeSelection(id) {
      try {
        writeProfileSelection(this._deviceKey, id);
      } catch {
        this._deviceMessage(this._t("config.errors.selection_save_failed"), true);
        this._renderDevice();
        return false;
      }
      this._renderDevice();
      return true;
    }

    _selectProfile() {
      if (this._profileSelect.disabled) return;
      const id = this._profileSelect.value;
      if (!id) {
        this._renderDevice();
        return;
      }
      if (!this._profiles?.profiles.some((p) => p.id === id)) {
        this._deviceMessage(this._t("config.errors.profile_unavailable"), true);
        void this._connectProfiles();
        return;
      }
      if (this._writeSelection(id)) this._deviceMessage("", false);
    }

    _closeConfirmation() {
      if (!this._confirmation) return;
      this._confirmation.close();
      this._localizer.release(this._confirmation);
      this._confirmation.remove();
      this._confirmation = undefined;
    }

    _confirmDeviceAction(reset) {
      if ((reset ? this._resetVisibility : this._removeSelection).disabled || this._confirmation)
        return;
      let selected;
      try {
        selected = this._selectedId();
      } catch {
        this._renderDevice();
        return;
      }
      const generation = this._profileGeneration;
      this._showConfirmation(
        {
          title: reset
            ? this._t("config.confirm_reset_visibility")
            : this._t("config.confirm_remove_selection"),
          description: reset
            ? this._t("config.reset_description")
            : this._t("config.remove_description"),
          label: reset ? this._t("config.reset_visibility") : this._t("config.remove_selection"),
        },
        () => {
          if (!this._profileContextCurrent(generation)) return;
          try {
            if (selected !== this._selectedId()) {
              this._deviceMessage(this._t("config.errors.selection_changed"), true);
              return;
            }
          } catch {
            this._renderDevice();
            return;
          }
          if (reset) void this._resetProfileVisibility(selected, generation);
          else if (this._writeSelection(null)) this._deviceMessage("", false);
        },
      );
    }

    _showConfirmation({ title: titleText, description: descriptionText, label }, onConfirm) {
      if (this._confirmation) return;
      const dialog = document.createElement("qap-dialog");
      dialog.className = "device-confirmation";
      dialog.type = "alert";
      this._localizer.property(dialog, "label", titleText);
      this._localizer.property(dialog, "description", descriptionText);
      const title = document.createElement("h2");
      title.id = "device-confirm-title";
      this._localizer.text(title, titleText);
      const description = document.createElement("p");
      description.id = "device-confirm-description";
      this._localizer.text(description, descriptionText);
      const actions = document.createElement("div");
      actions.className = "actions";
      const cancel = this._button(null, this._t("common.cancel"), () => this._closeConfirmation());
      const confirm = this._button(
        null,
        label,
        () => {
          this._closeConfirmation();
          onConfirm();
        },
        true,
      );
      confirm.className = "confirm-device primary";
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        this._closeConfirmation();
      });
      actions.append(cancel, confirm);
      dialog.append(title, description, actions);
      this.shadowRoot.append(dialog);
      this._confirmation = dialog;
      dialog.showModal();
      if (cancel.updateComplete)
        void cancel.updateComplete.then(() => {
          if (dialog.open) cancel.focus();
        });
      else cancel.focus();
    }

    async _resetProfileVisibility(id, generation) {
      const profile = this._profiles?.profiles.find((p) => p.id === id);
      if (!profile || !this._profilesAvailable) {
        this._deviceMessage(this._t("config.errors.refresh_selection"), true);
        this._renderDevice();
        return;
      }
      if (this._deviceBusy) return;
      this._deviceBusy = true;
      this._deviceMessage("", false);
      this._renderDevice();
      try {
        if (this._hass.connection.connected === false)
          throw this._localizer.error(this._t("config.errors.reset_disconnected"));
        const result = await resetProfileVisibility(this._hass.connection, id);
        if (!this._profileContextCurrent(generation)) return;
        this._acceptProfiles(result);
        window.dispatchEvent(
          new CustomEvent(PROFILE_SELECTION_EVENT, {
            detail: { key: this._deviceKey, refresh: true },
          }),
        );
        this._deviceMessage("", false);
      } catch (error) {
        if (!this._profileContextCurrent(generation)) return;
        this._deviceMessage(
          this._localizer.errorMessage(error) || this._t("config.errors.reset_failed"),
          true,
        );
      } finally {
        if (this._profileContextCurrent(generation)) {
          this._deviceBusy = false;
          this._renderDevice();
        }
      }
    }

    _deviceMessage(text, error) {
      this._localizer.text(this._deviceStatus, text);
      this._deviceStatus.hidden = !text;
      this._deviceStatus.classList.toggle("error", error);
      this._deviceStatus.setAttribute("role", error ? "alert" : "status");
    }
  }

  customElements.define(ELEMENT, QuickAccessConfig);
})();
