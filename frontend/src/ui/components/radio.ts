import { css, html, LitElement, nothing } from "lit";

/** Public radio host matches HA's roving-focus and slotted-label surface. */
export class QapRadioOption extends LitElement {
  static properties = {
    value: { reflect: true },
    checked: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    forceDisabled: { type: Boolean, attribute: false },
  };
  declare value: string;
  declare checked: boolean;
  declare disabled: boolean;
  declare forceDisabled: boolean;
  constructor() {
    super();
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.forceDisabled = false;
    this.addEventListener("click", (event) => {
      if (this.disabled || this.forceDisabled) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (this.parentElement instanceof QapRadioGroup) return;
      this.checked = true;
    });
    this.addEventListener("keydown", (event) => {
      if (this.parentElement instanceof QapRadioGroup || event.key !== " " || event.isComposing)
        return;
      event.preventDefault();
      this.click();
    });
  }
  override connectedCallback() {
    super.connectedCallback();
    this.setAttribute("role", "radio");
  }
  protected override updated() {
    this.setAttribute("aria-checked", String(this.checked));
    this.setAttribute("aria-disabled", String(this.disabled || this.forceDisabled));
    if (!(this.parentElement instanceof QapRadioGroup))
      this.tabIndex = this.disabled || this.forceDisabled ? -1 : 0;
    this.parentElement?.dispatchEvent(new Event("qap-radio-update"));
  }
  protected override render() {
    return html`<span part="control" class="control" aria-hidden="true"
        >${this.checked ? html`<svg viewBox="0 0 16 16" part="checked-icon"><circle cx="8" cy="8" r="8" /></svg>` : nothing}</span
      ><slot part="label"></slot>`;
  }
  static styles = css`
    :host {
      display: inline-flex;
      flex-direction: row;
      align-items: normal;
      color: var(--wa-form-control-value-color, var(--primary-text-color));
      font-family: inherit;
      font-weight: var(--wa-form-control-value-font-weight, 400);
      line-height: var(--wa-form-control-value-line-height, 1.6);
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      margin-block: 0.375em;
    }
    :host([data-first]) {
      margin-block-start: 0;
      margin-inline-start: 0;
    }
    :host([data-last]) {
      margin-block-end: 0;
      margin-inline-end: 0;
    }
    :host([data-horizontal]) {
      margin-block: 0;
      margin-inline: 0.5em;
    }
    :host([data-horizontal][data-first]) {
      margin-inline-start: 0;
    }
    :host([data-horizontal][data-last]) {
      margin-inline-end: 0;
    }
    :host(:focus) {
      outline: none;
    }
    .control {
      box-sizing: border-box;
      width: var(--ha-radio-option-toggle-size, 20px);
      height: var(--ha-radio-option-toggle-size, 20px);
      border: var(--ha-radio-option-border-width, var(--ha-border-width-md, 2px))
        var(--wa-form-control-border-style, solid)
        var(
          --ha-radio-option-border-color,
          var(--ha-color-border-neutral-normal, var(--secondary-text-color, #727272))
        );
      background: var(--ha-radio-option-background-color, transparent);
      color: transparent;
      transition:
        background var(--wa-transition-normal, 250ms),
        border-color var(--wa-transition-fast, 150ms),
        box-shadow var(--wa-transition-fast, 150ms),
        color var(--wa-transition-fast, 150ms);
      transition-timing-function: var(--wa-transition-easing, ease);
      border-radius: 50%;
      flex: none;
      display: inline-flex;
      justify-content: center;
      align-items: center;
      margin: var(
        --ha-radio-option-control-margin,
        var(--ha-space-3, 12px) var(--ha-space-2, 8px) var(--ha-space-3, 12px)
          var(--ha-space-3, 12px)
      );
    }
    svg {
      fill: currentColor;
      width: var(--ha-radio-option-toggle-size, 20px);
      height: var(--ha-radio-option-toggle-size, 20px);
      scale: var(--ha-radio-option-checked-icon-scale, 0.7);
      display: flex;
    }
    [part="label"] {
      display: inline-flex;
      align-items: center;
      cursor: pointer;
    }
    :host([aria-checked="true"]) .control {
      background: var(
        --ha-radio-option-checked-background-color,
        var(--ha-color-fill-primary-normal-resting, transparent)
      );
      color: var(
        --ha-radio-option-checked-icon-color,
        var(
          --ha-radio-option-active-color,
          var(--ha-color-fill-primary-loud-resting, var(--primary-color, #03a9f4))
        )
      );
      border-color: currentColor;
    }
    :host(:not([aria-checked="true"], [aria-disabled="true"]):hover) .control {
      border-color: var(
        --ha-radio-option-border-color-hover,
        var(
          --ha-radio-option-border-color,
          var(--ha-color-border-neutral-loud, var(--primary-text-color))
        )
      );
      background: var(
        --ha-radio-option-background-color-hover,
        var(--ha-color-fill-neutral-quiet-hover, var(--secondary-background-color))
      );
    }
    :host(:focus-visible) .control {
      outline: var(--wa-focus-ring, 2px solid var(--primary-color));
      outline-offset: var(--wa-focus-ring-offset, 2px);
    }
    :host([aria-disabled="true"]) {
      opacity: 0.5;
      cursor: not-allowed;
    }
    :host([aria-disabled="true"]) [part="label"] {
      cursor: not-allowed;
    }
    :host([hidden]) {
      display: none;
    }
    @media (prefers-reduced-motion: reduce) {
      .control {
        transition: none;
      }
    }
  `;
}

export class QapRadioGroup extends LitElement {
  static properties = {
    value: {},
    name: {},
    label: {},
    disabled: { type: Boolean, reflect: true },
    orientation: { reflect: true },
  };
  declare value: string;
  declare name: string;
  declare label: string;
  declare disabled: boolean;
  declare orientation: "vertical" | "horizontal";
  constructor() {
    super();
    this.value = "";
    this.name = "";
    this.label = "";
    this.disabled = false;
    this.orientation = "vertical";
    this.addEventListener("qap-radio-update", this.syncOptions);
    this.addEventListener("click", (event) => {
      const option = event
        .composedPath()
        .find(
          (target): target is QapRadioOption =>
            target instanceof QapRadioOption && target.parentElement === this,
        );
      if (option) this.select(option);
    });
    this.addEventListener("keydown", this.navigate);
  }
  private get options() {
    return [...this.children].filter(
      (child): child is QapRadioOption => child instanceof QapRadioOption,
    );
  }
  private get enabledOptions() {
    return this.options.filter((option) => !option.disabled && !option.hidden);
  }
  private syncOptions = () => {
    const options = this.options,
      enabled = this.enabledOptions;
    const selected = enabled.find((option) => option.value === this.value) ?? enabled[0];
    for (const [index, option] of options.entries()) {
      option.forceDisabled = this.disabled;
      option.checked = option.value === this.value;
      option.tabIndex = !this.disabled && option === selected ? 0 : -1;
      option.toggleAttribute("data-first", index === 0);
      option.toggleAttribute("data-last", index === options.length - 1);
      option.toggleAttribute("data-horizontal", this.orientation === "horizontal");
    }
  };
  private select(option: QapRadioOption) {
    if (this.disabled || option.disabled || option.hidden) return;
    const previous = this.value;
    this.value = option.value;
    this.syncOptions();
    if (previous === this.value) return;
    this.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }
  private navigate = (event: KeyboardEvent) => {
    if (
      this.disabled ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)
    )
      return;
    const options = this.enabledOptions;
    if (!options.length) return;
    const current = options.findIndex((option) => event.composedPath().includes(option));
    const index =
      current < 0
        ? Math.max(
            0,
            options.findIndex((option) => option.value === this.value),
          )
        : current;
    let step = 1;
    if (event.key === " ") step = 0;
    else if (["ArrowUp", "ArrowLeft"].includes(event.key)) step = -1;
    const option = options[(index + step + options.length) % options.length];
    event.preventDefault();
    event.stopPropagation();
    this.select(option);
    option.focus({ preventScroll: true });
  };
  override focus(options?: FocusOptions) {
    if (!this.disabled)
      (
        this.enabledOptions.find((option) => option.value === this.value) ?? this.enabledOptions[0]
      )?.focus(options);
  }
  protected override updated() {
    this.syncOptions();
  }
  protected override render() {
    return html`<fieldset
      role="radiogroup"
      aria-label=${this.label || this.getAttribute("aria-label") || nothing}
      aria-orientation=${this.orientation}
      aria-disabled=${String(this.disabled)}
    >
      ${this.label ? html`<label part="form-control-label" @click=${() => this.focus()}>${this.label}</label>` : nothing}
      <slot part="form-control-input" @slotchange=${this.syncOptions}></slot>
    </fieldset>`;
  }
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
    }
    fieldset {
      border: 0;
      margin: 0;
      padding: 0;
      min-width: 0;
    }
    label {
      color: var(--wa-form-control-label-color, var(--primary-text-color));
      font-weight: var(--wa-form-control-label-font-weight, 400);
      line-height: var(--wa-form-control-label-line-height, 1.6);
      margin-block-end: 0.5em;
      display: inline-flex;
    }
    [part="form-control-input"] {
      display: flex;
      flex-flow: column wrap;
      gap: 0;
    }
    :host([orientation="horizontal"]) [part="form-control-input"] {
      flex-direction: row;
    }
    :host([hidden]) {
      display: none;
    }
  `;
}
