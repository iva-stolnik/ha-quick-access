const assert = require("node:assert/strict");

async function verifySelectSelector({ evaluate, key, send, width }) {
  const press = async (...args) => {
    await key(...args);
    await evaluate(
      `(async()=>{const child=selectControl.shadowRoot.querySelector('.add-control')||selectControl;await child.updateComplete;await Promise.allSettled((child.shadowRoot.querySelector('qap-dialog')?.shadowRoot.querySelector('dialog')?.getAnimations()||[]).map(a=>a.finished));})()`,
    );
  };
  await evaluate(`(async()=>{
    window.selectDialog=document.createElement('qap-dialog');selectDialog.setAttribute('aria-label','Select form');
    window.selectControl=document.createElement('qap-select-selector');selectControl.label='Versions';
    selectControl.selector={select:{mode:'dropdown',custom_value:true,options:[{value:'one',label:'First option'},{value:'blocked',label:'Disabled option',disabled:true},{value:'two',label:'Second option'}]}};
    selectDialog.append(selectControl);window.selectSave=document.createElement('button');selectSave.textContent='Save';selectDialog.append(selectSave);
    document.body.append(selectDialog);selectDialog.showModal();await selectDialog.updateComplete;await selectControl.updateComplete;
    window.selectEvents=[];for(const name of ['value-changed','input','change'])selectControl.addEventListener(name,event=>selectEvents.push({type:event.type,value:event.detail?.value,bubbles:event.bubbles,composed:event.composed}));selectControl.focus();
    selectControl.shadowRoot.querySelector('qap-dialog').addEventListener('opened',()=>{
      window.selectOpeningAnimations=selectControl.shadowRoot.querySelector('qap-dialog').shadowRoot.querySelector('dialog').getAnimations().filter(animation=>animation.animationName?.startsWith('select-')).map(animation=>({duration:animation.effect.getTiming().duration,frames:animation.effect.getKeyframes().map(frame=>({opacity:frame.opacity,scale:frame.scale,translate:frame.translate}))}));
    });
  })()`);
  await press("ArrowDown", "ArrowDown");
  assert.equal(
    await evaluate(
      `selectOpeningAnimations.some(animation=>animation.duration===${width > 870 ? 100 : 300}&&animation.frames[0].opacity==='0')`,
    ),
    true,
    "picker runs the native popup/sheet opening animation",
  );
  await press("ArrowDown", "ArrowDown");
  assert.equal(
    await evaluate(`selectControl.shadowRoot.querySelector('.option.active').textContent.trim()`),
    "Second option",
    "arrows skip disabled options",
  );
  await press("Enter", "Enter");
  assert.equal(await evaluate(`selectControl.value`), "two");
  assert.deepEqual(await evaluate(`selectEvents.map(event=>event.type)`), [
    "value-changed",
    "input",
    "change",
  ]);
  assert.equal(await evaluate(`selectEvents.every(event=>event.bubbles&&event.composed)`), true);
  assert.equal(await evaluate(`selectControl.shadowRoot.activeElement.className`), "trigger");
  await press("ArrowDown", "ArrowDown");
  await evaluate(
    `window.selectInput=selectControl.shadowRoot.querySelector('input');selectInput.value='ACME, Inc.';selectInput.dispatchEvent(new Event('input',{bubbles:true}));selectInput.setSelectionRange(2,5);selectControl.selector={select:{...selectControl.selector.select,options:[{value:'two',label:'Renamed option'}]}};selectControl.updateComplete`,
  );
  assert.deepEqual(
    await evaluate(
      `(()=>{const input=selectControl.shadowRoot.querySelector('input');return [input===selectInput,input.value,input.selectionStart,input.selectionEnd,selectControl.shadowRoot.activeElement===input];})()`,
    ),
    [true, "ACME, Inc.", 2, 5, true],
  );
  await evaluate(
    `selectInput.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));selectInput.value='日本';selectInput.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));`,
  );
  await press("Enter", "Enter");
  assert.equal(await evaluate(`selectControl.value`), "two");
  await evaluate(
    `selectInput.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));`,
  );
  await press("Enter", "Enter");
  assert.equal(await evaluate(`selectControl.value`), "日本");
  await press("ArrowDown", "ArrowDown");
  await press("Escape", "Escape");
  assert.equal(
    await evaluate(`selectDialog.open&&!selectControl.shadowRoot.querySelector('qap-dialog').open`),
    true,
    "Escape closes only the inner picker",
  );
  await evaluate(
    `selectControl.selector={select:{mode:'dropdown',multiple:true,custom_value:false,options:[{value:'one',label:'First option'},{value:'blocked',label:'Disabled option',disabled:true},{value:'two',label:'Second option'}]}};selectControl.value=['deleted'];selectControl.updateComplete`,
  );
  assert.equal(
    await evaluate(`selectControl.shadowRoot.querySelector('qap-chip').textContent`),
    "deleted",
  );
  await evaluate(`selectControl.focus()`);
  await press("ArrowDown", "ArrowDown");
  const bounds = await evaluate(
    `(()=>{const child=selectControl.shadowRoot.querySelector('.add-control'),rect=child.shadowRoot.querySelector('qap-dialog').shadowRoot.querySelector('dialog').getBoundingClientRect();return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};})()`,
  );
  assert.ok(
    bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= 844,
    JSON.stringify(bounds),
  );
  const tree = await send("Accessibility.getFullAXTree");
  assert.ok(
    tree.nodes.some((node) => node.role?.value === "combobox" && node.name?.value === "Search"),
  );
  assert.ok(
    tree.nodes.some(
      (node) => node.role?.value === "option" && node.name?.value.includes("First option"),
    ),
  );
  await press("Tab", "Tab");
  assert.equal(
    await evaluate(
      `selectControl.shadowRoot.querySelector('.add-control').shadowRoot.querySelector('qap-dialog').open`,
    ),
    true,
    "Tab stays in the nested picker",
  );
  await press("Escape", "Escape");
  await evaluate(`selectControl.focus()`);
  await press("ArrowDown", "ArrowDown");
  const point = await evaluate(
    `(()=>{const row=selectControl.shadowRoot.querySelector('.add-control').shadowRoot.querySelector('.option'),rect=row.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`,
  );
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await evaluate(
    `(async()=>{const child=selectControl.shadowRoot.querySelector('.add-control');await child.updateComplete;await Promise.allSettled((child.shadowRoot.querySelector('qap-dialog').shadowRoot.querySelector('dialog').getAnimations()||[]).map(a=>a.finished));})()`,
  );
  assert.deepEqual(await evaluate(`selectControl.value`), ["deleted", "one"]);
  assert.equal(
    await evaluate(`selectControl.shadowRoot.activeElement.className`),
    "add-control",
    "adding restores focus after the picker closes",
  );
  await evaluate(`selectControl.disabled=true;selectControl.updateComplete`);
  assert.equal(
    await evaluate(
      `selectControl.shadowRoot.querySelector('.remove').disabled&&selectControl.shadowRoot.querySelector('.add-control').disabled`,
    ),
    true,
  );
  await evaluate(`selectControl.shadowRoot.querySelector('.remove').click()`);
  assert.deepEqual(await evaluate(`selectControl.value`), ["deleted", "one"]);
  await evaluate(`selectControl.disabled=false;selectControl.updateComplete`);
  await evaluate(
    `selectControl.shadowRoot.querySelector('.remove').click();selectControl.updateComplete`,
  );
  assert.deepEqual(await evaluate(`selectControl.value`), ["one"]);
  await evaluate(
    `selectControl.selector={select:{mode:'dropdown',options:['one',{value:'blocked',label:'Disabled',disabled:true},'two']}};selectControl.value='one';selectControl.updateComplete`,
  );
  await evaluate(`selectControl.focus()`);
  await key("ArrowDown", "ArrowDown");
  assert.equal(
    await evaluate(`selectControl.value`),
    "two",
    "ordinary single selects reuse native keyboard selection",
  );
  await evaluate(
    `window.plainSelect=selectControl.shadowRoot.querySelector('qap-select');selectControl.selector={select:{mode:'dropdown',options:[{value:'two',label:'Renamed'},'three']}};selectControl.updateComplete`,
  );
  assert.equal(
    await evaluate(
      `selectControl.shadowRoot.querySelector('qap-select')===plainSelect&&plainSelect.shadowRoot.querySelector('select').value==='two'`,
    ),
    true,
    "option updates retain the single control and selection",
  );
  await evaluate(`selectControl.value='deleted';selectControl.updateComplete`);
  assert.equal(
    await evaluate(`plainSelect.shadowRoot.querySelector('select').value`),
    "deleted",
    "missing single selections stay visible",
  );
  await evaluate(`selectDialog.remove()`);
}

async function verifySelectSelectorParity(evaluate, darkTheme) {
  await evaluate(`(async()=>{
    const root=document.querySelector('hc-main'),loader=document.createElement('ha-form');loader.hidden=true;loader.hass=root.hass;loader.data={};loader.schema=[{name:'select',selector:{select:{options:['one'],mode:'dropdown'}}}];root.append(loader);
    try{await Promise.race([customElements.whenDefined('ha-selector-select'),new Promise((_,reject)=>setTimeout(()=>reject(Error('HA select reference did not register')),5000))]);}finally{loader.remove();}
    window.selectParity=document.createElement('section');selectParity.style.cssText='position:fixed;inset:0;overflow:auto;z-index:99999;background:var(--primary-background-color);padding:16px;display:grid;align-content:start;gap:16px';root.append(selectParity);
    window.nativeSelect=document.createElement('ha-selector-select');nativeSelect.hass=root.hass;nativeSelect.label='Version';nativeSelect.required=false;nativeSelect.selector={select:{mode:'dropdown',custom_value:true,options:[]}};
    window.ownedSelect=document.createElement('qap-select-selector');ownedSelect.label='Version';ownedSelect.required=false;
    selectParity.append(nativeSelect,ownedSelect);
  })()`);
  const previous = await evaluate(`document.documentElement.style.cssText`);
  for (const [mode, theme] of [
    ["light", {}],
    ["dark", darkTheme],
    [
      "custom",
      {
        ...darkTheme,
        "primary-color": "#b15acb",
        "input-fill-color": "#384454",
        "input-ink-color": "#e3d5ef",
        "input-label-ink-color": "#cbb8cf",
        "input-idle-line-color": "#89778e",
      },
    ],
  ]) {
    for (const value of ["", "one"]) {
      const metrics = await evaluate(`(async()=>{
        document.documentElement.style.cssText=${JSON.stringify(previous)};for(const [key,value] of Object.entries(${JSON.stringify(theme)}))document.documentElement.style.setProperty('--'+key,value);
        nativeSelect.selector=ownedSelect.selector={select:{mode:'dropdown',custom_value:true,options:[{value:'one',label:'First option'},{value:'two',label:'Second option'}]}};
        nativeSelect.value=ownedSelect.value=${JSON.stringify(value)};await Promise.all([nativeSelect.updateComplete,ownedSelect.updateComplete]);
        const picker=nativeSelect.shadowRoot.querySelector('ha-generic-picker');await picker.updateComplete;
        const field=picker.shadowRoot.querySelector('ha-picker-field');await field.updateComplete;const base=field.shadowRoot.querySelector('ha-combo-box-item');await base.updateComplete;
        const sample=(base,text)=>{const b=getComputedStyle(base),i=getComputedStyle(text),range=document.createRange();range.selectNodeContents(text);const bounds=base.getBoundingClientRect(),glyphs=range.getBoundingClientRect();return {height:bounds.height,background:b.backgroundColor,radius:b.borderRadius,font:i.fontSize,family:i.fontFamily,color:i.color,weight:i.fontWeight,textX:glyphs.left-bounds.left,textY:glyphs.top-bounds.top};};
        return {native:sample(base,field.shadowRoot.querySelector('[slot="headline"]')),owned:sample(ownedSelect.shadowRoot.querySelector('.trigger'),ownedSelect.shadowRoot.querySelector('.headline,.placeholder'))};
      })()`);
      assert.deepEqual(
        metrics.owned,
        metrics.native,
        `${mode} custom select ${value || "empty"} field parity`,
      );
    }
    await evaluate(
      `(async()=>{const picker=nativeSelect.shadowRoot.querySelector('ha-generic-picker');await picker.open();await new Promise(resolve=>setTimeout(resolve,400));})()`,
    );
    const nativeRow = await evaluate(
      `(()=>{const picker=nativeSelect.shadowRoot.querySelector('ha-generic-picker'),combo=picker.shadowRoot.querySelector('ha-picker-combo-box'),row=combo.shadowRoot.querySelector('ha-combo-box-item');return {height:row.getBoundingClientRect().height||row.parentElement.getBoundingClientRect().height,font:getComputedStyle(row).fontSize};})()`,
    );
    await evaluate(
      `(async()=>{const picker=nativeSelect.shadowRoot.querySelector('ha-generic-picker');picker._pickerWrapperOpen=false;await picker.updateComplete;await new Promise(resolve=>setTimeout(resolve,400));ownedSelect.shadowRoot.querySelector('.trigger').click();await ownedSelect.updateComplete;await new Promise(resolve=>setTimeout(resolve,400));})()`,
    );
    const ownedRow = await evaluate(
      `(()=>{const row=ownedSelect.shadowRoot.querySelector('.option');return {height:row.getBoundingClientRect().height,font:getComputedStyle(row.querySelector('.headline')).fontSize};})()`,
    );
    assert.deepEqual(ownedRow, nativeRow, `${mode} select dropdown row parity`);
    if (await evaluate(`innerWidth>870`)) {
      const popupSize = await evaluate(`(async()=>{
        ownedSelect.opened=false;await ownedSelect.updateComplete;
        nativeSelect.selector=ownedSelect.selector={select:{mode:'dropdown',custom_value:true,options:['alpha','bravo','charlie','delta']}};
        await Promise.all([nativeSelect.updateComplete,ownedSelect.updateComplete]);
        const picker=nativeSelect.shadowRoot.querySelector('ha-generic-picker');await picker.updateComplete;await picker.open();await new Promise(resolve=>setTimeout(resolve,400));
        const popover=picker.shadowRoot.querySelector('wa-popover'),surface=popover.shadowRoot.querySelector('[part="body"]');
        const sample=(e,duration)=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {width:r.width,height:r.height,radius:s.borderRadius,background:s.backgroundColor,shadow:s.boxShadow,border:s.border,duration:parseFloat(duration||s.animationDuration)};};
        const duration=getComputedStyle(popover).getPropertyValue('--show-duration');
        const native=sample(surface,duration);picker.setFieldValue('bravo');await new Promise(resolve=>setTimeout(resolve,400));const nativeFiltered=sample(surface,duration);
        picker._pickerWrapperOpen=false;await picker.updateComplete;await new Promise(resolve=>setTimeout(resolve,400));
        ownedSelect.shadowRoot.querySelector('.trigger').click();await ownedSelect.updateComplete;await new Promise(resolve=>setTimeout(resolve,400));
        const dialog=ownedSelect.shadowRoot.querySelector('qap-dialog').shadowRoot.querySelector('dialog');const owned=sample(dialog);
        const input=ownedSelect.shadowRoot.querySelector('input');input.value='bravo';input.dispatchEvent(new Event('input',{bubbles:true}));await ownedSelect.updateComplete;
        return {native,nativeFiltered,owned,ownedFiltered:sample(dialog)};
      })()`);
      assert.deepEqual(
        popupSize.owned,
        popupSize.native,
        `${mode} desktop dropdown surface parity: ${JSON.stringify(popupSize)}`,
      );
      assert.deepEqual(
        popupSize.ownedFiltered,
        popupSize.nativeFiltered,
        `${mode} filtering retains native dropdown dimensions`,
      );
    }
    await evaluate(
      `(async()=>{ownedSelect.opened=false;await ownedSelect.updateComplete;await new Promise(resolve=>setTimeout(resolve,400));nativeSelect.selector=ownedSelect.selector={select:{mode:'dropdown',multiple:true,options:[{value:'one',label:'First option'},{value:'two',label:'Second option'}]}};nativeSelect.value=ownedSelect.value=['one'];await Promise.all([nativeSelect.updateComplete,ownedSelect.updateComplete]);})()`,
    );
    const chipMetrics = await evaluate(
      `(async()=>{const chip=nativeSelect.shadowRoot.querySelector('ha-input-chip'),owned=ownedSelect.shadowRoot.querySelector('qap-chip');await Promise.all([chip.updateComplete,owned.updateComplete]);const sample=e=>{const text=e.shadowRoot.querySelector('[part="label"],.label'),style=getComputedStyle(text||e);return {height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width,radius:getComputedStyle(e).getPropertyValue('--ha-button-border-radius').trim(),font:style.fontSize,family:style.fontFamily,weight:style.fontWeight};};return {native:sample(chip),owned:sample(owned)};})()`,
    );
    assert.deepEqual(chipMetrics.owned, chipMetrics.native, `${mode} selected chip dimensions`);
  }
  await evaluate(
    `selectParity.remove();document.documentElement.style.cssText=${JSON.stringify(previous)}`,
  );
}

module.exports = { verifySelectSelector, verifySelectSelectorParity };
