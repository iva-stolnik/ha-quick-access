import { css, html, LitElement, nothing, type PropertyDeclarations } from "lit";

export class QapInput extends LitElement {
  static properties: PropertyDeclarations = {
    value: {},
    label: {},
    type: { reflect: true },
    placeholder: {},
    disabled: { type: Boolean, reflect: true },
    required: { type: Boolean },
    invalid: { type: Boolean, reflect: true },
    min: {},
    max: {},
    step: {},
    maxLength: { type: Number, attribute: "maxlength" },
    autocomplete: {},
    readOnly: { type: Boolean, attribute: "readonly" },
    pattern: {},
    hint: {},
    ariaDescribedBy: { attribute: "aria-describedby" },
    ariaLabel: { attribute: "aria-label" },
    ariaInvalid: { attribute: "aria-invalid" },
  };
  static shadowRootOptions = { mode: "open" as const, delegatesFocus: true };
  declare value: string;
  declare label: string;
  declare type: string;
  declare placeholder: string;
  declare disabled: boolean;
  declare required: boolean;
  declare invalid: boolean;
  declare min: string | undefined;
  declare max: string | undefined;
  declare step: string | undefined;
  declare maxLength: number | undefined;
  declare autocomplete: string;
  declare readOnly: boolean;
  declare pattern: string | undefined;
  declare hint: string;
  declare ariaDescribedBy: string | null;
  declare ariaLabel: string | null;
  declare ariaInvalid: string | null;
  private descriptionObserver: MutationObserver | undefined;
  constructor() {
    super();
    this.value = "";
    this.label = "";
    this.type = "text";
    this.placeholder = "";
    this.disabled = false;
    this.required = false;
    this.invalid = false;
    this.autocomplete = "off";
    this.readOnly = false;
    this.hint = "";
  }
  override focus(options?: FocusOptions) {
    const focus = () => {
      if (this.isConnected && !this.disabled) this.formControl?.focus(options);
    };
    if (this.formControl) focus();
    else
      void this.updateComplete
        .then(focus)
        .catch((error) => console.warn("[Quick Access] Could not focus a rendered field.", error));
  }
  protected get formControl() {
    return this.shadowRoot?.querySelector<HTMLInputElement | HTMLSelectElement>("input, select");
  }
  checkValidity() {
    return this.formControl?.checkValidity() ?? true;
  }
  reportValidity() {
    return this.formControl?.reportValidity() ?? true;
  }
  select() {
    this.shadowRoot?.querySelector("input")?.select();
  }
  setSelectionRange(start: number, end: number, direction?: "forward" | "backward" | "none") {
    this.shadowRoot?.querySelector("input")?.setSelectionRange(start, end, direction);
  }
  protected get description() {
    const root = this.getRootNode() as Document | ShadowRoot;
    return (
      [
        this.hint,
        this.ariaDescribedBy
          ?.split(/\s+/)
          .map((id) => root.getElementById(id)?.textContent ?? "")
          .join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .trim() || nothing
    );
  }
  override disconnectedCallback() {
    this.descriptionObserver?.disconnect();
    super.disconnectedCallback();
  }
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  protected override updated() {
    const control = this.formControl;
    if (!control) return;
    const root = this.getRootNode() as Document | ShadowRoot;
    const descriptions =
      this.ariaDescribedBy?.split(/\s+/).flatMap((id) => {
        const element = root.getElementById(id);
        return element ? [element] : [];
      }) ?? [];
    const hint = this.shadowRoot?.querySelector<HTMLElement>("#hint");
    if (hint) descriptions.unshift(hint);
    if ("ariaDescribedByElements" in control) control.ariaDescribedByElements = descriptions;
    this.descriptionObserver?.disconnect();
    if (this.isConnected && !("ariaDescribedByElements" in control)) {
      this.descriptionObserver ??= new MutationObserver(() => this.requestUpdate());
      for (const element of descriptions)
        this.descriptionObserver.observe(element, {
          childList: true,
          characterData: true,
          subtree: true,
        });
    }
  }
  protected readInput(event: Event) {
    this.value = (event.target as HTMLInputElement).value;
  }
  protected override render() {
    return html`<label
        part="field"
        class=${this.value || this.placeholder || this.type === "color" || this.type === "date" ? "has-value" : "empty"}
        >${this.label ? html`<span part="label">${this.label}</span>` : nothing}
        <input
          part="base"
          .value=${this.value}
          type=${this.type}
          placeholder=${this.placeholder}
          ?disabled=${this.disabled}
          ?required=${this.required}
          aria-label=${this.ariaLabel || this.label || nothing}
          aria-invalid=${this.invalid || this.ariaInvalid === "true" ? "true" : nothing}
          aria-description=${this.description}
          ?readonly=${this.readOnly}
          pattern=${this.pattern ?? nothing}
          .spellcheck=${this.spellcheck}
          min=${this.min ?? nothing}
          max=${this.max ?? nothing}
          step=${this.step ?? nothing}
          maxlength=${this.maxLength ?? nothing}
          autocomplete=${this.autocomplete}
          @input=${this.readInput}
          @change=${this.change}
        /> </label
      >${this.hint ? html`<div id="hint">${this.hint}</div>` : nothing}`;
  }
  protected change(event: Event) {
    this.readInput(event);
    event.stopPropagation();
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }
  static styles = css`
    :host {
      display: block;
      min-width: 0;
      color: var(--ha-color-text-primary, var(--primary-text-color, #212121));
      font: inherit;
    }
    :host([hidden]) {
      display: none !important;
    }
    label {
      display: block;
      position: relative;
      font: inherit;
    }
    #hint {
      display: flex;
      align-items: center;
      min-height: var(--ha-space-5, 20px);
      margin-inline-start: var(--ha-space-3, 12px);
      font-size: var(--ha-font-size-s, 12px);
      color: var(--ha-color-text-secondary, var(--secondary-text-color, #727272));
    }
    label > span {
      position: absolute;
      inset-inline-start: var(--ha-space-4, 16px);
      top: var(--ha-space-5, 20px);
      pointer-events: none;
      font-size: var(--ha-font-size-m, 14px);
      color: var(--secondary-text-color, #727272);
      line-height: var(--ha-line-height-condensed, 1.2);
      font-family: var(--ha-font-family-body, inherit);
      font-weight: var(--ha-font-weight-normal, 400);
      transition: all var(--wa-transition-normal, 150ms) ease-in-out;
    }
    label.has-value > span,
    label:focus-within > span {
      top: var(--ha-space-3, 12px);
      font-size: var(--ha-font-size-xs, 10px);
    }
    input,
    select {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      height: var(--ha-input-height, 56px);
      padding: 0 var(--ha-space-4, 16px);
      border: 0;
      border-radius: var(--ha-border-radius-sm, 4px) var(--ha-border-radius-sm, 4px) 0 0;
      background: var(
        --ha-color-form-background,
        var(--input-fill-color, var(--secondary-background-color, #f5f5f5))
      );
      color: inherit;
      font: inherit;
      font-size: var(--ha-font-size-m, 14px);
      transition: background-color var(--wa-transition-normal, 150ms) ease-in-out;
    }
    label::after {
      content: "";
      position: absolute;
      bottom: 0;
      inset-inline: 0;
      height: 1px;
      pointer-events: none;
      background: var(
        --ha-color-border-neutral-loud,
        var(--input-idle-line-color, var(--divider-color, #999))
      );
      transition:
        height var(--wa-transition-normal, 150ms) ease-in-out,
        background-color var(--wa-transition-normal, 150ms) ease-in-out;
    }
    label:focus-within::after {
      height: 2px;
      background: var(--primary-color, #03a9f4);
    }
    label:focus-within > span {
      color: var(--primary-color, #03a9f4);
    }
    label:has([aria-invalid="true"])::after {
      background: var(--ha-color-border-danger-normal, var(--error-color, #db4437));
    }
    label:has([aria-invalid="true"]) > span {
      color: var(--ha-color-fill-danger-loud-resting, var(--error-color, #db4437));
    }
    label.has-value input,
    label.has-value select,
    label:focus-within input {
      padding-top: var(--ha-space-3, 12px);
    }
    select {
      appearance: none;
      padding-inline-end: 40px;
    }
    label:has(select) > span {
      top: calc(
        (
            var(--ha-input-height, 56px) - var(--ha-font-size-m, 14px) *
              var(--ha-line-height-normal, 1.6)
          ) /
          2
      );
      font-size: var(--ha-font-size-m, 14px);
      line-height: var(--ha-line-height-normal, 1.6);
      color: var(--secondary-text-color, #727272);
      transition: none;
    }
    label.has-value:has(select) > span {
      top: calc(
        (
            var(--ha-input-height, 56px) - 1.15rem - var(--ha-font-size-m, 14px) *
              var(--ha-line-height-normal, 1.6)
          ) /
          2
      );
      font-size: calc(var(--mdc-typography-subtitle1-font-size, 1rem) * 0.75);
      line-height: 1.15rem;
      font-weight: var(--mdc-typography-subtitle1-font-weight, 400);
      font-family: var(
        --mdc-typography-subtitle1-font-family,
        var(--mdc-typography-font-family, inherit)
      );
      color: var(--mdc-select-label-ink-color, #0009);
    }
    label.has-value select {
      padding-top: 1.15rem;
      line-height: var(--ha-line-height-normal, 1.6);
    }
    label:has(select)::before {
      content: "";
      position: absolute;
      inset-inline-end: 19px;
      top: 26px;
      pointer-events: none;
      border: 5px solid transparent;
      border-top-color: var(--ha-color-text-secondary, var(--secondary-text-color, #727272));
    }
    label.empty:has(> span) select {
      color: transparent;
    }
    input:focus,
    select:focus {
      outline: none;
    }
    input::placeholder {
      color: var(--ha-color-neutral-60, var(--secondary-text-color, #727272));
    }
    input:disabled,
    select:disabled {
      cursor: not-allowed;
      background: var(
        --ha-color-form-background-disabled,
        var(--ha-color-form-background, #f5f5f5)
      );
      opacity: var(--disabled-opacity, 0.5);
    }
    label:has(:disabled) > span {
      opacity: 0.5;
    }
    :host([type="color"]) label,
    :host([type="color"]) input {
      height: 100%;
    }
    :host([type="color"]) input {
      padding-top: var(--ha-space-6, 24px);
      padding-bottom: 2px;
      cursor: pointer;
    }
    option,
    optgroup {
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color, #212121);
    }
    @media (pointer: coarse) {
      input,
      select {
        font-size: max(16px, var(--ha-font-size-m, 14px));
      }
    }
    @media (hover: hover) {
      input:not(:disabled):hover {
        background: var(--ha-color-form-background-hover, var(--ha-color-form-background, #f5f5f5));
      }
    }
    @media (prefers-reduced-motion: reduce) {
      label > span,
      label::after,
      input,
      select {
        transition: none;
      }
    }
  `;
}

export interface QapSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
}
export class QapSelect extends QapInput {
  static properties = { options: { attribute: false } };
  declare options: QapSelectOption[];
  constructor() {
    super();
    this.options = [];
  }
  protected override render() {
    const option = (item: QapSelectOption) =>
      html`<option value=${item.value} ?disabled=${item.disabled}>${item.label}</option>`;
    const groups: Array<QapSelectOption | { group: string; items: QapSelectOption[] }> = [];
    for (const item of this.options) {
      const last = groups.at(-1);
      if (item.group && last && "items" in last && last.group === item.group) last.items.push(item);
      else if (item.group) groups.push({ group: item.group, items: [item] });
      else groups.push(item);
    }
    return html`<label class=${this.value ? "has-value" : "empty"}
      >${this.label ? html`<span>${this.label}</span>` : nothing}
      <select
        part="base"
        .value=${this.value}
        ?disabled=${this.disabled}
        ?required=${this.required}
        aria-label=${this.ariaLabel || this.label || nothing}
        aria-invalid=${this.invalid || this.ariaInvalid === "true" ? "true" : nothing}
        aria-description=${this.description}
        @input=${this.readInput}
        @change=${this.change}
      >
        ${groups.map((item) => ("items" in item ? html`<optgroup label=${item.group}>${item.items.map(option)}</optgroup>` : option(item)))}
      </select></label
    >`;
  }
  protected override updated() {
    super.updated();
    // Apply selection after Lit has updated the option nodes, including async options.
    const select = this.shadowRoot?.querySelector("select");
    if (select) select.value = this.value;
  }
}

export class QapCheckbox extends LitElement {
  static properties = {
    checked: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    label: {},
    switch: { type: Boolean, reflect: true },
    ariaLabel: { attribute: "aria-label" },
  };
  static shadowRootOptions = { mode: "open" as const, delegatesFocus: true };
  declare checked: boolean;
  declare disabled: boolean;
  declare label: string;
  declare switch: boolean;
  declare ariaLabel: string | null;
  constructor() {
    super();
    this.checked = false;
    this.disabled = false;
    this.label = "";
    this.switch = false;
  }
  override focus(options?: FocusOptions) {
    this.shadowRoot?.querySelector("input")?.focus(options);
  }
  override click() {
    if (!this.disabled) this.shadowRoot?.querySelector("input")?.click();
  }
  protected override render() {
    return html`<label
      ><input
        type="checkbox"
        part="base"
        role=${this.switch ? "switch" : nothing}
        .checked=${this.checked}
        ?disabled=${this.disabled}
        aria-label=${this.ariaLabel || this.label || nothing}
        @change=${(event: Event) => {
          this.checked = (event.target as HTMLInputElement).checked;
          event.stopPropagation();
          this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        }}
      />${this.label ? html`<span>${this.label}</span>` : nothing}</label
    >`;
  }
  static styles = css`
    :host {
      display: inline-flex;
      vertical-align: middle;
    }
    :host([hidden]) {
      display: none !important;
    }
    label {
      display: flex;
      align-items: center;
      min-width: var(--ha-space-6, 24px);
      min-height: 44px;
      gap: 8px;
      cursor: pointer;
    }
    input {
      width: 20px;
      height: 20px;
      margin: 0;
      accent-color: var(--primary-color, #03a9f4);
      cursor: inherit;
    }
    input:focus-visible {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: 3px;
    }
    input:disabled {
      opacity: var(--disabled-opacity, 0.5);
      cursor: default;
    }
    :host([switch]) label {
      min-height: var(--ha-switch-size, 24px);
      position: relative;
    }
    :host([switch]) label::before {
      content: "";
      position: absolute;
      inset: -10px 0;
      min-height: var(--ha-switch-min-touch-size, 40px);
    }
    :host([switch]) input {
      appearance: none;
      width: var(--ha-switch-width, 48px);
      height: var(--ha-switch-size, 24px);
      border-radius: 9999px;
      border: 1px solid var(--ha-switch-border-color, var(--ha-color-border-neutral-normal, #888));
      background: var(
        --ha-switch-background-color,
        var(--ha-color-fill-disabled-quiet-resting, #ddd)
      );
      position: relative;
    }
    :host([switch]) input::after {
      content: "";
      position: absolute;
      width: var(--ha-switch-thumb-size, 18px);
      height: var(--ha-switch-thumb-size, 18px);
      border-radius: 50%;
      top: 2px;
      left: 2px;
      background: var(--ha-switch-thumb-background-color, var(--ha-color-on-disabled-quiet, #888));
      box-shadow: var(--ha-switch-thumb-box-shadow, var(--ha-box-shadow-s, 0 1px 3px #0003));
      transition: transform var(--ha-animation-duration-fast, 150ms);
    }
    :host([switch]) input:checked {
      background: var(
        --ha-switch-checked-background-color,
        var(--ha-color-fill-primary-normal-resting, #e3f2fd)
      );
      border-color: var(
        --ha-switch-checked-border-color,
        var(--ha-color-border-primary-loud, var(--primary-color, #03a9f4))
      );
    }
    :host([switch]) input:checked::after {
      transform: translateX(
        calc(var(--ha-switch-width, 48px) - var(--ha-switch-thumb-size, 18px) - 6px)
      );
      background: var(--ha-switch-checked-thumb-background-color, var(--primary-color, #03a9f4));
    }
    :host(:dir(rtl)[switch]) input::after {
      left: auto;
      right: 2px;
    }
    :host(:dir(rtl)[switch]) input:checked::after {
      transform: translateX(
        calc(-1 * (var(--ha-switch-width, 48px) - var(--ha-switch-thumb-size, 18px) - 6px))
      );
    }
    @media (prefers-reduced-motion: reduce) {
      input::after {
        transition: none !important;
      }
    }
  `;
}
