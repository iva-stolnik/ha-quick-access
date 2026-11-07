import {
  css,
  html,
  LitElement,
  nothing,
  type PropertyValues,
  type PropertyDeclarations,
  type CSSResultGroup,
} from "lit";
import type { QapDialog } from "./dialog";

const OVERSCAN = 3;
const VISIBLE_ROWS = 6;

export interface PickerOption {
  value: string;
  label: string;
  secondary?: string;
  icon?: string;
  domain?: string;
  disabled?: boolean;
}

/** Shared picker presentation: search, virtualization, focus and adaptive surface. */
export abstract class QapPicker extends LitElement {
  static properties: PropertyDeclarations = {
    value: { attribute: false },
    revision: { attribute: false },
    label: {},
    helper: {},
    disabled: { type: Boolean, reflect: true },
    required: { type: Boolean },
    clearLabel: {},
    optionLabel: {},
    noMatchLabel: {},
    addLabel: {},
    searchLabel: {},
    addButton: { type: Boolean },
    ariaLabel: { attribute: "aria-label" },
    ariaInvalid: { attribute: "aria-invalid" },
    ariaDescribedBy: { attribute: "aria-describedby" },
    ariaDescription: { attribute: "aria-description" },
    opened: { state: true },
    editingText: { state: true },
    active: { state: true },
    start: { state: true },
    visibleRows: { state: true },
  };
  static shadowRootOptions = { mode: "open" as const, delegatesFocus: true };
  declare value: string | string[] | undefined;
  declare revision: number;
  declare label: string;
  declare helper: string;
  declare clearLabel: string;
  declare optionLabel: string;
  declare noMatchLabel: string;
  declare addLabel: string;
  declare searchLabel: string;
  declare addButton: boolean;
  declare disabled: boolean;
  declare required: boolean;
  declare ariaLabel: string | null;
  declare ariaInvalid: string | null;
  declare ariaDescribedBy: string | null;
  declare ariaDescription: string | null;
  declare protected opened: boolean;
  declare protected editingText: string | undefined;
  declare protected active: number;
  declare protected start: number;
  declare protected visibleRows: number;
  protected composing = false;
  protected touchingOptions = false;
  protected options: PickerOption[] = [];
  protected selectedId = "";
  protected listeners: AbortController | undefined;
  protected observer: ResizeObserver | undefined;
  protected descriptionObserver: MutationObserver | undefined;
  protected previousQuery = "";

  constructor() {
    super();
    this.value = "";
    this.revision = 0;
    this.label = "";
    this.helper = "";
    this.clearLabel = "Clear";
    this.optionLabel = "Select option";
    this.noMatchLabel = "No matches";
    this.addLabel = "Add";
    this.searchLabel = "Search";
    this.addButton = false;
    this.disabled = false;
    this.required = false;
    this.opened = false;
    this.active = -1;
    this.start = 0;
    this.visibleRows = VISIBLE_ROWS;
    this.addEventListener("keydown", this.navigate);
    this.addEventListener("focusout", this.handleBlur);
  }
  protected get multiple() {
    return false;
  }
  protected get usesPicker() {
    return true;
  }
  protected get rowHeight() {
    return 56;
  }
  protected get topLabel() {
    return true;
  }
  protected abstract searchOptions(query: string): PickerOption[];
  protected abstract getOption(value: string): PickerOption | undefined;
  protected abstract accepts(value: string, current?: string): boolean;
  protected get selectionName() {
    return this.getOption(this.current)?.label || this.current;
  }
  protected get fieldIcon() {
    return this.getOption(this.current)?.icon;
  }
  protected renderMultiple(): unknown {
    return nothing;
  }
  protected get values() {
    if (Array.isArray(this.value)) return this.value;
    return this.value ? [this.value] : [];
  }
  protected get current() {
    return typeof this.value === "string" ? this.value : "";
  }
  protected get input() {
    return this.shadowRoot?.querySelector("input");
  }
  protected get popup() {
    return this.shadowRoot?.querySelector<QapDialog>("qap-dialog");
  }
  protected get surface() {
    return this.shadowRoot?.querySelector<HTMLElement>(".options");
  }
  protected get trigger() {
    return this.shadowRoot?.querySelector<HTMLButtonElement>(".trigger");
  }
  override focus(options?: FocusOptions) {
    const focus = () => {
      if (!this.isConnected || this.disabled) return;
      if (this.multiple)
        this.shadowRoot?.querySelector<HTMLElement>(".add-control")?.focus(options);
      else (this.opened ? this.input : this.trigger)?.focus(options);
    };
    if (this.hasUpdated) focus();
    else void this.updateComplete.then(focus);
  }
  checkValidity() {
    return !this.required || (this.multiple ? this.values.length > 0 : Boolean(this.current));
  }
  reportValidity() {
    const valid = this.checkValidity();
    if (!valid) this.focus();
    return valid;
  }
  override disconnectedCallback() {
    this.release();
    this.descriptionObserver?.disconnect();
    this.opened = false;
    this.popup?.close();
    super.disconnectedCallback();
  }
  protected release() {
    this.listeners?.abort();
    this.listeners = undefined;
    this.observer?.disconnect();
    this.observer = undefined;
  }
  protected override willUpdate(changed: PropertyValues) {
    if (this.multiple) {
      this.opened = false;
      return;
    }
    if (this.disabled) this.opened = false;
    const query = this.editingText ?? "";
    if (
      this.opened &&
      (changed.has("opened") ||
        changed.has("editingText") ||
        changed.has("source") ||
        changed.has("revision") ||
        changed.has("selector") ||
        changed.has("value"))
    ) {
      this.options = this.searchOptions(query);
      const retained = this.options.findIndex(
        (option) => !option.disabled && option.value === this.selectedId,
      );
      if (query !== this.previousQuery) {
        this.active = -1;
        if (this.surface) this.surface.scrollTop = 0;
        this.start = 0;
      } else this.active = retained;
      this.previousQuery = query;
      this.selectedId = this.options[this.active]?.value ?? "";
      if (this.surface) {
        this.surface.scrollTop = Math.min(
          this.surface.scrollTop,
          Math.max(0, this.options.length * this.rowHeight - this.surface.clientHeight),
        );
        this.syncStart();
      }
      if (
        this.active >= 0 &&
        (this.active < this.start || this.active >= this.start + this.visibleRows + OVERSCAN * 2)
      ) {
        this.start = Math.max(0, this.active - OVERSCAN);
      }
    }
  }
  protected override updated(changed: PropertyValues) {
    if (changed.has("opened")) {
      this.release();
      const popup = this.popup;
      if (this.opened && popup && this.isConnected) {
        this.position();
        popup.showModal();
        this.listeners = new AbortController();
        const options = { signal: this.listeners.signal };
        document.addEventListener(
          "pointerdown",
          (event) => {
            if (!event.composedPath().includes(this)) this.close();
          },
          { ...options, capture: true },
        );
        window.addEventListener("resize", this.position, options);
        // Capture nested scrolling, without attaching another data subscription.
        document.addEventListener("scroll", this.reposition, {
          ...options,
          capture: true,
          passive: true,
        });
        window.visualViewport?.addEventListener("resize", this.position, options);
        window.visualViewport?.addEventListener("scroll", this.position, options);
        this.observer = new ResizeObserver(this.position);
        this.observer.observe(this);
        if (this.surface) this.observer.observe(this.surface);
      } else popup?.close();
    }
    if (this.opened) {
      this.position();
      if (
        changed.has("revision") ||
        changed.has("source") ||
        changed.has("selector") ||
        changed.has("value")
      )
        this.revealActive();
    }
    const root = this.getRootNode() as Document | ShadowRoot;
    const descriptions = (this.ariaDescribedBy ?? "").split(/\s+/).flatMap((id) => {
      const element = root.getElementById(id);
      return element ? [element] : [];
    });
    for (const control of [this.input, this.trigger]) {
      if (control && "ariaDescribedByElements" in control)
        control.ariaDescribedByElements = descriptions;
    }
    this.descriptionObserver?.disconnect();
    if (this.isConnected && descriptions.length) {
      this.descriptionObserver ??= new MutationObserver(() => this.requestUpdate());
      for (const element of descriptions)
        this.descriptionObserver.observe(element, {
          childList: true,
          characterData: true,
          subtree: true,
        });
    }
  }
  protected reposition = (event: Event) => {
    if (!event.composedPath().includes(this.surface!)) this.position();
  };
  protected position = () => {
    const popup = this.popup,
      rect = this.trigger?.getBoundingClientRect();
    if (!this.opened || !popup || !rect) return;
    const viewport = window.visualViewport,
      edge = 8;
    const left = viewport?.offsetLeft ?? 0,
      top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? innerWidth,
      height = viewport?.height ?? innerHeight;
    const below = top + height - rect.bottom - edge,
      above = rect.top - top - edge;
    const upward = below < Math.min(this.rowHeight * 3, above);
    const available = Math.max(0, upward ? above : below);
    const popupWidth = Math.min(Math.max(rect.width, 250), width - edge * 2);
    const popupHeight = Math.min(available, height * 0.7, height <= 1000 ? 400 : 500);
    popup.style.setProperty("--selector-width", `${popupWidth}px`);
    popup.style.setProperty("--selector-height", `${popupHeight}px`);
    popup.style.setProperty(
      "--selector-left",
      `${Math.max(left + edge, Math.min(rect.left, left + width - popupWidth - edge))}px`,
    );
    popup.style.setProperty(
      "--selector-top",
      `${upward ? Math.max(top + edge, rect.top - popupHeight) : rect.bottom}px`,
    );
    popup.style.setProperty("--selector-origin", upward ? "bottom" : "top");
    this.visibleRows = Math.max(
      VISIBLE_ROWS,
      Math.ceil((this.surface?.clientHeight ?? 0) / this.rowHeight),
    );
  };
  protected open() {
    if (!this.disabled) this.opened = true;
  }
  protected close() {
    if (this.composing) return;
    this.opened = false;
    this.editingText = undefined;
    this.active = -1;
    this.selectedId = "";
  }
  protected handleBlur = () => {
    void Promise.resolve().then(() => {
      if (!this.shadowRoot?.activeElement && !this.touchingOptions) this.close();
    });
  };
  protected commit(value: string | undefined) {
    if (this.disabled || this.composing) return;
    if (value && !this.accepts(value)) return;
    this.editingText = undefined;
    if ((value ?? "") === this.current) return;
    this.value = value;
    this.notifyValue(value);
  }
  protected notifyValue(value: string | string[] | undefined) {
    this.dispatchEvent(
      new CustomEvent("value-changed", { detail: { value }, bubbles: true, composed: true }),
    );
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }
  protected syncStart() {
    this.start = Math.max(
      0,
      Math.floor((this.surface?.scrollTop ?? 0) / this.rowHeight) - OVERSCAN,
    );
  }
  protected selectOption(index: number) {
    const option = this.options[index];
    if (!option || option.disabled) return;
    this.commit(option.value);
    this.close();
    this.trigger?.focus({ preventScroll: true });
  }
  protected revealActive() {
    const surface = this.surface;
    if (!surface || this.active < 0) return;
    const top = this.active * this.rowHeight;
    if (top < surface.scrollTop) surface.scrollTop = top;
    else if (top + this.rowHeight > surface.scrollTop + surface.clientHeight)
      surface.scrollTop = top + this.rowHeight - surface.clientHeight;
    this.syncStart();
  }
  protected navigate = (event: KeyboardEvent) => {
    if (
      !this.usesPicker ||
      this.multiple ||
      this.disabled ||
      this.composing ||
      event.isComposing ||
      event.defaultPrevented
    )
      return;
    if (event.key === "Escape" && this.opened) {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    // QapDialog owns Tab order and wrapping in the picker, as HA's popover does.
    if (event.key === "Tab") return;
    if ((event.key === "Enter" || event.key === " ") && !this.opened) {
      event.preventDefault();
      this.open();
      return;
    }
    if (event.key === "Enter" && this.opened) {
      event.preventDefault();
      event.stopPropagation();
      if (this.active >= 0) this.selectOption(this.active);
      else {
        this.commit(this.editingText?.trim() ?? this.current);
        this.close();
      }
      return;
    }
    if (
      !this.opened &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      this.editingText = event.key;
      this.open();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const move = () => {
      if (!this.options.length) return;
      const enabled = this.options.flatMap((option, index) => (option.disabled ? [] : [index]));
      if (!enabled.length) return;
      const at = enabled.indexOf(this.active);
      if (event.key === "Home") this.active = enabled[0];
      else if (event.key === "End") this.active = enabled[enabled.length - 1];
      else {
        let step = -1;
        if (event.key === "ArrowDown") step = 1;
        else if (at < 0) step = 0;
        this.active = enabled[(at + step + enabled.length) % enabled.length];
      }
      this.selectedId = this.options[this.active].value;
      this.revealActive();
    };
    if (!this.opened) {
      this.open();
      void this.updateComplete.then(move);
    } else move();
  };
  protected readInput(event: Event) {
    event.stopPropagation();
    this.editingText = (event.target as HTMLInputElement).value;
    this.active = -1;
    this.selectedId = "";
    this.open();
  }
  protected get description() {
    const root = this.getRootNode() as Document | ShadowRoot;
    return (
      [
        this.ariaDescription,
        this.helper,
        ...(this.ariaDescribedBy ?? "")
          .split(/\s+/)
          .map((id) => root.getElementById(id)?.textContent),
      ]
        .filter(Boolean)
        .join(" ") || nothing
    );
  }
  protected override render() {
    if (this.multiple) return this.renderMultiple();
    const selected = this.getOption(this.current);
    const end = Math.min(this.options.length, this.start + this.visibleRows + OVERSCAN * 2);
    let triggerLabel;
    if (this.addButton) triggerLabel = this.addLabel;
    else {
      triggerLabel = this.ariaLabel || this.label || this.optionLabel;
      if (this.current) triggerLabel += `: ${this.selectionName}`;
    }
    const fieldIcon = this.addButton ? "mdi:playlist-plus" : this.fieldIcon;
    return html`${this.topLabel && this.label && this.current ? html`<div class="top-label">${this.label}</div>` : nothing}
      <div class="field">
        <button
          class=${`trigger${this.addButton ? " add" : ""}`}
          part="base"
          ?disabled=${this.disabled}
          aria-label=${triggerLabel}
          aria-haspopup="dialog"
          aria-expanded=${String(this.opened)}
          aria-controls="picker-dialog"
          aria-description=${this.description}
          aria-invalid=${this.ariaInvalid ?? nothing}
          @click=${this.open}
        >
          ${fieldIcon ? html`<ha-icon .icon=${fieldIcon} aria-hidden="true"></ha-icon>` : nothing}
          <span class="text"
            >${!this.topLabel && this.label && this.current ? html`<span class="overline">${this.label}</span>` : nothing}<span
              class=${this.current ? "headline" : "placeholder"}
              >${this.addButton ? this.addLabel : selected?.label || this.current || this.label || this.optionLabel}</span
            >
            ${this.current && selected?.secondary ? html`<span class="secondary">${selected.secondary}</span>` : nothing}</span
          >
          ${!this.addButton ? html`<ha-icon class="arrow" icon="mdi:menu-down" aria-hidden="true"></ha-icon>` : nothing}
        </button>
        ${
          this.current && !this.required
            ? html`<button
                class="clear"
                aria-label=${`${this.clearLabel}: ${this.selectionName}`}
                ?disabled=${this.disabled}
                @click=${() => {
                  this.commit(undefined);
                  this.close();
                  this.focus();
                }}
              >
                <ha-icon icon="mdi:close"></ha-icon>
              </button>`
            : nothing
        }
      </div>
      ${this.helper ? html`<div id="hint">${this.helper}</div>` : nothing}
      <qap-dialog
        id="picker-dialog"
        adaptive
        flexcontent
        aria-label=${this.label || this.optionLabel}
        @cancel=${(event: Event) => {
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }}
      >
        <div class="picker" @keydown=${this.navigate}>
          <div class="search-row">
            <div class="search">
              <ha-icon icon="mdi:magnify" aria-hidden="true"></ha-icon>
              <input
                part="input"
                .value=${this.editingText ?? ""}
                ?disabled=${this.disabled}
                role="combobox"
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-expanded=${String(this.opened)}
                aria-controls="options"
                aria-activedescendant=${this.opened && this.active >= 0 ? `option-${this.active}` : nothing}
                aria-label=${this.searchLabel}
                aria-description=${this.description}
                placeholder=${this.searchLabel}
                aria-invalid=${this.ariaInvalid ?? nothing}
                autocomplete="off"
                autocapitalize="none"
                .spellcheck=${false}
                @input=${this.readInput}
                @change=${(event: Event) => event.stopPropagation()}
                @compositionstart=${() => {
                  this.composing = true;
                }}
                @compositionend=${(event: CompositionEvent) => {
                  this.composing = false;
                  this.readInput(event);
                }}
              />
              <button
                class="search-clear"
                ?hidden=${!this.editingText}
                aria-label=${this.clearLabel}
                @click=${() => {
                  this.editingText = "";
                  this.input?.focus();
                }}
              >
                <ha-icon icon="mdi:close"></ha-icon>
              </button>
            </div>
          </div>
          <div
            id="options"
            class="options"
            role="listbox"
            aria-label=${this.label || this.optionLabel}
            @pointerdown=${() => {
              this.touchingOptions = true;
            }}
            @pointercancel=${() => {
              this.touchingOptions = false;
              this.handleBlur();
            }}
            @click=${() => {
              this.touchingOptions = false;
            }}
            @scroll=${(event: Event) => {
              this.syncStart();
              if (
                this.active >= 0 &&
                (this.active < this.start ||
                  this.active >= this.start + this.visibleRows + OVERSCAN * 2)
              ) {
                this.active = -1;
                this.selectedId = "";
              }
            }}
          >
            <div style=${`height:${this.start * this.rowHeight}px`} role="presentation"></div>
            ${this.options.slice(this.start, end).map((option, offset) => {
              const index = this.start + offset;
              return html`<div
                id=${`option-${index}`}
                class=${`option${this.active === index ? " active" : ""}`}
                role="option"
                aria-selected=${String(option.value === this.current)}
                aria-disabled=${String(Boolean(option.disabled))}
                aria-setsize=${this.options.length}
                aria-posinset=${index + 1}
                aria-label=${`${option.label}, ${option.value}${option.secondary ? `, ${option.secondary}` : ""}`}
                @pointerdown=${(event: PointerEvent) => {
                  if (event.pointerType === "mouse") event.preventDefault();
                }}
                @click=${() => this.selectOption(index)}
              >
                ${option.icon ? html`<ha-icon .icon=${option.icon} aria-hidden="true"></ha-icon>` : nothing}
                <div class="text">
                  <div class="headline">${option.label}</div>
                  <div class="secondary">${option.secondary}</div>
                </div>
                <div class="domain">${option.domain}</div>
              </div>`;
            })}
            <div
              style=${`height:${Math.max(0, this.options.length - end) * this.rowHeight}px`}
              role="presentation"
            ></div>
            ${!this.options.length ? html`<div class="empty-option" role="status">${this.noMatchLabel}</div>` : nothing}
            ${
              this.editingText &&
              this.accepts(this.editingText.trim()) &&
              !this.options.some((option) => option.value === this.editingText?.trim())
                ? html`<button
                    class="custom"
                    @click=${() => {
                      this.commit(this.editingText?.trim());
                      this.close();
                    }}
                  >
                    ${this.editingText.trim()}
                  </button>`
                : nothing
            }
          </div>
        </div></qap-dialog
      >`;
  }
  static styles: CSSResultGroup = css`
    :host {
      display: block;
      width: 100%;
      min-width: 0;
      font: inherit;
      color: var(--primary-text-color, #212121);
    }
    :host([hidden]) {
      display: none;
    }
    .field {
      position: relative;
    }
    button {
      font: inherit;
      cursor: pointer;
    }
    .trigger {
      font-family: var(--ha-font-family-body, Roboto, Noto, sans-serif);
    }
    .trigger {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: var(--ha-space-2, 8px);
      width: 100%;
      min-width: 0;
      height: 56px;
      padding: 0 var(--ha-space-2, 8px) 0 var(--ha-space-4, 16px);
      border: 0;
      border-radius: var(--ha-border-radius-sm, 4px) var(--ha-border-radius-sm, 4px) 0 0;
      background: var(--ha-color-form-background, var(--input-fill-color, #f5f5f5));
      color: var(--primary-text-color);
      text-align: start;
    }
    .trigger:not(.add)::after {
      content: "";
      position: absolute;
      bottom: 0;
      inset-inline: 0;
      height: 1px;
      background: var(
        --ha-color-border-neutral-loud,
        var(--input-idle-line-color, var(--divider-color, #999))
      );
    }
    .trigger:focus {
      outline: 0;
    }
    .trigger:focus::after {
      height: 2px;
      background: var(--primary-color);
    }
    .trigger[aria-invalid="true"]::after {
      height: 2px;
      background: var(--error-color);
    }
    .trigger:disabled {
      background: var(--ha-color-form-background-disabled, var(--input-fill-color));
      opacity: 0.5;
      cursor: not-allowed;
    }
    .trigger > ha-icon {
      width: 32px;
      flex: none;
      color: var(--secondary-text-color);
    }
    .trigger .arrow {
      --mdc-icon-size: 20px;
      width: 32px;
    }
    .trigger:has(+ .clear) .text {
      margin-inline-end: 24px;
    }
    .placeholder {
      font-size: var(--ha-font-size-m, 14px);
      line-height: var(--ha-line-height-normal, 1.6);
      color: var(--secondary-text-color);
    }
    .clear,
    .search-clear {
      display: grid;
      place-items: center;
      border: 0;
      background: none;
      color: var(--secondary-text-color);
      padding: 4px;
      width: 32px;
      height: 32px;
    }
    .clear {
      position: absolute;
      top: 12px;
      inset-inline-end: 40px;
    }
    .clear:focus-visible,
    .search-clear:focus-visible {
      outline: 2px solid var(--primary-color);
      border-radius: 50%;
    }
    ha-icon {
      --mdc-icon-size: 24px;
    }
    .top-label,
    .multiple-label {
      display: block;
      margin: 0 0 8px;
      font: inherit;
    }
    qap-entity-selector {
      margin-top: 8px;
    }
    .add {
      width: fit-content;
      height: var(--ha-space-8, 32px);
      padding: 0 var(--ha-space-3, 12px);
      border-radius: var(--ha-border-radius-md, 8px);
      background: var(--ha-color-fill-primary-normal-resting, var(--secondary-background-color));
      color: var(--ha-color-on-primary-normal, var(--primary-color));
    }
    .add .placeholder,
    .add > ha-icon {
      color: inherit;
    }
    .add > ha-icon {
      width: 18px;
      --mdc-icon-size: 18px;
    }
    #hint {
      margin: 8px 0 0;
      font-size: var(--ha-font-size-s, 12px);
      color: var(--secondary-text-color);
    }
    qap-dialog {
      --ha-bottom-sheet-height: calc(100dvh - var(--ha-space-12, 48px));
      --ha-bottom-sheet-max-height: var(--ha-bottom-sheet-height);
      --ha-bottom-sheet-max-width: 600px;
      --ha-bottom-sheet-surface-background: var(--card-background-color);
      --ha-bottom-sheet-border-radius: var(--ha-border-radius-2xl, 16px);
    }
    qap-dialog::part(base) {
      box-shadow: var(--ha-box-shadow-m, 0 4px 8px rgb(0 0 0 / 0.2));
    }
    qap-dialog::part(body) {
      overflow: hidden;
    }
    .picker {
      min-height: 0;
      height: 100%;
      display: flex;
      flex-direction: column;
      font: inherit;
      font-family: var(--ha-font-family-body, Roboto, Noto, sans-serif);
    }
    .search-row {
      padding: 16px 16px 12px;
      flex: none;
    }
    .search {
      box-sizing: border-box;
      height: 40px;
      display: flex;
      align-items: center;
      gap: 0;
      padding: 0 8px;
      border: 1px solid var(--ha-color-border-neutral-quiet, var(--divider-color, #ddd));
      border-radius: var(--ha-border-radius-md, 8px);
    }
    .search:focus-within {
      border-color: var(--primary-color, #03a9f4);
    }
    .search > ha-icon {
      --mdc-icon-size: 18px;
      color: var(--primary-text-color);
    }
    input {
      box-sizing: border-box;
      flex: 1;
      width: 100%;
      min-width: 0;
      height: 38px;
      padding: 0 0 0 4px;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--primary-text-color);
      font: inherit;
      font-family: var(--ha-font-family-body, inherit);
      font-size: var(--ha-font-size-m, 14px);
    }
    .search-clear[hidden] {
      display: none;
    }
    .options {
      min-height: 0;
      flex: 1;
      overflow: auto;
      overscroll-behavior: contain;
      overflow-anchor: none;
    }
    .option {
      box-sizing: border-box;
      height: 56px;
      padding: 8px 16px;
      display: flex;
      align-items: center;
      gap: 16px;
      cursor: pointer;
      border-top: 1px solid var(--divider-color, #ddd);
      color: var(--primary-text-color);
    }
    .option:nth-child(2) {
      border-top: 0;
    }
    .option > ha-icon {
      width: 32px;
      flex: none;
      color: var(--secondary-text-color);
    }
    .text {
      min-width: 0;
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .text > * {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .headline {
      font-size: var(--ha-font-size-m, 14px);
      line-height: 22px;
    }
    .secondary {
      font-size: var(--ha-font-size-s, 12px);
      line-height: 18px;
      color: var(--secondary-text-color);
    }
    .domain {
      max-width: 30%;
      flex: none;
      align-self: flex-end;
      padding-bottom: 8px;
      font-size: 12px;
      line-height: 18px;
      color: var(--secondary-text-color);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .option.active {
      background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.12);
    }
    .option[aria-selected="true"] {
      background: var(
        --ha-color-fill-primary-quiet-resting,
        rgba(var(--rgb-primary-color, 3, 169, 244), 0.06)
      );
    }
    .option.active[aria-selected="true"] {
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.24);
    }
    .empty-option {
      padding: 16px;
      font-size: 14px;
    }
    .custom {
      width: 100%;
      min-height: 48px;
      padding: 8px 16px;
      border: 0;
      text-align: start;
      background: transparent;
      color: var(--primary-color);
    }
    @media (min-width: 871px) and (min-height: 501px) {
      qap-dialog {
        --mdc-dialog-scrim-color: transparent;
        --ha-dialog-scrim-backdrop-filter: none;
      }
      qap-dialog::part(base) {
        inset: var(--selector-top) auto auto var(--selector-left);
        margin: 0;
        padding: 0;
        width: var(--selector-width);
        max-width: calc(100vw - 16px);
        height: auto;
        max-height: var(--selector-height);
        border-radius: var(--ha-border-radius-md, 8px);
        animation: none;
      }
      qap-dialog::part(base)::backdrop {
        background: transparent;
        backdrop-filter: none;
      }
      .picker {
        max-height: var(--selector-height);
      }
    }
    @media (pointer: coarse) {
      input {
        font-size: 16px;
      }
    }
    @media (hover: hover) {
      .option:hover {
        background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08);
      }
    }
  `;
}
