// Chromium checks with simulated HA connections and real module/CSS, run in CI.
// A published frontend fixture also exercises actual native HA components.
// Set QUICK_ACCESS_BROWSER to a Chrome/Chromium executable. No browser framework.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, readFileSync, readdirSync, rmSync } = require("node:fs");
const { createServer } = require("node:http");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { stripTypeScriptTypes } = require("node:module");
const { load: loadYaml, YAML11_SCHEMA } = require("js-yaml");
const { verifySimpleControls, verifySimpleParity } = require("./simple-controls-browser.cjs");
const {
  verifyEntitySelector,
  verifyEntitySelectorParity,
} = require("./entity-selector-browser.cjs");
const {
  verifySelectSelector,
  verifySelectSelectorParity,
} = require("./select-selector-browser.cjs");
const {
  verifyAttributesViewer,
  verifyAttributesViewerParity,
  verifyDialogAttributes,
} = require("./attributes-viewer-browser.cjs");
const { verifyStateIcon, verifyStateIconParity } = require("./state-icon-browser.cjs");
const { verifyShortcutArrangement } = require("./shortcut-arrangement-browser.cjs");
const { verifyItemFeedback } = require("./item-feedback-browser.cjs");
const filterColorCases = require("./filter-color-cases.json");

const frontendDirectory = path.join(__dirname, "../custom_components/quick_access/frontend");
const { assetVersion, frontend, frontendFiles } = require("./module-loader.cjs");
const frontendAssets = new Set(frontendFiles(frontendDirectory));
const sourceModules = new Set(frontendFiles().filter((file) => /\.(js|ts)$/.test(file)));
const settleDialogsExpression = `(async()=>{
  const collect=root=>[...root.querySelectorAll('qap-dialog,qap-menu'),...[...root.querySelectorAll('home-assistant,hc-main,quick-access-config')].flatMap(host=>host.shadowRoot?collect(host.shadowRoot):[])];
  await Promise.allSettled(collect(document).flatMap(host=>host.shadowRoot?.querySelector('dialog,[popover]')?.getAnimations()||[]).map(animation=>animation.finished));
})()`;

function serveFrontendAsset(pathname, response) {
  // Pure helper assertions use source; UI entry points always use built output.
  if (pathname.startsWith("/quick_access_source/")) {
    const file = pathname.slice("/quick_access_source/".length);
    if (!sourceModules.has(file)) {
      response.writeHead(404).end();
      return true;
    }
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    const source = readFileSync(path.join(frontend, file), "utf8");
    response.end(file.endsWith(".ts") ? stripTypeScriptTypes(source) : source);
    return true;
  }
  if (!pathname.startsWith("/quick_access/")) return false;
  const asset = pathname.slice("/quick_access/".length);
  if (!frontendAssets.has(asset)) {
    response.writeHead(404).end();
    return true;
  }
  const mime = asset.endsWith(".js")
    ? "text/javascript"
    : asset.endsWith(".css")
      ? "text/css"
      : "application/json";
  response.setHeader("Content-Type", `${mime}; charset=utf-8`);
  response.end(readFileSync(path.join(frontendDirectory, asset)));
  return true;
}

test(
  "Chromium: Lit controls, keyboard, accessibility and lazy icon boundaries",
  {
    skip: !process.env.QUICK_ACCESS_BROWSER,
    timeout: 180000,
  },
  async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "quick-access-browser-"));
    const server = createServer((request, response) => {
      if (serveFrontendAsset(new URL(request.url, "http://localhost").pathname, response)) return;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        "<!doctype html><meta charset='utf-8'><link rel='stylesheet' href='/quick_access/quick_access.css'>",
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    let browser;
    try {
      browser = await connectBrowser(process.env.QUICK_ACCESS_BROWSER, directory);
      for (const width of [320, 1440]) {
        const url = `http://127.0.0.1:${server.address().port}/`;
        const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
        const { sessionId } = await browser.send("Target.attachToTarget", {
          targetId,
          flatten: true,
        });
        const send = (method, params) => browser.send(method, params, sessionId);
        const evaluate = async (expression) => {
          const result = await send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: false,
          });
          if (result.exceptionDetails)
            throw Error(
              result.exceptionDetails.exception?.description ||
                JSON.stringify(result.exceptionDetails),
            );
          await send("Runtime.evaluate", {
            expression: settleDialogsExpression,
            awaitPromise: true,
          });
          if (!result.result.objectId) return result.result.value;
          const objectId = result.result.objectId;
          try {
            const serialized = await send("Runtime.callFunctionOn", {
              objectId,
              functionDeclaration: "function(){return this instanceof Node ? null : this;}",
              returnByValue: true,
            });
            return serialized.result.value;
          } finally {
            await send("Runtime.releaseObject", { objectId });
          }
        };
        const key = async (name, code, modifiers = 0) => {
          const windowsVirtualKeyCode = {
            Enter: 13,
            Space: 32,
            ArrowDown: 40,
            ArrowUp: 38,
            Home: 36,
            End: 35,
            Tab: 9,
            Escape: 27,
          }[code];
          await send("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: name,
            code,
            modifiers,
            windowsVirtualKeyCode,
            ...(code === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}),
          });
          await send("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: name,
            code,
            modifiers,
            windowsVirtualKeyCode,
          });
        };
        await send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 844,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await send("Page.bringToFront");
        await send("Page.navigate", { url });
        let ready = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            ready = await evaluate(
              `location.href===${JSON.stringify(url)} && document.readyState==='complete'`,
            );
          } catch {
            /* Navigation can replace the initial execution context. */
          }
          if (ready) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(ready, true, "The control fixture finished navigation");
        const colorValidation = await evaluate(`(async()=>{
        const {validIconColor,normalizeIconColor}=await import('/quick_access_source/utils/icons.js');
        const {validFilters,profileFilters}=await import('/quick_access_source/registry/filter-definitions.js');
        const cases=${JSON.stringify(filterColorCases)};
        cases.invalid.push(' '.repeat(257),'var(--'+'x'.repeat(250)+')');
        return Object.fromEntries(Object.entries(cases).map(([kind,colors])=>[kind,colors.map(color=>{
          const filters=structuredClone(profileFilters());filters.states[0].color=color;
          return {color,valid:validIconColor(color),filters:validFilters(filters),normalized:normalizeIconColor(color)};
        })]));
      })()`);
        for (const entry of colorValidation.valid) {
          assert.equal(entry.valid, true, JSON.stringify(entry));
          assert.equal(entry.filters, true, JSON.stringify(entry));
          assert.equal(entry.normalized, entry.color.trim());
        }
        for (const entry of colorValidation.invalid) {
          assert.equal(entry.valid, false, JSON.stringify(entry));
          assert.equal(entry.filters, false, JSON.stringify(entry));
          assert.equal(entry.normalized, "");
        }
        await evaluate(`(async()=>{
        await import('/quick_access/quick_access_config.js');
        window.fixture=document.createElement('section');fixture.style.cssText='display:grid;gap:12px;padding:16px;--wa-transition-normal:0ms';document.body.append(fixture);
        window.action=document.createElement('qap-button');action.textContent='Action';window.clicks=0;action.addEventListener('click',()=>clicks++);
        window.field=document.createElement('qap-input');field.label='Name';
        window.choice=document.createElement('qap-select');choice.label='Choice';choice.options=[{value:'a',label:'A',group:'First'},{value:'b',label:'B',disabled:true,group:'First'},{value:'c',label:'C',group:'Second'}];choice.value='a';window.changes=0;choice.addEventListener('change',()=>changes++);
        window.check=document.createElement('qap-checkbox');check.label='Enabled';window.toggles=0;check.addEventListener('change',()=>toggles++);
        window.symbol=document.createElement('qap-icon');symbol.icon='custom:fixture';symbol.label='Meaningful symbol';symbol.className='qap-icon';
        window.picker=document.createElement('qap-icon-picker');picker.label='Icon';picker.value='mdi:lamp';
        window.detachedPicker=document.createElement('qap-icon-picker');
        fixture.append(action,field,choice,check,symbol,picker,detachedPicker);
        await Promise.all([...fixture.children].map(control=>control.updateComplete));detachedPicker.remove();
      })()`);
        assert.equal(
          await evaluate(`symbol.querySelector('ha-icon').getAttribute('icon')`),
          "custom:fixture",
        );
        assert.equal(await evaluate(`symbol.getAttribute('role')`), "img");
        assert.equal(
          await evaluate(`symbol.querySelector('ha-icon').getAttribute('aria-hidden')`),
          "true",
        );
        await evaluate(`action.focus()`);
        await key("Enter", "Enter");
        assert.equal(
          await evaluate("clicks"),
          1,
          JSON.stringify(
            await evaluate(
              `({host:document.activeElement?.localName,inner:action.shadowRoot.activeElement?.localName,html:action.shadowRoot.querySelector('button').outerHTML})`,
            ),
          ),
        );
        let activations = 1;
        if (width === 320) {
          const point = await evaluate(
            `(()=>{const r=action.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
          );
          await send("Emulation.setTouchEmulationEnabled", { enabled: true });
          await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
          await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await send("Emulation.setTouchEmulationEnabled", { enabled: false });
          activations++;
          await waitForBrowser(evaluate, `clicks===${activations}`);
        }
        await evaluate(`action.disabled=true;action.updateComplete`);
        await evaluate(
          `action.click();action.disabled=false;action.loading=true;action.updateComplete`,
        );
        await evaluate(`action.click()`);
        await key("Enter", "Enter");
        assert.equal(await evaluate("clicks"), activations);
        assert.equal(
          await evaluate(`action.shadowRoot.querySelector('button').getAttribute('aria-busy')`),
          "true",
        );
        await evaluate(`action.loading=false;action.updateComplete`);
        await evaluate(`field.focus()`);
        await send("Input.insertText", { text: "Keyboard value" });
        assert.equal(await evaluate("field.value"), "Keyboard value");
        await evaluate(`window.fieldEvents=[];fixture.addEventListener('input',event=>{if(event.target===field)fieldEvents.push(['input',field.value,event.composed]);});
        fixture.addEventListener('change',event=>{if(event.target===field)fieldEvents.push(['change',field.value,event.composed]);});
        window.innerField=field.shadowRoot.querySelector('input');field.setSelectionRange(2,8,'backward');
        field.label='Renamed field';field.setAttribute('aria-invalid','true');field.updateComplete`);
        assert.deepEqual(
          await evaluate(
            `({same:field.shadowRoot.querySelector('input')===innerField,selection:[innerField.selectionStart,innerField.selectionEnd,innerField.selectionDirection],focused:field.shadowRoot.activeElement===innerField,invalid:innerField.getAttribute('aria-invalid')})`,
          ),
          { same: true, selection: [2, 8, "backward"], focused: true, invalid: "true" },
        );
        await evaluate(`innerField.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,composed:true}));
        innerField.value='日本';innerField.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,isComposing:true}));
        field.label='Composing';field.updateComplete`);
        assert.equal(
          await evaluate(
            `field.value==='日本'&&field.shadowRoot.querySelector('input')===innerField`,
          ),
          true,
        );
        await evaluate(
          `innerField.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,composed:true}));innerField.dispatchEvent(new Event('change',{bubbles:true}));`,
        );
        assert.deepEqual(await evaluate(`fieldEvents`), [
          ["input", "日本", true],
          ["change", "日本", true],
        ]);
        await evaluate(
          `field.removeAttribute('aria-invalid');field.required=true;field.value='';field.updateComplete`,
        );
        assert.equal(await evaluate(`field.checkValidity()`), false);
        await evaluate(`field.value='Valid';field.pattern='[A-Z]+';field.updateComplete`);
        assert.equal(await evaluate(`field.checkValidity()`), false);
        await evaluate(`field.value='VALID';field.updateComplete`);
        assert.equal(await evaluate(`field.checkValidity()`), true);
        await evaluate(
          `field.type='number';field.min='1';field.max='8';field.step='2';field.value='2';field.updateComplete`,
        );
        assert.equal(await evaluate(`field.checkValidity()`), false);
        await evaluate(`field.value='3';field.updateComplete`);
        assert.equal(await evaluate(`field.checkValidity()`), true);
        await evaluate(
          `field.type='text';field.pattern=undefined;field.maxLength=4;field.value='';field.updateComplete`,
        );
        await evaluate(`field.focus()`);
        await send("Input.insertText", { text: "Longer than four" });
        assert.equal(await evaluate(`field.value`), "Long");
        await evaluate(`field.disabled=true;field.updateComplete`);
        assert.equal(await evaluate(`innerField.disabled&&field.checkValidity()`), true);
        await evaluate(`field.disabled=false;field.label='Name';field.updateComplete`);
        await evaluate(`choice.focus()`);
        await key("ArrowDown", "ArrowDown");
        assert.equal(await evaluate("choice.value"), "c");
        assert.equal(await evaluate("changes"), 1);
        await evaluate(
          `window.innerChoice=choice.shadowRoot.querySelector('select');choice.options=[{value:'c',label:'Renamed',group:'Updated'},{value:'d',label:'D'}];choice.updateComplete`,
        );
        assert.equal(
          await evaluate(
            `choice.value==='c'&&innerChoice===choice.shadowRoot.querySelector('select')&&innerChoice.selectedOptions[0].textContent==='Renamed'&&changes===1`,
          ),
          true,
        );
        await evaluate(`check.focus()`);
        await key(" ", "Space");
        assert.equal(await evaluate("check.checked && toggles===1"), true);
        await evaluate(`check.disabled=true;check.updateComplete`);
        await evaluate(`check.click()`);
        assert.equal(await evaluate("toggles"), 1);
        for (const [background, foreground] of [
          ["#fafafa", "#212121"],
          ["#111111", "#eeeeee"],
          ["#203040", "#e0d0c0"],
        ]) {
          const colors = await evaluate(
            `(()=>{fixture.style.setProperty('--input-fill-color',${JSON.stringify(background)});fixture.style.setProperty('--ha-color-form-background',${JSON.stringify(background)});fixture.style.setProperty('--ha-color-form-background-hover',${JSON.stringify(background)});fixture.style.setProperty('--primary-text-color',${JSON.stringify(foreground)});const style=getComputedStyle(field.shadowRoot.querySelector('input'));return [style.backgroundColor,style.color];})()`,
          );
          const rgb = (hex) =>
            `rgb(${[1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)).join(", ")})`;
          assert.deepEqual(colors, [rgb(background), rgb(foreground)]);
        }
        await evaluate(`(async()=>{
        action.focus();window.modal=document.createElement('qap-dialog');modal.label='Test dialog';modal.description='Dialog description';
        modal.innerHTML='<qap-input label="First"></qap-input><qap-button>Last</qap-button>';fixture.append(modal);modal.showModal();
        await modal.updateComplete;await Promise.all([...modal.children].map(control=>control.updateComplete));
      })()`);
        for (let index = 0; index < 5; index++) {
          await key("Tab", "Tab", index % 2 ? 8 : 0);
          assert.equal(
            await evaluate(
              `modal===document.activeElement||modal.contains(document.activeElement)`,
            ),
            true,
            "Tab stays inside the native modal",
          );
        }
        await evaluate(
          `modal.querySelector("qap-input").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",isComposing:true,bubbles:true,composed:true}))`,
        );
        assert.equal(
          await evaluate(`modal.open`),
          true,
          "Escape during IME composition retains the dialog",
        );
        await evaluate(
          `window.preventDismiss=event=>event.preventDefault();modal.addEventListener('cancel',preventDismiss)`,
        );
        await key("Escape", "Escape");
        assert.equal(
          await evaluate("modal.open"),
          true,
          "dirty-form cancellation can prevent dismissal",
        );
        await evaluate(`modal.removeEventListener('cancel',preventDismiss)`);
        await key("Escape", "Escape");
        assert.equal(await evaluate("modal.open"), false);
        assert.equal(
          await evaluate(`document.activeElement===action`),
          true,
          "closing restores the trigger",
        );
        await evaluate(`history.replaceState({automationDraft:'keep'},'','/config/automation/edit/fixture?draft=1#yaml');
        window.automationRoute=location.href;window.automationEditor=document.createElement('textarea');
        automationEditor.value='alias: Unsaved automation\\ntrigger: []';fixture.prepend(automationEditor);window.automationValue=automationEditor.value;`);
        // Owned-dialog regressions use real top-layer behavior and real keyboard /
        // pointer input, including a nested confirmation over a retained draft.
        await evaluate(`(async()=>{
        modal.remove();window.originalOverflow=document.documentElement.style.cssText;
        document.documentElement.style.setProperty('overflow','clip','important');
        action.focus();window.parentDialog=document.createElement('qap-dialog');parentDialog.type='alert';
        parentDialog.innerHTML='<h2 id="regression-title">Unsaved draft</h2><p id="regression-description">Keep this form</p><qap-input autofocus label="Draft"></qap-input><qap-button>Last</qap-button>';
        parentDialog.setAttribute('aria-labelledby','regression-title');parentDialog.setAttribute('aria-describedby','regression-description');
        fixture.append(parentDialog);parentDialog.showModal();await parentDialog.updateComplete;
        await Promise.all([...parentDialog.querySelectorAll('qap-input,qap-button')].map(control=>control.updateComplete));
        window.draftControl=parentDialog.querySelector('qap-input');draftControl.value='Retained automation edit';draftControl.focus();draftControl.setSelectionRange(2,8);
        window.childDialog=document.createElement('qap-dialog');childDialog.type='alert';childDialog.label='Discard changes?';
        childDialog.innerHTML='<div tabindex="-1"><qap-button autofocus>Keep editing</qap-button></div><qap-button>Discard</qap-button>';
        parentDialog.append(childDialog);childDialog.showModal();await childDialog.updateComplete;
        await Promise.all([...childDialog.children].map(control=>control.updateComplete));
      })()`);
        assert.equal(
          await evaluate(
            `parentDialog.shadowRoot.querySelector('dialog').getAttribute('aria-label')`,
          ),
          "Unsaved draft",
        );
        assert.equal(
          await evaluate(
            `parentDialog.shadowRoot.querySelector('dialog').getAttribute('aria-description')`,
          ),
          "Keep this form",
        );
        await key("Tab", "Tab", 8);
        assert.equal(
          await evaluate(`document.activeElement===childDialog.lastElementChild`),
          true,
          "Shift+Tab wraps to the last child control",
        );
        await key("Tab", "Tab");
        assert.equal(
          await evaluate(`document.activeElement===childDialog.querySelector("qap-button")`),
          true,
          "Tab wraps to the first child control",
        );
        await evaluate(`action.focus()`);
        assert.equal(
          await evaluate(
            `childDialog===document.activeElement||childDialog.contains(document.activeElement)`,
          ),
          true,
          "background focus is inert",
        );
        await key("Escape", "Escape");
        await waitForBrowser(
          evaluate,
          `parentDialog.open&&!childDialog.open&&document.activeElement===draftControl&&draftControl.value==='Retained automation edit'`,
        );
        assert.equal(
          await evaluate(`document.documentElement.style.overflow`),
          "hidden",
          "the parent keeps the scroll lock",
        );
        await evaluate(
          `childDialog.remove();parentDialog.preventScrimClose=true;window.dismissRequests=[];parentDialog.addEventListener('cancel',event=>dismissRequests.push(event.detail.source))`,
        );
        const backdropClick = async () => {
          await send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            button: "left",
            clickCount: 1,
            x: 1,
            y: 1,
          });
          await send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            button: "left",
            clickCount: 1,
            x: 1,
            y: 1,
          });
        };
        await backdropClick();
        assert.equal(
          await evaluate(`parentDialog.open&&dismissRequests.length===0`),
          true,
          "protected backdrop clicks do not dismiss",
        );
        await evaluate(`parentDialog.preventScrimClose=false`);
        await backdropClick();
        assert.deepEqual(await evaluate(`dismissRequests`), ["backdrop"]);
        assert.equal(
          await evaluate(
            `!parentDialog.open&&document.activeElement===action&&document.documentElement.style.overflow==='clip'&&document.documentElement.style.getPropertyPriority('overflow')==='important'`,
          ),
          true,
          "closing restores focus and the original scroll style",
        );
        await evaluate(
          `(async()=>{parentDialog.showModal();await parentDialog.updateComplete;parentDialog.append(childDialog);childDialog.showModal();await childDialog.updateComplete;parentDialog.remove();})()`,
        );
        assert.equal(
          await evaluate(
            `!parentDialog.open&&!childDialog.open&&document.documentElement.style.overflow==='clip'`,
          ),
          true,
          "removal releases nested modality and scroll locks",
        );
        await evaluate(
          `document.documentElement.style.cssText=originalOverflow;childDialog.remove();`,
        );
        assert.equal(
          await evaluate(
            `automationEditor.isConnected&&automationEditor.value===automationValue&&location.href===automationRoute&&history.state.automationDraft==='keep'`,
          ),
          true,
          "opening/closing dialogs retains the underlying automation editor fixture, route and history state",
        );
        await evaluate(
          `(async()=>{window.pendingDialog=document.createElement('qap-dialog');pendingDialog.setAttribute("aria-labelledby","removed-title");pendingDialog.innerHTML='<h2 id="removed-title">Removed before render</h2>';fixture.append(pendingDialog);window.pendingCloses=0;pendingDialog.addEventListener('closed',()=>pendingCloses++);pendingDialog.showModal();pendingDialog.close();await pendingDialog.updateComplete;pendingDialog.remove();})()`,
        );
        assert.equal(
          await evaluate(`pendingCloses===1&&!pendingDialog.open`),
          true,
          "closing before first render completes cleanup once",
        );
        await verifyDialogHardening(evaluate, key, send, width);
        await evaluate(`modal.remove();picker.focus();picker.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
        customElements.define('ha-icon-picker',class extends HTMLElement{constructor(){super();this.attachShadow({mode:'open',delegatesFocus:true}).innerHTML='<input aria-label="Native icon">';}connectedCallback(){this.shadowRoot.querySelector('input').value=this.value;}});
        picker.querySelector('input').value='mdi:hammer';picker.querySelector('input').dispatchEvent(new Event('input',{bubbles:true}));action.focus();new Promise(resolve=>setTimeout(resolve,0));`);
        assert.equal(
          await evaluate(
            `!!picker.querySelector('input')&&!picker.querySelector('ha-icon-picker')`,
          ),
          true,
          "registration preserves an active composition",
        );
        await evaluate(
          `picker.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));new Promise(resolve=>setTimeout(resolve,0));`,
        );
        assert.equal(await evaluate(`picker.querySelector('ha-icon-picker').value`), "mdi:hammer");
        assert.equal(
          await evaluate(`detachedPicker.querySelector('ha-icon-picker')===null`),
          true,
          "detached picker releases its watcher",
        );
        await evaluate(
          `picker.querySelector('ha-icon-picker').dispatchEvent(new CustomEvent('value-changed',{detail:{value:'mdi:cog'},bubbles:true}));`,
        );
        assert.equal(await evaluate(`picker.value`), "mdi:cog");
        await send("Accessibility.enable");
        await evaluate(`window.fieldHelp=document.createElement('p');fieldHelp.id='field-help';fieldHelp.textContent='Explain the error';fixture.append(fieldHelp);
        field.setAttribute('aria-describedby',fieldHelp.id);field.setAttribute('aria-invalid','true');field.updateComplete`);
        const fieldTree = await send("Accessibility.getFullAXTree");
        const accessibleField = fieldTree.nodes.find(
          (node) => !node.ignored && node.role?.value === "textbox" && node.name?.value === "Name",
        );
        assert.equal(accessibleField?.description?.value, "Explain the error");
        assert.equal(
          accessibleField?.properties.some(
            (property) => property.name === "invalid" && property.value.value === "true",
          ),
          true,
        );
        await evaluate(`fieldHelp.textContent='Updated explanation'`);
        const updatedFieldTree = await send("Accessibility.getFullAXTree");
        assert.equal(
          updatedFieldTree.nodes.find(
            (node) =>
              !node.ignored && node.role?.value === "textbox" && node.name?.value === "Name",
          )?.description?.value,
          "Updated explanation",
        );
        await evaluate(
          `window.dynamicLabel=document.createElement('span');dynamicLabel.id='dynamic-action-label';dynamicLabel.textContent='First action';fixture.append(dynamicLabel);action.setAttribute('aria-labelledby',dynamicLabel.id);action.updateComplete`,
        );
        let tree = await send("Accessibility.getFullAXTree");
        assert.equal(
          tree.nodes.some(
            (node) =>
              !node.ignored && node.role?.value === "button" && node.name?.value === "First action",
          ),
          true,
        );
        await evaluate(`dynamicLabel.textContent='Renamed action'`);
        tree = await send("Accessibility.getFullAXTree");
        assert.equal(
          tree.nodes.some(
            (node) =>
              !node.ignored &&
              node.role?.value === "button" &&
              node.name?.value === "Renamed action",
          ),
          true,
          "referenced labels remain live across the shadow boundary",
        );
        await evaluate(
          `action.removeAttribute('aria-labelledby');dynamicLabel.remove();action.updateComplete`,
        );
        const { nodes } = await send("Accessibility.getFullAXTree");
        assert.equal(
          nodes.filter(
            (node) =>
              !node.ignored && node.role?.value === "button" && node.name?.value === "Action",
          ).length,
          1,
        );
        assert.equal(
          nodes.filter(
            (node) =>
              !node.ignored &&
              node.role?.value === "image" &&
              node.name?.value === "Meaningful symbol",
          ).length,
          1,
        );
        await verifySimpleControls({ evaluate, key, send, width });
        await verifyStateIcon({ evaluate, send });
        await verifyEntitySelector({ evaluate, key, send, width });
        await verifySelectSelector({ evaluate, key, send, width });
        assert.equal(
          await evaluate(`customElements.get('qap-attributes-viewer')===undefined`),
          true,
          "other controls do not load the YAML viewer",
        );
        await verifyAttributesViewer({ evaluate, key, send, width });
        await verifyAttributesViewer({ evaluate, key, send, width }, true);
        await browser.send("Target.closeTarget", { targetId });
      }
    } finally {
      await browser?.close();
      await new Promise((resolve) => server.close(resolve));
      assert.equal(path.dirname(directory), path.resolve(tmpdir()));
      assert.ok(path.basename(directory).startsWith("quick-access-browser-"));
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

async function verifyDialogHardening(evaluate, key, send, width) {
  await evaluate(`(async()=>{
    customElements.define('fixture-dialog-field',class extends HTMLElement {
      constructor(){super();this.attachShadow({mode:'open',delegatesFocus:true}).innerHTML='<input aria-label="Entity"><button>Picker action</button>';}
    });
    customElements.define('fixture-dialog-selector',class extends HTMLElement {
      constructor(){super();this.attachShadow({mode:'open',delegatesFocus:true}).innerHTML='<fixture-dialog-field></fixture-dialog-field>';}
    });
    customElements.define('fixture-dialog-options',class extends HTMLElement {
      constructor(){super();this.attachShadow({mode:'open'}).innerHTML='<slot name="first"></slot><slot></slot>';}
    });
    window.keyboardDialog=document.createElement('qap-dialog');keyboardDialog.label='Composed focus regression';
    keyboardDialog.innerHTML='<div hidden><button autofocus>Hidden autofocus</button></div><fixture-dialog-selector autofocus></fixture-dialog-selector><fixture-dialog-options><button id="last-option">Last</button><button slot="first" id="first-option">First</button></fixture-dialog-options><div inert><button>Inert</button></div>';
    fixture.append(keyboardDialog);keyboardDialog.showModal();await keyboardDialog.updateComplete;
    window.selectorField=keyboardDialog.querySelector('fixture-dialog-selector').shadowRoot.querySelector('fixture-dialog-field');
    window.entityInput=selectorField.shadowRoot.querySelector('input');window.pickerAction=selectorField.shadowRoot.querySelector('button');
    window.tabDefaults=[];keyboardDialog.addEventListener('keydown',event=>{if(event.key==='Tab')tabDefaults.push(event.defaultPrevented);});
  })()`);
  assert.equal(
    await evaluate(`selectorField.shadowRoot.activeElement===entityInput`),
    true,
    "autofocus resolves through nested shadow roots and ignores hidden controls",
  );
  await key("Tab", "Tab");
  assert.equal(
    await evaluate(`selectorField.shadowRoot.activeElement===pickerAction`),
    true,
    "Tab navigates inside a nested delegated selector",
  );
  await key("Tab", "Tab");
  assert.equal(
    await evaluate(`document.activeElement.id`),
    "first-option",
    "slots determine native Tab order",
  );
  await key("Tab", "Tab");
  assert.equal(await evaluate(`document.activeElement.id`), "last-option");
  assert.deepEqual(
    await evaluate(`tabDefaults`),
    [false, false, false],
    "interior navigation keeps native Tab defaults",
  );
  await key("Tab", "Tab");
  assert.equal(
    await evaluate(`selectorField.shadowRoot.activeElement===entityInput`),
    true,
    "forward boundary wraps into nested shadow DOM",
  );
  await key("Tab", "Tab", 8);
  assert.equal(
    await evaluate(`document.activeElement.id`),
    "last-option",
    "reverse boundary follows composed slot order",
  );
  await evaluate(`keyboardDialog.querySelector('fixture-dialog-options').remove();
    window.radioGroup=document.createElement('div');radioGroup.setAttribute('role','radiogroup');
    radioGroup.innerHTML='<input type="radio" name="mode" checked><input type="radio" name="mode">';keyboardDialog.append(radioGroup);
    window.selectedRadio=radioGroup.firstElementChild;selectedRadio.focus();`);
  await key("Tab", "Tab");
  assert.equal(
    await evaluate(`selectorField.shadowRoot.activeElement===entityInput`),
    true,
    "checked radio is the final Tab stop of its group",
  );
  await key("Tab", "Tab", 8);
  assert.equal(
    await evaluate(`document.activeElement===selectedRadio`),
    true,
    "reverse wrap enters the selected radio",
  );
  await evaluate(
    `keyboardDialog.querySelector('fixture-dialog-selector').remove();selectedRadio.checked=false;selectedRadio.focus();`,
  );
  await key("Tab", "Tab", 8);
  assert.equal(
    await evaluate(`document.activeElement===selectedRadio`),
    true,
    "a focused unchecked radio remains trapped when it is the only group",
  );
  await evaluate(`keyboardDialog.prepend(document.createElement('fixture-dialog-selector'));
    window.selectorField=keyboardDialog.querySelector('fixture-dialog-selector').shadowRoot.querySelector('fixture-dialog-field');
    window.entityInput=selectorField.shadowRoot.querySelector('input');`);
  await evaluate(`radioGroup.remove();window.listHost=document.createElement('fixture-dialog-options');
    listHost.innerHTML='<div role="listitem" tabindex="0">First item</div><div role="listitem" tabindex="0">Last item</div>';
    keyboardDialog.append(listHost);listHost.firstElementChild.focus();`);
  await key("Tab", "Tab");
  assert.equal(
    await evaluate(`document.activeElement===listHost.lastElementChild`),
    true,
    "list items retain native Tab behavior",
  );
  await key("Tab", "Tab");
  assert.equal(
    await evaluate(`selectorField.shadowRoot.activeElement===entityInput`),
    true,
    "list item boundary wraps",
  );
  await evaluate(`listHost.remove();window.priorityButton=document.createElement('button');priorityButton.tabIndex=2;
    priorityButton.textContent='Priority';keyboardDialog.append(priorityButton);selectorField.shadowRoot.querySelector('button').focus();`);
  await key("Tab", "Tab");
  assert.equal(
    await evaluate(`document.activeElement===priorityButton`),
    true,
    "positive tabindex belongs to its own scope and wraps from the last nested control",
  );
  await key("Tab", "Tab", 8);
  assert.equal(
    await evaluate(
      `selectorField.shadowRoot.activeElement===selectorField.shadowRoot.querySelector('button')`,
    ),
    true,
    "reverse boundary retains the shadow scope order",
  );
  await evaluate(`listHost.remove();entityInput.focus();keyboardDialog.remove();`);

  await evaluate(`(async()=>{
    window.originalMatchMedia=window.matchMedia;window.dialogMediaListeners=new Set();
    window.matchMedia=function(query){const media=originalMatchMedia.call(this,query);
      const add=media.addEventListener.bind(media),remove=media.removeEventListener.bind(media);
      media.addEventListener=(type,listener,...args)=>{if(type==='change')dialogMediaListeners.add(listener);add(type,listener,...args);};
      media.removeEventListener=(type,listener,...args)=>{if(type==='change')dialogMediaListeners.delete(listener);remove(type,listener,...args);};return media;};
    window.responsiveDialog=document.createElement('qap-dialog');responsiveDialog.adaptive=true;
    responsiveDialog.innerHTML='<input value="Retained value"><div style="height:1800px;flex:none">Scrollable content</div>';
    fixture.append(responsiveDialog);responsiveDialog.showModal();await responsiveDialog.updateComplete;
    window.responsiveSurface=responsiveDialog.shadowRoot.querySelector('dialog');window.responsiveBody=responsiveDialog.shadowRoot.querySelector('.body');
    window.responsiveInput=responsiveDialog.querySelector('input');responsiveInput.focus();responsiveInput.setSelectionRange(2,7);
    responsiveBody.scrollTop=120;window.dialogLifecycle=[];for(const type of ['opened','close','closed'])responsiveDialog.addEventListener(type,()=>dialogLifecycle.push(type));
  })()`);
  for (const [newWidth, height, sheet] of [
    [1200, 844, false],
    [600, 844, true],
    [1200, 480, true],
    [1200, 844, false],
  ]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: newWidth,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitForBrowser(evaluate, `responsiveSurface.classList.contains('sheet')===${sheet}`);
    assert.deepEqual(
      await evaluate(`({same:responsiveDialog.shadowRoot.querySelector('dialog')===responsiveSurface,focused:document.activeElement===responsiveInput,
      value:responsiveInput.value,selection:[responsiveInput.selectionStart,responsiveInput.selectionEnd],scroll:responsiveBody.scrollTop,events:dialogLifecycle})`),
      {
        same: true,
        focused: true,
        value: "Retained value",
        selection: [2, 7],
        scroll: 120,
        events: [],
      },
      "breakpoint changes retain the mounted form, focus and scroll",
    );
  }
  await evaluate(`responsiveDialog.adaptive=false;responsiveDialog.updateComplete`);
  await send("Emulation.setDeviceMetricsOverride", {
    width: 600,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  assert.equal(
    await evaluate(`responsiveSurface.classList.contains('sheet')`),
    false,
    "nonadaptive dialogs retain their presentation",
  );
  await evaluate(`responsiveDialog.adaptive=true;responsiveDialog.updateComplete`);
  assert.equal(
    await evaluate(`responsiveSurface.classList.contains('sheet')`),
    true,
    "adaptive property updates apply while open",
  );
  assert.equal(await evaluate(`dialogMediaListeners.size`), 1);
  await evaluate(`Object.defineProperty(visualViewport,'height',{configurable:true,value:400});
    Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:40});visualViewport.dispatchEvent(new Event('resize'));visualViewport.dispatchEvent(new Event('scroll'));`);
  assert.equal(
    await evaluate(`responsiveDialog.style.getPropertyValue('--qap-visual-height')==='400px'
    &&responsiveDialog.style.getPropertyValue('--qap-visual-bottom')==='404px'&&document.activeElement===responsiveInput
    &&responsiveInput.value==='Retained value'&&responsiveBody.scrollTop===120&&responsiveSurface.classList.contains('sheet')`),
    true,
    "visual viewport keyboard resizing updates geometry without replacing or blurring the form",
  );
  await evaluate(`responsiveDialog.close()`);
  assert.equal(
    await evaluate(`dialogMediaListeners.size`),
    0,
    "closing releases the media query listener",
  );
  await evaluate(
    `delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('resize'));`,
  );
  assert.equal(
    await evaluate(`responsiveDialog.style.getPropertyValue('--qap-visual-height')`),
    "400px",
    "closing releases viewport listeners",
  );
  await evaluate(
    `(async()=>{responsiveDialog.showModal();await responsiveDialog.updateComplete;responsiveDialog.remove();})()`,
  );
  assert.equal(
    await evaluate(`dialogMediaListeners.size`),
    0,
    "disconnecting releases the media query listener",
  );
  await evaluate(`window.matchMedia=originalMatchMedia`);
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });

  if (width !== 320) return;
  await evaluate(`(async()=>{
    window.closingDialog=document.createElement('qap-dialog');closingDialog.innerHTML='<button>Close test</button>';
    fixture.append(closingDialog);closingDialog.showModal();await closingDialog.updateComplete;
    window.closeEvents=[];for(const type of ['close','closed'])closingDialog.addEventListener(type,()=>closeEvents.push(type));
    window.closeSurface=closingDialog.shadowRoot.querySelector('dialog');window.realAnimations=closeSurface.getAnimations.bind(closeSurface);
    window.dialogCleanup=(await import('/quick_access_source/ui/dialogs.js')).createDialogs({l10n:{release(){}},ui:{}});
    window.resolveStalledClose=null;window.stallNextClose=()=>{let first=true;closeSurface.getAnimations=()=>{if(!first)return realAnimations();first=false;return [{finished:new Promise(resolve=>resolveStalledClose=resolve)}];};};
    stallNextClose();dialogCleanup.cleanupDialogElement(closingDialog);
  })()`);
  assert.equal(
    await evaluate(
      `closingDialog.isConnected&&closeSurface.open&&closeEvents.length===0&&document.documentElement.style.overflow==='hidden'`,
    ),
    true,
    "closing remains mounted and modal until completion or fallback",
  );
  await evaluate(`new Promise(resolve=>setTimeout(resolve,5100))`);
  assert.deepEqual(
    await evaluate(
      `({connected:closingDialog.isConnected,open:closeSurface.open,locked:document.documentElement.style.overflow==='hidden',events:closeEvents})`,
    ),
    { connected: false, open: false, locked: false, events: ["close", "closed"] },
    "an abandoned animation has bounded removal and scroll restoration",
  );
  await evaluate(`resolveStalledClose();closingDialog.remove()`);
  assert.deepEqual(
    await evaluate(`closeEvents`),
    ["close", "closed"],
    "late completion and disconnect cannot close twice",
  );
  await evaluate(`(async()=>{
    fixture.append(closingDialog);closingDialog.showModal();await closingDialog.updateComplete;closeEvents.length=0;
    stallNextClose();closingDialog.close();closingDialog.showModal();resolveStalledClose();await closingDialog.updateComplete;
  })()`);
  assert.equal(
    await evaluate(`closingDialog.open&&closeSurface.open&&closeEvents.length===0`),
    true,
    "synchronous reopening invalidates a pending close",
  );
  await evaluate(`new Promise(resolve=>setTimeout(resolve,5100))`);
  assert.equal(
    await evaluate(`closingDialog.open&&closeSurface.open&&closeEvents.length===0`),
    true,
    "the old fallback cannot close a reopened dialog",
  );
  await evaluate(`closeSurface.getAnimations=realAnimations;closingDialog.close()`);
  assert.deepEqual(await evaluate(`closeEvents`), ["close", "closed"]);
  await evaluate(`(async()=>{closingDialog.showModal();await closingDialog.updateComplete;closeEvents.length=0;
    closingDialog.addEventListener('close',()=>closingDialog.showModal(),{once:true});closingDialog.close();})()`);
  assert.equal(
    await evaluate(`closingDialog.open&&closeSurface.open&&closeEvents.join(',')==='close,closed'`),
    true,
    "reopening from a close listener survives the queued native close event",
  );
  await evaluate(`closingDialog.remove()`);
}

// Point QUICK_ACCESS_HA_FRONTEND at an installed/extracted hass_frontend
// directory to exercise HA's actual compiled components, with a simulated
// connection. This remains separate from live Core/Companion verification.
test(
  "Chromium: published HA sidebar panel and adaptive launcher",
  {
    skip: !process.env.QUICK_ACCESS_BROWSER || !process.env.QUICK_ACCESS_HA_FRONTEND,
    timeout: 420000,
  },
  async (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), "quick-access-browser-"));
    const frontend = path.resolve(process.env.QUICK_ACCESS_HA_FRONTEND);
    // Exact appearance comparisons target the documented reference frontend.
    // Other HA versions can exercise workflows without changing production styles.
    const functionalOnly = process.env.QUICK_ACCESS_HA_FUNCTIONAL_ONLY === "1";
    if (functionalOnly)
      t.diagnostic("Functional compatibility only; native visual parity comparisons are disabled.");
    const app = readdirSync(path.join(frontend, "frontend_latest")).find((name) =>
      /^app\.[^.]+\.js$/.test(name),
    );
    assert.ok(app, "HA's compiled app entrypoint must exist");
    const server = createServer((request, response) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (serveFrontendAsset(pathname, response)) return;
      // Older frontends also fetch other /static/ files, such as translations.
      if (["/frontend_latest/", "/static/"].some((prefix) => pathname.startsWith(prefix))) {
        const filename = path.resolve(frontend, `.${pathname}`);
        if (!filename.startsWith(`${frontend}${path.sep}`)) {
          response.writeHead(403).end();
          return;
        }
        try {
          response.setHeader(
            "Content-Type",
            pathname.endsWith(".js")
              ? "text/javascript"
              : pathname.endsWith(".json")
                ? "application/json"
                : "application/octet-stream",
          );
          response.end(readFileSync(filename));
        } catch {
          response.writeHead(404).end();
        }
        return;
      }
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        "<!doctype html><meta charset='utf-8'><style>html,body{margin:0;height:100%}</style>",
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    let browser;
    try {
      browser = await connectBrowser(process.env.QUICK_ACCESS_BROWSER, directory);
      for (const width of process.env.QUICK_ACCESS_TEST_WIDTHS
        ? process.env.QUICK_ACCESS_TEST_WIDTHS.split(",").map(Number)
        : [320, 390, 768, 1024, 1440])
        await t.test(`${width}px (actual HA frontend, simulated connection)`, async () => {
          const url = `http://127.0.0.1:${server.address().port}/quick-access-config`;
          const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
          const { sessionId } = await browser.send("Target.attachToTarget", {
            targetId,
            flatten: true,
          });
          const send = (method, params) =>
            browser.send(method, params, sessionId).catch((error) => {
              throw new Error(`${method}: ${error.message}`);
            });
          const evaluate = async (expression) => {
            const result = await send("Runtime.evaluate", {
              expression,
              awaitPromise: true,
              returnByValue: false,
            });
            if (result.exceptionDetails)
              throw new Error(
                result.exceptionDetails.exception?.description ||
                  JSON.stringify(result.exceptionDetails),
              );
            await send("Runtime.evaluate", {
              expression: settleDialogsExpression,
              awaitPromise: true,
            });
            if (!result.result.objectId) return result.result.value;
            const objectId = result.result.objectId;
            try {
              const serialized = await send("Runtime.callFunctionOn", {
                objectId,
                functionDeclaration: "function(){return this instanceof Node ? null : this;}",
                returnByValue: true,
              });
              return serialized.result.value;
            } finally {
              await send("Runtime.releaseObject", { objectId });
            }
          };
          await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 844,
            deviceScaleFactor: 1,
            mobile: false,
          });
          const waitReady = async (previousTimeOrigin = null) => {
            for (let attempt = 0; attempt < 100; attempt++) {
              try {
                if (
                  await evaluate(
                    `location.href===${JSON.stringify(url)} && document.readyState==='complete' && performance.timeOrigin!==${previousTimeOrigin}`,
                  )
                )
                  return;
              } catch {
                /* Navigation can replace the execution context between polls. */
              }
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
            throw new Error("Native fixture page did not finish navigation");
          };
          await send("Page.navigate", { url });
          await waitReady();
          await send("Page.bringToFront");
          const mount = async () => {
            await evaluate(`Promise.race([(async()=>{
          window.nativeStage='import';window.nativeErrors=[];
          // Frontends before 2026.8 load fragment translations from their own root,
          // which has no hass in this fixture. That HA error is not Quick Access's.
          const recordNativeError=message=>{if(!/_loadFragmentTranslations/.test(message))nativeErrors.push(message);};
          window.addEventListener('error',e=>recordNativeError(e.error?.stack||e.message));
          window.addEventListener('unhandledrejection',e=>recordNativeError(e.reason?.stack||String(e.reason)));
          window.hassConnection=new Promise(()=>{});
          await import('/frontend_latest/${app}');
          // The simulated root bypasses HA's router. Load its dashboard and
          // settings bundles so real card helpers and list controls are ready.
          const resolver=document.createElement('partial-panel-resolver');
          const routes=resolver._getRoutes({lovelace:{component_name:'lovelace',url_path:'lovelace'},config:{component_name:'config',url_path:'config'}}).routes;
          await Promise.all([routes.lovelace.load(),routes.config.load()]);
          await document.createElement('ha-panel-config').routerOptions.routes.dashboard.load();
          window.nativeStage='mount';
          const connection=new EventTarget();window.nativeSubscriptions=[];
          connection.subscribeMessage=async(callback,message)=>{nativeSubscriptions.push(message.type);callback({version:1,revision:0,profiles:[],instance_id:'native-test'});return ()=>{};};
          const hass={connection,user:{id:'native-user',is_admin:false},states:{},panels:{home:{component_name:'home',url_path:'home'}},
            auth:{},config:{components:[],state:'RUNNING'},locale:{language:'en'},language:'en',translationMetadata:{translations:{}},dockedSidebar:'docked',
            localize:()=>'',loadBackendTranslation:async()=>{},loadFragmentTranslation:async()=>{}};
          window.nativeHass=hass;
          await import('/quick_access/quick_access_config.js');
          window.panel=document.createElement('quick-access-config');
          panel.addEventListener('context-request',event=>{
            if(event.context==='hassInternationalization'){event.stopPropagation();event.callback(hass);}
            if(event.context==='narrowViewport'){event.stopPropagation();event.callback(innerWidth<=870);}
          });
          panel.hass=hass;panel.narrow=innerWidth<=870;panel.style.height='100vh';document.body.append(panel);
          window.nativeStage='stylesheet';
          const link=panel.shadowRoot.querySelector('link');if(!link.sheet)await new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=reject;});
        })(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Native check timed out at '+window.nativeStage+': '+JSON.stringify(window.nativeErrors))),6000))])`);
          };
          await mount();
          assert.equal(await evaluate("location.pathname"), "/quick-access-config");
          assert.equal(
            await evaluate("panel.shadowRoot.querySelector('h1').textContent"),
            "Quick Access",
          );
          assert.equal(
            await evaluate("panel.shadowRoot.querySelector('hass-subpage,partial-panel-resolver')"),
            null,
          );
          assert.deepEqual(await evaluate("window.nativeErrors"), []);
          assert.deepEqual(await evaluate("window.nativeSubscriptions"), [
            "quick_access/subscribe_profiles",
          ]);
          await verifyStaticCardParity(evaluate);
          // Mount HA's real root long enough for its notification mixin to load
          // the toast reference. The simulated launcher no longer imports it.
          await evaluate(`(async()=>{
        const previousTheme=document.documentElement.style.cssText;
        const referenceRoot=document.createElement('home-assistant');referenceRoot.hidden=true;
        // This root only loads its notification presentation. The surrounding
        // fixture owns hass; global HA callbacks must not initialize a second
        // connection or registry lifecycle for the reference root.
        referenceRoot._updateHass=()=>{};document.body.append(referenceRoot);
        try{await Promise.race([customElements.whenDefined('ha-toast'),new Promise((_,reject)=>setTimeout(()=>reject(Error('HA root did not load its toast')),8000))]);}
        finally{referenceRoot.remove();document.documentElement.style.cssText=previousTheme;}
      })()`);
          // Render the launcher with the published HA components as well as the
          // device panel. The service connection remains a simulated fixture.
          await evaluate(
            `(${haFixture.toString()})('hc-main');const root=document.querySelector('hc-main');root.hass={...window.nativeHass,...root.hass};import('/quick_access/quick_access.js');`,
          );
          await evaluate(
            `new Promise((resolve,reject)=>{const poll=setInterval(()=>{if(document.querySelector('#qap-fab')&&window.quickAccessDebug().profileContextReady){clearInterval(poll);resolve();}},20);setTimeout(()=>{clearInterval(poll);reject(Error('Native launcher did not initialize'));},8000);})`,
          );
          await evaluate(
            `window.clickNative=async(selector)=>{const button=document.querySelector(selector);await button.updateComplete;button.click();await new Promise(resolve=>setTimeout(resolve,100));};clickNative('#qap-fab').then(()=>clickNative('.qap-create-default-profile'))`,
          );
          await evaluate(`customElements.whenDefined('qap-dialog')`);
          await evaluate(`clickNative('.qap-head-button')`);
          // Close the initial chooser and reopen after lazy controls have loaded.
          await evaluate(`new Promise(resolve=>setTimeout(resolve,600))`);
          if (!functionalOnly) {
            await verifyNativeControlParity(evaluate);
            await verifyStateIconParity(evaluate, nativeDarkTheme);
            // The reference selector loads HA's radio/chip dependencies. Production
            // no longer loads that selector, so initialize it explicitly for parity.
            await verifySelectSelectorParity(evaluate, nativeDarkTheme);
            await verifySimpleParity(evaluate, nativeDarkTheme, send);
            await verifyEntitySelectorParity(evaluate, nativeDarkTheme);
            await verifyAttributesViewerParity(evaluate, nativeDarkTheme);
            await verifyDialogParity(evaluate);
          }
          await evaluate(
            `document.querySelector('#qap-fab').focus();document.querySelector('#qap-fab').click();new Promise(resolve=>setTimeout(resolve,150))`,
          );
          assert.equal(
            await evaluate(`document.querySelector('.qap-home-dialog').localName`),
            "qap-dialog",
          );
          if (width === 390) await verifyTouchSearch({ evaluate, send });
          await evaluate(`clickNative('.qap-head-actions [title="Settings"]')`);
          assert.equal(
            await evaluate(`document.querySelector('qap-dialog').headerTitle`),
            "Settings",
          );
          assert.equal(
            await evaluate(`document.querySelector('.qap-head')===null`),
            true,
            "HA renders the header outside the body",
          );
          assert.equal(
            await evaluate(`document.querySelector('.qap-head-button').slot`),
            "headerNavigationIcon",
          );
          assert.equal(
            await evaluate(`document.querySelector('.qap-head-actions').slot`),
            "headerActionItems",
          );
          const nativeSurface = await evaluate(
            `document.querySelector('qap-dialog').shadowRoot.querySelector('dialog.sheet')?'sheet':'dialog'`,
          );
          assert.equal(nativeSurface, width <= 870 ? "sheet" : "dialog");
          await verifyNativeSettingsViews({ evaluate, send, width });
          await evaluate(`clickNative('.qap-settings-visibility')`);
          const nativeLayout =
            await evaluate(`(() => {const shell=document.querySelector('.qap-shell'),body=shell.querySelector('.qap-body'),footer=document.querySelector('.qap-settings-footer'),save=footer.querySelector('.qap-save-settings');
        return {footer:footer.localName,slot:save.slot,footerSlot:footer.slot,parent:footer.parentElement.localName,overlap:body.getBoundingClientRect().bottom>footer.getBoundingClientRect().top+1,overflow:shell.scrollWidth>shell.clientWidth,visible:save.getBoundingClientRect().bottom<=innerHeight};})()`);
          assert.deepEqual(nativeLayout, {
            footer: "div",
            slot: "primaryAction",
            footerSlot: "footer",
            parent: "qap-dialog",
            overlap: false,
            overflow: false,
            visible: true,
          });
          assert.ok(
            await evaluate(
              `parseFloat(getComputedStyle(document.querySelector('.qap-settings-footer')).paddingRight)>=16`,
            ),
            "HA supplies footer spacing",
          );
          await evaluate(
            `window.nativeDraft=document.querySelector('textarea');nativeDraft.value='/unsaved/*';nativeDraft.dispatchEvent(new Event('input',{bubbles:true}));window.confirm=()=>{throw Error('Use the confirmation modal');};clickNative('.qap-head-button');`,
          );
          assert.equal(
            await evaluate(`document.querySelector('.qap-discard-changes-confirmation').open`),
            true,
          );
          await evaluate(
            `clickNative('.qap-discard-changes-confirmation .qap-button:not(.qap-button-danger)')`,
          );
          assert.equal(
            await evaluate(`document.querySelector('textarea')===window.nativeDraft`),
            true,
          );
          assert.equal(
            await evaluate(`document.querySelector('qap-dialog').preventScrimClose`),
            true,
          );
          await evaluate(`nativeDraft.focus()`);
          await send("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "Escape",
            code: "Escape",
            windowsVirtualKeyCode: 27,
          });
          await send("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "Escape",
            code: "Escape",
            windowsVirtualKeyCode: 27,
          });
          await send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: 1,
            y: 1,
            button: "left",
            clickCount: 1,
          });
          await send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: 1,
            y: 1,
            button: "left",
            clickCount: 1,
          });
          await evaluate(`new Promise(resolve=>setTimeout(resolve,250))`);
          assert.equal(
            await evaluate(
              `document.querySelector('textarea')===window.nativeDraft&&nativeDraft.value==='/unsaved/*'`,
            ),
            true,
          );
          await evaluate(
            `window.settingsSurface=document.querySelector('qap-dialog');clickNative('.qap-head-button').then(()=>clickNative('.qap-discard-changes-confirmation .qap-button-danger')).then(()=>clickNative('.qap-back-settings'))`,
          );
          assert.equal(
            await evaluate(
              `document.querySelector('.qap-home-dialog')===window.settingsSurface&&window.settingsSurface.open&&window.settingsSurface.headerTitle==='Quick Access'`,
            ),
            true,
          );
          await verifyNativeFilterFields({ evaluate });
          await evaluate(
            `clickNative('.qap-head-button').then(()=>new Promise(resolve=>setTimeout(resolve,600)))`,
          );
          assert.equal(await evaluate(`document.querySelector('qap-dialog')===null`), true);
          assert.deepEqual(await evaluate("window.nativeErrors"), []);
          await evaluate(
            `window.setIntegrationEnabled(false);document.querySelector('hc-main').remove();`,
          );
          for (const sidebar of width > 870 ? [56, 256] : [0]) {
            await evaluate(`panel.style.marginInlineStart='${sidebar}px'`);
            const layout = await evaluate(`(()=>{
          const content=panel.shadowRoot.querySelector('main'),main=content;
          const toolbar=panel.shadowRoot.querySelector('header').getBoundingClientRect();
          const rect=main.getBoundingClientRect();
          content.scrollTop=content.scrollHeight;
          const last=main.lastElementChild.getBoundingClientRect();
          return {overflow:content.scrollWidth>content.clientWidth,scrolls:content.scrollHeight>content.clientHeight,
            hostScrolls:panel.scrollHeight>panel.clientHeight+1,width:rect.width,left:rect.left,right:rect.right,
            toolbarTop:toolbar.top,headerHeight:toolbar.height,contentTop:content.getBoundingClientRect().top,
            lastBottom:last.bottom,contentBottom:content.getBoundingClientRect().bottom};
        })()`);
            assert.equal(layout.overflow, false, JSON.stringify(layout));
            assert.equal(layout.hostScrolls, false, JSON.stringify(layout));
            assert.ok(
              layout.width <= 960 && layout.left >= sidebar && layout.right <= width + 1,
              JSON.stringify(layout),
            );
            assert.ok(
              layout.headerHeight > 0 &&
                layout.contentTop >= layout.toolbarTop + layout.headerHeight - 1,
              JSON.stringify(layout),
            );
            assert.ok(layout.lastBottom <= layout.contentBottom + 1, JSON.stringify(layout));
          }
          await evaluate(
            "window.menuEvents=0;panel.addEventListener('hass-toggle-menu',()=>menuEvents++);panel.shadowRoot.querySelector('.menu').click()",
          );
          assert.equal(await evaluate("window.menuEvents"), 1);
          await evaluate("panel.remove();document.body.append(panel)");
          assert.equal(await evaluate("panel.shadowRoot.querySelectorAll('header').length"), 1);
          await browser.send("Target.closeTarget", { targetId });
        });
    } finally {
      await browser?.close();
      await new Promise((resolve) => server.close(resolve));
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(path.dirname(directory), path.resolve(tmpdir()));
      assert.ok(path.basename(directory).startsWith("quick-access-browser-"));
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

async function launchBrowser(executable, profile) {
  const child = spawn(
    executable,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { windowsHide: true },
  );
  let stderr = "";
  const endpoint = await new Promise((resolve, reject) => {
    // A first launch on a fresh CI machine builds Chromium's caches and can be slow.
    const timeout = setTimeout(
      () => reject(new Error(`Browser startup timed out: ${stderr}`)),
      45000,
    );
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      const url = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
      if (url) {
        clearTimeout(timeout);
        resolve(url);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Browser exited (${code}): ${stderr}`));
    });
  }).catch(async (error) => {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await exited;
    }
    throw error;
  });
  return { child, endpoint };
}

async function connectBrowser(executable, directory) {
  let launched;
  try {
    launched = await launchBrowser(executable, path.join(directory, "profile"));
  } catch (error) {
    // Retry once with a fresh profile; a second failure is a real problem and is reported.
    console.error(`Retrying browser startup after: ${error.message}`);
    launched = await launchBrowser(executable, path.join(directory, "profile-retry"));
  }
  const { child, endpoint } = launched;
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Timed out: ${method}`));
      }, 15000);
      pending.set(requestId, { resolve, reject, timeout });
      socket.send(
        JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }),
      );
    });
  return {
    send,
    async close() {
      // Wait for Chromium to exit before callers delete its profile directory;
      // it keeps writing there during shutdown, which makes removal fail with ENOTEMPTY.
      const exited =
        child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : new Promise((resolve) => child.once("exit", resolve));
      await send("Browser.close").catch(() => {});
      socket.close();
      const forceKill = setTimeout(() => child.kill("SIGKILL"), 10000);
      await exited;
      clearTimeout(forceKill);
    },
  };
}

async function verifyStaticCardParity(evaluate) {
  const samples = await evaluate(`(async()=>{
    const section=panel.shadowRoot.querySelector('.qap-config-card'),original=document.documentElement.style.cssText,results=[];
    const measure=element=>{const style=getComputedStyle(element),rect=element.getBoundingClientRect();return Object.fromEntries([
      ['width',rect.width],['height',rect.height],...['padding','margin','backgroundColor','color','border','borderRadius','boxShadow','backdropFilter','position','font','lineHeight'].map(key=>[key,style[key]])]);};
    for(const theme of [{'card-background-color':'#ffffff','primary-text-color':'#212121'},{'card-background-color':'#1c1c1c','primary-text-color':'#e1e1e1'},
      {'ha-card-background':'#302846','primary-text-color':'#e0d0c0','ha-card-border-width':'2px','ha-card-border-radius':'18px','ha-card-box-shadow':'0 4px 16px #0003','ha-card-backdrop-filter':'blur(2px)'}]){
      document.documentElement.style.cssText=original;for(const [key,value]of Object.entries(theme))document.documentElement.style.setProperty('--'+key,value);
      const native=document.createElement('ha-card');native.className=section.className;
      native.append(...section.childNodes);section.replaceWith(native);await native.updateComplete;
      await Promise.allSettled(native.getAnimations().map(animation=>animation.finished));const expected=measure(native);
      section.append(...native.childNodes);native.replaceWith(section);await new Promise(resolve=>requestAnimationFrame(resolve));
      await Promise.allSettled(section.getAnimations().map(animation=>animation.finished));results.push({native:expected,owned:measure(section)});
    }
    document.documentElement.style.cssText=original;return results;
  })()`);
  for (const sample of samples)
    assert.deepEqual(sample.owned, sample.native, `static card: ${JSON.stringify(sample)}`);
  assert.equal(
    await evaluate(
      `getComputedStyle(panel.shadowRoot.querySelector('.qap-config-card')).transitionDuration`,
    ),
    "0s",
  );
}

async function verifyDialogParity(evaluate) {
  const samples = await evaluate(`(async()=>{
    await customElements.whenDefined('ha-adaptive-dialog');
    const samples=[];
    for(const [background,text] of [['#ffffff','#212121'],['#1c1c1c','#e1e1e1'],['#203040','#e0d0c0']]){
      const reference=document.createElement('ha-adaptive-dialog');reference.className='qap-adaptive qap-native-layout qap-settings-dialog';
      reference.style.setProperty('--card-background-color',background);reference.style.setProperty('--primary-text-color',text);
      reference.headerTitle='Settings';reference.hideCloseButton=true;reference.width='large';reference.innerHTML='<div class="qap-shell" style="height:100px">Content</div>';
      reference.addEventListener('context-request',event=>{if(event.context==='narrowViewport'){event.stopPropagation();event.callback(innerWidth<=870);}});
      const owned=document.createElement('qap-dialog');owned.className=reference.className;owned.style.cssText=reference.style.cssText;
      owned.headerTitle='Settings';owned.width='large';owned.adaptive=true;owned.withoutHeader=false;owned.innerHTML=reference.innerHTML;
      document.body.append(reference,owned);reference.open=true;owned.showModal();
      await new Promise(resolve=>setTimeout(resolve,350));
      const find=(root,selector)=>{const direct=root.querySelector(selector);if(direct)return direct;for(const child of root.querySelectorAll('*'))if(child.shadowRoot){const found=find(child.shadowRoot,selector);if(found)return found;}return null;};
      const measure=(host,native)=>{
        const dialog=find(host.shadowRoot,'dialog');
        const body=native&&innerWidth<=870?find(host.shadowRoot,'[part="body"]'):dialog;
        const style=getComputedStyle(body),rect=body.getBoundingClientRect();
        return {width:rect.width,height:rect.height,radius:style.borderRadius,background:style.backgroundColor,color:getComputedStyle(host.querySelector(".qap-shell")).color,shadow:getComputedStyle(dialog).boxShadow};
      };
      samples.push({native:measure(reference,true),owned:measure(owned,false)});
      owned.remove();reference.remove();
    }
    return samples;
  })()`);
  for (const sample of samples) {
    assert.ok(Math.abs(sample.native.width - sample.owned.width) < 1, JSON.stringify(sample));
    assert.ok(Math.abs(sample.native.height - sample.owned.height) < 1, JSON.stringify(sample));
    for (const property of ["radius", "background", "color", "shadow"])
      assert.equal(
        sample.owned[property],
        sample.native[property],
        property + " " + JSON.stringify(sample),
      );
  }
}

async function verifyNativeControlParity(evaluate) {
  const result = await evaluate(`(async()=>{
    const fixture=document.createElement('section');fixture.style.cssText='display:grid;gap:8px;width:280px';document.body.append(fixture);
    fixture.innerHTML='<ha-button appearance="outlined" variant="brand">Compare</ha-button><qap-button appearance="outlined" variant="brand">Compare</qap-button><ha-icon-button label="Native icon"></ha-icon-button><qap-icon-button label="Owned icon"></qap-icon-button><ha-select></ha-select><qap-select></qap-select><ha-switch></ha-switch><qap-checkbox switch></qap-checkbox><qap-icon class="qap-icon" icon="mdi:cog"></qap-icon>';
    const controls=[...fixture.children];controls[4].label=controls[5].label='Choice';controls[4].options=controls[5].options=[{value:'a',label:'A'}];controls[4].value=controls[5].value='a';
    await Promise.all(controls.map(control=>control.updateComplete));
    const appearance=element=>{const base=element.shadowRoot.querySelector('button, a'),style=getComputedStyle(base);return {height:base.getBoundingClientRect().height,font:style.fontSize,weight:style.fontWeight,radius:style.borderRadius,color:style.color,background:style.backgroundColor,border:style.borderTopWidth,borderColor:style.borderTopColor};};
    const result={native:appearance(controls[0]),owned:appearance(controls[1]),icons:[controls[2].getBoundingClientRect().height,controls[3].getBoundingClientRect().height],fields:[controls[4].getBoundingClientRect().height,controls[5].getBoundingClientRect().height],switches:[controls[6].getBoundingClientRect().height,controls[7].getBoundingClientRect().height]};
    const nativeAlert=document.createElement('ha-alert'),ownedAlert=document.createElement('qap-alert');
    nativeAlert.textContent=ownedAlert.textContent='Example alert';fixture.append(nativeAlert,ownedAlert);result.alerts=[];
    const alertAppearance=(element,native)=>{
      const base=element.shadowRoot.querySelector(native?'.issue-type':'[part="base"]'),icon=element.shadowRoot.querySelector(native?'.icon':'[part="icon"]'),message=element.shadowRoot.querySelector(native?'.main-content':'[part="message"]');
      const style=getComputedStyle(base),tint=getComputedStyle(base,'::after'),text=getComputedStyle(message);
      return {height:base.getBoundingClientRect().height,padding:style.padding,color:text.color,lineHeight:text.lineHeight,margin:text.marginInline,iconColor:getComputedStyle(icon).color,tint:tint.backgroundColor,opacity:tint.opacity,radius:tint.borderRadius};
    };
    for(const type of ['error','warning','info','success']){
      nativeAlert.alertType=ownedAlert.alertType=type;await Promise.all([nativeAlert.updateComplete,ownedAlert.updateComplete]);
      const nativeIcon=nativeAlert.shadowRoot.querySelector('ha-svg-icon');await nativeIcon.updateComplete;const expectedPath=nativeIcon.shadowRoot.querySelector('path').getAttribute('d');let ownedIcon;
      for(let attempt=0;attempt<50;attempt++){ownedIcon=ownedAlert.shadowRoot.querySelector('qap-icon').querySelector('ha-icon')?.shadowRoot?.querySelector('ha-svg-icon');if(ownedIcon?.shadowRoot?.querySelector('path')?.getAttribute('d')===expectedPath)break;await new Promise(resolve=>setTimeout(resolve,20));}
      result.alerts.push({type,native:alertAppearance(nativeAlert,true),owned:alertAppearance(ownedAlert,false),nativeIcon:expectedPath,ownedIcon:ownedIcon?.shadowRoot?.querySelector('path')?.getAttribute('d')});
    }
    result.tokens=Object.fromEntries(['--wa-color-on-normal','--wa-color-brand-on-normal','--ha-color-on-primary-normal','--ha-color-on-primary-quiet','--wa-color-fill-normal','--wa-color-brand-fill-normal'].map(token=>[token,controls.slice(0,2).map(control=>getComputedStyle(control).getPropertyValue(token))]));
    const originalStyle=document.documentElement.style.cssText;result.variants=[];
    for(const theme of [{},${JSON.stringify(nativeDarkTheme)},{'primary-color':'#805ad5','ha-color-fill-primary-loud-resting':'#805ad5','ha-color-on-primary-loud':'#ffffff'}]){
      document.documentElement.style.cssText=originalStyle;
      for(const [token,value]of Object.entries(theme))document.documentElement.style.setProperty('--'+token,value);
      for(const variant of ['brand','danger'])for(const mode of ['outlined','plain','filled','accent']){
        for(const control of controls.slice(0,2)){control.variant=variant;control.appearance=mode;}
        await Promise.all(controls.slice(0,2).map(control=>control.updateComplete));
        result.variants.push({variant,mode,native:appearance(controls[0]),owned:appearance(controls[1])});
        for(const control of controls.slice(0,2))control.disabled=true;
        await Promise.all(controls.slice(0,2).map(control=>control.updateComplete));
        result.variants.push({variant,mode:mode+' disabled',native:appearance(controls[0]),owned:appearance(controls[1])});
        for(const control of controls.slice(0,2))control.disabled=false;
      }
    }
    document.documentElement.style.cssText=originalStyle;
    for(const [index,control] of controls.slice(0,2).entries()){
      control.variant='brand';control.appearance='outlined';const icon=document.createElement(index?'qap-icon':'ha-icon');icon.className='qap-icon';icon.setAttribute('icon','mdi:cog');icon.slot='start';control.append(icon);
    }
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    result.leading=controls.slice(0,2).map(control=>{const base=control.shadowRoot.querySelector('button'),label=control.shadowRoot.querySelector('[part~="label"]');return {icon:control.querySelector('.qap-icon').getBoundingClientRect().left-base.getBoundingClientRect().left,label:label.getBoundingClientRect().left-base.getBoundingClientRect().left,width:label.getBoundingClientRect().width,gap:getComputedStyle(base).gap,spacing:getComputedStyle(base).letterSpacing,padding:getComputedStyle(base).padding,family:getComputedStyle(base).fontFamily};});
    for(let attempt=0;attempt<50;attempt++){const svg=controls[8].querySelector('ha-icon')?.shadowRoot?.querySelector('ha-svg-icon');if(svg?.shadowRoot?.querySelector('path')?.getAttribute('d')){result.iconResolved=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
    const nativeInput=document.createElement('ha-input'),ownedInput=document.createElement('qap-input');fixture.append(nativeInput,ownedInput);
    nativeInput.label=ownedInput.label='Name';nativeInput.value=ownedInput.value='Example';await Promise.all([nativeInput.updateComplete,ownedInput.updateComplete]);await nativeInput.shadowRoot.querySelector('wa-input').updateComplete;
    const fieldAppearance=(host,native)=>{
      const field=native?host.shadowRoot.querySelector('wa-input').shadowRoot:host.shadowRoot;
      const base=field.querySelector(native?'[part~="base"]':'input'),input=field.querySelector('input'),label=native?host.shadowRoot.querySelector('slot[name="label"]'):field.querySelector('label > span');
      const style=getComputedStyle(base),text=getComputedStyle(input),caption=getComputedStyle(label),r=base.getBoundingClientRect(),l=(()=>{const range=document.createRange();range.selectNodeContents(label);return range.getBoundingClientRect();})();
      return {height:r.height,radius:style.borderRadius,background:style.backgroundColor,font:text.fontSize,family:text.fontFamily,weight:text.fontWeight,color:text.color,labelFont:caption.fontSize,labelLine:caption.lineHeight,labelColor:caption.color,labelX:l.x-r.x,labelY:l.y-r.y};
    };
    result.inputs={native:fieldAppearance(nativeInput,true),owned:fieldAppearance(ownedInput,false)};
    const pickerField=controls[4].shadowRoot.querySelector('ha-picker-field');await pickerField.updateComplete;const nativeBase=pickerField.shadowRoot.querySelector('ha-combo-box-item');await nativeBase.updateComplete;
    const selectAppearance=(host,native)=>{const base=native?nativeBase:host.shadowRoot.querySelector('select'),label=native?pickerField.shadowRoot.querySelector('[slot="overline"]'):host.shadowRoot.querySelector('label > span'),value=native?pickerField.shadowRoot.querySelector('[slot="headline"]'):base;const b=getComputedStyle(base),l=getComputedStyle(label),v=getComputedStyle(value),r=base.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(label);const box=range.getBoundingClientRect();return {height:r.height,radius:b.borderRadius,background:b.backgroundColor,labelFont:l.fontSize,labelLine:l.lineHeight,labelColor:l.color,labelX:box.x-r.x,labelY:box.y-r.y,valueFont:v.fontSize,valueLine:v.lineHeight,color:v.color};};
    result.selects={native:selectAppearance(controls[4],true),owned:selectAppearance(controls[5],false)};
    fixture.remove();return result;
  })()`);
  console.log("FIELD METRICS", JSON.stringify({ inputs: result.inputs, selects: result.selects }));
  assert.deepEqual(
    result.owned,
    result.native,
    "owned button matches the actual HA dimensions, type and theme: " +
      JSON.stringify(result.tokens),
  );
  assert.equal(result.icons[0], result.icons[1], "native icon button dimensions");
  assert.equal(result.fields[0], result.fields[1], "native field dimensions");
  assert.equal(result.switches[0], result.switches[1], "native switch dimensions");
  assert.equal(
    result.iconResolved,
    true,
    "HA resolves the wrapper's mdi icon into its own SVG renderer",
  );
  for (const sample of result.variants)
    assert.deepEqual(sample.owned, sample.native, `${sample.variant} ${sample.mode} theme parity`);
  assert.deepEqual(result.leading[1], result.leading[0], "native leading-icon spacing");
  for (const alert of result.alerts) {
    assert.deepEqual(alert.owned, alert.native, `${alert.type} native alert appearance`);
    assert.equal(alert.ownedIcon, alert.nativeIcon, `${alert.type} native alert icon`);
  }
}

async function waitForBrowser(evaluate, condition) {
  await evaluate(`(async()=>{
    for(let attempt=0;attempt<100;attempt++){
      if(${condition})return;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw Error(${JSON.stringify(`Browser state did not settle: ${condition}`)});
  })()`);
}

// HA's published dark color and semantic tokens, limited to these screens.
// Custom theme values exercise the same inherited-variable contract.
const nativeDarkTheme = {
  "primary-background-color": "#111111",
  "card-background-color": "#1c1c1c",
  "secondary-background-color": "#282828",
  "primary-text-color": "#e1e1e1",
  "secondary-text-color": "#9b9b9b",
  "divider-color": "rgba(225,225,225,.12)",
  "input-fill-color": "rgba(255,255,255,.05)",
  "input-ink-color": "rgba(255,255,255,.87)",
  "input-label-ink-color": "rgba(255,255,255,.6)",
  "ha-color-text-primary": "var(--white-color)",
  "ha-color-text-secondary": "var(--ha-color-neutral-80)",
  "ha-color-fill-primary-quiet-resting": "var(--ha-color-primary-05)",
  "ha-color-fill-primary-quiet-hover": "var(--ha-color-primary-10)",
  "ha-color-fill-primary-normal-resting": "var(--ha-color-primary-10)",
  "ha-color-fill-primary-normal-hover": "var(--ha-color-primary-20)",
  "ha-color-fill-primary-normal-active": "var(--ha-color-primary-10)",
  "ha-color-on-primary-normal": "var(--ha-color-primary-60)",
  "ha-color-on-primary-quiet": "var(--ha-color-primary-70)",
  "ha-color-fill-neutral-quiet-resting": "var(--ha-color-neutral-05)",
  "ha-color-fill-neutral-quiet-hover": "var(--ha-color-neutral-10)",
  "ha-color-fill-neutral-normal-resting": "var(--ha-color-neutral-10)",
  "ha-color-fill-neutral-normal-hover": "var(--ha-color-neutral-20)",
  "ha-color-fill-neutral-normal-active": "var(--ha-color-neutral-10)",
  "ha-color-on-neutral-normal": "var(--ha-color-neutral-60)",
  "ha-color-on-neutral-quiet": "var(--ha-color-neutral-70)",
  "ha-color-surface-default": "#1c1c1c",
  "ha-color-surface-low": "#282828",
  "ha-color-form-background": "#282828",
  "ha-color-border-neutral-quiet": "var(--ha-color-neutral-40)",
};

async function assertMobileDialogPosition(evaluate, selector) {
  const position = await evaluate(`(async()=>{
    if(!matchMedia('(max-width: 870px), (max-height: 500px)').matches)return null;
    const dialog=document.querySelector(${JSON.stringify(selector)});
    const sheet=dialog.shadowRoot?.querySelector('dialog.sheet');
    const nativeDialog=dialog.shadowRoot?.querySelector('dialog:not(.sheet)');
    if(nativeDialog&&innerWidth>450&&innerHeight>500)return null;
    const surface=sheet||nativeDialog||dialog;
    const expectedTop=nativeDialog?0:Math.max(48,parseFloat(getComputedStyle(dialog).getPropertyValue('--safe-area-inset-top'))||0);
    for(let attempt=0;attempt<50;attempt++){
      const rect=surface.getBoundingClientRect();
      if(Math.abs(rect.top-expectedTop)<1&&Math.abs(rect.bottom-innerHeight)<1)break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    const rect=surface.getBoundingClientRect();
    return {top:rect.top,bottom:rect.bottom,expectedTop,height:innerHeight};
  })()`);
  if (!position) return;
  assert.ok(
    Math.abs(position.top - position.expectedTop) < 1,
    `${selector}: ${JSON.stringify(position)}`,
  );
  assert.ok(
    Math.abs(position.bottom - position.height) < 1,
    `${selector}: ${JSON.stringify(position)}`,
  );
}

async function assertFixedFormActions(evaluate, selector, bodySelector) {
  const layout = await evaluate(`(async()=>{
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const form=document.querySelector(${JSON.stringify(selector)}),body=form.querySelector(${JSON.stringify(bodySelector)}),footer=form.querySelector('.qap-form-actions');
    const dialog=form.closest('.qap-editor-dialog');
    const surface=dialog.shadowRoot?.querySelector('dialog')||dialog;
    const before=footer.getBoundingClientRect();body.scrollTop=body.scrollHeight;
    const after=footer.getBoundingClientRect();
    return {bodyVisible:body.clientHeight>=44,overflow:body.scrollWidth>body.clientWidth,
      atBottom:Math.abs(after.bottom-surface.getBoundingClientRect().bottom)<=1,
      stable:Math.abs(before.top-after.top)<1,visible:after.top>=0&&after.bottom<=innerHeight+1,
      overlap:body.getBoundingClientRect().bottom>after.top+1,
      actionsVisible:[...footer.children].every(action=>{const rect=action.getBoundingClientRect();return rect.top>=after.top&&rect.bottom<=after.bottom&&rect.left>=0&&rect.right<=innerWidth;})};
  })()`);
  const bounds = layout.visible
    ? null
    : await evaluate(`(()=>{
    const form=document.querySelector(${JSON.stringify(selector)});
    return [form,...form.querySelectorAll('.qap-shell,.qap-body,.qap-categories-manager,.qap-category-list,.qap-category-form,.qap-form-body,.qap-form-actions')].map(node=>({
      className:node.className,top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom,height:node.clientHeight,
      flex:getComputedStyle(node).flex,overflow:getComputedStyle(node).overflowY}));
  })()`);
  assert.deepEqual(
    layout,
    {
      bodyVisible: true,
      overflow: false,
      atBottom: true,
      stable: true,
      visible: true,
      overlap: false,
      actionsVisible: true,
    },
    `${selector}: ${JSON.stringify(bounds)}`,
  );
  const actionOrder = await evaluate(`(() => {
    const footer=document.querySelector(${JSON.stringify(selector)}).querySelector('.qap-form-actions');
    const cancel=[...footer.children].find(action=>action.textContent.trim()==='Cancel');
    const save=footer.querySelector('.qap-button-primary');
    return !cancel||!save||cancel.getBoundingClientRect().right<=save.getBoundingClientRect().left;
  })()`);
  assert.equal(
    actionOrder,
    true,
    `${selector}: Cancel must be to the left of Save: ` +
      JSON.stringify(
        await evaluate(
          `(()=>{const footer=document.querySelector(${JSON.stringify(selector)}).querySelector('.qap-form-actions');return [...footer.children].map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON(),basis:getComputedStyle(e).flexBasis,min:getComputedStyle(e).minWidth}));})()`,
        ),
      ),
  );
}

async function verifyNativeSettingsViews({ evaluate, send, width }) {
  await evaluate(`window.reviewThemeStyle=document.documentElement.style.cssText;
    window.reviewProfiles=structuredClone(window.testProfiles.profiles);
    window.testProfiles.profiles[0].name='Phone';window.testProfiles.profiles[0].icon='mdi:cellphone';window.publishProfiles();
    window.nativeScrollAreas=()=>{const areas=[];const walk=node=>{if(node instanceof HTMLElement&&node.localName!=='textarea'&&node.clientHeight>0&&node.scrollHeight>node.clientHeight+1&&['auto','scroll'].includes(getComputedStyle(node).overflowY))areas.push(node);if(node.shadowRoot)walk(node.shadowRoot);for(const child of node.children||[])walk(child);};walk(document.querySelector('qap-dialog'));return areas;};`);
  const themes = [
    { name: "light", dark: false, values: {} },
    { name: "dark", dark: true, values: nativeDarkTheme },
    {
      name: "custom",
      dark: false,
      values: {
        "primary-color": "#6f42a6",
        "card-background-color": "#f9f6ff",
        "primary-background-color": "#eee8f4",
        "primary-text-color": "#2c2140",
        "secondary-text-color": "#685b79",
        "divider-color": "#d9cee4",
        "ha-color-fill-primary-quiet-resting": "#eee3fb",
        "ha-color-fill-primary-loud-resting": "#6f42a6",
        "ha-color-fill-primary-normal-resting": "#e8d9fa",
        "ha-color-on-primary-normal": "#6f42a6",
        "ha-color-fill-neutral-normal-resting": "#e8e0ef",
        "ha-color-on-neutral-normal": "#564565",
      },
    },
  ];
  for (const theme of themes) {
    await evaluate(`document.documentElement.style.cssText=window.reviewThemeStyle;document.documentElement.style.colorScheme=${JSON.stringify(theme.dark ? "dark" : "light")};
      for(const [key,value] of Object.entries(${JSON.stringify(theme.values)}))document.documentElement.style.setProperty('--'+key,value);
      new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    assert.equal(await evaluate(`document.querySelector('qap-dialog').headerTitle`), "Settings");
    assert.equal(await evaluate(`document.querySelectorAll('.qap-settings-list').length`), 2);
    assert.deepEqual(
      await evaluate(`Array.from(document.querySelectorAll('.qap-settings-row'),row=>{
      const badge=row.querySelector('.qap-settings-icon'),style=getComputedStyle(badge),rect=badge.getBoundingClientRect();
      return {tag:row.localName,list:row.parentElement.localName,slots:[badge.slot,row.querySelector('.qap-settings-row-text').slot,row.lastElementChild.slot],
        white:getComputedStyle(badge.querySelector('ha-icon')).color==='rgb(255, 255, 255)',colored:style.backgroundColor!=='rgba(0, 0, 0, 0)',round:style.borderRadius==='50%',size:[Math.round(rect.width),Math.round(rect.height)]};
    })`),
      [false, true, true, true].map((colored) => ({
        tag: "qap-list-item",
        list: "qap-list",
        slots: ["start", "content", "end"],
        white: colored,
        colored,
        round: true,
        size: [40, 40],
      })),
    );
    assert.equal(
      await evaluate(
        `document.querySelector('.qap-settings-overview').scrollWidth>document.querySelector('.qap-settings-overview').clientWidth`,
      ),
      false,
    );
    if (theme.name === "light") {
      await evaluate(`document.querySelector('.qap-settings-profiles').focus()`);
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        text: "\r",
        unmodifiedText: "\r",
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
      });
    } else await evaluate(`clickNative('.qap-settings-profiles')`);
    assert.equal(await evaluate(`document.querySelectorAll('.qap-profile-row').length`), 1);
    await assertMobileDialogPosition(evaluate, ".qap-settings-dialog");
    assert.deepEqual(
      await evaluate(
        `(()=>{const action=document.querySelector('.qap-head-actions .qap-create-profile');return [action.localName,action.querySelector('ha-icon').getAttribute('icon'),action.label,action.parentElement.slot];})()`,
      ),
      ["qap-icon-button", "mdi:plus", "Create profile", "headerActionItems"],
    );
    await evaluate(
      `clickNative('.qap-current-profile .qap-profile-overflow').then(()=>clickNative('.qap-delete-profile'))`,
    );
    const deletionLayout = await evaluate(
      `(()=>{const modal=document.querySelector('.qap-delete-profile-confirmation'),surface=modal.shadowRoot.querySelector('dialog'),shell=modal.querySelector('.qap-shell'),rect=surface.getBoundingClientRect();return {height:rect.height,contentHeight:shell.getBoundingClientRect().height,top:rect.top,bottom:rect.bottom,overflow:surface.scrollWidth>surface.clientWidth,role:surface.getAttribute('role')};})()`,
    );
    assert.equal(deletionLayout.role, "alertdialog");
    assert.ok(
      deletionLayout.height <= deletionLayout.contentHeight + 1,
      `delete profile confirmation fits its content: ${JSON.stringify(deletionLayout)}`,
    );
    assert.ok(
      deletionLayout.top >= 0 && deletionLayout.bottom <= 845 && !deletionLayout.overflow,
      JSON.stringify(deletionLayout),
    );
    await evaluate(
      `clickNative('.qap-delete-profile-confirmation .qap-form-actions qap-button:not(.qap-button-danger)')`,
    );
    assert.equal(
      await evaluate(`document.querySelector('.qap-delete-profile-confirmation')`),
      null,
    );
    assert.equal(
      await evaluate(
        `document.activeElement===document.querySelector('.qap-current-profile .qap-profile-overflow')&&window.testProfiles.profiles.length===1`,
      ),
      true,
      "Cancel preserves the profile and returns focus",
    );
    await evaluate(`(()=>{window.testProfiles.limits.max_profiles=100;const phone=window.testProfiles.profiles[0];
      for(let i=1;i<100;i++)window.testProfiles.profiles.push({...structuredClone(phone),id:'review-'+i,name:i===1?'Desktop':i===2?'Tablet':('Profile '+i+' ').padEnd(80,'x')});window.publishProfiles();
      return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));})()`);
    assert.equal(await evaluate(`document.querySelectorAll('.qap-profile-row').length`), 100);
    const scrolling =
      await evaluate(`(()=>{const areas=nativeScrollAreas(),nav=document.querySelector('.qap-head-button'),create=document.querySelector('.qap-create-profile');const before=[nav.getBoundingClientRect().top,create.getBoundingClientRect().top];
      if(areas.length===1)areas[0].scrollTop=areas[0].scrollHeight;
      return {count:areas.length,inner:getComputedStyle(document.querySelector('.qap-body')).overflowY,stable:before[0]===nav.getBoundingClientRect().top&&before[1]===create.getBoundingClientRect().top,overflow:document.querySelector('.qap-profile-list').scrollWidth>document.querySelector('.qap-profile-list').clientWidth,visible:create.getBoundingClientRect().bottom<=innerHeight,last:areas.length===1&&document.querySelector('.qap-profile-list .qap-profile-row:last-child').getBoundingClientRect().bottom<=areas[0].getBoundingClientRect().bottom};})()`);
    assert.deepEqual(
      scrolling,
      { count: 1, inner: "auto", stable: true, overflow: false, visible: true, last: true },
      `${width}px ${theme.name}`,
    );
    await evaluate(
      `nativeScrollAreas()[0].scrollTop=0;new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
    );
    await evaluate(`clickNative('.qap-current-profile .qap-profile-overflow')`);
    assert.equal(await evaluate(`document.querySelector('.qap-profile-dropdown').open`), true);
    await evaluate(
      `new Promise((resolve,reject)=>{const start=performance.now();const poll=()=>{const menu=document.querySelector('.qap-profile-dropdown');if(menu?.contains(document.activeElement)){resolve();return;}if(performance.now()-start>2000){reject(Error('Native menu did not receive focus'));return;}setTimeout(poll,20);};poll();})`,
    );
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await evaluate(
      `new Promise((resolve,reject)=>{const start=performance.now();const poll=()=>{const menu=document.querySelector('.qap-profile-dropdown');if(!menu||!menu.open){resolve();return;}if(performance.now()-start>2000){reject(Error('Native menu did not close on Escape'));return;}setTimeout(poll,20);};poll();})`,
    );
    assert.equal(await evaluate(`document.querySelector('qap-dialog').open`), true);
    assert.equal(
      await evaluate(
        `document.querySelector('.qap-profile-dropdown')===null||!document.querySelector('.qap-profile-dropdown').open`,
      ),
      true,
      JSON.stringify(
        await evaluate(
          `(()=>{const focus=[];let node=document.activeElement;while(node){focus.push(node.localName);node=node.shadowRoot?.activeElement;}return {focus,menu:document.querySelector('.qap-profile-dropdown')?.outerHTML};})()`,
        ),
      ),
    );
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 320,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(
      `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
    );
    await evaluate(`clickNative('.qap-create-profile')`);
    await assertFixedFormActions(evaluate, ".qap-profile-editor", ".qap-body");
    await evaluate(
      `clickNative('.qap-profile-cancel').then(()=>new Promise(resolve=>setTimeout(resolve,550)))`,
    );
    await waitForBrowser(
      evaluate,
      `document.activeElement===document.querySelector('.qap-create-profile')`,
    );
    assert.equal(
      await evaluate(`document.activeElement===document.querySelector('.qap-create-profile')`),
      true,
      JSON.stringify(
        await evaluate(
          `(()=>{let node=document.activeElement;const focus=[];while(node){focus.push([node.localName,node.className]);node=node.shadowRoot?.activeElement;}return {focus,create:document.querySelector('.qap-create-profile')?.outerHTML,editors:[...document.querySelectorAll('.qap-profile-editor')].map(e=>e.open)};})()`,
        ),
      ),
    );
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(
      `window.testProfiles.profiles.splice(1);window.testProfiles.limits.max_profiles=10;window.publishProfiles();clickNative('.qap-head-button')`,
    );
    if (theme.name === "light") {
      await evaluate(`document.querySelector('.qap-settings-shortcuts').focus()`);
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "ArrowDown",
        code: "ArrowDown",
        windowsVirtualKeyCode: 40,
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "ArrowDown",
        code: "ArrowDown",
        windowsVirtualKeyCode: 40,
      });
      assert.equal(
        await evaluate(
          `document.activeElement===document.querySelector('.qap-settings-categories')`,
        ),
        true,
      );
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "ArrowDown",
        code: "ArrowDown",
        windowsVirtualKeyCode: 40,
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "ArrowDown",
        code: "ArrowDown",
        windowsVirtualKeyCode: 40,
      });
      assert.equal(
        await evaluate(
          `document.activeElement===document.querySelector('.qap-settings-visibility')`,
        ),
        true,
      );
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: " ",
        code: "Space",
        windowsVirtualKeyCode: 32,
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: " ",
        code: "Space",
        windowsVirtualKeyCode: 32,
      });
      assert.ok(await evaluate(`document.querySelector('.qap-save-settings')!==null`));
      await evaluate(`clickNative('.qap-head-button')`);
    }
    await evaluate(`clickNative('.qap-settings-shortcuts')`);
    await assertMobileDialogPosition(evaluate, ".qap-settings-dialog");
    if (theme.name === "light") {
      await evaluate(
        `clickNative('.qap-head-button').then(()=>clickNative('.qap-settings-categories')).then(()=>clickNative('.qap-create-category'))`,
      );
      await assertFixedFormActions(evaluate, ".qap-category-modal", ".qap-form-body");
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 320,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await assertFixedFormActions(evaluate, ".qap-category-modal", ".qap-form-body");
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 844,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await evaluate(
        `clickNative('.qap-category-cancel').then(()=>clickNative('.qap-head-button')).then(()=>clickNative('.qap-settings-shortcuts'))`,
      );
    }
    await evaluate(`clickNative('.qap-add-shortcut')`);
    await assertFixedFormActions(evaluate, ".qap-shortcut-form", ".qap-form-body");
    await assertMobileDialogPosition(evaluate, ".qap-settings-dialog");
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 320,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await assertFixedFormActions(evaluate, ".qap-shortcut-form", ".qap-form-body");
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(`clickNative('.qap-cancel-shortcut')`);
    await waitForBrowser(evaluate, `!document.querySelector('.qap-shortcut-form')`);
    if (theme.name === "light" && width <= 870) await verifyNativeCategoryDrag({ evaluate, send });
    if (theme.name === "light" && width === 390)
      await verifyLongReorderLists({ evaluate, send, native: true });
    await evaluate(
      `clickNative('.qap-head-button').then(()=>clickNative('.qap-settings-visibility'))`,
    );
    await assertMobileDialogPosition(evaluate, ".qap-settings-dialog");
    const actions = await evaluate(
      `Array.from(document.querySelectorAll('.qap-current-url-row qap-button'),action=>[action.getAttribute('appearance'),action.getAttribute('variant')])`,
    );
    assert.deepEqual(actions, [
      ["filled", "brand"],
      ["filled", "brand"],
    ]);
    assert.equal(
      await evaluate(
        `document.querySelector('.qap-current-url').scrollWidth>document.querySelector('.qap-current-url').clientWidth`,
      ),
      false,
    );
    // Navigate normally before reopening, so the long current URL is read by
    // the real editor. Restore the sidebar URL before the panel checks resume.
    const longPath = `/config/${"long-section-name/".repeat(12)}yaml`;
    await evaluate(
      `clickNative('.qap-head-button').then(()=>clickNative('.qap-back-settings')).then(()=>clickNative('.qap-head-button')).then(()=>new Promise(resolve=>setTimeout(resolve,550)))`,
    );
    await evaluate(
      `history.replaceState(history.state,'',${JSON.stringify(longPath)});window.dispatchEvent(new Event('location-changed'));clickNative('#qap-fab').then(()=>clickNative('.qap-head-actions [title="Settings"]')).then(()=>clickNative('.qap-settings-visibility'))`,
    );
    assert.equal(
      await evaluate(`document.querySelector('.qap-current-url-path').textContent`),
      longPath,
    );
    assert.equal(await evaluate(`document.querySelector('.qap-current-url-path').title`), longPath);
    assert.equal(
      await evaluate(
        `document.querySelector('.qap-current-url').scrollWidth>document.querySelector('.qap-current-url').clientWidth`,
      ),
      false,
    );
    await evaluate(
      `(()=>{const areas=nativeScrollAreas();if(areas.length)areas[0].scrollTop=areas[0].scrollHeight;})()`,
    );
    await evaluate(
      `clickNative('.qap-head-button').then(()=>clickNative('.qap-back-settings')).then(()=>clickNative('.qap-head-button')).then(()=>new Promise(resolve=>setTimeout(resolve,550)))`,
    );
    await evaluate(
      `history.replaceState(history.state,'','/quick-access-config');window.dispatchEvent(new Event('location-changed'));clickNative('#qap-fab').then(()=>clickNative('.qap-head-actions [title="Settings"]'))`,
    );
  }
  await evaluate(
    `document.documentElement.style.cssText=window.reviewThemeStyle;window.testProfiles.profiles=window.reviewProfiles;window.publishProfiles();`,
  );
}

async function verifyNativeCategoryDrag({ evaluate, send }) {
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const point = (selector) =>
    evaluate(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    );
  const touch = (type, position) =>
    send("Input.dispatchTouchEvent", { type, touchPoints: position ? [position] : [] });
  const pause = () => evaluate(`new Promise(resolve=>setTimeout(resolve,80))`);
  const surface = () =>
    evaluate(
      `(()=>{const dialog=document.querySelector('qap-dialog'),sheet=dialog?.shadowRoot.querySelector('dialog.sheet');return {open:!!dialog?.open,transform:sheet?.style.getPropertyValue('--dialog-transform')||''};})()`,
    );
  await evaluate(
    `clickNative('.qap-head-button').then(()=>{window.nativeCategoryBackup=structuredClone(window.testProfiles.profiles[0].categories);window.testProfiles.profiles[0].categories.push({id:"native-drag",name:"Native drag"});window.publishProfiles();}).then(()=>clickNative('.qap-settings-categories'))`,
  );
  try {
    const original = await evaluate(
      `Array.from(document.querySelectorAll('.qap-edit-item'),item=>item.dataset.id)`,
    );
    assert.equal(
      await evaluate(
        `!document.querySelector('qap-sortable')&&[...document.querySelectorAll('.qap-category-row')].every(row=>!row.hasAttribute('tabindex')&&!row.hasAttribute('aria-keyshortcuts')&&getComputedStyle(row).cursor!=='grab')`,
      ),
      true,
    );
    const start = await point(".qap-edit-item");
    await touch("touchStart", start);
    await evaluate(`new Promise(resolve=>setTimeout(resolve,450))`);
    assert.equal(
      await evaluate(`!!document.querySelector('.qap-dragging, .qap-drag-origin')`),
      false,
      "long press never starts a group drag",
    );
    await touch("touchCancel");
    await pause();
    assert.deepEqual(
      await evaluate(
        `Array.from(document.querySelectorAll('.qap-edit-item'),item=>item.dataset.id)`,
      ),
      original,
    );
    await evaluate(
      `clickNative('[data-id="${original[0]}"] .qap-category-overflow').then(()=>clickNative('.qap-move-down-category')).then(()=>new Promise(resolve=>setTimeout(resolve,150)))`,
    );
    const reordered = [original[1], original[0], ...original.slice(2)];
    assert.deepEqual(
      await evaluate(
        `Array.from(document.querySelectorAll('.qap-edit-item'),item=>item.dataset.id)`,
      ),
      reordered,
    );
    assert.deepEqual(
      await evaluate(`window.testProfiles.profiles[0].categories.map(category=>category.id)`),
      reordered,
    );
    assert.equal(
      await evaluate(`document.querySelector('.qap-drop-highlight')?.dataset.id`),
      original[0],
      "the moved group uses the shared feedback",
    );

    const next = await point(".qap-edit-item");
    await touch("touchStart", next);
    await touch("touchMove", { x: next.x, y: next.y + 24 });
    await pause();
    assert.deepEqual(await surface(), { open: true, transform: "" });
    await touch("touchCancel");
    await pause();
    const heading = await point(".qap-category-row strong");
    await touch("touchStart", heading);
    await touch("touchMove", { x: heading.x, y: heading.y + 24 });
    await pause();
    assert.equal(
      (await surface()).transform,
      "",
      "row scrolling must stay out of the sheet recognizer before long-press activation",
    );
    await touch("touchMove", heading);
    await pause();
    await touch("touchEnd");
    await evaluate(`new Promise(resolve=>setTimeout(resolve,550))`);
    assert.equal((await surface()).open, true);
    assert.equal(await evaluate(`document.querySelector('qap-dialog').headerTitle`), "Groups");
    await evaluate(
      `clickNative('.qap-head-button').then(()=>{window.testProfiles.profiles[0].categories=window.nativeCategoryBackup;delete window.nativeCategoryBackup;window.publishProfiles();}).then(()=>clickNative('.qap-settings-shortcuts'))`,
    );
    await verifyShortcutArrangement({ evaluate, send, touch: true });
  } finally {
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
}

// Category reassignment now belongs to the shortcut editor; every destination remains covered.
async function verifyCategoryReassignment({ evaluate }) {
  const pause = () => evaluate("new Promise(resolve=>setTimeout(resolve,100))");
  const reopen = async () => {
    await evaluate('document.querySelector(".qap-head-button").click()');
    await pause();
    await evaluate('document.querySelector(".qap-settings-shortcuts").click()');
    await pause();
  };
  await evaluate(
    'window.dragProfileBackup=structuredClone(window.testProfiles.profiles[0]);(()=>{const profile=window.testProfiles.profiles[0];profile.categories=[{id:"favorites",name:"Favorites"},{id:"drag-devices",name:"Devices"},{id:"drag-empty",name:"Empty"}];profile.settings.links=profile.settings.links.slice(0,2).map((link,index)=>({...link,group:index?"drag-devices":"favorites"}));window.publishProfiles()})()',
  );
  await reopen();
  const id = await evaluate("window.testProfiles.profiles[0].settings.links[0].id");
  const row = '.qap-edit-item[data-id="' + id + '"] .qap-shortcut-row';
  assert.equal(await evaluate('!!document.querySelector(".qap-shortcut-groups .qap-grip")'), false);
  const original = await evaluate(
    "structuredClone(window.testProfiles.profiles[0].settings.links[0])",
  );
  for (const group of ["drag-devices", "drag-empty", "favorites"]) {
    await evaluate("document.querySelector(" + JSON.stringify(row) + ").click()");
    await pause();
    await evaluate(
      '(()=>{const field=document.querySelector(".qap-category-dropdown qap-select");field.value=' +
        JSON.stringify("category:" + group) +
        ';field.dispatchEvent(new Event("change",{bubbles:true}));})()',
    );
    await evaluate(
      '[...document.querySelectorAll(".qap-shortcut-form .qap-form-actions qap-button")].find(button=>button.textContent==="Save").click()',
    );
    await pause();
    // A transfer is confirmed in the shared confirmation dialog before it is saved.
    assert.equal(
      await evaluate(
        '(()=>{const dialog=document.querySelector(".qap-move-shortcut-confirmation");const move=dialog&&[...dialog.querySelectorAll("qap-button")].find(button=>button.textContent==="Move shortcut");move?.click();return !!move;})()',
      ),
      true,
    );
    await pause();
    const assigned = await evaluate(
      "window.testProfiles.profiles[0].settings.links.filter(link=>link.group===" +
        JSON.stringify(group) +
        ")",
    );
    assert.deepEqual(
      assigned.at(-1),
      { ...original, group },
      "reassignment preserves configuration and appends",
    );
    assert.deepEqual(
      await evaluate(
        "[...document.querySelectorAll(" +
          JSON.stringify('.qap-shortcut-list[data-group="' + group + '"] .qap-edit-item') +
          ")].map(item=>item.dataset.id)",
      ),
      assigned.map((link) => link.id),
    );
  }
  const writes = await evaluate("window.profileWrites.length");
  await evaluate("document.querySelector(" + JSON.stringify(row) + ").click()");
  await pause();
  await evaluate(
    '(()=>{const field=document.querySelector(".qap-category-dropdown qap-select");field.value="category:drag-empty";field.dispatchEvent(new Event("change",{bubbles:true}));document.querySelector(".qap-profile-close").click();})()',
  );
  await pause();
  await evaluate(
    'document.querySelector(".qap-discard-changes-confirmation .qap-button-danger").click()',
  );
  await pause();
  assert.equal(
    await evaluate(
      "window.testProfiles.profiles[0].settings.links.find(link=>link.id===" +
        JSON.stringify(id) +
        ").group",
    ),
    "favorites",
  );
  assert.equal(await evaluate("window.profileWrites.length"), writes);
  assert.equal(await evaluate('document.querySelector("qap-dialog").open'), true);
  await evaluate(
    "window.testProfiles.profiles[0]=window.dragProfileBackup;delete window.dragProfileBackup;window.publishProfiles()",
  );
  await reopen();
}

// Hold a real touch at each viewport edge, then drop onto the newly exposed end.
// The Edit Group arrangement is the only drag-and-drop owner.
async function verifyLongReorderLists({ evaluate, send, native = false }) {
  const click = (selector) =>
    evaluate(
      native
        ? `clickNative(${JSON.stringify(selector)})`
        : `document.querySelector(${JSON.stringify(selector)}).click();new Promise(resolve=>setTimeout(resolve,100))`,
    );
  let touching = false;
  const touch = async (type, point) => {
    await send("Input.dispatchTouchEvent", { type, touchPoints: point ? [point] : [] });
    touching = type === "touchStart" || type === "touchMove";
  };
  const settle = () =>
    evaluate(`(async()=>{
    await new Promise(resolve=>setTimeout(resolve,100));
    await Promise.all([...document.querySelectorAll('.qap-edit-item')].flatMap(row=>row.getAnimations()).map(animation=>animation.finished.catch(()=>{})));
  })()`);
  const verify = async (listSelector, scrollSelector, savedOrder) => {
    await send("Page.bringToFront");
    await evaluate(
      `Promise.all([...document.querySelectorAll('qap-sortable')].map(control=>control.updateComplete))`,
    );
    const original = await evaluate(
      `[...document.querySelector('${listSelector}').children].map(row=>row.dataset.id)`,
    );
    const id = original[0];
    const grid = listSelector === ".qap-arrangement-enabled";
    const handleSelector = `${listSelector} [data-id="${id}"]`;
    for (const down of [true, false]) {
      await evaluate(
        `document.querySelector('${handleSelector}').scrollIntoView({block:'nearest'});new Promise(resolve=>setTimeout(resolve,100))`,
      );
      const start = await evaluate(
        `(()=>{const row=document.querySelector('${handleSelector}'),r=(row.querySelector(':scope > .qap-edit-symbol')||row).getBoundingClientRect();return {x:r.x+${grid ? "r.width/2" : "Math.min(16,r.width/2)"},y:r.y+r.height/2};})()`,
      );
      assert.equal(
        await evaluate(
          `document.elementFromPoint(${start.x},${start.y})?.closest('.qap-edit-item')?.dataset.id`,
        ),
        id,
        `${listSelector}: drag surface is visible at ${JSON.stringify(start)}`,
      );
      const edge = await evaluate(
        `(()=>{const r=document.querySelector('${scrollSelector}').getBoundingClientRect();return {x:${start.x},y:${down ? "r.bottom-10" : "r.top+10"}};})()`,
      );
      const writes = await evaluate(`window.profileWrites.length`);
      await touch("touchStart", start);
      await evaluate(`new Promise(resolve=>setTimeout(resolve,450))`);
      assert.equal(
        await evaluate(`!!document.querySelector('${handleSelector}.qap-dragging')`),
        true,
        `${listSelector}: long press activates on the row surface`,
      );
      const marker = await evaluate(
        `(()=>{const origin=document.querySelector('.qap-drag-origin'),rect=origin?.getBoundingClientRect();return origin?{host:origin.parentElement===document.querySelector('${scrollSelector}'),style:getComputedStyle(origin).borderTopStyle,left:rect.left,top:rect.top,width:rect.width,height:rect.height}:null;})()`,
      );
      assert.ok(marker?.host);
      assert.equal(marker.style, "dashed");
      for (let step = 1; step <= 6; step++) {
        await touch("touchMove", { x: start.x, y: start.y + ((edge.y - start.y) * step) / 6 });
        await settle();
      }
      let reached = false;
      for (let attempt = 0; attempt < 120; attempt++) {
        reached = await evaluate(
          `(()=>{const scroller=document.querySelector('${scrollSelector}');return ${down ? "scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-1" : "scroller.scrollTop===0"};})()`,
        );
        if (reached) break;
        await settle();
      }
      assert.equal(
        reached,
        true,
        `${listSelector}: a stationary touch must scroll to the ${down ? "end" : "start"}: ${JSON.stringify(await evaluate(`(()=>{const scroller=document.querySelector('${scrollSelector}');return {top:scroller.scrollTop,height:scroller.clientHeight,total:scroller.scrollHeight,bounds:scroller.getBoundingClientRect().toJSON(),ghost:!!document.querySelector('.qap-dragging')};})()`))}`,
      );
      assert.equal(
        await evaluate(`window.profileWrites.length`),
        writes,
        "scrolling cannot save a partial order",
      );
      // Measure the rows after their reorder animation.
      await settle();
      const destination = await evaluate(
        `(()=>{const rows=[...document.querySelector('${listSelector}').children];if(rows.${down ? "at(-1)" : "at(0)"}.dataset.id==='${id}')return null;const r=rows.${down ? "at(-1)" : "at(0)"}.getBoundingClientRect();return {x:${start.x},y:${down ? "r.bottom-4" : "r.top+4"}};})()`,
      );
      if (destination) await touch("touchMove", destination);
      await settle();
      await touch("touchEnd");
      await settle();
      assert.equal(await evaluate(`!!document.querySelector('.qap-drag-origin')`), false);
      const expected = down ? [...original.slice(1), id] : original;
      assert.deepEqual(
        await evaluate(savedOrder),
        expected,
        `${listSelector}: the full order must persist`,
      );
      assert.equal(
        await evaluate(`document.querySelector('${scrollSelector}').closest('qap-dialog').open`),
        true,
      );
      assert.equal(
        await evaluate(
          `document.querySelector('qap-dialog')?.shadowRoot.querySelector('dialog.sheet')?.style.getPropertyValue('--dialog-transform')||''`,
        ),
        "",
      );
    }
  };
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await evaluate(`(async()=>{
    window.scrollProfilesBackup=structuredClone(window.testProfiles.profiles);
    const profile=window.testProfiles.profiles[0];profile.categories=[{id:'favorites',name:'Favorites',grid:{columns:1,rows:2}}];
    profile.settings.links=Array.from({length:20},(_,i)=>({...profile.settings.links[0],id:'scroll-link-'+i,name:'Shortcut '+i,group:'favorites',type:'quick-states',path:''}));
    window.publishProfiles();
  })()`);
  try {
    await click(".qap-head-button");
    await click(".qap-settings-categories");
    await click('[data-id="favorites"] .qap-category-edit');
    await verify(
      ".qap-arrangement-enabled",
      ".qap-arrangement",
      `[...document.querySelector('.qap-arrangement-enabled').children].map(item=>item.dataset.id)`,
    );
    await click(".qap-category-cancel");
    await click(".qap-head-button");
    await click(".qap-settings-shortcuts");
  } finally {
    if (touching) await touch("touchCancel");
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await evaluate(
      `window.testProfiles.profiles=window.scrollProfilesBackup;delete window.scrollProfilesBackup;window.publishProfiles()`,
    );
  }
}

function haFixture(rootTag = "home-assistant") {
  const connection = new EventTarget();
  const data = { version: 1, revision: 0, instance_id: "browser-test", profiles: [] };
  const subscribers = new Set();
  const notify = () => {
    for (const callback of subscribers) callback(snapshot());
  };
  function snapshot() {
    data.limits ||= {
      max_profiles: 10,
      max_categories: 20,
      max_user_bytes: 8 * 1024 * 1024,
      max_profile_bytes: 2 * 1024 * 1024,
    };
    data.usage = {
      profiles: data.profiles.length,
      user_bytes: new TextEncoder().encode(
        JSON.stringify({ version: data.version, revision: data.revision, profiles: data.profiles }),
      ).length,
      by_profile: Object.fromEntries(
        data.profiles.map((p) => [
          p.id,
          {
            categories: p.categories.length,
            bytes: new TextEncoder().encode(JSON.stringify(p)).length,
          },
        ]),
      ),
    };
    return structuredClone(data);
  }
  window.publishProfiles = () => {
    data.revision++;
    notify();
  };
  window.publishQuotas = () => notify();
  window.profileWrites = [];
  connection.subscribeMessage = async (callback, message) => {
    if (message.type === "quick_access/subscribe_status") {
      window.setIntegrationEnabled = (enabled) => callback({ enabled, entry_id: "test" });
      window.setIntegrationEnabled(true);
    } else {
      subscribers.add(callback);
      callback(snapshot());
      return () => subscribers.delete(callback);
    }
    return () => {};
  };
  connection.sendMessagePromise = async (message) => {
    window.profileWrites.push(structuredClone(message));
    if (window.failWrite) throw new Error("Simulated storage failure");
    if (message.operation !== "reset_visibility" && message.revision !== data.revision)
      throw { code: "conflict" };
    if (message.operation === "create") data.profiles.push(structuredClone(message.profile));
    else if (message.operation === "reset_visibility") {
      const profile = data.profiles.find((profile) => profile.id === message.profile_id);
      if (!profile) throw { code: "invalid_data", message: "Missing profile" };
      profile.settings = { ...profile.settings, visibility: "exclude", routes: [] };
    } else
      data.profiles[data.profiles.findIndex((profile) => profile.id === message.profile_id)] =
        structuredClone(message.profile);
    data.revision++;
    notify();
    return snapshot();
  };
  const root = document.createElement(rootTag);
  root.hass = {
    connection,
    user: { id: "browser-user" },
    states: {
      "sensor.kitchen": {
        entity_id: "sensor.kitchen",
        state: "123456789012345678901234567890",
        attributes: {
          friendly_name: "A very long friendly name for the kitchen temperature sensor",
          unit_of_measurement: "°C",
        },
      },
      "sensor.unnamed": { entity_id: "sensor.unnamed", state: "on", attributes: {} },
    },
  };
  document.body.append(root);
  const stateSubscribers = new Set();
  root.addEventListener("context-request", (event) => {
    if (
      [
        "hassInternationalization",
        "hassRegistries",
        "hassConfig",
        "hassConnection",
        "hassUi",
      ].includes(event.context)
    ) {
      event.stopPropagation();
      event.callback(root.hass);
      return;
    }
    if (["entities", "devices", "areas", "labels"].includes(event.context)) {
      event.stopPropagation();
      event.callback(root.hass[event.context] || {});
      return;
    }
    if (event.context !== "states") return;
    event.stopPropagation();
    stateSubscribers.add(event.callback);
    event.callback(root.hass.states, () => stateSubscribers.delete(event.callback));
  });
  window.publishStates = (states) => {
    root.hass = { ...root.hass, states };
    for (const callback of stateSubscribers)
      callback(states, () => stateSubscribers.delete(callback));
  };
  window.stateSubscriberCount = () => stateSubscribers.size;
  window.testProfiles = data;
}

function dialogLayout() {
  const dialog = document.querySelector("qap-dialog");
  const shell = dialog.querySelector(".qap-shell");
  const body = dialog.flexContent
    ? shell.querySelector(".qap-body")
    : dialog.shadowRoot.querySelector(".body");
  const grid = shell.querySelector(".qap-tiles");
  const rect = dialog.shadowRoot.querySelector("dialog").getBoundingClientRect();
  return {
    width: rect.width,
    height: rect.height,
    top: rect.top,
    bottom: rect.bottom,
    bodyHeight: body.clientHeight,
    bodyContentHeight: body.scrollHeight,
    shellHeight: shell.getBoundingClientRect().height,
    overflow: body.scrollWidth > body.clientWidth || shell.scrollWidth > shell.clientWidth,
    columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : null,
  };
}

// Runs in Chromium against the real launcher. Measures synchronous update work
// separately from the intentional 250ms batching delay, without timing gates.
async function measureEntityStates() {
  const root = document.querySelector("home-assistant");
  const settle = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const originalTimeout = window.setTimeout;
  const originalSort = Array.prototype.sort;
  const originalName = root.hass.formatEntityName;
  const reports = [];
  let batches = [];
  let nameReads = 0;
  let listSorts = 0;
  let batchComplete;
  window.setTimeout = (callback, ms, ...args) =>
    originalTimeout(() => {
      const start = performance.now();
      callback(...args);
      if (ms === 250) {
        batches.push(performance.now() - start);
        batchComplete?.();
        batchComplete = null;
      }
    }, ms);
  Array.prototype.sort = function (...args) {
    if (this.length > 50) listSorts++;
    return originalSort.apply(this, args);
  };
  root.hass.formatEntityName = (state) => {
    nameReads++;
    return `Translated ${state.entity_id}`;
  };
  try {
    for (const size of [5000, 10000]) {
      const previousSearch = document.querySelector(".qap-search-input");
      previousSearch.value = "";
      previousSearch.dispatchEvent(new Event("input"));
      document.querySelector('[title="Back"]').click();
      const states = Object.fromEntries(
        Array.from({ length: size }, (_, i) => {
          const entity_id = `sensor.entity_${String(i).padStart(5, "0")}`;
          return [
            entity_id,
            { entity_id, state: String(i), attributes: { friendly_name: `Entity ${i}` } },
          ];
        }),
      );
      window.publishStates(states);
      const start = performance.now();
      document.querySelector(".qap-tile").click();
      const openMs = performance.now() - start;
      await settle();
      const search = document.querySelector(".qap-search-input");
      search.value = "Translated";
      search.dispatchEvent(new Event("input"));
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
      await settle();
      batches = [];
      nameReads = 0;
      listSorts = 0;
      await delay(3600);
      const idle = { batches: batches.length, nameReads, listSorts };
      const id = `sensor.entity_${String(size - 1).padStart(5, "0")}`;
      const nextBatch = () =>
        new Promise((resolve) => {
          batchComplete = resolve;
        });
      let done = nextBatch();
      for (let i = 0; i < 100; i++) {
        window.publishStates({
          ...root.hass.states,
          [id]: { ...root.hass.states[id], state: `burst ${i}` },
        });
      }
      await done;
      const burst = { batches: batches.length, nameReads, listSorts };
      batches = [];
      nameReads = 0;
      for (let i = 0; i < 8; i++) {
        done = nextBatch();
        window.publishStates({
          ...root.hass.states,
          [id]: { ...root.hass.states[id], state: `sample ${i}` },
        });
        await done;
      }
      const updateSamplesMs = [...batches].sort((a, b) => a - b);
      const offscreenNameReads = nameReads;
      const stateRow = document.querySelector(".qap-state-row");
      const visibleId = stateRow.dataset.entity;
      stateRow.querySelector(".qap-state-summary").click();
      const modal = document.querySelector(".qap-state-modal");
      done = nextBatch();
      window.publishStates({
        ...root.hass.states,
        [visibleId]: { ...root.hass.states[visibleId], state: "updated" },
      });
      await done;
      const visibleUpdated =
        stateRow.querySelector(".qap-state-value").textContent === "updated" &&
        modal.querySelector(".qap-state-dialog-value").textContent === "updated";
      modal.querySelector('[title="Back"]').click();
      reports.push({
        size,
        openMs,
        idle,
        burst,
        updateSamplesMs,
        offscreenNameReads,
        visibleUpdated,
        rows: document.querySelectorAll(".qap-state-row").length,
        subscriptions: window.stateSubscriberCount(),
      });
    }
  } finally {
    window.setTimeout = originalTimeout;
    Array.prototype.sort = originalSort;
    root.hass.formatEntityName = originalName;
  }
  return reports;
}

async function verifyTouchSearch({ evaluate, send }) {
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  try {
    assert.equal(await evaluate(`matchMedia('(pointer:coarse)').matches`), true);
    const searchState = await evaluate(`(async () => {
      document.querySelector('.qap-search-shortcuts').click();
      const search=document.querySelector('.qap-home .qap-search-input');
      await search.updateComplete;
      const native=search.shadowRoot?.querySelector('wa-input');
      await native?.updateComplete;
      const input=native?.shadowRoot.querySelector('input')||search.shadowRoot?.querySelector('input')||search;
      const focusedOnShow=document.activeElement===search;
      input.focus();
      const font=parseFloat(getComputedStyle(input).fontSize);
      document.querySelector('.qap-search-shortcuts').click();
      return {font,focusedOnShow,hidden:search.parentElement.hidden,blurred:document.activeElement!==search};
    })()`);
    assert.ok(searchState.font >= 16, JSON.stringify(searchState));
    assert.deepEqual(
      { ...searchState, font: undefined },
      { font: undefined, focusedOnShow: false, hidden: true, blurred: true },
    );
  } finally {
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
}

async function verifyLauncherNavigation({ evaluate }) {
  const waitFor = async (condition) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(condition)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail(
      "Navigation did not settle: " +
        condition +
        " " +
        JSON.stringify(
          await evaluate(
            `({state:history.state,index:navigation.currentEntry.index,events:window.navigationEvents})`,
          ),
        ),
    );
  };
  const traverse = async (direction, condition) => {
    await evaluate("history." + direction + "()");
    await waitFor(condition);
  };
  assert.equal(
    await evaluate(`document.querySelector('.qap-home').firstElementChild.matches('.qap-search')`),
    true,
  );
  assert.equal(
    await evaluate(`getComputedStyle(document.querySelector('.qap-home .qap-search')).display`),
    "none",
  );
  assert.deepEqual(
    await evaluate(
      `Array.from(document.querySelector('.qap-head-actions').children, button => button.querySelector('ha-icon').getAttribute('icon'))`,
    ),
    ["mdi:magnify", "mdi:bookmark-plus-outline", "mdi:cog"],
  );
  await evaluate(`document.querySelector('.qap-search-shortcuts').click()`);
  assert.notEqual(
    await evaluate(`getComputedStyle(document.querySelector('.qap-home .qap-search')).display`),
    "none",
  );
  assert.equal(
    await evaluate(
      `document.activeElement === document.querySelector('.qap-home .qap-search-input')`,
    ),
    false,
  );
  await evaluate(`document.querySelector('.qap-search-shortcuts').click()`);
  assert.equal(
    await evaluate(`getComputedStyle(document.querySelector('.qap-home .qap-search')).display`),
    "none",
  );
  assert.equal(
    await evaluate(`document.querySelector('.qap-search-shortcuts').getAttribute('aria-expanded')`),
    "false",
  );
  await evaluate(
    `document.querySelector('.qap-search-shortcuts').click();const search=document.querySelector('.qap-home .qap-search-input');search.value='no such shortcut';search.dispatchEvent(new Event('input'));search.focus()`,
  );
  assert.equal(await evaluate(`document.querySelectorAll('.qap-tile').length`), 0);
  await evaluate(
    `document.querySelector('qap-dialog').dispatchEvent(new Event('cancel',{cancelable:true}))`,
  );
  await waitFor(
    `!document.querySelector('qap-dialog')&&history.state?.quick_access_navigation_v1?.index===0`,
  );
  await evaluate(`document.querySelector('#qap-fab').click()`);
  assert.equal(await evaluate(`document.querySelector('.qap-home .qap-search-input').value`), "");
  assert.equal(
    await evaluate(`getComputedStyle(document.querySelector('.qap-home .qap-search')).display`),
    "none",
  );
  assert.ok(await evaluate(`document.querySelectorAll('.qap-tile').length>0`));
  await evaluate(
    `document.querySelector('qap-dialog').dispatchEvent(new Event('cancel',{cancelable:true}))`,
  );
  await waitFor(
    `!document.querySelector('qap-dialog')&&history.state?.quick_access_navigation_v1?.index===0`,
  );
  await evaluate(`history.pushState({fixture:'preserve history state'},'','/navigation-test?query=preserved#hash');window.dispatchEvent(new Event('location-changed'));
    window.navigationBaseIndex=navigation.currentEntry.index;window.navigationEvents=[];
    window.addEventListener('popstate',()=>navigationEvents.push({index:navigation.currentEntry.index,state:history.state}));
    document.querySelector('#qap-fab').click();document.querySelector('[title="Settings"]').click();document.querySelector('.qap-settings-visibility').click();
    window.navigationLength=history.length;window.navigationDraft=document.querySelector('textarea');navigationDraft.value='/private/draft';`);
  assert.equal(
    await evaluate(`location.pathname+location.search+location.hash`),
    "/navigation-test?query=preserved#hash",
  );
  assert.equal(await evaluate(`navigation.currentEntry.index-navigationBaseIndex`), 3);
  assert.equal(await evaluate(`history.state.fixture`), "preserve history state");
  await traverse(
    "back",
    `!!document.querySelector('.qap-discard-changes-confirmation')&&history.state.quick_access_navigation_v1.index===3`,
  );
  await evaluate(`history.back();history.back()`);
  await waitFor(`history.state.quick_access_navigation_v1.index===3`);
  assert.equal(
    await evaluate(`document.querySelectorAll('.qap-discard-changes-confirmation').length`),
    1,
  );
  await evaluate(
    `Array.from(document.querySelector('.qap-discard-changes-confirmation').querySelectorAll('button, qap-button, qap-icon-button')).find(button=>button.textContent==='Cancel').click()`,
  );
  assert.equal(
    await evaluate(`navigationDraft.isConnected&&navigationDraft.value==='/private/draft'`),
    true,
  );
  await traverse("back", `!!document.querySelector('.qap-discard-changes-confirmation')`);
  await evaluate(
    `document.querySelector('.qap-discard-changes-confirmation .qap-button-danger').click()`,
  );
  await waitFor(`!!document.querySelector('.qap-settings-overview')`);
  await traverse("back", `!!document.querySelector('.qap-home')`);
  await traverse("back", `!document.querySelector('qap-dialog')`);
  assert.equal(await evaluate(`location.pathname`), "/navigation-test");
  await traverse("forward", `!!document.querySelector('.qap-home')`);
  await traverse("forward", `!!document.querySelector('.qap-settings-overview')`);
  await traverse("forward", `!!document.querySelector('textarea')`);
  assert.equal(await evaluate(`history.length===navigationLength`), true);
  await evaluate(
    `document.querySelector('qap-dialog').dispatchEvent(new Event('cancel',{cancelable:true}))`,
  );
  await waitFor(
    `!document.querySelector('qap-dialog')&&history.state.quick_access_navigation_v1.index===0`,
  );
  await evaluate(`document.querySelector('#qap-fab').click();document.querySelector('[title="Settings"]').click();
    history.pushState({ha:'sidebar'},'','/sidebar-navigation');window.dispatchEvent(new Event('location-changed'))`);
  await waitFor(`!document.querySelector('qap-dialog')`);
  assert.deepEqual(await evaluate(`history.state`), { ha: "sidebar" });
  await traverse(
    "back",
    `location.pathname==='/navigation-test'&&history.state.quick_access_navigation_v1.index===0`,
  );
  assert.equal(await evaluate(`!document.querySelector('qap-dialog')`), true);
  await traverse("forward", `location.pathname==='/sidebar-navigation'`);
  await evaluate(
    `history.replaceState(history.state,'','/');window.dispatchEvent(new Event('location-changed'));document.querySelector('#qap-fab').click()`,
  );
}

async function verifySelectedTabScrolling(evaluate, selector) {
  const result = await evaluate(`(async()=>{
    const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    await Promise.allSettled([...document.querySelectorAll('qap-dialog')].flatMap(host=>host.shadowRoot.querySelector('dialog').getAnimations()).map(animation=>animation.finished));
    const visible=chip=>{const rect=chip.getBoundingClientRect(),bounds=chip.parentElement.getBoundingClientRect();
      return rect.left>=bounds.left-1&&rect.right<=bounds.right+1;};
    const style=document.createElement('style');
    style.textContent=${JSON.stringify(`${selector}{max-width:240px}`)};document.head.append(style);
    let tabs=document.querySelector(${JSON.stringify(selector)});
    const first=tabs.firstElementChild,last=tabs.lastElementChild;
    first.click();await frame();
    tabs.scrollLeft=0;
    const initiallyClipped=!visible(last),focus=document.activeElement,body=document.querySelector('.qap-body'),top=body.scrollTop;
    last.click();await frame();
    const selectedVisible=visible(last),focusRetained=document.activeElement===focus,verticalRetained=body.scrollTop===top;
    first.click();await frame();
    const firstVisible=visible(first);
    last.focus({preventScroll:true});await frame();
    const focusedVisible=visible(last);
    last.click();await frame();
    window.publishProfiles();await frame();
    tabs=document.querySelector(${JSON.stringify(selector)});
    const restoredVisible=visible(tabs.lastElementChild)&&tabs.lastElementChild.getAttribute('aria-pressed')==='true';
    tabs.firstElementChild.click();await frame();
    style.remove();
    return {initiallyClipped,selectedVisible,focusRetained,verticalRetained,firstVisible,focusedVisible,restoredVisible};
  })()`);
  assert.deepEqual(
    result,
    {
      initiallyClipped: true,
      selectedVisible: true,
      focusRetained: true,
      verticalRetained: true,
      firstVisible: true,
      focusedVisible: true,
      restoredVisible: true,
    },
    selector,
  );
}

async function verifyFilterReuse(evaluate, send) {
  const waitFor = async (expression) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Filter reuse navigation did not settle: ${expression}`);
  };
  const settle = () =>
    evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  await evaluate(`(async()=>{
    const {profileFilters,group,rule}=await import('/quick_access_source/registry/filter-definitions.js');
    window.reuseBackup=structuredClone(window.testProfiles.profiles);
    const current=window.testProfiles.profiles[0];current.filters=structuredClone(profileFilters(current));
    const source={id:'reuse-shared',name:'Shared filter',hidden:true,icon:'mdi:thermometer',color:'#8e24aa',
      condition:group([rule('domain','equals','sensor'),group([rule('state','equals','on'),rule('state','equals','off')],'or')])};
    current.filters.states.push(structuredClone(source));
    const other=structuredClone(current);other.id='reuse-other';other.name='Other profile';other.icon='mdi:cellphone';other.color='teal';
    other.filters.states=[...other.filters.states.filter(filter=>['all','favorites'].includes(filter.id)),source];
    other.filters.devices.push({id:'device-only',name:'Device only',hidden:false,condition:group([rule('name','contains','Device')])});
    const empty=structuredClone(other);empty.id='reuse-empty';empty.name='Empty profile';
    empty.filters.states=empty.filters.states.filter(filter=>['all','favorites'].includes(filter.id));
    window.testProfiles.profiles.push(other,empty);window.publishProfiles();
  })()`);
  await evaluate(`document.querySelector('.qap-filter-action').click()`);
  await waitFor(
    `!!document.querySelector('.qap-filter-list [data-id="reuse-shared"] .qap-edit-symbol qap-icon')`,
  );
  await evaluate(`(()=>{
    window.reuseListIcon=document.querySelector('.qap-filter-list [data-id="reuse-shared"] .qap-edit-symbol qap-icon');
    document.querySelector('.qap-create-filter').click();
    window.reuseDraftName=document.querySelector('.qap-filter-panel qap-input');
    reuseDraftName.value='Draft kept';reuseDraftName.dispatchEvent(new Event('input',{bubbles:true}));
    window.reuseWrites=window.profileWrites.length;
  })()`);
  assert.deepEqual(
    await evaluate(`({icon:reuseListIcon.getAttribute('icon'),color:reuseListIcon.style.color})`),
    { icon: "mdi:thermometer", color: "rgb(142, 36, 170)" },
  );
  await settle();
  await evaluate(`document.querySelector('.qap-filter-reuse').click()`);
  await settle();
  assert.deepEqual(
    await evaluate(`(()=>{const modal=document.querySelector('.qap-filter-reuse-modal'),body=modal.querySelector('.qap-state-modal-body');return {
    groups:[...modal.querySelectorAll('h3')].map(heading=>heading.textContent),
    other:[...modal.querySelector('[data-profile="reuse-other"]').querySelectorAll('.qap-filter-reuse-option')].map(button=>button.textContent),
    sourceHidden:!!modal.querySelector('[data-profile="reuse-other"] [data-id="reuse-shared"]'),
    separate:modal.open&&!document.querySelector('.qap-filter-modal').contains(modal),overflow:body.scrollWidth>body.clientWidth,
    confirmation:!!document.querySelector('.qap-discard-changes-confirmation')};})()`),
    {
      groups: [
        await evaluate(`window.testProfiles.profiles[0].name+' profile filters'`),
        "Other profile profile filters",
      ],
      other: ["Shared filter"],
      sourceHidden: true,
      separate: true,
      overflow: false,
      confirmation: false,
    },
  );
  assert.deepEqual(
    await evaluate(`(()=>{const sections=[...document.querySelectorAll('.qap-filter-reuse-profile')];return {
    collapsed:sections.every(section=>!section.open),
    hidden:sections.every(section=>[...section.querySelectorAll('.qap-filter-reuse-option')].every(option=>!option.checkVisibility())),
    focused:document.activeElement===sections[0].querySelector('summary')};})()`),
    { collapsed: true, hidden: true, focused: true },
    "Profile groups start collapsed with focus on the first heading",
  );
  await evaluate(`document.querySelector('[data-profile="reuse-other"] summary').click()`);
  assert.equal(
    await evaluate(
      `(()=>{const section=document.querySelector('[data-profile="reuse-other"]');return section.open&&section.querySelector('.qap-filter-reuse-option').getBoundingClientRect().height>=44;})()`,
    ),
    true,
  );
  await evaluate(`document.querySelector('[data-profile="reuse-other"] summary').click()`);
  assert.equal(
    await evaluate(`!document.querySelector('[data-profile="reuse-other"]').open`),
    true,
  );
  await evaluate(`document.querySelector('[data-profile="reuse-other"] summary').focus()`);
  const pickerHistory = await evaluate(`JSON.stringify(history.state)`);
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    text: "\r",
    unmodifiedText: "\r",
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  assert.equal(
    await evaluate(`document.querySelector('[data-profile="reuse-other"]').open`),
    true,
    "Enter expands the profile",
  );
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
    text: " ",
    unmodifiedText: " ",
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
  });
  assert.equal(
    await evaluate(`!document.querySelector('[data-profile="reuse-other"]').open`),
    true,
    "Space collapses the profile",
  );
  assert.equal(
    await evaluate(`JSON.stringify(history.state)`),
    pickerHistory,
    "Expanding profiles keeps the current dialog history entry",
  );
  assert.deepEqual(
    await evaluate(`(()=>{const section=document.querySelector('[data-profile="reuse-other"]'),option=section.querySelector('.qap-filter-reuse-option'),
    icon=section.querySelector('.qap-profile-avatar ha-icon'),field=document.querySelector('.qap-filter-reuse').closest('.qap-field');return {
    icon:icon.getAttribute('icon'),neutral:getComputedStyle(option).color===getComputedStyle(section).color,
    bordered:getComputedStyle(section).borderStyle==='solid',template:field.querySelector('label').textContent,
    hardcoded:!!field.querySelector('select,qap-select')};})()`),
    {
      icon: "mdi:cellphone",
      neutral: true,
      bordered: true,
      template: "Start from a template",
      hardcoded: false,
    },
  );
  await evaluate(`document.querySelector('.qap-filter-reuse-back').click()`);
  await waitFor(`!document.querySelector('.qap-filter-reuse-modal')&&!history.state.dialog`);
  await settle();
  assert.equal(
    await evaluate(
      `reuseDraftName.isConnected&&reuseDraftName.value==='Draft kept'&&document.activeElement===document.querySelector('.qap-filter-reuse')`,
    ),
    true,
  );
  await evaluate(`history.forward()`);
  await waitFor(`!!document.querySelector('.qap-filter-reuse-modal')`);
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('.qap-filter-reuse-profile')].every(section=>!section.open)`,
    ),
    true,
    "Reopening starts with collapsed profiles",
  );
  await evaluate(`history.back()`);
  await waitFor(`!document.querySelector('.qap-filter-reuse-modal')`);
  assert.equal(
    await evaluate(
      `reuseDraftName.isConnected&&reuseDraftName.value==='Draft kept'&&!document.querySelector('.qap-discard-changes-confirmation')`,
    ),
    true,
  );
  await evaluate(`history.forward()`);
  await waitFor(`!!document.querySelector('.qap-filter-reuse-modal')`);
  await evaluate(
    `document.querySelector('.qap-filter-reuse-modal').dispatchEvent(new Event('cancel',{cancelable:true}))`,
  );
  await waitFor(`!document.querySelector('.qap-filter-reuse-modal')`);
  await settle();
  assert.equal(await evaluate(`window.profileWrites.length===window.reuseWrites`), true);
  await evaluate(`document.querySelector('.qap-filter-reuse').click()`);
  await settle();
  await evaluate(
    `document.querySelector('[data-profile="reuse-other"] summary').click();document.querySelector('[data-profile="reuse-other"] [data-id="reuse-shared"]').click()`,
  );
  await waitFor(`!document.querySelector('.qap-filter-reuse-modal')`);
  await settle();
  assert.equal(await evaluate(`reuseDraftName.value`), "Shared filter (Copy)");
  assert.equal(
    await evaluate(`document.querySelector('.qap-filter-panel .qap-color-picker qap-input').value`),
    "#8e24aa",
  );
  await evaluate(
    `window.failWrite=true;document.querySelector('.qap-filter-panel .qap-button-primary').click()`,
  );
  await waitFor(`!!document.querySelector('.qap-filter-panel .qap-error').textContent`);
  assert.equal(
    await evaluate(`reuseDraftName.isConnected&&reuseDraftName.value==='Shared filter (Copy)'`),
    true,
  );
  await evaluate(
    `window.failWrite=false;document.querySelector('.qap-filter-panel .qap-button-primary').click()`,
  );
  await waitFor(`!document.querySelector('.qap-filter-modal')`);
  assert.equal(
    await evaluate(`(()=>{const source=window.testProfiles.profiles.find(profile=>profile.id==='reuse-other').filters.states.find(filter=>filter.id==='reuse-shared');
    const saved=window.testProfiles.profiles[0].filters.states.find(filter=>filter.name==='Shared filter (Copy)');
    return saved.id!==source.id&&!saved.hidden&&source.hidden&&saved.icon===source.icon&&saved.color===source.color&&JSON.stringify(saved.condition)===JSON.stringify(source.condition)&&
      document.querySelector('.qap-state-tab[data-domain="'+saved.id+'"]').getAttribute('aria-pressed')==='true';})()`),
    true,
  );
  await evaluate(`document.querySelector('.qap-filter-action').click()`);
  await waitFor(`!!document.querySelector('.qap-filter-list .qap-drop-highlight')`);
  assert.equal(
    await evaluate(`(()=>{const row=document.querySelector('.qap-filter-list .qap-drop-highlight'),saved=window.testProfiles.profiles[0].filters.states.find(filter=>filter.name==='Shared filter (Copy)'),
    bounds=document.querySelector('.qap-filter-panel').getBoundingClientRect(),rect=row.getBoundingClientRect();
    return row.dataset.id===saved.id&&rect.top>=bounds.top-1&&rect.bottom<=bounds.bottom+1;})()`),
    true,
    "a created filter keeps its pending reveal through apply and editor close",
  );
  await evaluate(
    `document.querySelector('.qap-filter-close').click();document.querySelector('.qap-filter-action').click()`,
  );
  assert.equal(
    await evaluate(`!!document.querySelector('.qap-drop-highlight')`),
    false,
    "a pending filter reveal is consumed once",
  );
  await evaluate(`document.querySelector('.qap-filter-close').click()`);
  await evaluate(
    `window.testProfiles.profiles=window.reuseBackup;delete window.reuseBackup;window.publishProfiles();document.querySelector('.qap-state-tab[data-domain="all"]').click()`,
  );
}

async function verifyVisualFilterTree({ evaluate, send, width }) {
  await evaluate(`(async()=>{
    const {profileFilters,group,rule}=await import('/quick_access_source/registry/filter-definitions.js');
    window.treeProfiles=structuredClone(window.testProfiles.profiles);window.treeTheme=document.documentElement.style.cssText;
    const profile=window.testProfiles.profiles[0];profile.filters=structuredClone(profileFilters(profile));
    profile.filters.states.push({id:'tree-review',name:'Visual tree',hidden:false,condition:group([
      rule('state','equals','on'),group([{...rule('attribute','less_than',20),attribute:'battery'},
        group([rule('domain','equals','sensor')])],'or')])});
    window.publishProfiles();document.querySelector('.qap-filter-action').click();
    document.querySelector('[data-id="tree-review"] .qap-filter-edit').click();
    window.treeModal=document.querySelector('.qap-filter-modal');window.treeName=treeModal.querySelector('qap-input');
    window.treeHistory=JSON.stringify(history.state);window.treeWrites=window.profileWrites.length;
  })()`);
  const settle = () =>
    evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  await settle();
  assert.equal(
    await evaluate(
      `Array.from(treeModal.querySelectorAll('.qap-filter-rule-fields')).every(field=>field.hidden)`,
    ),
    true,
  );
  assert.equal(await evaluate(`treeModal.querySelector('.qap-filter-expression')`), null);
  assert.equal(
    await evaluate(`treeModal.querySelector('.qap-filter-group-contents > .qap-field')===null`),
    true,
  );
  await evaluate(`treeModal.querySelector('.qap-filter-logic').click()`);
  assert.deepEqual(
    await evaluate(
      `Array.from(treeModal.querySelector('.qap-filter-logic-menu').querySelectorAll('qap-menu-item'),item=>item.textContent)`,
    ),
    ["AND", "OR", "NOT"],
  );
  assert.equal(
    await evaluate(`(()=>{const menu=treeModal.querySelector('.qap-filter-logic-menu'),rect=menu.shadowRoot.querySelector('[popover]').getBoundingClientRect(),bounds=treeModal.shadowRoot.querySelector("dialog").getBoundingClientRect();
    return rect.width<=160&&rect.left>=bounds.left&&rect.right<=bounds.right&&!treeModal.querySelector('.qap-filter-group-contents').hidden;})()`),
    true,
  );
  await evaluate(`treeModal.querySelector('.qap-filter-logic-not').click()`);
  assert.equal(await evaluate(`treeModal.querySelector('.qap-filter-logic').textContent`), "NOT");
  await evaluate(
    `treeModal.querySelector('.qap-filter-logic').click();treeModal.querySelector('.qap-filter-logic-and').click()`,
  );
  for (const dark of [false, true]) {
    await evaluate(`document.documentElement.style.cssText=window.treeTheme;
      document.documentElement.style.colorScheme=${JSON.stringify(dark ? "dark" : "light")};
      for(const [key,value] of Object.entries(${JSON.stringify(dark ? nativeDarkTheme : {})}))document.documentElement.style.setProperty('--'+key,value);`);
    await settle();
    const layout =
      await evaluate(`(()=>{const body=treeModal.querySelector('.qap-filter-editor-body'),footer=treeModal.querySelector('.qap-filter-actions');
      return {overflow:body.scrollWidth>body.clientWidth,overlap:body.getBoundingClientRect().bottom>footer.getBoundingClientRect().top+1,
        visible:footer.getBoundingClientRect().bottom<=innerHeight,touch:[...treeModal.querySelectorAll('.qap-icon-button')].filter(button=>button.checkVisibility()).every(button=>button.getBoundingClientRect().height>=44),
        nested:treeModal.querySelectorAll('.qap-filter-group').length};})()`);
    assert.deepEqual(
      layout,
      { overflow: false, overlap: false, visible: true, touch: true, nested: 3 },
      `${width}px ${dark ? "dark" : "light"}`,
    );
  }
  await evaluate(
    `window.treeNested=treeModal.querySelectorAll('.qap-filter-group')[1];treeNested.querySelector('.qap-filter-group-toggle').focus()`,
  );
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    text: "\r",
    unmodifiedText: "\r",
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  assert.equal(
    await evaluate(`treeNested.querySelector('.qap-filter-group-contents').hidden`),
    true,
  );
  await evaluate(`treeNested.querySelector('.qap-filter-group-toggle').click();treeModal.querySelector('.qap-filter-rule-toggle').click();
    window.treeInput=treeModal.querySelector('.qap-filter-rule qap-input');treeInput.focus();treeInput.select();`);
  await send("Input.insertText", { text: "a long value with AND and OR ".repeat(5) });
  assert.equal(
    await evaluate(
      `document.activeElement===treeInput&&treeInput.isConnected&&treeName.isConnected&&treeModal===document.querySelector('.qap-filter-modal')`,
    ),
    true,
  );
  await evaluate(`treeModal.querySelectorAll('.qap-filter-edit-condition')[1].click()`);
  assert.equal(
    await evaluate(`treeModal.querySelectorAll('.qap-filter-rule.is-expanded').length`),
    1,
  );
  if (width === 390) {
    for (const narrow of [360, 430]) {
      await send("Emulation.setDeviceMetricsOverride", {
        width: narrow,
        height: 430,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await settle();
      assert.equal(
        await evaluate(`(()=>{const body=treeModal.querySelector('.qap-filter-editor-body'),footer=treeModal.querySelector('.qap-filter-actions');
        return body.scrollWidth<=body.clientWidth&&footer.getBoundingClientRect().bottom<=innerHeight&&body.clientHeight>0;})()`),
        true,
        `${narrow}px reduced keyboard viewport`,
      );
    }
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }
  await evaluate(`document.documentElement.style.cssText=window.treeTheme;
    treeInput.value='on';treeInput.dispatchEvent(new Event('input'));treeModal.querySelector('.qap-filter-preview-action').click();`);
  assert.equal(
    await evaluate(
      `treeModal.querySelector('.qap-filter-preview-action').getAttribute('aria-expanded')`,
    ),
    "true",
  );
  await evaluate(`treeModal.querySelector('.qap-filter-close').click();document.querySelector('.qap-discard-changes-confirmation')?.querySelector('.qap-button-danger').click();
    document.querySelector('.qap-filter-close')?.click();
    window.testProfiles.profiles=window.treeProfiles;window.publishProfiles();`);
  assert.equal(await evaluate(`window.profileWrites.length===window.treeWrites`), true);
}

async function verifyNativeFilterFields({ evaluate }) {
  await evaluate(
    `(()=>{const root=document.querySelector('hc-main');root.hass={...root.hass,entities:{'sensor.kitchen':{labels:[]},'sensor.unnamed':{labels:[]}},devices:{},areas:{},labels:{}};})()`,
  );
  await evaluate(`clickNative('.qap-tile')`);
  await assertMobileDialogPosition(evaluate, ".qap-states-dialog");
  await evaluate(`clickNative('.qap-state-summary')`);
  await assertMobileDialogPosition(evaluate, ".qap-state-modal");
  await evaluate(
    `clickNative('.qap-state-modal-head .qap-icon-button').then(()=>clickNative('.qap-filter-action'))`,
  );
  await assertMobileDialogPosition(evaluate, ".qap-filter-modal");
  await evaluate(
    `clickNative('.qap-create-filter').then(()=>clickNative('.qap-filter-rule-toggle'))`,
  );
  await assertMobileDialogPosition(evaluate, ".qap-filter-modal");
  await assertFixedFormActions(evaluate, ".qap-filter-modal", ".qap-filter-editor-body");
  await evaluate(`window.nativeFilter=document.querySelector('.qap-filter-panel');
    const name=nativeFilter.querySelector('qap-input');name.value='Native values';name.dispatchEvent(new Event('input'));
    window.chooseNativeFilter=(label,value)=>{const field=[...nativeFilter.querySelectorAll('qap-select')].find(field=>field.label===label);field.value=value;field.dispatchEvent(new Event('change',{bubbles:true}));};
    chooseNativeFilter('Condition','domain');new Promise(resolve=>setTimeout(resolve,100));`);
  assert.equal(
    await evaluate(
      `nativeFilter.querySelector('.qap-filter-value qap-select')?.shadowRoot.querySelector('select')?.localName`,
    ),
    "select",
  );
  await evaluate(
    `chooseNativeFilter('Value','sensor');chooseNativeFilter('Comparison','any_of');new Promise(resolve=>setTimeout(resolve,100));`,
  );
  assert.equal(
    await evaluate(
      `nativeFilter.querySelector('qap-select-selector')?.shadowRoot.querySelector('qap-select-selector')?.localName`,
    ),
    "qap-select-selector",
  );
  await evaluate(
    `chooseNativeFilter('Condition','id');new Promise(resolve=>setTimeout(resolve,100));`,
  );
  assert.equal(
    await evaluate(
      `nativeFilter.querySelector('qap-entity-selector')?.shadowRoot.querySelector('input')?.getAttribute('role')`,
    ),
    "combobox",
  );
  await evaluate(
    `nativeFilter.querySelector('qap-entity-selector').dispatchEvent(new CustomEvent('value-changed',{detail:{value:'sensor.kitchen'}}));`,
  );
  assert.equal(
    await evaluate(`nativeFilter.querySelector('.qap-filter-preview').textContent`),
    "1 matching entity",
  );
  await evaluate(
    `chooseNativeFilter('Comparison','any_of');new Promise(resolve=>setTimeout(resolve,100));`,
  );
  assert.equal(
    await evaluate(
      `nativeFilter.querySelector('qap-entity-selector')?.shadowRoot.querySelectorAll('qap-entity-selector').length`,
    ),
    1,
  );
  assert.equal(
    await evaluate(`nativeFilter.scrollWidth<=nativeFilter.clientWidth`),
    true,
    JSON.stringify(
      await evaluate(
        `({width:nativeFilter.clientWidth,scroll:nativeFilter.scrollWidth,children:[...nativeFilter.querySelectorAll("*")].filter(e=>e.getBoundingClientRect().right>nativeFilter.getBoundingClientRect().right).slice(0,8).map(e=>({tag:e.localName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right}))})`,
      ),
    ),
  );
  await evaluate(`clickNative('.qap-filter-logic')`);
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('.qap-filter-logic-menu qap-menu-item'),item=>getComputedStyle(item.shadowRoot.querySelector('[part="label"]')).textAlign).every(align=>align==='right')`,
    ),
    true,
  );
  await evaluate(
    `document.querySelector('.qap-filter-logic-menu').open=false;new Promise(resolve=>setTimeout(resolve,400));`,
  );
  await evaluate(
    `clickNative('.qap-filter-close').then(()=>clickNative('.qap-discard-changes-confirmation .qap-button-danger')).then(()=>clickNative('.qap-head-button'))`,
  );
}

async function verifySmartFilters({ evaluate, send, width }) {
  await send("Page.bringToFront");
  await verifySelectedTabScrolling(evaluate, ".qap-state-tabs");
  await evaluate(`window.smartFilterStates=document.querySelector('home-assistant').hass.states;
    window.smartFilterWrites=window.profileWrites.length;
    window.publishStates({
      'light.missing':{entity_id:'light.missing',state:'unavailable'},
      'sensor.unknown':{entity_id:'sensor.unknown',state:'unknown'},
      'sensor.charge':{entity_id:'sensor.charge',state:'19',attributes:{device_class:'battery',unit_of_measurement:'%'}},
      'update.application':{entity_id:'update.application',state:'on'}
    });new Promise(resolve=>setTimeout(resolve,300))`);
  for (const [filter, label, id] of [
    ["unavailable", "Unavailable", "light.missing"],
    ["unknown", "Unknown", "sensor.unknown"],
    ["low_battery", "Low battery", "sensor.charge"],
    ["updates", "Updates", "update.application"],
  ]) {
    const selector = `.qap-state-tab[data-domain="${filter}"]`;
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).focus();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
    );
    const control =
      await evaluate(`(()=>{const chip=document.querySelector(${JSON.stringify(selector)}),r=chip.getBoundingClientRect(),tabs=chip.parentElement,t=tabs.getBoundingClientRect();return {
      label:chip.textContent,focused:document.activeElement===chip,visible:r.left>=t.left-1&&r.right<=t.right+1,
      height:r.height,overflow:document.querySelector('.qap-body').scrollWidth>document.querySelector('.qap-body').clientWidth,
      group:tabs.getAttribute('aria-label'),x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    assert.equal(control.label, label);
    assert.equal(control.focused, true);
    assert.equal(
      control.visible,
      true,
      `keyboard focus reveals ${filter}: ${JSON.stringify(control)}`,
    );
    assert.equal(control.overflow, false);
    assert.ok(control.height >= 32);
    assert.equal(control.group, "Entity filters");
    if (width === 390 && filter === "low_battery") {
      await send("Emulation.setTouchEmulationEnabled", { enabled: true });
      await send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: control.x, y: control.y }],
      });
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await send("Emulation.setTouchEmulationEnabled", { enabled: false });
    } else {
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        text: "\r",
        unmodifiedText: "\r",
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
      });
    }
    assert.deepEqual(
      await evaluate(
        `Array.from(document.querySelectorAll('.qap-state-row'),row=>row.dataset.entity)`,
      ),
      [id],
    );
    assert.deepEqual(
      await evaluate(
        `Array.from(document.querySelectorAll('.qap-state-tab[aria-pressed="true"]'),chip=>chip.dataset.domain)`,
      ),
      [filter],
    );
  }
  assert.equal(
    await evaluate(
      `window.profileWrites.length===window.smartFilterWrites&&window.stateSubscriberCount()===1`,
    ),
    true,
  );
  await evaluate(`window.publishStates(window.smartFilterStates);document.querySelector('.qap-state-tab[data-domain="all"]').click();
    document.querySelector('.qap-state-tabs').scrollLeft=0;new Promise(resolve=>setTimeout(resolve,300))`);
  await evaluate(`document.querySelector('.qap-filter-action').click()`);
  await assertMobileDialogPosition(evaluate, ".qap-filter-modal");
  assert.equal(
    await evaluate(`(()=>{const parent=document.querySelector('.qap-states-dialog'),modal=document.querySelector('.qap-filter-modal');
    return modal.open&&!parent.querySelector('.qap-filter-panel')&&Math.abs(parent.getBoundingClientRect().height-modal.getBoundingClientRect().height)<1;})()`),
    true,
    "Entity filters open separately at the list dialog's height",
  );
  assert.equal(
    await evaluate(`(()=>{
      const modal=document.querySelector('.qap-filter-modal');
      const selected=()=>document.querySelector('.qap-state-tab[aria-pressed="true"]')?.dataset.domain;
      const before=selected();
      return ['all','favorites'].every(id=>{
        const row=modal.querySelector('.qap-filter-list [data-id="'+id+'"]');
        const content=row.querySelector('.qap-edit-content');
        content.click();row.querySelector('.qap-filter-name').click();row.querySelector('.qap-edit-symbol').click();row.click();
        return content.localName==='div'&&content.tabIndex===-1&&selected()===before&&modal.open;
      });
    })()`),
    true,
    "All and Favorites row content never applies a filter or closes the dialog",
  );
  await evaluate(`(()=>{const root=document.querySelector('home-assistant');root.hass={...root.hass,entities:{},devices:{},areas:{room:{area_id:'room',name:'Living room'}}};
    const panel=document.querySelector('.qap-filter-panel');document.querySelector('.qap-create-filter').click();
    panel.querySelector('.qap-filter-rule-toggle').click();
    const field=Array.from(panel.querySelectorAll('.qap-field')).find(field=>field.querySelector('qap-select')?.label==='Condition').querySelector('qap-select');
    field.value='area';field.dispatchEvent(new Event('change',{bubbles:true}));
    const value=panel.querySelectorAll('.qap-filter-rule qap-select')[2];value.focus();value.value='room';value.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  assert.deepEqual(
    await evaluate(
      `(()=>{const modal=document.querySelector('.qap-filter-modal'),panel=modal.querySelector('.qap-filter-panel'),value=panel.querySelectorAll('.qap-filter-rule qap-select')[2];return {value:value.value,label:value.shadowRoot.querySelector('select').selectedOptions[0].textContent,overflow:panel.scrollWidth>panel.clientWidth,open:modal.open,custom:!!panel.querySelector('.qap-filter-options')};})()`,
    ),
    { value: "room", label: "Living room (room)", overflow: false, open: true, custom: false },
    JSON.stringify(
      await evaluate(
        `(()=>{const panel=document.querySelector('.qap-filter-panel'),bounds=panel.getBoundingClientRect();return {width:panel.clientWidth,scroll:panel.scrollWidth,bounds:bounds.toJSON(),overflowing:[...panel.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+1).slice(0,12).map(e=>({tag:e.localName,cls:e.className,width:e.clientWidth,scroll:e.scrollWidth})),children:[...panel.querySelectorAll('*'),...[...panel.querySelectorAll('qap-button,qap-icon-button')].flatMap(e=>[...e.shadowRoot.querySelectorAll('*')])].filter(element=>element.getBoundingClientRect().right>bounds.right).slice(0,10).map(element=>({tag:element.localName,cls:element.className,width:element.getBoundingClientRect().width,right:element.getBoundingClientRect().right,text:element.textContent.slice(0,40)}))};})()`,
      ),
    ),
  );
  await evaluate(
    `document.querySelector('.qap-filter-close').click();document.querySelector('.qap-discard-changes-confirmation .qap-button-danger').click()`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.qap-filter-modal').open && !document.querySelector('.qap-filter-panel').classList.contains('is-editing')`,
    ),
    true,
    "discarding a filter edit returns to the filter list",
  );
  await evaluate(`document.querySelector('.qap-filter-close').click()`);
  assert.equal(
    await evaluate(
      `!document.querySelector('.qap-filter-modal') && document.querySelector('.qap-states-dialog').open`,
    ),
    true,
  );
  await evaluate(`document.querySelector('.qap-filter-action').click()`);
  assert.equal(
    await evaluate(`(()=>{const modal=document.querySelector('.qap-filter-modal'),panel=modal.querySelector('.qap-filter-panel'),head=modal.querySelector('.qap-head');
    const plus=head.querySelector('.qap-create-filter').getBoundingClientRect(),title=head.querySelector('.qap-title').getBoundingClientRect();
    return panel.scrollWidth<=panel.clientWidth&&plus.left>=title.right-1&&plus.width>=40&&
      panel.querySelectorAll('.qap-grip').length===0&&[...panel.querySelectorAll('.qap-edit-item')].every(row=>!row.hasAttribute('tabindex')&&!row.hasAttribute('role')&&getComputedStyle(row).cursor!=='grab')&&
      [...panel.querySelectorAll('.qap-edit-item')].every(row=>row.offsetHeight<=parseFloat(getComputedStyle(row).minHeight)+2)&&
      ![...panel.querySelectorAll('button, qap-button, qap-icon-button')].some(button=>['Manage filters','Create filter'].includes(button.textContent));})()`),
    true,
    "Filters share shortcut rows and keep creation at the right of the header",
  );
  await evaluate(`document.querySelector('.qap-filter-overflow').click()`);
  assert.equal(
    await evaluate(`(()=>{const modal=document.querySelector('.qap-filter-modal'),menu=modal.querySelector('.qap-profile-dropdown');
    const bounds=modal.shadowRoot.querySelector("dialog").getBoundingClientRect(),rect=menu.shadowRoot.querySelector('[popover]').getBoundingClientRect();
    return rect.left>=bounds.left&&rect.right<=bounds.right&&!!menu.querySelector('.qap-visibility-filter')&&!menu.querySelector('.qap-delete-filter');})()`),
    true,
  );
  await evaluate(
    `document.querySelector('.qap-visibility-filter').click();new Promise(resolve=>setTimeout(resolve,50))`,
  );
  assert.equal(
    await evaluate(`(()=>{const row=document.querySelector('.qap-filter-hidden');return row.dataset.id==='favorites'&&
    row.querySelector('.qap-edit-content').localName==='div'&&row.querySelector('.qap-filter-apply').disabled&&!row.hasAttribute('tabindex');})()`),
    true,
  );
  await evaluate(
    `document.querySelector('.qap-filter-hidden').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,cancelable:true}));new Promise(resolve=>setTimeout(resolve,50))`,
  );
  assert.equal(
    await evaluate(`document.querySelector('.qap-filter-list').children[0].dataset.id`),
    "favorites",
    "keyboard drag shortcuts are gone",
  );
  await evaluate(
    `document.querySelector('.qap-filter-hidden .qap-filter-overflow').click();document.querySelector('.qap-move-down-filter').click();new Promise(resolve=>setTimeout(resolve,100))`,
  );
  assert.equal(
    await evaluate(`document.querySelector('.qap-filter-list').children[1].dataset.id`),
    "favorites",
  );
  assert.equal(
    await evaluate(`document.querySelector('.qap-filter-list .qap-drop-highlight')?.dataset.id`),
    "favorites",
  );
  await evaluate(
    `document.querySelector('.qap-filter-hidden .qap-filter-overflow').click();document.querySelector('.qap-move-up-filter').click();new Promise(resolve=>setTimeout(resolve,100))`,
  );
  assert.equal(
    await evaluate(`document.querySelector('.qap-filter-list').children[0].dataset.id`),
    "favorites",
  );
  await evaluate(
    `document.querySelector('.qap-filter-hidden .qap-filter-overflow').click();document.querySelector('.qap-visibility-filter').click();new Promise(resolve=>setTimeout(resolve,50))`,
  );
  await evaluate(
    `document.querySelector('.qap-edit-item[data-id="unknown"] .qap-filter-overflow').click()`,
  );
  assert.deepEqual(
    await evaluate(
      `[...document.querySelector('.qap-profile-dropdown').querySelectorAll('qap-menu-item')].map(button=>button.textContent)`,
    ),
    ["Move up", "Move down", "Set default", "Duplicate", "Disable", "Delete"],
  );
  await evaluate(
    `document.querySelector('.qap-default-filter').click();new Promise(resolve=>setTimeout(resolve,50))`,
  );
  assert.equal(
    await evaluate(`document.querySelector('.qap-edit-item[data-id="unknown"] small').textContent`),
    "Default",
  );
  await evaluate(
    `document.querySelector('.qap-filter-close').click();document.querySelector('.qap-head-button[title="Back"]').click();document.querySelector('.qap-tile').click()`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.qap-state-tab[data-domain="unknown"]').getAttribute('aria-pressed')`,
    ),
    "true",
  );
  await evaluate(`document.querySelector('.qap-filter-action').click();document.querySelector('.qap-edit-item[data-id="all"] .qap-filter-overflow').click();
    document.querySelector('.qap-default-filter').click();new Promise(resolve=>setTimeout(resolve,50))`);
  await evaluate(
    `document.querySelector('.qap-filter-close').click();document.querySelector('.qap-head-button[title="Back"]').click();document.querySelector('.qap-tile').click();document.querySelector('.qap-filter-action').click()`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.qap-state-tab[data-domain="all"]').getAttribute('aria-pressed')`,
    ),
    "true",
  );
  await evaluate(`document.querySelector('.qap-filter-close').click()`);
  assert.equal(
    await evaluate(`document.activeElement===document.querySelector('.qap-filter-action')`),
    true,
  );
}

test(
  "Chromium: owned dialog sizing, scrolling, responsive grid, drafts and virtualization",
  { skip: !process.env.QUICK_ACCESS_BROWSER, timeout: 600000 },
  async (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), "quick-access-browser-"));
    const css = readFileSync(
      path.join(__dirname, "../custom_components/quick_access/frontend/quick_access.css"),
      "utf8",
    );
    const server = createServer((request, response) => {
      if (serveFrontendAsset(new URL(request.url, "http://localhost").pathname, response)) return;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        "<!doctype html><meta charset='utf-8'><title>Quick Access browser regression</title>",
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    let browser;
    try {
      browser = await connectBrowser(process.env.QUICK_ACCESS_BROWSER, directory);
      for (const width of process.env.QUICK_ACCESS_TEST_WIDTHS
        ? process.env.QUICK_ACCESS_TEST_WIDTHS.split(",").map(Number)
        : [320, 390, 768, 1024, 1440])
        await t.test(`${width}px (owned dialog, simulated HA connection)`, async () => {
          const url = `http://127.0.0.1:${server.address().port}/`;
          const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
          const { sessionId } = await browser.send("Target.attachToTarget", {
            targetId,
            flatten: true,
          });
          const send = async (method, params) => {
            const result = await browser.send(method, params, sessionId);
            if (method === "Emulation.setDeviceMetricsOverride") {
              // Media-query changes are delivered during rendering. Measure only
              // after the live presentation update and its existing animation.
              await browser.send(
                "Runtime.evaluate",
                {
                  expression: `(async()=>{
            await new Promise(resolve=>requestAnimationFrame(resolve));
            await ${settleDialogsExpression};
          })()`,
                  awaitPromise: true,
                },
                sessionId,
              );
            }
            return result;
          };
          const evaluate = async (expression) => {
            const result = await send("Runtime.evaluate", {
              expression,
              awaitPromise: true,
              returnByValue: false,
            });
            if (result.exceptionDetails)
              throw new Error(
                result.exceptionDetails.exception?.description ||
                  JSON.stringify(result.exceptionDetails),
              );
            await send("Runtime.evaluate", {
              expression: settleDialogsExpression,
              awaitPromise: true,
            });
            if (!result.result.objectId) return result.result.value;
            const objectId = result.result.objectId;
            try {
              const serialized = await send("Runtime.callFunctionOn", {
                objectId,
                functionDeclaration: "function(){return this instanceof Node ? null : this;}",
                returnByValue: true,
              });
              return serialized.result.value;
            } finally {
              await send("Runtime.releaseObject", { objectId });
            }
          };
          await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 844,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await send("Page.navigate", { url });
          for (let attempt = 0; attempt < 100; attempt++) {
            if (
              await evaluate(
                `location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`,
              )
            )
              break;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          if (width === 320) {
            const cases = JSON.parse(
              readFileSync(path.join(__dirname, "external-url-cases.json"), "utf8"),
            );
            const results = await evaluate(`(async () => {
          const { safeExternal } = await import('/quick_access_source/utils/urls.js');
          return Object.entries(${JSON.stringify(cases)}).flatMap(([expected, urls]) =>
            urls.map(url => ({ url, expected: expected === 'valid', actual: safeExternal(url) })));
        })()`);
            for (const { url, expected, actual } of results)
              assert.equal(actual, expected, JSON.stringify(url));
          }
          await evaluate(
            `localStorage.clear(); (${haFixture.toString()})(); const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style); import('/quick_access/quick_access.js')`,
          );
          await evaluate(
            `new Promise((resolve, reject) => { const poll = setInterval(() => { if (document.querySelector('#qap-fab') && window.quickAccessDebug().profileContextReady) {clearInterval(poll); resolve();} }, 20); setTimeout(() => {clearInterval(poll); reject(Error('UI did not initialize'));}, 8000); })`,
          );
          assert.equal(
            await evaluate(
              `new URL(document.querySelector('link[href*="quick_access.css"]').href).pathname + new URL(document.querySelector('link[href*="quick_access.css"]').href).search`,
            ),
            `/quick_access/quick_access.css?v=${assetVersion}`,
          );
          assert.equal(await evaluate(`document.querySelector('#qap-fab').hidden`), false);
          assert.equal(
            await evaluate(`document.querySelector('#qap-fab').getAttribute('aria-label')`),
            "Set up Quick Access",
          );
          assert.equal(await evaluate(`window.testProfiles.profiles.length`), 0);
          assert.equal(
            await evaluate(`(() => {
              const label = document.querySelector('.qap-fab-setup-label');
              const bounds = label.getBoundingClientRect();
              return label.textContent === 'Set up Quick Access'
                && bounds.left >= 0 && bounds.right <= innerWidth
                && bounds.top >= 0 && bounds.bottom <= innerHeight;
            })()`),
            true,
            "the setup label stays visible within the viewport",
          );
          const setupPoint = await evaluate(
            `(() => {const r=document.querySelector('.qap-fab-setup-label').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
          );
          if (width === 1440) {
            await send("Page.bringToFront");
            await evaluate(`document.querySelector('#qap-fab').focus()`);
            assert.equal(await evaluate(`document.activeElement.id`), "qap-fab");
            assert.notEqual(
              await evaluate(`getComputedStyle(document.activeElement).outlineStyle`),
              "none",
            );
            await send("Input.dispatchKeyEvent", {
              type: "keyDown",
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
              text: "\r",
              unmodifiedText: "\r",
            });
            await send("Input.dispatchKeyEvent", {
              type: "keyUp",
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
            });
          } else if (width === 390) {
            await send("Emulation.setTouchEmulationEnabled", { enabled: true });
            await send("Input.dispatchTouchEvent", {
              type: "touchStart",
              touchPoints: [setupPoint],
            });
            await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            await send("Emulation.setTouchEmulationEnabled", { enabled: false });
          } else {
            await send("Input.dispatchMouseEvent", {
              type: "mousePressed",
              button: "left",
              clickCount: 1,
              ...setupPoint,
            });
            await send("Input.dispatchMouseEvent", {
              type: "mouseReleased",
              button: "left",
              clickCount: 1,
              ...setupPoint,
            });
          }
          assert.equal(
            await evaluate(
              `Boolean(document.querySelector('.qap-head-actions .qap-create-profile'))`,
            ),
            true,
          );
          await evaluate(`document.querySelector('.qap-create-default-profile').click()`);
          assert.deepEqual(
            await evaluate(`Object.keys(window.testProfiles.profiles[0].settings).sort()`),
            ["links", "routes", "visibility"],
          );
          assert.equal(
            await evaluate(`document.querySelector('#qap-fab').getAttribute('aria-label')`),
            "Open Quick Access",
          );
          assert.equal(await evaluate(`document.querySelector('.qap-fab-setup-label')`), null);
          await evaluate(
            `document.querySelector('qap-dialog').dispatchEvent(new Event('cancel',{cancelable:true}));new Promise(resolve=>setTimeout(resolve,350))`,
          );
          // Resizing an active profile changes layout, while URL rules stay in force.
          for (const [visibility, routes, visible] of [
            ["exclude", [], true],
            ["exclude", ["/*"], false],
            ["include", ["/*"], true],
            ["include", ["/missing/*"], false],
          ]) {
            await evaluate(
              `Object.assign(window.testProfiles.profiles[0].settings, ${JSON.stringify({ visibility, routes })});window.publishProfiles()`,
            );
            for (const viewportWidth of [5120, width]) {
              await send("Emulation.setDeviceMetricsOverride", {
                width: viewportWidth,
                height: 844,
                deviceScaleFactor: 1,
                mobile: false,
              });
              await evaluate(`new Promise(requestAnimationFrame)`);
              assert.equal(await evaluate(`document.querySelector('#qap-fab').hidden`), !visible);
            }
          }
          await evaluate(
            `Object.assign(window.testProfiles.profiles[0].settings,{visibility:'exclude',routes:[]});window.publishProfiles()`,
          );
          const layout = () => evaluate(`(${dialogLayout.toString()})()`);
          const colors = await evaluate(`(() => {
        const result = [];
        for (const [surface, text] of [['#006577','#ffffff'],['#91c7ff','#102030'],['#784aa1','#fff0cf']]) {
          document.documentElement.style.setProperty('--ha-color-fill-primary-loud-resting', surface);
          document.documentElement.style.setProperty('--ha-color-on-primary-loud', text);
          const style = getComputedStyle(document.querySelector('#qap-fab'));
          result.push([style.backgroundColor, style.color]);
        }
        return result;
      })()`);
          assert.deepEqual(colors, [
            ["rgb(0, 101, 119)", "rgb(255, 255, 255)"],
            ["rgb(145, 199, 255)", "rgb(16, 32, 48)"],
            ["rgb(120, 74, 161)", "rgb(255, 240, 207)"],
          ]);
          await evaluate(`document.querySelector('#qap-fab').click()`);
          assert.ok(
            await evaluate(`Boolean(document.querySelector('.qap-tiles'))`),
            await evaluate(
              `JSON.stringify({debug:window.quickAccessDebug(),body:document.body.innerHTML})`,
            ),
          );
          if (width === 390) await verifyTouchSearch({ evaluate, send });
          const grid = await evaluate(
            `(() => {const grid = document.querySelector('.qap-tiles'); const tile = grid.querySelector('.qap-tile'); return {columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, width: tile.getBoundingClientRect().width, font: parseFloat(getComputedStyle(tile.querySelector('.qap-tile-name')).fontSize), overflow: grid.scrollWidth > grid.clientWidth};})()`,
          );
          assert.equal(grid.columns, width === 320 ? 2 : 3);
          assert.ok(grid.width >= 96, JSON.stringify(grid));
          assert.ok(grid.font >= 14);
          assert.equal(grid.overflow, false);
          await evaluate(`window.tabCategoriesBackup=structuredClone(window.testProfiles.profiles[0].categories);
        window.testProfiles.profiles[0].categories.push(...Array.from({length:10},(_,i)=>({id:'tab-'+i,name:'Category '+i})));
        window.publishProfiles();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
          await verifySelectedTabScrolling(evaluate, ".qap-home > .qap-tabs");
          await evaluate(
            `window.testProfiles.profiles[0].categories=window.tabCategoriesBackup;delete window.tabCategoriesBackup;window.publishProfiles()`,
          );
          const savePage = await evaluate(`(() => {
        const button = document.querySelector('.qap-save-current-page');
        const rect = button.getBoundingClientRect();
        return { label: button.getAttribute('aria-label'), tooltip: button.title,
          next: button.nextElementSibling.title, visible: rect.left >= 0 && rect.right <= innerWidth };
      })()`);
          assert.deepEqual(savePage, {
            label: "Save current page",
            tooltip: "Save current page",
            next: "Settings",
            visible: true,
          });
          await evaluate(`document.querySelector('.qap-save-current-page').click()`);
          await assertFixedFormActions(evaluate, ".qap-shortcut-form", ".qap-form-body");
          await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 320,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await assertFixedFormActions(evaluate, ".qap-shortcut-form", ".qap-form-body");
          await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 844,
            deviceScaleFactor: 1,
            mobile: false,
          });
          assert.equal(
            await evaluate(`document.querySelector('.qap-shortcut-form qap-select').value`),
            "internal",
          );
          assert.equal(
            await evaluate(
              `Array.from(document.querySelectorAll('.qap-shortcut-form qap-input')).at(-1).value`,
            ),
            "/",
          );
          await evaluate(`document.querySelector('.qap-cancel-shortcut').click()`);
          assert.equal(await evaluate(`Boolean(document.querySelector('.qap-home'))`), true);
          await send("Page.bringToFront");
          await verifyLauncherNavigation({ evaluate });
          if (width === 320) {
            const paths = [
              "https:example.com/path",
              "http:example.com/path",
              "https:/example.com/path",
            ];
            const navigation = await evaluate(`(() => {
          const profile = window.testProfiles.profiles[0];
          const savedLinks = profile.settings.links;
          const base = document.createElement('base');
          document.head.prepend(base);
          try {
            profile.settings.links = ${JSON.stringify(paths)}.map((path, index) => ({
              ...savedLinks[0], id: 'external-' + index, name: 'External ' + index, type: 'external', path, group: 'favorites',
            }));
            return ['http://ha.example/', 'https://ha.example/'].map(origin => {
              base.href = origin;
              window.publishProfiles();
              return {
                origin,
                links: [...document.querySelectorAll('.qap-tiles a')].map(tile => ({ href: tile.href, target: tile.target, rel: tile.rel })),
                stored: profile.settings.links.map(link => link.path),
              };
            });
          } finally {
            base.remove();
            profile.settings.links = savedLinks;
            window.publishProfiles();
          }
        })()`);
            for (const result of navigation) {
              assert.deepEqual(
                result.links,
                [
                  "https://example.com/path",
                  "http://example.com/path",
                  "https://example.com/path",
                ].map((href) => ({ href, target: "_blank", rel: "noopener noreferrer" })),
                result.origin,
              );
              assert.deepEqual(result.stored, paths);
            }
          }
          // Keep storage capacity while bounding mounted shortcut DOM in both views.
          const maxItems = Number(
            readFileSync(
              path.join(__dirname, "../custom_components/quick_access/profiles.py"),
              "utf8",
            ).match(/MAX_SHORTCUTS = (\d+)/)[1],
          );
          const pageSize = await evaluate(
            `import('/quick_access_source/profiles/profile-defaults.js').then(module => module.SHORTCUT_PAGE_SIZE)`,
          );
          await evaluate(`window.savedShortcutProfile=structuredClone(window.testProfiles.profiles[0]);
        window.testProfiles.profiles[0].settings.links=Array.from({length:${maxItems}},(_,i)=>({id:'s'+i,name:'Shortcut '+i,type:'internal',path:'/s/'+i,icon:'mdi:home',color:'',group:'favorites'}));window.publishProfiles();`);
          const walkShortcutPages = (selector) =>
            evaluate(`(() => {
        let maximum=0, total=0, last='';
        do {
          const items=[...document.querySelectorAll(${JSON.stringify(selector)})];
          maximum=Math.max(maximum,items.length);total+=items.length;last=items.at(-1).textContent;
          const next=document.querySelector('.qap-page-next');
          if(next.disabled)break;
          if(total>${maxItems})throw Error('Pagination did not terminate');
          next.click();
        } while(true);
        const pager=document.querySelector('.qap-pagination');
        return {maximum,total,last,overflow:pager.scrollWidth>pager.clientWidth};
      })()`);
          assert.deepEqual(await walkShortcutPages(".qap-tile-name"), {
            maximum: pageSize,
            total: maxItems,
            last: `Shortcut ${maxItems - 1}`,
            overflow: false,
          });
          assert.equal(await evaluate(`document.querySelector('.qap-search-input').value`), "");
          await evaluate(
            `(() => {const search=document.querySelector('.qap-search-input');search.value='  SHORTCUT  ';search.dispatchEvent(new Event('input'));})()`,
          );
          assert.equal(
            await evaluate(`getComputedStyle(document.querySelector('.qap-tabs')).display`),
            "none",
          );
          assert.deepEqual(await walkShortcutPages(".qap-tile-name"), {
            maximum: pageSize,
            total: maxItems,
            last: `Shortcut ${maxItems - 1}`,
            overflow: false,
          });
          await evaluate(
            `(() => {const search=document.querySelector('.qap-search-input');search.value='/s/0';search.dispatchEvent(new Event('input'));})()`,
          );
          assert.deepEqual(
            await evaluate(
              `Array.from(document.querySelectorAll('.qap-tile-name'),tile=>tile.textContent)`,
            ),
            ["Shortcut 0"],
          );
          await evaluate(
            `(() => {const search=document.querySelector('.qap-search-input');search.value='';search.dispatchEvent(new Event('input'));})()`,
          );
          await evaluate(
            `document.querySelector('[title="Settings"]').click();document.querySelector('.qap-settings-shortcuts').click();`,
          );
          assert.deepEqual(await walkShortcutPages(".qap-edit-item strong"), {
            maximum: pageSize,
            total: maxItems,
            last: `Shortcut ${maxItems - 1}`,
            overflow: false,
          });
          await evaluate(
            `document.querySelector('[title="Back"]').click();document.querySelector('.qap-back-settings').click();window.testProfiles.profiles[0]=window.savedShortcutProfile;window.publishProfiles();`,
          );
          await evaluate(`document.querySelector('[title="Settings"]').click()`);
          assert.equal(
            await evaluate(
              `Boolean(document.querySelector('.qap-settings qap-input[type=number]'))`,
            ),
            false,
          );
          assert.deepEqual(
            await evaluate(
              `Array.from(document.querySelectorAll('.qap-settings-section-title'), heading => heading.textContent)`,
            ),
            ["Active profile", "Profile configuration"],
          );
          assert.equal(
            await evaluate(`document.querySelector('.qap-quota,.qap-resource-info')===null`),
            true,
          );
          assert.equal(
            await evaluate(
              `Boolean(document.querySelector('.qap-save-settings') || document.querySelector('.qap-shortcut-groups'))`,
            ),
            false,
          );
          await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 320,
            deviceScaleFactor: 1,
            mobile: false,
          });
          const headerBefore = await evaluate(`(() => {
        const body = document.querySelector('.qap-body');
        const header = document.querySelector('qap-dialog').shadowRoot.querySelector('.header');
        const back = document.querySelector('.qap-back-settings');
        return {top: header.getBoundingClientRect().top, bottom: back.getBoundingClientRect().bottom, scrollable: [...[body,document.querySelector("qap-dialog").shadowRoot.querySelector(".body")]].some(region=>region.scrollHeight>region.clientHeight), overlap: body.getBoundingClientRect().top < header.getBoundingClientRect().bottom - 1};
      })()`);
          assert.equal(
            headerBefore.scrollable,
            true,
            JSON.stringify(
              await evaluate(
                `(()=>{const host=document.querySelector("qap-dialog"),surface=host.shadowRoot.querySelector("dialog"),body=host.shadowRoot.querySelector(".body");return {innerHeight,visual:visualViewport.height,surface:surface.getBoundingClientRect().toJSON(),max:getComputedStyle(surface).maxHeight,body:{client:body.clientHeight,scroll:body.scrollHeight,rect:body.getBoundingClientRect().toJSON()},shell:host.querySelector(".qap-shell").getBoundingClientRect().toJSON()};})()`,
              ),
            ),
          );
          assert.equal(headerBefore.overlap, false);
          assert.ok(headerBefore.bottom <= 320);
          await evaluate(`document.querySelector('.qap-body').scrollTop = 10000`);
          assert.equal(
            await evaluate(
              `document.querySelector('qap-dialog').shadowRoot.querySelector('.header').getBoundingClientRect().top`,
            ),
            headerBefore.top,
          );
          await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 844,
            deviceScaleFactor: 1,
            mobile: false,
          });
          // Maximum configurable profile count, with long names. The header and
          // creation action stay fixed while the single body scrolls to the end.
          await evaluate(`window.savedProfiles=structuredClone(window.testProfiles.profiles);window.savedLimits=structuredClone(window.testProfiles.limits);
        window.testProfiles.limits.max_profiles=100;
        for(let i=1;i<100;i++) window.testProfiles.profiles.push({...structuredClone(window.savedProfiles[0]),id:'long-profile-'+i,name:('Profile '+i+' ').padEnd(80,'x')});
        window.publishProfiles();document.querySelector('.qap-settings-profiles').click();`);
          assert.equal(await evaluate(`document.querySelectorAll('.qap-profile-row').length`), 100);
          await assertMobileDialogPosition(evaluate, ".qap-settings-dialog");
          const profileLayout = await evaluate(`(() => {
        const b=document.querySelector('.qap-body'), h=document.querySelector('qap-dialog').shadowRoot.querySelector('.header'), create=document.querySelector('.qap-create-profile');
        const top=h.getBoundingClientRect().top, createTop=create.getBoundingClientRect().top;
        b.scrollTop=b.scrollHeight;
        return {scrollable:b.scrollHeight>b.clientHeight,overflow:b.scrollWidth>b.clientWidth,stable:top===h.getBoundingClientRect().top&&createTop===create.getBoundingClientRect().top,
          overlap:b.getBoundingClientRect().top<h.getBoundingClientRect().bottom-1,visible:create.getBoundingClientRect().bottom<=844,last:document.querySelector('.qap-profile-row:last-child').getBoundingClientRect().bottom<=b.getBoundingClientRect().bottom};
      })()`);
          assert.deepEqual(profileLayout, {
            scrollable: true,
            overflow: false,
            stable: true,
            overlap: false,
            visible: true,
            last: true,
          });
          const storedProfiles = await evaluate(
            `window.testProfiles.profiles.map(profile=>profile.id)`,
          );
          assert.equal(
            await evaluate(`(()=>{const rows=[...document.querySelector('.qap-profile-list').children],profiles=window.testProfiles.profiles.slice(1).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
        return JSON.stringify(rows.map(row=>row.dataset.id))===JSON.stringify(profiles.map(profile=>profile.id))&&!document.querySelector('.qap-profile-list qap-sortable')&&
          rows.every(row=>!row.hasAttribute('tabindex')&&!row.hasAttribute('aria-keyshortcuts')&&getComputedStyle(row).cursor!=='grab'&&row.querySelector('.qap-edit-symbol').parentElement===row.querySelector('.qap-profile-content')&&row.querySelector('.qap-profile-activate').parentElement===row);})()`),
            true,
          );
          await evaluate(
            `document.querySelector('.qap-profile-list .qap-edit-item').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true}))`,
          );
          assert.deepEqual(
            await evaluate(`window.testProfiles.profiles.map(profile=>profile.id)`),
            storedProfiles,
          );
          await evaluate(`document.querySelector('.qap-create-profile').click()`);
          assert.equal(
            await evaluate(`Boolean(document.querySelector('.qap-profile-editor[open]'))`),
            true,
          );
          await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 320,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await assertFixedFormActions(evaluate, ".qap-profile-editor", ".qap-body");
          await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 844,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await evaluate(`document.querySelector('.qap-profile-cancel').click();document.querySelector('.qap-head-button').click();
        window.testProfiles.profiles=window.savedProfiles;window.testProfiles.limits=window.savedLimits;window.publishProfiles();`);
          // Long current paths and many URL rules must not squeeze controls or
          // push Save into the scrolling form. Test the real keyboard tab order.
          const longPath = `/config/${"very-long-path-segment/".repeat(18)}mqtt`;
          const fullUrl = `${longPath}?view=advanced#section`;
          await evaluate(`history.replaceState(history.state,'',${JSON.stringify(fullUrl)});document.querySelector('#qap-fab').click();
        document.querySelector('.qap-save-current-page').click()`);
          assert.deepEqual(
            await evaluate(
              `Array.from(document.querySelectorAll('.qap-current-url-card .qap-current-url-path'),path=>path.textContent)`,
            ),
            [longPath, fullUrl],
          );
          // The prefilled current path hides its own suggestion until the path changes.
          assert.equal(
            await evaluate(`document.querySelector('.qap-shortcut-form .qap-current-url').hidden`),
            true,
          );
          await evaluate(
            `(() => {const route=Array.from(document.querySelectorAll('.qap-shortcut-form qap-input')).at(-1);route.value='';route.dispatchEvent(new Event('input'));})()`,
          );
          assert.equal(
            await evaluate(`document.querySelector('.qap-shortcut-form .qap-current-url').hidden`),
            false,
          );
          assert.equal(
            await evaluate(
              `document.querySelector('.qap-body').scrollWidth>document.querySelector('.qap-body').clientWidth`,
            ),
            false,
          );
          await evaluate(`document.querySelectorAll('.qap-current-url-action')[1].click()`);
          assert.equal(
            await evaluate(
              `Array.from(document.querySelectorAll('.qap-shortcut-form qap-input')).at(-1).value`,
            ),
            fullUrl,
          );
          assert.equal(
            await evaluate(
              `document.querySelector('.qap-body').scrollWidth>document.querySelector('.qap-body').clientWidth`,
            ),
            false,
          );
          await evaluate(`document.querySelector('.qap-current-url-action').click();document.querySelector('.qap-cancel-shortcut').click();
        document.querySelector('[title="Settings"]').click();document.querySelector('.qap-settings-visibility').click()`);
          assert.equal(
            await evaluate(`document.querySelectorAll('.qap-visibility .qap-current-url').length`),
            1,
          );
          assert.equal(
            await evaluate(`document.querySelector('.qap-current-url-path').textContent`),
            longPath,
          );
          assert.equal(
            await evaluate(`document.querySelector('.qap-current-url-path').title`),
            longPath,
          );
          assert.equal(
            await evaluate(`document.querySelectorAll('.qap-current-url-row code')[1].textContent`),
            `${longPath}/*`,
          );
          assert.equal(
            await evaluate(`document.querySelectorAll('.qap-current-url-row code')[2].textContent`),
            fullUrl,
          );
          await evaluate(
            `document.querySelectorAll('.qap-current-url-action').forEach(action=>action.click())`,
          );
          assert.deepEqual(
            await evaluate(`document.querySelector('textarea').value.split('\\n')`),
            [longPath, `${longPath}/*`, fullUrl],
          );
          const currentLayout = await evaluate(`(() => {
        const section=document.querySelector('.qap-current-url'), actions=[...section.querySelectorAll('button, qap-button, qap-icon-button')].map(button=>button.getBoundingClientRect());
        return {overflow:section.scrollWidth>section.clientWidth,stacked:actions[1].top>=actions[0].bottom,buttons:actions.every(r=>r.width>=70&&r.height>=40)};
      })()`);
          assert.equal(currentLayout.overflow, false);
          assert.equal(currentLayout.buttons, true);
          assert.equal(currentLayout.stacked, true);
          await evaluate(`document.querySelector('.qap-current-url-action').focus()`);
          await send("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "Tab",
            code: "Tab",
            windowsVirtualKeyCode: 9,
          });
          await send("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "Tab",
            code: "Tab",
            windowsVirtualKeyCode: 9,
          });
          assert.equal(
            await evaluate(
              `document.activeElement===document.querySelectorAll('.qap-current-url-action')[1]`,
            ),
            true,
          );
          await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 320,
            deviceScaleFactor: 1,
            mobile: false,
          });
          const saveLayout =
            await evaluate(`(() => {const body=document.querySelector('.qap-body'),footer=document.querySelector('.qap-settings-footer');body.scrollTop=body.scrollHeight;
        return {overflow:body.scrollWidth>body.clientWidth,overlap:body.getBoundingClientRect().bottom>footer.getBoundingClientRect().top+1,visible:footer.getBoundingClientRect().bottom<=320};})()`);
          assert.deepEqual(saveLayout, { overflow: false, overlap: false, visible: true });
          await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 844,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await assertMobileDialogPosition(evaluate, ".qap-settings-dialog");
          await evaluate(
            `const paths=document.querySelector('textarea');paths.value='';paths.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.qap-save-settings').click()`,
          );
          await evaluate(
            `history.replaceState(history.state,'','/');document.querySelector('#qap-fab').click()`,
          );
          // Even at a wide viewport, a narrow dialog must choose two columns.
          assert.equal(
            await evaluate(
              `(() => {const home=document.querySelector('.qap-home'); home.style.width='280px'; const count=getComputedStyle(home.querySelector('.qap-tiles')).gridTemplateColumns.split(' ').length; home.style.width=''; return count;})()`,
            ),
            2,
          );
          // Measure actual layout, including shrinking in the SAME open surface.
          await evaluate(
            `window.originalProfile = structuredClone(window.testProfiles.profiles[0]); window.launcherDialog = document.querySelector('qap-dialog');`,
          );
          const heights = [];
          for (const count of [1, 3, 6, 12, 20]) {
            await evaluate(`(() => {
          const profile = window.testProfiles.profiles[0];
          profile.categories = [{id:'favorites',name:'Favorites'},{id:'small',name:'Small'},{id:'empty',name:'Empty'}];
          const link = window.originalProfile.settings.links[0];
          profile.settings.links = Array.from({length:${count}}, (_, i) => ({...link, id:'tile-'+i, name:'Shortcut '+i, group:'favorites'}));
          profile.settings.links.push({...link, id:'small', name:'Small shortcut', group:'small'});
          window.publishProfiles();
        })()`);
            const measured = await layout();
            heights.push(measured.height);
            assert.equal(measured.columns, width === 320 ? 2 : 3);
            assert.ok(
              Math.abs(measured.width - Math.min(width, 580)) <= 2,
              JSON.stringify(measured),
            );
            assert.ok(
              measured.height <= (width <= 870 ? 844 * 0.85 : 844 - 80) + 2,
              JSON.stringify(measured),
            );
            assert.ok(measured.top >= 0 && measured.bottom <= 845);
            assert.equal(measured.overflow, false);
            if (count <= 3) {
              assert.ok(measured.height < 500, JSON.stringify(measured));
              assert.ok(
                measured.bodyContentHeight <= measured.bodyHeight + 1,
                JSON.stringify(measured),
              );
            }
            if (count === 20) {
              assert.ok(
                measured.bodyContentHeight > measured.bodyHeight + 100,
                JSON.stringify(measured),
              );
              assert.equal(
                await evaluate(
                  `(() => {const body=document.querySelector('qap-dialog').shadowRoot.querySelector('.body'); body.scrollTop=body.scrollHeight; return document.querySelector('.qap-tile:last-child').getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom;})()`,
                ),
                true,
              );
            }
          }
          assert.ok(heights[2] > heights[1] && heights[3] > heights[2], JSON.stringify(heights));
          if (width !== 320)
            assert.ok(Math.abs(heights[0] - heights[1]) < 2, JSON.stringify(heights));
          await evaluate(`document.querySelector('[data-tab="small"]').click()`);
          const compact = await layout();
          assert.ok(compact.height < heights.at(-1) - 100);
          assert.ok(compact.bodyContentHeight <= compact.bodyHeight + 1);
          await evaluate(`document.querySelector('[data-tab="empty"]').click()`);
          assert.ok((await layout()).height < heights.at(-1));
          await evaluate(`document.querySelector('[data-tab="favorites"]').click()`);
          // Remote additions/removals also change intrinsic height without reopening.
          await evaluate(
            `window.testProfiles.profiles[0].settings.links.splice(1); window.publishProfiles();`,
          );
          assert.ok((await layout()).height < heights.at(-1) - 100);
          assert.equal(
            await evaluate(`window.launcherDialog === document.querySelector('qap-dialog')`),
            true,
          );
          await evaluate(
            `window.testProfiles.profiles[0].settings.links = Array.from({length:20}, (_, i) => ({...window.originalProfile.settings.links[0],id:'safe-'+i,name:'Shortcut '+i,group:'favorites'})); window.publishProfiles(); for (const [edge,size] of Object.entries({top:80,bottom:30,left:16,right:24})) document.documentElement.style.setProperty('--safe-area-inset-'+edge, size+'px');`,
          );
          assert.equal(
            await evaluate(
              `(() => {const dialog=document.querySelector('qap-dialog'); const shell=dialog.querySelector('.qap-shell'); return shell.getBoundingClientRect().bottom <= dialog.shadowRoot.querySelector("dialog").getBoundingClientRect().bottom - parseFloat(getComputedStyle(dialog.shadowRoot.querySelector("dialog")).paddingBottom) + 1;})()`,
            ),
            true,
          );
          assert.equal((await layout()).overflow, false);
          await evaluate(
            `for (const edge of ['top','bottom','left','right']) document.documentElement.style.removeProperty('--safe-area-inset-'+edge);`,
          );
          await send("Emulation.setDeviceMetricsOverride", {
            width: 844,
            height: 390,
            deviceScaleFactor: 1,
            mobile: false,
          });
          const landscape = await layout();
          assert.ok(
            landscape.height <= 390 + 2 && landscape.bottom <= 391,
            JSON.stringify(landscape),
          );
          await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 844,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await evaluate(
            `window.testProfiles.profiles[0] = structuredClone(window.originalProfile); window.publishProfiles();`,
          );
          await evaluate(`document.querySelector('[title="Settings"]').click()`);
          assert.ok(Math.abs((await layout()).width - Math.min(width, 720)) <= 2);
          assert.equal(
            await evaluate(`window.launcherDialog === document.querySelector('qap-dialog')`),
            true,
          );
          await evaluate(`document.querySelector('.qap-settings-shortcuts').click()`);
          await assertMobileDialogPosition(evaluate, ".qap-settings-dialog");
          assert.deepEqual(
            await evaluate(
              `Array.from(document.querySelectorAll('.qap-shortcut-category-title')).map(heading => heading.textContent)`,
            ),
            ["Favorites"],
          );
          assert.equal(
            await evaluate(
              `document.querySelector('.qap-shortcut-groups').scrollWidth > document.querySelector('.qap-shortcut-groups').clientWidth`,
            ),
            false,
          );
          await verifyCategoryReassignment({ evaluate, send });
          await verifyItemFeedback({ evaluate });
          await verifyShortcutArrangement({ evaluate, send, touch: width <= 390 });
          if (width === 390) await verifyLongReorderLists({ evaluate, send });
          assert.equal(
            await evaluate(
              `document.querySelector('.qap-head-actions .qap-add-shortcut ha-icon').getAttribute('icon')`,
            ),
            "mdi:plus",
          );
          await evaluate(`document.querySelector('.qap-shortcut-overflow').click()`);
          assert.deepEqual(
            await evaluate(
              `Array.from(document.querySelectorAll('.qap-profile-dropdown qap-menu-item'), item => item.textContent)`,
            ),
            ["Disable", "Duplicate", "Delete"],
          );
          assert.equal(
            await evaluate(
              `(() => {const menu=document.querySelector('.qap-profile-dropdown').shadowRoot.querySelector('[popover]').getBoundingClientRect();return menu.left >= 0 && menu.right <= innerWidth && menu.top >= 0 && menu.bottom <= innerHeight;})()`,
            ),
            true,
          );
          await evaluate(`document.querySelector('.qap-shortcut-overflow').click()`);
          await evaluate(
            `document.querySelector('[title="Back"]').click();document.querySelector('.qap-settings-categories').click()`,
          );
          assert.equal(
            await evaluate(
              `document.querySelector('.qap-categories-dialog').open && Boolean(document.querySelector('.qap-categories-dialog .qap-create-category'))`,
            ),
            true,
          );
          await evaluate(`document.querySelector('.qap-create-category').click()`);
          await assertFixedFormActions(evaluate, ".qap-category-modal", ".qap-form-body");
          await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 320,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await assertFixedFormActions(evaluate, ".qap-category-modal", ".qap-form-body");
          await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 844,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await evaluate(`document.querySelector('.qap-category-cancel').click()`);
          await evaluate(`document.querySelector('[title="Back"]').click()`);
          assert.equal(
            await evaluate(
              `document.activeElement === document.querySelector('.qap-settings-categories')`,
            ),
            true,
          );
          await evaluate(
            `document.querySelector('.qap-settings-shortcuts').click();document.querySelector('.qap-add-shortcut').click(); window.draftInput = document.querySelector('.qap-shortcut-form qap-input'); window.draftInput.value = 'Retained draft'; window.draftInput.focus();`,
          );
          assert.ok(Math.abs((await layout()).width - Math.min(width, 720)) <= 2);
          await assertMobileDialogPosition(evaluate, ".qap-settings-dialog");
          await send("Emulation.setDeviceMetricsOverride", {
            width: 390,
            height: 600,
            deviceScaleFactor: 1,
            mobile: false,
          });
          assert.deepEqual(
            await evaluate(
              `({same: document.querySelector('.qap-shortcut-form qap-input') === window.draftInput, focused: document.activeElement === window.draftInput, value: window.draftInput.value})`,
            ),
            { same: true, focused: true, value: "Retained draft" },
          );
          assert.equal((await layout()).overflow, false);
          await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 844,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await evaluate(
            `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
          );
          assert.equal(
            await evaluate(
              `document.querySelector('.qap-category-dropdown qap-select').localName === document.querySelector('.qap-shortcut-form qap-select').localName`,
            ),
            true,
          );
          await evaluate(
            `const category=document.querySelector('.qap-category-dropdown qap-select'); category.value='add-category'; category.dispatchEvent(new Event('change', {bubbles:true}));`,
          );
          await evaluate(`new Promise(resolve => setTimeout(resolve, 40))`);
          assert.deepEqual(
            await evaluate(
              `({inside: document.querySelector('.qap-category-modal').contains(document.activeElement), input: document.activeElement?.localName === 'qap-input'})`,
            ),
            { inside: true, input: false },
            "opening a group form never focuses a field",
          );
          await evaluate(
            `const name=document.querySelector('.qap-category-form qap-input'); name.value='Room'; document.querySelector('.qap-category-submit').click();`,
          );
          await evaluate(`new Promise(resolve => setTimeout(resolve, 40))`);
          assert.deepEqual(
            await evaluate(
              `({name: document.querySelector('.qap-shortcut-form qap-input').value, category: document.querySelector('.qap-category-dropdown qap-select').shadowRoot.querySelector('select').selectedOptions[0].textContent, categories: window.testProfiles.profiles[0].categories.length, previewColumns: getComputedStyle(document.querySelector('.qap-shortcut-preview')).gridTemplateColumns.split(' ').length})`,
            ),
            { name: "Retained draft", category: "Room", categories: 2, previewColumns: 3 },
          );
          await evaluate(
            `document.querySelector('.qap-cancel-shortcut').click();document.querySelector('.qap-discard-changes-confirmation .qap-button-danger').click()`,
          );
          assert.deepEqual(
            await evaluate(
              `Array.from(document.querySelectorAll('.qap-shortcut-category-title')).map(heading => heading.textContent)`,
            ),
            ["Favorites", "Room"],
          );
          await evaluate(
            `document.querySelector('[title="Back"]').click(); document.querySelector('.qap-back-settings').click(); document.querySelector('[data-tab="'+window.testProfiles.profiles[0].categories[1].id+'"]').click();`,
          );
          assert.equal(
            await evaluate(`document.querySelector('.qap-empty strong').textContent`),
            "No shortcuts yet",
          );
          await evaluate(`document.querySelector('.qap-empty .qap-button').click()`);
          assert.equal(
            await evaluate(
              `document.querySelector('.qap-category-dropdown qap-select').shadowRoot.querySelector('select').selectedOptions[0].textContent`,
            ),
            "Room",
          );
          await evaluate(`document.querySelector('.qap-cancel-shortcut').click(); document.querySelector('[data-tab="favorites"]').click();
        document.querySelector('[title="Settings"]').click(); document.querySelector('.qap-settings-categories').click();
        document.querySelector('[data-id="favorites"] .qap-category-edit').click();`);
          assert.equal(
            await evaluate(`document.querySelector('.qap-category-form .qap-title').textContent`),
            "Edit group",
          );
          const responsiveTiles = await evaluate(`(() => {
        const form=document.querySelector('.qap-category-form');
        const columns=form.querySelector('.qap-grid-fields qap-input');
        const preview=form.querySelector('.qap-arrangement-enabled');
        const original=[...preview.children].map(item=>item.dataset.id);
        const measure=()=>{
          const tile=preview.querySelector('.qap-tile'), bounds=tile.getBoundingClientRect();
          const icon=tile.querySelector('.qap-tile-icon .qap-icon').getBoundingClientRect();
          return {width:bounds.width,height:bounds.height,icon:icon.width,
            font:parseFloat(getComputedStyle(tile.querySelector('.qap-tile-name')).fontSize),
            radius:parseFloat(getComputedStyle(tile).borderTopLeftRadius),
            padding:parseFloat(getComputedStyle(tile).paddingTop),
            order:[...preview.children].map(item=>item.dataset.id),original,
            iconFits:icon.left>=bounds.left && icon.right<=bounds.right && icon.top>=bounds.top && icon.bottom<=bounds.bottom,
            scrollable:form.querySelector('.qap-arrangement').scrollWidth>form.querySelector('.qap-arrangement').clientWidth};
        };
        const samples=[2,4,6,10].map(count=>{
          columns.value=String(count);columns.dispatchEvent(new Event('input',{bubbles:true}));return measure();
        });
        preview.style.width='120px';
        samples.push(measure());
        preview.style.width='';
        return samples;
      })()`);
          for (const sample of responsiveTiles) {
            assert.ok(
              sample.height > 0 && Math.abs(sample.height - Math.min(112, sample.width)) < 0.1,
              JSON.stringify(sample),
            );
            assert.equal(
              sample.scrollable,
              false,
              "all selected columns fit the arrangement surface",
            );
            assert.ok(
              Math.abs(sample.padding - sample.height * 0.1) < 0.1,
              "padding scales with the original tile sizing",
            );
            assert.equal(sample.iconFits, true, JSON.stringify(sample));
            assert.deepEqual(
              sample.order,
              sample.original,
              "dimension changes preserve all shortcut IDs",
            );
          }
          for (let index = 1; index < responsiveTiles.length; index++) {
            for (const dimension of ["height", "icon", "font", "radius", "padding"]) {
              assert.ok(
                responsiveTiles[index][dimension] <= responsiveTiles[index - 1][dimension],
                "tiles scale down as the available column width shrinks",
              );
            }
          }
          await evaluate(
            `(() => {const labels=document.querySelector('.qap-grid-labels'); labels.checked=false; labels.dispatchEvent(new Event('change',{bubbles:true}));})()`,
          );
          await evaluate(`(() => {const form=document.querySelector('.qap-category-form'); const [columns,rows]=form.querySelectorAll('.qap-grid-fields qap-input');
        columns.value='7'; rows.value='2'; for(const field of [columns,rows]) field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
          assert.deepEqual(
            await evaluate(`(() => {const preview=document.querySelector('.qap-arrangement-enabled'); return {
        columns:getComputedStyle(preview).gridTemplateColumns.split(' ').length,slots:preview.children.length,overflow:preview.scrollWidth>preview.clientWidth,
        names:preview.querySelectorAll('.qap-tile-name').length,accessible:!!preview.querySelector('.qap-tile')?.getAttribute('aria-label')};})()`),
            { columns: 7, slots: 2, overflow: false, names: 0, accessible: true },
          );
          await assertFixedFormActions(evaluate, ".qap-category-modal", ".qap-form-body");
          await evaluate(`document.querySelector('.qap-category-submit').click()`);
          await evaluate(`new Promise(resolve => setTimeout(resolve, 40))`);
          assert.deepEqual(await evaluate(`window.testProfiles.profiles[0].categories[0].grid`), {
            columns: 7,
            rows: 2,
            hideNames: true,
          });
          await evaluate(
            `document.querySelector('[title="Back"]').click(); document.querySelector('.qap-back-settings').click()`,
          );
          assert.deepEqual(
            await evaluate(`(() => {const grid=document.querySelector('.qap-home .qap-tiles'); return {
        columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,overflow:grid.scrollWidth>grid.clientWidth,
        names:grid.querySelectorAll('.qap-tile-name').length,accessible:!!grid.querySelector('.qap-tile')?.getAttribute('aria-label')};})()`),
            { columns: 7, overflow: false, names: 0, accessible: true },
          );
          assert.equal(
            await evaluate(
              `(() => {const tile=document.querySelector('.qap-home .qap-tile').getBoundingClientRect(); return Math.abs(tile.width-tile.height)<1;})()`,
            ),
            true,
          );
          await evaluate(`document.querySelector('.qap-tile').click()`);
          const rows = await evaluate(
            `Array.from(document.querySelectorAll('.qap-state-row')).map(row => ({name: row.querySelector('.qap-state-name').textContent, idHidden: row.querySelector('.qap-state-id').hidden, first: row.querySelector('.qap-state-info').firstElementChild.className, overflow: row.scrollWidth > row.clientWidth}))`,
          );
          assert.equal(rows.length, 2);
          assert.equal(
            rows.every((row) => row.first === "qap-state-name" && !row.overflow),
            true,
          );
          assert.equal(rows.find((row) => row.name === "sensor.unnamed").idHidden, true);
          assert.equal(
            await evaluate(
              `Object.keys(localStorage).some(key => /categor/.test(localStorage.getItem(key)))`,
            ),
            false,
          );
          await assertMobileDialogPosition(evaluate, ".qap-states-dialog");
          await evaluate(`document.querySelector('.qap-state-summary').click()`);
          await verifyDialogAttributes(evaluate);
          t.diagnostic(
            "Last changed and Last updated use browser locale formatting in the built frontend",
          );
          await evaluate(
            `document.querySelector('.qap-state-modal-head .qap-icon-button').click()`,
          );
          await verifySmartFilters({ evaluate, send, width });
          await verifyVisualFilterTree({ evaluate, send, width });
          await verifyFilterReuse(evaluate, send);
          await evaluate(
            `window.statesDialog = document.querySelector('qap-dialog'); document.querySelector('.qap-state-summary').click();`,
          );
          const details = await evaluate(
            `(() => {const dialog=document.querySelector('.qap-state-modal'); const body=dialog.querySelector('.qap-state-modal-body'); return {width:dialog.shadowRoot.querySelector("dialog").getBoundingClientRect().width,overflow:body.scrollWidth > body.clientWidth};})()`,
          );
          assert.ok(Math.abs(details.width - Math.min(width, 580)) <= 2, JSON.stringify(details));
          assert.equal(details.overflow, false);
          await assertMobileDialogPosition(evaluate, ".qap-state-modal");
          await evaluate(`window.sendBeforeFavoriteFailure = document.querySelector('home-assistant').hass.connection.sendMessagePromise;
        document.querySelector('home-assistant').hass.connection.sendMessagePromise = async () => { throw {message:'Could not save Favorites.'}; };
        document.querySelector('.qap-state-dialog-favorite').click();`);
          const favoriteFailure = await evaluate(`(() => {
        const modal = document.querySelector('.qap-state-modal'), error = modal.querySelector('.qap-error');
        const rect = error.getBoundingClientRect(), header = modal.querySelector('.qap-state-modal-head').getBoundingClientRect();
        return {text:error.textContent, visible:rect.height > 0 && rect.top >= header.bottom && rect.bottom <= innerHeight,
          pressed:modal.querySelector('.qap-state-dialog-favorite').getAttribute('aria-pressed')};
      })()`);
          assert.deepEqual(favoriteFailure, {
            text: "Home Assistant reported an error: Could not save Favorites.",
            visible: true,
            pressed: "false",
          });
          await evaluate(`document.querySelector('home-assistant').hass.connection.sendMessagePromise = window.sendBeforeFavoriteFailure;
        document.querySelector('.qap-state-dialog-favorite').click();`);
          assert.equal(
            await evaluate(`document.querySelector('.qap-state-modal .qap-error').textContent`),
            "",
          );
          assert.equal(
            await evaluate(
              `document.querySelector('.qap-state-dialog-favorite').getAttribute('aria-pressed')`,
            ),
            "true",
          );
          await evaluate(`document.querySelector('.qap-state-dialog-favorite').click();`);
          assert.equal(
            await evaluate(
              `document.querySelector('.qap-state-dialog-favorite').getAttribute('aria-pressed')`,
            ),
            "false",
          );
          await evaluate(`document.querySelector('.qap-state-modal [title="Back"]').click()`);
          assert.equal(
            await evaluate(
              `document.querySelector('qap-dialog') === window.statesDialog && window.statesDialog.open`,
            ),
            true,
          );
          await evaluate(
            `document.querySelector('[title="Back"]').click(); document.querySelector('home-assistant').hass.states = Object.fromEntries(Array.from({length:1000}, (_, i) => {const entity_id='sensor.entity_'+String(i).padStart(4,'0'); return [entity_id,{entity_id,state:String(i),attributes:{friendly_name:'Entity '+i}}];})); document.querySelector('.qap-tile').click();`,
          );
          // The virtual list can need more than one pass after a scroll (render, re-measure the
          // new rows, render again), so wait until the rendered rows stop changing.
          const settleRows = () =>
            evaluate(
              `new Promise(resolve => {
                const snapshot = () => (document.querySelector('.qap-body')?.scrollTop ?? '') + '|' +
                  [...document.querySelectorAll('.qap-state-row')].map(row => (row.dataset.device || row.dataset.entity) + ':' + row.getBoundingClientRect().top).join();
                let previous = null, stable = 0, frames = 0;
                const tick = () => {
                  const current = snapshot();
                  stable = current === previous ? stable + 1 : 0;
                  previous = current;
                  if (stable >= 2 || ++frames >= 60) resolve();
                  else requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
              })`,
            );
          await settleRows();
          assert.ok(Math.abs((await layout()).width - Math.min(width, 580)) <= 2);
          assert.ok(await evaluate(`document.querySelectorAll('.qap-state-row').length < 50`));
          await evaluate(`document.querySelector('.qap-body').scrollTop = 1000000`);
          await settleRows();
          assert.equal(
            await evaluate(`document.querySelector('.qap-state-row:last-child').dataset.entity`),
            "sensor.entity_0999",
          );
          await send("Emulation.setDeviceMetricsOverride", {
            width: 320,
            height: 390,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await settleRows();
          assert.equal((await layout()).overflow, false);
          assert.ok(await evaluate(`document.querySelectorAll('.qap-state-row').length < 50`));
          await evaluate(`document.querySelector('.qap-body').scrollTop = 1000000`);
          await settleRows();
          assert.equal(
            await evaluate(`document.querySelector('.qap-state-row:last-child').dataset.entity`),
            "sensor.entity_0999",
          );
          if (width === 1440) {
            await send("Emulation.setDeviceMetricsOverride", {
              width,
              height: 844,
              deviceScaleFactor: 1,
              mobile: false,
            });
            const reports = await evaluate(`(${measureEntityStates.toString()})()`);
            for (const report of reports) {
              assert.deepEqual(report.idle, { batches: 0, nameReads: 0, listSorts: 0 });
              assert.deepEqual(report.burst, { batches: 1, nameReads: 1, listSorts: 0 });
              assert.equal(report.offscreenNameReads, 8);
              assert.equal(report.visibleUpdated, true);
              assert.equal(report.subscriptions, 1);
              assert.ok(report.rows < 50);
              t.diagnostic(
                `Entity States benchmark (simulated HA, Chromium): ${JSON.stringify(report)}`,
              );
            }
          }
          // Devices use the same bounded viewport and details sheet at every width.
          await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 844,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await evaluate(`document.querySelector('qap-dialog').dispatchEvent(new Event('cancel',{cancelable:true}));
        (()=>{const root=document.querySelector('home-assistant');
          root.hass={...root.hass,areas:{kitchen:{area_id:'kitchen',name:'Kitchen'}},devices:Object.fromEntries(Array.from({length:1000},(_,i)=>{
            const id='device_'+String(i).padStart(4,'0');return [id,{id,name:'Device '+String(i).padStart(4,'0'),name_by_user:null,area_id:'kitchen',manufacturer:'Example',model:'Thermostat',sw_version:'1.2.3',identifiers:[['demo',id]],connections:[['mac','01:23:45:67:89:ab']]}];}))};
          window.testProfiles.profiles[0].settings.links.push({id:'browser-devices',name:'Device Explorer',type:'quick-devices',path:'',icon:'mdi:devices',color:'',group:'favorites'});
          window.publishProfiles();document.querySelector('#qap-fab').click();
          [...document.querySelectorAll('.qap-tile')].find(tile=>(tile.getAttribute('aria-label') || tile.textContent)==='Device Explorer').click();})();`);
          await settleRows();
          assert.equal(
            await evaluate(`document.querySelector('.qap-count').textContent`),
            "1000 devices",
          );
          assert.ok(await evaluate(`document.querySelectorAll('.qap-state-row').length < 50`));
          assert.equal((await layout()).overflow, false);
          await assertMobileDialogPosition(evaluate, ".qap-states-dialog");
          // Cross-registry explanations remain lazy and variable-height rows retain
          // a bounded, non-overlapping virtual window on mobile and desktop.
          await evaluate(`(()=>{const root=document.querySelector('home-assistant');window.beforeIssueStates=root.hass.states;
        root.hass={...root.hass,entities:Object.fromEntries(Object.keys(root.hass.devices).map((id,i)=>['sensor.issue_'+i,{device_id:id}]))};
        window.publishStates(Object.fromEntries(Object.keys(root.hass.devices).map((id,i)=>['sensor.issue_'+i,{entity_id:'sensor.issue_'+i,state:'unknown',attributes:{battery:10}}])));
        document.querySelector('.qap-state-tab[data-domain="entity_issues"]').click();})()`);
          await evaluate(`new Promise(resolve=>setTimeout(resolve,300))`);
          await settleRows();
          assert.equal(
            await evaluate(`document.querySelector('.qap-count').textContent`),
            "1000 devices",
          );
          assert.equal(
            await evaluate(`document.querySelectorAll('.qap-matching-entities > *').length`),
            0,
          );
          const pressTab = async (shiftKey = false) => {
            await send("Input.dispatchKeyEvent", {
              type: "keyDown",
              key: "Tab",
              code: "Tab",
              windowsVirtualKeyCode: 9,
              modifiers: shiftKey ? 8 : 0,
            });
            await send("Input.dispatchKeyEvent", {
              type: "keyUp",
              key: "Tab",
              code: "Tab",
              windowsVirtualKeyCode: 9,
              modifiers: shiftKey ? 8 : 0,
            });
          };
          await evaluate(`document.querySelector('.qap-state-summary').focus()`);
          await pressTab();
          assert.equal(
            await evaluate(
              `document.activeElement===document.querySelector('.qap-matching-count')`,
            ),
            true,
            "Tab reaches the expansion button",
          );
          await pressTab(true);
          assert.equal(
            await evaluate(`document.activeElement===document.querySelector('.qap-state-summary')`),
            true,
            "Shift+Tab returns to the summary",
          );
          await pressTab();
          await evaluate(`document.activeElement.click()`);
          await settleRows();
          assert.equal(
            await evaluate(`document.activeElement.getAttribute('aria-expanded')`),
            "true",
          );
          assert.equal(
            await evaluate(
              `document.querySelector('.qap-matching-entities .qap-state-name').textContent`,
            ),
            "sensor.issue_0",
          );
          await pressTab();
          assert.equal(
            await evaluate(
              `document.activeElement===document.querySelector('.qap-matching-entity .qap-state-summary')`,
            ),
            true,
            "Tab reaches the matching entity",
          );
          await evaluate(`document.activeElement.click()`);
          await evaluate(settleDialogsExpression);
          assert.equal(
            await evaluate(`document.querySelector('.qap-state-modal h2').textContent`),
            "Entity details",
          );
          assert.equal(
            await evaluate(`document.querySelector('.qap-state-modal').dataset.entity`),
            "sensor.issue_0",
          );
          await evaluate(
            `document.querySelector('.qap-state-modal-head .qap-icon-button').click()`,
          );
          await evaluate(settleDialogsExpression);
          assert.equal(
            await evaluate(
              `document.activeElement===document.querySelector('.qap-matching-entity .qap-state-summary')`,
            ),
            true,
          );
          await pressTab();
          assert.equal(
            await evaluate(
              `document.activeElement===document.querySelector('[data-device="device_0001"] .qap-state-summary')`,
            ),
            true,
          );
          await pressTab(true);
          assert.equal(
            await evaluate(
              `document.activeElement===document.querySelector('.qap-matching-entity .qap-state-summary')`,
            ),
            true,
          );
          await pressTab(true);
          assert.equal(
            await evaluate(
              `document.activeElement===document.querySelector('.qap-matching-count')`,
            ),
            true,
          );
          assert.equal(
            await evaluate(
              `(()=>{const rows=[...document.querySelector('.qap-state-list-virtual').children];return rows.every((row,i)=>!i||row.getBoundingClientRect().top>=rows[i-1].getBoundingClientRect().bottom-1);})()`,
            ),
            true,
          );
          await evaluate(
            `document.querySelector('.qap-matching-count').click();document.querySelector('.qap-matching-count').click()`,
          );
          assert.equal(
            await evaluate(`document.querySelector('.qap-matching-entities').children.length`),
            1,
          );
          await pressTab();
          await evaluate(`document.querySelector('.qap-body').scrollTop=50000`);
          await settleRows();
          assert.equal(
            await evaluate(`document.querySelector('[data-device="device_0001"]')===null`),
            true,
          );
          await pressTab();
          assert.equal(
            await evaluate(
              `document.activeElement===document.querySelector('[data-device="device_0001"] .qap-state-summary')`,
            ),
            true,
            "Tab mounts the next row from the matching entity",
          );
          await evaluate(`document.querySelector('.qap-body').scrollTop=50000`);
          await settleRows();
          assert.equal(
            await evaluate(`document.querySelector('[data-device="device_0000"]')===null`),
            true,
          );
          await pressTab(true);
          assert.equal(
            await evaluate(
              `document.activeElement===document.querySelector('[data-device="device_0000"] .qap-matching-count')`,
            ),
            true,
            "Shift+Tab mounts the previous row and focuses its last control",
          );
          await evaluate(`document.querySelector('.qap-body').scrollTop=1000000`);
          await settleRows();
          assert.equal(
            await evaluate(`document.querySelector('.qap-state-row:last-child').dataset.device`),
            "device_0999",
          );
          assert.ok(await evaluate(`document.querySelectorAll('.qap-state-row').length < 50`));
          await evaluate(`document.querySelector('.qap-state-tab[data-domain="all"]').click();document.querySelector('.qap-filter-action').click();
        document.querySelector('.qap-create-filter').click();
        document.querySelector('.qap-filter-rule-toggle').click();
        (()=>{const panel=document.querySelector('.qap-filter-panel'),input=panel.querySelector('qap-input');input.value='Browser manufacturer';input.dispatchEvent(new Event('input'));
          const field=panel.querySelector('.qap-filter-rule qap-select');field.value='manufacturer';field.dispatchEvent(new Event('change'));
          const value=panel.querySelectorAll('.qap-filter-rule qap-select')[2];value.value='Example';value.dispatchEvent(new Event('change'));})();`);
          assert.equal(
            await evaluate(`document.querySelector('.qap-filter-preview').textContent`),
            "1000 matching devices",
          );
          assert.equal(
            await evaluate(`(()=>{const parent=document.querySelector('.qap-states-dialog'),modal=document.querySelector('.qap-filter-modal');
        return modal.open&&modal.classList.contains('qap-editor-dialog')&&!parent.querySelector('.qap-filter-panel')&&modal.querySelector('.qap-editor-close')!==null;})()`),
            true,
            "Device filter editing uses the shared editor dialog",
          );
          await assertFixedFormActions(evaluate, ".qap-filter-modal", ".qap-filter-editor-body");
          assert.equal(
            await evaluate(
              `(()=>{const panel=document.querySelector('.qap-filter-panel');return panel.scrollWidth>panel.clientWidth;})()`,
            ),
            false,
          );
          const writesBeforeFilter = await evaluate(`window.profileWrites.length`);
          await evaluate(
            `[...document.querySelectorAll('.qap-filter-panel .qap-button')].find(button=>button.textContent==='Apply temporarily').click()`,
          );
          assert.equal(await evaluate(`window.profileWrites.length`), writesBeforeFilter);
          await evaluate(
            `document.querySelector('.qap-state-tab[data-domain="all"]').click();window.publishStates(window.beforeIssueStates)`,
          );
          await settleRows();
          await evaluate(`document.querySelector('.qap-body').scrollTop=1000000`);
          await settleRows();
          assert.equal(
            await evaluate(`document.querySelector('.qap-state-row:last-child').dataset.device`),
            "device_0999",
          );
          await evaluate(
            `document.querySelector('.qap-state-row:last-child .qap-state-summary').click()`,
          );
          const deviceDetails =
            await evaluate(`(()=>{const modal=document.querySelector('.qap-state-modal'),rect=modal.getBoundingClientRect(),body=modal.querySelector('.qap-state-modal-body');return {
        title:modal.querySelector('h2').textContent,area:modal.querySelector('.qap-state-dialog-value').textContent,
        rows:[...modal.querySelectorAll('.qap-state-dialog-state-line')].map(row=>[row.querySelector('.qap-state-dialog-state-label').textContent,row.querySelector('.qap-state-dialog-value').textContent]),
        structured:modal.querySelector('qap-attributes-viewer').value,
        overflow:body.scrollWidth>body.clientWidth,width:rect.width,bottom:rect.bottom};})()`);
          assert.equal(deviceDetails.title, "Device details");
          assert.equal(deviceDetails.area, "Kitchen");
          assert.deepEqual(deviceDetails.rows, [
            ["Area", "Kitchen"],
            ["Manufacturer", "Example"],
            ["Model", "Thermostat"],
            ["Software version", "1.2.3"],
          ]);
          assert.deepEqual(
            loadYaml(deviceDetails.structured, { schema: YAML11_SCHEMA }).identifiers,
            [["demo", "device_0999"]],
          );
          assert.equal(deviceDetails.overflow, false);
          assert.ok(deviceDetails.width <= width);
          assert.ok(deviceDetails.bottom <= 844);
          await assertMobileDialogPosition(evaluate, ".qap-state-modal");
          await evaluate(`document.querySelector('.qap-state-dialog-favorite').click()`);
          assert.deepEqual(await evaluate(`window.testProfiles.profiles[0].device_favorites`), [
            "device_0999",
          ]);
          await evaluate(
            `document.querySelector('.qap-state-modal').dispatchEvent(new Event('cancel',{cancelable:true}))`,
          );
          assert.equal(
            await evaluate(`document.activeElement.closest('.qap-state-row')?.dataset.device`),
            "device_0999",
          );
          // Reproduce the older HA icon-button API: it renders a shadow button and
          // does not declare or use href. Navigation must still be a real anchor.
          await evaluate(`customElements.define('ha-icon-button',class extends HTMLElement {
          constructor(){super();this.attachShadow({mode:'open'}).innerHTML='<button type="button"><slot></slot></button>';}
          connectedCallback(){this.shadowRoot.querySelector('button').setAttribute('aria-label',this.label||'');}
        });
        document.activeElement.click();window.deviceNavigationBlocked=true;window.deviceNavigationAttempts=0;
        window.deviceNavigationStart=location.pathname;
        window.navigation.addEventListener('navigate',event=>{
          if(new URL(event.destination.url).pathname!=='/config/devices/device/device_0999')return;
          window.deviceNavigationAttempts++;
          if(window.deviceNavigationBlocked){event.preventDefault();return;}
          event.intercept({handler:()=>window.dispatchEvent(new CustomEvent('location-changed',{detail:{replace:false}}))});
        });`);
          assert.equal(
            await evaluate(`document.querySelector('.qap-state-dialog-info').getAttribute('href')`),
            "/config/devices/device/device_0999",
          );
          assert.equal(
            await evaluate(`document.querySelector('.qap-state-dialog-info').localName`),
            "qap-icon-button",
          );
          assert.equal(
            await evaluate(`document.querySelector('.qap-state-dialog-favorite').localName`),
            "qap-icon-button",
          );
          const infoPoint = await evaluate(
            `(()=>{const link=document.querySelector('.qap-state-dialog-info');link.scrollIntoView({block:'center'});const rect=link.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`,
          );
          const clickDeviceInfo = async () => {
            await send("Input.dispatchMouseEvent", {
              type: "mousePressed",
              ...infoPoint,
              button: "left",
              clickCount: 1,
            });
            await send("Input.dispatchMouseEvent", {
              type: "mouseReleased",
              ...infoPoint,
              button: "left",
              clickCount: 1,
            });
          };
          await clickDeviceInfo();
          assert.equal(await evaluate(`window.deviceNavigationAttempts`), 1);
          assert.equal(
            await evaluate(
              `location.pathname===window.deviceNavigationStart&&document.querySelector('.qap-state-modal').open`,
            ),
            true,
          );
          await evaluate(`window.deviceNavigationBlocked=false`);
          await clickDeviceInfo();
          await evaluate(`window.navigation.transition?.finished`);
          assert.equal(await evaluate(`location.pathname`), "/config/devices/device/device_0999");
          assert.equal(await evaluate(`document.querySelector('qap-dialog[open]')`), null);
          await evaluate(
            `Object.assign(window.testProfiles.profiles[0].settings,{visibility:'include',routes:['/missing/*']}); window.publishProfiles();`,
          );
          assert.equal(await evaluate("window.stateSubscriberCount()"), 0);
          assert.equal(await evaluate(`document.querySelector('#qap-fab').hidden`), true);
          // Device recovery remains available when the launcher is hidden.
          await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 844,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await evaluate(`(() => {
        history.replaceState(history.state, '', '/quick-access-config');
        document.body.style.margin='0';
        document.querySelector('home-assistant').hass.user.is_admin=false;
      })(); (async () => { await import('/quick_access/quick_access_config.js');
        window.configPanel=document.createElement('quick-access-config');
        window.configPanel.hass=document.querySelector('home-assistant').hass;
        window.configPanel.narrow=innerWidth<=870;
        window.configPanel.style.height='100vh';
        const root=document.querySelector('home-assistant');
        (root.shadowRoot||root.attachShadow({mode:'open'})).append(window.configPanel); })()`);
          await evaluate(
            `new Promise((resolve,reject)=>{const link=window.configPanel.shadowRoot.querySelector('link'); if(link.sheet)resolve();else {link.onload=resolve;link.onerror=reject;}})`,
          );
          assert.equal(
            await evaluate(
              `new URL(window.configPanel.shadowRoot.querySelector('link').href).pathname + new URL(window.configPanel.shadowRoot.querySelector('link').href).search`,
            ),
            `/quick_access/quick_access_config.css?v=${assetVersion}`,
          );
          if (width === 320) {
            await evaluate(
              `window.configPanel.hass={...window.configPanel.hass,language:'hr'};window.configPanel._localizer.ready`,
            );
            assert.deepEqual(
              await evaluate(
                `[...window.configPanel.shadowRoot.querySelectorAll('h2')].map(element=>element.textContent)`,
              ),
              ["Ovaj preglednik"],
            );
            assert.deepEqual(
              await evaluate(
                `performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/quick_access/locales/')).map(entry=>new URL(entry.name).pathname+new URL(entry.name).search)`,
              ),
              [`/quick_access/locales/hr.json?v=${assetVersion}`],
            );
            await evaluate(
              `window.configPanel.hass={...window.configPanel.hass,language:'en'};window.configPanel._localizer.ready`,
            );
          }
          const panelLayout = await evaluate(`(() => {
        const p=window.configPanel, main=p.shadowRoot.querySelector('main');
        return {overflow:p.scrollWidth>p.clientWidth||main.scrollWidth>main.clientWidth,
          width:main.getBoundingClientRect().width, availableWidth:p.clientWidth, sections:p.shadowRoot.querySelectorAll('.qap-config-card').length,
          inputs:[...p.shadowRoot.querySelectorAll('input:not([type="checkbox"])')].map(e=>e.getBoundingClientRect().height),
          launcherLabel:p.shadowRoot.querySelector('.launcher-setting label').getBoundingClientRect().height};
      })()`);
          assert.equal(panelLayout.overflow, false, JSON.stringify(panelLayout));
          assert.ok(
            panelLayout.width <= 960 &&
              panelLayout.width >= Math.min(panelLayout.availableWidth, 900),
            JSON.stringify(panelLayout),
          );
          assert.equal(panelLayout.sections, 1);
          assert.ok(panelLayout.inputs.every((height) => height >= 44));
          assert.ok(panelLayout.launcherLabel >= 44);
          assert.deepEqual(
            await evaluate(
              `[...window.configPanel.shadowRoot.querySelectorAll('h2')].map(e=>e.textContent)`,
            ),
            ["This browser"],
          );
          assert.equal(
            await evaluate(
              `window.configPanel._profileSelect.value===window.testProfiles.profiles[0].id`,
            ),
            true,
          );
          const confirmLayout = async (reset) => {
            await evaluate(
              `window.configPanel.${reset ? "_resetVisibility" : "_removeSelection"}.scrollIntoView({block:'center'});window.configPanel.${reset ? "_resetVisibility" : "_removeSelection"}.click()`,
            );
            const measured = await evaluate(
              `(() => {const d=window.configPanel.shadowRoot.querySelector('qap-dialog');const surface=d.shadowRoot.querySelector('dialog'),r=surface.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:surface.scrollWidth>surface.clientWidth,buttons:[...d.querySelectorAll('button, qap-button, qap-icon-button')].map(b=>b.getBoundingClientRect().height),title:d.querySelector('h2').textContent};})()`,
            );
            assert.equal(measured.overflow, false, JSON.stringify(measured));
            assert.ok(measured.left >= 0 && measured.right <= width + 1, JSON.stringify(measured));
            assert.ok(measured.top >= 0 && measured.bottom <= 845, JSON.stringify(measured));
            assert.ok(measured.buttons.every((h) => h >= 44));
            assert.match(
              measured.title,
              reset ? /Reset display rules/ : /Remove profile selection/,
            );
          };
          const writesBeforeDevice = await evaluate(`window.profileWrites.length`);
          await evaluate(
            `window.localBefore=new Map(Object.entries(localStorage));window.profileBefore=structuredClone(window.testProfiles.profiles);`,
          );
          await confirmLayout(false);
          await evaluate(`window.configPanel.shadowRoot.querySelector('.confirm-device').click()`);
          assert.equal(await evaluate(`window.quickAccessDebug().activeProfileId`), null);
          assert.equal(await evaluate(`document.querySelector('#qap-fab').hidden`), false);
          assert.equal(
            await evaluate(`document.querySelector('#qap-fab').getAttribute('aria-label')`),
            "Set up Quick Access",
          );
          assert.equal(
            await evaluate(`window.configPanel._deviceName.textContent`),
            "No profile selected in this browser",
          );
          assert.equal(await evaluate(`window.configPanel._resetVisibility.disabled`), true);
          assert.equal(await evaluate(`window.profileWrites.length`), writesBeforeDevice);
          assert.equal(
            await evaluate(
              `JSON.stringify(window.testProfiles.profiles)===JSON.stringify(window.profileBefore)`,
            ),
            true,
          );
          assert.equal(
            await evaluate(
              `[...window.localBefore].every(([key,value])=>key.endsWith(':active-profile')?localStorage.getItem(key)===null:localStorage.getItem(key)===value)`,
            ),
            true,
          );
          await evaluate(`window.publishProfiles();window.publishQuotas()`);
          assert.equal(await evaluate(`window.quickAccessDebug().activeProfileId`), null);
          await evaluate(
            `window.configPanel._profileSelect.value=window.testProfiles.profiles[0].id;window.configPanel._profileSelect.dispatchEvent(new Event('change',{bubbles:true}))`,
          );
          assert.equal(
            await evaluate(
              `window.quickAccessDebug().activeProfileId===window.testProfiles.profiles[0].id`,
            ),
            true,
          );
          assert.equal(await evaluate(`document.querySelector('#qap-fab').hidden`), true);
          await evaluate(`window.failWrite=true`);
          await confirmLayout(true);
          await evaluate(`window.configPanel.shadowRoot.querySelector('.confirm-device').click()`);
          assert.match(
            await evaluate(`window.configPanel._deviceStatus.textContent`),
            /Simulated storage failure/,
          );
          assert.equal(
            await evaluate(`window.testProfiles.profiles[0].settings.visibility`),
            "include",
          );
          await evaluate(`window.failWrite=false`);
          await confirmLayout(true);
          await evaluate(`window.configPanel.shadowRoot.querySelector('.confirm-device').click()`);
          assert.equal(await evaluate(`window.configPanel._deviceStatus.hidden`), true);
          assert.equal(await evaluate(`document.querySelector('#qap-fab').hidden`), false);
          assert.deepEqual(
            await evaluate(`Object.keys(window.testProfiles.profiles[0].settings).sort()`),
            ["links", "routes", "visibility"],
          );
          assert.equal(
            await evaluate(
              `JSON.stringify(window.testProfiles.profiles[0])===JSON.stringify({...window.profileBefore[0],settings:{...window.profileBefore[0].settings,visibility:'exclude',routes:[]}})`,
            ),
            true,
          );
          // Real storage events arrive from another same-origin browser tab.
          const { targetId: storageTarget } = await browser.send("Target.createTarget", { url });
          const { sessionId: storageSession } = await browser.send("Target.attachToTarget", {
            targetId: storageTarget,
            flatten: true,
          });
          for (let attempt = 0; attempt < 100; attempt++) {
            const result = await browser.send(
              "Runtime.evaluate",
              {
                expression: "location.origin === " + JSON.stringify(new URL(url).origin),
                returnByValue: true,
              },
              storageSession,
            );
            if (result.result.value) break;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          const key = "quick_access_v1:browser-test:browser-user:active-profile";
          const id = await evaluate(`window.testProfiles.profiles[0].id`);
          const writesBeforeStorage = await evaluate(`window.profileWrites.length`);
          await browser.send(
            "Runtime.evaluate",
            { expression: `localStorage.removeItem(${JSON.stringify(key)})` },
            storageSession,
          );
          await evaluate(
            `new Promise((resolve,reject)=>{const poll=setInterval(()=>{if(window.quickAccessDebug().activeProfileId===null){clearInterval(poll);resolve();}},10);setTimeout(()=>{clearInterval(poll);reject(Error('Storage removal not received'));},2000);})`,
          );
          assert.equal(await evaluate(`window.configPanel._profileSelect.value`), "");
          assert.equal(await evaluate(`document.querySelector('#qap-fab').hidden`), false);
          await evaluate(
            `window.configPanel.shadowRoot.querySelector('.launcher-setting label').click()`,
          );
          assert.equal(await evaluate(`document.querySelector('#qap-fab').hidden`), true);
          assert.equal(await evaluate(`window.configPanel._launcherToggle.checked`), false);
          await evaluate(`window.publishProfiles()`);
          assert.equal(
            await evaluate(`document.querySelector('#qap-fab').hidden`),
            true,
            "no-profile updates must keep the launcher disabled",
          );
          const launcherPreferenceKey =
            "quick_access_v1:browser-test:browser-user:launcher-enabled";
          for (const enabled of [true, false, true]) {
            await browser.send(
              "Runtime.evaluate",
              {
                expression: `localStorage.setItem(${JSON.stringify(launcherPreferenceKey)},${JSON.stringify(String(enabled))})`,
              },
              storageSession,
            );
            await evaluate(
              `new Promise((resolve,reject)=>{const poll=setInterval(()=>{if(window.configPanel._launcherToggle.checked===${enabled}&&document.querySelector('#qap-fab').hidden===${!enabled}){clearInterval(poll);resolve();}},10);setTimeout(()=>{clearInterval(poll);reject(Error('Launcher preference not received'));},2000);})`,
            );
          }
          await browser.send(
            "Runtime.evaluate",
            {
              expression: `localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(JSON.stringify(id))})`,
            },
            storageSession,
          );
          await evaluate(
            `new Promise((resolve,reject)=>{const poll=setInterval(()=>{if(window.quickAccessDebug().activeProfileId!==null){clearInterval(poll);resolve();}},10);setTimeout(()=>{clearInterval(poll);reject(Error('Storage selection not received'));},2000);})`,
          );
          assert.equal(await evaluate(`document.querySelector('#qap-fab').hidden`), false);
          assert.equal(await evaluate(`window.profileWrites.length`), writesBeforeStorage);
          await browser.send("Target.closeTarget", { targetId: storageTarget });
          await evaluate(
            `document.querySelector('#qap-fab').click();new Promise(resolve=>setTimeout(resolve,100))`,
          );
          await evaluate(`document.querySelector('[title="Settings"]').click()`);

          await evaluate(`document.querySelector('.qap-settings-visibility').click()`);
          for (const [background, foreground] of [
            ["#fafafa", "#212121"],
            ["#111111", "#eeeeee"],
            ["#203040", "#e0d0c0"],
          ]) {
            const colors = await evaluate(`(() => {
          const p=window.configPanel;
          p.style.setProperty('--primary-background-color',${JSON.stringify(background)});
          p.style.setProperty('--card-background-color',${JSON.stringify(background)});
          p.style.setProperty('--primary-text-color',${JSON.stringify(foreground)});
          const s=getComputedStyle(p);
          const options=[...p._profileSelect.shadowRoot.querySelectorAll('select option')].map(option=>{
            const style=getComputedStyle(option);return [style.backgroundColor,style.color];
          });
          const shell=document.querySelector('.qap-shell');
          shell.style.setProperty('--primary-background-color',${JSON.stringify(background)});
          shell.style.setProperty('--card-background-color',${JSON.stringify(background)});
          shell.style.setProperty('--primary-text-color',${JSON.stringify(foreground)});
          const launcherOptions=[...shell.querySelectorAll('qap-select')].flatMap(control=>[...control.shadowRoot.querySelectorAll('select option')]).map(option=>{
            const style=getComputedStyle(option);return [style.backgroundColor,style.color];
          });
          return {panel:[s.backgroundColor,s.color],options,launcherOptions};
        })()`);
            const rgb = (hex) =>
              `rgb(${[1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)).join(", ")})`;
            const expected = [rgb(background), rgb(foreground)];
            assert.deepEqual(colors.panel, expected);
            assert.ok(colors.options.length > 0);
            assert.ok(colors.launcherOptions.length > 0);
            for (const option of [...colors.options, ...colors.launcherOptions])
              assert.deepEqual(option, expected);
          }
          await evaluate(
            `document.querySelector('[title="Back"]').click();document.querySelector('.qap-back-settings').click();document.querySelector('[title="Close"]').click()`,
          );
          await evaluate(
            `window.configPanel.remove();document.querySelector('home-assistant').shadowRoot.append(window.configPanel)`,
          );
          assert.equal(
            await evaluate(
              `window.configPanel.shadowRoot.querySelectorAll('.qap-config-card').length`,
            ),
            1,
          );
          assert.equal(await evaluate(`window.configPanel._profileSelect.disabled`), false);
          assert.equal(
            await evaluate(`window.configPanel.shadowRoot.querySelector('form,hass-subpage')`),
            null,
          );
          await evaluate(
            `window.menuCount=0;window.configPanel.addEventListener('hass-toggle-menu',()=>menuCount++);window.configPanel.shadowRoot.querySelector('.menu').click()`,
          );
          assert.equal(await evaluate(`window.menuCount`), 1);
          await browser.send("Target.closeTarget", { targetId });
        });
    } finally {
      await browser?.close();
      await new Promise((resolve) => server.close(resolve));
      // Chromium's profile handles may take a moment to close on Windows.
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(path.dirname(directory), path.resolve(tmpdir()));
      assert.ok(path.basename(directory).startsWith("quick-access-browser-"));
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);
