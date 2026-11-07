const assert = require("node:assert/strict");
const { inflateSync } = require("node:zlib");

// Chromium's one-pixel PNG sample: the first pixel has no filter neighbors.
function pixelRgb(data) {
  const png = Buffer.from(data, "base64"),
    chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset),
      type = png.toString("ascii", offset + 4, offset + 8);
    const chunk = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      assert.equal(chunk.readUInt32BE(0), 1);
      assert.equal(chunk.readUInt32BE(4), 1);
      assert.equal(chunk[8], 8);
      assert.ok([2, 6].includes(chunk[9]));
    }
    if (type === "IDAT") chunks.push(chunk);
    offset += length + 12;
  }
  return [...inflateSync(Buffer.concat(chunks)).subarray(1, 4)];
}

async function verifyRowPointerParity(evaluate, send) {
  const points = await evaluate(`(async()=>{
    window.pointerFixture=document.createElement('div');pointerFixture.className='qap-shell';pointerFixture.style.cssText='position:fixed;inset:0;display:block;z-index:99999;--ha-animation-duration-fast:0ms';document.body.append(pointerFixture);
    window.pointerRows=['ha-list-item-button','qap-list-item'].map(tag=>{const row=document.createElement(tag);row.className='qap-settings-row';row.textContent='Example';row.style.cssText='display:block;width:280px;--ha-row-item-min-height:72px';pointerFixture.append(row);return row;});
    await Promise.all(pointerRows.map(row=>row.updateComplete));return pointerRows.map(row=>{const r=row.getBoundingClientRect();return {x:Math.floor(r.right-12),y:Math.floor(r.y+r.height/2)};});
  })()`);
  const samples = [];
  for (const point of points) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await evaluate(`new Promise(resolve=>setTimeout(resolve,200))`);
    const hover = await send("Page.captureScreenshot", {
      format: "png",
      clip: { ...point, width: 1, height: 1, scale: 1 },
    });
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await evaluate(`new Promise(resolve=>setTimeout(resolve,400))`);
    const pressed = await send("Page.captureScreenshot", {
      format: "png",
      clip: { ...point, width: 1, height: 1, scale: 1 },
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...point,
    });
    samples.push({ hover: pixelRgb(hover.data), pressed: pixelRgb(pressed.data) });
  }
  await evaluate(`pointerFixture.remove()`);
  assert.deepEqual(
    samples[1],
    samples[0],
    "settings row pointer-state colors match the HA ripple surface",
  );
}

async function verifySimpleControls({ evaluate, key, send, width }) {
  await evaluate(`(async()=>{
    window.simple=document.createElement('div');simple.style.cssText='position:fixed;inset:8px;background:var(--card-background-color,white);z-index:9999';document.body.append(simple);
    window.search=document.createElement('qap-search');search.placeholder='Search test';search.maxLength=200;
    window.filterChip=document.createElement('qap-chip');filterChip.textContent='Filter';filterChip.selectable=true;
    window.assistChip=document.createElement('qap-chip');assistChip.textContent='Recent';
    window.helpTrigger=document.createElement('qap-button');helpTrigger.textContent='Help';helpTrigger.id='simple-help';
    window.helpTooltip=document.createElement('qap-tooltip');helpTooltip.id='simple-tip';helpTooltip.setAttribute('role','tooltip');helpTooltip.textContent='Keyboard and pointer help';helpTooltip.anchorElement=helpTrigger;
    helpTrigger.setAttribute('aria-describedby',helpTooltip.id);helpTrigger.addEventListener('focusin',()=>helpTooltip.open=true);
    helpTrigger.addEventListener('focusout',()=>helpTooltip.open=false);
    window.helpArea=document.createElement('span');helpArea.append(helpTrigger,helpTooltip);
    helpArea.addEventListener('pointerenter',()=>helpTooltip.open=true);helpArea.addEventListener('pointerleave',()=>helpTooltip.open=false);
    simple.append(search,filterChip,assistChip,helpArea);
    await Promise.all([search,filterChip,assistChip,helpTrigger,helpTooltip].map(el=>el.updateComplete));
    window.searchEvents=[];search.addEventListener('input',e=>searchEvents.push({value:e.target.value,composing:e.isComposing,composed:e.composed}));
    window.nativeSearchInput=search.shadowRoot.querySelector('input');search.focus();nativeSearchInput.value='Retained search';nativeSearchInput.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertText'}));
    nativeSearchInput.setSelectionRange(2,8,'backward');search.placeholder='Localized search';await search.updateComplete;
  })()`);
  assert.deepEqual(
    await evaluate(
      `({same:search.shadowRoot.querySelector('input')===nativeSearchInput,value:search.value,events:searchEvents.length,focused:search.shadowRoot.activeElement===nativeSearchInput,max:nativeSearchInput.maxLength})`,
    ),
    { same: true, value: "Retained search", events: 1, focused: true, max: 200 },
  );
  assert.deepEqual(
    await evaluate(
      `[nativeSearchInput.selectionStart,nativeSearchInput.selectionEnd,nativeSearchInput.selectionDirection]`,
    ),
    [2, 8, "backward"],
  );
  await evaluate(
    `nativeSearchInput.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,composed:true}));nativeSearchInput.value='日本';nativeSearchInput.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,isComposing:true}));search.updateComplete`,
  );
  assert.equal(await evaluate(`searchEvents.at(-1).composing`), true);
  await evaluate(`search.shadowRoot.querySelector('qap-icon-button').click()`);
  assert.equal(await evaluate(`search.value`), "日本", "clear does not interrupt composition");
  await evaluate(
    `nativeSearchInput.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,composed:true}));search.shadowRoot.querySelector('qap-icon-button').click();search.updateComplete`,
  );
  assert.equal(
    await evaluate(
      `search.value===''&&searchEvents.at(-1).value===''&&search.shadowRoot.activeElement===nativeSearchInput`,
    ),
    true,
  );
  await evaluate(
    `(async()=>{search.value='Keyboard clear';window.enterSearch=event=>{if(event.key==='Enter')event.preventDefault();};search.addEventListener('keydown',enterSearch);await search.updateComplete;search.shadowRoot.querySelector('qap-icon-button').focus();})()`,
  );
  await key("Enter", "Enter");
  assert.equal(
    await evaluate(`search.value===''&&search.shadowRoot.activeElement===nativeSearchInput`),
    true,
    "clear activation does not invoke the containing search's Enter shortcut",
  );
  await evaluate(`search.removeEventListener('keydown',enterSearch)`);
  await evaluate(`filterChip.focus()`);
  await key("Enter", "Enter");
  assert.equal(
    await evaluate(
      `filterChip.selected&&filterChip.shadowRoot.querySelector('button').getAttribute('aria-pressed')==='true'`,
    ),
    true,
  );
  await key(" ", "Space");
  assert.equal(await evaluate(`filterChip.selected`), false);
  if (width === 320) {
    await send("Emulation.setTouchEmulationEnabled", { enabled: true });
    const point = await evaluate(
      `(()=>{const r=filterChip.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    );
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await evaluate(`new Promise(resolve=>setTimeout(resolve,50))`);
    assert.equal(await evaluate(`filterChip.selected`), true);
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await evaluate(`filterChip.selected=false;filterChip.updateComplete`);
  }
  await evaluate(`filterChip.disabled=true;filterChip.updateComplete`);
  await evaluate(`filterChip.click()`);
  assert.equal(await evaluate(`filterChip.selected`), false);
  assert.equal(
    await evaluate(`assistChip.shadowRoot.querySelector('button').hasAttribute('aria-pressed')`),
    false,
  );
  await evaluate(`helpTrigger.focus();helpTooltip.updateComplete`);
  assert.equal(
    await evaluate(`helpTooltip.shadowRoot.querySelector('[popover]').matches(':popover-open')`),
    true,
  );
  await send("Accessibility.enable");
  const tree = await send("Accessibility.getFullAXTree");
  assert.equal(
    tree.nodes.find(
      (node) => !node.ignored && node.role?.value === "button" && node.name?.value === "Help",
    )?.description?.value,
    "Keyboard and pointer help",
  );
  await key("Escape", "Escape");
  assert.equal(await evaluate(`helpTooltip.open`), false);
  await evaluate(`search.focus()`);
  let point = await evaluate(
    `(()=>{const r=helpTrigger.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await evaluate(`helpTooltip.updateComplete`);
  point = await evaluate(
    `(()=>{const r=helpTooltip.shadowRoot.querySelector('[popover]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  assert.equal(
    await evaluate(`helpTooltip.open`),
    true,
    "pointer users can enter the tooltip content",
  );
  await key("Escape", "Escape");
  assert.equal(
    await evaluate(`!helpTooltip.open&&document.activeElement===search`),
    true,
    "hover help dismisses without moving focus",
  );
  assert.equal(
    await evaluate(
      `simple.querySelector('ha-input-search,ha-filter-chip,ha-assist-chip,ha-tooltip')`,
    ),
    null,
  );
  await evaluate(`(async()=>{
    window.list=document.createElement('qap-list');
    for(const name of ['First','Disabled','Last']){const item=document.createElement('qap-list-item');item.textContent=name;item.disabled=name==='Disabled';list.append(item);}
    window.menu=document.createElement('qap-menu');menu.anchorElement=helpTrigger;menu.setAttribute('aria-label','Test actions');
    for(const name of ['Edit','Disabled','Duplicate','Delete']){const item=document.createElement('qap-menu-item');item.value=name.toLowerCase();item.textContent=name;item.disabled=name==='Disabled';menu.append(item);}
    window.selections=[];menu.addEventListener('wa-select',event=>selections.push(event.detail.item.value));
    window.menuLifecycle=[];for(const type of ['wa-after-show','wa-after-hide'])simple.addEventListener(type,event=>menuLifecycle.push({type,bubbles:event.bubbles,composed:event.composed}));
    simple.append(list,menu);await Promise.all([...list.children,...menu.children,list,menu].map(el=>el.updateComplete));
    await new Promise(resolve=>requestAnimationFrame(resolve));list.firstElementChild.focus();
  })()`);
  await key("ArrowDown", "ArrowDown");
  assert.equal(
    await evaluate(`document.activeElement===list.lastElementChild`),
    true,
    "list skips disabled rows",
  );
  await key("Home", "Home");
  assert.equal(await evaluate(`document.activeElement===list.firstElementChild`), true);
  await evaluate(
    `new Promise(resolve=>{menu.addEventListener('wa-after-show',resolve,{once:true});menu.open=true;})`,
  );
  assert.equal(await evaluate(`document.activeElement===menu.firstElementChild`), true);
  assert.deepEqual(await evaluate(`menuLifecycle.at(-1)`), {
    type: "wa-after-show",
    bubbles: true,
    composed: true,
  });
  assert.equal(
    await evaluate(
      `(()=>{const r=menu.shadowRoot.querySelector('[popover]').getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()`,
    ),
    true,
    "rendered menu items remain inside the viewport",
  );
  for (const [name, expected] of [
    ["ArrowDown", "duplicate"],
    ["End", "delete"],
    ["ArrowDown", "edit"],
    ["ArrowUp", "delete"],
    ["Home", "edit"],
  ]) {
    await key(name, name);
    assert.equal(await evaluate(`document.activeElement.value`), expected);
  }
  await key("d", "KeyD");
  assert.equal(
    await evaluate(`document.activeElement.value`),
    "duplicate",
    "typeahead includes slotted labels",
  );
  await key("Escape", "Escape");
  assert.equal(await evaluate(`!menu.open&&document.activeElement===helpTrigger`), true);
  await evaluate(
    `new Promise(resolve=>{menu.addEventListener('wa-after-show',resolve,{once:true});menu.open=true;})`,
  );
  await key("Enter", "Enter");
  assert.deepEqual(
    await evaluate(`selections`),
    ["edit"],
    "keyboard selection emits the existing item contract once",
  );
  await evaluate(
    `new Promise(resolve=>{menu.addEventListener('wa-after-show',resolve,{once:true});menu.open=true;})`,
  );
  await evaluate(`menu.querySelector('[disabled]').click()`);
  assert.equal(await evaluate(`menu.open&&selections.length===1`), true);
  await evaluate(`search.focus()`);
  assert.equal(await evaluate(`menu.open`), false, "known outside focus dismisses");
  await evaluate(
    `new Promise(resolve=>{menu.addEventListener('wa-after-show',resolve,{once:true});menu.open=true;})`,
  );
  point = await evaluate(
    `(()=>{const r=search.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    clickCount: 1,
    ...point,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    clickCount: 1,
    ...point,
  });
  assert.equal(await evaluate(`menu.open`), false, "outside pointer dismisses");
  await evaluate(
    `new Promise(resolve=>{menu.addEventListener('wa-after-show',resolve,{once:true});menu.open=true;})`,
  );
  await key("Tab", "Tab");
  assert.equal(await evaluate(`menu.open`), false, "Tab exits the menu without selecting");
  await evaluate(
    `(async()=>{window.earlyHides=0;menu.addEventListener('wa-after-hide',()=>earlyHides++);menu.open=true;menu.firstElementChild.click();await menu.updateComplete;})()`,
  );
  assert.equal(
    await evaluate(`earlyHides===1&&selections.length===2&&!menu.open`),
    true,
    "selection before the opening render still completes once",
  );
  assert.equal(
    await evaluate(
      `simple.querySelector('ha-list-base,ha-list-item-button,ha-dropdown,ha-dropdown-item')`,
    ),
    null,
  );
  await verifyToastAndRadio({ evaluate, key, send });
  await evaluate(`simple.remove()`);
}

async function verifyToastAndRadio({ evaluate, key, send }) {
  await evaluate(`(async()=>{
    window.radioGroup=document.createElement('qap-radio-group');radioGroup.label='Start with';radioGroup.value='first';
    for(const value of ['first','disabled','last']){const option=document.createElement('qap-radio-option');option.value=value;option.textContent=value;option.disabled=value==='disabled';radioGroup.append(option);}
    window.afterRadios=document.createElement('qap-button');afterRadios.textContent='After radios';
    window.radioEvents=[];for(const type of ['input','change'])radioGroup.addEventListener(type,event=>radioEvents.push({type,value:radioGroup.value,target:event.target===radioGroup,bubbles:event.bubbles,composed:event.composed}));
    simple.append(radioGroup,afterRadios);await radioGroup.updateComplete;await Promise.all([...radioGroup.children,afterRadios].map(el=>el.updateComplete));radioGroup.focus();
  })()`);
  assert.equal(await evaluate(`document.activeElement===radioGroup.firstElementChild`), true);
  await key("ArrowDown", "ArrowDown");
  assert.equal(
    await evaluate(
      `radioGroup.value==='last'&&document.activeElement===radioGroup.lastElementChild`,
    ),
    true,
  );
  assert.deepEqual(await evaluate(`radioEvents`), [
    { type: "input", value: "last", target: true, bubbles: true, composed: true },
    { type: "change", value: "last", target: true, bubbles: true, composed: true },
  ]);
  await key("ArrowRight", "ArrowRight");
  assert.equal(await evaluate(`radioGroup.value`), "first");
  await key("ArrowUp", "ArrowUp");
  assert.equal(await evaluate(`radioGroup.value`), "last");
  await key(" ", "Space");
  assert.equal(
    await evaluate(`radioEvents.length`),
    6,
    "Space on a checked radio does not repeat change",
  );
  await key("Tab", "Tab");
  assert.equal(
    await evaluate(`document.activeElement===afterRadios`),
    true,
    "the group has a single Tab stop",
  );
  await key("Tab", "Tab", 8);
  assert.equal(
    await evaluate(`document.activeElement===radioGroup.lastElementChild`),
    true,
    "Shift+Tab returns to selection",
  );
  await evaluate(`radioGroup.firstElementChild.focus()`);
  await key(" ", "Space");
  assert.equal(await evaluate(`radioGroup.value`), "first");
  await evaluate(`radioGroup.disabled=true;radioGroup.updateComplete`);
  await evaluate(`radioGroup.lastElementChild.click()`);
  assert.equal(
    await evaluate(
      `radioGroup.value==='first'&&[...radioGroup.children].every(el=>el.tabIndex===-1&&el.getAttribute('aria-disabled')==='true')`,
    ),
    true,
  );
  await evaluate(`radioGroup.disabled=false;radioGroup.updateComplete`);
  const tree = await send("Accessibility.getFullAXTree");
  assert.ok(
    tree.nodes.some(
      (node) =>
        !node.ignored && node.role?.value === "radiogroup" && node.name?.value === "Start with",
    ),
  );
  assert.ok(
    tree.nodes.some(
      (node) =>
        !node.ignored &&
        node.role?.value === "radio" &&
        node.name?.value === "first" &&
        node.properties?.some((p) => p.name === "checked" && p.value.value === "true"),
    ),
  );
  await evaluate(`(async()=>{
    window.feedback=document.createElement('qap-toast');feedback.labelText='Copied';feedback.timeoutMs=0;simple.append(feedback);
    window.toastCloses=[];feedback.addEventListener('toast-closed',event=>toastCloses.push({reason:event.detail.reason,bubbles:event.bubbles,composed:event.composed}));
    await feedback.show();
  })()`);
  assert.equal(
    await evaluate(`feedback.shadowRoot.querySelector('[popover]').matches(':popover-open')`),
    true,
  );
  assert.deepEqual(
    await evaluate(
      `(()=>{const live=feedback.shadowRoot.querySelector('[role=status]');return [live.getAttribute('aria-live'),live.getAttribute('aria-atomic'),live.textContent];})()`,
    ),
    ["polite", "true", "Copied"],
  );
  const statusTree = await send("Accessibility.getFullAXTree");
  assert.ok(
    statusTree.nodes.some(
      (node) =>
        !node.ignored &&
        node.role?.value === "status" &&
        node.properties?.some((p) => p.name === "live" && p.value.value === "polite"),
    ),
  );
  assert.equal(
    await evaluate(`document.activeElement===radioGroup.firstElementChild`),
    true,
    "toast never steals focus",
  );
  const pointerTargets = await evaluate(`(async()=>{
    const surface=feedback.shadowRoot.querySelector('[popover]'),rect=surface.getBoundingClientRect();
    const underneath=document.createElement('button');underneath.textContent='Underlying action';
    underneath.style.cssText='position:fixed;inset:0;z-index:1';simple.append(underneath);
    const passesThrough=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)===underneath;
    const action=document.createElement('button');action.slot='action';action.textContent='Toast action';feedback.append(action);
    await feedback.updateComplete;await new Promise(resolve=>requestAnimationFrame(resolve));
    const bounds=action.getBoundingClientRect(),actionReceivesPointer=document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2)===action;
    action.remove();underneath.remove();return {passesThrough,actionReceivesPointer};
  })()`);
  assert.deepEqual(pointerTargets, { passesThrough: true, actionReceivesPointer: true });
  await evaluate(`feedback.labelText='Localized feedback';feedback.updateComplete`);
  assert.equal(
    await evaluate(`feedback.shadowRoot.querySelector('[role=status]').textContent`),
    "Localized feedback",
  );
  await evaluate(`feedback.announceText='Accessible feedback';feedback.updateComplete`);
  assert.equal(
    await evaluate(`feedback.shadowRoot.querySelector('[role=status]').textContent`),
    "Accessible feedback",
  );
  await evaluate(
    `feedback.announceText=undefined;feedback.labelText='Copied';feedback.updateComplete`,
  );
  await evaluate(
    `feedback.dir='rtl';feedback.bottomOffset=24;feedback.style.setProperty('--safe-area-inset-bottom','12px');feedback.updateComplete`,
  );
  const toastPosition = await evaluate(
    `(async()=>{const surface=feedback.shadowRoot.querySelector('[popover]');await Promise.allSettled(surface.getAnimations().map(animation=>animation.finished));const rect=surface.getBoundingClientRect();return {left:rect.left,right:rect.right,bottom:getComputedStyle(surface).bottom};})()`,
  );
  assert.ok(
    toastPosition.left >= -0.01 &&
      toastPosition.right <= (await evaluate(`innerWidth`)) + 0.01 &&
      toastPosition.bottom === "52px",
    `RTL toast placement includes safe-area and bottom offsets: ${JSON.stringify(toastPosition)}`,
  );
  await evaluate(
    `feedback.dir='ltr';feedback.bottomOffset=0;feedback.style.removeProperty('--safe-area-inset-bottom');feedback.updateComplete`,
  );
  await evaluate(
    `(async()=>{window.announcements=[];const live=feedback.shadowRoot.querySelector('[role=status]');window.announcementObserver=new MutationObserver(()=>announcements.push(live.textContent));announcementObserver.observe(live,{childList:true,subtree:true,characterData:true});await feedback.show();})()`,
  );
  assert.deepEqual(
    await evaluate(`announcements`),
    ["", "Copied"],
    "an identical message repopulates the existing live region",
  );
  await evaluate(
    `(async()=>{feedback.labelText='Old';const old=feedback.show();feedback.labelText='Newest';const latest=feedback.show();await Promise.all([old,latest]);})()`,
  );
  assert.equal(
    await evaluate(`feedback.shadowRoot.querySelector('[role=status]').textContent`),
    "Newest",
  );
  await evaluate(`feedback.timeoutMs=200;feedback.show()`);
  await evaluate(`new Promise(resolve=>setTimeout(resolve,120))`);
  await evaluate(`feedback.show()`);
  await evaluate(`new Promise(resolve=>setTimeout(resolve,120))`);
  assert.equal(
    await evaluate(`feedback.shadowRoot.querySelector('[popover]').matches(':popover-open')`),
    true,
    "new notifications restart dismissal",
  );
  await evaluate(
    `new Promise(resolve=>feedback.addEventListener('toast-closed',resolve,{once:true}))`,
  );
  assert.deepEqual(await evaluate(`toastCloses`), [
    { reason: "timeout", bubbles: true, composed: true },
  ]);
  await evaluate(
    `(async()=>{feedback.timeoutMs=0;await feedback.show();const hiding=feedback.hide();await feedback.show();await hiding;})()`,
  );
  assert.equal(
    await evaluate(
      `feedback.shadowRoot.querySelector('[popover]').matches(':popover-open')&&toastCloses.length===1`,
    ),
    true,
  );
  await evaluate(`(async()=>{const showing=feedback.show();feedback.remove();await showing;})()`);
  assert.equal(
    await evaluate(`!feedback.shadowRoot.querySelector('[popover]').matches(':popover-open')`),
    true,
  );
  await evaluate(
    `(async()=>{simple.append(feedback);await feedback.show();await feedback.close('dismiss');await feedback.close();announcementObserver.disconnect();})()`,
  );
  assert.equal(
    await evaluate(`toastCloses.length`),
    2,
    "dismiss completes once after reconnection",
  );
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await evaluate(`feedback.show()`);
  assert.equal(
    await evaluate(
      `getComputedStyle(feedback.shadowRoot.querySelector('[popover]')).transitionDuration`,
    ),
    "0s",
  );
  await evaluate(`feedback.close()`);
  await send("Emulation.setEmulatedMedia", { features: [] });
  await evaluate(
    `new Promise(resolve=>{menu.addEventListener('wa-after-show',resolve,{once:true});menu.open=true;})`,
  );
  await evaluate(
    `(async()=>{window.staleFinish=null;const surface=menu.shadowRoot.querySelector('[popover]'),getAnimations=surface.getAnimations.bind(surface);surface.getAnimations=()=>{surface.getAnimations=getAnimations;return [{finished:new Promise(resolve=>staleFinish=resolve)}];};menu.open=false;await menu.updateComplete;menu.open=true;staleFinish();await menu.updateComplete;})()`,
  );
  assert.equal(
    await evaluate(
      `menu.open&&menu.shadowRoot.querySelector('[popover]').matches(':popover-open')`,
    ),
    true,
    "stale hide cannot close a reopening menu",
  );
  await evaluate(
    `(async()=>{window.boundedHides=0;menu.addEventListener('wa-after-hide',()=>boundedHides++);const surface=menu.shadowRoot.querySelector('[popover]'),getAnimations=surface.getAnimations.bind(surface);surface.getAnimations=()=>{surface.getAnimations=getAnimations;return [{finished:new Promise(resolve=>staleFinish=resolve)}];};const hidden=new Promise(resolve=>menu.addEventListener('wa-after-hide',resolve,{once:true}));menu.open=false;await hidden;staleFinish();await Promise.resolve();})()`,
  );
  assert.equal(
    await evaluate(
      `boundedHides===1&&!menu.shadowRoot.querySelector('[popover]').matches(':popover-open')`,
    ),
    true,
    "unfinished animations have bounded hide completion",
  );
}

async function verifySimpleParity(evaluate, darkTheme, send) {
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
  const result = await evaluate(`(async()=>{
    const fixture=document.createElement('div');fixture.className='qap-shell';fixture.style.cssText='position:fixed;inset:0;display:block;pointer-events:none;--wa-transition-normal:0ms';document.body.append(fixture);
    const original=document.documentElement.style.cssText,results=[];
    const appearance=(base,text=base)=>{const b=getComputedStyle(base),t=getComputedStyle(text);return {height:base.getBoundingClientRect().height,radius:b.borderRadius,border:b.border,color:t.color,font:t.fontSize,family:t.fontFamily,weight:t.fontWeight,line:t.lineHeight,padding:b.padding,background:b.backgroundColor};};
    for(const theme of [{},${JSON.stringify(darkTheme)},{'primary-color':'#805ad5','card-background-color':'#f2edf9','ha-tooltip-background-color':'#f2edf9','ha-tooltip-text-color':'#302846'}]){
      document.documentElement.style.cssText=original;for(const [key,value]of Object.entries(theme))document.documentElement.style.setProperty('--'+key,value);
      for(const type of ['search','assist','filter','list','menu']){
        const isSearch=type.endsWith('search');
        const native=document.createElement(isSearch?'ha-input-search':type==='list'?'ha-list-item-button':type==='menu'?'ha-dropdown-item':type==='assist'?'ha-assist-chip':'ha-filter-chip');
        const owned=document.createElement(isSearch?'qap-search':type==='list'?'qap-list-item':type==='menu'?'qap-menu-item':'qap-chip');
        if(isSearch){native.appearance='outlined';native.placeholder=owned.placeholder='Search';native.style.cssText=owned.style.cssText='width:280px;--ha-input-search-border-radius:var(--qap-radius-field)';}
        else if(type==='list'){native.className=owned.className='qap-settings-row';native.textContent=owned.textContent='Example';native.style.cssText=owned.style.cssText='width:280px;--ha-row-item-min-height:72px';}
        else if(type==='menu'){native.textContent=owned.textContent='Example';}
        else{native.className=owned.className='qap-chip';native.label=owned.label='Example';native.textContent=owned.textContent='Example';owned.selectable=type==='filter';}
        fixture.append(native,owned);await Promise.all([native.updateComplete,owned.updateComplete]);
        let nbase=native.shadowRoot.querySelector('button'),ntext=native.shadowRoot.querySelector('[part="label"]'),obase=owned.shadowRoot.querySelector('[part="base"]'),otext=owned.shadowRoot.querySelector('[part="label"]');
        if(isSearch){const wa=native.shadowRoot.querySelector('wa-input');await wa.updateComplete;nbase=wa.shadowRoot.querySelector('[part~="base"]');ntext=wa.shadowRoot.querySelector('input');otext=owned.shadowRoot.querySelector('input');}
        if(type==='list'){nbase=native.shadowRoot.querySelector('[part="base"]');ntext=native.shadowRoot.querySelector('.content');}
        if(type==='menu'){nbase=native;ntext=native.shadowRoot.querySelector('[part="label"]');}
        const sample=()=>{const n=appearance(nbase,ntext),o=appearance(obase,otext);if(type==='assist'||type==='filter')for(const [host,style]of [[native,n],[owned,o]]){const container=host.shadowRoot.querySelector('.container');style.background=getComputedStyle(container,'::before').backgroundColor;style.border=getComputedStyle(container,'::after').border;}return {type,native:n,owned:o};};
        if(isSearch){
          const iconMetrics=(icon,base,input)=>({width:icon.getBoundingClientRect().width,height:icon.getBoundingClientRect().height,color:getComputedStyle(icon).color,x:icon.getBoundingClientRect().left-base.getBoundingClientRect().left,textX:input.getBoundingClientRect().left+parseFloat(getComputedStyle(input).paddingLeft)-base.getBoundingClientRect().left});
          results.push({type:'search-icon',native:iconMetrics(native.shadowRoot.querySelector('ha-svg-icon'),nbase,ntext),owned:iconMetrics(owned.shadowRoot.querySelector('qap-icon'),obase,otext)});
        }
        results.push(sample());
        if(isSearch){
          const focusStyle=base=>{const style=getComputedStyle(base);return {border:style.border,outline:style.outline,shadow:style.boxShadow,background:style.backgroundColor};};
          native.focus();await Promise.allSettled([nbase,...native.shadowRoot.querySelectorAll('*')].flatMap(el=>el.getAnimations()).map(animation=>animation.finished));const expectedFocus=focusStyle(nbase);
          owned.focus();await Promise.allSettled(obase.getAnimations().map(animation=>animation.finished));results.push({type:type+' focus',native:expectedFocus,owned:focusStyle(obase)});
          otext.blur();
        }
        if(!isSearch){
          const focusStyle=(base,host)=>({background:getComputedStyle(base).backgroundColor,color:getComputedStyle(base).color,outline:getComputedStyle(base).outline,offset:getComputedStyle(base).outlineOffset,focused:host.matches(':focus-within')});
          if(type==='list')native.tabIndex=0;
          native.focus();await Promise.allSettled([native,...native.shadowRoot.querySelectorAll('*')].flatMap(el=>el.getAnimations()).map(animation=>animation.finished));const expectedFocus=focusStyle(nbase,native);
          owned.focus();await Promise.allSettled([owned,...owned.shadowRoot.querySelectorAll('*')].flatMap(el=>el.getAnimations()).map(animation=>animation.finished));
          results.push({type:type+' focus',native:expectedFocus,owned:focusStyle(obase,owned)});
          let active=document.activeElement;while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;active?.blur();
          native.disabled=owned.disabled=true;await Promise.all([native.updateComplete,owned.updateComplete]);await Promise.allSettled([nbase,obase].flatMap(el=>el.getAnimations()).map(animation=>animation.finished));results.push({...sample(),type:type+' disabled'});native.disabled=owned.disabled=false;await Promise.all([native.updateComplete,owned.updateComplete]);
        }
        if(type==='filter'){native.selected=owned.selected=true;native.classList.add('is-active');owned.classList.add('is-active');await Promise.all([native.updateComplete,owned.updateComplete]);results.push({...sample(),type:'selected'});}
        native.remove();owned.remove();
      }
      // Quick Access's original raised surface and border overrides remain
      // separate from the native outlined control's default appearance.
      const searchArea=document.createElement('div');searchArea.className='qap-search';
      const scopedSearch=document.createElement('qap-search'),tokens=document.createElement('div');
      tokens.style.cssText='background:var(--qap-surface-raised);border:1px solid var(--qap-card-border)';
      searchArea.append(scopedSearch,tokens);fixture.append(searchArea);await scopedSearch.updateComplete;
      const scopedBase=scopedSearch.shadowRoot.querySelector('[part="base"]');
      const surfaceStyle=element=>{const style=getComputedStyle(element);return {background:style.backgroundColor,border:style.border};};
      results.push({type:'scoped search tokens',native:surfaceStyle(tokens),owned:surfaceStyle(scopedBase)});
      scopedSearch.focus();await Promise.allSettled(scopedBase.getAnimations().map(animation=>animation.finished));
      tokens.style.borderColor='var(--primary-color)';
      results.push({type:'scoped search focus',native:{border:getComputedStyle(tokens).border},owned:{border:getComputedStyle(scopedBase).border}});
      searchArea.remove();
      for(const type of ['tooltip','menu-surface']){
        const anchor=document.createElement('button');anchor.id='simple-parity-anchor';anchor.textContent='Anchor';fixture.append(anchor);
        const native=document.createElement(type==='tooltip'?'ha-tooltip':'ha-dropdown'),owned=document.createElement(type==='tooltip'?'qap-tooltip':'qap-menu');
        if(type==='tooltip'){native.setAttribute('for',anchor.id);native.trigger='manual';native.placement='bottom-end';native.textContent=owned.textContent='Help with URL patterns';owned.anchorElement=anchor;}
        else{const nitem=document.createElement('ha-dropdown-item'),oitem=document.createElement('qap-menu-item');nitem.textContent=oitem.textContent='Edit profile';
          for(const item of [nitem,oitem]){const icon=document.createElement('qap-icon');icon.icon='mdi:pencil';icon.slot='icon';icon.className='qap-icon';item.append(icon);}native.append(nitem);owned.append(oitem);
          const divider=document.createElement(customElements.get('wa-divider')?'wa-divider':'div');if(divider.localName==='div')divider.className='qap-profile-menu-divider';native.append(divider);const ownedDivider=document.createElement('div');ownedDivider.className='qap-profile-menu-divider';owned.append(ownedDivider);
          const ndanger=document.createElement('ha-dropdown-item'),odanger=document.createElement('qap-menu-item');ndanger.setAttribute('variant','danger');odanger.variant='danger';ndanger.textContent=odanger.textContent='Delete';native.append(ndanger);owned.append(odanger);
        }
        fixture.append(native,owned);await Promise.all([native.updateComplete,owned.updateComplete]);
        native.anchorElement=owned.anchorElement=anchor;
        const shown=new Promise(resolve=>native.addEventListener('wa-after-show',resolve,{once:true}));
        native.open=true;await native.updateComplete;
        await Promise.race([shown,new Promise((_,reject)=>setTimeout(()=>reject(Error(type+' did not finish showing')),2000))]);
        await Promise.allSettled([...native.shadowRoot.querySelectorAll('*')].flatMap(el=>el.getAnimations()).map(animation=>animation.finished));
        const nbase=native.shadowRoot.querySelector(type==='tooltip'?'.body':'#menu'),obase=owned.shadowRoot.querySelector('[popover]');
        const measure=base=>({...appearance(base),width:base.getBoundingClientRect().width,shadow:getComputedStyle(base).boxShadow});
        const expected=measure(nbase);
        const hidden=new Promise(resolve=>native.addEventListener('wa-after-hide',resolve,{once:true}));native.open=false;await hidden;
        const ownedShown=type==='menu-surface'?new Promise(resolve=>owned.addEventListener('wa-after-show',resolve,{once:true})):Promise.resolve();
        owned.open=true;await owned.updateComplete;await ownedShown;
        results.push({type,native:expected,owned:measure(obase)});
        native.open=owned.open=false;native.remove();owned.remove();anchor.remove();
      }
      for(const tag of ['ha-toast','ha-radio-group','ha-radio-option'])if(!customElements.get(tag))throw Error('Missing native parity component '+tag);
      const nativeToast=document.createElement('ha-toast'),ownedToast=document.createElement('qap-toast');
      nativeToast.labelText=ownedToast.labelText='Copied to clipboard';nativeToast.timeoutMs=ownedToast.timeoutMs=0;
      nativeToast.style.cssText=ownedToast.style.cssText='--scale-direction:1';fixture.append(nativeToast,ownedToast);
      await nativeToast.show();const nToast=nativeToast.shadowRoot.querySelector('.toast');
      const toastMetrics=base=>({...appearance(base),width:base.getBoundingClientRect().width,left:base.getBoundingClientRect().left,bottom:getComputedStyle(base).bottom,shadow:getComputedStyle(base).boxShadow});
      const expectedToast=toastMetrics(nToast);await nativeToast.hide();await ownedToast.show();
      results.push({type:'toast',native:expectedToast,owned:toastMetrics(ownedToast.shadowRoot.querySelector('.toast'))});
      nativeToast.remove();ownedToast.remove();
      const ngroup=document.createElement('ha-radio-group'),ogroup=document.createElement('qap-radio-group');
      ngroup.label=ogroup.label='Start with';ngroup.value=ogroup.value='default';
      for(const [group,tag]of [[ngroup,'ha-radio-option'],[ogroup,'qap-radio-option']]){
        for(const value of ['default','copy']){const option=document.createElement(tag);option.value=value;option.className='qap-profile-choice';
          option.innerHTML='<span><strong>'+value+'</strong><small class="qap-muted">Description of this choice</small></span>';
          if(tag==='ha-radio-option')option.style.cssText='display:flex;align-items:flex-start;padding-block:var(--ha-space-1,4px);--ha-radio-option-active-color:var(--qap-blue);--ha-radio-option-checked-background-color:var(--qap-surface-selected);--ha-radio-option-border-color:var(--qap-muted)';
          group.append(option);
        }
      }
      const nativeLabelStyle=document.createElement('style');nativeLabelStyle.textContent='ha-radio-option.qap-profile-choice::part(label){flex:1;min-width:0;align-items:flex-start;padding-block:var(--ha-space-2,8px)}';fixture.append(nativeLabelStyle,ngroup,ogroup);
      await Promise.all([ngroup.updateComplete,ogroup.updateComplete]);await Promise.all([...ngroup.children,...ogroup.children].map(el=>el.updateComplete));
      const groupMetrics=group=>({height:group.getBoundingClientRect().height,label:appearance(group.shadowRoot.querySelector('[part="form-control-label"]')),labelMargin:getComputedStyle(group.shadowRoot.querySelector('[part="form-control-label"]')).margin});
      results.push({type:'radio group',native:groupMetrics(ngroup),owned:groupMetrics(ogroup)});
      const radioMetrics=option=>{const control=option.shadowRoot.querySelector('[part=control]'),label=option.shadowRoot.querySelector('[part=label]');return {host:appearance(option),control:appearance(control),label:appearance(label),width:control.getBoundingClientRect().width,margin:getComputedStyle(control).margin,labelX:label.getBoundingClientRect().left-option.getBoundingClientRect().left};};
      for(const disabled of [false,true]){
        for(const [noption,ooption]of [...ngroup.children].map((option,i)=>[option,ogroup.children[i]])){
          noption.disabled=ooption.disabled=disabled;await Promise.all([noption.updateComplete,ooption.updateComplete]);
          results.push({type:'radio '+noption.value+(disabled?' disabled':''),native:radioMetrics(noption),owned:radioMetrics(ooption)});
        }
      }
      ngroup.remove();ogroup.remove();nativeLabelStyle.remove();
    }
    document.documentElement.style.cssText=original;fixture.remove();return results;
  })()`);
  console.log(
    "SIMPLE PARITY",
    JSON.stringify(
      result
        .map((sample) => ({
          type: sample.type,
          differences: Object.fromEntries(
            Object.keys(sample.native)
              .filter(
                (key) => JSON.stringify(sample.native[key]) !== JSON.stringify(sample.owned[key]),
              )
              .map((key) => [key, [sample.native[key], sample.owned[key]]]),
          ),
        }))
        .filter((sample) => Object.keys(sample.differences).length),
    ),
  );
  for (const sample of result)
    assert.deepEqual(sample.owned, sample.native, `${sample.type}: ${JSON.stringify(sample)}`);
  await verifyRowPointerParity(evaluate, send);
}

module.exports = { verifySimpleControls, verifySimpleParity };
