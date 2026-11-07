import { css, html, LitElement, type PropertyValues } from "lit";
import { EVENT_ID, parseEvents, SCALAR_STYLE } from "js-yaml";

interface TextPart {
  text: string;
  kind: string;
}

const MAX_HIGHLIGHT_LENGTH = 100_000;

/** Read-only YAML presentation. The dialog owns data, serialization and copying. */
export class QapAttributesViewer extends LitElement {
  static properties = { value: {}, label: {}, copyLabel: {} };
  declare value: string;
  declare label: string;
  declare copyLabel: string;
  private parts: TextPart[] = [];
  private lineNumbers = "1";

  constructor() {
    super();
    this.value = "";
    this.label = "Attributes";
    this.copyLabel = "Copy to clipboard";
  }

  protected override willUpdate(changed: PropertyValues) {
    if (!changed.has("value")) return;
    this.lineNumbers = Array.from(
      { length: this.value.split("\n").length },
      (_, index) => index + 1,
    ).join("\n");
    if (this.value.length > MAX_HIGHLIGHT_LENGTH) {
      this.parts = [];
      return;
    }
    // Use the YAML parser's source ranges; never parse serialized lines ourselves.
    // Highlighting is optional: a very deep document remains fully readable.
    const parts: TextPart[] = [];
    const stack: { mapping: boolean; children: number }[] = [];
    let offset = 0;
    try {
      for (const event of parseEvents(this.value, {})) {
        if (event.type === EVENT_ID.POP) {
          stack.pop();
          continue;
        }
        const parent = stack.at(-1);
        const key = parent?.mapping && parent.children % 2 === 0;
        if (parent) parent.children++;
        if (event.type === EVENT_ID.MAPPING || event.type === EVENT_ID.SEQUENCE) {
          stack.push({ mapping: event.type === EVENT_ID.MAPPING, children: 0 });
        } else if (event.type === EVENT_ID.SCALAR) {
          const text = this.value.slice(event.valueStart, event.valueEnd);
          const quoted =
            event.style === SCALAR_STYLE.SINGLE_QUOTED ||
            event.style === SCALAR_STYLE.DOUBLE_QUOTED;
          const start = event.valueStart - Number(quoted),
            end = event.valueEnd + Number(quoted);
          let kind = "string";
          if (key) kind = "key";
          else if (
            event.style === SCALAR_STYLE.LITERAL_BLOCK ||
            event.style === SCALAR_STYLE.FOLDED_BLOCK
          )
            kind = "";
          else if (!quoted) {
            if (/^(true|false|null)$/.test(text)) kind = "atom";
            else if (
              /^(?:[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?|[-+]?\.inf|\.nan)$/i.test(text)
            )
              kind = "number";
          }
          parts.push(...this.punctuation(this.value.slice(offset, start)), {
            text: this.value.slice(start, end),
            kind,
          });
          offset = end;
        }
      }
      parts.push(...this.punctuation(this.value.slice(offset)));
      this.parts = parts;
    } catch {
      this.parts = [{ text: this.value, kind: "" }];
    }
  }

  private punctuation(text: string): TextPart[] {
    // These ranges are outside scalars, as identified by js-yaml above.
    return text.split(/([:\-[\]{},]|[>|][+-]?\d?)/).map((part) => {
      let kind = "";
      if (/^[>|]/.test(part)) kind = "operator";
      else if (/^[:\-[\]{},]$/.test(part)) kind = "separator";
      return { text: part, kind };
    });
  }

  private requestCopy() {
    this.dispatchEvent(
      new CustomEvent("copy-request", {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  protected override render() {
    return html`<div class="toolbar">
        <qap-icon-button
          .label=${this.copyLabel}
          .disabled=${!this.value}
          @click=${this.requestCopy}
          ><qap-icon icon="mdi:content-copy"></qap-icon
        ></qap-icon-button>
      </div>
      <div class="scroller" tabindex="0" role="region" aria-label=${this.label} dir="ltr">
        <pre class="gutter" aria-hidden="true">${this.lineNumbers}</pre>
        <pre class="content">
${this.parts.length ? this.parts.map((part) => html`<span class=${part.kind}>${part.text}</span>`) : this.value}</pre>
      </div>`;
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      position: relative;
      min-width: 0;
      color: var(--primary-text-color);
      height: var(--code-mirror-height, auto);
      max-height: var(--code-mirror-max-height, none);
      background: var(--code-editor-background-color, var(--card-background-color));
      border-radius: var(--mdc-shape-small, 4px) var(--mdc-shape-small, 4px) 0 0;
    }
    .toolbar {
      display: flex;
      flex: none;
      justify-content: flex-end;
      height: 28px;
      background: var(--code-editor-gutter-color, var(--secondary-background-color, whitesmoke));
    }
    qap-icon-button {
      --ha-icon-button-size: 28px;
      --mdc-icon-button-size: 28px;
      --ha-icon-button-padding-inline: 4px;
      --qap-icon-size: 20px;
      color: var(--primary-text-color);
    }
    qap-icon {
      display: block;
      width: 20px;
      height: 20px;
      --mdc-icon-size: 20px;
    }
    .scroller {
      display: flex;
      overflow: auto;
      overflow-anchor: none;
      min-height: 0;
      font-family: monospace;
      font-size: inherit;
      line-height: 1.4;
      scrollbar-color: var(--scrollbar-thumb-color, #ccc) transparent;
      scrollbar-width: thin;
    }
    .scroller::-webkit-scrollbar {
      width: 0.4rem;
      height: 0.4rem;
    }
    .scroller::-webkit-scrollbar-thumb {
      border-radius: var(--ha-border-radius-sm);
      background: var(--scrollbar-thumb-color);
    }
    .scroller:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: -2px;
    }
    pre {
      margin: 0;
      font: inherit;
      white-space: pre;
      tab-size: 4;
      box-sizing: border-box;
    }
    .gutter {
      position: sticky;
      left: 0;
      z-index: 1;
      flex: none;
      padding: 16px calc(1ch + 6px) 16px 5px;
      color: var(--secondary-text-color);
      background: var(--code-editor-gutter-color, var(--secondary-background-color, whitesmoke));
      border-right: 1px solid var(--secondary-text-color);
      text-align: right;
      user-select: none;
    }
    .content {
      flex: 1 0 auto;
      padding: 16px 2px 16px 6px;
      border-top: 1px solid var(--secondary-text-color);
      user-select: text;
    }
    .key {
      color: var(--codemirror-property, #905);
    }
    .string {
      color: var(--codemirror-string, #07a);
    }
    .number {
      color: var(--codemirror-number, #ca7841);
    }
    .atom {
      color: var(--codemirror-atom, #f90);
    }
    .separator {
      color: var(--codemirror-def, #8da6ce);
    }
    .operator {
      color: var(--codemirror-operator, #cda869);
    }
  `;
}
