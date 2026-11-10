import{c as e,l as t,s as n}from"./localize-CM3cIPTd.js";import{a as r,n as i,t as a}from"./js-yaml-jyO2toLL.js";var o=1e5,s=class extends n{static properties={value:{},label:{},copyLabel:{}};parts=[];lineNumbers=`1`;constructor(){super(),this.value=``,this.label=`Attributes`,this.copyLabel=`Copy to clipboard`}willUpdate(e){if(!e.has(`value`))return;if(this.lineNumbers=Array.from({length:this.value.split(`
`).length},(e,t)=>t+1).join(`
`),this.value.length>o){this.parts=[];return}let t=[],n=[],s=0;try{for(let e of r(this.value,{})){if(e.type===a.POP){n.pop();continue}let r=n.at(-1),o=r?.mapping&&r.children%2==0;if(r&&r.children++,e.type===a.MAPPING||e.type===a.SEQUENCE)n.push({mapping:e.type===a.MAPPING,children:0});else if(e.type===a.SCALAR){let n=this.value.slice(e.valueStart,e.valueEnd),r=e.style===i.SINGLE_QUOTED||e.style===i.DOUBLE_QUOTED,a=e.valueStart-Number(r),c=e.valueEnd+Number(r),l=`string`;o?l=`key`:e.style===i.LITERAL_BLOCK||e.style===i.FOLDED_BLOCK?l=``:r||(/^(true|false|null)$/.test(n)?l=`atom`:/^(?:[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?|[-+]?\.inf|\.nan)$/i.test(n)&&(l=`number`)),t.push(...this.punctuation(this.value.slice(s,a)),{text:this.value.slice(a,c),kind:l}),s=c}}t.push(...this.punctuation(this.value.slice(s))),this.parts=t}catch{this.parts=[{text:this.value,kind:``}]}}punctuation(e){return e.split(/([:\-[\]{},]|[>|][+-]?\d?)/).map(e=>{let t=``;return/^[>|]/.test(e)?t=`operator`:/^[:\-[\]{},]$/.test(e)&&(t=`separator`),{text:e,kind:t}})}requestCopy(){this.dispatchEvent(new CustomEvent(`copy-request`,{detail:{value:this.value},bubbles:!0,composed:!0}))}render(){return e`<div class="toolbar">
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
${this.parts.length?this.parts.map(t=>e`<span class=${t.kind}>${t.text}</span>`):this.value}</pre>
      </div>`}static styles=t`
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
  `};export{s as QapAttributesViewer};