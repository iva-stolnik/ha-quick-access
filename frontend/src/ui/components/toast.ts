import { css, html, LitElement } from "lit";

const TRANSITION_COMPLETION_TIMEOUT = 5000;
type CloseReason = "programmatic" | "timeout" | "dismiss";

/** Transient feedback only; callers own messages and their localization. */
export class QapToast extends LitElement {
  static properties = {
    labelText: { attribute: "label-text" },
    announceText: { attribute: "announce-text" },
    timeoutMs: { type: Number, attribute: "timeout-ms" },
    bottomOffset: { type: Number, attribute: "bottom-offset" },
    active: { state: true },
    visible: { state: true },
    announcing: { state: true },
    hasActions: { state: true },
  };
  declare labelText: string;
  declare announceText: string | undefined;
  declare timeoutMs: number;
  declare bottomOffset: number;
  declare private active: boolean;
  declare private visible: boolean;
  declare private announcing: boolean;
  declare private hasActions: boolean;
  private generation = 0;
  private dismissTimer: ReturnType<typeof setTimeout> | undefined;
  private transitionTimer: ReturnType<typeof setTimeout> | undefined;
  private finishTransition: (() => void) | undefined;

  constructor() {
    super();
    this.labelText = "";
    this.timeoutMs = 4000;
    this.bottomOffset = 0;
    this.active = false;
    this.visible = false;
    this.announcing = false;
    this.hasActions = false;
  }
  private get surface() {
    return this.shadowRoot?.querySelector<HTMLElement>("[popover]");
  }
  private cancelPending() {
    ++this.generation;
    clearTimeout(this.dismissTimer);
    this.dismissTimer = undefined;
    this.finishTransition?.();
  }
  private waitForTransition() {
    const animations = this.surface?.getAnimations() ?? [];
    if (!animations.length) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const finish = () => {
        if (this.finishTransition !== finish) return;
        clearTimeout(this.transitionTimer);
        this.transitionTimer = undefined;
        this.finishTransition = undefined;
        resolve();
      };
      this.finishTransition = finish;
      this.transitionTimer = setTimeout(finish, TRANSITION_COMPLETION_TIMEOUT);
      void Promise.allSettled(animations.map((animation) => animation.finished)).then(finish);
    });
  }
  async show() {
    const alreadyVisible = this.active && this.visible;
    this.cancelPending();
    const generation = this.generation;
    if (!this.isConnected) return;
    this.active = true;
    // Clear the persistent live region first, including repeated identical
    // messages. Only the latest show may populate it or schedule dismissal.
    this.announcing = false;
    await this.updateComplete;
    if (generation !== this.generation || !this.isConnected) return;
    this.surface?.showPopover();
    this.surface?.getBoundingClientRect();
    this.visible = true;
    this.announcing = true;
    await this.updateComplete;
    if (generation !== this.generation || !this.isConnected) return;
    if (!alreadyVisible) await this.waitForTransition();
    if (generation !== this.generation || !this.isConnected) return;
    if (this.timeoutMs > 0)
      this.dismissTimer = setTimeout(() => {
        void this.hide("timeout");
      }, this.timeoutMs);
  }
  async hide(reason: CloseReason = "programmatic") {
    this.cancelPending();
    const generation = this.generation;
    if (!this.active) return;
    this.visible = false;
    this.announcing = false;
    await this.updateComplete;
    if (generation !== this.generation || !this.isConnected) return;
    await this.waitForTransition();
    if (generation !== this.generation || !this.isConnected) return;
    this.surface?.hidePopover();
    this.active = false;
    await this.updateComplete;
    if (generation === this.generation && this.isConnected) {
      this.dispatchEvent(
        new CustomEvent("toast-closed", { detail: { reason }, bubbles: true, composed: true }),
      );
    }
  }
  close(reason: CloseReason = "programmatic") {
    return this.hide(reason);
  }
  override disconnectedCallback() {
    this.cancelPending();
    this.surface?.hidePopover();
    this.active = this.visible = false;
    this.announcing = false;
    super.disconnectedCallback();
  }
  private syncActions = () => {
    this.hasActions = [...this.querySelectorAll('[slot="action"], [slot="dismiss"]')].length > 0;
  };
  protected override render() {
    return html`<div
        popover="manual"
        part="base"
        class="toast ${this.active ? "active" : ""} ${this.visible ? "visible" : ""}"
        style=${`--ha-toast-bottom-offset:${this.bottomOffset}px`}
      >
        <span class="message">${this.labelText}</span>
        <div class="actions" ?hidden=${!this.hasActions}>
          <slot name="action" @slotchange=${this.syncActions}></slot
          ><slot name="dismiss" @slotchange=${this.syncActions}></slot>
        </div>
      </div>
      <span class="assistive-message" role="status" aria-live="polite" aria-atomic="true"
        >${this.announcing ? (this.announceText ?? this.labelText) : ""}</span
      >`;
  }
  static styles = css`
    :host {
      --scale-direction: 1;
      pointer-events: none;
    }
    :host(:dir(rtl)) {
      --scale-direction: -1;
    }
    .toast {
      box-sizing: border-box;
      width: max-content;
      height: auto;
      min-width: min(350px, calc(var(--safe-width, 100vw) - var(--ha-space-4, 16px)));
      max-width: min(650px, var(--safe-width, 100vw));
      display: flex;
      align-items: center;
      gap: var(--ha-space-2, 8px);
      min-height: 48px;
      padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px);
      color: var(--ha-color-on-neutral-loud, var(--qap-toast-text, #fff));
      background: var(--ha-color-neutral-10, var(--qap-toast-bg, #1c1c1c));
      border-radius: var(--ha-border-radius-sm, 4px);
      box-shadow: var(
        --wa-shadow-l,
        var(--ha-box-shadow-l, 0 6px 12px -3px rgb(0 0 0 / 0.12), 0 16px 32px -6px rgb(0 0 0 / 0.2))
      );
      opacity: 0;
      transform: translate(calc(-50% * var(--scale-direction)), var(--ha-space-2, 8px));
      transition:
        opacity var(--ha-animation-duration-fast, 0.15s) ease,
        transform var(--ha-animation-duration-fast, 0.15s) ease;
      border: 0;
      margin: 0;
      position: fixed;
      inset-block-start: auto;
      inset-block-end: calc(
        var(--safe-area-inset-bottom, 0px) + var(--ha-space-4, 16px) +
          var(--ha-toast-bottom-offset, 0px)
      );
      inset-inline: 50% auto;
      overflow: hidden;
      font: inherit;
    }
    .toast.visible {
      opacity: 1;
      transform: translate(calc(-50% * var(--scale-direction)), 0);
    }
    .toast:not(.active) {
      display: none;
    }
    .message {
      flex: 1;
      min-width: 0;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: var(--ha-space-2, 8px);
      pointer-events: auto;
    }
    .actions[hidden] {
      display: none;
    }
    .assistive-message {
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      position: absolute;
      overflow: hidden;
    }
    @media (max-width: 450px), (max-height: 500px) {
      .toast {
        min-width: var(--safe-width, 100vw);
        max-width: var(--safe-width, 100vw);
        border-radius: var(--ha-border-radius-square, 0);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .toast {
        transition: none;
      }
    }
  `;
}
