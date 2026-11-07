import { css, html, nothing, type PropertyValues } from "lit";
import { QapPicker, type PickerOption } from "./picker";
import type { QapSelect, QapSelectOption } from "./fields";
import { entitySearchTermMatches } from "../../entities/entity-search.js";

/** Quick Access uses dropdown selectors only. */
interface SelectSelectorConfig {
  options: readonly (string | QapSelectOption)[];
  mode?: "dropdown";
  multiple?: boolean;
  custom_value?: boolean;
}

export class QapSelectSelector extends QapPicker {
  static properties = { selector: { attribute: false } };
  declare selector: { select: SelectSelectorConfig };

  constructor() {
    super();
    this.selector = { select: { options: [], mode: "dropdown" } };
  }
  protected override get multiple() {
    return Boolean(this.selector.select.multiple);
  }
  protected override get rowHeight() {
    return 48;
  }
  protected override get topLabel() {
    return false;
  }
  private get plainSelect() {
    return !this.multiple && !this.selector.select.custom_value && !this.addButton;
  }
  protected override get usesPicker() {
    return !this.plainSelect;
  }
  private get selectOptions(): QapSelectOption[] {
    return this.selector.select.options.map((option) =>
      typeof option === "string" ? { value: option, label: option } : option,
    );
  }
  protected override getOption(value: string): PickerOption | undefined {
    // HA's generic field displays the raw custom value; dropdown rows use labels.
    return value ? { value, label: value } : undefined;
  }
  protected override searchOptions(query: string) {
    const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
    const terms = fold(query.trim())
      .split(/\s+/)
      .filter((term) => term.length >= 2);
    return this.selectOptions.filter((option) =>
      terms.every((term) => entitySearchTermMatches(fold(`${option.label} ${option.value}`), term)),
    );
  }
  protected override accepts(value: string) {
    const option = this.selectOptions.find((option) => option.value === value);
    return option ? !option.disabled : Boolean(value && this.selector.select.custom_value);
  }
  override checkValidity() {
    return this.disabled || super.checkValidity();
  }
  override focus(options?: FocusOptions) {
    if (this.plainSelect) {
      void this.updateComplete.then(() => {
        if (this.isConnected && !this.disabled)
          this.shadowRoot?.querySelector<QapSelect>("qap-select")?.focus(options);
      });
    } else super.focus(options);
  }
  protected override updated(changed: PropertyValues) {
    // Match HA's desktop picker: filtering keeps the height at which it opened.
    // These listeners belong to our shadow child; repeated renders reuse them.
    this.popup?.addEventListener("opened", this.retainPickerHeight);
    this.popup?.addEventListener("closed", this.clearPickerHeight);
    super.updated(changed);
  }
  private retainPickerHeight = () => {
    const height = this.shadowRoot?.querySelector<HTMLElement>(".picker")?.offsetHeight ?? 0;
    this.style.setProperty("--selector-min-height", `${height}px`);
  };
  private clearPickerHeight = () => {
    this.style.removeProperty("--selector-min-height");
  };
  protected override notifyValue(value: string | string[] | undefined) {
    this.dispatchEvent(
      new CustomEvent("value-changed", { detail: { value }, bubbles: true, composed: true }),
    );
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }
  private addValue(event: CustomEvent<{ value?: string }>) {
    event.stopPropagation();
    const child = event.currentTarget as QapSelectSelector;
    const next = event.detail.value;
    if (!this.disabled && next && this.accepts(next) && !this.values.includes(next)) {
      this.value = [...this.values, next];
      this.notifyValue(this.value);
    }
    // A form listener may synchronously reject a new value (e.g. its value limit).
    child.value = "";
    const restore = () => this.focus({ preventScroll: true });
    if (child.popup?.open) child.popup.addEventListener("closed", restore, { once: true });
    else void this.updateComplete.then(restore);
  }
  private removeValue(value: string) {
    if (this.disabled) return;
    this.value = this.values.filter((item) => item !== value);
    this.notifyValue(this.value);
    void this.updateComplete.then(() => this.focus({ preventScroll: true }));
  }
  protected override renderMultiple() {
    return html`${
        this.values.length
          ? html`<div class="chips" role="group" aria-label=${this.ariaLabel || this.label}>
              ${this.values.map((value) => {
                const label =
                  this.selectOptions.find((option) => option.value === value)?.label || value;
                return html`<div class="chip">
                  <qap-chip .disabled=${this.disabled}>${label}</qap-chip>
                  <button
                    class="remove"
                    aria-label=${`${this.clearLabel}: ${label}`}
                    ?disabled=${this.disabled}
                    @click=${() => this.removeValue(value)}
                  >
                    <ha-icon icon="mdi:close" aria-hidden="true"></ha-icon>
                  </button>
                </div>`;
              })}
            </div>`
          : nothing
      }
      <qap-select-selector
        class="add-control"
        .value=${""}
        .selector=${{ select: { ...this.selector.select, multiple: false, options: this.selectOptions.filter((option) => !this.values.includes(option.value)) } }}
        .label=${this.label}
        .helper=${this.helper}
        .addButton=${true}
        .addLabel=${this.label || this.addLabel}
        .searchLabel=${this.searchLabel}
        .noMatchLabel=${this.noMatchLabel}
        .clearLabel=${this.clearLabel}
        .required=${this.required && !this.values.length}
        .disabled=${this.disabled}
        aria-label=${this.ariaLabel || this.label}
        aria-invalid=${this.ariaInvalid ?? nothing}
        .ariaDescription=${this.description === nothing ? null : this.description}
        @value-changed=${this.addValue}
        @input=${(event: Event) => event.stopPropagation()}
        @change=${(event: Event) => event.stopPropagation()}
      ></qap-select-selector>`;
  }
  protected override render() {
    if (!this.plainSelect) return super.render();
    const options = this.selectOptions;
    // Keep an unavailable saved option visible until the owner explicitly changes it.
    if (this.current && !options.some((option) => option.value === this.current))
      options.push({ value: this.current, label: this.current });
    return html`<qap-select
        .options=${options}
        .value=${this.current}
        .label=${this.label}
        .disabled=${this.disabled}
        .required=${this.required}
        aria-label=${this.ariaLabel || this.label}
        aria-invalid=${this.ariaInvalid ?? nothing}
        .ariaDescribedBy=${this.ariaDescribedBy}
        .hint=${this.description === nothing ? "" : this.description}
        @input=${(event: Event) => event.stopPropagation()}
        @change=${(event: Event) => {
          event.stopPropagation();
          this.commit((event.currentTarget as QapSelect).value);
        }}
      ></qap-select>
      ${this.helper ? html`<div id="hint">${this.helper}</div>` : nothing}`;
  }
  static styles = [
    QapPicker.styles,
    css`
      .overline {
        font-size: calc(var(--mdc-typography-subtitle1-font-size, 1rem) * 0.75);
        line-height: 1.15rem;
        font-weight: var(--mdc-typography-subtitle1-font-weight, 400);
        font-family: var(
          --mdc-typography-subtitle1-font-family,
          var(--mdc-typography-font-family, inherit)
        );
        color: var(--mdc-select-label-ink-color, #0009);
      }
      .headline {
        line-height: var(--ha-line-height-normal, 1.6);
      }
      .option {
        height: 48px;
        border: 0;
        padding: 0 16px;
      }
      .option .secondary,
      .option .domain {
        display: none;
      }
      .option[aria-disabled="true"] {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--ha-space-2, 8px);
        padding: 8px 0;
        font-family: var(--ha-font-family-body, Roboto, Noto, sans-serif);
      }
      .chip {
        display: inline-flex;
        position: relative;
        max-width: 100%;
      }
      qap-chip {
        --ha-button-border-radius: 16px;
        --ha-chip-container-color: var(
          --md-input-chip-selected-container-color,
          rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.15)
        );
        --ha-chip-outline-width: 0px;
        max-width: 100%;
      }
      qap-chip::part(base) {
        padding-inline: var(--ha-space-4, 16px)
          calc(var(--ha-chip-icon-size, 18px) + 2 * var(--ha-space-2, 8px));
      }
      qap-chip::part(label) {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .remove {
        position: absolute;
        inset-inline-end: 0;
        top: 0;
        display: grid;
        place-items: center;
        width: calc(var(--ha-chip-icon-size, 18px) + 2 * var(--ha-space-2, 8px));
        height: 32px;
        padding: 0;
        border: 0;
        border-radius: 16px;
        border-start-start-radius: 0;
        border-end-start-radius: 0;
        background: transparent;
        color: var(--primary-text-color);
      }
      .remove::after {
        content: "";
        position: absolute;
        inset: -8px 0;
      }
      .remove ha-icon {
        --mdc-icon-size: 18px;
      }
      .remove:focus-visible {
        outline: 2px solid var(--primary-color);
      }
      .remove:disabled {
        opacity: 0.38;
        cursor: not-allowed;
      }
      qap-dialog[open]::part(base) {
        animation: select-sheet-show 300ms ease;
      }
      qap-dialog:not([open])::part(base) {
        animation: select-sheet-hide 300ms ease forwards;
      }
      @media (min-width: 871px) and (min-height: 501px) {
        qap-dialog::part(base) {
          border: var(--wa-panel-border-width, 1px) solid
            var(
              --wa-color-surface-border,
              var(--ha-color-border-neutral-quiet, var(--divider-color, #ddd))
            );
        }
        qap-dialog[open]::part(base) {
          transform-origin: var(--selector-origin, top);
          animation: select-popup-show var(--show-duration, 100ms) ease;
        }
        qap-dialog:not([open])::part(base) {
          transform-origin: var(--selector-origin, top);
          animation: select-popup-hide var(--hide-duration, 100ms) ease forwards;
        }
        .picker {
          min-height: min(
            var(--selector-min-height, 0px),
            calc(var(--selector-height) - 2 * var(--wa-panel-border-width, 1px))
          );
        }
      }
      @keyframes select-popup-show {
        from {
          opacity: 0;
          scale: 0.8;
        }
        to {
          opacity: 1;
          scale: 1;
        }
      }
      @keyframes select-popup-hide {
        to {
          opacity: 0;
          scale: 0.8;
        }
      }
      @keyframes select-sheet-show {
        from {
          opacity: 0;
          translate: 0 100%;
        }
        to {
          opacity: 1;
          translate: 0 0;
        }
      }
      @keyframes select-sheet-hide {
        to {
          opacity: 0;
          translate: 0 100%;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        qap-dialog::part(base) {
          animation-duration: 0s;
        }
      }
    `,
  ];
}
