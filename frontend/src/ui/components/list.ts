import { css, html, LitElement } from "lit";
import { QapButton } from "./button";

export class QapListItem extends QapButton {
  static properties = { ...QapButton.properties, focusIndex: { type: Number, attribute: false } };
  declare focusIndex: number;
  constructor() {
    super();
    this.focusIndex = -1;
  }
  protected override get controlTabIndex() {
    return this.focusIndex;
  }
  protected override renderLabel() {
    return html`<slot name="content"><slot></slot></slot>`;
  }
  override connectedCallback() {
    super.connectedCallback();
    this.setAttribute("role", "listitem");
  }
  static styles = [
    QapButton.styles,
    css`
      :host {
        display: block;
        color: var(--primary-text-color);
        font-size: var(--ha-font-size-m, 14px);
        line-height: var(--ha-line-height-normal, 1.6);
        --ha-ripple-color: var(--primary-text-color);
      }
      [part="base"] {
        justify-content: flex-start;
        gap: var(--ha-row-item-gap, var(--ha-space-4, 16px));
        min-height: var(--ha-row-item-min-height, 48px);
        height: auto;
        padding: var(--ha-row-item-padding-block, var(--ha-space-3, 12px))
          var(--ha-row-item-padding-inline, var(--ha-space-4, 16px));
        border: 0;
        border-radius: var(--ha-list-item-focus-radius, var(--ha-border-radius-sm, 4px));
        background: transparent;
        outline: var(--ha-list-item-focus-width, 2px) solid transparent;
        outline-offset: var(--ha-list-item-focus-offset, -2px);
        transition:
          outline-color var(--ha-animation-duration-fast, 150ms) ease-out,
          background-color var(--ha-animation-duration-fast, 150ms) ease-out;
        color: inherit;
        font: inherit;
        line-height: inherit;
        text-align: inherit;
      }
      [part="label"] {
        flex: 1;
        padding: 0;
        overflow: visible;
      }
      [part="base"].has-start,
      [part="base"].has-end {
        padding-inline: var(--ha-row-item-padding-inline, var(--ha-space-4, 16px));
      }
      slot[name="start"]::slotted(*),
      slot[name="end"]::slotted(*) {
        margin: 0;
      }
      [part="base"]:hover,
      [part="base"]:active {
        background: transparent;
      }
      [part="base"]::before,
      [part="base"]::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        opacity: 0;
      }
      [part="base"]::before {
        background: var(--ha-ripple-hover-color, var(--ha-ripple-color));
      }
      [part="base"]::after {
        background: var(--ha-ripple-pressed-color, var(--ha-ripple-color));
      }
      @media (hover: hover) {
        [part="base"]:hover::before {
          opacity: var(--ha-ripple-hover-opacity, 0.08);
        }
      }
      [part="base"]:active::after {
        opacity: var(--ha-ripple-pressed-opacity, 0.12);
      }
      [part="base"]:focus-visible {
        outline: var(--ha-list-item-focus-width, 2px) solid
          var(--ha-color-focus, var(--primary-color));
        outline-offset: var(--ha-list-item-focus-offset, -2px);
        background: var(--ha-list-item-focus-background, var(--ha-color-fill-neutral-quiet-hover));
        animation: focus-in var(--ha-animation-duration-normal, 300ms) ease-in;
      }
      @keyframes focus-in {
        from {
          outline-width: var(--ha-list-item-focus-width-start, 8px);
          outline-offset: calc(-1 * var(--ha-list-item-focus-width-start, 8px));
        }
        to {
          outline-width: var(--ha-list-item-focus-width, 2px);
          outline-offset: var(--ha-list-item-focus-offset, -2px);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        [part="base"]:focus-visible {
          animation: none;
        }
      }
      :host([disabled]) {
        pointer-events: none;
      }
      :host([disabled]) [part="base"] {
        color: var(--disabled-text-color);
      }
    `,
  ];
}

/** Roving focus only; rows retain their existing controller-owned actions. */
export class QapList extends LitElement {
  private observer: MutationObserver | undefined;
  constructor() {
    super();
    this.addEventListener("keydown", this.navigate);
    this.addEventListener("focusin", (event) => {
      const item = event
        .composedPath()
        .find((node): node is QapListItem => node instanceof QapListItem);
      if (item) this.sync(item);
    });
  }
  override connectedCallback() {
    super.connectedCallback();
    this.setAttribute("role", "list");
    this.observer = new MutationObserver(() => this.sync());
    this.observer.observe(this, {
      attributes: true,
      subtree: true,
      attributeFilter: ["disabled", "hidden"],
    });
    this.sync();
  }
  override disconnectedCallback() {
    this.observer?.disconnect();
    this.observer = undefined;
    super.disconnectedCallback();
  }
  private get items() {
    return [...this.children].filter(
      (item): item is QapListItem => item instanceof QapListItem && !item.disabled && !item.hidden,
    );
  }
  private sync(active = this.items.find((item) => item.focusIndex === 0) ?? this.items[0]) {
    for (const child of this.children)
      if (child instanceof QapListItem) child.focusIndex = child === active ? 0 : -1;
  }
  private navigate = (event: KeyboardEvent) => {
    if (
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
    )
      return;
    const items = this.items;
    if (!items.length) return;
    const index = items.findIndex((item) => event.composedPath().includes(item));
    let next;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else {
      const step = event.key === "ArrowDown" ? 1 : -1;
      next = (index + step + items.length) % items.length;
    }
    event.preventDefault();
    event.stopPropagation();
    this.sync(items[next]);
    items[next].focus({ preventScroll: true });
  };
  protected override render() {
    return html`<slot @slotchange=${() => this.sync()}></slot>`;
  }
  static styles = css`
    :host {
      display: block;
    }
  `;
}
