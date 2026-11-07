import { html, LitElement, nothing } from "lit";

type HaIconPicker = HTMLElement & {
  value: string;
  label: string;
  placeholder: string;
  hass: unknown;
};
const registrations = new Map<string, Set<() => void>>();
let pickerSequence = 0;

function watchDefinition(tag: string, callback: () => void): () => void {
  if (customElements.get(tag)) return () => {};
  let listeners = registrations.get(tag);
  if (!listeners) {
    listeners = new Set();
    registrations.set(tag, listeners);
    const subscribers = listeners;
    void customElements.whenDefined(tag).then(() => {
      for (const listener of [...subscribers]) listener();
      subscribers.clear();
      registrations.delete(tag);
    });
  }
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/** HA owns icon resolution, including custom icon sets. Never resolve assets here. */
export class QapIcon extends LitElement {
  static properties = { icon: {}, label: { attribute: "aria-label" } };
  declare icon: string;
  declare label: string;
  constructor() {
    super();
    this.icon = "";
    this.label = "";
  }
  protected override createRenderRoot() {
    return this;
  }
  protected override render() {
    return html`<ha-icon
      icon=${this.icon}
      aria-hidden="true"
      style="display:block;width:100%;height:100%;color:inherit"
    ></ha-icon>`;
  }
  protected override updated() {
    this.setAttribute("aria-hidden", this.label ? "false" : "true");
    if (this.label) {
      this.setAttribute("role", "img");
      this.setAttribute("aria-label", this.label);
    } else {
      this.removeAttribute("role");
      this.removeAttribute("aria-label");
    }
  }
}

/** Keep manual entry stable through lazy registration, focus and IME edits. */
export class QapIconPicker extends LitElement {
  static properties = {
    value: {},
    label: {},
    placeholder: {},
    fallbackHint: { attribute: "fallback-hint" },
    hass: { attribute: false },
    disabled: { type: Boolean, reflect: true },
    native: { state: true },
    ariaInvalid: { attribute: "aria-invalid" },
    ariaDescribedBy: { attribute: "aria-describedby" },
  };
  declare value: string;
  declare label: string;
  declare placeholder: string;
  declare fallbackHint: string;
  declare hass: unknown;
  declare disabled: boolean;
  declare ariaInvalid: string | null;
  declare ariaDescribedBy: string | null;
  declare private native: boolean;
  private composing = false;
  private readonly hintId = `qap-icon-hint-${++pickerSequence}`;
  private unwatch: (() => void) | undefined;
  private readonly upgrade = () => {
    let focused = (this.getRootNode() as Document | ShadowRoot).activeElement;
    while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    if (!this.isConnected || this.composing || (focused && this.contains(focused))) return;
    if (customElements.get("ha-icon-picker")) {
      this.native = true;
      this.unwatch?.();
      this.unwatch = undefined;
    }
  };
  constructor() {
    super();
    this.value = "";
    this.label = "";
    this.placeholder = "mdi:gesture-tap";
    this.fallbackHint = "";
    this.disabled = false;
    this.native = false;
    this.addEventListener("focusout", () => {
      void Promise.resolve().then(this.upgrade);
    });
    this.addEventListener("compositionstart", () => {
      this.composing = true;
    });
    this.addEventListener("compositionend", () => {
      this.composing = false;
      void Promise.resolve().then(this.upgrade);
    });
  }
  protected override createRenderRoot() {
    return this;
  }
  override connectedCallback() {
    super.connectedCallback();
    this.upgrade();
    this.unwatch = watchDefinition("ha-icon-picker", this.upgrade);
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    this.unwatch?.();
    this.unwatch = undefined;
  }
  override focus(options?: FocusOptions) {
    this.querySelector<HTMLElement>("ha-icon-picker, input")?.focus(options);
  }
  private changed(value: string) {
    this.value = value;
    this.dispatchEvent(
      new CustomEvent("value-changed", { detail: { value }, bubbles: true, composed: true }),
    );
  }
  protected override render() {
    if (this.native)
      return html`<ha-icon-picker
        class="qap-native-control"
        .value=${this.value}
        .label=${this.label}
        .placeholder=${this.placeholder}
        .hass=${this.hass}
        .disabled=${this.disabled}
        aria-label=${this.label || nothing}
        aria-invalid=${this.ariaInvalid ?? nothing}
        aria-describedby=${this.ariaDescribedBy ?? nothing}
        @value-changed=${(event: CustomEvent<{ value?: string }>) => {
          event.stopPropagation();
          this.changed(event.detail?.value ?? "");
        }}
      ></ha-icon-picker>`;
    return html`<label class="qap-field"
      ><span class="qap-field-label">${this.label}</span
      ><input
        class="qap-control"
        type="text"
        .value=${this.value}
        placeholder=${this.placeholder}
        aria-label=${this.label || nothing}
        aria-invalid=${this.ariaInvalid ?? nothing}
        aria-describedby=${[this.ariaDescribedBy, this.fallbackHint ? this.hintId : ""].filter(Boolean).join(" ") || nothing}
        ?disabled=${this.disabled}
        autocomplete="off"
        spellcheck="false"
        @input=${(event: Event) => this.changed((event.target as HTMLInputElement).value)}
      />
      ${this.fallbackHint ? html`<small class="qap-field-tip" id=${this.hintId}>${this.fallbackHint}</small>` : nothing}</label
    >`;
  }
  protected override updated() {
    const picker = this.querySelector<HaIconPicker>("ha-icon-picker");
    if (picker) picker.value = this.value;
  }
}
