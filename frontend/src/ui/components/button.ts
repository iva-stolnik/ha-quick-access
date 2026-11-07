import { css, html, LitElement, nothing, type CSSResultGroup } from "lit";

type ButtonAppearance = "outlined" | "filled" | "plain" | "accent";
type ButtonVariant = "brand" | "danger";

/** Leaf control: slots preserve the existing localized DOM and CSS classes. */
export class QapButton extends LitElement {
  static properties = {
    disabled: { type: Boolean, reflect: true },
    loading: { type: Boolean, reflect: true },
    appearance: { reflect: true },
    variant: { reflect: true },
    href: { reflect: true },
    target: { reflect: true },
    rel: { reflect: true },
    label: {},
    selected: { type: Boolean, reflect: true },
    ariaLabel: { attribute: "aria-label" },
    ariaPressed: { attribute: "aria-pressed" },
    ariaExpanded: { attribute: "aria-expanded" },
    ariaHasPopup: { attribute: "aria-haspopup" },
    ariaControls: { attribute: "aria-controls" },
    ariaLabelledBy: { attribute: "aria-labelledby" },
    ariaDescribedBy: { attribute: "aria-describedby" },
    ariaDescription: { attribute: "aria-description" },
    ariaKeyShortcuts: { attribute: "aria-keyshortcuts" },
    hasStart: { state: true },
    hasEnd: { state: true },
  };
  static shadowRootOptions = { mode: "open" as const, delegatesFocus: true };
  declare disabled: boolean;
  declare loading: boolean;
  declare appearance: ButtonAppearance;
  declare variant: ButtonVariant;
  declare href: string | undefined;
  declare target: string | undefined;
  declare rel: string | undefined;
  declare label: string;
  declare selected: boolean;
  declare ariaLabel: string | null;
  declare ariaPressed: string | null;
  declare ariaExpanded: string | null;
  declare ariaHasPopup: string | null;
  declare ariaControls: string | null;
  declare ariaLabelledBy: string | null;
  declare ariaDescribedBy: string | null;
  declare private hasStart: boolean;
  declare private hasEnd: boolean;
  private labelObserver: MutationObserver | undefined;

  constructor() {
    super();
    this.disabled = false;
    this.loading = false;
    this.appearance = "outlined";
    this.variant = "brand";
    this.label = "";
    this.selected = false;
    this.hasStart = false;
    this.hasEnd = false;
    this.addEventListener(
      "click",
      (event) => {
        if (this.disabled || this.loading) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
  }

  override focus(options?: FocusOptions) {
    const focus = () => {
      if (this.isConnected && !this.disabled)
        this.shadowRoot?.querySelector<HTMLElement>("button, a")?.focus(options);
    };
    if (this.shadowRoot?.querySelector("button, a")) focus();
    else
      void this.updateComplete
        .then(focus)
        .catch((error) => console.warn("[Quick Access] Could not focus a rendered button.", error));
  }
  override click() {
    if (this.disabled || this.loading) return;
    const control = this.shadowRoot?.querySelector<HTMLElement>("button, a");
    if (control) control.click();
    else super.click();
  }
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback() {
    this.labelObserver?.disconnect();
    super.disconnectedCallback();
  }

  protected renderStart() {
    return html`<slot name="start" part="start" @slotchange=${this.slotChanged}></slot>`;
  }
  protected renderLabel() {
    return html`<slot></slot>`;
  }

  protected get controlRole(): string | typeof nothing {
    return nothing;
  }
  protected get controlTabIndex() {
    return 0;
  }
  protected get controlPressed(): string | typeof nothing {
    return this.ariaPressed ?? nothing;
  }

  protected override render() {
    const content = html`${this.renderStart()}<span part="label">${this.renderLabel()}</span
      ><slot name="end" part="end" @slotchange=${this.slotChanged}></slot>
      ${this.loading ? html`<span part="spinner" aria-hidden="true"></span>` : nothing}`;
    const classes = `${this.hasStart ? "has-start" : ""} ${this.hasEnd ? "has-end" : ""}`;
    // ID references cannot cross a shadow boundary. Resolve external names to
    // text while leaving the caller's original ARIA attributes intact.
    const root = this.getRootNode() as Document | ShadowRoot;
    const textFor = (ids: string | null) =>
      ids
        ?.split(/\s+/)
        .map((id) => root.getElementById?.(id)?.textContent ?? "")
        .join(" ")
        .trim();
    const label = textFor(this.ariaLabelledBy) || this.ariaLabel || this.label || nothing;
    const description = textFor(this.ariaDescribedBy) || this.ariaDescription || nothing;
    if (this.href)
      return html`<a
        part="base"
        class=${classes}
        href=${this.disabled || this.loading ? nothing : this.href}
        target=${this.target ?? nothing}
        rel=${this.rel ?? (this.target === "_blank" ? "noopener noreferrer" : nothing)}
        aria-label=${label}
        aria-description=${description}
        aria-disabled=${this.disabled || this.loading ? "true" : nothing}
        tabindex=${this.disabled || this.loading ? "-1" : "0"}
        aria-pressed=${this.controlPressed}
        aria-expanded=${this.ariaExpanded ?? nothing}
        aria-haspopup=${this.ariaHasPopup ?? nothing}
        >${content}</a
      >`;
    return html`<button
      part="base"
      class=${classes}
      type="button"
      ?disabled=${this.disabled}
      role=${this.controlRole}
      tabindex=${this.controlTabIndex}
      aria-disabled=${this.loading ? "true" : nothing}
      aria-busy=${this.loading ? "true" : nothing}
      aria-label=${label}
      aria-description=${description}
      aria-keyshortcuts=${this.ariaKeyShortcuts ?? nothing}
      aria-pressed=${this.controlPressed}
      aria-expanded=${this.ariaExpanded ?? nothing}
      aria-haspopup=${this.ariaHasPopup ?? nothing}
    >
      ${content}
    </button>`;
  }

  private slotChanged(event: Event) {
    const slot = event.currentTarget as HTMLSlotElement;
    if (slot.name === "start") this.hasStart = slot.assignedElements().length > 0;
    else this.hasEnd = slot.assignedElements().length > 0;
  }

  protected override updated() {
    const control = this.shadowRoot?.querySelector<HTMLElement>("button, a");
    const root = this.getRootNode() as Document | ShadowRoot;
    if (!control) return;
    const references = (ids: string | null) =>
      ids?.split(/\s+/).flatMap((id) => {
        const element = root.getElementById?.(id);
        return element ? [element] : [];
      }) ?? [];
    const labels = references(this.ariaLabelledBy);
    const descriptions = references(this.ariaDescribedBy);
    if ("ariaLabelledByElements" in control) control.ariaLabelledByElements = labels;
    if ("ariaDescribedByElements" in control) control.ariaDescribedByElements = descriptions;
    this.labelObserver?.disconnect();
    if (
      this.isConnected &&
      (!("ariaLabelledByElements" in control) || !("ariaDescribedByElements" in control))
    ) {
      // Older supported browsers need text fallbacks kept in sync with live
      // localization. Observe only the explicitly referenced public labels.
      this.labelObserver ??= new MutationObserver(() => this.requestUpdate());
      for (const element of [...labels, ...descriptions]) {
        this.labelObserver.observe(element, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      }
    }
    if ("ariaControlsElements" in control) {
      control.ariaControlsElements = references(this.ariaControls);
    }
  }

  static styles: CSSResultGroup = css`
    :host {
      display: inline-block;
      max-width: 100%;
      vertical-align: middle;
      color: var(--primary-color, #03a9f4);
      --qap-button-fill: var(
        --ha-color-fill-primary-normal-resting,
        var(--secondary-background-color, #e3f2fd)
      );
      --qap-button-hover: var(
        --ha-color-fill-primary-quiet-hover,
        var(--secondary-background-color, #eee)
      );
      --qap-button-active: var(--ha-color-fill-primary-quiet-active, var(--qap-button-fill));
      --qap-button-filled-hover: var(--ha-color-fill-primary-normal-hover, var(--qap-button-fill));
      --qap-button-filled-active: var(
        --ha-color-fill-primary-normal-active,
        var(--qap-button-fill)
      );
      --qap-button-accent-hover: var(
        --ha-color-fill-primary-loud-hover,
        var(--primary-color, #03a9f4)
      );
      --qap-button-accent-active: var(
        --ha-color-fill-primary-loud-active,
        var(--primary-color, #03a9f4)
      );
      --qap-button-border: var(
        --wa-color-border-loud,
        var(--ha-color-border-primary-loud, var(--primary-color, #03a9f4))
      );
      --qap-button-ink: var(
        --wa-color-on-normal,
        var(--ha-color-on-primary-normal, var(--primary-color, #03a9f4))
      );
    }
    :host([appearance="outlined"]) {
      --qap-button-ink: var(
        --wa-color-on-quiet,
        var(--ha-color-on-primary-quiet, var(--primary-color, #03a9f4))
      );
    }
    :host([hidden]) {
      display: none !important;
    }
    :host([variant="danger"]) {
      --qap-button-ink: var(--ha-color-on-danger-normal, var(--error-color, #db4437));
      --qap-button-border: var(--ha-color-border-danger-loud, var(--error-color, #db4437));
      --qap-button-hover: var(
        --ha-color-fill-danger-quiet-hover,
        var(--secondary-background-color, #eee)
      );
      --qap-button-active: var(--ha-color-fill-danger-quiet-active, var(--qap-button-fill));
      --qap-button-filled-hover: var(--ha-color-fill-danger-normal-hover, var(--qap-button-fill));
      --qap-button-filled-active: var(--ha-color-fill-danger-normal-active, var(--qap-button-fill));
      --qap-button-accent-hover: var(
        --ha-color-fill-danger-loud-hover,
        var(--error-color, #db4437)
      );
      --qap-button-accent-active: var(
        --ha-color-fill-danger-loud-active,
        var(--error-color, #db4437)
      );
      --qap-button-fill: var(
        --ha-color-fill-danger-normal-resting,
        var(--secondary-background-color, #fce8e6)
      );
    }
    :host([variant="danger"][appearance="outlined"]) {
      --qap-button-ink: var(--ha-color-on-danger-quiet, var(--error-color, #db4437));
    }
    [part="base"] {
      box-sizing: border-box;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: var(--ha-button-height, var(--button-height, 40px));
      margin: 0;
      padding: 0 var(--ha-space-4, 16px);
      border: 1px solid var(--qap-button-border);
      border-radius: var(--ha-button-border-radius, var(--ha-border-radius-pill, 9999px));
      background: transparent;
      color: var(--qap-button-ink);
      font: inherit;
      font-size: var(--ha-font-size-m, 14px);
      font-weight: var(--ha-font-weight-medium, 500);
      line-height: 1;
      text-decoration: none;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: background-color var(--ha-animation-duration-fast, 150ms) ease-out;
    }
    [part="label"] {
      min-width: 0;
      overflow: var(--ha-button-label-overflow, hidden);
      text-overflow: ellipsis;
      padding: var(--ha-space-1, 4px) 0;
    }
    .has-start {
      padding-inline-start: var(--ha-space-2, 8px);
    }
    .has-end {
      padding-inline-end: var(--ha-space-2, 8px);
    }
    slot[name="start"]::slotted(*) {
      margin-inline-end: var(--ha-space-1, 4px);
    }
    slot[name="end"]::slotted(*) {
      margin-inline-start: var(--ha-space-1, 4px);
    }
    [part="base"]:focus-visible {
      outline: 2px solid var(--ha-color-focus, var(--primary-color, #03a9f4));
      outline-offset: 2px;
    }
    :host([appearance="filled"]) [part="base"] {
      background: var(--qap-button-fill);
      border-color: transparent;
    }
    :host([appearance="accent"]) [part="base"] {
      background: var(--ha-color-fill-primary-loud-resting, var(--primary-color, #03a9f4));
      color: var(--ha-color-on-primary-loud, var(--text-primary-color, #fff));
      border-color: transparent;
    }
    :host([variant="danger"][appearance="accent"]) [part="base"] {
      background: var(--ha-color-fill-danger-loud-resting, var(--error-color, #db4437));
      color: var(--ha-color-on-danger-loud, #fff);
    }
    :host([appearance="plain"]) [part="base"] {
      border-color: transparent;
    }
    @media (hover: hover) {
      [part="base"]:hover {
        background: var(--qap-button-hover);
      }
      :host([appearance="filled"]) [part="base"]:hover {
        background: var(--qap-button-filled-hover);
      }
      :host([appearance="accent"]) [part="base"]:hover {
        background: var(--qap-button-accent-hover);
      }
    }
    [part="base"]:active {
      background: var(--qap-button-active);
    }
    :host([appearance="filled"]) [part="base"]:active {
      background: var(--qap-button-filled-active);
    }
    :host([appearance="accent"]) [part="base"]:active {
      background: var(--qap-button-accent-active);
    }
    :host([disabled]) [part="base"] {
      pointer-events: none;
      cursor: default;
      color: var(--ha-color-on-disabled-quiet, var(--disabled-text-color, #999));
      border-color: currentColor;
    }
    :host([disabled][appearance="filled"]) [part="base"],
    :host([disabled][appearance="accent"]) [part="base"] {
      background: var(--ha-color-fill-disabled-normal-resting, var(--disabled-color, #ddd));
      color: var(--ha-color-on-disabled-normal, var(--disabled-text-color, #999));
      border-color: transparent;
    }
    :host([disabled][appearance="accent"]) [part="base"] {
      background: var(--ha-color-fill-disabled-loud-resting, var(--disabled-color, #ddd));
      color: var(--ha-color-on-disabled-loud, var(--disabled-text-color, #999));
    }
    :host([disabled][appearance="plain"]) [part="base"] {
      background: transparent;
      border-color: transparent;
    }
    :host([loading]) {
      pointer-events: none;
    }
    :host([loading]) [part="base"] {
      cursor: progress;
    }
    :host([loading]) slot,
    :host([loading]) [part="label"] {
      visibility: hidden;
    }
    [part="spinner"] {
      position: absolute;
      width: 18px;
      height: 18px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      [part="base"] {
        transition: none;
      }
      [part="spinner"] {
        animation-duration: 2s;
      }
    }
  `;
}

export class QapIconButton extends QapButton {
  constructor() {
    super();
    this.appearance = "plain";
  }
  static styles = [
    QapButton.styles,
    css`
      :host {
        color: inherit;
      }
      [part="base"] {
        width: var(--ha-icon-button-size, 48px);
        height: var(--ha-icon-button-size, 48px);
        min-height: 0;
        padding: var(--ha-icon-button-padding-inline, var(--ha-space-2, 8px));
        color: inherit;
        border: 0;
        outline-offset: -4px;
      }
      [part="label"] {
        display: flex;
      }
      :host([selected]) [part="base"] {
        background: color-mix(in srgb, currentColor 10%, transparent);
      }
      @media (hover: hover) {
        [part="base"]:hover {
          background: color-mix(in srgb, currentColor 10%, transparent);
        }
      }
    `,
  ];
}
