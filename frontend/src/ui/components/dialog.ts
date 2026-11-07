import { css, html, LitElement, nothing } from "lit";

const SHEET_QUERY = "(max-width: 870px), (max-height: 500px)";
const SWIPE_DISTANCE_RATIO = 0.5;
const SWIPE_MIN_DISTANCE = 30;
const SWIPE_MIN_VELOCITY = 0.5;
const CLOSE_ANIMATION_TIMEOUT = 5000;
type FocusControl = HTMLElement & { disabled?: boolean; updateComplete?: Promise<boolean> };
type ScrollLock = { dialogs: Set<QapDialog>; values: [HTMLElement, string, string][] };
const scrollLocks = new WeakMap<Document, ScrollLock>();

/** Presentation only: controllers own dismissal guards and navigation/history. */
export class QapDialog extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    label: {},
    description: {},
    adaptive: { type: Boolean, reflect: true },
    width: { reflect: true },
    type: { reflect: true },
    headerTitle: { attribute: "header-title" },
    withoutHeader: { type: Boolean, attribute: "without-header" },
    flexContent: { type: Boolean, reflect: true, attribute: "flexcontent" },
    preventScrimClose: { type: Boolean, reflect: true, attribute: "prevent-scrim-close" },
  };
  declare open: boolean;
  declare label: string;
  declare description: string;
  declare adaptive: boolean;
  declare width: "small" | "medium" | "large" | "full";
  declare type: "standard" | "alert";
  declare headerTitle: string | undefined;
  declare withoutHeader: boolean;
  declare flexContent: boolean;
  declare preventScrimClose: boolean;
  private returnFocus: HTMLElement | null = null;
  private active = false;
  private closing = false;
  private animationGeneration = 0;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private sheetMedia: MediaQueryList | null = null;
  private labelsObserver: MutationObserver | null = null;
  private backdropPointer = false;
  private gesture: { x: number; y: number; time: number; distance: number } | null = null;

  constructor() {
    super();
    this.open = false;
    this.label = this.description = "";
    this.adaptive = this.flexContent = this.preventScrimClose = false;
    this.withoutHeader = true;
    this.width = "medium";
    this.type = "standard";
    this.addEventListener("keydown", this.handleKeyDown);
  }

  override connectedCallback() {
    super.connectedCallback();
    // ID references in light DOM cannot name a dialog inside a shadow root.
    // Observe localized title/description text and expose its resolved text.
    this.labelsObserver = new MutationObserver(() => this.requestUpdate());
    this.labelsObserver.observe(this, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label", "aria-labelledby", "aria-describedby"],
    });
  }

  override disconnectedCallback() {
    this.labelsObserver?.disconnect();
    this.labelsObserver = null;
    this.open = false;
    this.finishClose();
    super.disconnectedCallback();
  }

  private get surface() {
    return this.shadowRoot?.querySelector("dialog") ?? null;
  }

  private referenceText(attribute: string) {
    const root = this.getRootNode() as Document | ShadowRoot;
    return (this.getAttribute(attribute) ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => root.getElementById?.(id)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
  }

  private focusableControls(backward = false): FocusControl[] {
    // Shadow hosts and slots own separate tabindex scopes. Only use this order
    // at the modal boundary; the browser owns navigation inside each control.
    const collect = (children: Iterable<Element>): FocusControl[] => {
      const scope: { index: number; controls: FocusControl[] }[] = [];
      const visit = (element: Element) => {
        if (
          !(element instanceof HTMLElement) ||
          element instanceof QapDialog ||
          element.hidden ||
          element.inert ||
          getComputedStyle(element).display === "none"
        )
          return;
        const control = element as FocusControl;
        const isSlot = element instanceof HTMLSlotElement;
        const ownsScope = isSlot || Boolean(element.shadowRoot);
        if (ownsScope && element.hasAttribute("tabindex") && element.tabIndex < 0) return;
        const editingHost = element.isContentEditable && !element.parentElement?.isContentEditable;
        const tabbable =
          (element.tabIndex >= 0 || (editingHost && !element.hasAttribute("tabindex"))) &&
          !control.disabled &&
          !element.matches(":disabled, input[type=hidden]") &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility === "visible";
        const controls =
          tabbable && !isSlot && !element.shadowRoot?.delegatesFocus ? [control] : [];
        if (ownsScope) {
          let children: Iterable<Element>;
          if (isSlot) {
            const assigned = element.assignedElements({ flatten: true });
            children = assigned.length ? assigned : element.children;
          } else children = element.shadowRoot!.children;
          controls.push(...collect(children));
        }
        if (controls.length) scope.push({ index: Math.max(0, element.tabIndex), controls });
        if (!ownsScope) for (const child of element.children) visit(child);
      };
      for (const child of children) visit(child);
      scope.sort((a, b) => (a.index || Infinity) - (b.index || Infinity));
      return scope.flatMap((entry) => entry.controls);
    };
    const controls = collect(this.surface?.children ?? []);
    return controls.filter((control) => {
      if (!(control instanceof HTMLInputElement) || control.type !== "radio" || !control.name)
        return true;
      const group = controls.filter(
        (other): other is HTMLInputElement =>
          other instanceof HTMLInputElement &&
          other.type === "radio" &&
          other.name === control.name &&
          other.form === control.form &&
          other.getRootNode() === control.getRootNode(),
      );
      return (
        control ===
        (group.find((radio) => radio.matches(":focus")) ??
          group.find((radio) => radio.checked) ??
          (backward ? group.at(-1) : group[0]))
      );
    });
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (
      !this.open ||
      event.defaultPrevented ||
      event.isComposing ||
      event.composedPath().find((target) => target instanceof QapDialog) !== this
    )
      return;
    if (event.key === "Escape") {
      // Stop HA/global Escape handlers from closing another surface or routing.
      event.preventDefault();
      event.stopPropagation();
      this.requestDismiss("escape");
      return;
    }
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    if ([...(scrollLocks.get(this.ownerDocument)?.dialogs ?? [])].at(-1) !== this) return;
    const controls = this.focusableControls(event.shiftKey);
    const current = event.composedPath()[0];
    if (!controls.length) {
      event.preventDefault();
      this.surface?.focus();
      return;
    }
    if (
      current === this.surface ||
      (event.shiftKey ? current === controls[0] : current === controls.at(-1))
    ) {
      event.preventDefault();
      (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
    }
  };

  private requestDismiss(source: "escape" | "backdrop" | "swipe") {
    if (!this.open || (source !== "escape" && this.preventScrimClose)) return;
    // The existing cancel contract lets a controller open a confirmation while
    // the parent remains modal. Never close and reopen a rejected dirty form.
    if (
      this.dispatchEvent(new CustomEvent("cancel", { cancelable: true, detail: { source } })) &&
      !this.preventScrimClose
    )
      this.close();
  }

  showModal() {
    if (!this.active) this.captureReturnFocus();
    this.open = true;
    // A close and reopen can occur before Lit's next update, including from a
    // close listener. Invalidate the old completion immediately.
    this.cancelClose();
  }
  private captureReturnFocus() {
    const root = this.getRootNode() as Document | ShadowRoot;
    let focused = root.activeElement;
    while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    this.returnFocus = focused instanceof HTMLElement ? focused : null;
  }
  close() {
    const requested = this.open;
    this.open = false;
    if (this.active) void this.animateClose();
    else if (requested) {
      // Mount and teardown can happen in the same controller turn, before Lit
      // renders. Complete that close contract without waiting for a surface.
      this.returnFocus = null;
      this.dispatchEvent(new Event("close"));
      this.dispatchEvent(new Event("closed"));
    }
  }

  private lockScroll() {
    const doc = this.ownerDocument;
    let lock = scrollLocks.get(doc);
    if (!lock) {
      const values: ScrollLock["values"] = [doc.documentElement, doc.body].map((element) => [
        element,
        element.style.getPropertyValue("overflow"),
        element.style.getPropertyPriority("overflow"),
      ]);
      lock = { dialogs: new Set(), values };
      scrollLocks.set(doc, lock);
      for (const [element] of values) element.style.setProperty("overflow", "hidden");
    }
    lock.dialogs.add(this);
  }

  private unlockScroll() {
    const lock = scrollLocks.get(this.ownerDocument);
    if (!lock) return;
    lock.dialogs.delete(this);
    if (lock.dialogs.size) return;
    for (const [element, value, priority] of lock.values) {
      if (element.style.getPropertyValue("overflow") !== "hidden") continue;
      if (value) element.style.setProperty("overflow", value, priority);
      else element.style.removeProperty("overflow");
    }
    scrollLocks.delete(this.ownerDocument);
  }

  private syncViewport = () => {
    const viewport = this.ownerDocument.defaultView?.visualViewport;
    // A CSS variable changes geometry without replacing a focused input when
    // the on-screen keyboard resizes/pans the visual viewport.
    this.style.setProperty("--qap-visual-height", `${viewport?.height ?? innerHeight}px`);
    this.style.setProperty(
      "--qap-visual-bottom",
      `${Math.max(0, innerHeight - (viewport?.height ?? innerHeight) - (viewport?.offsetTop ?? 0))}px`,
    );
  };

  private syncPresentation = () => {
    if (!this.open) return;
    const sheet = this.adaptive && Boolean(this.sheetMedia?.matches);
    if (this.surface?.classList.contains("sheet") !== sheet) this.endGesture();
    this.surface?.classList.toggle("sheet", sheet);
  };

  private cancelClose() {
    ++this.animationGeneration;
    clearTimeout(this.closeTimer);
    this.closeTimer = undefined;
    this.closing = false;
    this.surface?.classList.remove("closing");
  }

  private async animateClose() {
    if (this.closing) return;
    this.closing = true;
    this.endGesture();
    const generation = ++this.animationGeneration;
    const dialog = this.surface;
    dialog?.classList.add("closing");
    // Paused, infinite or abandoned animation promises must not retain a modal
    // and its scroll lock forever. Normal animations still finish naturally.
    this.closeTimer = setTimeout(() => {
      if (generation === this.animationGeneration && !this.open) this.finishClose();
    }, CLOSE_ANIMATION_TIMEOUT);
    await Promise.allSettled(dialog?.getAnimations().map((animation) => animation.finished) ?? []);
    if (generation === this.animationGeneration && !this.open) this.finishClose();
  }

  private finishClose() {
    this.cancelClose();
    this.endGesture();
    this.surface?.close();
    if (!this.active) return;
    this.active = false;
    const viewport = this.ownerDocument.defaultView?.visualViewport;
    viewport?.removeEventListener("resize", this.syncViewport);
    viewport?.removeEventListener("scroll", this.syncViewport);
    this.ownerDocument.defaultView?.removeEventListener("resize", this.syncViewport);
    this.sheetMedia?.removeEventListener("change", this.syncPresentation);
    this.sheetMedia = null;
    const topmost = [...(scrollLocks.get(this.ownerDocument)?.dialogs ?? [])].at(-1) === this;
    this.unlockScroll();
    if (topmost && this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    this.returnFocus = null;
    this.dispatchEvent(new Event("close"));
    this.dispatchEvent(new Event("closed"));
  }

  private startGesture = (event: TouchEvent) => {
    if (
      !this.open ||
      this.preventScrimClose ||
      !this.surface?.classList.contains("sheet") ||
      event.touches.length !== 1
    )
      return;
    // At the top of a scroll region, non-interactive content can drag the sheet.
    // Inputs, selection, sliders, horizontal strips and sorting own their gestures.
    if (
      this.ownerDocument.getSelection()?.toString() ||
      event
        .composedPath()
        .some(
          (target) =>
            target instanceof HTMLElement &&
            (target.matches(
              "button, a, input, textarea, select, [contenteditable], [role=button], [role=slider], qap-button, qap-icon-button, qap-input, qap-select, qap-icon-picker, .qap-reorder-list > .qap-edit-item",
            ) ||
              target.scrollTop > 0 ||
              target.scrollWidth > target.clientWidth + 1),
        )
    )
      return;
    const touch = event.touches[0];
    this.gesture = { x: touch.clientX, y: touch.clientY, time: performance.now(), distance: 0 };
  };
  private moveGesture = (event: TouchEvent) => {
    if (!this.gesture || event.touches.length !== 1) {
      this.endGesture();
      return;
    }
    const touch = event.touches[0];
    const distance = Math.max(0, touch.clientY - this.gesture.y);
    if (Math.abs(touch.clientX - this.gesture.x) > distance) {
      this.endGesture();
      return;
    }
    this.gesture.distance = distance;
    if (distance > 0) {
      event.preventDefault();
      this.surface?.classList.add("dragging");
      this.surface?.style.setProperty("--dialog-transform", `translateY(${distance}px)`);
    }
  };
  private endGesture = (event?: TouchEvent) => {
    const gesture = this.gesture;
    this.gesture = null;
    this.surface?.classList.remove("dragging");
    this.surface?.style.removeProperty("--dialog-transform");
    if (!gesture || event?.type !== "touchend") return;
    const velocity = gesture.distance / Math.max(1, performance.now() - gesture.time);
    if (
      gesture.distance > (this.surface?.offsetHeight ?? Infinity) * SWIPE_DISTANCE_RATIO ||
      (gesture.distance > SWIPE_MIN_DISTANCE && velocity > SWIPE_MIN_VELOCITY)
    )
      this.requestDismiss("swipe");
  };

  protected override render() {
    const label =
      this.label ||
      this.referenceText("aria-labelledby") ||
      this.getAttribute("aria-label") ||
      this.headerTitle;
    const description = this.description || this.referenceText("aria-describedby");
    return html`<dialog
      part="base"
      role=${this.type === "alert" ? "alertdialog" : "dialog"}
      aria-modal="true"
      tabindex="-1"
      aria-label=${label || nothing}
      aria-description=${description || nothing}
      @cancel=${(event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        this.requestDismiss("escape");
      }}
      @close=${() => {
        if (this.active && !this.surface?.open) {
          this.open = false;
          this.finishClose();
        }
      }}
      @pointerdown=${(event: PointerEvent) => {
        this.backdropPointer = event.target === this.surface && Boolean(this.outsideSurface(event));
      }}
      @click=${(event: MouseEvent) => {
        if (this.backdropPointer && event.target === this.surface && this.outsideSurface(event))
          this.requestDismiss("backdrop");
        this.backdropPointer = false;
      }}
      @touchstart=${this.startGesture}
      @touchmove=${this.moveGesture}
      @touchend=${this.endGesture}
      @touchcancel=${this.endGesture}
    >
      <div class="handle" aria-hidden="true"></div>
      ${
        this.withoutHeader
          ? nothing
          : html`<header class="header" part="header">
              <slot name="headerNavigationIcon"></slot>
              <h2>${this.headerTitle}</h2>
              <slot name="headerActionItems"></slot>
            </header>`
      }
      <div
        class="body"
        part="body"
        @scroll=${(event: Event) => {
          this.shadowRoot
            ?.querySelector(".header")
            ?.classList.toggle("scrolled", (event.target as HTMLElement).scrollTop > 0);
        }}
      >
        <slot></slot>
      </div>
      <slot name="footer" part="footer"></slot>
    </dialog>`;
  }

  private outsideSurface(event: MouseEvent) {
    const rect = this.surface?.getBoundingClientRect();
    return (
      rect &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom)
    );
  }

  protected override updated() {
    const dialog = this.surface;
    if (!dialog || !this.isConnected) return;
    if (this.open) {
      if (this.closing) {
        this.cancelClose();
      }
      this.syncPresentation();
      if (this.active) return;
      if (!this.returnFocus) this.captureReturnFocus();
      this.sheetMedia = this.ownerDocument.defaultView!.matchMedia(SHEET_QUERY);
      this.sheetMedia.addEventListener("change", this.syncPresentation);
      this.syncPresentation();
      this.active = true;
      this.syncViewport();
      const viewport = this.ownerDocument.defaultView?.visualViewport;
      viewport?.addEventListener("resize", this.syncViewport);
      viewport?.addEventListener("scroll", this.syncViewport);
      this.ownerDocument.defaultView?.addEventListener("resize", this.syncViewport);
      this.lockScroll();
      dialog.showModal();
      this.dispatchEvent(new Event("opened"));
      void Promise.all(
        [...this.querySelectorAll<FocusControl>("*")].map((control) => control.updateComplete),
      )
        .then(() => {
          if (!this.open || !this.isConnected || !dialog.matches(":modal")) return;
          // A nested dialog may already own focus by the time controls render.
          if ([...(scrollLocks.get(this.ownerDocument)?.dialogs ?? [])].at(-1) !== this) return;
          const root = this.getRootNode() as Document | ShadowRoot;
          const controls = this.focusableControls();
          const autofocus = controls
            .map((control) => {
              let host: Element | null = control;
              while (host && host !== this) {
                if (host.hasAttribute("autofocus")) return { host, control };
                const root = host.getRootNode();
                host = host.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
              }
              return null;
            })
            .find((candidate) => candidate !== null);
          if (
            root.activeElement &&
            this.contains(root.activeElement) &&
            root.activeElement !== this &&
            (!autofocus || !root.activeElement.contains(autofocus.host))
          )
            return;
          (autofocus?.control ?? controls[0] ?? dialog).focus({ preventScroll: true });
        })
        .catch((error) => console.warn("[Quick Access] Could not focus a dialog control.", error));
    } else if (this.active) void this.animateClose();
  }

  static styles = css`
    :host {
      display: contents;
    }
    dialog {
      --qap-viewport-height: min(var(--qap-visual-height, 100dvh), 100dvh);
      box-sizing: border-box;
      position: fixed;
      inset: var(--safe-area-inset-top, env(safe-area-inset-top, 0px))
        var(--safe-area-inset-right, env(safe-area-inset-right, 0px))
        var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))
        var(--safe-area-inset-left, env(safe-area-inset-left, 0px));
      margin: auto;
      padding: 0;
      border: 0;
      width: min(var(--qap-dialog-width, var(--ha-dialog-width-md, 580px)), calc(100vw - 32px));
      max-width: calc(
        100vw - var(--safe-area-inset-left, env(safe-area-inset-left, 0px)) - var(
            --safe-area-inset-right,
            env(safe-area-inset-right, 0px)
          )
      );
      max-height: min(
        var(
          --ha-dialog-max-height,
          calc(
            100dvh - var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) - var(
                --safe-area-inset-bottom,
                env(safe-area-inset-bottom, 0px)
              ) - var(--ha-space-20, 80px)
          )
        ),
        calc(
          var(--qap-viewport-height) - var(
              --safe-area-inset-top,
              env(safe-area-inset-top, 0px)
            ) - var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) -
            24px
        )
      );
      overflow: hidden;
      border-radius: var(--ha-dialog-border-radius, var(--ha-border-radius-3xl, 24px));
      font: inherit;
      color: var(--primary-text-color, #212121);
      background: var(--ha-dialog-surface-background, var(--card-background-color, #fff));
      box-shadow: var(
        --dialog-box-shadow,
        var(
          --wa-shadow-l,
          var(
            --ha-box-shadow-l,
            0 6px 12px -3px rgb(0 0 0 / 0.12),
            0 16px 32px -6px rgb(0 0 0 / 0.2)
          )
        )
      );
      backdrop-filter: var(--ha-dialog-surface-backdrop-filter, none);
      animation: show var(--ha-dialog-show-duration, 200ms) ease;
    }
    dialog[open] {
      display: flex;
      flex-direction: column;
    }
    dialog:focus {
      outline: none;
    }
    dialog.closing {
      animation: hide var(--ha-dialog-hide-duration, 200ms) ease forwards;
    }
    dialog::backdrop {
      background: var(--mdc-dialog-scrim-color, rgb(0 0 0 / 0.32));
      backdrop-filter: var(--ha-dialog-scrim-backdrop-filter, var(--dialog-backdrop-filter, none));
      animation: fade-in var(--ha-dialog-show-duration, 200ms) ease;
    }
    dialog.closing::backdrop {
      animation: fade-out var(--ha-dialog-hide-duration, 200ms) ease forwards;
    }
    :host([width="small"]) dialog {
      width: min(var(--ha-dialog-width-sm, 320px), calc(100vw - 32px));
    }
    :host(.qap-editor-dialog) dialog {
      width: min(var(--qap-dialog-width, 580px), calc(100vw - 32px));
    }
    :host([width="large"]) dialog {
      width: min(var(--qap-dialog-width, var(--ha-dialog-width-lg, 1024px)), calc(100vw - 32px));
    }
    .body {
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
      scrollbar-color: var(--scrollbar-thumb-color, var(--divider-color, #ddd)) transparent;
    }
    :host(.qap-native-layout) .body {
      padding: var(--dialog-content-padding, 0 var(--ha-space-6, 24px) var(--ha-space-6, 24px));
    }
    :host([flexcontent]) .body {
      flex: 1 1 auto;
    }
    .header {
      display: flex;
      align-items: center;
      flex: none;
      padding: 0 var(--ha-space-2, 8px);
    }
    dialog:not(.sheet) .header.scrolled {
      border-bottom: 1px solid var(--mdc-dialog-scroll-divider-color, rgb(0 0 0 / 0.12));
    }
    h2 {
      box-sizing: content-box;
      margin: 0;
      padding: 10px var(--ha-space-1, 4px);
      min-height: var(--ha-space-12, 48px);
      display: flex;
      align-items: center;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: var(--ha-dialog-header-white-space, nowrap);
      font-size: var(--ha-font-size-xl, 20px);
      line-height: var(--ha-line-height-condensed, 1.2);
      font-weight: var(--ha-font-weight-medium, 500);
      color: var(--ha-dialog-header-title-color, var(--primary-text-color));
    }
    slot[name="footer"] {
      flex: none;
    }
    ::slotted([slot="footer"]) {
      box-sizing: border-box;
      display: flex;
      gap: var(--ha-space-3, 12px);
      align-items: center;
      justify-content: flex-end;
      width: 100%;
      padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px) var(--ha-space-4, 16px);
    }
    .handle {
      display: none;
    }
    dialog.sheet {
      inset: auto 0 var(--qap-visual-bottom, 0px);
      margin: 0 auto;
      width: min(var(--ha-bottom-sheet-max-width, var(--qap-dialog-width, 100vw)), 100vw);
      max-width: 100vw;
      height: var(--ha-bottom-sheet-height, auto);
      max-height: min(
        var(--ha-bottom-sheet-max-height, 90dvh),
        calc(
          var(--qap-viewport-height) - max(
              var(--safe-area-inset-top, env(safe-area-inset-top, 0px)),
              48px
            )
        )
      );
      border-radius: var(--ha-bottom-sheet-border-radius, var(--ha-border-radius-2xl, 16px))
        var(--ha-bottom-sheet-border-radius, var(--ha-border-radius-2xl, 16px)) 0 0;
      padding: 0 var(--safe-area-inset-right, env(safe-area-inset-right, 0px))
        var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))
        var(--safe-area-inset-left, env(safe-area-inset-left, 0px));
      background: var(
        --ha-bottom-sheet-surface-background,
        var(--ha-dialog-surface-background, var(--card-background-color, #fff))
      );
      backdrop-filter: var(
        --ha-bottom-sheet-surface-backdrop-filter,
        var(--ha-dialog-surface-backdrop-filter, none)
      );
      transform: var(--dialog-transform, none);
      transition: transform 300ms ease-out;
      animation: sheet-show 300ms ease;
    }
    :host([adaptive]) dialog.sheet {
      width: min(var(--ha-bottom-sheet-max-width, var(--qap-dialog-width, 100vw)), 100vw);
    }
    dialog.sheet.dragging {
      transition: none;
    }
    dialog.sheet.closing {
      animation: sheet-hide 300ms ease forwards;
    }
    dialog.sheet::backdrop {
      background: var(
        --ha-bottom-sheet-scrim-color,
        var(--mdc-dialog-scrim-color, rgb(0 0 0 / 0.32))
      );
      backdrop-filter: var(
        --ha-bottom-sheet-scrim-backdrop-filter,
        var(--ha-dialog-scrim-backdrop-filter, var(--dialog-backdrop-filter, none))
      );
    }
    .sheet .handle {
      display: block;
      position: absolute;
      top: 6px;
      left: calc(50% - 20px);
      width: 40px;
      height: 4px;
      border-radius: var(--ha-border-radius-md, 8px);
      background: var(--ha-bottom-sheet-handle-color, var(--divider-color, #ddd));
    }
    :host([prevent-scrim-close]) .handle {
      display: none;
    }
    @media (max-width: 450px), (max-height: 500px) {
      :host([type="standard"]) dialog:not(.sheet) {
        inset: 0;
        width: 100vw;
        max-width: 100vw;
        max-height: var(--qap-viewport-height);
        height: var(--qap-viewport-height);
        border-radius: 0;
        padding: var(--safe-area-inset-top, env(safe-area-inset-top, 0px))
          var(--safe-area-inset-right, env(safe-area-inset-right, 0px))
          var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))
          var(--safe-area-inset-left, env(safe-area-inset-left, 0px));
      }
      :host([type="alert"]) dialog:not(.sheet) {
        width: min(var(--ha-dialog-width-sm, 320px), calc(100vw - 32px));
        height: fit-content;
        max-height: calc(var(--qap-viewport-height) - 32px);
        border-radius: var(--ha-dialog-border-radius, var(--ha-border-radius-3xl, 24px));
      }
      .header {
        padding-inline: var(--ha-space-1, 4px);
      }
    }
    @keyframes show {
      from {
        opacity: 0;
        scale: 0.8;
      }
      to {
        opacity: 1;
        scale: 1;
      }
    }
    @keyframes hide {
      to {
        opacity: 0;
        scale: 0.8;
      }
    }
    @keyframes sheet-show {
      from {
        translate: 0 100%;
      }
      to {
        translate: 0 0;
      }
    }
    @keyframes sheet-hide {
      to {
        translate: 0 100%;
      }
    }
    @keyframes fade-in {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
    @keyframes fade-out {
      to {
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      dialog,
      dialog.closing,
      dialog.sheet,
      dialog.sheet.closing,
      dialog::backdrop,
      dialog.closing::backdrop {
        animation-duration: 0s;
        transition-duration: 0s;
      }
    }
  `;
}
