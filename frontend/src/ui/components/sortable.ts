import { css, html, LitElement } from "lit";

/** Slotted rows stay owned by the existing list and persistence controllers. */
export class QapSortable extends LitElement {
  static properties = { announcement: { type: String, attribute: false } };
  declare announcement: string;
  constructor() {
    super();
    this.announcement = "";
  }
  protected override render() {
    return html`<slot></slot
      ><span role="status" aria-live="polite" aria-atomic="true">${this.announcement}</span>`;
  }
  static styles = css`
    :host {
      display: block;
    }
    span {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `;
}
