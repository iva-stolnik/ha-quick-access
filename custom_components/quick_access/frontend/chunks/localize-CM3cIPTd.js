var e=Object.freeze({rows:4,columns:3}),t=`mdi:view-grid-outline`,n=`mdi:devices`,r=`indigo`,i=`/config/tools/state`,a=1e4,o=`quick-access-profile-selection-changed`,s=`quick-access-launcher-preference-changed`,c=`quick_access_v1:`,l=[{id:`quick-states`,name:`Entity Explorer`,type:`quick-states`,path:``,icon:`mdi:format-list-bulleted`,color:`cyan`,group:`favorites`},{id:`quick-devices`,name:`Device Explorer`,type:`quick-devices`,path:``,icon:`mdi:devices`,color:`teal`,group:`favorites`}],u=new Set([`primary`,`accent`,`red`,`pink`,`purple`,`deep-purple`,`indigo`,`blue`,`light-blue`,`cyan`,`teal`,`green`,`light-green`,`lime`,`yellow`,`amber`,`orange`,`deep-orange`,`brown`,`light-grey`,`grey`,`dark-grey`,`blue-grey`,`black`,`white`]),d=256;function f(e,n=t){if(typeof e!=`string`)return n;let r=e.trim();return r.length<64&&/^mdi:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r)?r:n}function p(e){if(typeof e!=`string`||e.length>d||/[\u0000-\u001f\u007f-\u009f]/.test(e))return!1;let t=0;for(let n of e)if(n===`(`&&t++,n===`)`&&--t<0)return!1;if(t)return!1;let n=e.trim();return!n||u.has(n)||/^#(?:[a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(n)||!!globalThis.CSS?.supports(`color`,n)}function m(e){return p(e)?e.trim():``}function h(e){if(typeof e!=`string`||!e.startsWith(`/`)||e.startsWith(`//`)||e.includes(`\\`))return!1;try{let t=new URL(e,location.origin);return t.origin===location.origin&&[`http:`,`https:`].includes(t.protocol)}catch{return!1}}function g(e){try{let t=new URL(e);if(![`http:`,`https:`].includes(t.protocol)||t.hostname.includes(`%`)||/(^|\.)xn--[^.]*-(\.|$)/.test(t.hostname))return!1;let n=t.hostname.replace(/(^|\.)xn--/g,`$1xn--­`);return n===t.hostname||new URL(`https://${n}/`).hostname===t.hostname}catch{return!1}}function _(e){return e.split(`
`).map(e=>e.trim()).filter(Boolean)}function v(){return`${location.pathname}${location.search||``}${location.hash||``}`}function y(e,t){if(typeof e!=`string`||!e.startsWith(`/`)||typeof t!=`string`)return!1;/[?#]/.test(e)||(t=t.split(/[?#]/,1)[0]);let n=0,r=0,i=-1,a=0;for(;r<t.length;)if(n<e.length&&e[n]===`*`)i=n++,a=r;else if(n<e.length&&e[n]===t[r])n++,r++;else if(i!==-1)n=i+1,r=++a;else return!1;for(;n<e.length&&e[n]===`*`;)n++;return n===e.length}var b=()=>globalThis.crypto?.randomUUID?.()??`qa-${Date.now()}-${Math.random().toString(36).slice(2)}`;function x(e){return[...e].sort((e,t)=>e.name.localeCompare(t.name)||e.id.localeCompare(t.id))}function S(e){let n=e.entity_id.split(`.`)[0];if(e.attributes?.icon)return e.attributes.icon;switch(n){case`sensor`:return`mdi:thermometer`;case`light`:return`mdi:lightbulb-outline`;case`binary_sensor`:return`mdi:eye-outline`;default:return t}}function C(e,t){let n=typeof t?.formatEntityName==`function`?t.formatEntityName(e):void 0;return typeof n==`string`&&n.trim()?n:e.attributes?.friendly_name||e.entity_id}function ee(e,t,n,r=!0){if(!e)return n;if(typeof t?.formatEntityState==`function`)return t.formatEntityState(e);let i=r&&typeof e.attributes?.unit_of_measurement==`string`?e.attributes.unit_of_measurement:``;return`${e.state}${i?` ${i}`:``}`}function te(e){try{return JSON.parse(localStorage.getItem(e)||`null`)}catch{return null}}function w(e,t){return`${c}${e}:${t}:active-profile`}function ne(e,t){return`${c}${e}:${t}:launcher-enabled`}function re(e){let t=localStorage.getItem(e);try{return JSON.parse(t)!==!1}catch{return!0}}function ie(e,t){localStorage.setItem(e,JSON.stringify(t)),window.dispatchEvent(new CustomEvent(s,{detail:{key:e}}))}function ae(e){let t=localStorage.getItem(e);try{let e=JSON.parse(t);return typeof e==`string`?e:null}catch{return null}}function oe(e,t){t?localStorage.setItem(e,JSON.stringify(t)):localStorage.removeItem(e),window.dispatchEvent(new CustomEvent(o,{detail:{key:e}}))}function se(e,t){return e.subscribeMessage(t,{type:`quick_access/subscribe_profiles`},{resubscribe:!1})}function ce(e,t,n,r){return e.sendMessagePromise({type:`quick_access/mutate_profile`,operation:t,profile_id:n.id,revision:r,...t===`delete`?{}:{profile:n}})}function le(e,t){return e.sendMessagePromise({type:`quick_access/mutate_profile`,operation:`reset_visibility`,profile_id:t})}function ue({l10n:e,ui:n,getShell:r}){let i=e.message,{node:a,focusWhenReady:o,coloredIcon:s,iconButton:c,button:l,leadingIcon:u,icon:d,replaceLocalizedChildren:f}=n;function p(e,t,n){let r=a(`div`,`qap-field`),i=a(`label`,`qap-field-label`,e);return t.id=b(),i.setAttribute(`for`,t.id),r.append(i,t),n&&r.append(a(`small`,`qap-field-tip`,n)),r}function h(t,n){let r=a(`div`,`qap-field`);n.className=`qap-native-control`,n.id=b(),e.property(n,`label`,t),e.attribute(n,`aria-label`,t),r.append(n);let i=[],o=()=>i.forEach(e=>e());return n.localName!==`qap-select`&&n.addEventListener(`input`,o),n.addEventListener(`change`,o),{element:r,control:n,get value(){return n.value??``},set value(e){n.value=e},onChange:e=>i.push(e)}}function g(t,n,r){let i=a(`qap-select`);function o(){e.property(i,`options`,n.map(e=>{if(!Array.isArray(e))return e;let[t,n,r]=e;return{value:t,label:n,group:r}}))}o(),i.value=r;let s=h(t,i);return s.setOptions=e=>{let t=s.value;n=e,o(),s.value=t},s}function y(t,n,r,o,s){if(n.entity){let c=a(`qap-entity-selector`,`qap-native-control`);c.value=r,c.selector=n,c.source=s,c.revision=s?.revision??0,e.property(c,`label`,t),e.attribute(c,`aria-label`,t),e.property(c,`helper`,o||``),e.property(c,`clearLabel`,i(`common.clear`)),e.property(c,`entityLabel`,i(`entities.entity`)),e.property(c,`addLabel`,i(`entities.add`)),e.property(c,`searchLabel`,i(`entities.search`)),e.property(c,`noMatchLabel`,i(`entities.no_matches`));let l=a(`div`,`qap-field`);l.append(c);let u=[];return c.addEventListener(`value-changed`,e=>{e.stopPropagation(),c.value=e.detail?.value??(n.entity.multiple?[]:``),u.forEach(e=>e())}),{element:l,control:c,get value(){return c.value},set value(e){c.value=e},setSelector(e){n=e,c.selector=e},refresh(){c.revision=s?.revision??0},onChange:e=>u.push(e)}}let c=a(`qap-select-selector`,`qap-native-control`);c.value=r,c.selector=n,c.required=!1,e.property(c,`label`,t),e.attribute(c,`aria-label`,t),e.property(c,`helper`,o||``),e.property(c,`clearLabel`,i(`common.clear`)),e.property(c,`searchLabel`,i(`common.search`,{},`ui.common.search`)),e.property(c,`noMatchLabel`,i(`filters.values_empty`));let l=a(`div`,`qap-field`);l.append(c);let u=[];return c.addEventListener(`value-changed`,e=>{e.stopPropagation(),c.value=e.detail?.value??(n.select.multiple?[]:``),u.forEach(e=>e())}),{element:l,control:c,get value(){return c.value},set value(e){c.value=e},setSelector(e){n=e,c.selector=e},onChange:e=>u.push(e)}}function x(t,n,r,i={},o){let s=a(`qap-input`),{maxlength:c,...l}=i;return e.properties(s,{type:n,...l}),c!==void 0&&(s.maxLength=c),s.value=r,e.property(s,`hint`,o||``),h(t,s)}function S(t,r,o){let s=a(`div`,`qap-icon-field`),c=[o],l=()=>c.forEach(e=>e()),u=n.iconPicker();return u.value=r,e.property(u,`label`,t),e.property(u,`placeholder`,r||`mdi:view-grid-outline`),e.property(u,`fallbackHint`,i(`shortcuts.icon_example`)),u.addEventListener(`value-changed`,e=>{e.target===u&&(u.value=e.detail?.value||``,l())}),s.append(u),{element:s,get control(){return u},get value(){return u.value},set value(e){u.value=e},onChange:e=>c.push(e)}}function C(t,n,r){let i=a(`p`,`qap-field-error`);i.id=b(),i.hidden=!0,i.setAttribute(`aria-live`,`polite`);let s=!1,c=()=>!0,l=()=>t.control??t,u=()=>{let e=l();o(e,()=>l()!==e||i.hidden||!s||!c()?!1:(s=!1,!0),!0)},d=()=>{let e=l(),t=new Set([...(e.getAttribute(`aria-describedby`)||``).split(/\s+/)].filter(e=>e&&e!==i.id));i.hidden?e.removeAttribute(`aria-invalid`):(e.setAttribute(`aria-invalid`,`true`),t.add(i.id)),t.size?e.setAttribute(`aria-describedby`,[...t].join(` `)):e.removeAttribute(`aria-describedby`);let n=r??e.parentElement;n.contains(i)||n.append(i)},f=()=>{let t=n();return e.text(i,t),i.hidden=!t,t||(s=!1),d(),!t},p=()=>{i.hidden||f()};return t.onChange?t.onChange(p):(t.addEventListener(`input`,p),t.addEventListener(`change`,p)),d(),{validate:f,revalidate:p,focus:(e=()=>!0)=>{c=e,s=!0,u()}}}function ee(e,t){let n=e.filter(e=>!e.validate());return n[0]?.focus(t),!n.length}function te(n,o){let l=a(`div`,`qap-field qap-icon-color-field`),u=m(n);function d(){if(/^#[a-f0-9]{6}$/i.test(u))return u;let e=s({icon:t,color:u});u||(e.style.color=`var(--state-icon-color, var(--qap-blue))`),r().append(e);let n=globalThis.getComputedStyle?.(e).color??``;e.remove();let i=n.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);return i?`#${i.slice(1,4).map(e=>Number(e).toString(16).padStart(2,`0`)).join(``)}`:`#03a9f4`}let f=x(i(`shortcuts.icon_color`),`color`,d());f.element.classList.add(`qap-color-picker`);let p=a(`div`,`qap-color-row`),h=a(`div`,`qap-color-swatch`);e.property(h,`title`,i(`shortcuts.choose_color`));let g=a(`span`,`qap-color-chip`);g.setAttribute(`aria-hidden`,`true`),h.append(g,f.element);let _=a(`div`,`qap-color-details`),v=a(`span`,`qap-color-value`);_.append(a(`span`,`qap-field-label`,i(`shortcuts.icon_color`)),v);function y(){g.style.backgroundColor=f.value,e.text(v,u||i(`shortcuts.theme_default`)),v.classList.toggle(`is-custom`,!!u),b.disabled=!u}f.onChange(()=>{u=m(f.value),y(),o()});let b=c(`mdi:restore`,i(`shortcuts.use_theme_color`),()=>{u=``,f.value=d(),y(),o()},`qap-icon-color-reset`);return y(),p.append(h,_,b),l.append(p),{element:l,get value(){return u},set value(e){u=m(e),f.value=d(),y()}}}function w(e,t){let n=a(`div`,`qap-field-help`);t.id||=b(),t.open=!1,t.setAttribute(`role`,`tooltip`);let r=!1,i=!1,o=!1,s=n=>{o=n,t.open=n,e.setAttribute(`aria-expanded`,String(n))};return t.addEventListener(`close`,()=>{r=!1,s(!1)}),e.addEventListener(`click`,()=>{r=!r,s(r)}),e.setAttribute(`aria-describedby`,t.id),e.setAttribute(`aria-controls`,t.id),e.setAttribute(`aria-expanded`,`false`),n.addEventListener(`pointerenter`,()=>s(!0)),n.addEventListener(`pointerleave`,()=>{!r&&!i&&s(!1)}),e.addEventListener(`focusin`,()=>{i=!0,s(!0)}),e.addEventListener(`focusout`,t=>{e.contains(t.relatedTarget)||(i=!1,r=!1,s(!1))}),e.addEventListener(`keydown`,e=>{e.key===`Escape`&&o&&(e.preventDefault(),e.stopPropagation(),r=!1,s(!1))}),t.anchorElement=e,n.append(e,t),n}function ne(t,n){let r=a(`div`,`qap-field qap-url-paths`),o=a(`div`,`qap-url-paths-heading`),s=a(`label`,`qap-field-label`,i(`visibility.url_paths`));t.id=`qap-url-paths`,t.setAttribute(`aria-describedby`,`qap-url-paths-description`),t.wrap=`off`,t.spellcheck=!1,t.autocomplete=`off`,s.setAttribute(`for`,t.id);let c=a(`qap-tooltip`,`qap-url-paths-tooltip`);c.id=`qap-url-paths-help`,c.append(a(`p`,``,i(`visibility.one_per_line`))),c.append(a(`code`,``,`/config/automation/*`),a(`p`,``,i(`visibility.wildcard_help`))),c.append(a(`code`,``,`/lovelace/cameras`),a(`p`,``,i(`visibility.exact_help`))),c.append(a(`code`,``,`/config/example?view=advanced#section`),a(`p`,``,i(`visibility.full_url_help`)));let d=l(``,()=>{},`qap-linkish qap-url-paths-learn-more`);d.id=b(),d.append(u(`mdi:information-outline`),a(`span`,``,i(`common.learn_more`)));let f=w(d,c);f.classList.add(`qap-url-paths-help`),o.append(s,f);let p=a(`p`,`qap-field-tip`);p.id=`qap-url-paths-description`;let m=()=>{e.text(p,i(n.value===`include`?`visibility.routes_shown`:`visibility.routes_hidden`))};n.onChange(m),m();let h=a(`div`,`qap-url-paths-editor`),g=a(`div`,`qap-url-paths-gutter`);g.setAttribute(`aria-hidden`,`true`);let _=a(`pre`,`qap-url-paths-lines`);g.append(_);let v=()=>{_.style.transform=`translateY(-${t.scrollTop||0}px)`},y=()=>{let n=(t.value||t.placeholder).split(`
`).length;e.text(_,Array.from({length:n},(e,t)=>t+1).join(`
`)),v()};return t.addEventListener(`input`,y),t.addEventListener(`scroll`,v),y(),h.append(g,t),r.append(o,p,h),r}function re(e,t,n,r=i(`visibility.current_path`)){let o=a(`div`,`qap-current-url-card`),s=a(`div`,`qap-current-url-identity`),c=a(`div`,`qap-current-url-details`);c.append(a(`span`,`qap-field-tip`,r),a(`strong`,`qap-current-url-path`,e)),s.append(d(`mdi:link-variant`),c);let f=l(``,n,`qap-current-url-action`);return f.append(u(`mdi:plus`),a(`span`,``,t)),o.append(s,f),{element:o,action:f}}function ie(t,n){let r=a(`section`,`qap-current-url`),o=a(`h3`,`qap-current-url-title`,i(`visibility.current_page_rules`));o.id=b(),r.setAttribute(`aria-labelledby`,o.id);let s=`${n.replace(/\/+$/,``)}/*`;r.append(o);let c=v(),d=[n,s];d.includes(c)||d.push(c);let p=d.map(o=>{let s=a(`div`,`qap-current-url-row`),d=a(`code`,`qap-current-url-path`,o);d.id=b(),d.title=o;let p=l(``,()=>{let e=_(t.value);t.value=(e.includes(o)?e.filter(e=>e!==o):[...e,o]).join(`
`),t.dispatchEvent(new Event(`input`,{bubbles:!0}))},`qap-button-secondary qap-current-url-action`);p.title=o;let m=a(`span`);if(m.id=b(),p.setAttribute(`aria-labelledby`,`${m.id} ${d.id}`),o===c&&o!==n){let e=a(`div`,`qap-current-url-details`);e.append(a(`span`,`qap-field-tip`,i(`visibility.current_full_url`)),d),s.append(e,p)}else s.append(d,p);return r.append(s),t=>{let n=t.includes(o);e.text(m,i(n?`common.remove`:`common.add`)),f(p,u(n?`mdi:minus`:`mdi:plus`),m)}}),m=()=>{let e=_(t.value);p.forEach(t=>t(e))};return t.addEventListener(`input`,m),m(),r}function ae(t,n,r,o=()=>{}){let s=a(`div`,`qap-search`),c=a(`qap-search`,`qap-search-input`);return e.property(c,`placeholder`,t),e.property(c,`clearLabel`,i(`common.clear`)),e.attribute(c,`aria-label`,t),c.value=n,c.addEventListener(`input`,()=>r(c.value)),o(c),s.append(c),s}return{fieldLabel:p,formField:h,select:g,selectorField:y,input:x,iconPickerField:S,fieldValidation:C,validateFields:ee,iconColorField:te,helpControl:w,urlPathsField:ne,currentUrlCard:re,currentUrlRules:ie,searchField:ae}}function de(e){function t(t,n=``,r){let i=document.createElement(t);return n&&(i.className=n),r!==void 0&&e.text(i,r),i}function n(t){t&&(e.release(t),t.remove())}function r(t,...n){for(let r of t.children)n.includes(r)||e.release(r);t.replaceChildren(...n)}return{node:t,removeLocalizedElement:n,replaceLocalizedChildren:r}}var T=globalThis,fe=T.ShadowRoot&&(T.ShadyCSS===void 0||T.ShadyCSS.nativeShadow)&&`adoptedStyleSheets`in Document.prototype&&`replace`in CSSStyleSheet.prototype,pe=Symbol(),me=new WeakMap,he=class{constructor(e,t,n){if(this._$cssResult$=!0,n!==pe)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o,t=this.t;if(fe&&e===void 0){let n=t!==void 0&&t.length===1;n&&(e=me.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),n&&me.set(t,e))}return e}toString(){return this.cssText}},ge=e=>new he(typeof e==`string`?e:e+``,void 0,pe),E=(e,...t)=>new he(e.length===1?e[0]:t.reduce((t,n,r)=>t+(e=>{if(!0===e._$cssResult$)return e.cssText;if(typeof e==`number`)return e;throw Error(`Value passed to 'css' function must be a 'css' function result: `+e+`. Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.`)})(n)+e[r+1],e[0]),e,pe),_e=(e,t)=>{if(fe)e.adoptedStyleSheets=t.map(e=>e instanceof CSSStyleSheet?e:e.styleSheet);else for(let n of t){let t=document.createElement(`style`),r=T.litNonce;r!==void 0&&t.setAttribute(`nonce`,r),t.textContent=n.cssText,e.appendChild(t)}},ve=fe?e=>e:e=>e instanceof CSSStyleSheet?(e=>{let t=``;for(let n of e.cssRules)t+=n.cssText;return ge(t)})(e):e,{is:ye,defineProperty:be,getOwnPropertyDescriptor:xe,getOwnPropertyNames:Se,getOwnPropertySymbols:Ce,getPrototypeOf:we}=Object,D=globalThis,Te=D.trustedTypes,Ee=Te?Te.emptyScript:``,De=D.reactiveElementPolyfillSupport,O=(e,t)=>e,k={toAttribute(e,t){switch(t){case Boolean:e=e?Ee:null;break;case Object:case Array:e=e==null?e:JSON.stringify(e)}return e},fromAttribute(e,t){let n=e;switch(t){case Boolean:n=e!==null;break;case Number:n=e===null?null:Number(e);break;case Object:case Array:try{n=JSON.parse(e)}catch{n=null}}return n}},Oe=(e,t)=>!ye(e,t),ke={attribute:!0,type:String,converter:k,reflect:!1,useDefault:!1,hasChanged:Oe};Symbol.metadata??=Symbol(`metadata`),D.litPropertyMetadata??=new WeakMap;var A=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??=[]).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=ke){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){let n=Symbol(),r=this.getPropertyDescriptor(e,n,t);r!==void 0&&be(this.prototype,e,r)}}static getPropertyDescriptor(e,t,n){let{get:r,set:i}=xe(this.prototype,e)??{get(){return this[t]},set(e){this[t]=e}};return{get:r,set(t){let a=r?.call(this);i?.call(this,t),this.requestUpdate(e,a,n)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??ke}static _$Ei(){if(this.hasOwnProperty(O(`elementProperties`)))return;let e=we(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(O(`finalized`)))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(O(`properties`))){let e=this.properties,t=[...Se(e),...Ce(e)];for(let n of t)this.createProperty(n,e[n])}let e=this[Symbol.metadata];if(e!==null){let t=litPropertyMetadata.get(e);if(t!==void 0)for(let[e,n]of t)this.elementProperties.set(e,n)}this._$Eh=new Map;for(let[e,t]of this.elementProperties){let n=this._$Eu(e,t);n!==void 0&&this._$Eh.set(n,e)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){let t=[];if(Array.isArray(e)){let n=new Set(e.flat(1/0).reverse());for(let e of n)t.unshift(ve(e))}else e!==void 0&&t.push(ve(e));return t}static _$Eu(e,t){let n=t.attribute;return!1===n?void 0:typeof n==`string`?n:typeof e==`string`?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(e=>this.enableUpdating=e),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(e=>e(this))}addController(e){(this._$EO??=new Set).add(e),this.renderRoot!==void 0&&this.isConnected&&e.hostConnected?.()}removeController(e){this._$EO?.delete(e)}_$E_(){let e=new Map,t=this.constructor.elementProperties;for(let n of t.keys())this.hasOwnProperty(n)&&(e.set(n,this[n]),delete this[n]);e.size>0&&(this._$Ep=e)}createRenderRoot(){let e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return _e(e,this.constructor.elementStyles),e}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(e=>e.hostConnected?.())}enableUpdating(e){}disconnectedCallback(){this._$EO?.forEach(e=>e.hostDisconnected?.())}attributeChangedCallback(e,t,n){this._$AK(e,n)}_$ET(e,t){let n=this.constructor.elementProperties.get(e),r=this.constructor._$Eu(e,n);if(r!==void 0&&!0===n.reflect){let i=(n.converter?.toAttribute===void 0?k:n.converter).toAttribute(t,n.type);this._$Em=e,i==null?this.removeAttribute(r):this.setAttribute(r,i),this._$Em=null}}_$AK(e,t){let n=this.constructor,r=n._$Eh.get(e);if(r!==void 0&&this._$Em!==r){let e=n.getPropertyOptions(r),i=typeof e.converter==`function`?{fromAttribute:e.converter}:e.converter?.fromAttribute===void 0?k:e.converter;this._$Em=r;let a=i.fromAttribute(t,e.type);this[r]=a??this._$Ej?.get(r)??a,this._$Em=null}}requestUpdate(e,t,n,r=!1,i){if(e!==void 0){let a=this.constructor;if(!1===r&&(i=this[e]),n??=a.getPropertyOptions(e),!((n.hasChanged??Oe)(i,t)||n.useDefault&&n.reflect&&i===this._$Ej?.get(e)&&!this.hasAttribute(a._$Eu(e,n))))return;this.C(e,t,n)}!1===this.isUpdatePending&&(this._$ES=this._$EP())}C(e,t,{useDefault:n,reflect:r,wrapped:i},a){n&&!(this._$Ej??=new Map).has(e)&&(this._$Ej.set(e,a??t??this[e]),!0!==i||a!==void 0)||(this._$AL.has(e)||(this.hasUpdated||n||(t=void 0),this._$AL.set(e,t)),!0===r&&this._$Em!==e&&(this._$Eq??=new Set).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(e){Promise.reject(e)}let e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[e,t]of this._$Ep)this[e]=t;this._$Ep=void 0}let e=this.constructor.elementProperties;if(e.size>0)for(let[t,n]of e){let{wrapped:e}=n,r=this[t];!0!==e||this._$AL.has(t)||r===void 0||this.C(t,void 0,n,r)}}let e=!1,t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),this._$EO?.forEach(e=>e.hostUpdate?.()),this.update(t)):this._$EM()}catch(t){throw e=!1,this._$EM(),t}e&&this._$AE(t)}willUpdate(e){}_$AE(e){this._$EO?.forEach(e=>e.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&=this._$Eq.forEach(e=>this._$ET(e,this[e])),this._$EM()}updated(e){}firstUpdated(e){}};A.elementStyles=[],A.shadowRootOptions={mode:`open`},A[O(`elementProperties`)]=new Map,A[O(`finalized`)]=new Map,De?.({ReactiveElement:A}),(D.reactiveElementVersions??=[]).push(`2.1.2`);var j=globalThis,Ae=e=>e,M=j.trustedTypes,je=M?M.createPolicy(`lit-html`,{createHTML:e=>e}):void 0,Me=`$lit$`,N=`lit$${Math.random().toFixed(9).slice(2)}$`,Ne=`?`+N,Pe=`<${Ne}>`,P=document,F=()=>P.createComment(``),I=e=>e===null||typeof e!=`object`&&typeof e!=`function`,Fe=Array.isArray,Ie=e=>Fe(e)||typeof e?.[Symbol.iterator]==`function`,Le=`[ 	
\f\r]`,L=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,Re=/-->/g,ze=/>/g,R=RegExp(`>|${Le}(?:([^\\s"'>=/]+)(${Le}*=${Le}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`,`g`),Be=/'/g,Ve=/"/g,He=/^(?:script|style|textarea|title)$/i,z=(e=>(t,...n)=>({_$litType$:e,strings:t,values:n}))(1),B=Symbol.for(`lit-noChange`),V=Symbol.for(`lit-nothing`),Ue=new WeakMap,H=P.createTreeWalker(P,129);function We(e,t){if(!Fe(e)||!e.hasOwnProperty(`raw`))throw Error(`invalid template strings array`);return je===void 0?t:je.createHTML(t)}var Ge=(e,t)=>{let n=e.length-1,r=[],i,a=t===2?`<svg>`:t===3?`<math>`:``,o=L;for(let t=0;t<n;t++){let n=e[t],s,c,l=-1,u=0;for(;u<n.length&&(o.lastIndex=u,c=o.exec(n),c!==null);)u=o.lastIndex,o===L?c[1]===`!--`?o=Re:c[1]===void 0?c[2]===void 0?c[3]!==void 0&&(o=R):(He.test(c[2])&&(i=RegExp(`</`+c[2],`g`)),o=R):o=ze:o===R?c[0]===`>`?(o=i??L,l=-1):c[1]===void 0?l=-2:(l=o.lastIndex-c[2].length,s=c[1],o=c[3]===void 0?R:c[3]===`"`?Ve:Be):o===Ve||o===Be?o=R:o===Re||o===ze?o=L:(o=R,i=void 0);let d=o===R&&e[t+1].startsWith(`/>`)?` `:``;a+=o===L?n+Pe:l>=0?(r.push(s),n.slice(0,l)+Me+n.slice(l)+N+d):n+N+(l===-2?t:d)}return[We(e,a+(e[n]||`<?>`)+(t===2?`</svg>`:t===3?`</math>`:``)),r]},Ke=class e{constructor({strings:t,_$litType$:n},r){let i;this.parts=[];let a=0,o=0,s=t.length-1,c=this.parts,[l,u]=Ge(t,n);if(this.el=e.createElement(l,r),H.currentNode=this.el.content,n===2||n===3){let e=this.el.content.firstChild;e.replaceWith(...e.childNodes)}for(;(i=H.nextNode())!==null&&c.length<s;){if(i.nodeType===1){if(i.hasAttributes())for(let e of i.getAttributeNames())if(e.endsWith(Me)){let t=u[o++],n=i.getAttribute(e).split(N),r=/([.?@])?(.*)/.exec(t);c.push({type:1,index:a,name:r[2],strings:n,ctor:r[1]===`.`?Je:r[1]===`?`?Ye:r[1]===`@`?Xe:G}),i.removeAttribute(e)}else e.startsWith(N)&&(c.push({type:6,index:a}),i.removeAttribute(e));if(He.test(i.tagName)){let e=i.textContent.split(N),t=e.length-1;if(t>0){i.textContent=M?M.emptyScript:``;for(let n=0;n<t;n++)i.append(e[n],F()),H.nextNode(),c.push({type:2,index:++a});i.append(e[t],F())}}}else if(i.nodeType===8){if(i.data===Ne)c.push({type:2,index:a});else{let e=-1;for(;(e=i.data.indexOf(N,e+1))!==-1;)c.push({type:7,index:a}),e+=N.length-1}}a++}}static createElement(e,t){let n=P.createElement(`template`);return n.innerHTML=e,n}};function U(e,t,n=e,r){if(t===B)return t;let i=r===void 0?n._$Cl:n._$Co?.[r],a=I(t)?void 0:t._$litDirective$;return i?.constructor!==a&&(i?._$AO?.(!1),a===void 0?i=void 0:(i=new a(e),i._$AT(e,n,r)),r===void 0?n._$Cl=i:(n._$Co??=[])[r]=i),i!==void 0&&(t=U(e,i._$AS(e,t.values),i,r)),t}var qe=class{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){let{el:{content:t},parts:n}=this._$AD,r=(e?.creationScope??P).importNode(t,!0);H.currentNode=r;let i=H.nextNode(),a=0,o=0,s=n[0];for(;s!==void 0;){if(a===s.index){let t;s.type===2?t=new W(i,i.nextSibling,this,e):s.type===1?t=new s.ctor(i,s.name,s.strings,this,e):s.type===6&&(t=new Ze(i,this,e)),this._$AV.push(t),s=n[++o]}a!==s?.index&&(i=H.nextNode(),a++)}return H.currentNode=P,r}p(e){let t=0;for(let n of this._$AV)n!==void 0&&(n.strings===void 0?n._$AI(e[t]):(n._$AI(e,n,t),t+=n.strings.length-2)),t++}},W=class e{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(e,t,n,r){this.type=2,this._$AH=V,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=n,this.options=r,this._$Cv=r?.isConnected??!0}get parentNode(){let e=this._$AA.parentNode,t=this._$AM;return t!==void 0&&e?.nodeType===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=U(this,e,t),I(e)?e===V||e==null||e===``?(this._$AH!==V&&this._$AR(),this._$AH=V):e!==this._$AH&&e!==B&&this._(e):e._$litType$===void 0?e.nodeType===void 0?Ie(e)?this.k(e):this._(e):this.T(e):this.$(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==V&&I(this._$AH)?this._$AA.nextSibling.data=e:this.T(P.createTextNode(e)),this._$AH=e}$(e){let{values:t,_$litType$:n}=e,r=typeof n==`number`?this._$AC(e):(n.el===void 0&&(n.el=Ke.createElement(We(n.h,n.h[0]),this.options)),n);if(this._$AH?._$AD===r)this._$AH.p(t);else{let e=new qe(r,this),n=e.u(this.options);e.p(t),this.T(n),this._$AH=e}}_$AC(e){let t=Ue.get(e.strings);return t===void 0&&Ue.set(e.strings,t=new Ke(e)),t}k(t){Fe(this._$AH)||(this._$AH=[],this._$AR());let n=this._$AH,r,i=0;for(let a of t)i===n.length?n.push(r=new e(this.O(F()),this.O(F()),this,this.options)):r=n[i],r._$AI(a),i++;i<n.length&&(this._$AR(r&&r._$AB.nextSibling,i),n.length=i)}_$AR(e=this._$AA.nextSibling,t){for(this._$AP?.(!1,!0,t);e!==this._$AB;){let t=Ae(e).nextSibling;Ae(e).remove(),e=t}}setConnected(e){this._$AM===void 0&&(this._$Cv=e,this._$AP?.(e))}},G=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,n,r,i){this.type=1,this._$AH=V,this._$AN=void 0,this.element=e,this.name=t,this._$AM=r,this.options=i,n.length>2||n[0]!==``||n[1]!==``?(this._$AH=Array(n.length-1).fill(new String),this.strings=n):this._$AH=V}_$AI(e,t=this,n,r){let i=this.strings,a=!1;if(i===void 0)e=U(this,e,t,0),a=!I(e)||e!==this._$AH&&e!==B,a&&(this._$AH=e);else{let r=e,o,s;for(e=i[0],o=0;o<i.length-1;o++)s=U(this,r[n+o],t,o),s===B&&(s=this._$AH[o]),a||=!I(s)||s!==this._$AH[o],s===V?e=V:e!==V&&(e+=(s??``)+i[o+1]),this._$AH[o]=s}a&&!r&&this.j(e)}j(e){e===V?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??``)}},Je=class extends G{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===V?void 0:e}},Ye=class extends G{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==V)}},Xe=class extends G{constructor(e,t,n,r,i){super(e,t,n,r,i),this.type=5}_$AI(e,t=this){if((e=U(this,e,t,0)??V)===B)return;let n=this._$AH,r=e===V&&n!==V||e.capture!==n.capture||e.once!==n.once||e.passive!==n.passive,i=e!==V&&(n===V||r);r&&this.element.removeEventListener(this.name,this,n),i&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){typeof this._$AH==`function`?this._$AH.call(this.options?.host??this.element,e):this._$AH.handleEvent(e)}},Ze=class{constructor(e,t,n){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=n}get _$AU(){return this._$AM._$AU}_$AI(e){U(this,e)}},Qe=j.litHtmlPolyfillSupport;Qe?.(Ke,W),(j.litHtmlVersions??=[]).push(`3.3.3`);var $e=(e,t,n)=>{let r=n?.renderBefore??t,i=r._$litPart$;if(i===void 0){let e=n?.renderBefore??null;r._$litPart$=i=new W(t.insertBefore(F(),e),e,void 0,n??{})}return i._$AI(e),i},et=globalThis,K=class extends A{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let e=super.createRenderRoot();return this.renderOptions.renderBefore??=e.firstChild,e}update(e){let t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=$e(t,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return B}};K._$litElement$=!0,K.finalized=!0,et.litElementHydrateSupport?.({LitElement:K});var tt=et.litElementPolyfillSupport;tt?.({LitElement:K}),(et.litElementVersions??=[]).push(`4.2.2`);var q=class extends K{static properties={disabled:{type:Boolean,reflect:!0},loading:{type:Boolean,reflect:!0},appearance:{reflect:!0},variant:{reflect:!0},href:{reflect:!0},target:{reflect:!0},rel:{reflect:!0},label:{},selected:{type:Boolean,reflect:!0},ariaLabel:{attribute:`aria-label`},ariaPressed:{attribute:`aria-pressed`},ariaExpanded:{attribute:`aria-expanded`},ariaHasPopup:{attribute:`aria-haspopup`},ariaControls:{attribute:`aria-controls`},ariaLabelledBy:{attribute:`aria-labelledby`},ariaDescribedBy:{attribute:`aria-describedby`},ariaDescription:{attribute:`aria-description`},ariaKeyShortcuts:{attribute:`aria-keyshortcuts`},hasStart:{state:!0},hasEnd:{state:!0}};static shadowRootOptions={mode:`open`,delegatesFocus:!0};labelObserver;constructor(){super(),this.disabled=!1,this.loading=!1,this.appearance=`outlined`,this.variant=`brand`,this.label=``,this.selected=!1,this.hasStart=!1,this.hasEnd=!1,this.addEventListener(`click`,e=>{(this.disabled||this.loading)&&(e.preventDefault(),e.stopImmediatePropagation())},{capture:!0})}focus(e){let t=()=>{this.isConnected&&!this.disabled&&this.shadowRoot?.querySelector(`button, a`)?.focus(e)};this.shadowRoot?.querySelector(`button, a`)?t():this.updateComplete.then(t).catch(e=>console.warn(`[Quick Access] Could not focus a rendered button.`,e))}click(){if(this.disabled||this.loading)return;let e=this.shadowRoot?.querySelector(`button, a`);e?e.click():super.click()}connectedCallback(){super.connectedCallback(),this.requestUpdate()}disconnectedCallback(){this.labelObserver?.disconnect(),super.disconnectedCallback()}renderStart(){return z`<slot name="start" part="start" @slotchange=${this.slotChanged}></slot>`}renderLabel(){return z`<slot></slot>`}get controlRole(){return V}get controlTabIndex(){return 0}get controlPressed(){return this.ariaPressed??V}render(){let e=z`${this.renderStart()}<span part="label">${this.renderLabel()}</span
      ><slot name="end" part="end" @slotchange=${this.slotChanged}></slot>
      ${this.loading?z`<span part="spinner" aria-hidden="true"></span>`:V}`,t=`${this.hasStart?`has-start`:``} ${this.hasEnd?`has-end`:``}`,n=this.getRootNode(),r=e=>e?.split(/\s+/).map(e=>n.getElementById?.(e)?.textContent??``).join(` `).trim(),i=r(this.ariaLabelledBy)||this.ariaLabel||this.label||V,a=r(this.ariaDescribedBy)||this.ariaDescription||V;return this.href?z`<a
        part="base"
        class=${t}
        href=${this.disabled||this.loading?V:this.href}
        target=${this.target??V}
        rel=${this.rel??(this.target===`_blank`?`noopener noreferrer`:V)}
        aria-label=${i}
        aria-description=${a}
        aria-disabled=${this.disabled||this.loading?`true`:V}
        tabindex=${this.disabled||this.loading?`-1`:`0`}
        aria-pressed=${this.controlPressed}
        aria-expanded=${this.ariaExpanded??V}
        aria-haspopup=${this.ariaHasPopup??V}
        >${e}</a
      >`:z`<button
      part="base"
      class=${t}
      type="button"
      ?disabled=${this.disabled}
      role=${this.controlRole}
      tabindex=${this.controlTabIndex}
      aria-disabled=${this.loading?`true`:V}
      aria-busy=${this.loading?`true`:V}
      aria-label=${i}
      aria-description=${a}
      aria-keyshortcuts=${this.ariaKeyShortcuts??V}
      aria-pressed=${this.controlPressed}
      aria-expanded=${this.ariaExpanded??V}
      aria-haspopup=${this.ariaHasPopup??V}
    >
      ${e}
    </button>`}slotChanged(e){let t=e.currentTarget;t.name===`start`?this.hasStart=t.assignedElements().length>0:this.hasEnd=t.assignedElements().length>0}updated(){let e=this.shadowRoot?.querySelector(`button, a`),t=this.getRootNode();if(!e)return;let n=e=>e?.split(/\s+/).flatMap(e=>{let n=t.getElementById?.(e);return n?[n]:[]})??[],r=n(this.ariaLabelledBy),i=n(this.ariaDescribedBy);if(`ariaLabelledByElements`in e&&(e.ariaLabelledByElements=r),`ariaDescribedByElements`in e&&(e.ariaDescribedByElements=i),this.labelObserver?.disconnect(),this.isConnected&&(!(`ariaLabelledByElements`in e)||!(`ariaDescribedByElements`in e))){this.labelObserver??=new MutationObserver(()=>this.requestUpdate());for(let e of[...r,...i])this.labelObserver.observe(e,{childList:!0,characterData:!0,subtree:!0})}`ariaControlsElements`in e&&(e.ariaControlsElements=n(this.ariaControls))}static styles=E`
    :host {
      display: inline-block;
      max-width: 100%;
      vertical-align: middle;
      color: var(--primary-color, #03a9f4);
      --qap-button-fill: var(
        --ha-color-fill-primary-normal-resting,
        var(--secondary-background-color, #e3f2fd)
      );
      --qap-button-hover: var(
        --ha-color-fill-primary-quiet-hover,
        var(--secondary-background-color, #eee)
      );
      --qap-button-active: var(--ha-color-fill-primary-quiet-active, var(--qap-button-fill));
      --qap-button-filled-hover: var(--ha-color-fill-primary-normal-hover, var(--qap-button-fill));
      --qap-button-filled-active: var(
        --ha-color-fill-primary-normal-active,
        var(--qap-button-fill)
      );
      --qap-button-accent-hover: var(
        --ha-color-fill-primary-loud-hover,
        var(--primary-color, #03a9f4)
      );
      --qap-button-accent-active: var(
        --ha-color-fill-primary-loud-active,
        var(--primary-color, #03a9f4)
      );
      --qap-button-border: var(
        --wa-color-border-loud,
        var(--ha-color-border-primary-loud, var(--primary-color, #03a9f4))
      );
      --qap-button-ink: var(
        --wa-color-on-normal,
        var(--ha-color-on-primary-normal, var(--primary-color, #03a9f4))
      );
    }
    :host([appearance="outlined"]) {
      --qap-button-ink: var(
        --wa-color-on-quiet,
        var(--ha-color-on-primary-quiet, var(--primary-color, #03a9f4))
      );
    }
    :host([hidden]) {
      display: none !important;
    }
    :host([variant="danger"]) {
      --qap-button-ink: var(--ha-color-on-danger-normal, var(--error-color, #db4437));
      --qap-button-border: var(--ha-color-border-danger-loud, var(--error-color, #db4437));
      --qap-button-hover: var(
        --ha-color-fill-danger-quiet-hover,
        var(--secondary-background-color, #eee)
      );
      --qap-button-active: var(--ha-color-fill-danger-quiet-active, var(--qap-button-fill));
      --qap-button-filled-hover: var(--ha-color-fill-danger-normal-hover, var(--qap-button-fill));
      --qap-button-filled-active: var(--ha-color-fill-danger-normal-active, var(--qap-button-fill));
      --qap-button-accent-hover: var(
        --ha-color-fill-danger-loud-hover,
        var(--error-color, #db4437)
      );
      --qap-button-accent-active: var(
        --ha-color-fill-danger-loud-active,
        var(--error-color, #db4437)
      );
      --qap-button-fill: var(
        --ha-color-fill-danger-normal-resting,
        var(--secondary-background-color, #fce8e6)
      );
    }
    :host([variant="danger"][appearance="outlined"]) {
      --qap-button-ink: var(--ha-color-on-danger-quiet, var(--error-color, #db4437));
    }
    [part="base"] {
      box-sizing: border-box;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: var(--ha-button-height, var(--button-height, 40px));
      margin: 0;
      padding: 0 var(--ha-space-4, 16px);
      border: 1px solid var(--qap-button-border);
      border-radius: var(--ha-button-border-radius, var(--ha-border-radius-pill, 9999px));
      background: transparent;
      color: var(--qap-button-ink);
      font: inherit;
      font-size: var(--ha-font-size-m, 14px);
      font-weight: var(--ha-font-weight-medium, 500);
      line-height: 1;
      text-decoration: none;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: background-color var(--ha-animation-duration-fast, 150ms) ease-out;
    }
    [part="label"] {
      min-width: 0;
      overflow: var(--ha-button-label-overflow, hidden);
      text-overflow: ellipsis;
      padding: var(--ha-space-1, 4px) 0;
    }
    .has-start {
      padding-inline-start: var(--ha-space-2, 8px);
    }
    .has-end {
      padding-inline-end: var(--ha-space-2, 8px);
    }
    slot[name="start"]::slotted(*) {
      margin-inline-end: var(--ha-space-1, 4px);
    }
    slot[name="end"]::slotted(*) {
      margin-inline-start: var(--ha-space-1, 4px);
    }
    [part="base"]:focus-visible {
      outline: 2px solid var(--ha-color-focus, var(--primary-color, #03a9f4));
      outline-offset: 2px;
    }
    :host([appearance="filled"]) [part="base"] {
      background: var(--qap-button-fill);
      border-color: transparent;
    }
    :host([appearance="accent"]) [part="base"] {
      background: var(--ha-color-fill-primary-loud-resting, var(--primary-color, #03a9f4));
      color: var(--ha-color-on-primary-loud, var(--text-primary-color, #fff));
      border-color: transparent;
    }
    :host([variant="danger"][appearance="accent"]) [part="base"] {
      background: var(--ha-color-fill-danger-loud-resting, var(--error-color, #db4437));
      color: var(--ha-color-on-danger-loud, #fff);
    }
    :host([appearance="plain"]) [part="base"] {
      border-color: transparent;
    }
    @media (hover: hover) {
      [part="base"]:hover {
        background: var(--qap-button-hover);
      }
      :host([appearance="filled"]) [part="base"]:hover {
        background: var(--qap-button-filled-hover);
      }
      :host([appearance="accent"]) [part="base"]:hover {
        background: var(--qap-button-accent-hover);
      }
    }
    [part="base"]:active {
      background: var(--qap-button-active);
    }
    :host([appearance="filled"]) [part="base"]:active {
      background: var(--qap-button-filled-active);
    }
    :host([appearance="accent"]) [part="base"]:active {
      background: var(--qap-button-accent-active);
    }
    :host([disabled]) [part="base"] {
      pointer-events: none;
      cursor: default;
      color: var(--ha-color-on-disabled-quiet, var(--disabled-text-color, #999));
      border-color: currentColor;
    }
    :host([disabled][appearance="filled"]) [part="base"],
    :host([disabled][appearance="accent"]) [part="base"] {
      background: var(--ha-color-fill-disabled-normal-resting, var(--disabled-color, #ddd));
      color: var(--ha-color-on-disabled-normal, var(--disabled-text-color, #999));
      border-color: transparent;
    }
    :host([disabled][appearance="accent"]) [part="base"] {
      background: var(--ha-color-fill-disabled-loud-resting, var(--disabled-color, #ddd));
      color: var(--ha-color-on-disabled-loud, var(--disabled-text-color, #999));
    }
    :host([disabled][appearance="plain"]) [part="base"] {
      background: transparent;
      border-color: transparent;
    }
    :host([loading]) {
      pointer-events: none;
    }
    :host([loading]) [part="base"] {
      cursor: progress;
    }
    :host([loading]) slot,
    :host([loading]) [part="label"] {
      visibility: hidden;
    }
    [part="spinner"] {
      position: absolute;
      width: 18px;
      height: 18px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      [part="base"] {
        transition: none;
      }
      [part="spinner"] {
        animation-duration: 2s;
      }
    }
  `},nt=class extends q{constructor(){super(),this.appearance=`plain`}static styles=[q.styles,E`
      :host {
        color: inherit;
      }
      [part="base"] {
        width: var(--ha-icon-button-size, 48px);
        height: var(--ha-icon-button-size, 48px);
        min-height: 0;
        padding: var(--ha-icon-button-padding-inline, var(--ha-space-2, 8px));
        color: inherit;
        border: 0;
        outline-offset: -4px;
      }
      [part="label"] {
        display: flex;
      }
      :host([selected]) [part="base"] {
        background: color-mix(in srgb, currentColor 10%, transparent);
      }
      @media (hover: hover) {
        [part="base"]:hover {
          background: color-mix(in srgb, currentColor 10%, transparent);
        }
      }
    `]},J=class extends K{static properties={value:{},label:{},type:{reflect:!0},placeholder:{},disabled:{type:Boolean,reflect:!0},required:{type:Boolean},invalid:{type:Boolean,reflect:!0},min:{},max:{},step:{},maxLength:{type:Number,attribute:`maxlength`},autocomplete:{},readOnly:{type:Boolean,attribute:`readonly`},pattern:{},hint:{},ariaDescribedBy:{attribute:`aria-describedby`},ariaLabel:{attribute:`aria-label`},ariaInvalid:{attribute:`aria-invalid`}};static shadowRootOptions={mode:`open`,delegatesFocus:!0};descriptionObserver;constructor(){super(),this.value=``,this.label=``,this.type=`text`,this.placeholder=``,this.disabled=!1,this.required=!1,this.invalid=!1,this.autocomplete=`off`,this.readOnly=!1,this.hint=``}focus(e){let t=()=>{this.isConnected&&!this.disabled&&this.formControl?.focus(e)};this.formControl?t():this.updateComplete.then(t).catch(e=>console.warn(`[Quick Access] Could not focus a rendered field.`,e))}get formControl(){return this.shadowRoot?.querySelector(`input, select`)}checkValidity(){return this.formControl?.checkValidity()??!0}reportValidity(){return this.formControl?.reportValidity()??!0}select(){this.shadowRoot?.querySelector(`input`)?.select()}setSelectionRange(e,t,n){this.shadowRoot?.querySelector(`input`)?.setSelectionRange(e,t,n)}get description(){let e=this.getRootNode();return[this.hint,this.ariaDescribedBy?.split(/\s+/).map(t=>e.getElementById(t)?.textContent??``).join(` `)].filter(Boolean).join(` `).trim()||V}disconnectedCallback(){this.descriptionObserver?.disconnect(),super.disconnectedCallback()}connectedCallback(){super.connectedCallback(),this.requestUpdate()}updated(){let e=this.formControl;if(!e)return;let t=this.getRootNode(),n=this.ariaDescribedBy?.split(/\s+/).flatMap(e=>{let n=t.getElementById(e);return n?[n]:[]})??[],r=this.shadowRoot?.querySelector(`#hint`);if(r&&n.unshift(r),`ariaDescribedByElements`in e&&(e.ariaDescribedByElements=n),this.descriptionObserver?.disconnect(),this.isConnected&&!(`ariaDescribedByElements`in e)){this.descriptionObserver??=new MutationObserver(()=>this.requestUpdate());for(let e of n)this.descriptionObserver.observe(e,{childList:!0,characterData:!0,subtree:!0})}}readInput(e){this.value=e.target.value}render(){return z`<label
        part="field"
        class=${this.value||this.placeholder||this.type===`color`||this.type===`date`?`has-value`:`empty`}
        >${this.label?z`<span part="label">${this.label}</span>`:V}
        <input
          part="base"
          .value=${this.value}
          type=${this.type}
          placeholder=${this.placeholder}
          ?disabled=${this.disabled}
          ?required=${this.required}
          aria-label=${this.ariaLabel||this.label||V}
          aria-invalid=${this.invalid||this.ariaInvalid===`true`?`true`:V}
          aria-description=${this.description}
          ?readonly=${this.readOnly}
          pattern=${this.pattern??V}
          .spellcheck=${this.spellcheck}
          min=${this.min??V}
          max=${this.max??V}
          step=${this.step??V}
          maxlength=${this.maxLength??V}
          autocomplete=${this.autocomplete}
          @input=${this.readInput}
          @change=${this.change}
        /> </label
      >${this.hint?z`<div id="hint">${this.hint}</div>`:V}`}change(e){this.readInput(e),e.stopPropagation(),this.dispatchEvent(new Event(`change`,{bubbles:!0,composed:!0}))}static styles=E`
    :host {
      display: block;
      min-width: 0;
      color: var(--ha-color-text-primary, var(--primary-text-color, #212121));
      font: inherit;
    }
    :host([hidden]) {
      display: none !important;
    }
    label {
      display: block;
      position: relative;
      font: inherit;
    }
    #hint {
      display: flex;
      align-items: center;
      min-height: var(--ha-space-5, 20px);
      margin-inline-start: var(--ha-space-3, 12px);
      font-size: var(--ha-font-size-s, 12px);
      color: var(--ha-color-text-secondary, var(--secondary-text-color, #727272));
    }
    label > span {
      position: absolute;
      inset-inline-start: var(--ha-space-4, 16px);
      top: var(--ha-space-5, 20px);
      pointer-events: none;
      font-size: var(--ha-font-size-m, 14px);
      color: var(--secondary-text-color, #727272);
      line-height: var(--ha-line-height-condensed, 1.2);
      font-family: var(--ha-font-family-body, inherit);
      font-weight: var(--ha-font-weight-normal, 400);
      transition: all var(--wa-transition-normal, 150ms) ease-in-out;
    }
    label.has-value > span,
    label:focus-within > span {
      top: var(--ha-space-3, 12px);
      font-size: var(--ha-font-size-xs, 10px);
    }
    input,
    select {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      height: var(--ha-input-height, 56px);
      padding: 0 var(--ha-space-4, 16px);
      border: 0;
      border-radius: var(--ha-border-radius-sm, 4px) var(--ha-border-radius-sm, 4px) 0 0;
      background: var(
        --ha-color-form-background,
        var(--input-fill-color, var(--secondary-background-color, #f5f5f5))
      );
      color: inherit;
      font: inherit;
      font-size: var(--ha-font-size-m, 14px);
      transition: background-color var(--wa-transition-normal, 150ms) ease-in-out;
    }
    label::after {
      content: "";
      position: absolute;
      bottom: 0;
      inset-inline: 0;
      height: 1px;
      pointer-events: none;
      background: var(
        --ha-color-border-neutral-loud,
        var(--input-idle-line-color, var(--divider-color, #999))
      );
      transition:
        height var(--wa-transition-normal, 150ms) ease-in-out,
        background-color var(--wa-transition-normal, 150ms) ease-in-out;
    }
    label:focus-within::after {
      height: 2px;
      background: var(--primary-color, #03a9f4);
    }
    label:focus-within > span {
      color: var(--primary-color, #03a9f4);
    }
    label:has([aria-invalid="true"])::after {
      background: var(--ha-color-border-danger-normal, var(--error-color, #db4437));
    }
    label:has([aria-invalid="true"]) > span {
      color: var(--ha-color-fill-danger-loud-resting, var(--error-color, #db4437));
    }
    label.has-value input,
    label.has-value select,
    label:focus-within input {
      padding-top: var(--ha-space-3, 12px);
    }
    select {
      appearance: none;
      padding-inline-end: 40px;
    }
    label:has(select) > span {
      top: calc(
        (
            var(--ha-input-height, 56px) - var(--ha-font-size-m, 14px) *
              var(--ha-line-height-normal, 1.6)
          ) /
          2
      );
      font-size: var(--ha-font-size-m, 14px);
      line-height: var(--ha-line-height-normal, 1.6);
      color: var(--secondary-text-color, #727272);
      transition: none;
    }
    label.has-value:has(select) > span {
      top: calc(
        (
            var(--ha-input-height, 56px) - 1.15rem - var(--ha-font-size-m, 14px) *
              var(--ha-line-height-normal, 1.6)
          ) /
          2
      );
      font-size: calc(var(--mdc-typography-subtitle1-font-size, 1rem) * 0.75);
      line-height: 1.15rem;
      font-weight: var(--mdc-typography-subtitle1-font-weight, 400);
      font-family: var(
        --mdc-typography-subtitle1-font-family,
        var(--mdc-typography-font-family, inherit)
      );
      color: var(--mdc-select-label-ink-color, #0009);
    }
    label.has-value select {
      padding-top: 1.15rem;
      line-height: var(--ha-line-height-normal, 1.6);
    }
    label:has(select)::before {
      content: "";
      position: absolute;
      inset-inline-end: 19px;
      top: 26px;
      pointer-events: none;
      border: 5px solid transparent;
      border-top-color: var(--ha-color-text-secondary, var(--secondary-text-color, #727272));
    }
    label.empty:has(> span) select {
      color: transparent;
    }
    input:focus,
    select:focus {
      outline: none;
    }
    input::placeholder {
      color: var(--ha-color-neutral-60, var(--secondary-text-color, #727272));
    }
    input:disabled,
    select:disabled {
      cursor: not-allowed;
      background: var(
        --ha-color-form-background-disabled,
        var(--ha-color-form-background, #f5f5f5)
      );
      opacity: var(--disabled-opacity, 0.5);
    }
    label:has(:disabled) > span {
      opacity: 0.5;
    }
    :host([type="color"]) label,
    :host([type="color"]) input {
      height: 100%;
    }
    :host([type="color"]) input {
      padding-top: var(--ha-space-6, 24px);
      padding-bottom: 2px;
      cursor: pointer;
    }
    option,
    optgroup {
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color, #212121);
    }
    @media (pointer: coarse) {
      input,
      select {
        font-size: max(16px, var(--ha-font-size-m, 14px));
      }
    }
    @media (hover: hover) {
      input:not(:disabled):hover {
        background: var(--ha-color-form-background-hover, var(--ha-color-form-background, #f5f5f5));
      }
    }
    @media (prefers-reduced-motion: reduce) {
      label > span,
      label::after,
      input,
      select {
        transition: none;
      }
    }
  `},rt=class extends J{static properties={options:{attribute:!1}};constructor(){super(),this.options=[]}render(){let e=e=>z`<option value=${e.value} ?disabled=${e.disabled}>${e.label}</option>`,t=[];for(let e of this.options){let n=t.at(-1);e.group&&n&&`items`in n&&n.group===e.group?n.items.push(e):e.group?t.push({group:e.group,items:[e]}):t.push(e)}return z`<label class=${this.value?`has-value`:`empty`}
      >${this.label?z`<span>${this.label}</span>`:V}
      <select
        part="base"
        .value=${this.value}
        ?disabled=${this.disabled}
        ?required=${this.required}
        aria-label=${this.ariaLabel||this.label||V}
        aria-invalid=${this.invalid||this.ariaInvalid===`true`?`true`:V}
        aria-description=${this.description}
        @input=${this.readInput}
        @change=${this.change}
      >
        ${t.map(t=>`items`in t?z`<optgroup label=${t.group}>${t.items.map(e)}</optgroup>`:e(t))}
      </select></label
    >`}updated(){super.updated();let e=this.shadowRoot?.querySelector(`select`);e&&(e.value=this.value)}},it=class extends K{static properties={checked:{type:Boolean,reflect:!0},disabled:{type:Boolean,reflect:!0},label:{},switch:{type:Boolean,reflect:!0},ariaLabel:{attribute:`aria-label`}};static shadowRootOptions={mode:`open`,delegatesFocus:!0};constructor(){super(),this.checked=!1,this.disabled=!1,this.label=``,this.switch=!1}focus(e){this.shadowRoot?.querySelector(`input`)?.focus(e)}click(){this.disabled||this.shadowRoot?.querySelector(`input`)?.click()}render(){return z`<label
      ><input
        type="checkbox"
        part="base"
        role=${this.switch?`switch`:V}
        .checked=${this.checked}
        ?disabled=${this.disabled}
        aria-label=${this.ariaLabel||this.label||V}
        @change=${e=>{this.checked=e.target.checked,e.stopPropagation(),this.dispatchEvent(new Event(`change`,{bubbles:!0,composed:!0}))}}
      />${this.label?z`<span>${this.label}</span>`:V}</label
    >`}static styles=E`
    :host {
      display: inline-flex;
      vertical-align: middle;
    }
    :host([hidden]) {
      display: none !important;
    }
    label {
      display: flex;
      align-items: center;
      min-width: var(--ha-space-6, 24px);
      min-height: 44px;
      gap: 8px;
      cursor: pointer;
    }
    input {
      width: 20px;
      height: 20px;
      margin: 0;
      accent-color: var(--primary-color, #03a9f4);
      cursor: inherit;
    }
    input:focus-visible {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: 3px;
    }
    input:disabled {
      opacity: var(--disabled-opacity, 0.5);
      cursor: default;
    }
    :host([switch]) label {
      min-height: var(--ha-switch-size, 24px);
      position: relative;
    }
    :host([switch]) label::before {
      content: "";
      position: absolute;
      inset: -10px 0;
      min-height: var(--ha-switch-min-touch-size, 40px);
    }
    :host([switch]) input {
      appearance: none;
      width: var(--ha-switch-width, 48px);
      height: var(--ha-switch-size, 24px);
      border-radius: 9999px;
      border: 1px solid var(--ha-switch-border-color, var(--ha-color-border-neutral-normal, #888));
      background: var(
        --ha-switch-background-color,
        var(--ha-color-fill-disabled-quiet-resting, #ddd)
      );
      position: relative;
    }
    :host([switch]) input::after {
      content: "";
      position: absolute;
      width: var(--ha-switch-thumb-size, 18px);
      height: var(--ha-switch-thumb-size, 18px);
      border-radius: 50%;
      top: 2px;
      left: 2px;
      background: var(--ha-switch-thumb-background-color, var(--ha-color-on-disabled-quiet, #888));
      box-shadow: var(--ha-switch-thumb-box-shadow, var(--ha-box-shadow-s, 0 1px 3px #0003));
      transition: transform var(--ha-animation-duration-fast, 150ms);
    }
    :host([switch]) input:checked {
      background: var(
        --ha-switch-checked-background-color,
        var(--ha-color-fill-primary-normal-resting, #e3f2fd)
      );
      border-color: var(
        --ha-switch-checked-border-color,
        var(--ha-color-border-primary-loud, var(--primary-color, #03a9f4))
      );
    }
    :host([switch]) input:checked::after {
      transform: translateX(
        calc(var(--ha-switch-width, 48px) - var(--ha-switch-thumb-size, 18px) - 6px)
      );
      background: var(--ha-switch-checked-thumb-background-color, var(--primary-color, #03a9f4));
    }
    :host(:dir(rtl)[switch]) input::after {
      left: auto;
      right: 2px;
    }
    :host(:dir(rtl)[switch]) input:checked::after {
      transform: translateX(
        calc(-1 * (var(--ha-switch-width, 48px) - var(--ha-switch-thumb-size, 18px) - 6px))
      );
    }
    @media (prefers-reduced-motion: reduce) {
      input::after {
        transition: none !important;
      }
    }
  `},at={error:`mdi:alert-circle-outline`,warning:`mdi:alert-outline`,info:`mdi:information-outline`,success:`mdi:checkbox-marked-circle-outline`},ot=class extends K{static properties={alertType:{attribute:`alert-type`,reflect:!0}};constructor(){super(),this.alertType=`error`}connectedCallback(){super.connectedCallback(),this.setAttribute(`role`,`alert`)}render(){return z`<div part="base">
      <qap-icon part="icon" icon=${at[this.alertType]??at.error}></qap-icon>
      <div part="content">
        <div part="message"><slot></slot></div>
      </div>
    </div>`}static styles=E`
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
  `},st=`(max-width: 870px), (max-height: 500px)`,ct=.5,lt=30,ut=.5,dt=5e3,Y=new WeakMap,ft=class e extends K{static properties={open:{type:Boolean,reflect:!0},label:{},description:{},adaptive:{type:Boolean,reflect:!0},width:{reflect:!0},type:{reflect:!0},headerTitle:{attribute:`header-title`},withoutHeader:{type:Boolean,attribute:`without-header`},flexContent:{type:Boolean,reflect:!0,attribute:`flexcontent`},preventScrimClose:{type:Boolean,reflect:!0,attribute:`prevent-scrim-close`}};returnFocus=null;active=!1;closing=!1;animationGeneration=0;closeTimer;sheetMedia=null;labelsObserver=null;backdropPointer=!1;gesture=null;constructor(){super(),this.open=!1,this.label=this.description=``,this.adaptive=this.flexContent=this.preventScrimClose=!1,this.withoutHeader=!0,this.width=`medium`,this.type=`standard`,this.addEventListener(`keydown`,this.handleKeyDown)}connectedCallback(){super.connectedCallback(),this.labelsObserver=new MutationObserver(()=>this.requestUpdate()),this.labelsObserver.observe(this,{subtree:!0,childList:!0,characterData:!0,attributes:!0,attributeFilter:[`aria-label`,`aria-labelledby`,`aria-describedby`]})}disconnectedCallback(){this.labelsObserver?.disconnect(),this.labelsObserver=null,this.open=!1,this.finishClose(),super.disconnectedCallback()}get surface(){return this.shadowRoot?.querySelector(`dialog`)??null}referenceText(e){let t=this.getRootNode();return(this.getAttribute(e)??``).split(/\s+/).filter(Boolean).map(e=>t.getElementById?.(e)?.textContent?.trim()??``).filter(Boolean).join(` `)}focusableControls(t=!1){let n=t=>{let r=[],i=t=>{if(!(t instanceof HTMLElement)||t instanceof e||t.hidden||t.inert||getComputedStyle(t).display===`none`)return;let a=t,o=t instanceof HTMLSlotElement,s=o||!!t.shadowRoot;if(s&&t.hasAttribute(`tabindex`)&&t.tabIndex<0)return;let c=t.isContentEditable&&!t.parentElement?.isContentEditable,l=(t.tabIndex>=0||c&&!t.hasAttribute(`tabindex`))&&!a.disabled&&!t.matches(`:disabled, input[type=hidden]`)&&t.getClientRects().length>0&&getComputedStyle(t).visibility===`visible`&&!o&&!t.shadowRoot?.delegatesFocus?[a]:[];if(s){let e;if(o){let n=t.assignedElements({flatten:!0});e=n.length?n:t.children}else e=t.shadowRoot.children;l.push(...n(e))}if(l.length&&r.push({index:Math.max(0,t.tabIndex),controls:l}),!s)for(let e of t.children)i(e)};for(let e of t)i(e);return r.sort((e,t)=>(e.index||1/0)-(t.index||1/0)),r.flatMap(e=>e.controls)},r=n(this.surface?.children??[]);return r.filter(e=>{if(!(e instanceof HTMLInputElement)||e.type!==`radio`||!e.name)return!0;let n=r.filter(t=>t instanceof HTMLInputElement&&t.type===`radio`&&t.name===e.name&&t.form===e.form&&t.getRootNode()===e.getRootNode());return e===(n.find(e=>e.matches(`:focus`))??n.find(e=>e.checked)??(t?n.at(-1):n[0]))})}handleKeyDown=t=>{if(!this.open||t.defaultPrevented||t.isComposing||t.composedPath().find(t=>t instanceof e)!==this)return;if(t.key===`Escape`){t.preventDefault(),t.stopPropagation(),this.requestDismiss(`escape`);return}if(t.key!==`Tab`||t.altKey||t.ctrlKey||t.metaKey||[...Y.get(this.ownerDocument)?.dialogs??[]].at(-1)!==this)return;let n=this.focusableControls(t.shiftKey),r=t.composedPath()[0];n.length?(r===this.surface||(t.shiftKey?r===n[0]:r===n.at(-1)))&&(t.preventDefault(),(t.shiftKey?n.at(-1):n[0])?.focus()):(t.preventDefault(),this.surface?.focus())};requestDismiss(e){!this.open||e!==`escape`&&this.preventScrimClose||this.dispatchEvent(new CustomEvent(`cancel`,{cancelable:!0,detail:{source:e}}))&&!this.preventScrimClose&&this.close()}showModal(){this.active||this.captureReturnFocus(),this.open=!0,this.cancelClose()}captureReturnFocus(){let e=this.getRootNode().activeElement;for(;e?.shadowRoot?.activeElement;)e=e.shadowRoot.activeElement;this.returnFocus=e instanceof HTMLElement?e:null}close(){let e=this.open;this.open=!1,this.active?this.animateClose():e&&(this.returnFocus=null,this.dispatchEvent(new Event(`close`)),this.dispatchEvent(new Event(`closed`)))}lockScroll(){let e=this.ownerDocument,t=Y.get(e);if(!t){let n=[e.documentElement,e.body].map(e=>[e,e.style.getPropertyValue(`overflow`),e.style.getPropertyPriority(`overflow`)]);t={dialogs:new Set,values:n},Y.set(e,t);for(let[e]of n)e.style.setProperty(`overflow`,`hidden`)}t.dialogs.add(this)}unlockScroll(){let e=Y.get(this.ownerDocument);if(e&&(e.dialogs.delete(this),!e.dialogs.size)){for(let[t,n,r]of e.values)t.style.getPropertyValue(`overflow`)===`hidden`&&(n?t.style.setProperty(`overflow`,n,r):t.style.removeProperty(`overflow`));Y.delete(this.ownerDocument)}}syncViewport=()=>{let e=this.ownerDocument.defaultView?.visualViewport;this.style.setProperty(`--qap-visual-height`,`${e?.height??innerHeight}px`),this.style.setProperty(`--qap-visual-bottom`,`${Math.max(0,innerHeight-(e?.height??innerHeight)-(e?.offsetTop??0))}px`)};syncPresentation=()=>{if(!this.open)return;let e=this.adaptive&&!!this.sheetMedia?.matches;this.surface?.classList.contains(`sheet`)!==e&&this.endGesture(),this.surface?.classList.toggle(`sheet`,e)};cancelClose(){++this.animationGeneration,clearTimeout(this.closeTimer),this.closeTimer=void 0,this.closing=!1,this.surface?.classList.remove(`closing`)}async animateClose(){if(this.closing)return;this.closing=!0,this.endGesture();let e=++this.animationGeneration,t=this.surface;t?.classList.add(`closing`),this.closeTimer=setTimeout(()=>{e===this.animationGeneration&&!this.open&&this.finishClose()},dt),await Promise.allSettled(t?.getAnimations().map(e=>e.finished)??[]),e===this.animationGeneration&&!this.open&&this.finishClose()}finishClose(){if(this.cancelClose(),this.endGesture(),this.surface?.close(),!this.active)return;this.active=!1;let e=this.ownerDocument.defaultView?.visualViewport;e?.removeEventListener(`resize`,this.syncViewport),e?.removeEventListener(`scroll`,this.syncViewport),this.ownerDocument.defaultView?.removeEventListener(`resize`,this.syncViewport),this.sheetMedia?.removeEventListener(`change`,this.syncPresentation),this.sheetMedia=null;let t=[...Y.get(this.ownerDocument)?.dialogs??[]].at(-1)===this;this.unlockScroll(),t&&this.returnFocus?.isConnected&&this.returnFocus.focus({preventScroll:!0}),this.returnFocus=null,this.dispatchEvent(new Event(`close`)),this.dispatchEvent(new Event(`closed`))}startGesture=e=>{if(!this.open||this.preventScrimClose||!this.surface?.classList.contains(`sheet`)||e.touches.length!==1||this.ownerDocument.getSelection()?.toString()||e.composedPath().some(e=>e instanceof HTMLElement&&(e.matches(`button, a, input, textarea, select, [contenteditable], [role=button], [role=slider], qap-button, qap-icon-button, qap-input, qap-select, qap-icon-picker, .qap-reorder-list > .qap-edit-item`)||e.scrollTop>0||e.scrollWidth>e.clientWidth+1)))return;let t=e.touches[0];this.gesture={x:t.clientX,y:t.clientY,time:performance.now(),distance:0}};moveGesture=e=>{if(!this.gesture||e.touches.length!==1){this.endGesture();return}let t=e.touches[0],n=Math.max(0,t.clientY-this.gesture.y);Math.abs(t.clientX-this.gesture.x)>n?this.endGesture():(this.gesture.distance=n,n>0&&(e.preventDefault(),this.surface?.classList.add(`dragging`),this.surface?.style.setProperty(`--dialog-transform`,`translateY(${n}px)`)))};endGesture=e=>{let t=this.gesture;if(this.gesture=null,this.surface?.classList.remove(`dragging`),this.surface?.style.removeProperty(`--dialog-transform`),!t||e?.type!==`touchend`)return;let n=t.distance/Math.max(1,performance.now()-t.time);(t.distance>(this.surface?.offsetHeight??1/0)*ct||t.distance>lt&&n>ut)&&this.requestDismiss(`swipe`)};render(){let e=this.label||this.referenceText(`aria-labelledby`)||this.getAttribute(`aria-label`)||this.headerTitle,t=this.description||this.referenceText(`aria-describedby`);return z`<dialog
      part="base"
      role=${this.type===`alert`?`alertdialog`:`dialog`}
      aria-modal="true"
      tabindex="-1"
      aria-label=${e||V}
      aria-description=${t||V}
      @cancel=${e=>{e.preventDefault(),e.stopPropagation(),this.requestDismiss(`escape`)}}
      @close=${()=>{this.active&&!this.surface?.open&&(this.open=!1,this.finishClose())}}
      @pointerdown=${e=>{this.backdropPointer=e.target===this.surface&&!!this.outsideSurface(e)}}
      @click=${e=>{this.backdropPointer&&e.target===this.surface&&this.outsideSurface(e)&&this.requestDismiss(`backdrop`),this.backdropPointer=!1}}
      @touchstart=${this.startGesture}
      @touchmove=${this.moveGesture}
      @touchend=${this.endGesture}
      @touchcancel=${this.endGesture}
    >
      <div class="handle" aria-hidden="true"></div>
      ${this.withoutHeader?V:z`<header class="header" part="header">
              <slot name="headerNavigationIcon"></slot>
              <h2>${this.headerTitle}</h2>
              <slot name="headerActionItems"></slot>
            </header>`}
      <div
        class="body"
        part="body"
        @scroll=${e=>{this.shadowRoot?.querySelector(`.header`)?.classList.toggle(`scrolled`,e.target.scrollTop>0)}}
      >
        <slot></slot>
      </div>
      <slot name="footer" part="footer"></slot>
    </dialog>`}outsideSurface(e){let t=this.surface?.getBoundingClientRect();return t&&(e.clientX<t.left||e.clientX>t.right||e.clientY<t.top||e.clientY>t.bottom)}updated(){let e=this.surface;if(e&&this.isConnected){if(this.open){if(this.closing&&this.cancelClose(),this.syncPresentation(),this.active)return;this.returnFocus||this.captureReturnFocus(),this.sheetMedia=this.ownerDocument.defaultView.matchMedia(st),this.sheetMedia.addEventListener(`change`,this.syncPresentation),this.syncPresentation(),this.active=!0,this.syncViewport();let t=this.ownerDocument.defaultView?.visualViewport;t?.addEventListener(`resize`,this.syncViewport),t?.addEventListener(`scroll`,this.syncViewport),this.ownerDocument.defaultView?.addEventListener(`resize`,this.syncViewport),this.lockScroll(),e.showModal(),this.dispatchEvent(new Event(`opened`)),Promise.all([...this.querySelectorAll(`*`)].map(e=>e.updateComplete)).then(()=>{if(!this.open||!this.isConnected||!e.matches(`:modal`)||[...Y.get(this.ownerDocument)?.dialogs??[]].at(-1)!==this)return;let t=this.getRootNode(),n=this.focusableControls(),r=n.map(e=>{let t=e;for(;t&&t!==this;){if(t.hasAttribute(`autofocus`))return{host:t,control:e};let n=t.getRootNode();t=t.parentElement??(n instanceof ShadowRoot?n.host:null)}return null}).find(e=>e!==null);(!t.activeElement||!this.contains(t.activeElement)||t.activeElement===this||r&&t.activeElement.contains(r.host))&&(r?.control??n[0]??e).focus({preventScroll:!0})}).catch(e=>console.warn(`[Quick Access] Could not focus a dialog control.`,e))}else this.active&&this.animateClose()}}static styles=E`
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
  `},pt=new Map,mt=0;function ht(e,t){if(customElements.get(e))return()=>{};let n=pt.get(e);if(!n){n=new Set,pt.set(e,n);let t=n;customElements.whenDefined(e).then(()=>{for(let e of[...t])e();t.clear(),pt.delete(e)})}return n.add(t),()=>n.delete(t)}var gt=class extends K{static properties={icon:{},label:{attribute:`aria-label`}};constructor(){super(),this.icon=``,this.label=``}createRenderRoot(){return this}render(){return z`<ha-icon
      icon=${this.icon}
      aria-hidden="true"
      style="display:block;width:100%;height:100%;color:inherit"
    ></ha-icon>`}updated(){this.setAttribute(`aria-hidden`,this.label?`false`:`true`),this.label?(this.setAttribute(`role`,`img`),this.setAttribute(`aria-label`,this.label)):(this.removeAttribute(`role`),this.removeAttribute(`aria-label`))}},_t=class extends K{static properties={value:{},label:{},placeholder:{},fallbackHint:{attribute:`fallback-hint`},hass:{attribute:!1},disabled:{type:Boolean,reflect:!0},native:{state:!0},ariaInvalid:{attribute:`aria-invalid`},ariaDescribedBy:{attribute:`aria-describedby`}};composing=!1;hintId=`qap-icon-hint-${++mt}`;unwatch;upgrade=()=>{let e=this.getRootNode().activeElement;for(;e?.shadowRoot?.activeElement;)e=e.shadowRoot.activeElement;!this.isConnected||this.composing||e&&this.contains(e)||customElements.get(`ha-icon-picker`)&&(this.native=!0,this.unwatch?.(),this.unwatch=void 0)};constructor(){super(),this.value=``,this.label=``,this.placeholder=`mdi:gesture-tap`,this.fallbackHint=``,this.disabled=!1,this.native=!1,this.addEventListener(`focusout`,()=>{Promise.resolve().then(this.upgrade)}),this.addEventListener(`compositionstart`,()=>{this.composing=!0}),this.addEventListener(`compositionend`,()=>{this.composing=!1,Promise.resolve().then(this.upgrade)})}createRenderRoot(){return this}connectedCallback(){super.connectedCallback(),this.upgrade(),this.unwatch=ht(`ha-icon-picker`,this.upgrade)}disconnectedCallback(){super.disconnectedCallback(),this.unwatch?.(),this.unwatch=void 0}focus(e){this.querySelector(`ha-icon-picker, input`)?.focus(e)}changed(e){this.value=e,this.dispatchEvent(new CustomEvent(`value-changed`,{detail:{value:e},bubbles:!0,composed:!0}))}render(){return this.native?z`<ha-icon-picker
        class="qap-native-control"
        .value=${this.value}
        .label=${this.label}
        .placeholder=${this.placeholder}
        .hass=${this.hass}
        .disabled=${this.disabled}
        aria-label=${this.label||V}
        aria-invalid=${this.ariaInvalid??V}
        aria-describedby=${this.ariaDescribedBy??V}
        @value-changed=${e=>{e.stopPropagation(),this.changed(e.detail?.value??``)}}
      ></ha-icon-picker>`:z`<label class="qap-field"
      ><span class="qap-field-label">${this.label}</span
      ><input
        class="qap-control"
        type="text"
        .value=${this.value}
        placeholder=${this.placeholder}
        aria-label=${this.label||V}
        aria-invalid=${this.ariaInvalid??V}
        aria-describedby=${[this.ariaDescribedBy,this.fallbackHint?this.hintId:``].filter(Boolean).join(` `)||V}
        ?disabled=${this.disabled}
        autocomplete="off"
        spellcheck="false"
        @input=${e=>this.changed(e.target.value)}
      />
      ${this.fallbackHint?z`<small class="qap-field-tip" id=${this.hintId}>${this.fallbackHint}</small>`:V}</label
    >`}updated(){let e=this.querySelector(`ha-icon-picker`);e&&(e.value=this.value)}},vt=new Set(`alarm_control_panel.alert.automation.binary_sensor.calendar.camera.climate.cover.device_tracker.fan.group.humidifier.input_boolean.lawn_mower.light.lock.media_player.person.plant.remote.schedule.script.siren.sun.switch.timer.update.vacuum.valve.water_heater.weather`.split(`.`)),yt={alarm_control_panel:`shield`,alert:`alert`,automation:`robot`,binary_sensor:`checkbox-blank-circle-outline`,button:`gesture-tap-button`,calendar:`calendar`,camera:`video`,climate:`thermostat`,conversation:`microphone-message`,counter:`counter`,cover:`window-shutter`,date:`calendar`,datetime:`calendar-clock`,device_tracker:`account`,event:`eye`,fan:`fan`,group:`google-circles-communities`,humidifier:`air-humidifier`,image:`image`,image_processing:`image-filter-frames`,input_boolean:`toggle-switch`,input_button:`gesture-tap-button`,input_datetime:`calendar-clock`,input_number:`ray-vertex`,input_select:`format-list-bulleted`,input_text:`form-textbox`,lawn_mower:`robot-mower`,light:`lightbulb`,lock:`lock`,media_player:`cast`,notify:`message`,number:`ray-vertex`,person:`account`,plant:`flower`,remote:`remote`,scene:`palette`,schedule:`calendar-clock`,script:`script-text`,select:`format-list-bulleted`,sensor:`eye`,siren:`bullhorn`,stt:`microphone-message`,sun:`white-balance-sunny`,switch:`toggle-switch-variant`,text:`form-textbox`,time:`clock`,timer:`timer-outline`,todo:`clipboard-list`,tts:`speaker-message`,update:`package`,vacuum:`robot-vacuum`,valve:`valve`,wake_word:`chat-sleep`,water_heater:`thermometer`,weather:`weather-partly-cloudy`,zone:`map-marker-radius`},bt={battery:[`battery`,`battery-outline`],battery_charging:[`battery`,`battery-charging`],carbon_monoxide:[`smoke-detector`,`smoke-detector-alert`],cold:[`thermometer`,`snowflake`],connectivity:[`close-network-outline`,`check-network-outline`],door:[`door-closed`,`door-open`],garage_door:[`garage`,`garage-open`],gas:[`check-circle`,`alert-circle`],glass_break:[`window-closed`,`window-open`],heat:[`thermometer`,`fire`],light:[`brightness-5`,`brightness-7`],lock:[`lock`,`lock-open`],moisture:[`water-off`,`water`],motion:[`motion-sensor-off`,`motion-sensor`],moving:[`octagon`,`octagon-outline`],occupancy:[`home-outline`,`home`],opening:[`square`,`square-outline`],plug:[`power-plug-off`,`power-plug`],power:[`power-plug-off`,`power-plug`],presence:[`home-outline`,`home`],problem:[`check-circle`,`alert-circle`],running:[`stop`,`play`],safety:[`check-circle`,`alert-circle`],smoke:[`smoke-detector-variant`,`smoke-detector-variant-alert`],sound:[`volume-mute`,`volume-high`],tamper:[`check-circle`,`alert-circle`],update:[`package`,`package-up`],vibration:[`crop-portrait`,`vibrate`],window:[`window-closed`,`window-open`]},xt={apparent_power:`flash`,aqi:`air-filter`,atmospheric_pressure:`thermometer-lines`,carbon_dioxide:`molecule-co2`,carbon_monoxide:`molecule-co`,current:`current-ac`,distance:`ruler`,duration:`progress-clock`,energy:`lightning-bolt`,energy_storage:`lightning-bolt`,frequency:`sine-wave`,gas:`meter-gas`,humidity:`water-percent`,illuminance:`brightness-5`,irradiance:`sun-wireless`,moisture:`water-percent`,monetary:`cash`,pm1:`blur`,pm10:`blur`,pm25:`blur`,power:`flash`,power_factor:`angle-acute`,precipitation:`weather-rainy`,precipitation_intensity:`weather-pouring`,pressure:`gauge`,reactive_power:`flash`,signal_strength:`wifi`,sound_pressure:`ear-hearing`,speed:`speedometer`,temperature:`thermometer`,timestamp:`clock`,volatile_organic_compounds:`molecule`,voltage:`sine-wave`,volume:`car-coolant-level`,volume_flow_rate:`waves-arrow-right`,water:`water`,weight:`weight`,wind_speed:`weather-windy`},St={cooling:`cool`,defrosting:`heat`,drying:`dry`,fan:`fan_only`,heating:`heat`,idle:`off`,off:`off`,preheating:`heat`},Ct=`var(--state-icon-color)`,wt=255,Tt=245,Et=5;function X(e,t=``){if(typeof e!=`string`)return t;let n=e.trim();return/^[a-z][a-z0-9_-]*:[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(n)?n.startsWith(`mdi:`)?f(n,t):n:t}function Dt(e,t=e.state){let n=e.entity_id.split(`.`)[0];if(t===`unavailable`||t===`unknown`||t===`off`&&n!==`alert`)return!1;switch(n){case`alarm_control_panel`:return t!==`disarmed`;case`alert`:return t!==`idle`;case`cover`:case`valve`:return t!==`closed`;case`device_tracker`:case`person`:return t!==`not_home`;case`lawn_mower`:case`vacuum`:return![`docked`,`paused`,`idle`].includes(t);case`lock`:return t!==`locked`;case`media_player`:return t!==`standby`;case`plant`:return t===`problem`;case`group`:return[`on`,`home`,`open`,`locked`,`problem`].includes(t);case`timer`:return t===`active`;case`camera`:return[`streaming`,`recording`].includes(t);default:return!0}}function Ot(e,t=e.state){if(t===`unavailable`)return`var(--state-unavailable-color)`;let n=e.entity_id.split(`.`)[0],r=e.attributes.device_class;if(n===`sensor`&&r===`battery`&&Number.isFinite(Number(t))){let e=`low`;return Number(t)>=70?e=`high`:Number(t)>=30&&(e=`medium`),`var(--state-sensor-battery-${e}-color)`}if(n===`group`&&Array.isArray(e.attributes.entity_id)){let t=new Set(e.attributes.entity_id.filter(e=>typeof e==`string`).map(e=>e.split(`.`)[0]));t.size===1&&vt.has([...t][0])&&(n=[...t][0])}if(!vt.has(n))return Ct;let i=t.toLowerCase().replace(/[^a-z0-9]+/g,`_`).replace(/^_|_$/g,``),a=Dt(e,t)?`active`:`inactive`;return[...r?[`--state-${n}-${r}-${i}-color`]:[],`--state-${n}-${i}-color`,`--state-${n}-${a}-color`,`--state-${a}-color`].reduceRight((e,t)=>`var(${t}, ${e})`,Ct)}function kt(e){switch(e.entity_id.split(`.`)[0]){case`update`:return e.attributes.in_progress?`mdi:package-down`:e.state===`on`?`mdi:package-up`:`mdi:package`;case`sun`:return e.state===`above_horizon`?`mdi:white-balance-sunny`:`mdi:weather-night`;case`device_tracker`:return e.attributes.source_type===`router`?e.state===`home`?`mdi:lan-connect`:`mdi:lan-disconnect`:[`bluetooth`,`bluetooth_le`].includes(String(e.attributes.source_type))?e.state===`home`?`mdi:bluetooth-connect`:`mdi:bluetooth`:e.state===`not_home`?`mdi:account-arrow-right`:`mdi:account`;case`input_datetime`:if(!e.attributes.has_date)return`mdi:clock`;if(!e.attributes.has_time)return`mdi:calendar`}}function At(e){let t=e.entity_id.split(`.`)[0],n=e.attributes.device_class??``,r=e.state===`on`;if(t===`binary_sensor`)return`mdi:${bt[n]?.[+!!r]??(r?`checkbox-marked-circle`:`checkbox-blank-circle-outline`)}`;if(t===`sensor`){if(n===`battery`){let t=Number(e.state);return Number.isFinite(t)?t<=5?`mdi:battery-alert-variant-outline`:t>=95?`mdi:battery`:`mdi:battery-${Math.round(t/10)*10}`:`mdi:battery-unknown`}if(xt[n])return`mdi:${xt[n]}`}return t===`light`?r?`mdi:lightbulb`:`mdi:lightbulb-off`:t===`switch`?n===`outlet`?`mdi:power-socket`:r?`mdi:toggle-switch-variant`:`mdi:toggle-switch-variant-off`:t===`cover`?`mdi:${({garage:[`garage`,`garage-open`],door:[`door-closed`,`door-open`],gate:[`gate`,`gate-open`],curtain:[`curtains-closed`,`curtains`],blind:[`blinds-horizontal-closed`,`blinds-horizontal`],shade:[`roller-shade-closed`,`roller-shade`],window:[`window-closed`,`window-open`]}[n]??[`window-shutter`,`window-shutter-open`])[e.state===`closed`?0:1]}`:t===`lock`?e.state===`locked`?`mdi:lock`:e.state===`jammed`?`mdi:lock-alert`:`mdi:lock-open`:yt[t]?`mdi:${yt[t]}`:f(S(e))}function jt(e,t,n,r=!1){let i=e?.entity_id.split(`.`)[0]??``,a=e&&t?.entities?.[e.entity_id],o=X(a?.icon)||X(e?.attributes.icon)||X(n)||(e?kt(e)||At(e):`mdi:help-circle`),s=e?Ot(e):`var(--state-unavailable-color)`,c=``;if(e&&e.state!==`unavailable`&&e.state!==`unknown`){let t=e.attributes.rgb_color,n=e.attributes.brightness;if(Array.isArray(t)&&t.length===3&&t.every(e=>typeof e==`number`&&Number.isFinite(e)&&e>=0&&e<=255)&&(s=`rgb(${t.join(`,`)})`),typeof n==`number`&&Number.isFinite(n)&&n>0&&i!==`plant`&&(c=`brightness(${(Math.min(n,wt)+Tt)/Et}%)`),typeof e.attributes.hvac_action==`string`&&e.attributes.hvac_action){let t=St[e.attributes.hvac_action];s=t?Ot(e,t):Ct}}(r||a?.disabled_by)&&(s=`var(--disabled-text-color)`,c=``);let l=e?.attributes.entity_picture_local||e?.attributes.entity_picture,u=typeof l==`string`?l:``;u&&(t?.hassUrl?u=t.hassUrl(u):/^\/api\/brands\//.test(u)&&(u=``),i===`camera`&&u&&(u+=`${u.includes(`?`)?`&`:`?`}width=80&height=80`));let d=`var(--state-badge-with-image-border-radius, 50%)`;return i===`update`?d=`var(--ha-border-radius-square, 0px)`:(i===`media_player`||i===`camera`)&&(d=`var(--state-badge-with-media-image-border-radius, 8%)`),{icon:o,color:s,filter:c,image:u,imageRadius:d,pulse:!!(e&&(i===`alarm_control_panel`&&[`pending`,`arming`,`triggered`].includes(e.state)||i===`lock`&&e.state===`jammed`))}}function Mt(e,t){return e.icon===t.icon&&e.color===t.color&&e.filter===t.filter&&e.image===t.image&&e.imageRadius===t.imageRadius&&e.pulse===t.pulse}var Nt=new WeakMap;function Pt(e,t,n,r){let i=r??JSON.stringify(e.config?.components),a=t.get(i);if(!a){let o={ready:Promise.resolve()};o.ready=Promise.resolve().then(()=>e.callWS({type:`frontend/get_icons`,category:n,...r?{integration:r}:{}})).then(e=>{o.value=e?.resources}).catch(()=>{}),t.set(i,o),a=o}return a}function Ft(e,t){let n=X(t?.state?.[e]);if(n)return n;if(t?.range&&e.trim()&&Number.isFinite(Number(e))){let n=Object.keys(t.range).map(Number).filter(Number.isFinite).filter(t=>t<=Number(e)).sort((e,t)=>t-e)[0],r=X(t.range[String(n)]);if(r)return r}return X(t?.default)||void 0}function It(e,t){if(!e||!t?.callWS||!t.connection||X(t.entities?.[e.entity_id]?.icon)||X(e.attributes.icon))return{pending:[]};let n=Nt.get(t.connection);n||(n={components:new Map,platforms:new Map},Nt.set(t.connection,n));let r=e.entity_id.split(`.`)[0],i=t.entities?.[e.entity_id],a=t.config?.components??[],o=i?.platform&&i.translation_key&&a.includes(i.platform)?Pt(t,n.platforms,`entity`,i.platform):void 0,s=a.includes(r)?Pt(t,n.components,`entity_component`):void 0,c=i?.platform&&i.translation_key?o?.value?.[i.platform]?.[r]?.[i.translation_key]:void 0,l=s?.value?.[r];return{icon:Ft(e.state,c)||kt(e)||Ft(e.state,l?.[e.attributes.device_class??``]||l?._),pending:[...o?[o.ready]:[],...s?[s.ready]:[]]}}var Lt=class extends K{static properties={stateObj:{attribute:!1,hasChanged:()=>!0},hass:{attribute:!1},disabled:{type:Boolean,reflect:!0}};presentation;observedResources=new WeakSet;constructor(){super(),this.disabled=!1}connectedCallback(){super.connectedCallback(),this.setAttribute(`aria-hidden`,`true`),this.requestUpdate()}shouldUpdate(){let e=It(this.stateObj,this.hass);for(let t of e.pending){if(this.observedResources.has(t))continue;this.observedResources.add(t);let e=new WeakRef(this);t.then(()=>{let t=e.deref();t?.isConnected&&t.requestUpdate()})}let t=jt(this.stateObj,this.hass,e.icon,this.disabled);return this.presentation&&Mt(this.presentation,t)?!1:(this.presentation=t,!0)}render(){let e=this.presentation??jt(this.stateObj,this.hass,void 0,this.disabled);return z`<ha-icon
        .icon=${e.icon}
        aria-hidden="true"
        ?hidden=${!!e.image}
        class=${e.pulse?`pulse`:``}
        style=${`color:${e.color};filter:${e.filter||`none`}`}
      ></ha-icon>
      ${e.image?z`<span class="picture" style=${`background-image:url(${JSON.stringify(e.image)});border-radius:${e.imageRadius}`}></span>`:V}`}static styles=E`
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
  `},Rt=class extends J{static properties={...J.properties,clearLabel:{}};composing=!1;constructor(){super(),this.type=`search`,this.clearLabel=`Clear`}connectedCallback(){super.connectedCallback(),this.spellcheck=!1}clear(){this.disabled||this.readOnly||this.composing||(this.value=``,this.formControl&&(this.formControl.value=``),this.focus({preventScroll:!0}),this.dispatchEvent(new Event(`input`,{bubbles:!0,composed:!0})),this.dispatchEvent(new Event(`change`,{bubbles:!0,composed:!0})))}render(){return z`<div part="base">
      <qap-icon icon="mdi:magnify" aria-hidden="true"></qap-icon>
      <input
        part="input"
        type="search"
        inputmode="search"
        enterkeyhint="search"
        .value=${this.value}
        placeholder=${this.placeholder}
        aria-label=${this.ariaLabel||this.label||this.placeholder||V}
        aria-description=${this.description}
        ?disabled=${this.disabled}
        ?readonly=${this.readOnly}
        autocomplete=${this.autocomplete}
        .spellcheck=${this.spellcheck}
        maxlength=${this.maxLength??V}
        @input=${this.readInput}
        @change=${this.change}
        @compositionstart=${()=>{this.composing=!0}}
        @compositionend=${()=>{this.composing=!1}}
      />
      <qap-icon-button
        .label=${this.clearLabel}
        ?hidden=${!this.value||this.disabled||this.readOnly}
        @pointerdown=${e=>e.preventDefault()}
        @click=${this.clear}
        @keydown=${e=>{(e.key===`Enter`||e.key===` `)&&e.stopPropagation()}}
      >
        <qap-icon icon="mdi:close" aria-hidden="true"></qap-icon>
      </qap-icon-button>
    </div>`}static styles=E`
    :host {
      display: block;
      min-width: 0;
      font: inherit;
      color: var(--primary-text-color, #212121);
      --ha-color-form-background: var(--card-background-color, #fff);
    }
    [part="base"] {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 0;
      height: var(--ha-input-search-height, 40px);
      padding: 0 var(--ha-space-2, 8px);
      border: 1px solid
        var(
          --wa-form-control-border-color,
          var(--ha-color-border-neutral-quiet, var(--divider-color, #ddd))
        );
      border-radius: var(--ha-input-search-border-radius, var(--ha-border-radius-md, 8px));
      background: var(--ha-color-form-background, var(--card-background-color, #fff));
      transition:
        border-color var(--wa-transition-normal, 250ms) ease-in-out,
        background-color var(--wa-transition-normal, 250ms) ease-in-out;
    }
    [part="base"]:hover {
      border-color: var(--ha-color-border-neutral-normal, var(--divider-color, #999));
      background: var(
        --ha-color-form-background-hover,
        var(--ha-color-form-background, var(--card-background-color, #fff))
      );
    }
    :host(:focus-within) [part="base"] {
      border-color: var(--primary-color, #03a9f4);
    }
    input {
      box-sizing: border-box;
      flex: 1;
      width: 100%;
      min-width: 0;
      border: 0;
      outline: 0;
      padding: 0 0 0 var(--ha-space-1, 4px);
      background: transparent;
      color: inherit;
      font: inherit;
      font-family: var(--ha-font-family-body, inherit);
      font-size: var(--ha-font-size-m, 14px);
      font-weight: var(--ha-font-weight-normal, 400);
      line-height: var(--ha-line-height-condensed, 1.2);
    }
    input::placeholder {
      color: var(--ha-color-neutral-60, var(--secondary-text-color, #727272));
      opacity: 1;
    }
    input::-webkit-search-cancel-button,
    input::-webkit-search-decoration {
      appearance: none;
    }
    qap-icon {
      --mdc-icon-size: 18px;
      width: 18px;
      height: 18px;
      flex: none;
      color: inherit;
    }
    qap-icon-button {
      --ha-icon-button-size: 24px;
      --ha-icon-button-padding-inline: 3px;
      color: var(--ha-color-text-secondary, var(--secondary-text-color, #727272));
    }
    qap-icon-button qap-icon {
      width: 18px;
      height: 18px;
    }
    qap-icon-button[hidden],
    :host([hidden]) {
      display: none;
    }
    :host([disabled]) {
      opacity: var(--disabled-opacity, 0.5);
    }
    @media (pointer: coarse) {
      input {
        font-size: max(16px, var(--ha-font-size-m, 14px));
      }
    }
    @media (prefers-reduced-motion: reduce) {
      [part="base"] {
        transition: none;
      }
    }
  `},zt=class extends q{static properties={...q.properties,selectable:{type:Boolean,reflect:!0}};constructor(){super(),this.selectable=!1,this.addEventListener(`click`,e=>{if(!this.selectable||e.defaultPrevented)return;let t=this.selected;this.selected=!t,Promise.resolve().then(()=>{e.defaultPrevented&&(this.selected=t)})})}get controlPressed(){return this.selectable?String(this.selected):V}renderStart(){return z`${this.selectable&&this.selected?z`<qap-icon class="check" icon="mdi:check" aria-hidden="true"></qap-icon>`:super.renderStart()}`}render(){return z`<div class="container">${super.render()}</div>`}static styles=[q.styles,E`
      :host {
        display: inline-flex;
        flex: none;
        max-width: 100%;
        --ha-button-height: 32px;
        --ha-button-border-radius: var(
          --ha-assist-chip-container-shape,
          var(--ha-border-radius-pill, 9999px)
        );
        --qap-button-hover: color-mix(
          in srgb,
          var(--ha-chip-label-color, var(--primary-text-color)) 8%,
          transparent
        );
        --qap-button-active: color-mix(
          in srgb,
          var(--ha-chip-label-color, var(--primary-text-color)) 12%,
          transparent
        );
      }
      .container {
        display: flex;
        position: relative;
        min-width: 0;
        max-width: 100%;
        height: var(--ha-button-height);
        border-radius: var(--ha-button-border-radius);
      }
      .container::before,
      .container::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
      }
      .container::before {
        background: var(
          --ha-chip-container-color,
          var(--ha-assist-chip-container-color, transparent)
        );
        opacity: var(--ha-chip-container-opacity, 1);
      }
      .container::after {
        border: var(--ha-chip-outline-width, 1px) solid
          var(--ha-chip-outline-color, var(--outline-color, #999));
      }
      [part="base"] {
        position: relative;
        min-width: 0;
        height: var(--ha-button-height);
        min-height: var(--ha-button-height);
        gap: var(--ha-chip-icon-label-space, var(--ha-space-2, 8px));
        padding-inline: var(--ha-space-4, 16px);
        border: 0;
        background: transparent;
        color: var(--ha-chip-label-color, var(--primary-text-color));
        box-shadow: none;
      }
      [part="label"] {
        padding: 0;
        white-space: nowrap;
        font-size: var(--ha-chip-label-size, 0.875rem);
        font-weight: var(--ha-chip-label-weight, var(--ha-font-weight-normal, 400));
        line-height: var(--ha-chip-label-line-height, 1.25rem);
      }
      :host([selectable]) [part="label"] {
        font-weight: var(--ha-chip-label-weight, var(--ha-font-weight-medium, 500));
      }
      :host([selected][selectable]) {
        --ha-chip-container-color: var(
          --md-filter-chip-selected-container-color,
          rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.15)
        );
        --ha-chip-outline-width: var(--md-filter-chip-selected-outline-width, 0px);
      }
      :host([selected][selectable]) [part="base"] {
        padding-inline-start: var(--ha-space-2, 8px);
      }
      .check {
        --mdc-icon-size: var(--ha-chip-icon-size, 18px);
        display: flex;
        flex: none;
        width: var(--ha-chip-icon-size, 18px);
        height: var(--ha-chip-icon-size, 18px);
      }
      [part="base"]::after {
        content: "";
        position: absolute;
        inset: -8px 0;
      }
      :host([disabled]) [part="base"] {
        color: var(--ha-chip-label-color, var(--primary-text-color));
        border-color: var(--ha-chip-outline-color, var(--outline-color, #999));
      }
      :host([disabled]) [part="label"],
      :host([disabled]) .check {
        opacity: 0.38;
      }
      :host([disabled][selected]) .container::before {
        background: var(--primary-text-color);
        opacity: 0.12;
      }
    `]},Bt=class extends K{static properties={open:{type:Boolean,reflect:!0},anchorElement:{attribute:!1}};listeners;observer;constructor(){super(),this.open=!1}get surface(){return this.shadowRoot?.querySelector(`[popover]`)}updated(e){if(!e.has(`open`)&&!e.has(`anchorElement`))return;this.release();let t=this.surface;if(!t||!this.isConnected)return;if(!this.open){t.hidePopover();return}t.showPopover(),this.position(),this.listeners=new AbortController;let n={signal:this.listeners.signal};window.addEventListener(`resize`,this.position,n),document.addEventListener(`keydown`,e=>{e.key===`Escape`&&!e.isComposing&&this.open&&(e.preventDefault(),e.stopPropagation(),this.open=!1,this.dispatchEvent(new Event(`close`)))},{...n,capture:!0}),document.addEventListener(`scroll`,this.position,{...n,capture:!0}),window.visualViewport?.addEventListener(`resize`,this.position,n),window.visualViewport?.addEventListener(`scroll`,this.position,n),this.observer=new ResizeObserver(this.position),this.observer.observe(t),this.anchorElement&&this.observer.observe(this.anchorElement)}position=()=>{let e=this.surface;if(!e||!this.anchorElement?.isConnected)return;let t=this.anchorElement.getBoundingClientRect(),n=e.getBoundingClientRect(),r=window.visualViewport,i=r?.offsetLeft??0,a=r?.offsetTop??0,o=r?.width??innerWidth,s=r?.height??innerHeight;e.style.left=`${Math.max(i+8,Math.min(t.right-n.width,i+o-n.width-8))}px`;let c=t.bottom+8;e.style.top=`${Math.max(a+8,Math.min(c+n.height<=a+s-8?c:t.top-n.height-8,a+s-n.height-8))}px`};release(){this.listeners?.abort(),this.listeners=void 0,this.observer?.disconnect(),this.observer=void 0}disconnectedCallback(){this.release(),this.surface?.hidePopover(),super.disconnectedCallback()}connectedCallback(){super.connectedCallback(),this.requestUpdate(`open`)}render(){return z`<div popover="manual">
      <div part="body"><slot></slot></div>
    </div>`}static styles=E`
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
  `},Z=class extends q{static properties={...q.properties,focusIndex:{type:Number,attribute:!1}};constructor(){super(),this.focusIndex=-1}get controlTabIndex(){return this.focusIndex}renderLabel(){return z`<slot name="content"><slot></slot></slot>`}connectedCallback(){super.connectedCallback(),this.setAttribute(`role`,`listitem`)}static styles=[q.styles,E`
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
    `]},Vt=class extends K{observer;constructor(){super(),this.addEventListener(`keydown`,this.navigate),this.addEventListener(`focusin`,e=>{let t=e.composedPath().find(e=>e instanceof Z);t&&this.sync(t)})}connectedCallback(){super.connectedCallback(),this.setAttribute(`role`,`list`),this.observer=new MutationObserver(()=>this.sync()),this.observer.observe(this,{attributes:!0,subtree:!0,attributeFilter:[`disabled`,`hidden`]}),this.sync()}disconnectedCallback(){this.observer?.disconnect(),this.observer=void 0,super.disconnectedCallback()}get items(){return[...this.children].filter(e=>e instanceof Z&&!e.disabled&&!e.hidden)}sync(e=this.items.find(e=>e.focusIndex===0)??this.items[0]){for(let t of this.children)t instanceof Z&&(t.focusIndex=t===e?0:-1)}navigate=e=>{if(e.isComposing||e.altKey||e.ctrlKey||e.metaKey||![`ArrowDown`,`ArrowUp`,`Home`,`End`].includes(e.key))return;let t=this.items;if(!t.length)return;let n=t.findIndex(t=>e.composedPath().includes(t)),r;r=e.key===`Home`?0:e.key===`End`?t.length-1:(n+(e.key===`ArrowDown`?1:-1)+t.length)%t.length,e.preventDefault(),e.stopPropagation(),this.sync(t[r]),t[r].focus({preventScroll:!0})};render(){return z`<slot @slotchange=${()=>this.sync()}></slot>`}static styles=E`
    :host {
      display: block;
    }
  `},Ht=5e3,Ut=class extends q{static properties={...q.properties,value:{}};constructor(){super(),this.value=``}get controlRole(){return`menuitem`}get controlTabIndex(){return-1}renderStart(){return z`<slot name="icon" part="icon"></slot>`}static styles=[q.styles,E`
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
    `]},Wt=class extends K{static properties={open:{type:Boolean,reflect:!0,noAccessor:!0},anchorElement:{attribute:!1},distance:{type:Number},placement:{},ariaLabel:{attribute:`aria-label`}};menuOpen=!1;pendingHide=!1;get open(){return this.menuOpen}set open(e){let t=this.menuOpen;t!==e&&(this.menuOpen=e,this.cancelAnimationCompletion(),e&&(this.pendingHide=!0),this.requestUpdate(`open`,t))}listeners;observer;generation=0;animationTimer;query=``;typedAt=0;constructor(){super(),this.open=!1,this.distance=0,this.placement=`bottom-end`,this.addEventListener(`keydown`,this.navigate),this.addEventListener(`click`,e=>{let t=e.composedPath().find(e=>e instanceof Ut&&e.parentElement===this);if(!this.open||!t||t.disabled)return;let n=new CustomEvent(`wa-select`,{detail:{item:t},bubbles:!0,composed:!0,cancelable:!0});this.dispatchEvent(n)&&(this.open=!1,this.anchorElement?.focus({preventScroll:!0}))})}get surface(){return this.shadowRoot?.querySelector(`[popover]`)}get items(){return[...this.children].filter(e=>e instanceof Ut&&!e.disabled&&!e.hidden)}updated(e){e.has(`open`)?this.syncOpen():this.open&&this.position()}async syncOpen(){this.cancelAnimationCompletion();let e=this.generation,t=this.surface;if(this.listeners?.abort(),this.listeners=void 0,this.observer?.disconnect(),this.observer=void 0,!t||!this.isConnected)return;if(this.open){if(!this.anchorElement?.isConnected){this.open=!1;return}t.showPopover(),this.position(),t.className=`show`,this.query=``,this.listeners=new AbortController;let e={signal:this.listeners.signal},n=e=>{let t=e.composedPath();t.includes(this)||this.anchorElement&&t.includes(this.anchorElement)||(this.open=!1)};document.addEventListener(`pointerdown`,n,{...e,capture:!0}),document.addEventListener(`focusin`,n,{...e,capture:!0}),window.visualViewport?.addEventListener(`resize`,this.position,e),window.visualViewport?.addEventListener(`scroll`,this.position,e),this.observer=new ResizeObserver(this.position),this.observer.observe(t)}else{if(!t.matches(`:popover-open`)){this.pendingHide&&(this.pendingHide=!1,this.dispatchEvent(new Event(`wa-after-hide`,{bubbles:!0,composed:!0})));return}t.className=`hide`}let n=()=>{if(e!==this.generation||!this.isConnected)return;let n=this.open;this.cancelAnimationCompletion();let r=this.generation;n?(this.position(),this.items[0]?.focus({preventScroll:!0})):(this.pendingHide=!1,t.hidePopover()),r===this.generation&&n===this.open&&this.dispatchEvent(new Event(n?`wa-after-show`:`wa-after-hide`,{bubbles:!0,composed:!0}))};this.animationTimer=setTimeout(n,Ht),await Promise.allSettled(t.getAnimations().map(e=>e.finished)),n()}cancelAnimationCompletion(){++this.generation,clearTimeout(this.animationTimer),this.animationTimer=void 0}position=()=>{let e=this.surface,t=this.anchorElement?.getBoundingClientRect();if(!e||!t)return;let n=window.visualViewport,r=n?.offsetLeft??0,i=n?.offsetTop??0,a=n?.width??innerWidth,o=n?.height??innerHeight;e.style.maxWidth=`${Math.max(0,a-16)}px`,e.style.maxHeight=`${Math.max(0,o-16)}px`;let s=getComputedStyle(e),c=parseFloat(s.width),l=parseFloat(s.height);e.style.left=`${Math.max(r+8,Math.min(t.right-c,r+a-c-8))}px`;let u=t.bottom+this.distance;e.style.top=`${Math.max(i+8,Math.min(u+l<=i+o-8?u:t.top-l-this.distance,i+o-l-8))}px`,e.style.transformOrigin=u+l<=i+o-8?`top`:`bottom`};navigate=e=>{if(!this.open||e.isComposing||e.altKey||e.ctrlKey||e.metaKey)return;if(e.key===`Escape`||e.key===`Tab`){e.key===`Escape`&&(e.preventDefault(),e.stopPropagation(),this.anchorElement?.focus({preventScroll:!0})),this.open=!1;return}let t=this.items;if(!t.length)return;let n=t.findIndex(t=>e.composedPath().includes(t)),r;if([`ArrowDown`,`ArrowUp`,`Home`,`End`].includes(e.key)){let i;i=e.key===`Home`?0:e.key===`End`?t.length-1:(n+(e.key===`ArrowDown`?1:-1)+t.length)%t.length,r=t[i]}else if(e.key.length===1&&e.key!==` `){let i=performance.now();this.query=i-this.typedAt>1e3?e.key:this.query+e.key,this.typedAt=i;let a=e=>(e.textContent??``).trim().toLocaleLowerCase().startsWith(this.query.toLocaleLowerCase());r=[...t.slice(n+1),...t.slice(0,n+1)].find(a)}r&&(e.preventDefault(),e.stopPropagation(),r.focus({preventScroll:!0}),r.scrollIntoView({block:`nearest`}))};connectedCallback(){super.connectedCallback(),this.requestUpdate(`open`)}disconnectedCallback(){this.cancelAnimationCompletion(),this.open=!1,this.pendingHide=!1,this.listeners?.abort(),this.listeners=void 0,this.observer?.disconnect(),this.observer=void 0,this.surface?.hidePopover(),super.disconnectedCallback()}render(){return z`<div popover="manual" role="menu" aria-label=${this.ariaLabel??``} part="menu">
      <slot></slot>
    </div>`}static styles=E`
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
  `},Gt=5e3,Kt=class extends K{static properties={labelText:{attribute:`label-text`},announceText:{attribute:`announce-text`},timeoutMs:{type:Number,attribute:`timeout-ms`},bottomOffset:{type:Number,attribute:`bottom-offset`},active:{state:!0},visible:{state:!0},announcing:{state:!0},hasActions:{state:!0}};generation=0;dismissTimer;transitionTimer;finishTransition;constructor(){super(),this.labelText=``,this.timeoutMs=4e3,this.bottomOffset=0,this.active=!1,this.visible=!1,this.announcing=!1,this.hasActions=!1}get surface(){return this.shadowRoot?.querySelector(`[popover]`)}cancelPending(){++this.generation,clearTimeout(this.dismissTimer),this.dismissTimer=void 0,this.finishTransition?.()}waitForTransition(){let e=this.surface?.getAnimations()??[];return e.length?new Promise(t=>{let n=()=>{this.finishTransition===n&&(clearTimeout(this.transitionTimer),this.transitionTimer=void 0,this.finishTransition=void 0,t())};this.finishTransition=n,this.transitionTimer=setTimeout(n,Gt),Promise.allSettled(e.map(e=>e.finished)).then(n)}):Promise.resolve()}async show(){let e=this.active&&this.visible;this.cancelPending();let t=this.generation;this.isConnected&&(this.active=!0,this.announcing=!1,await this.updateComplete,t===this.generation&&this.isConnected&&(this.surface?.showPopover(),this.surface?.getBoundingClientRect(),this.visible=!0,this.announcing=!0,await this.updateComplete,t===this.generation&&this.isConnected&&(e||await this.waitForTransition(),t===this.generation&&this.isConnected&&this.timeoutMs>0&&(this.dismissTimer=setTimeout(()=>{this.hide(`timeout`)},this.timeoutMs)))))}async hide(e=`programmatic`){this.cancelPending();let t=this.generation;this.active&&(this.visible=!1,this.announcing=!1,await this.updateComplete,t===this.generation&&this.isConnected&&(await this.waitForTransition(),t===this.generation&&this.isConnected&&(this.surface?.hidePopover(),this.active=!1,await this.updateComplete,t===this.generation&&this.isConnected&&this.dispatchEvent(new CustomEvent(`toast-closed`,{detail:{reason:e},bubbles:!0,composed:!0})))))}close(e=`programmatic`){return this.hide(e)}disconnectedCallback(){this.cancelPending(),this.surface?.hidePopover(),this.active=this.visible=!1,this.announcing=!1,super.disconnectedCallback()}syncActions=()=>{this.hasActions=[...this.querySelectorAll(`[slot="action"], [slot="dismiss"]`)].length>0};render(){return z`<div
        popover="manual"
        part="base"
        class="toast ${this.active?`active`:``} ${this.visible?`visible`:``}"
        style=${`--ha-toast-bottom-offset:${this.bottomOffset}px`}
      >
        <span class="message">${this.labelText}</span>
        <div class="actions" ?hidden=${!this.hasActions}>
          <slot name="action" @slotchange=${this.syncActions}></slot
          ><slot name="dismiss" @slotchange=${this.syncActions}></slot>
        </div>
      </div>
      <span class="assistive-message" role="status" aria-live="polite" aria-atomic="true"
        >${this.announcing?this.announceText??this.labelText:``}</span
      >`}static styles=E`
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
  `},qt=class extends K{static properties={value:{reflect:!0},checked:{type:Boolean,reflect:!0},disabled:{type:Boolean,reflect:!0},forceDisabled:{type:Boolean,attribute:!1}};constructor(){super(),this.value=``,this.checked=!1,this.disabled=!1,this.forceDisabled=!1,this.addEventListener(`click`,e=>{this.disabled||this.forceDisabled?(e.preventDefault(),e.stopImmediatePropagation()):this.parentElement instanceof Q||(this.checked=!0)}),this.addEventListener(`keydown`,e=>{this.parentElement instanceof Q||e.key!==` `||e.isComposing||(e.preventDefault(),this.click())})}connectedCallback(){super.connectedCallback(),this.setAttribute(`role`,`radio`)}updated(){this.setAttribute(`aria-checked`,String(this.checked)),this.setAttribute(`aria-disabled`,String(this.disabled||this.forceDisabled)),this.parentElement instanceof Q||(this.tabIndex=this.disabled||this.forceDisabled?-1:0),this.parentElement?.dispatchEvent(new Event(`qap-radio-update`))}render(){return z`<span part="control" class="control" aria-hidden="true"
        >${this.checked?z`<svg viewBox="0 0 16 16" part="checked-icon"><circle cx="8" cy="8" r="8" /></svg>`:V}</span
      ><slot part="label"></slot>`}static styles=E`
    :host {
      display: inline-flex;
      flex-direction: row;
      align-items: normal;
      color: var(--wa-form-control-value-color, var(--primary-text-color));
      font-family: inherit;
      font-weight: var(--wa-form-control-value-font-weight, 400);
      line-height: var(--wa-form-control-value-line-height, 1.6);
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      margin-block: 0.375em;
    }
    :host([data-first]) {
      margin-block-start: 0;
      margin-inline-start: 0;
    }
    :host([data-last]) {
      margin-block-end: 0;
      margin-inline-end: 0;
    }
    :host([data-horizontal]) {
      margin-block: 0;
      margin-inline: 0.5em;
    }
    :host([data-horizontal][data-first]) {
      margin-inline-start: 0;
    }
    :host([data-horizontal][data-last]) {
      margin-inline-end: 0;
    }
    :host(:focus) {
      outline: none;
    }
    .control {
      box-sizing: border-box;
      width: var(--ha-radio-option-toggle-size, 20px);
      height: var(--ha-radio-option-toggle-size, 20px);
      border: var(--ha-radio-option-border-width, var(--ha-border-width-md, 2px))
        var(--wa-form-control-border-style, solid)
        var(
          --ha-radio-option-border-color,
          var(--ha-color-border-neutral-normal, var(--secondary-text-color, #727272))
        );
      background: var(--ha-radio-option-background-color, transparent);
      color: transparent;
      transition:
        background var(--wa-transition-normal, 250ms),
        border-color var(--wa-transition-fast, 150ms),
        box-shadow var(--wa-transition-fast, 150ms),
        color var(--wa-transition-fast, 150ms);
      transition-timing-function: var(--wa-transition-easing, ease);
      border-radius: 50%;
      flex: none;
      display: inline-flex;
      justify-content: center;
      align-items: center;
      margin: var(
        --ha-radio-option-control-margin,
        var(--ha-space-3, 12px) var(--ha-space-2, 8px) var(--ha-space-3, 12px)
          var(--ha-space-3, 12px)
      );
    }
    svg {
      fill: currentColor;
      width: var(--ha-radio-option-toggle-size, 20px);
      height: var(--ha-radio-option-toggle-size, 20px);
      scale: var(--ha-radio-option-checked-icon-scale, 0.7);
      display: flex;
    }
    [part="label"] {
      display: inline-flex;
      align-items: center;
      cursor: pointer;
    }
    :host([aria-checked="true"]) .control {
      background: var(
        --ha-radio-option-checked-background-color,
        var(--ha-color-fill-primary-normal-resting, transparent)
      );
      color: var(
        --ha-radio-option-checked-icon-color,
        var(
          --ha-radio-option-active-color,
          var(--ha-color-fill-primary-loud-resting, var(--primary-color, #03a9f4))
        )
      );
      border-color: currentColor;
    }
    :host(:not([aria-checked="true"], [aria-disabled="true"]):hover) .control {
      border-color: var(
        --ha-radio-option-border-color-hover,
        var(
          --ha-radio-option-border-color,
          var(--ha-color-border-neutral-loud, var(--primary-text-color))
        )
      );
      background: var(
        --ha-radio-option-background-color-hover,
        var(--ha-color-fill-neutral-quiet-hover, var(--secondary-background-color))
      );
    }
    :host(:focus-visible) .control {
      outline: var(--wa-focus-ring, 2px solid var(--primary-color));
      outline-offset: var(--wa-focus-ring-offset, 2px);
    }
    :host([aria-disabled="true"]) {
      opacity: 0.5;
      cursor: not-allowed;
    }
    :host([aria-disabled="true"]) [part="label"] {
      cursor: not-allowed;
    }
    :host([hidden]) {
      display: none;
    }
    @media (prefers-reduced-motion: reduce) {
      .control {
        transition: none;
      }
    }
  `},Q=class extends K{static properties={value:{},name:{},label:{},disabled:{type:Boolean,reflect:!0},orientation:{reflect:!0}};constructor(){super(),this.value=``,this.name=``,this.label=``,this.disabled=!1,this.orientation=`vertical`,this.addEventListener(`qap-radio-update`,this.syncOptions),this.addEventListener(`click`,e=>{let t=e.composedPath().find(e=>e instanceof qt&&e.parentElement===this);t&&this.select(t)}),this.addEventListener(`keydown`,this.navigate)}get options(){return[...this.children].filter(e=>e instanceof qt)}get enabledOptions(){return this.options.filter(e=>!e.disabled&&!e.hidden)}syncOptions=()=>{let e=this.options,t=this.enabledOptions,n=t.find(e=>e.value===this.value)??t[0];for(let[t,r]of e.entries())r.forceDisabled=this.disabled,r.checked=r.value===this.value,r.tabIndex=!this.disabled&&r===n?0:-1,r.toggleAttribute(`data-first`,t===0),r.toggleAttribute(`data-last`,t===e.length-1),r.toggleAttribute(`data-horizontal`,this.orientation===`horizontal`)};select(e){if(this.disabled||e.disabled||e.hidden)return;let t=this.value;this.value=e.value,this.syncOptions(),t!==this.value&&(this.dispatchEvent(new InputEvent(`input`,{bubbles:!0,composed:!0})),this.dispatchEvent(new Event(`change`,{bubbles:!0,composed:!0})))}navigate=e=>{if(this.disabled||e.isComposing||e.altKey||e.ctrlKey||e.metaKey||![`ArrowUp`,`ArrowDown`,`ArrowLeft`,`ArrowRight`,` `].includes(e.key))return;let t=this.enabledOptions;if(!t.length)return;let n=t.findIndex(t=>e.composedPath().includes(t)),r=n<0?Math.max(0,t.findIndex(e=>e.value===this.value)):n,i=1;e.key===` `?i=0:[`ArrowUp`,`ArrowLeft`].includes(e.key)&&(i=-1);let a=t[(r+i+t.length)%t.length];e.preventDefault(),e.stopPropagation(),this.select(a),a.focus({preventScroll:!0})};focus(e){this.disabled||(this.enabledOptions.find(e=>e.value===this.value)??this.enabledOptions[0])?.focus(e)}updated(){this.syncOptions()}render(){return z`<fieldset
      role="radiogroup"
      aria-label=${this.label||this.getAttribute(`aria-label`)||V}
      aria-orientation=${this.orientation}
      aria-disabled=${String(this.disabled)}
    >
      ${this.label?z`<label part="form-control-label" @click=${()=>this.focus()}>${this.label}</label>`:V}
      <slot part="form-control-input" @slotchange=${this.syncOptions}></slot>
    </fieldset>`}static styles=E`
    :host {
      display: flex;
      flex-direction: column;
    }
    fieldset {
      border: 0;
      margin: 0;
      padding: 0;
      min-width: 0;
    }
    label {
      color: var(--wa-form-control-label-color, var(--primary-text-color));
      font-weight: var(--wa-form-control-label-font-weight, 400);
      line-height: var(--wa-form-control-label-line-height, 1.6);
      margin-block-end: 0.5em;
      display: inline-flex;
    }
    [part="form-control-input"] {
      display: flex;
      flex-flow: column wrap;
      gap: 0;
    }
    :host([orientation="horizontal"]) [part="form-control-input"] {
      flex-direction: row;
    }
    :host([hidden]) {
      display: none;
    }
  `},Jt=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;function Yt(e,t){if(e.includes(t))return!0;let n=Math.floor(t.length*.3);if(!n)return!1;let r=Array.from({length:t.length+1},(e,t)=>t);for(let i of e){let e=[0];for(let n=1;n<=t.length;n++)e[n]=Math.min(e[n-1]+1,r[n]+1,r[n-1]+(i===t[n-1]?0:1));if(e[t.length]<=n)return!0;r=e}return!1}function Xt(e,t,n=20){if(!Number.isFinite(n)||n<0||n>100||t!==`sensor`||e.attributes?.device_class!==`battery`||e.attributes?.unit_of_measurement!==`%`||typeof e.state!=`string`&&typeof e.state!=`number`)return!1;let r=String(e.state).trim();if(!Jt.test(r))return!1;let i=Number(r);return Number.isFinite(i)&&i>=0&&i<n}function Zt(e,t,n,r,i){if(typeof e?.entity_id!=`string`)return!1;let a=e.entity_id.split(`.`)[0];switch(t.filter){case`favorites`:if(!t.favorites.has(e.entity_id))return!1;break;case`unavailable`:case`unknown`:if(e.state!==t.filter)return!1;break;case`low_battery`:if(!Xt(e,a,t.threshold))return!1;break;case`updates`:if(a!==`update`||e.state!==`on`)return!1;break;case`all`:break;default:return!1}if(!n||`${e.entity_id} ${e.attributes?.friendly_name||``}`.toLocaleLowerCase().includes(n))return!0;let o=r.get(e),s=e.attributes?.friendly_name;return o&&o.friendlyName===s||(o={friendlyName:s,name:C(e,i).toLocaleLowerCase()},r.set(e,o)),o.name.includes(n)}var Qt={filter:`all`},$t=(e,t)=>t===void 0||(typeof t==`string`?t===e:t.includes(e??``));function en(e,t,n=``){return t.include_entities&&!t.include_entities.includes(e.value)||t.exclude_entities?.includes(e.value)?!1:e.value===n||!t.filter||(Array.isArray(t.filter)?t.filter:[t.filter]).some(t=>{let n=t.supported_features;return $t(e.value.split(`.`)[0],t.domain)&&$t(e.state.attributes.device_class,t.device_class)&&(!t.integration||t.integration===e.platform)&&(!n||(typeof n==`number`?[n]:n).some(t=>((e.state.attributes.supported_features??0)&t)===t))})}function tn(e,t,n=``,r){return e===n?!0:/^[\da-z_]+\.[\da-z_]+$/.test(e)?en(r??{value:e,label:e,secondary:``,icon:``,domain:e.split(`.`)[0],state:{entity_id:e,state:`unavailable`,attributes:{}}},t):!1}function nn(e){let t=[],n={},r,i=new Map,a=new WeakMap,o=0,s=e=>e.normalize(`NFD`).replace(/\p{M}/gu,``).toLocaleLowerCase();function c(){let i=e(),s=[i.states,i.entities,i.devices,i.areas,i.revision,i.hass?.formatEntityName,i.hass?.localize,i.hass?.language,JSON.stringify(i.hass?.locale)];return s.length===t.length&&s.every((e,n)=>e===t[n])?!1:(n=i,t=s,r=void 0,a=new WeakMap,o++,!0)}function l(){if(r)return r;let{states:e={},entities:t={},devices:a={},areas:o={},hass:s}=n;return r=[...new Set([...Object.keys(e),...Object.keys(t)])].map(n=>{let r=t[n],i=e[n]??{entity_id:n,state:`unavailable`,attributes:{friendly_name:r?.name||r?.original_name||void 0,icon:r?.icon||void 0,device_class:r?.device_class||r?.original_device_class||void 0}},c=r?.device_id?a[r.device_id]:void 0,l=r?.area_id||c?.area_id,u=[l?o[l]?.name:void 0,c?.name_by_user||c?.name].filter(Boolean).join(` ▸ `),d=r?.name||C(i,s);return{value:n,label:d===n?n.substring(n.indexOf(`.`)+1).replaceAll(`_`,` `):d,secondary:u,domain:s?.localize?.(`component.${n.split(`.`)[0]}.title`)||n.split(`.`)[0],icon:r?.icon||S(i),state:i,platform:r?.platform}}).sort((e,t)=>e.label.localeCompare(t.label,n.hass?.language)||e.value.localeCompare(t.value)),i=new Map(r.map(e=>[e.value,e])),r}return{refresh:c,get revision(){return o},get(e){return l(),i.get(e)},search(e,t,r=``){let i=s(e.trim()).split(/\s+/).filter(e=>e.length>=2),o=l().filter(e=>en(e,t,r)&&i.every(t=>Zt(e.state,Qt,t,a,n.hass)||Yt(s(`${e.label} ${e.secondary} ${e.value} ${e.domain}`),t))),c=o.findIndex(t=>t.value===e.trim());return c>0&&o.unshift(...o.splice(c,1)),o}}}var rn=3,an=6,on=class extends K{static properties={value:{attribute:!1},revision:{attribute:!1},label:{},helper:{},disabled:{type:Boolean,reflect:!0},required:{type:Boolean},clearLabel:{},optionLabel:{},noMatchLabel:{},addLabel:{},searchLabel:{},addButton:{type:Boolean},ariaLabel:{attribute:`aria-label`},ariaInvalid:{attribute:`aria-invalid`},ariaDescribedBy:{attribute:`aria-describedby`},ariaDescription:{attribute:`aria-description`},opened:{state:!0},editingText:{state:!0},active:{state:!0},start:{state:!0},visibleRows:{state:!0}};static shadowRootOptions={mode:`open`,delegatesFocus:!0};composing=!1;touchingOptions=!1;options=[];selectedId=``;listeners;observer;descriptionObserver;previousQuery=``;constructor(){super(),this.value=``,this.revision=0,this.label=``,this.helper=``,this.clearLabel=`Clear`,this.optionLabel=`Select option`,this.noMatchLabel=`No matches`,this.addLabel=`Add`,this.searchLabel=`Search`,this.addButton=!1,this.disabled=!1,this.required=!1,this.opened=!1,this.active=-1,this.start=0,this.visibleRows=an,this.addEventListener(`keydown`,this.navigate),this.addEventListener(`focusout`,this.handleBlur)}get multiple(){return!1}get usesPicker(){return!0}get rowHeight(){return 56}get topLabel(){return!0}get selectionName(){return this.getOption(this.current)?.label||this.current}get fieldIcon(){return this.getOption(this.current)?.icon}renderMultiple(){return V}get values(){return Array.isArray(this.value)?this.value:this.value?[this.value]:[]}get current(){return typeof this.value==`string`?this.value:``}get input(){return this.shadowRoot?.querySelector(`input`)}get popup(){return this.shadowRoot?.querySelector(`qap-dialog`)}get surface(){return this.shadowRoot?.querySelector(`.options`)}get trigger(){return this.shadowRoot?.querySelector(`.trigger`)}focus(e){let t=()=>{this.isConnected&&!this.disabled&&(this.multiple?this.shadowRoot?.querySelector(`.add-control`)?.focus(e):(this.opened?this.input:this.trigger)?.focus(e))};this.hasUpdated?t():this.updateComplete.then(t)}checkValidity(){return!this.required||(this.multiple?this.values.length>0:!!this.current)}reportValidity(){let e=this.checkValidity();return e||this.focus(),e}disconnectedCallback(){this.release(),this.descriptionObserver?.disconnect(),this.opened=!1,this.popup?.close(),super.disconnectedCallback()}release(){this.listeners?.abort(),this.listeners=void 0,this.observer?.disconnect(),this.observer=void 0}willUpdate(e){if(this.multiple){this.opened=!1;return}this.disabled&&(this.opened=!1);let t=this.editingText??``;if(this.opened&&(e.has(`opened`)||e.has(`editingText`)||e.has(`source`)||e.has(`revision`)||e.has(`selector`)||e.has(`value`))){this.options=this.searchOptions(t);let e=this.options.findIndex(e=>!e.disabled&&e.value===this.selectedId);t===this.previousQuery?this.active=e:(this.active=-1,this.surface&&(this.surface.scrollTop=0),this.start=0),this.previousQuery=t,this.selectedId=this.options[this.active]?.value??``,this.surface&&(this.surface.scrollTop=Math.min(this.surface.scrollTop,Math.max(0,this.options.length*this.rowHeight-this.surface.clientHeight)),this.syncStart()),this.active>=0&&(this.active<this.start||this.active>=this.start+this.visibleRows+6)&&(this.start=Math.max(0,this.active-rn))}}updated(e){if(e.has(`opened`)){this.release();let e=this.popup;if(this.opened&&e&&this.isConnected){this.position(),e.showModal(),this.listeners=new AbortController;let t={signal:this.listeners.signal};document.addEventListener(`pointerdown`,e=>{e.composedPath().includes(this)||this.close()},{...t,capture:!0}),window.addEventListener(`resize`,this.position,t),document.addEventListener(`scroll`,this.reposition,{...t,capture:!0,passive:!0}),window.visualViewport?.addEventListener(`resize`,this.position,t),window.visualViewport?.addEventListener(`scroll`,this.position,t),this.observer=new ResizeObserver(this.position),this.observer.observe(this),this.surface&&this.observer.observe(this.surface)}else e?.close()}this.opened&&(this.position(),(e.has(`revision`)||e.has(`source`)||e.has(`selector`)||e.has(`value`))&&this.revealActive());let t=this.getRootNode(),n=(this.ariaDescribedBy??``).split(/\s+/).flatMap(e=>{let n=t.getElementById(e);return n?[n]:[]});for(let e of[this.input,this.trigger])e&&`ariaDescribedByElements`in e&&(e.ariaDescribedByElements=n);if(this.descriptionObserver?.disconnect(),this.isConnected&&n.length){this.descriptionObserver??=new MutationObserver(()=>this.requestUpdate());for(let e of n)this.descriptionObserver.observe(e,{childList:!0,characterData:!0,subtree:!0})}}reposition=e=>{e.composedPath().includes(this.surface)||this.position()};position=()=>{let e=this.popup,t=this.trigger?.getBoundingClientRect();if(!this.opened||!e||!t)return;let n=window.visualViewport,r=n?.offsetLeft??0,i=n?.offsetTop??0,a=n?.width??innerWidth,o=n?.height??innerHeight,s=i+o-t.bottom-8,c=t.top-i-8,l=s<Math.min(this.rowHeight*3,c),u=Math.max(0,l?c:s),d=Math.min(Math.max(t.width,250),a-16),f=Math.min(u,o*.7,o<=1e3?400:500);e.style.setProperty(`--selector-width`,`${d}px`),e.style.setProperty(`--selector-height`,`${f}px`),e.style.setProperty(`--selector-left`,`${Math.max(r+8,Math.min(t.left,r+a-d-8))}px`),e.style.setProperty(`--selector-top`,`${l?Math.max(i+8,t.top-f):t.bottom}px`),e.style.setProperty(`--selector-origin`,l?`bottom`:`top`),this.visibleRows=Math.max(an,Math.ceil((this.surface?.clientHeight??0)/this.rowHeight))};open(){this.disabled||(this.opened=!0)}close(){this.composing||(this.opened=!1,this.editingText=void 0,this.active=-1,this.selectedId=``)}handleBlur=()=>{Promise.resolve().then(()=>{!this.shadowRoot?.activeElement&&!this.touchingOptions&&this.close()})};commit(e){this.disabled||this.composing||(!e||this.accepts(e))&&(this.editingText=void 0,(e??``)!==this.current&&(this.value=e,this.notifyValue(e)))}notifyValue(e){this.dispatchEvent(new CustomEvent(`value-changed`,{detail:{value:e},bubbles:!0,composed:!0})),this.dispatchEvent(new Event(`change`,{bubbles:!0,composed:!0}))}syncStart(){this.start=Math.max(0,Math.floor((this.surface?.scrollTop??0)/this.rowHeight)-rn)}selectOption(e){let t=this.options[e];t&&!t.disabled&&(this.commit(t.value),this.close(),this.trigger?.focus({preventScroll:!0}))}revealActive(){let e=this.surface;if(!e||this.active<0)return;let t=this.active*this.rowHeight;t<e.scrollTop?e.scrollTop=t:t+this.rowHeight>e.scrollTop+e.clientHeight&&(e.scrollTop=t+this.rowHeight-e.clientHeight),this.syncStart()}navigate=e=>{if(!this.usesPicker||this.multiple||this.disabled||this.composing||e.isComposing||e.defaultPrevented)return;if(e.key===`Escape`&&this.opened){e.preventDefault(),e.stopPropagation(),this.close();return}if(e.key===`Tab`)return;if((e.key===`Enter`||e.key===` `)&&!this.opened){e.preventDefault(),this.open();return}if(e.key===`Enter`&&this.opened){e.preventDefault(),e.stopPropagation(),this.active>=0?this.selectOption(this.active):(this.commit(this.editingText?.trim()??this.current),this.close());return}if(!this.opened&&e.key.length===1&&!e.ctrlKey&&!e.altKey&&!e.metaKey){e.preventDefault(),this.editingText=e.key,this.open();return}if(![`ArrowDown`,`ArrowUp`,`Home`,`End`].includes(e.key))return;e.preventDefault(),e.stopPropagation();let t=()=>{if(!this.options.length)return;let t=this.options.flatMap((e,t)=>e.disabled?[]:[t]);if(!t.length)return;let n=t.indexOf(this.active);if(e.key===`Home`)this.active=t[0];else if(e.key===`End`)this.active=t[t.length-1];else{let r=-1;e.key===`ArrowDown`?r=1:n<0&&(r=0),this.active=t[(n+r+t.length)%t.length]}this.selectedId=this.options[this.active].value,this.revealActive()};this.opened?t():(this.open(),this.updateComplete.then(t))};readInput(e){e.stopPropagation(),this.editingText=e.target.value,this.active=-1,this.selectedId=``,this.open()}get description(){let e=this.getRootNode();return[this.ariaDescription,this.helper,...(this.ariaDescribedBy??``).split(/\s+/).map(t=>e.getElementById(t)?.textContent)].filter(Boolean).join(` `)||V}render(){if(this.multiple)return this.renderMultiple();let e=this.getOption(this.current),t=Math.min(this.options.length,this.start+this.visibleRows+6),n;this.addButton?n=this.addLabel:(n=this.ariaLabel||this.label||this.optionLabel,this.current&&(n+=`: ${this.selectionName}`));let r=this.addButton?`mdi:playlist-plus`:this.fieldIcon;return z`${this.topLabel&&this.label&&this.current?z`<div class="top-label">${this.label}</div>`:V}
      <div class="field">
        <button
          class=${`trigger${this.addButton?` add`:``}`}
          part="base"
          ?disabled=${this.disabled}
          aria-label=${n}
          aria-haspopup="dialog"
          aria-expanded=${String(this.opened)}
          aria-controls="picker-dialog"
          aria-description=${this.description}
          aria-invalid=${this.ariaInvalid??V}
          @click=${this.open}
        >
          ${r?z`<ha-icon .icon=${r} aria-hidden="true"></ha-icon>`:V}
          <span class="text"
            >${!this.topLabel&&this.label&&this.current?z`<span class="overline">${this.label}</span>`:V}<span
              class=${this.current?`headline`:`placeholder`}
              >${this.addButton?this.addLabel:e?.label||this.current||this.label||this.optionLabel}</span
            >
            ${this.current&&e?.secondary?z`<span class="secondary">${e.secondary}</span>`:V}</span
          >
          ${this.addButton?V:z`<ha-icon class="arrow" icon="mdi:menu-down" aria-hidden="true"></ha-icon>`}
        </button>
        ${this.current&&!this.required?z`<button
                class="clear"
                aria-label=${`${this.clearLabel}: ${this.selectionName}`}
                ?disabled=${this.disabled}
                @click=${()=>{this.commit(void 0),this.close(),this.focus()}}
              >
                <ha-icon icon="mdi:close"></ha-icon>
              </button>`:V}
      </div>
      ${this.helper?z`<div id="hint">${this.helper}</div>`:V}
      <qap-dialog
        id="picker-dialog"
        adaptive
        flexcontent
        aria-label=${this.label||this.optionLabel}
        @cancel=${e=>{e.preventDefault(),e.stopPropagation(),this.close()}}
      >
        <div class="picker" @keydown=${this.navigate}>
          <div class="search-row">
            <div class="search">
              <ha-icon icon="mdi:magnify" aria-hidden="true"></ha-icon>
              <input
                part="input"
                .value=${this.editingText??``}
                ?disabled=${this.disabled}
                role="combobox"
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-expanded=${String(this.opened)}
                aria-controls="options"
                aria-activedescendant=${this.opened&&this.active>=0?`option-${this.active}`:V}
                aria-label=${this.searchLabel}
                aria-description=${this.description}
                placeholder=${this.searchLabel}
                aria-invalid=${this.ariaInvalid??V}
                autocomplete="off"
                autocapitalize="none"
                .spellcheck=${!1}
                @input=${this.readInput}
                @change=${e=>e.stopPropagation()}
                @compositionstart=${()=>{this.composing=!0}}
                @compositionend=${e=>{this.composing=!1,this.readInput(e)}}
              />
              <button
                class="search-clear"
                ?hidden=${!this.editingText}
                aria-label=${this.clearLabel}
                @click=${()=>{this.editingText=``,this.input?.focus()}}
              >
                <ha-icon icon="mdi:close"></ha-icon>
              </button>
            </div>
          </div>
          <div
            id="options"
            class="options"
            role="listbox"
            aria-label=${this.label||this.optionLabel}
            @pointerdown=${()=>{this.touchingOptions=!0}}
            @pointercancel=${()=>{this.touchingOptions=!1,this.handleBlur()}}
            @click=${()=>{this.touchingOptions=!1}}
            @scroll=${e=>{this.syncStart(),this.active>=0&&(this.active<this.start||this.active>=this.start+this.visibleRows+6)&&(this.active=-1,this.selectedId=``)}}
          >
            <div style=${`height:${this.start*this.rowHeight}px`} role="presentation"></div>
            ${this.options.slice(this.start,t).map((e,t)=>{let n=this.start+t;return z`<div
                id=${`option-${n}`}
                class=${`option${this.active===n?` active`:``}`}
                role="option"
                aria-selected=${String(e.value===this.current)}
                aria-disabled=${String(!!e.disabled)}
                aria-setsize=${this.options.length}
                aria-posinset=${n+1}
                aria-label=${`${e.label}, ${e.value}${e.secondary?`, ${e.secondary}`:``}`}
                @pointerdown=${e=>{e.pointerType===`mouse`&&e.preventDefault()}}
                @click=${()=>this.selectOption(n)}
              >
                ${e.icon?z`<ha-icon .icon=${e.icon} aria-hidden="true"></ha-icon>`:V}
                <div class="text">
                  <div class="headline">${e.label}</div>
                  <div class="secondary">${e.secondary}</div>
                </div>
                <div class="domain">${e.domain}</div>
              </div>`})}
            <div
              style=${`height:${Math.max(0,this.options.length-t)*this.rowHeight}px`}
              role="presentation"
            ></div>
            ${this.options.length?V:z`<div class="empty-option" role="status">${this.noMatchLabel}</div>`}
            ${this.editingText&&this.accepts(this.editingText.trim())&&!this.options.some(e=>e.value===this.editingText?.trim())?z`<button
                    class="custom"
                    @click=${()=>{this.commit(this.editingText?.trim()),this.close()}}
                  >
                    ${this.editingText.trim()}
                  </button>`:V}
          </div>
        </div></qap-dialog
      >`}static styles=E`
    :host {
      display: block;
      width: 100%;
      min-width: 0;
      font: inherit;
      color: var(--primary-text-color, #212121);
    }
    :host([hidden]) {
      display: none;
    }
    .field {
      position: relative;
    }
    button {
      font: inherit;
      cursor: pointer;
    }
    .trigger {
      font-family: var(--ha-font-family-body, Roboto, Noto, sans-serif);
    }
    .trigger {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: var(--ha-space-2, 8px);
      width: 100%;
      min-width: 0;
      height: 56px;
      padding: 0 var(--ha-space-2, 8px) 0 var(--ha-space-4, 16px);
      border: 0;
      border-radius: var(--ha-border-radius-sm, 4px) var(--ha-border-radius-sm, 4px) 0 0;
      background: var(--ha-color-form-background, var(--input-fill-color, #f5f5f5));
      color: var(--primary-text-color);
      text-align: start;
    }
    .trigger:not(.add)::after {
      content: "";
      position: absolute;
      bottom: 0;
      inset-inline: 0;
      height: 1px;
      background: var(
        --ha-color-border-neutral-loud,
        var(--input-idle-line-color, var(--divider-color, #999))
      );
    }
    .trigger:focus {
      outline: 0;
    }
    .trigger:focus::after {
      height: 2px;
      background: var(--primary-color);
    }
    .trigger[aria-invalid="true"]::after {
      height: 2px;
      background: var(--error-color);
    }
    .trigger:disabled {
      background: var(--ha-color-form-background-disabled, var(--input-fill-color));
      opacity: 0.5;
      cursor: not-allowed;
    }
    .trigger > ha-icon {
      width: 32px;
      flex: none;
      color: var(--secondary-text-color);
    }
    .trigger .arrow {
      --mdc-icon-size: 20px;
      width: 32px;
    }
    .trigger:has(+ .clear) .text {
      margin-inline-end: 24px;
    }
    .placeholder {
      font-size: var(--ha-font-size-m, 14px);
      line-height: var(--ha-line-height-normal, 1.6);
      color: var(--secondary-text-color);
    }
    .clear,
    .search-clear {
      display: grid;
      place-items: center;
      border: 0;
      background: none;
      color: var(--secondary-text-color);
      padding: 4px;
      width: 32px;
      height: 32px;
    }
    .clear {
      position: absolute;
      top: 12px;
      inset-inline-end: 40px;
    }
    .clear:focus-visible,
    .search-clear:focus-visible {
      outline: 2px solid var(--primary-color);
      border-radius: 50%;
    }
    ha-icon {
      --mdc-icon-size: 24px;
    }
    .top-label,
    .multiple-label {
      display: block;
      margin: 0 0 8px;
      font: inherit;
    }
    qap-entity-selector {
      margin-top: 8px;
    }
    .add {
      width: fit-content;
      height: var(--ha-space-8, 32px);
      padding: 0 var(--ha-space-3, 12px);
      border-radius: var(--ha-border-radius-md, 8px);
      background: var(--ha-color-fill-primary-normal-resting, var(--secondary-background-color));
      color: var(--ha-color-on-primary-normal, var(--primary-color));
    }
    .add .placeholder,
    .add > ha-icon {
      color: inherit;
    }
    .add > ha-icon {
      width: 18px;
      --mdc-icon-size: 18px;
    }
    #hint {
      margin: 8px 0 0;
      font-size: var(--ha-font-size-s, 12px);
      color: var(--secondary-text-color);
    }
    qap-dialog {
      --ha-bottom-sheet-height: calc(100dvh - var(--ha-space-12, 48px));
      --ha-bottom-sheet-max-height: var(--ha-bottom-sheet-height);
      --ha-bottom-sheet-max-width: 600px;
      --ha-bottom-sheet-surface-background: var(--card-background-color);
      --ha-bottom-sheet-border-radius: var(--ha-border-radius-2xl, 16px);
    }
    qap-dialog::part(base) {
      box-shadow: var(--ha-box-shadow-m, 0 4px 8px rgb(0 0 0 / 0.2));
    }
    qap-dialog::part(body) {
      overflow: hidden;
    }
    .picker {
      min-height: 0;
      height: 100%;
      display: flex;
      flex-direction: column;
      font: inherit;
      font-family: var(--ha-font-family-body, Roboto, Noto, sans-serif);
    }
    .search-row {
      padding: 16px 16px 12px;
      flex: none;
    }
    .search {
      box-sizing: border-box;
      height: 40px;
      display: flex;
      align-items: center;
      gap: 0;
      padding: 0 8px;
      border: 1px solid var(--ha-color-border-neutral-quiet, var(--divider-color, #ddd));
      border-radius: var(--ha-border-radius-md, 8px);
    }
    .search:focus-within {
      border-color: var(--primary-color, #03a9f4);
    }
    .search > ha-icon {
      --mdc-icon-size: 18px;
      color: var(--primary-text-color);
    }
    input {
      box-sizing: border-box;
      flex: 1;
      width: 100%;
      min-width: 0;
      height: 38px;
      padding: 0 0 0 4px;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--primary-text-color);
      font: inherit;
      font-family: var(--ha-font-family-body, inherit);
      font-size: var(--ha-font-size-m, 14px);
    }
    .search-clear[hidden] {
      display: none;
    }
    .options {
      min-height: 0;
      flex: 1;
      overflow: auto;
      overscroll-behavior: contain;
      overflow-anchor: none;
    }
    .option {
      box-sizing: border-box;
      height: 56px;
      padding: 8px 16px;
      display: flex;
      align-items: center;
      gap: 16px;
      cursor: pointer;
      border-top: 1px solid var(--divider-color, #ddd);
      color: var(--primary-text-color);
    }
    .option:nth-child(2) {
      border-top: 0;
    }
    .option > ha-icon {
      width: 32px;
      flex: none;
      color: var(--secondary-text-color);
    }
    .text {
      min-width: 0;
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .text > * {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .headline {
      font-size: var(--ha-font-size-m, 14px);
      line-height: 22px;
    }
    .secondary {
      font-size: var(--ha-font-size-s, 12px);
      line-height: 18px;
      color: var(--secondary-text-color);
    }
    .domain {
      max-width: 30%;
      flex: none;
      align-self: flex-end;
      padding-bottom: 8px;
      font-size: 12px;
      line-height: 18px;
      color: var(--secondary-text-color);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .option.active {
      background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.12);
    }
    .option[aria-selected="true"] {
      background: var(
        --ha-color-fill-primary-quiet-resting,
        rgba(var(--rgb-primary-color, 3, 169, 244), 0.06)
      );
    }
    .option.active[aria-selected="true"] {
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.24);
    }
    .empty-option {
      padding: 16px;
      font-size: 14px;
    }
    .custom {
      width: 100%;
      min-height: 48px;
      padding: 8px 16px;
      border: 0;
      text-align: start;
      background: transparent;
      color: var(--primary-color);
    }
    @media (min-width: 871px) and (min-height: 501px) {
      qap-dialog {
        --mdc-dialog-scrim-color: transparent;
        --ha-dialog-scrim-backdrop-filter: none;
      }
      qap-dialog::part(base) {
        inset: var(--selector-top) auto auto var(--selector-left);
        margin: 0;
        padding: 0;
        width: var(--selector-width);
        max-width: calc(100vw - 16px);
        height: auto;
        max-height: var(--selector-height);
        border-radius: var(--ha-border-radius-md, 8px);
        animation: none;
      }
      qap-dialog::part(base)::backdrop {
        background: transparent;
        backdrop-filter: none;
      }
      .picker {
        max-height: var(--selector-height);
      }
    }
    @media (pointer: coarse) {
      input {
        font-size: 16px;
      }
    }
    @media (hover: hover) {
      .option:hover {
        background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08);
      }
    }
  `},sn=class e extends on{static properties={selector:{attribute:!1},source:{attribute:!1},entityLabel:{}};constructor(){super(),this.selector={entity:{}},this.entityLabel=`Entity`,this.noMatchLabel=`No matching entities`,this.addLabel=`Add entity`,this.searchLabel=`Search entities`}get multiple(){return!!this.selector.entity.multiple}searchOptions(e){return this.source?.search(e,this.selector.entity,this.current)??[]}getOption(e){return this.source?.get(e)}get fieldIcon(){return this.current?this.getOption(this.current)?.icon||`mdi:shape`:void 0}get selectionName(){let e=this.getOption(this.current);return e?`${e.label} (${this.current})`:this.current}accepts(e,t=this.current){return tn(e,this.selector.entity,t,this.source?.get(e))}willUpdate(e){if(this.optionLabel=this.entityLabel,e.has(`selector`)||e.has(`value`)){let t=e.get(`selector`),n=this.value,r=this.values,i;i=this.multiple?Array.isArray(n)&&n.every(Boolean)?n:r:Array.isArray(n)?r.find(Boolean):n,i!==n&&(this.value=i,t&&!!t.entity.multiple!==this.multiple&&n!=null&&this.dispatchEvent(new CustomEvent(`value-changed`,{detail:{value:this.value},bubbles:!0,composed:!0})))}super.willUpdate(e)}get values(){return super.values.filter(Boolean)}updateRow(t,n){if(n.stopPropagation(),this.disabled)return;let r=n.detail.value,i=this.values;if(t<i.length&&r===i[t])return;if(r&&!this.accepts(r,i[t]??``)){n.currentTarget instanceof e&&(n.currentTarget.value=i[t]??``);return}let a=i;if(t===i.length?r&&!i.includes(r)&&(a=[...i,r]):a=!r||i.some((e,n)=>n!==t&&e===r)?i.filter((e,n)=>n!==t):i.map((e,n)=>n===t?r:e),a===i)return;this.value=a,this.dispatchEvent(new CustomEvent(`value-changed`,{detail:{value:a},bubbles:!0,composed:!0}));let o=n.currentTarget;if(o instanceof e&&(o.value=this.values[t]??``),t===i.length||!r){let n=()=>{this.updateComplete.then(()=>{if(!this.isConnected||this.disabled)return;let e=this.shadowRoot?.querySelectorAll(`qap-entity-selector`);e?.[t===i.length?e.length-1:Math.min(t,e.length-1)]?.focus({preventScroll:!0})})};o instanceof e&&o.popup?.open?o.popup.addEventListener(`closed`,n,{once:!0}):n()}}renderMultiple(){let e=this.values,t=this.selector.entity;return z`${this.label?z`<div class="multiple-label">${this.label}</div>`:V}
    ${[...e,``].map((n,r)=>z`<qap-entity-selector
          class=${r===e.length?`add-control`:``}
          .value=${n}
          .label=${``}
          .source=${this.source}
          .revision=${this.revision}
          .addButton=${r===e.length&&e.length>0}
          .addLabel=${this.addLabel}
          .searchLabel=${this.searchLabel}
          .selector=${{entity:{...t,multiple:!1,exclude_entities:r===e.length?[...t.exclude_entities??[],...e]:t.exclude_entities}}}
          .required=${this.required&&!e.length}
          .disabled=${this.disabled}
          .clearLabel=${this.clearLabel}
          .noMatchLabel=${this.noMatchLabel}
          .helper=${r===e.length?this.helper:``}
          aria-label=${this.ariaLabel||this.label||this.entityLabel}
          aria-invalid=${this.ariaInvalid??V}
          .ariaDescription=${this.description===V?null:this.description}
          @value-changed=${e=>this.updateRow(r,e)}
          @change=${e=>e.stopPropagation()}
        ></qap-entity-selector>`)}`}},cn=class extends on{static properties={selector:{attribute:!1}};constructor(){super(),this.selector={select:{options:[],mode:`dropdown`}}}get multiple(){return!!this.selector.select.multiple}get rowHeight(){return 48}get topLabel(){return!1}get plainSelect(){return!this.multiple&&!this.selector.select.custom_value&&!this.addButton}get usesPicker(){return!this.plainSelect}get selectOptions(){return this.selector.select.options.map(e=>typeof e==`string`?{value:e,label:e}:e)}getOption(e){return e?{value:e,label:e}:void 0}searchOptions(e){let t=e=>e.normalize(`NFD`).replace(/\p{M}/gu,``).toLocaleLowerCase(),n=t(e.trim()).split(/\s+/).filter(e=>e.length>=2);return this.selectOptions.filter(e=>n.every(n=>Yt(t(`${e.label} ${e.value}`),n)))}accepts(e){let t=this.selectOptions.find(t=>t.value===e);return t?!t.disabled:!!(e&&this.selector.select.custom_value)}checkValidity(){return this.disabled||super.checkValidity()}focus(e){this.plainSelect?this.updateComplete.then(()=>{this.isConnected&&!this.disabled&&this.shadowRoot?.querySelector(`qap-select`)?.focus(e)}):super.focus(e)}updated(e){this.popup?.addEventListener(`opened`,this.retainPickerHeight),this.popup?.addEventListener(`closed`,this.clearPickerHeight),super.updated(e)}retainPickerHeight=()=>{let e=this.shadowRoot?.querySelector(`.picker`)?.offsetHeight??0;this.style.setProperty(`--selector-min-height`,`${e}px`)};clearPickerHeight=()=>{this.style.removeProperty(`--selector-min-height`)};notifyValue(e){this.dispatchEvent(new CustomEvent(`value-changed`,{detail:{value:e},bubbles:!0,composed:!0})),this.dispatchEvent(new Event(`input`,{bubbles:!0,composed:!0})),this.dispatchEvent(new Event(`change`,{bubbles:!0,composed:!0}))}addValue(e){e.stopPropagation();let t=e.currentTarget,n=e.detail.value;!this.disabled&&n&&this.accepts(n)&&!this.values.includes(n)&&(this.value=[...this.values,n],this.notifyValue(this.value)),t.value=``;let r=()=>this.focus({preventScroll:!0});t.popup?.open?t.popup.addEventListener(`closed`,r,{once:!0}):this.updateComplete.then(r)}removeValue(e){this.disabled||(this.value=this.values.filter(t=>t!==e),this.notifyValue(this.value),this.updateComplete.then(()=>this.focus({preventScroll:!0})))}renderMultiple(){return z`${this.values.length?z`<div class="chips" role="group" aria-label=${this.ariaLabel||this.label}>
              ${this.values.map(e=>{let t=this.selectOptions.find(t=>t.value===e)?.label||e;return z`<div class="chip">
                  <qap-chip .disabled=${this.disabled}>${t}</qap-chip>
                  <button
                    class="remove"
                    aria-label=${`${this.clearLabel}: ${t}`}
                    ?disabled=${this.disabled}
                    @click=${()=>this.removeValue(e)}
                  >
                    <ha-icon icon="mdi:close" aria-hidden="true"></ha-icon>
                  </button>
                </div>`})}
            </div>`:V}
      <qap-select-selector
        class="add-control"
        .value=${``}
        .selector=${{select:{...this.selector.select,multiple:!1,options:this.selectOptions.filter(e=>!this.values.includes(e.value))}}}
        .label=${this.label}
        .helper=${this.helper}
        .addButton=${!0}
        .addLabel=${this.label||this.addLabel}
        .searchLabel=${this.searchLabel}
        .noMatchLabel=${this.noMatchLabel}
        .clearLabel=${this.clearLabel}
        .required=${this.required&&!this.values.length}
        .disabled=${this.disabled}
        aria-label=${this.ariaLabel||this.label}
        aria-invalid=${this.ariaInvalid??V}
        .ariaDescription=${this.description===V?null:this.description}
        @value-changed=${this.addValue}
        @input=${e=>e.stopPropagation()}
        @change=${e=>e.stopPropagation()}
      ></qap-select-selector>`}render(){if(!this.plainSelect)return super.render();let e=this.selectOptions;return this.current&&!e.some(e=>e.value===this.current)&&e.push({value:this.current,label:this.current}),z`<qap-select
        .options=${e}
        .value=${this.current}
        .label=${this.label}
        .disabled=${this.disabled}
        .required=${this.required}
        aria-label=${this.ariaLabel||this.label}
        aria-invalid=${this.ariaInvalid??V}
        .ariaDescribedBy=${this.ariaDescribedBy}
        .hint=${this.description===V?``:this.description}
        @input=${e=>e.stopPropagation()}
        @change=${e=>{e.stopPropagation(),this.commit(e.currentTarget.value)}}
      ></qap-select>
      ${this.helper?z`<div id="hint">${this.helper}</div>`:V}`}static styles=[on.styles,E`
      .overline {
        font-size: calc(var(--mdc-typography-subtitle1-font-size, 1rem) * 0.75);
        line-height: 1.15rem;
        font-weight: var(--mdc-typography-subtitle1-font-weight, 400);
        font-family: var(
          --mdc-typography-subtitle1-font-family,
          var(--mdc-typography-font-family, inherit)
        );
        color: var(--mdc-select-label-ink-color, #0009);
      }
      .headline {
        line-height: var(--ha-line-height-normal, 1.6);
      }
      .option {
        height: 48px;
        border: 0;
        padding: 0 16px;
      }
      .option .secondary,
      .option .domain {
        display: none;
      }
      .option[aria-disabled="true"] {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--ha-space-2, 8px);
        padding: 8px 0;
        font-family: var(--ha-font-family-body, Roboto, Noto, sans-serif);
      }
      .chip {
        display: inline-flex;
        position: relative;
        max-width: 100%;
      }
      qap-chip {
        --ha-button-border-radius: 16px;
        --ha-chip-container-color: var(
          --md-input-chip-selected-container-color,
          rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.15)
        );
        --ha-chip-outline-width: 0px;
        max-width: 100%;
      }
      qap-chip::part(base) {
        padding-inline: var(--ha-space-4, 16px)
          calc(var(--ha-chip-icon-size, 18px) + 2 * var(--ha-space-2, 8px));
      }
      qap-chip::part(label) {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .remove {
        position: absolute;
        inset-inline-end: 0;
        top: 0;
        display: grid;
        place-items: center;
        width: calc(var(--ha-chip-icon-size, 18px) + 2 * var(--ha-space-2, 8px));
        height: 32px;
        padding: 0;
        border: 0;
        border-radius: 16px;
        border-start-start-radius: 0;
        border-end-start-radius: 0;
        background: transparent;
        color: var(--primary-text-color);
      }
      .remove::after {
        content: "";
        position: absolute;
        inset: -8px 0;
      }
      .remove ha-icon {
        --mdc-icon-size: 18px;
      }
      .remove:focus-visible {
        outline: 2px solid var(--primary-color);
      }
      .remove:disabled {
        opacity: 0.38;
        cursor: not-allowed;
      }
      qap-dialog[open]::part(base) {
        animation: select-sheet-show 300ms ease;
      }
      qap-dialog:not([open])::part(base) {
        animation: select-sheet-hide 300ms ease forwards;
      }
      @media (min-width: 871px) and (min-height: 501px) {
        qap-dialog::part(base) {
          border: var(--wa-panel-border-width, 1px) solid
            var(
              --wa-color-surface-border,
              var(--ha-color-border-neutral-quiet, var(--divider-color, #ddd))
            );
        }
        qap-dialog[open]::part(base) {
          transform-origin: var(--selector-origin, top);
          animation: select-popup-show var(--show-duration, 100ms) ease;
        }
        qap-dialog:not([open])::part(base) {
          transform-origin: var(--selector-origin, top);
          animation: select-popup-hide var(--hide-duration, 100ms) ease forwards;
        }
        .picker {
          min-height: min(
            var(--selector-min-height, 0px),
            calc(var(--selector-height) - 2 * var(--wa-panel-border-width, 1px))
          );
        }
      }
      @keyframes select-popup-show {
        from {
          opacity: 0;
          scale: 0.8;
        }
        to {
          opacity: 1;
          scale: 1;
        }
      }
      @keyframes select-popup-hide {
        to {
          opacity: 0;
          scale: 0.8;
        }
      }
      @keyframes select-sheet-show {
        from {
          opacity: 0;
          translate: 0 100%;
        }
        to {
          opacity: 1;
          translate: 0 0;
        }
      }
      @keyframes select-sheet-hide {
        to {
          opacity: 0;
          translate: 0 100%;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        qap-dialog::part(base) {
          animation-duration: 0s;
        }
      }
    `]},ln=class extends K{static properties={announcement:{type:String,attribute:!1}};constructor(){super(),this.announcement=``}render(){return z`<slot></slot
      ><span role="status" aria-live="polite" aria-atomic="true">${this.announcement}</span>`}static styles=E`
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
  `};function un(){let e={"qap-button":q,"qap-icon-button":nt,"qap-input":J,"qap-select":rt,"qap-checkbox":it,"qap-alert":ot,"qap-dialog":ft,"qap-icon":gt,"qap-state-icon":Lt,"qap-icon-picker":_t,"qap-search":Rt,"qap-chip":zt,"qap-tooltip":Bt,"qap-list":Vt,"qap-list-item":Z,"qap-menu":Wt,"qap-menu-item":Ut,"qap-toast":Kt,"qap-radio-group":Q,"qap-radio-option":qt,"qap-entity-selector":sn,"qap-select-selector":cn,"qap-sortable":ln};for(let[t,n]of Object.entries(e))customElements.get(t)||customElements.define(t,n)}var dn={"sorting.keyboard_help_grid":`Tap a card or press Enter to edit it. Hold a card to drag and arrange. Use Alt and Left or Right to move one position; Alt and Up or Down to move one row. Escape cancels a drag.`,"sorting.position":`{name}. Position {position} of {count}.`,"grid.show_names":`Show names`,"grid.decrease_columns":`Decrease columns`,"grid.increase_columns":`Increase columns`,"grid.decrease_rows":`Decrease rows`,"grid.increase_rows":`Increase rows`,"grid.columns":`Columns`,"grid.rows":`Rows`,"grid.invalid_dimension":`Enter a whole number from 1 to {limit}.`,"grid.arrange":`Arrange shortcuts`,"grid.layout":`Grid layout`,"grid.page":`Page`,"grid.empty":`No enabled shortcuts in this group. Add or enable shortcuts in Shortcuts settings.`,"grid.empty_unsaved":`No enabled shortcuts in this group. Save the group first, then add shortcuts to it.`,"grid.disabled_shortcuts":`Disabled shortcuts ({count})`,"shortcuts.saved_filter":`Saved filter`,"shortcuts.scene":`Scene`,"shortcuts.no_scenes":`No scenes are available.`,"shortcuts.scene_unavailable":`Scene unavailable. Choose an available scene.`,"shortcuts.scene_activation_failed":`Could not activate the scene. Try again.`,"shortcuts.filter_type":`Filter type`,"shortcuts.filter":`Filter`,"shortcuts.active_filters":`Active filters`,"shortcuts.hidden_filters":`Hidden filters`,"shortcuts.no_filters":`No saved filters are available. Enable a built-in filter or create one in Entities or Devices.`,"shortcuts.filter_unavailable":`Saved filter unavailable`,"shortcuts.filter_unavailable_description":`This shortcut's filter could not be found in this profile. Edit the shortcut to choose an available filter.`,"filters.delete_linked":`Delete filter and linked shortcuts`,"filters.delete_linked_confirmation":{one:`Deleting this filter will also delete {count} linked shortcut: {names}.`,other:`Deleting this filter will also delete {count} linked shortcuts: {names}.`},"filters.delete_linked_confirmation_more":{one:`Deleting this filter will also delete {count} linked shortcut: {names}, and {remaining} more.`,other:`Deleting this filter will also delete {count} linked shortcuts: {names}, and {remaining} more.`},"shortcuts.search":`Search shortcuts across groups...`,"shortcuts.no_matches":`No matching shortcuts`,"shortcuts.limit":`Shortcut limit reached ({limit} per profile). Remove an existing shortcut before adding another.`,"shortcuts.pages":`Shortcut pages`,"shortcuts.previous_page":`Previous page`,"shortcuts.next_page":`Next page`,"shortcuts.page":`Page {page} of {pages}`,"settings.active_profile":`Active profile`,"settings.manage_profiles":`Manage or switch profiles`,"settings.profile_configuration":`Profile configuration`,"settings.shortcuts":`Shortcuts`,"settings.categories":`Groups`,"settings.visibility":`Display rules`,"settings.category_count":{one:`{count} group`,other:`{count} groups`},"settings.shown_everywhere":`Shown on all pages`,"settings.hidden_everywhere":`Hidden on all pages`,"settings.shown_routes":{one:`Shown only on {count} page`,other:`Shown only on {count} pages`},"settings.hidden_routes":{one:`Hidden on {count} page`,other:`Hidden on {count} pages`},"settings.confirm_discard":`Discard unsaved Quick Access settings changes?`,"categories.add":`Create group`,"categories.add_new":`Add new group...`,"categories.category":`Group`,"categories.confirm_delete":`Delete group?`,"categories.delete_contents":`"{name}" contains {count} shortcuts, including {disabled} disabled. Choose what happens to these shortcuts.`,"categories.delete_empty":`Delete empty group "{name}"?`,"categories.delete_behavior":`Shortcuts in this group`,"categories.move_shortcuts":`Move shortcuts to another group (recommended)`,"categories.delete_shortcuts":`Delete group and all its shortcuts`,"categories.move_destination":`Move shortcuts to`,"categories.delete_action":`Delete group`,"categories.delete_shortcuts_action":`Delete group and shortcuts`,"categories.delete_scope":`Only Quick Access shortcuts are removed. Home Assistant entities, devices, automations, scenes, dashboards and saved filters are kept.`,"categories.deleted":`This group no longer exists. Cancel and reload saved profiles.`,"categories.duplicate_name":`A group with this name already exists.`,"categories.invalid_name":`Enter a group name of 1–{limit} characters without control characters.`,"categories.manage_named":`Manage {name}`,"categories.name":`Group name`,"categories.protected_name":`Favorites cannot be renamed.`,"categories.edit":`Edit group`,"categories.title":`Shortcut groups`,"clipboard.blocked":`The browser blocked automatic copying. Select the text below, then use Copy.`,"clipboard.copy_manually":`Copy manually`,"clipboard.manual":`Manual copy`,"clipboard.select":`Select text`,"clipboard.text":`Text to copy`,"common.all":`All`,"common.back":`Back`,"common.add":`Add`,"common.remove":`Remove`,"common.discard":`Discard`,"common.discard_changes":`Discard changes?`,"common.cancel":`Cancel`,"common.clear":`Clear`,"common.close":`Close`,"common.close_confirmation":`Close confirmation`,"common.copied":`Copied to clipboard`,"common.copy":`Copy to clipboard`,"common.enable":`Enable`,"common.disable":`Disable`,"common.duplicate":`Duplicate`,"common.move_up":`Move up`,"common.move_down":`Move down`,"common.default":`Default`,"common.set_default":`Set default`,"common.recent_searches":`Recent searches`,"common.add_favorite":`Add to favorites`,"common.remove_favorite":`Remove from favorites`,"common.icon":`Icon`,"common.delete":`Delete`,"common.favorites":`Favorites`,"common.learn_more":`Learn more`,"common.name":`Name`,"common.reload":`Reload`,"common.save":`Save`,"common.search":`Search`,"common.settings":`Settings`,"common.total":`{count} total`,"common.unavailable":`Unavailable`,"config.confirm_remove_selection":`Remove profile selection from this browser?`,"config.confirm_reset_visibility":`Reset display rules for selected profile?`,"config.open_sidebar":`Open sidebar`,"config.current_device":`This browser`,"config.show_floating_launcher":`Show floating launcher`,"config.errors.launcher_read_failed":`Could not read this browser's launcher preference. Check site storage and retry.`,"config.device.description":`Profile selection, button position and recent searches are local to this browser, Home Assistant address (local or VPN) and signed-in user. LAN and Nabu Casa addresses keep separate settings.`,"config.errors.disconnected":`Home Assistant is disconnected. Reconnect to load profiles.`,"config.errors.instance_changed":`Home Assistant instance changed. Reload this page before selecting a profile.`,"config.errors.invalid_profiles":`Invalid profile data received. Refresh profiles before retrying.`,"config.no_selection":`No profile selected in this browser`,"config.errors.profile_unavailable":`This profile is unavailable. Refresh profiles and choose again.`,"config.errors.profiles_disconnected":`Home Assistant is disconnected. Reconnect and refresh profiles.`,"config.errors.profiles_failed":`Could not load profiles. Reconnect and refresh profiles.`,"config.refresh_profiles":`Refresh profiles`,"config.errors.refresh_selection":`The selected profile was deleted or is unavailable. Refresh profiles and choose again.`,"config.remove_description":`The profile and its saved data will remain in Home Assistant. Use Setup to choose or create a profile again.`,"config.remove_device_selection":`Remove profile selection from this browser`,"config.remove_selection":`Remove selection`,"config.reset_description":`This will make Quick Access available on all pages for this profile. The change will sync to other devices using the same profile. Shortcuts, groups, favorites and other settings will be preserved.`,"config.errors.reset_disconnected":`Home Assistant is disconnected. Reconnect before resetting display rules.`,"config.errors.reset_failed":`Could not reset display rules. Refresh profiles and retry.`,"config.recovery.sync_info":`Removing the selection keeps all profiles and saved data in Home Assistant. Resetting display rules affects only the selected profile, syncs to devices using it and preserves all other settings.`,"config.reset_profile_visibility":`Reset display rules for selected profile`,"config.reset_visibility":`Reset display rules`,"config.select_profile":`Select an existing saved profile`,"config.selected_profile":`Selected profile: {name}`,"config.errors.selection_changed":`This browser's profile selection changed. Review the selected profile and try again.`,"config.errors.selection_save_failed":`Could not save this browser's profile selection. Check site storage and retry.`,"config.errors.selection_unavailable":`The selected profile was deleted or is unavailable. Choose an existing saved profile.`,"defaults.quick-devices":`Device Explorer`,"devices.title":`Device Explorer`,"devices.search":`Search devices...`,"devices.filters":`Device filters`,"devices.with_area":`With area`,"devices.without_area":`Without area`,"devices.current_states":`Device registry`,"devices.no_area":`No area`,"devices.count":{one:`{count} device`,other:`{count} devices`},"devices.no_matches":`No matching devices`,"devices.load_failed":`Could not load device or area registry data. Retrying…`,"devices.details":`Device details`,"devices.view_details":`View device details for {id}`,"devices.copy_id":`Copy device ID`,"devices.state":`Area`,"devices.manufacturer":`Manufacturer`,"devices.model":`Model`,"devices.sw_version":`Software version`,"devices.labels":`Labels`,"devices.attributes":`Device attributes`,"devices.attributes_label":`Device registry attributes`,"devices.more_info":`Open device in Home Assistant`,"devices.recent_searches_label":`Recent device searches`,"defaults.quick-states":`Entity Explorer`,"entities.attributes":`Attributes`,"entities.entity":`Entity`,"entities.add":`Add entity`,"entities.attributes_label":`Entity attributes`,"entities.copy_id":`Copy entity ID`,"entities.copy_state":`Copy state`,"entities.count":{one:`{count} entity`,other:`{count} entities`},"entities.current_states":`Current states`,"entities.details":`Entity details`,"entities.filters":`Entity filters`,"entities.last_changed":`Last changed`,"entities.last_updated":`Last updated`,"entities.labels":`Labels`,"entities.device_class":`Device class`,"entities.low_battery":`Low battery`,"entities.more_info":`Show more information`,"entities.no_matches":`No matching entities`,"entities.recent_searches_label":`Recent entity searches`,"entities.search":`Search entities...`,"entities.state":`State`,"entities.title":`Entity Explorer`,"entities.unavailable":`Unavailable`,"entities.unknown":`Unknown`,"entities.updates":`Updates`,"entities.view_details":`View details for {id}`,"errors.browser_storage":`Could not save changes in this browser. Check that site storage is enabled and has enough space.`,"errors.server_save":`Could not save changes on the server. Keep your draft and retry.`,"fab.description":`Enter or Space opens Quick Access. Shift+Enter, Shift+Space, or Shift+F10 opens the positioning menu. Choose Move button to position with arrow keys; Escape closes the menu.`,"fab.hold_to_move":`Quick Access (hold to move)`,"fab.move_button":`Move button`,"fab.move_description":`Positioning Quick Access. Arrow keys move by 10 pixels; Shift+Arrow keys move by 40 pixels. Enter saves the position. Escape cancels and restores the previous position.`,"fab.open":`Open Quick Access`,"fab.reload_page":`Reload page`,"fab.reset_position":`Reset position`,"fab.setup":`Set up Quick Access`,"launcher.title":`Quick Access`,"limits.categories_admin":`Group limit reached. Delete an existing group. An administrator can increase limits in Settings → Devices & services → Quick Access → Configure.`,"limits.categories_user":`Group limit reached. Delete an existing group. Contact your Home Assistant administrator to increase the limit.`,"limits.profiles_admin":`Profile limit reached. Delete an existing profile. An administrator can increase limits in Settings → Devices & services → Quick Access → Configure.`,"limits.profiles_user":`Profile limit reached. Delete an existing profile. Contact your Home Assistant administrator to increase the limit.`,"limits.storage_admin":`Storage limit reached. Remove unused data. An administrator can increase limits in Settings → Devices & services → Quick Access → Configure.`,"limits.storage_user":`Storage limit reached. Remove unused data. Contact your Home Assistant administrator to increase the limit.`,"profiles.close_create":`Close create profile`,"profiles.close_duplicate":`Close duplicate profile`,"profiles.close_edit":`Close edit profile`,"profiles.confirm_reload":`Discard draft and reload?`,"profiles.errors.conflict":`Profiles changed on another device. Your draft is preserved. Reload saved profiles before retrying.`,"profiles.copy_description":`The copy includes all saved profile contents and is independent of the original.`,"profiles.copy_existing":`Copy from an existing profile`,"profiles.copy_from":`Copy from`,"profiles.copy_independent":`Start with an independent copy of a saved profile.`,"profiles.copy_name":`{name} (Copy)`,"profiles.create":`Create profile`,"profiles.current":`Current profile`,"profiles.default_name":`Default`,"profiles.default_settings":`Default settings`,"profiles.defaults_description":`Start with the standard Quick Access shortcuts and settings.`,"profiles.delete":`Delete profile`,"profiles.delete_confirmation":`Delete "{name}" profile from Home Assistant? All its shortcuts, favorites and settings will be permanently removed.`,"profiles.delete_warning":`This profile will be deleted from all devices using it.`,"profiles.errors.deleted":`This profile no longer exists. Reload saved profiles.`,"profiles.errors.disconnected":`Home Assistant is unavailable. Keep your draft and reconnect before saving.`,"profiles.duplicate_title":`Duplicate profile`,"profiles.edit":`Edit profile`,"profiles.empty":`No profiles yet. Create a profile to get started.`,"profiles.errors.instance_changed":`Home Assistant instance changed. Reload this page before editing profiles.`,"profiles.errors.invalid_categories":`Invalid profile groups received from Home Assistant. Saved data has not been reset.`,"profiles.errors.invalid_data":`Invalid server profile data. Saved data has not been reset.`,"profiles.errors.invalid_icon":`Choose a valid profile icon, for example mdi:cellphone.`,"profiles.errors.invalid_name":`Enter a profile name of 1–{limit} characters without control characters.`,"profiles.errors.invalid_quotas":`Invalid server quota information. Retry loading profiles.`,"profiles.errors.load_failed":`Could not load profiles. Retry when Home Assistant is available.`,"profiles.manage":`Manage {name}`,"profiles.name":`Profile name`,"profiles.new_name":`New profile name`,"profiles.no_source":`No source profile available.`,"profiles.others":`Other profiles`,"profiles.errors.refresh_instance":`Home Assistant instance changed. Reload this page before editing.`,"profiles.reload":`Reload saved profiles`,"profiles.reload_description":`Your unsaved edits will be discarded. The latest saved profiles will be loaded.`,"profiles.status.remote_changes":`Profiles changed on another device. Your draft is preserved. Reload saved profiles to discard it.`,"profiles.retry":`Retry loading profiles`,"profiles.saved":`Saved profiles`,"profiles.selection_help":`Profile selection is local to this browser, Home Assistant address (local or VPN) and signed-in user.`,"profiles.setup_description":`Start with shortcuts to your entities and devices. Customize them whenever you want.`,"profiles.errors.selection_read_failed":`Could not read this browser's profile selection. Check site storage and retry.`,"profiles.status.session_selection":`The profile is selected for this session. This browser could not remember the selection; enable site storage to remember it.`,"profiles.errors.source_unavailable":`Choose an available source profile. Cancel and reopen this dialog if the source was deleted.`,"profiles.start_defaults":`Start with defaults`,"profiles.start_with":`Start with`,"profiles.title":`Profiles`,"profiles.errors.unsupported_data":`Invalid or unsupported server profile data. Saved data has not been reset.`,"profiles.use":`Use {name}`,"profiles.use_action":`Use`,"shortcuts.add":`Add shortcut`,"shortcuts.add_current_url":`Use current page path`,"shortcuts.save_current_page":`Save current page`,"shortcuts.choose_color":`Choose icon color`,"shortcuts.confirm_delete":`Delete shortcut?`,"shortcuts.count":{one:`{count} shortcut`,other:`{count} shortcuts`},"shortcuts.create":`Create shortcut`,"shortcuts.delete_confirmation":`Are you sure you want to delete shortcut "{name}"?`,"shortcuts.confirm_move":`Move shortcut to another group?`,"shortcuts.move_confirmation":`Move "{name}" from "{source}" to "{destination}"?`,"shortcuts.move_explanation":`The shortcut will be removed from its current group and added to the destination group.`,"shortcuts.move_action":`Move shortcut`,"shortcuts.none_on_page":`No shortcuts on this page.`,"shortcuts.edit":`Edit shortcut`,"shortcuts.manage_named":`Manage {name}`,"shortcuts.copy_name":`{name} (Copy)`,"shortcuts.empty":`No shortcuts yet`,"shortcuts.empty_category":`Add shortcuts to this group.`,"shortcuts.external_url":`External URL`,"shortcuts.icon_color":`Icon color`,"shortcuts.icon_example":`Example: mdi:hammer, mdi:cog, mdi:view-grid-outline`,"shortcuts.internal_path":`Home Assistant path`,"shortcuts.entity_explorer":`Entity Explorer`,"shortcuts.device_explorer":`Device Explorer`,"shortcuts.invalid_external_url":`Enter a full http:// or https:// URL.`,"shortcuts.invalid_icon":`Choose a valid shortcut icon, for example mdi:hammer.`,"shortcuts.invalid_internal_path":`Enter an internal HA path starting with /.`,"shortcuts.invalid_name":`Enter a shortcut name of 1–{limit} characters without control characters.`,"shortcuts.name":`Shortcut name`,"shortcuts.name_example":`e.g. Automations`,"shortcuts.name_required":`Enter a shortcut name.`,"shortcuts.none_added":`No shortcuts added yet.`,"shortcuts.preview":`Shortcut preview: {name}`,"shortcuts.theme_default":`Theme default`,"shortcuts.type":`Shortcut type`,"shortcuts.url_path":`URL path`,"shortcuts.use_theme_color":`Use theme color`,"visibility.current_path":`Current page path`,"visibility.current_full_url":`Current URL with parameters and fragment`,"visibility.current_page_rules":`Current page`,"visibility.exact_help":`Matches this exact path, ignoring query parameters (?) and fragments (#).`,"visibility.full_url_help":`Include ? or # to match the full path, query parameters and fragment, in the same order. * matches any text. Without parameters or a fragment, the full URL is the same as the page path.`,"visibility.exclude":`Show on all pages except those listed`,"visibility.hidden_excluded":`Hidden because this page is excluded.`,"visibility.hidden_not_included":`Hidden because this page is not included.`,"visibility.include":`Show only on listed pages`,"visibility.invalid_route":`Every page path must start with /.`,"visibility.one_per_line":`Enter one page path per line.`,"visibility.route_required":`Add at least one page path for this display rule.`,"visibility.routes_hidden":`List the page paths where the button should be hidden.`,"visibility.routes_shown":`List the page paths where the button should be shown.`,"visibility.rule":`Where to show Quick Access`,"visibility.setup_required":`Set up Quick Access: choose or create a profile.`,"visibility.url_paths":`Page paths`,"visibility.visible":`Quick Access should currently be visible.`,"visibility.launcher_disabled":`Floating launcher is disabled in this browser.`,"visibility.wildcard_help":`Matches all automation subpages, ignoring query parameters (?) and fragments (#).`,"errors.server":`Home Assistant reported an error: {message}`,"filters.title":`Filters`,"filters.manage_named":`Manage {name}`,"filters.apply":`Apply`,"filters.apply_named":`Apply {name}`,"filters.duplicate":`Duplicate filter`,"filters.copy_name":`{name} (Copy)`,"filters.edit":`Edit filter`,"filters.create":`Create filter`,"filters.name":`Filter name`,"filters.template":`Start from a template`,"filters.reuse_choose":`Choose a filter from your profiles`,"filters.profile_filters":`{name} profile filters`,"filters.reuse_empty":`No existing filters of this type in your profiles.`,"filters.temporary":`Temporary filter`,"filters.apply_temporary":`Apply temporarily`,"filters.delete":`Delete filter`,"filters.delete_confirmation":`Delete this filter from this profile?`,"filters.invalid":`Enter a unique name and valid conditions (max 10 conditions and 2 nesting levels below the root group).`,"filters.save_failed":`Could not save the filter. Check the profile status and retry.`,"filters.limit":`You can save up to 10 filters of each type. All and Favorites do not count toward this limit.`,"filters.count":{one:`{count} filter`,other:`{count} filters`},"filters.limits":`Max 10 conditions · 2 nesting levels`,"filters.entity_issues":`Devices with entity issues`,"filters.match":`Match`,"filters.root_group":`Conditions`,"filters.group":`Group`,"filters.logic_and":`AND`,"filters.logic_or":`OR`,"filters.logic_not":`NONE`,"filters.edit_condition":`Edit condition`,"filters.empty_group":`No conditions. Add a condition to this group.`,"filters.invalid_condition":`Choose a valid condition and comparison, and provide any required attribute name or value.`,"filters.entities":`Device entities`,"filters.any_entity":`ANY entity`,"filters.all_entities":`ALL entities`,"filters.empty_devices":`Only enabled entities with a state are evaluated. Devices without them do not match.`,"filters.add_condition":`Add condition`,"filters.add_group":`Add group`,"filters.add_entities":`Add entity group`,"filters.remove_condition":`Remove condition`,"filters.remove_group":`Remove group`,"filters.field":`Condition`,"filters.attribute":`Attribute name`,"filters.operator":`Comparison`,"filters.value":`Value`,"filters.values_hint":`Separate values with commas.`,"filters.missing_value":`{value} (missing)`,"filters.previous_values":`Previous values`,"filters.next_values":`Next values`,"filters.values_unavailable":`Registry unavailable. Enter a value manually.`,"filters.values_empty":`No matching values.`,"filters.values_limit":`Up to 20 values. Remove a value to select another.`,"filters.preview_states":{one:`{count} matching entity`,other:`{count} matching entities`},"filters.preview_devices":{one:`{count} matching device`,other:`{count} matching devices`},"filters.matching_entities":{one:`{count} matching entity`,other:`{count} matching entities`},"filters.op_equals":`Equals`,"filters.op_not_equals":`Does not equal`,"filters.op_contains":`Contains`,"filters.op_any_of":`Is any of`,"filters.op_greater_than":`Greater than`,"filters.op_less_than":`Less than`,"filters.op_exists":`Exists`,"filters.field_state":`State`,"filters.field_attribute":`Attribute`,"filters.field_id":`ID`,"filters.field_name":`Name`,"filters.field_domain":`Domain`,"filters.field_area":`Area`,"filters.field_label":`Label`,"filters.field_manufacturer":`Manufacturer`,"filters.field_model":`Model`,"filters.field_platform":`Integration / platform`,"filters.field_device_class":`Device class`,"filters.field_hidden_by":`Hidden by`,"filters.field_entity_category":`Entity category`,"filters.field_smart":`Smart filter`,"filters.battery_threshold":`Battery below (%)`,"filters.low_battery_below":`Low battery below {percentage}%`,"filters.field_model_id":`Model ID`,"filters.field_serial_number":`Serial number`,"filters.field_sw_version":`Software version`,"filters.field_hw_version":`Hardware version`,"filters.field_entry_type":`Entry type`},fn=`1.1.3`;function pn(e){return`/quick_access/${e}?v=${fn}`}var mn=3e4,hn=100,gn=5e3,_n=3e5,vn=new Map([[`en`,dn]]),$=new Map,yn={"common.save":`ui.common.save`,"common.cancel":`ui.common.cancel`,"common.close":`ui.common.close`,"common.back":`ui.common.back`,"common.delete":`ui.common.delete`};function bn(e){try{return Intl.getCanonicalLocales(String(e||`en`).replaceAll(`_`,`-`))[0]}catch{return`en`}}function xn(e){let t=bn(e);return[...new Set([t,t.split(`-`)[0],`en`])]}async function Sn(e){let t;try{let n=await fetch(pn(`locales/${encodeURIComponent(e)}.json`));if(!n.ok)return n.status===404;t=await n.json()}catch{return!1}return!t||typeof t!=`object`||Array.isArray(t)?!1:(vn.set(e,t),!0)}function Cn(e){if(vn.has(e))return Promise.resolve(!0);if(!$.has(e)){let t=Sn(e).then(n=>(!n&&$.get(e)===t&&$.delete(e),n));$.set(e,t)}return $.get(e)}var wn=Symbol(`retry`),Tn=new Set;function En(){let e=[...Tn];Tn.clear();for(let t of e)t.deref()?.[wn]()}function Dn(e){typeof globalThis.addEventListener==`function`&&(globalThis.addEventListener(`online`,En),Tn.add(e))}function On(e,t,n){if(e&&typeof e==`object`){let r=Number(t.count),i=`other`;try{i=new Intl.PluralRules(n).select(r)}catch{}e=e[`=${r}`]??e[i]??e.other}return typeof e!=`string`||!e?null:e.replace(/\{([a-zA-Z_][\w]*)\}/g,(e,n)=>{let r=t[n];return r==null?``:String(r)})}function kn(e){let t=e,n=``,r=null,i=Promise.resolve(),a=new Map,o=new WeakMap,s=0,c=Date.now(),l=!1,u=gn,d=0,f=null;function p(){let e=Promise.all(xn(n).map(Cn)).then(t=>{S(),i===e&&(t.includes(!1)?(l=!0,d=Date.now()+u,u=Math.min(u*2,_n),Dn(f)):(l=!1,u=gn))});return i=e,i}function m(){for(let e of a.keys())e.deref()||a.delete(e);s=0,c=Date.now()}function h(e){if(!e)return;let t=o.get(e);t&&(a.delete(t),o.delete(e));for(let t of e.children||[])h(t)}class g{constructor(e,t,n){this.key=e,this.parameters=t,this.haKey=n}toString(){return _(this.key,this.parameters,this.haKey)}}function _(e,r={},i){if(i&&typeof t?.localize==`function`){let e=t.localize(i);if(e&&e!==i)return e}for(let t of xn(n)){let n=vn.get(t);if(!n||!Object.hasOwn(n,e))continue;let i=On(n[e],r,t);if(i!==null)return i}return On(dn[`common.unavailable`],{},`en`)}function v(e){return typeof e==`function`?v(e()):e instanceof g?String(e):Array.isArray(e)?e.map(v):e&&Object.getPrototypeOf(e)===Object.prototype?Object.fromEntries(Object.entries(e).map(([e,t])=>[e,v(t)])):e}function y(e){return e instanceof g||typeof e==`function`||Array.isArray(e)&&e.some(y)||e&&Object.getPrototypeOf(e)===Object.prototype&&Object.values(e).some(y)}function b(e,t,n,r=!1){if(!e)return;let i=y(n),c=o.get(e);!c&&i&&(++s>=hn&&m(),c=new WeakRef(e),o.set(e,c),a.set(c,new Map));let l=`${r?`attribute`:`property`}:${t}`,u=c&&a.get(c),d={name:t,value:n,attribute:r};i?u.set(l,d):u&&(u.delete(l),u.size||(a.delete(c),o.delete(e))),x(e,d)}function x(e,t){let{name:n,value:r,attribute:i}=t,a=v(r);if(i)e.setAttribute(n,String(a));else if(n===`textContent`){let n=t.textNode?.deref();n?.parentNode===e?n.data=String(a):(e.textContent=a,t.textNode=e.firstChild?.nodeType===3?new WeakRef(e.firstChild):null)}else e[n]=a}function S(){for(let[e,t]of a){let n=e.deref();if(!n)a.delete(e);else for(let e of t.values())x(n,e)}}let C={t:_,message:(e,t={},n=yn[e])=>new g(e,t,n),text:(e,t)=>b(e,`textContent`,t),property:(e,t,n)=>b(e,t,n),attribute:(e,t,n)=>b(e,t,n,!0),properties:(e,t)=>{for(let[n,r]of Object.entries(t))b(e,n,r)},release:h,clear(){a.clear(),o=new WeakMap,s=0,c=Date.now()},error:e=>Object.assign(Error(String(e)),{localizedMessage:e}),errorMessage:e=>e?.localizedMessage||(e?.message?new g(`errors.server`,{message:e.message}):void 0),get language(){return n||`en`},get ready(){return i},setHass(e){t=e,Date.now()-c>=mn&&m();let a=typeof t?.localize==`function`?t.localize:null,o=a!==r;r=a;let s=bn(t?.language);return s===n?(o&&S(),l&&Date.now()>=d?C[wn]():i):(n=s,S(),p())},[wn](){return l=!1,p()}};return f=new WeakRef(C),C.setHass(e),C}export{h as A,c as B,ee as C,_ as D,v as E,t as F,o as H,l as I,r as L,f as M,m as N,y as O,p as P,n as R,C as S,b as T,a as U,s as V,i as W,te as _,nn as a,ie as b,z as c,ue as d,le as f,w as g,ne as h,un as i,u as j,g as k,E as l,se as m,fn as n,Zt as o,ce as p,pn as r,K as s,kn as t,de as u,re as v,x as w,oe as x,ae as y,e as z};