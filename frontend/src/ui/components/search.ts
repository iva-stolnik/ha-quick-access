import { css, html, nothing } from "lit";
import { QapInput } from "./fields";

/** Stable input: filtering, history and debounce remain with the caller. */
export class QapSearch extends QapInput {
  static properties = { ...QapInput.properties, clearLabel: {} };
  declare clearLabel: string;
  private composing = false;

  constructor() {
    super();
    this.type = "search";
    this.clearLabel = "Clear";
  }

  override connectedCallback() {
    super.connectedCallback();
    this.spellcheck = false;
  }

  private clear() {
    if (this.disabled || this.readOnly || this.composing) return;
    this.value = "";
    // Commit synchronously, including for controllers reading the input in the
    // same event turn. Keep focus and the original input node throughout.
    if (this.formControl) this.formControl.value = "";
    this.focus({ preventScroll: true });
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  protected override render() {
    return html`<div part="base">
      <qap-icon icon="mdi:magnify" aria-hidden="true"></qap-icon>
      <input
        part="input"
        type="search"
        inputmode="search"
        enterkeyhint="search"
        .value=${this.value}
        placeholder=${this.placeholder}
        aria-label=${this.ariaLabel || this.label || this.placeholder || nothing}
        aria-description=${this.description}
        ?disabled=${this.disabled}
        ?readonly=${this.readOnly}
        autocomplete=${this.autocomplete}
        .spellcheck=${this.spellcheck}
        maxlength=${this.maxLength ?? nothing}
        @input=${this.readInput}
        @change=${this.change}
        @compositionstart=${() => {
          this.composing = true;
        }}
        @compositionend=${() => {
          this.composing = false;
        }}
      />
      <qap-icon-button
        .label=${this.clearLabel}
        ?hidden=${!this.value || this.disabled || this.readOnly}
        @pointerdown=${(event: PointerEvent) => event.preventDefault()}
        @click=${this.clear}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") event.stopPropagation();
        }}
      >
        <qap-icon icon="mdi:close" aria-hidden="true"></qap-icon>
      </qap-icon-button>
    </div>`;
  }

  static styles = css`
    :host {
      display: block;
      min-width: 0;
      font: inherit;
      color: var(--primary-text-color, #212121);
      --ha-color-form-background: var(--card-background-color, #fff);
    }
    [part="base"] {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 0;
      height: var(--ha-input-search-height, 40px);
      padding: 0 var(--ha-space-2, 8px);
      border: 1px solid
        var(
          --wa-form-control-border-color,
          var(--ha-color-border-neutral-quiet, var(--divider-color, #ddd))
        );
      border-radius: var(--ha-input-search-border-radius, var(--ha-border-radius-md, 8px));
      background: var(--ha-color-form-background, var(--card-background-color, #fff));
      transition:
        border-color var(--wa-transition-normal, 250ms) ease-in-out,
        background-color var(--wa-transition-normal, 250ms) ease-in-out;
    }
    [part="base"]:hover {
      border-color: var(--ha-color-border-neutral-normal, var(--divider-color, #999));
      background: var(
        --ha-color-form-background-hover,
        var(--ha-color-form-background, var(--card-background-color, #fff))
      );
    }
    :host(:focus-within) [part="base"] {
      border-color: var(--primary-color, #03a9f4);
    }
    input {
      box-sizing: border-box;
      flex: 1;
      width: 100%;
      min-width: 0;
      border: 0;
      outline: 0;
      padding: 0 0 0 var(--ha-space-1, 4px);
      background: transparent;
      color: inherit;
      font: inherit;
      font-family: var(--ha-font-family-body, inherit);
      font-size: var(--ha-font-size-m, 14px);
      font-weight: var(--ha-font-weight-normal, 400);
      line-height: var(--ha-line-height-condensed, 1.2);
    }
    input::placeholder {
      color: var(--ha-color-neutral-60, var(--secondary-text-color, #727272));
      opacity: 1;
    }
    input::-webkit-search-cancel-button,
    input::-webkit-search-decoration {
      appearance: none;
    }
    qap-icon {
      --mdc-icon-size: 18px;
      width: 18px;
      height: 18px;
      flex: none;
      color: inherit;
    }
    qap-icon-button {
      --ha-icon-button-size: 24px;
      --ha-icon-button-padding-inline: 3px;
      color: var(--ha-color-text-secondary, var(--secondary-text-color, #727272));
    }
    qap-icon-button qap-icon {
      width: 18px;
      height: 18px;
    }
    qap-icon-button[hidden],
    :host([hidden]) {
      display: none;
    }
    :host([disabled]) {
      opacity: var(--disabled-opacity, 0.5);
    }
    @media (pointer: coarse) {
      input {
        font-size: max(16px, var(--ha-font-size-m, 14px));
      }
    }
    @media (prefers-reduced-motion: reduce) {
      [part="base"] {
        transition: none;
      }
    }
  `;
}
