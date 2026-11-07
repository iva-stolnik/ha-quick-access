import { css, html, LitElement, nothing } from "lit";
import { entityIconMetadata } from "../../data/entity-icons";
import { resolveStateIcon, sameStateIcon } from "../../entities/state-icon";
import type {
  EntityIconContext,
  EntityIconState,
  StateIconPresentation,
} from "../../entities/state-icon";

/** Independent entity presentation. ha-icon remains the intentional asset renderer. */
export class QapStateIcon extends LitElement {
  static properties = {
    stateObj: { attribute: false, hasChanged: () => true },
    hass: { attribute: false },
    disabled: { type: Boolean, reflect: true },
  };
  declare stateObj: EntityIconState | undefined;
  declare hass: EntityIconContext | undefined;
  declare disabled: boolean;
  private presentation: StateIconPresentation | undefined;
  private readonly observedResources = new WeakSet<Promise<void>>();

  constructor() {
    super();
    this.disabled = false;
  }
  override connectedCallback() {
    super.connectedCallback();
    this.setAttribute("aria-hidden", "true");
    this.requestUpdate();
  }
  protected override shouldUpdate(): boolean {
    const metadata = entityIconMetadata(this.stateObj, this.hass);
    for (const ready of metadata.pending) {
      if (this.observedResources.has(ready)) continue;
      this.observedResources.add(ready);
      // A stalled shared request must not retain rows from a closed list.
      const target = new WeakRef(this);
      void ready.then(() => {
        const icon = target.deref();
        if (icon?.isConnected) icon.requestUpdate();
      });
    }
    const next = resolveStateIcon(this.stateObj, this.hass, metadata.icon, this.disabled);
    if (this.presentation && sameStateIcon(this.presentation, next)) return false;
    this.presentation = next;
    return true;
  }
  protected override render() {
    const model =
      this.presentation ?? resolveStateIcon(this.stateObj, this.hass, undefined, this.disabled);
    // Keep the icon node stable across state changes, including picture transitions.
    return html`<ha-icon
        .icon=${model.icon}
        aria-hidden="true"
        ?hidden=${Boolean(model.image)}
        class=${model.pulse ? "pulse" : ""}
        style=${`color:${model.color};filter:${model.filter || "none"}`}
      ></ha-icon>
      ${model.image ? html`<span class="picture" style=${`background-image:url(${JSON.stringify(model.image)});border-radius:${model.imageRadius}`}></span>` : nothing}`;
  }
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      position: relative;
      width: var(--qap-icon-size, 20px);
      height: var(--qap-icon-size, 20px);
      color: var(--state-icon-color);
      --state-inactive-color: initial;
    }
    ha-icon {
      display: block;
      width: 100%;
      height: 100%;
      --mdc-icon-size: var(--qap-icon-size, 20px);
      transition:
        color 0.3s ease-in-out,
        filter 0.3s ease-in-out;
    }
    ha-icon[hidden] {
      display: none;
    }
    .picture {
      position: absolute;
      inset: 0;
      background-size: cover;
    }
    .pulse {
      animation: qap-state-pulse 1s infinite;
    }
    @keyframes qap-state-pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0;
      }
    }
  `;
}
