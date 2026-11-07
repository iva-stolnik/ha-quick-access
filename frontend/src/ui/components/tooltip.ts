import { css, html, LitElement, type PropertyValues } from "lit";

/** Manual visibility keeps the existing help button's focus/tap contract. */
export class QapTooltip extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    anchorElement: { attribute: false },
  };
  declare open: boolean;
  declare anchorElement: HTMLElement | undefined;
  private listeners: AbortController | undefined;
  private observer: ResizeObserver | undefined;

  constructor() {
    super();
    this.open = false;
  }

  private get surface() {
    return this.shadowRoot?.querySelector<HTMLElement>("[popover]");
  }

  protected override updated(changed: PropertyValues) {
    if (!changed.has("open") && !changed.has("anchorElement")) return;
    this.release();
    const surface = this.surface;
    if (!surface || !this.isConnected) return;
    if (!this.open) {
      surface.hidePopover();
      return;
    }
    surface.showPopover();
    this.position();
    this.listeners = new AbortController();
    const options = { signal: this.listeners.signal };
    window.addEventListener("resize", this.position, options);
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape" || event.isComposing || !this.open) return;
        event.preventDefault();
        event.stopPropagation();
        this.open = false;
        this.dispatchEvent(new Event("close"));
      },
      { ...options, capture: true },
    );
    document.addEventListener("scroll", this.position, { ...options, capture: true });
    window.visualViewport?.addEventListener("resize", this.position, options);
    window.visualViewport?.addEventListener("scroll", this.position, options);
    this.observer = new ResizeObserver(this.position);
    this.observer.observe(surface);
    if (this.anchorElement) this.observer.observe(this.anchorElement);
  }

  private position = () => {
    const surface = this.surface;
    if (!surface || !this.anchorElement?.isConnected) return;
    const anchor = this.anchorElement.getBoundingClientRect();
    const rect = surface.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0,
      top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? innerWidth,
      height = viewport?.height ?? innerHeight;
    const gap = 8,
      edge = 8;
    surface.style.left = `${Math.max(left + edge, Math.min(anchor.right - rect.width, left + width - rect.width - edge))}px`;
    const below = anchor.bottom + gap;
    surface.style.top = `${Math.max(top + edge, Math.min(below + rect.height <= top + height - edge ? below : anchor.top - rect.height - gap, top + height - rect.height - edge))}px`;
  };

  private release() {
    this.listeners?.abort();
    this.listeners = undefined;
    this.observer?.disconnect();
    this.observer = undefined;
  }
  override disconnectedCallback() {
    this.release();
    this.surface?.hidePopover();
    super.disconnectedCallback();
  }
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate("open");
  }

  protected override render() {
    return html`<div popover="manual">
      <div part="body"><slot></slot></div>
    </div>`;
  }

  static styles = css`
    :host {
      display: contents;
    }
    [popover] {
      position: fixed;
      inset: auto;
      margin: 0;
      box-sizing: border-box;
      width: max-content;
      max-width: var(--max-width, 280px);
      overflow: visible;
      border: 0;
      padding: var(--ha-tooltip-padding, 0.25em 0.5em);
      border-radius: var(--ha-tooltip-border-radius, var(--ha-border-radius-md, 8px));
      background: var(
        --ha-tooltip-background-color,
        var(--ha-color-surface-default, var(--card-background-color, #fff))
      );
      color: var(--ha-tooltip-text-color, var(--primary-text-color));
      font-family: var(--ha-tooltip-font-family, var(--ha-font-family-body, inherit));
      font-size: var(--ha-tooltip-font-size, var(--ha-font-size-m, 14px));
      font-weight: var(--ha-tooltip-font-weight, var(--ha-font-weight-normal, 400));
      line-height: var(--ha-tooltip-line-height, var(--ha-line-height-condensed, 1.2));
      box-shadow: var(--ha-tooltip-box-shadow, var(--ha-box-shadow-m, 0 4px 8px #0003));
    }
    [popover]::before {
      content: "";
      position: absolute;
      inset: -8px 0;
      z-index: -1;
    }
    [part="body"] {
      max-height: calc(100dvh - 32px);
      overflow: auto;
    }
  `;
}
