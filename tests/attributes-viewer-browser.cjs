const assert = require("node:assert/strict");
const { dump, YAML11_SCHEMA } = require("js-yaml");
const path = require("node:path");
const { frontendFiles } = require("./module-loader.cjs");

const viewerChunk = frontendFiles(
  path.join(__dirname, "../custom_components/quick_access/frontend"),
).find((file) => /^chunks\/attributes-viewer-/.test(file));

async function loadViewer(evaluate) {
  await evaluate(`(async()=>{
    const {QapAttributesViewer}=await import('/quick_access/${viewerChunk}');
    if(!customElements.get('qap-attributes-viewer'))customElements.define('qap-attributes-viewer',QapAttributesViewer);
  })()`);
}

const attributes = {
  friendly_name: "Kitchen",
  nested: { list: ["on", null, false, 12, "", {}, []] },
  multiline: "line 1\nline 2\n",
  unsafe: "<img src=x onerror=alert(1)>",
  long: "x".repeat(500),
};
const yaml = dump(attributes, { schema: YAML11_SCHEMA, noRefs: true });

async function verifyAttributesViewer({ evaluate, key, send, width }, plain = false) {
  await loadViewer(evaluate);
  await evaluate(`(async()=>{
    window.attributesDialog=document.createElement('qap-dialog');attributesDialog.setAttribute('aria-label','Details');
    const wrapper=document.createElement('div');wrapper.className='qap-state-dialog-editor';wrapper.style.cssText='width:calc(100vw - 80px);max-width:600px;font-size:14px';
    window.attributesViewer=document.createElement('qap-attributes-viewer');attributesViewer.label='Entity attributes';
    attributesViewer.style.setProperty('--code-mirror-max-height','180px');attributesViewer.value=${JSON.stringify(yaml)}.repeat(${plain ? 200 : 30});
    window.attributeCopies=[];window.attributeChanges=0;attributesViewer.addEventListener('copy-request',e=>attributeCopies.push({value:e.detail.value,bubbles:e.bubbles,composed:e.composed}));
    attributesViewer.addEventListener('value-changed',()=>attributeChanges++);
    wrapper.append(attributesViewer);attributesDialog.append(wrapper);document.body.append(attributesDialog);attributesDialog.showModal();
    await attributesDialog.updateComplete;await attributesViewer.updateComplete;
    window.attributePre=attributesViewer.shadowRoot.querySelector('.content');window.attributeScroller=attributesViewer.shadowRoot.querySelector('.scroller');
  })()`);
  assert.equal(
    await evaluate(
      `attributePre.textContent===attributesViewer.value&&!attributesViewer.shadowRoot.querySelector('img,script,textarea,[contenteditable]')`,
    ),
    true,
  );
  assert.equal(
    await evaluate(`attributePre.querySelectorAll('span').length===0`),
    plain,
    "large YAML uses escaped text without highlighted spans",
  );
  assert.equal(
    await evaluate(
      `customElements.get('ha-yaml-editor')===undefined&&customElements.get('ha-code-editor')===undefined`,
    ),
    true,
  );
  const { nodes } = await send("Accessibility.getFullAXTree");
  assert.equal(
    nodes.filter(
      (node) =>
        !node.ignored && node.role?.value === "region" && node.name?.value === "Entity attributes",
    ).length,
    1,
  );
  assert.equal(
    nodes.filter(
      (node) =>
        !node.ignored && node.role?.value === "button" && node.name?.value === "Copy to clipboard",
    ).length,
    1,
  );
  assert.equal(
    await evaluate(`attributesViewer.shadowRoot.querySelector('[aria-live]')===null`),
    true,
  );
  assert.equal(
    await evaluate(
      `(()=>{const button=attributesViewer.shadowRoot.querySelector('qap-icon-button').getBoundingClientRect(),icon=attributesViewer.shadowRoot.querySelector('qap-icon').getBoundingClientRect();return icon.left>=button.left&&icon.right<=button.right;})()`,
    ),
    true,
    "the copy icon fits its toolbar button",
  );
  await evaluate(`attributeScroller.focus()`);
  await key("ArrowDown", "ArrowDown");
  await evaluate(`new Promise(resolve=>setTimeout(resolve,150))`);
  assert.equal(
    await evaluate(`attributeScroller.scrollTop>0`),
    true,
    "the attributes region scrolls with the keyboard",
  );
  if (width === 320) {
    const point = await evaluate(
      `(()=>{attributeScroller.scrollTop=0;const rect=attributeScroller.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.bottom-30};})()`,
    );
    await send("Emulation.setTouchEmulationEnabled", { enabled: true });
    try {
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      for (let step = 1; step <= 6; step++) {
        await send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: point.x, y: point.y - step * 12 }],
        });
      }
      // Cancel the final fling so its momentum cannot affect the next, separate
      // scroll-retention assertion while live data is being updated.
      await send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await evaluate(`new Promise(resolve=>setTimeout(resolve,150))`);
      assert.equal(
        await evaluate(`attributeScroller.scrollTop>0&&attributesDialog.open`),
        true,
        "touch scrolling stays inside the attributes region",
      );
    } finally {
      await send("Emulation.setTouchEmulationEnabled", { enabled: false });
    }
  }
  // Leftover touch momentum can still move the region on slow machines. Wait until scrolling
  // has stopped before and after setting the position, so only the update below can move it.
  await evaluate(`(async()=>{
    const settle=()=>new Promise(resolve=>{let previous=null,stable=0,frames=0;const tick=()=>{
      const current=attributeScroller.scrollTop+','+attributeScroller.scrollLeft;
      stable=current===previous?stable+1:0;previous=current;
      if(stable>=3||++frames>=120)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);});
    await settle();
    attributeScroller.scrollTop=160;attributeScroller.scrollLeft=100;
    await settle();
    window.attributeScroll=[attributeScroller.scrollTop,attributeScroller.scrollLeft];attributeScroller.focus();
  })()`);
  await evaluate(
    `attributesViewer.value=attributesViewer.value.replace('Kitchen','Updated');attributesViewer.label='Updated attributes';attributesViewer.updateComplete`,
  );
  assert.deepEqual(
    await evaluate(`[attributeScroller.scrollTop,attributeScroller.scrollLeft]`),
    await evaluate(`attributeScroll`),
  );
  assert.equal(
    await evaluate(
      `attributePre===attributesViewer.shadowRoot.querySelector('.content')&&attributesViewer.shadowRoot.activeElement===attributeScroller&&attributePre.textContent===attributesViewer.value`,
    ),
    true,
  );
  await key("Tab", "Tab");
  assert.equal(
    await evaluate(`attributesDialog.open`),
    true,
    "the viewer participates in the existing dialog focus trap",
  );
  await evaluate(`attributesViewer.shadowRoot.querySelector('qap-icon-button').focus()`);
  await key("Enter", "Enter");
  assert.deepEqual(await evaluate(`attributeCopies`), [
    { value: await evaluate(`attributesViewer.value`), bubbles: true, composed: true },
  ]);
  assert.equal(await evaluate(`attributeChanges`), 0);
  await evaluate(
    `(()=>{const selection=getSelection(),range=document.createRange();range.selectNodeContents(attributePre);selection.removeAllRanges();selection.addRange(range);})()`,
  );
  assert.equal(
    await evaluate(`getSelection().toString().replace(/\\n$/,'')`),
    await evaluate(`attributesViewer.value.replace(/\\n$/,'')`),
  );
  await evaluate(
    `getSelection().removeAllRanges();attributesViewer.value='';attributesViewer.updateComplete`,
  );
  assert.equal(
    await evaluate(
      `attributePre.textContent===''&&attributesViewer.shadowRoot.querySelector('qap-icon-button').disabled`,
    ),
    true,
  );
  await evaluate(`attributesDialog.remove()`);
}

async function verifyDialogAttributes(evaluate) {
  await evaluate(`(()=>{
    window.attributeDialog=document.querySelector('.qap-state-modal');window.dialogAttributeViewer=attributeDialog.querySelector('qap-attributes-viewer');
    window.attributeOriginalStates=document.querySelector('home-assistant').hass.states;
    window.attributeClipboardDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');window.dialogAttributeCopies=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>dialogAttributeCopies.push(text)}});
    const id=attributeDialog.dataset.id,record=attributeOriginalStates[id];
    window.publishStates({...attributeOriginalStates,[id]:{...record,last_changed:'2026-11-06T19:23:45.600Z',last_updated:'2026-11-06T19:24:46.700Z',attributes:{...record.attributes,...${JSON.stringify(attributes)}}}});
  })()`);
  try {
    await evaluate(
      `new Promise((resolve,reject)=>{let attempts=0;const poll=()=>{if(dialogAttributeViewer.value.includes('multiline: |'))resolve();else if(attempts++>50)reject(Error('Live attribute update did not render'));else setTimeout(poll,20);};poll();})`,
    );
    const timestamps = await evaluate(`(()=>{
      const fields=['last_changed','last_updated'];
      const record=document.querySelector('home-assistant').hass.states[attributeDialog.dataset.id];
      return {
        actual:fields.map(field=>attributeDialog.querySelector('[data-field="'+field+'"] .qap-state-dialog-value').textContent),
        expected:fields.map(field=>new Date(record[field]).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'medium'}))
      };
    })()`);
    assert.deepEqual(
      timestamps.actual,
      timestamps.expected,
      "shipped entity timestamps use browser formatting",
    );
    assert.equal(
      await evaluate(
        `attributeDialog===document.querySelector('.qap-state-modal')&&dialogAttributeViewer===attributeDialog.querySelector('qap-attributes-viewer')&&dialogAttributeViewer.shadowRoot.querySelector('.content').textContent===dialogAttributeViewer.value`,
      ),
      true,
    );
    await evaluate(
      `dialogAttributeViewer.shadowRoot.querySelector('qap-icon-button').click();new Promise(resolve=>setTimeout(resolve,0))`,
    );
    assert.deepEqual(await evaluate(`dialogAttributeCopies`), [
      await evaluate(`dialogAttributeViewer.value`),
    ]);
    assert.equal(
      await evaluate(`attributeDialog.querySelector('qap-toast').labelText`),
      "Copied to clipboard",
    );
  } finally {
    await evaluate(
      `window.publishStates(attributeOriginalStates);if(attributeClipboardDescriptor)Object.defineProperty(navigator,'clipboard',attributeClipboardDescriptor);else delete navigator.clipboard;new Promise(resolve=>setTimeout(resolve,300))`,
    );
  }
}

async function verifyAttributesViewerParity(evaluate, darkTheme) {
  await loadViewer(evaluate);
  const previousTheme = await evaluate(`document.documentElement.style.cssText`);
  await evaluate(`(async()=>{
    const loader=document.createElement('ha-form');loader.hass=nativeHass;loader.data={};loader.schema=[{name:'reference',selector:{object:{}}}];loader.hidden=true;document.body.append(loader);
    try { await Promise.race([customElements.whenDefined('ha-yaml-editor'),new Promise((_,reject)=>setTimeout(()=>reject(Error('HA reference editor did not load')),5000))]); }
    finally { loader.remove(); }
    window.attributesParity=document.createElement('section');attributesParity.style.cssText='position:fixed;z-index:2147483647;inset:0;overflow:auto;display:grid;gap:16px;padding:16px;background:var(--primary-background-color);font-size:14px';
    window.nativeAttributes=document.createElement('ha-yaml-editor');nativeAttributes.readOnly=true;nativeAttributes.disableFullscreen=true;nativeAttributes.setValue(${JSON.stringify(attributes)});
    window.ownedAttributes=document.createElement('qap-attributes-viewer');ownedAttributes.label='Entity attributes';ownedAttributes.value=${JSON.stringify(yaml)};
    for(const control of [nativeAttributes,ownedAttributes]){const wrapper=document.createElement('div');wrapper.className='qap-state-dialog-editor';wrapper.append(control);attributesParity.append(wrapper);}
    document.body.append(attributesParity);await Promise.all([nativeAttributes.updateComplete,ownedAttributes.updateComplete]);
    await new Promise((resolve,reject)=>{let tries=0;const poll=()=>{if(nativeAttributes.codemirror)resolve();else if(tries++>200)reject(Error('HA reference CodeMirror did not load'));else setTimeout(poll,20);};poll();});
  })()`);
  try {
    for (const [name, theme] of [
      ["light", {}],
      ["dark", darkTheme],
      [
        "custom",
        {
          "code-editor-background-color": "#25354a",
          "code-editor-gutter-color": "#182839",
          "primary-text-color": "#f1f5fa",
          "secondary-text-color": "#a1b8d0",
          "codemirror-string": "#a8d59a",
          "codemirror-property": "#e8b0c0",
        },
      ],
    ]) {
      const comparison = await evaluate(`(async()=>{
        document.documentElement.style.cssText=${JSON.stringify(previousTheme)};for(const [key,value] of Object.entries(${JSON.stringify(theme)}))document.documentElement.style.setProperty('--'+key,value);
        const editor=nativeAttributes.shadowRoot.querySelector('ha-code-editor'),native=editor.shadowRoot;
        const sample=(surface,content,gutter,toolbar)=>{const s=getComputedStyle(surface),c=getComputedStyle(content),g=getComputedStyle(gutter);return {family:c.fontFamily,font:c.fontSize,line:c.lineHeight,paddingTop:c.paddingTop,paddingBottom:c.paddingBottom,color:s.color,background:s.backgroundColor,gutterBackground:g.backgroundColor,gutterColor:g.color,gutterBorder:g.borderRightColor,toolbarHeight:toolbar.getBoundingClientRect().height,whiteSpace:c.whiteSpace};};
        return {yaml:nativeAttributes.yaml,ownedYaml:ownedAttributes.shadowRoot.querySelector('.content').textContent,
          nativeGutterWidth:native.querySelector('.cm-gutters').getBoundingClientRect().width,
          ownedGutterWidth:ownedAttributes.shadowRoot.querySelector('.gutter').getBoundingClientRect().width,
          native:sample(native.querySelector('.cm-editor'),native.querySelector('.cm-content'),native.querySelector('.cm-gutters'),native.querySelector('.code-editor-toolbar')),
          owned:sample(ownedAttributes,ownedAttributes.shadowRoot.querySelector('.content'),ownedAttributes.shadowRoot.querySelector('.gutter'),ownedAttributes.shadowRoot.querySelector('.toolbar')),
          overflow:attributesParity.scrollWidth>attributesParity.clientWidth};
      })()`);
      assert.equal(comparison.ownedYaml, comparison.yaml, "serialized bytes match HA");
      assert.deepEqual(
        comparison.owned,
        comparison.native,
        `${name}: viewer typography, surface, gutter and toolbar match HA`,
      );
      assert.ok(
        Math.abs(comparison.nativeGutterWidth - comparison.ownedGutterWidth) < 1,
        JSON.stringify(comparison),
      );
      assert.equal(comparison.overflow, false);
    }
  } finally {
    await evaluate(
      `attributesParity.remove();document.documentElement.style.cssText=${JSON.stringify(previousTheme)}`,
    );
  }
}

module.exports = { verifyAttributesViewer, verifyAttributesViewerParity, verifyDialogAttributes };
