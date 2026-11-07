import { css, html, LitElement } from "lit";

type AlertType = "error" | "warning" | "info" | "success";
const alertIcons: Record<AlertType, string> = {
  error: "mdi:alert-circle-outline",
  warning: "mdi:alert-outline",
  info: "mdi:information-outline",
  success: "mdi:checkbox-marked-circle-outline",
};

export class QapAlert extends LitElement {
  static properties = { alertType: { attribute: "alert-type", reflect: true } };
  declare alertType: AlertType;
  constructor() {
    super();
    this.alertType = "error";
  }
  override connectedCallback() {
    super.connectedCallback();
    this.setAttribute("role", "alert");
  }
  protected override render() {
    return html`<div part="base">
      <qap-icon part="icon" icon=${alertIcons[this.alertType] ?? alertIcons.error}></qap-icon>
      <div part="content">
        <div part="message"><slot></slot></div>
      </div>
    </div>`;
  }
  static styles = css`
    :host {
      display: block;
      --qap-alert-color: var(--error-color, #db4437);
      color: inherit;
      font: inherit;
    }
    :host([alert-type="warning"]) {
      --qap-alert-color: var(--warning-color, #ffa600);
    }
    :host([alert-type="info"]) {
      --qap-alert-color: var(--info-color, #039be5);
    }
    :host([alert-type="success"]) {
      --qap-alert-color: var(--success-color, #43a047);
    }
    :host([hidden]),
    :host(:empty) {
      display: none !important;
    }
    [part="base"] {
      display: flex;
      position: relative;
      padding: var(--ha-alert-padding, 8px);
    }
    [part="base"]::after {
      content: "";
      position: absolute;
      inset: 0;
      opacity: 0.12;
      pointer-events: none;
      border-radius: var(--ha-border-radius-sm, 4px);
      background: var(--qap-alert-color);
    }
    [part="icon"] {
      display: block;
      align-self: center;
      width: var(--ha-alert-icon-size, 24px);
      height: var(--ha-alert-icon-size, 24px);
      color: var(--qap-alert-color);
    }
    [part="content"] {
      display: flex;
      width: 100%;
      align-items: center;
      justify-content: space-between;
      text-align: start;
    }
    [part="message"] {
      margin-inline: 8px;
      line-height: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
  `;
}
