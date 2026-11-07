import { css, html, LitElement, type PropertyValues } from "lit";
import { QapButton } from "./button";

const ANIMATION_COMPLETION_TIMEOUT = 5000;

export class QapMenuItem extends QapButton {
  static properties = { ...QapButton.properties, value: {} };
  declare value: string;
  constructor() {
    super();
    this.value = "";
  }
  protected override get controlRole() {
    return "menuitem";
  }
  protected override get controlTabIndex() {
    return -1;
  }
  protected override renderStart() {
    return html`<slot name="icon" part="icon"></slot>`;
  }
  static styles = [
    QapButton.styles,
    css`
      :host {
        display: block;
        min-height: var(--ha-space-10, 40px);
        font: inherit;
      }
      [part="base"] {
        min-height: var(--ha-space-10, 40px);
        justify-content: flex-start;
        border: 0;
        padding: 0.5em 1em;
        border-radius: var(--wa-border-radius-s, var(--ha-border-radius-sm, 4px));
        color: var(--wa-color-text-normal, var(--primary-text-color));
        background: transparent;
        font: inherit;
        line-height: var(--wa-line-height-condensed, 1.2);
        text-align: start;
      }
      [part="label"] {
        flex: auto;
        padding: 0;
        white-space: normal;
        overflow-wrap: break-word;
      }
      slot[name="icon"]::slotted(*) {
        margin-inline-end: 0.75em;
        color: var(--ha-color-on-neutral-normal, var(--secondary-text-color));
      }
      :host([variant="danger"]) [part="base"],
      :host([variant="danger"]) slot[name="icon"]::slotted(*) {
        color: var(--ha-color-on-danger-quiet, var(--error-color));
      }
      [part="base"]:active {
        background: transparent;
      }
      [part="base"]:focus-visible {
        outline-offset: 0;
        background: var(
          --wa-color-neutral-fill-normal,
          var(--ha-color-fill-neutral-normal-resting, var(--secondary-background-color))
        );
      }
      :host([variant="danger"]) [part="base"]:focus-visible {
        background: var(--wa-color-danger-fill-normal, var(--ha-color-fill-danger-normal-resting));
        color: var(--wa-color-danger-on-normal, var(--ha-color-on-danger-normal));
      }
      :host([disabled]) {
        opacity: 0.5;
      }
      :host([disabled]) [part="base"] {
        color: var(--wa-color-text-normal, var(--primary-text-color));
      }
      :host([disabled][variant="danger"]) [part="base"] {
        color: var(--ha-color-on-danger-quiet, var(--error-color));
      }
      @media (hover: hover) {
        [part="base"]:hover {
          background: var(
            --wa-color-neutral-fill-normal,
            var(--ha-color-fill-neutral-normal-resting, var(--secondary-background-color))
          );
        }
        :host([variant="danger"]) [part="base"]:hover {
          background: var(
            --wa-color-danger-fill-normal,
            var(--ha-color-fill-danger-normal-resting)
          );
          color: var(--wa-color-danger-on-normal, var(--ha-color-on-danger-normal));
        }
      }
    `,
  ];
}

/** Flat action menu; preserves the dropdown events consumed by existing owners. */
export class QapMenu extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true, noAccessor: true },
    anchorElement: { attribute: false },
    distance: { type: Number },
    placement: {},
    ariaLabel: { attribute: "aria-label" },
  };
  private menuOpen = false;
  private pendingHide = false;
  get open() {
    return this.menuOpen;
  }
  set open(value: boolean) {
    const previous = this.menuOpen;
    if (previous === value) return;
    this.menuOpen = value;
    // A selection can close the menu before Lit's first render. Its owner must
    // still receive hide completion exactly once to commit the selected action.
    this.cancelAnimationCompletion();
    if (value) this.pendingHide = true;
    this.requestUpdate("open", previous);
  }
  declare anchorElement: HTMLElement | undefined;
  declare distance: number;
  declare placement: string;
  declare ariaLabel: string | null;
  private listeners: AbortController | undefined;
  private observer: ResizeObserver | undefined;
  private generation = 0;
  private animationTimer: ReturnType<typeof setTimeout> | undefined;
  private query = "";
  private typedAt = 0;
  constructor() {
    super();
    this.open = false;
    this.distance = 0;
    this.placement = "bottom-end";
    this.addEventListener("keydown", this.navigate);
    this.addEventListener("click", (event) => {
      const item = event
        .composedPath()
        .find(
          (node): node is QapMenuItem => node instanceof QapMenuItem && node.parentElement === this,
        );
      if (!this.open || !item || item.disabled) return;
      const selection = new CustomEvent("wa-select", {
        detail: { item },
        bubbles: true,
        composed: true,
        cancelable: true,
      });
      if (this.dispatchEvent(selection)) {
        this.open = false;
        this.anchorElement?.focus({ preventScroll: true });
      }
    });
  }
  private get surface() {
    return this.shadowRoot?.querySelector<HTMLElement>("[popover]");
  }
  private get items() {
    return [...this.children].filter(
      (item): item is QapMenuItem => item instanceof QapMenuItem && !item.disabled && !item.hidden,
    );
  }
  protected override updated(changed: PropertyValues) {
    if (changed.has("open")) void this.syncOpen();
    else if (this.open) this.position();
  }
  private async syncOpen() {
    this.cancelAnimationCompletion();
    const generation = this.generation,
      surface = this.surface;
    this.listeners?.abort();
    this.listeners = undefined;
    this.observer?.disconnect();
    this.observer = undefined;
    if (!surface || !this.isConnected) return;
    if (this.open) {
      if (!this.anchorElement?.isConnected) {
        this.open = false;
        return;
      }
      surface.showPopover();
      this.position();
      surface.className = "show";
      this.query = "";
      this.listeners = new AbortController();
      const options = { signal: this.listeners.signal };
      const dismissOutside = (event: Event) => {
        const path = event.composedPath();
        if (!path.includes(this) && (!this.anchorElement || !path.includes(this.anchorElement)))
          this.open = false;
      };
      document.addEventListener("pointerdown", dismissOutside, { ...options, capture: true });
      document.addEventListener("focusin", dismissOutside, { ...options, capture: true });
      window.visualViewport?.addEventListener("resize", this.position, options);
      window.visualViewport?.addEventListener("scroll", this.position, options);
      this.observer = new ResizeObserver(this.position);
      this.observer.observe(surface);
    } else {
      if (!surface.matches(":popover-open")) {
        if (this.pendingHide) {
          this.pendingHide = false;
          this.dispatchEvent(new Event("wa-after-hide", { bubbles: true, composed: true }));
        }
        return;
      }
      surface.className = "hide";
    }
    const finish = () => {
      if (generation !== this.generation || !this.isConnected) return;
      const opened = this.open;
      this.cancelAnimationCompletion();
      const completionGeneration = this.generation;
      if (!opened) {
        this.pendingHide = false;
        surface.hidePopover();
      } else {
        this.position();
        this.items[0]?.focus({ preventScroll: true });
      }
      if (completionGeneration !== this.generation || opened !== this.open) return;
      this.dispatchEvent(
        new Event(opened ? "wa-after-show" : "wa-after-hide", { bubbles: true, composed: true }),
      );
    };
    // Like QapDialog, bound completion even for paused/infinite animations.
    // The generation is invalidated synchronously on reopen and on completion,
    // so a late promise cannot hide a new opening or emit duplicate events.
    this.animationTimer = setTimeout(finish, ANIMATION_COMPLETION_TIMEOUT);
    await Promise.allSettled(surface.getAnimations().map((animation) => animation.finished));
    finish();
  }
  private cancelAnimationCompletion() {
    ++this.generation;
    clearTimeout(this.animationTimer);
    this.animationTimer = undefined;
  }
  private position = () => {
    const surface = this.surface,
      anchor = this.anchorElement?.getBoundingClientRect();
    if (!surface || !anchor) return;
    const viewport = window.visualViewport,
      edge = 8;
    const left = viewport?.offsetLeft ?? 0,
      top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? innerWidth,
      height = viewport?.height ?? innerHeight;
    surface.style.maxWidth = `${Math.max(0, width - edge * 2)}px`;
    surface.style.maxHeight = `${Math.max(0, height - edge * 2)}px`;
    // Animation scale changes the client rect. Position against layout size so
    // first-render children and live localization cannot push the menu offscreen.
    const style = getComputedStyle(surface);
    const menuWidth = parseFloat(style.width),
      menuHeight = parseFloat(style.height);
    surface.style.left = `${Math.max(left + edge, Math.min(anchor.right - menuWidth, left + width - menuWidth - edge))}px`;
    const below = anchor.bottom + this.distance;
    surface.style.top = `${Math.max(top + edge, Math.min(below + menuHeight <= top + height - edge ? below : anchor.top - menuHeight - this.distance, top + height - menuHeight - edge))}px`;
    surface.style.transformOrigin = below + menuHeight <= top + height - edge ? "top" : "bottom";
  };
  private navigate = (event: KeyboardEvent) => {
    if (!this.open || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.anchorElement?.focus({ preventScroll: true });
      }
      this.open = false;
      return;
    }
    const items = this.items;
    if (!items.length) return;
    const index = items.findIndex((item) => event.composedPath().includes(item));
    let next: QapMenuItem | undefined;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      let target;
      if (event.key === "Home") target = 0;
      else if (event.key === "End") target = items.length - 1;
      else {
        const step = event.key === "ArrowDown" ? 1 : -1;
        target = (index + step + items.length) % items.length;
      }
      next = items[target];
    } else if (event.key.length === 1 && event.key !== " ") {
      const now = performance.now();
      this.query = now - this.typedAt > 1000 ? event.key : this.query + event.key;
      this.typedAt = now;
      const matches = (item: QapMenuItem) =>
        (item.textContent ?? "")
          .trim()
          .toLocaleLowerCase()
          .startsWith(this.query.toLocaleLowerCase());
      next = [...items.slice(index + 1), ...items.slice(0, index + 1)].find(matches);
    }
    if (next) {
      event.preventDefault();
      event.stopPropagation();
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest" });
    }
  };
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate("open");
  }
  override disconnectedCallback() {
    this.cancelAnimationCompletion();
    this.open = false;
    this.pendingHide = false;
    this.listeners?.abort();
    this.listeners = undefined;
    this.observer?.disconnect();
    this.observer = undefined;
    this.surface?.hidePopover();
    super.disconnectedCallback();
  }
  protected override render() {
    return html`<div popover="manual" role="menu" aria-label=${this.ariaLabel ?? ""} part="menu">
      <slot></slot>
    </div>`;
  }
  static styles = css`
    :host {
      display: contents;
      font-size: var(--ha-dropdown-font-size, var(--ha-font-size-m, 14px));
    }
    [popover] {
      position: fixed;
      inset: auto;
      margin: 0;
      box-sizing: border-box;
      width: max-content;
      overflow: auto;
      padding: var(--ha-space-1, 4px);
      border: var(--wa-border-width-s, 1px) var(--wa-border-style, solid)
        var(--wa-color-surface-border, var(--divider-color, #ddd));
      border-radius: var(--wa-border-radius-m, var(--ha-border-radius-md, 8px));
      background: var(--card-background-color, var(--ha-dialog-surface-background, #fff));
      color: var(--wa-color-text-normal, var(--primary-text-color));
      font: inherit;
      font-size: var(--ha-dropdown-font-size, var(--ha-font-size-m, 14px));
      box-shadow: var(--wa-shadow-m, var(--ha-box-shadow-m, 0 4px 8px #0003));
    }
    [popover]:popover-open {
      display: flex;
      flex-direction: column;
    }
    .show {
      animation: show var(--show-duration, 50ms) ease;
    }
    .hide {
      animation: show var(--hide-duration, 50ms) ease reverse;
    }
    @keyframes show {
      from {
        opacity: 0;
        scale: 0.9;
      }
      to {
        opacity: 1;
        scale: 1;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .show,
      .hide {
        animation: none;
      }
    }
  `;
}
