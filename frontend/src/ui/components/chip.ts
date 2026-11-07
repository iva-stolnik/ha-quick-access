import { css, html, nothing } from "lit";
import { QapButton } from "./button";

/** Shares button activation, disabled behavior and external ARIA references. */
export class QapChip extends QapButton {
  static properties = { ...QapButton.properties, selectable: { type: Boolean, reflect: true } };
  declare selectable: boolean;

  constructor() {
    super();
    this.selectable = false;
    this.addEventListener("click", (event) => {
      if (!this.selectable || event.defaultPrevented) return;
      const selected = this.selected;
      this.selected = !selected;
      void Promise.resolve().then(() => {
        if (event.defaultPrevented) this.selected = selected;
      });
    });
  }

  protected override get controlPressed() {
    return this.selectable ? String(this.selected) : nothing;
  }

  protected override renderStart() {
    return html`${this.selectable && this.selected ? html`<qap-icon class="check" icon="mdi:check" aria-hidden="true"></qap-icon>` : super.renderStart()}`;
  }

  protected override render() {
    return html`<div class="container">${super.render()}</div>`;
  }

  static styles = [
    QapButton.styles,
    css`
      :host {
        display: inline-flex;
        flex: none;
        max-width: 100%;
        --ha-button-height: 32px;
        --ha-button-border-radius: var(
          --ha-assist-chip-container-shape,
          var(--ha-border-radius-pill, 9999px)
        );
        --qap-button-hover: color-mix(
          in srgb,
          var(--ha-chip-label-color, var(--primary-text-color)) 8%,
          transparent
        );
        --qap-button-active: color-mix(
          in srgb,
          var(--ha-chip-label-color, var(--primary-text-color)) 12%,
          transparent
        );
      }
      .container {
        display: flex;
        position: relative;
        min-width: 0;
        max-width: 100%;
        height: var(--ha-button-height);
        border-radius: var(--ha-button-border-radius);
      }
      .container::before,
      .container::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
      }
      .container::before {
        background: var(
          --ha-chip-container-color,
          var(--ha-assist-chip-container-color, transparent)
        );
        opacity: var(--ha-chip-container-opacity, 1);
      }
      .container::after {
        border: var(--ha-chip-outline-width, 1px) solid
          var(--ha-chip-outline-color, var(--outline-color, #999));
      }
      [part="base"] {
        position: relative;
        min-width: 0;
        height: var(--ha-button-height);
        min-height: var(--ha-button-height);
        gap: var(--ha-chip-icon-label-space, var(--ha-space-2, 8px));
        padding-inline: var(--ha-space-4, 16px);
        border: 0;
        background: transparent;
        color: var(--ha-chip-label-color, var(--primary-text-color));
        box-shadow: none;
      }
      [part="label"] {
        padding: 0;
        white-space: nowrap;
        font-size: var(--ha-chip-label-size, 0.875rem);
        font-weight: var(--ha-chip-label-weight, var(--ha-font-weight-normal, 400));
        line-height: var(--ha-chip-label-line-height, 1.25rem);
      }
      :host([selectable]) [part="label"] {
        font-weight: var(--ha-chip-label-weight, var(--ha-font-weight-medium, 500));
      }
      :host([selected][selectable]) {
        --ha-chip-container-color: var(
          --md-filter-chip-selected-container-color,
          rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.15)
        );
        --ha-chip-outline-width: var(--md-filter-chip-selected-outline-width, 0px);
      }
      :host([selected][selectable]) [part="base"] {
        padding-inline-start: var(--ha-space-2, 8px);
      }
      .check {
        --mdc-icon-size: var(--ha-chip-icon-size, 18px);
        display: flex;
        flex: none;
        width: var(--ha-chip-icon-size, 18px);
        height: var(--ha-chip-icon-size, 18px);
      }
      [part="base"]::after {
        content: "";
        position: absolute;
        inset: -8px 0;
      }
      :host([disabled]) [part="base"] {
        color: var(--ha-chip-label-color, var(--primary-text-color));
        border-color: var(--ha-chip-outline-color, var(--outline-color, #999));
      }
      :host([disabled]) [part="label"],
      :host([disabled]) .check {
        opacity: 0.38;
      }
      :host([disabled][selected]) .container::before {
        background: var(--primary-text-color);
        opacity: 0.12;
      }
    `,
  ];
}
