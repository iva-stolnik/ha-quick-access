const assert = require("node:assert/strict");

async function verifyEntitySelector({ evaluate, key, send, width }) {
  const transitions = await evaluate(`(async()=>{
    const results=[];
    for(const empty of ['',null,undefined]) {
      const control=document.createElement('qap-entity-selector');control.value=empty;control.required=true;document.body.append(control);await control.updateComplete;
      let events=0;control.addEventListener('value-changed',()=>events++);
      control.selector={entity:{multiple:true}};await control.updateComplete;await control.updateComplete;
      results.push({value:control.value,valid:control.checkValidity(),rows:control.shadowRoot.querySelectorAll('qap-entity-selector').length,events});
      control.remove();
    }
    return results;
  })()`);
  assert.deepEqual(transitions, [
    { value: [], valid: false, rows: 1, events: 1 },
    { value: [], valid: false, rows: 1, events: 0 },
    { value: [], valid: false, rows: 1, events: 0 },
  ]);
  const sendKey = key;
  key = async (...args) => {
    await sendKey(...args);
    await evaluate(
      `(async()=>{const collect=root=>[...root.querySelectorAll('qap-dialog'),...[...root.querySelectorAll('*')].filter(node=>node.shadowRoot).flatMap(node=>collect(node.shadowRoot))];await Promise.allSettled(collect(entityDialog.shadowRoot).concat(collect(entityHost)).flatMap(host=>host.shadowRoot.querySelector('dialog')?.getAnimations()||[]).map(animation=>animation.finished));})()`,
    );
  };
  await evaluate(`(async()=>{
    window.entityDialog=document.createElement('qap-dialog');entityDialog.setAttribute('aria-label','Entity form');
    window.entityHost=document.createElement('div');entityHost.style.cssText='padding:16px;max-height:280px;overflow:auto';entityDialog.append(entityHost);
    window.entitySelect=document.createElement('qap-entity-selector');entitySelect.label='Entity';
    const {createEntitySelectorSource}=await import('/quick_access_source/entities/entity-selector.ts');
    window.selectorStates=Object.fromEntries(Array.from({length:2000},(_,index)=>['sensor.'+index,{entity_id:'sensor.'+index,state:'on',attributes:{friendly_name:'Sensor '+index}}]));
    entitySelect.source=createEntitySelectorSource(()=>({states:selectorStates}));entitySelect.source.refresh();
    entityHost.append(entitySelect);window.entityLast=document.createElement('button');entityLast.textContent='Save';entityHost.append(entityLast);
    document.body.append(entityDialog);entityDialog.showModal();await entityDialog.updateComplete;await entitySelect.updateComplete;
    window.entityEvents=[];entitySelect.addEventListener('value-changed',event=>entityEvents.push({value:event.detail.value,bubbles:event.bubbles,composed:event.composed}));
    entitySelect.focus();
  })()`);
  await key("ArrowDown", "ArrowDown");
  assert.equal(await evaluate(`entitySelect.shadowRoot.querySelector('qap-dialog').open`), true);
  assert.ok(
    await evaluate(`entitySelect.shadowRoot.querySelectorAll('[role=option]').length<=24`),
    "large catalogs render a bounded window",
  );
  assert.equal(
    await evaluate(
      `(()=>{const i=entitySelect.shadowRoot.querySelector('input');return i.getAttribute('aria-expanded')==='true'&&!!entitySelect.shadowRoot.getElementById(i.getAttribute('aria-activedescendant'));})()`,
    ),
    true,
  );
  await evaluate(
    `(()=>{const active=entitySelect.shadowRoot.querySelector('.option.active').getAttribute('aria-label').split(',')[1].trim();selectorStates={...selectorStates,[active]:{...selectorStates[active],attributes:{friendly_name:'ZZ renamed sensor'}}};entitySelect.source.refresh();entitySelect.revision++;})()`,
  );
  assert.equal(
    await evaluate(
      `(()=>{const row=entitySelect.shadowRoot.querySelector('.option.active'),list=entitySelect.shadowRoot.querySelector('.options'),r=row.getBoundingClientRect(),b=list.getBoundingClientRect();return row.textContent.includes('ZZ renamed sensor')&&r.top>=b.top-1&&r.bottom<=b.bottom+1;})()`,
    ),
    true,
    "registry renames retain and reveal the active option after sorting",
  );
  await evaluate(
    `(()=>{const list=entitySelect.shadowRoot.querySelector('.options');list.scrollTop=12000;list.dispatchEvent(new Event('scroll'));})()`,
  );
  assert.equal(
    await evaluate(
      `(()=>{const i=entitySelect.shadowRoot.querySelector('input'),active=i.getAttribute('aria-activedescendant');return !active||!!entitySelect.shadowRoot.getElementById(active);})()`,
    ),
    true,
    "scrolling never leaves a dangling active-option reference",
  );
  await evaluate(
    `(()=>{const input=entitySelect.shadowRoot.querySelector('input');input.value='Sensor 19';input.dispatchEvent(new Event('input',{bubbles:true}));input.setSelectionRange(3,6);})()`,
  );
  assert.equal(
    await evaluate(
      `(()=>{const list=entitySelect.shadowRoot.querySelector('.options'),row=list.querySelector('.option'),r=row.getBoundingClientRect(),b=list.getBoundingClientRect();return list.scrollTop===0&&r.top>=b.top-1&&r.bottom<=b.bottom+1&&row.getAttribute('aria-posinset')==='1';})()`,
    ),
    true,
    "filtering resets the actual scroll container and virtual window",
  );
  await evaluate(
    `(()=>{const list=entitySelect.shadowRoot.querySelector('.options');list.scrollTop=560;list.dispatchEvent(new Event('scroll'));window.retainedScroll=list.scrollTop;entitySelect.revision++;})()`,
  );
  assert.equal(
    await evaluate(`entitySelect.shadowRoot.querySelector('.options').scrollTop`),
    await evaluate(`retainedScroll`),
    "data refresh without a query change retains scroll",
  );
  assert.deepEqual(
    await evaluate(
      `(()=>{const input=entitySelect.shadowRoot.querySelector('input');return [input.value,input.selectionStart,input.selectionEnd,entitySelect.shadowRoot.activeElement===input];})()`,
    ),
    ["Sensor 19", 3, 6, true],
  );
  for (let index = 0; index < 15; index++) await key("ArrowDown", "ArrowDown");
  await key("Enter", "Enter");
  const selectedValue = await evaluate(`entitySelect.value`);
  assert.equal((await evaluate(`entityEvents`)).length, 1);
  assert.deepEqual(await evaluate(`entityEvents`), [
    { value: selectedValue, bubbles: true, composed: true },
  ]);
  assert.equal(await evaluate(`entitySelect.shadowRoot.activeElement?.className`), "trigger");
  await evaluate(
    `entitySelect.focus();entityLast.focus();new Promise(resolve=>setTimeout(resolve,0))`,
  );
  assert.equal(
    await evaluate(`entitySelect.value`),
    selectedValue,
    "blur does not commit the friendly label",
  );
  await evaluate(`entitySelect.focus()`);
  await key("ArrowDown", "ArrowDown");
  await key("Escape", "Escape");
  assert.equal(
    await evaluate(`entityDialog.open&&!entitySelect.shadowRoot.querySelector('qap-dialog').open`),
    true,
    "Escape only closes suggestions",
  );
  await key("ArrowDown", "ArrowDown");
  await evaluate(
    `(()=>{const input=entitySelect.shadowRoot.querySelector('input');input.value='sensor.12';input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));input.setSelectionRange(3,5);window.originalEntityInput=input;})()`,
  );
  await evaluate(
    `selectorStates={...selectorStates,'sensor.new':{entity_id:'sensor.new',state:'unavailable',attributes:{friendly_name:'New entity'}}};entitySelect.source.refresh();entitySelect.revision++;entitySelect.label='Localized entity';entitySelect.updateComplete`,
  );
  assert.deepEqual(
    await evaluate(
      `(()=>{const input=entitySelect.shadowRoot.querySelector('input');return {same:input===originalEntityInput,value:input.value,start:input.selectionStart,end:input.selectionEnd,focused:entitySelect.shadowRoot.activeElement===input};})()`,
    ),
    { same: true, value: "sensor.12", start: 3, end: 5, focused: true },
  );
  await evaluate(
    `originalEntityInput.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));originalEntityInput.value='温度';originalEntityInput.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));entitySelect.revision++;entitySelect.updateComplete`,
  );
  await key("Enter", "Enter");
  assert.equal(await evaluate(`entitySelect.value`), selectedValue);
  assert.equal(await evaluate(`originalEntityInput.value`), "温度");
  await evaluate(
    `originalEntityInput.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));`,
  );
  await key("Escape", "Escape");
  await key("ArrowDown", "ArrowDown");
  const bounds = await evaluate(
    `(()=>{const rect=entitySelect.shadowRoot.querySelector('qap-dialog').shadowRoot.querySelector('dialog').getBoundingClientRect();return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};})()`,
  );
  assert.ok(
    bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= 844,
    JSON.stringify(bounds),
  );
  const ax = await send("Accessibility.getFullAXTree");
  assert.ok(
    ax.nodes.some(
      (node) => node.role?.value === "combobox" && node.name?.value === "Search entities",
    ),
    "combobox has a screen reader label",
  );
  await key("Tab", "Tab");
  assert.equal(
    await evaluate(`entitySelect.shadowRoot.querySelector('qap-dialog').open`),
    true,
    "Tab stays within the picker focus trap",
  );
  await key("Escape", "Escape");
  await evaluate(
    `entitySelect.selector={entity:{multiple:true}};entitySelect.value=['sensor.15','sensor.deleted'];entitySelect.updateComplete`,
  );
  assert.equal(
    await evaluate(`entitySelect.shadowRoot.querySelectorAll('qap-entity-selector').length`),
    3,
  );
  const multipleAx = await send("Accessibility.getFullAXTree");
  assert.ok(
    multipleAx.nodes.some(
      (node) => node.role?.value === "button" && node.name?.value === "Add entity",
    ),
    "add action has its action name",
  );
  assert.ok(
    multipleAx.nodes.some(
      (node) => node.role?.value === "button" && node.name?.value.includes("Clear: sensor.deleted"),
    ),
    "remove action identifies its selected entity",
  );
  await evaluate(
    `entitySelect.selector={entity:{multiple:true,filter:{domain:'sensor'},exclude_entities:['sensor.denied']}};entitySelect.updateComplete`,
  );
  for (const rejected of ["light.bypass", "sensor.denied"]) {
    await evaluate(`entitySelect.focus()`);
    await key("ArrowDown", "ArrowDown");
    await send("Input.insertText", { text: rejected });
    assert.equal(
      await evaluate(
        `entitySelect.shadowRoot.querySelector('qap-entity-selector:last-of-type').shadowRoot.querySelector('.custom')===null`,
      ),
      true,
    );
    await key("Enter", "Enter");
    assert.deepEqual(await evaluate(`entitySelect.value`), ["sensor.15", "sensor.deleted"]);
  }
  await evaluate(`entitySelect.focus()`);
  await key("ArrowDown", "ArrowDown");
  await send("Input.insertText", { text: "sensor.missing" });
  await key("Enter", "Enter");
  assert.deepEqual(await evaluate(`entitySelect.value`), [
    "sensor.15",
    "sensor.deleted",
    "sensor.missing",
  ]);
  assert.equal(
    await evaluate(
      `entitySelect.shadowRoot.activeElement===[...entitySelect.shadowRoot.querySelectorAll('qap-entity-selector')].at(-1)`,
    ),
    true,
    "adding restores focus to the add field after the picker closes",
  );
  await evaluate(
    `entitySelect.shadowRoot.querySelector('qap-entity-selector').shadowRoot.querySelector('.clear').click()`,
  );
  assert.deepEqual(await evaluate(`entitySelect.value`), ["sensor.deleted", "sensor.missing"]);
  await evaluate(`entitySelect.focus()`);
  await key("ArrowDown", "ArrowDown");
  const point = await evaluate(
    `(()=>{const child=[...entitySelect.shadowRoot.querySelectorAll('qap-entity-selector')].at(-1),option=child.shadowRoot.querySelector('[role=option]'),rect=option.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`,
  );
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  assert.deepEqual(await evaluate(`entitySelect.value`), [
    "sensor.deleted",
    "sensor.missing",
    "sensor.new",
  ]);
  await evaluate(
    `window.acceptedEntities=entitySelect.value;entitySelect.addEventListener('value-changed',event=>{if(event.detail.value.length>3)entitySelect.value=acceptedEntities;});entitySelect.focus()`,
  );
  await key("ArrowDown", "ArrowDown");
  await send("Input.insertText", { text: "sensor.rejected" });
  await key("Enter", "Enter");
  assert.deepEqual(await evaluate(`entitySelect.value`), [
    "sensor.deleted",
    "sensor.missing",
    "sensor.new",
  ]);
  assert.equal(
    await evaluate(
      `[...entitySelect.shadowRoot.querySelectorAll('qap-entity-selector')].at(-1).value`,
    ),
    "",
    "form rejection resets the add field as well as the selected array",
  );
  await evaluate(`entityDialog.remove()`);
}

async function verifyEntitySelectorParity(evaluate, darkTheme) {
  await evaluate(`(async()=>{
    const root=document.querySelector('hc-main');root.hass={...root.hass,entities:{},devices:{},areas:{},floors:{},labels:{}};
    const loader=document.createElement('ha-form');loader.hidden=true;loader.hass=document.querySelector('hc-main').hass;loader.data={};loader.schema=[{name:'entity',selector:{entity:{}}}];document.querySelector('hc-main').append(loader);
    try{await Promise.race([customElements.whenDefined('ha-selector-entity'),new Promise((_,reject)=>setTimeout(()=>reject(Error('HA reference selector did not register')),5000))]);}finally{loader.remove();}
    window.entityParity=document.createElement('section');entityParity.style.cssText='position:fixed;inset:0;overflow:auto;z-index:99999;background:var(--primary-background-color);padding:16px;display:grid;grid-template-columns:minmax(0,1fr);align-content:start;gap:16px';document.querySelector('hc-main').append(entityParity);
    window.nativeEntity=document.createElement('ha-selector-entity');nativeEntity.hass=document.querySelector('hc-main').hass;nativeEntity.selector={entity:{}};nativeEntity.label='Entity';nativeEntity.placeholder='Entity';nativeEntity.required=false;
    window.ownedEntity=document.createElement('qap-entity-selector');ownedEntity.label='Entity';ownedEntity.source={get:value=>value?{value,label:document.querySelector('hc-main').hass.states[value]?.attributes.friendly_name||value,secondary:'',icon:'mdi:thermometer'}:undefined,search:()=>[]};
    entityParity.append(nativeEntity,ownedEntity);await nativeEntity.updateComplete;await ownedEntity.updateComplete;
    const picker=nativeEntity.shadowRoot.querySelector('ha-entity-picker');await picker.updateComplete;await picker.shadowRoot.querySelector('ha-generic-picker').updateComplete;
    const {createEntitySelectorSource}=await import('/quick_access_source/entities/entity-selector.ts');
    window.paritySource=createEntitySelectorSource(()=>({...root.hass,hass:root.hass}));paritySource.refresh();
  })()`);
  const previousTheme = await evaluate(`document.documentElement.style.cssText`);
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
    for (const value of ["", "sensor.kitchen"]) {
      const metrics = await evaluate(`(async()=>{
        document.documentElement.style.cssText=${JSON.stringify(previousTheme)};for(const [key,value] of Object.entries(${JSON.stringify(theme)}))document.documentElement.style.setProperty('--'+key,value);
        nativeEntity.value=ownedEntity.value=${JSON.stringify(value)};await Promise.all([nativeEntity.updateComplete,ownedEntity.updateComplete]);
        const picker=nativeEntity.shadowRoot.querySelector('ha-entity-picker');await picker.updateComplete;const combo=picker.shadowRoot.querySelector('ha-generic-picker');await combo.updateComplete;
        const field=combo.shadowRoot.querySelector('ha-picker-field');await field.updateComplete;const base=field.shadowRoot.querySelector('ha-combo-box-item');await base.updateComplete;
        const sample=(base,text)=>{const b=getComputedStyle(base),i=getComputedStyle(text);return {height:base.getBoundingClientRect().height,background:b.backgroundColor,radius:b.borderRadius,font:i.fontSize,family:i.fontFamily,color:i.color};};
        return {native:sample(base,field.shadowRoot.querySelector('[slot="headline"]')),owned:sample(ownedEntity.shadowRoot.querySelector('.trigger'),ownedEntity.shadowRoot.querySelector('.headline,.placeholder'))};
      })()`);
      assert.deepEqual(
        metrics.owned,
        metrics.native,
        `${mode} ${value || "empty"} entity field parity`,
      );
    }
    await evaluate(
      `(async()=>{const picker=nativeEntity.shadowRoot.querySelector('ha-entity-picker');await picker.open();await new Promise(resolve=>setTimeout(resolve,400));})()`,
    );
    const nativeSurface = await evaluate(
      `(()=>{const picker=nativeEntity.shadowRoot.querySelector('ha-entity-picker').shadowRoot.querySelector('ha-generic-picker'),combo=picker.shadowRoot.querySelector('ha-picker-combo-box'),row=combo.shadowRoot.querySelector('ha-combo-box-item');return {rowHeight:row.getBoundingClientRect().height||row.parentElement.getBoundingClientRect().height,rowFont:getComputedStyle(row.querySelector('[slot="headline"]')).fontSize};})()`,
    );
    await evaluate(
      `(async()=>{const picker=nativeEntity.shadowRoot.querySelector('ha-entity-picker').shadowRoot.querySelector('ha-generic-picker');picker._pickerWrapperOpen=false;await picker.updateComplete;await new Promise(resolve=>setTimeout(resolve,400));ownedEntity.source=paritySource;ownedEntity.shadowRoot.querySelector('.trigger').click();await ownedEntity.updateComplete;await new Promise(resolve=>setTimeout(resolve,400));})()`,
    );
    const ownedSurface = await evaluate(
      `(()=>{const row=ownedEntity.shadowRoot.querySelector('.option');return {rowHeight:row.getBoundingClientRect().height,rowFont:getComputedStyle(row.querySelector('.headline')).fontSize};})()`,
    );
    assert.equal(ownedSurface.rowHeight, nativeSurface.rowHeight, "native dropdown row height");
    assert.equal(ownedSurface.rowFont, nativeSurface.rowFont, "native dropdown row typography");
    await evaluate(
      `(async()=>{ownedEntity.opened=false;await ownedEntity.updateComplete;await new Promise(resolve=>setTimeout(resolve,400));})()`,
    );
  }
  for (const config of [
    {},
    { include_entities: ["sensor.kitchen"] },
    { exclude_entities: ["sensor.kitchen"] },
    { filter: { domain: "sensor" } },
    { filter: [{ domain: "light" }, { domain: "sensor" }] },
  ]) {
    const result = await evaluate(
      `(async()=>{nativeEntity.selector={entity:${JSON.stringify(config)}};await nativeEntity.updateComplete;const picker=nativeEntity.shadowRoot.querySelector('ha-entity-picker');await picker.updateComplete;return {native:picker._getItems().filter(item=>item.stateObj).map(item=>item.id).sort(),owned:paritySource.search('',${JSON.stringify(config)},nativeEntity.value).map(item=>item.value).sort()};})()`,
    );
    assert.deepEqual(
      result.owned,
      result.native,
      "native entity filter compatibility: " + JSON.stringify(config),
    );
  }
  await evaluate(
    `entityParity.remove();document.documentElement.style.cssText=${JSON.stringify(previousTheme)}`,
  );
}

module.exports = { verifyEntitySelector, verifyEntitySelectorParity };
