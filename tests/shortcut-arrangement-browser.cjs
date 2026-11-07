const assert = require("node:assert/strict");

/** Real pointer/touch, keyboard, layout and transactional checks for 100 tiles. */
async function verifyShortcutArrangement({ evaluate, send, touch = false }) {
  const pause = () => evaluate(`new Promise(resolve => setTimeout(resolve, 100))`);
  const click = async (selector) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await pause();
  };
  const ids = () =>
    evaluate(
      `[...document.querySelector('.qap-arrangement-enabled').children].map(item => item.dataset.id)`,
    );
  const point = (selector) =>
    evaluate(
      `(() => {const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2};})()`,
    );
  const key = async (name, code, alt = false) => {
    for (const type of ["keyDown", "keyUp"])
      await send("Input.dispatchKeyEvent", {
        type,
        key: name,
        code: name === " " ? "Space" : name,
        windowsVirtualKeyCode: code,
        modifiers: alt ? 1 : 0,
        ...(name === "Enter" && type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}),
      });
    await pause();
  };
  const editing = () =>
    evaluate(`(() => {const editor=document.querySelector('.qap-shortcut-editor');
      return editor?.open ? editor.querySelector('.qap-shortcut-form qap-input').value : null;})()`);
  // Escape closes only the nested editor and returns focus to its tile.
  const closeEditing = async (id) => {
    await key("Escape", 27);
    await pause();
    assert.equal(await editing(), null);
    assert.equal(
      await evaluate(`!!document.querySelector('.qap-category-form') &&
        document.activeElement === document.querySelector('.qap-arrangement-enabled [data-id="${id}"]')`),
      true,
      "focus returns to the edited tile in the same Edit Group",
    );
  };
  const management =
    await evaluate(`(() => {const row=document.querySelector('.qap-shortcut-row'), item=row.parentElement;
    return {tag:row.localName,height:item.getBoundingClientRect().height,expected:parseFloat(getComputedStyle(item).getPropertyValue('--qap-row-height')),
      icon:row.querySelector('.qap-edit-symbol').getBoundingClientRect().height,
      separate:row.nextElementSibling.classList.contains('qap-shortcut-overflow'),nested:!!row.querySelector('button,qap-button,qap-icon-button'),
      grips:document.querySelectorAll('.qap-shortcut-groups .qap-grip').length};})()`);
  assert.equal(management.tag, "button");
  assert.equal(management.height, management.expected);
  assert.equal(management.icon, 33);
  assert.equal(management.separate, true);
  assert.equal(management.nested, false);
  assert.equal(management.grips, 0);
  await click(".qap-shortcut-overflow");
  assert.equal(
    await evaluate(`!!document.querySelector('.qap-shortcut-editor')`),
    false,
    "overflow opens only its menu",
  );
  await click(".qap-shortcut-overflow");
  await evaluate(`document.querySelector('.qap-shortcut-row').focus()`);
  await key("Enter", 13);
  assert.equal(await evaluate(`!!document.querySelector('.qap-shortcut-editor')`), true);
  await click(".qap-shortcut-editor .qap-editor-close");
  await click(".qap-head-button");
  await evaluate(`window.arrangementBackup = structuredClone(window.testProfiles.profiles[0]);
    (() => {const profile = window.testProfiles.profiles[0];
      profile.categories = [{id:'favorites',name:'Favorites',grid:{columns:2,rows:2}}];
      profile.settings.links = Array.from({length:102}, (_, index) => ({...profile.settings.links[0],
        id:'arrange-'+index,name:'Arrange '+index,group:'favorites',hidden:index>=100}));
      window.publishProfiles();})();`);
  await click(".qap-settings-categories");
  await click('[data-id="favorites"] .qap-category-edit');
  await click(".qap-arrangement-help");
  assert.equal(
    await evaluate(`document.querySelector('.qap-arrangement-heading qap-tooltip').open`),
    true,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.qap-arrangement-heading qap-tooltip').shadowRoot.querySelector('[popover]').matches(':popover-open')`,
    ),
    true,
  );
  await key("Escape", 27);
  assert.equal(
    await evaluate(`document.querySelector('.qap-arrangement-heading qap-tooltip').open`),
    false,
  );
  await click(".qap-category-cancel");
  assert.equal(
    await evaluate(
      `!!document.querySelector('.qap-category-form') || !!document.querySelector('.qap-discard-changes-confirmation')`,
    ),
    false,
    "help leaves the draft clean",
  );
  await click('[data-id="favorites"] .qap-category-edit');
  await evaluate(`window.arrangementNodes = [...document.querySelector('.qap-arrangement-enabled').children];
    window.arrangementWrites = window.profileWrites.length;`);
  assert.equal((await ids()).length, 100);
  const originalOrder = await ids();
  for (const dimension of ["columns", "rows"]) {
    const bounds = await evaluate(`(() => {
      const stepper=document.querySelector('[data-dimension="${dimension}"]'), field=stepper.querySelector('qap-input');
      const minus=stepper.querySelector('.qap-grid-decrease'), plus=stepper.querySelector('.qap-grid-increase');
      for(let index=0;index<12;index++) minus.click();
      const minimum=field.value, atMin=minus.disabled;
      for(let index=0;index<12;index++) plus.click();
      return {minimum,atMin,maximum:field.value,atMax:plus.disabled};
    })()`);
    assert.deepEqual(bounds, { minimum: "1", atMin: true, maximum: "10", atMax: true });
    assert.deepEqual(await ids(), originalOrder);
  }
  const selector = '.qap-arrangement-enabled [data-id="arrange-0"]';
  for (const columns of [2, 4, 6, 10]) {
    const layout = await evaluate(`(() => {
      const field=document.querySelector('.qap-grid-fields qap-input');field.value='${columns}';field.dispatchEvent(new Event('input',{bubbles:true}));
      const grid=document.querySelector('.qap-arrangement-enabled'), surface=document.querySelector('.qap-arrangement');
      const reference=document.createElement('div');reference.className='qap-tiles qap-custom-grid';
      reference.style.cssText='position:absolute;visibility:hidden;top:0;width:'+grid.getBoundingClientRect().width+'px';
      reference.style.setProperty('--qap-grid-columns','${columns}');
      reference.append(grid.querySelector('.qap-tile').cloneNode(true));surface.append(reference);
      const properties=['width','height','minHeight','borderWidth','borderRadius','borderColor','backgroundColor','padding','gap','color'];
      const measure=tile=>({tile:properties.map(name=>getComputedStyle(tile)[name]),
        icon:['width','height'].map(name=>getComputedStyle(tile.querySelector('.qap-tile-icon'))[name]),
        label:['fontSize','lineHeight','fontWeight'].map(name=>getComputedStyle(tile.querySelector('.qap-tile-name'))[name]),
        badge:tile.querySelector('.qap-tile-badge')?.getAttribute('icon')});
      const result={actual:measure(grid.querySelector('.qap-tile')),reference:measure(reference.firstElementChild),
        columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        overflow:[surface,grid,surface.closest('.qap-category-form'),surface.closest('.qap-body'),document.querySelector('.qap-shell')]
          .some(element=>element.scrollWidth>element.clientWidth+1),
        handle:!!grid.querySelector('.qap-grip'),
        extraHeight:grid.firstElementChild.getBoundingClientRect().height-grid.querySelector('.qap-tile').getBoundingClientRect().height};
      reference.remove();return result;
    })()`);
    assert.equal(layout.columns, columns, "configured column count is preserved");
    assert.equal(layout.overflow, false, `${columns} columns fit without horizontal scrolling`);
    assert.equal(layout.handle, false);
    assert.equal(layout.extraHeight, 0);
    assert.deepEqual(
      layout.actual,
      layout.reference,
      `${columns} columns reuse static preview dimensions and appearance`,
    );
    assert.equal(
      await evaluate(
        `window.arrangementNodes.every((item,index)=>document.querySelector('.qap-arrangement-enabled').children[index]===item)`,
      ),
      true,
    );
    if (columns === 6) {
      const partial = await evaluate(`(() => {
        const list=document.querySelector('.qap-arrangement-enabled'), slots=document.querySelector('.qap-arrangement-placeholders');
        const last=list.lastElementChild.getBoundingClientRect(),first=slots.firstElementChild.getBoundingClientRect();
        return {last:last.toJSON(),first:first.toJSON(),margin:getComputedStyle(slots).marginTop};
      })()`);
      assert.ok(
        Math.abs(partial.last.top - partial.first.top) < 1 &&
          partial.first.left > partial.last.right,
        "empty cells continue the partial last row: " + JSON.stringify(partial),
      );
    }
  }
  await evaluate(`(() => {const [columns,rows]=document.querySelectorAll('.qap-grid-fields qap-input');
    for(const field of [columns,rows]) {field.value='4';field.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  const placeholders = await evaluate(`(() => {
    const slots=document.querySelector('.qap-arrangement-placeholders'), list=document.querySelector('.qap-arrangement-enabled');
    const last=list.lastElementChild.getBoundingClientRect(), first=slots.firstElementChild.getBoundingClientRect();
    return {count:slots.children.length, outside:!list.contains(slots), inert:slots.inert, hidden:slots.getAttribute('aria-hidden'),
      sameRow:Math.abs(last.top-first.top)<1, nextColumn:first.left>last.right, width:first.width, tileWidth:last.width,
      height:first.height,tileHeight:last.height, pointerEvents:getComputedStyle(slots).pointerEvents};
  })()`);
  // Add takes the first cell after the 100th card; eleven empty cells complete the page.
  assert.equal(placeholders.count, 11);
  assert.equal(placeholders.outside, true);
  assert.equal(placeholders.inert, true);
  assert.equal(placeholders.hidden, "true");
  // 100 cards fill 25 rows, so Add and the empty positions start on the next row.
  assert.equal(placeholders.sameRow, false);
  assert.equal(placeholders.pointerEvents, "none");
  assert.equal(placeholders.width, placeholders.tileWidth);
  assert.equal(placeholders.height, placeholders.tileHeight);
  await click(".qap-grid-labels");
  assert.equal(
    await evaluate(`!!document.querySelector('.qap-arrangement-enabled .qap-tile-name')`),
    false,
  );
  await click(".qap-grid-labels");
  assert.equal(
    await evaluate(`!!document.querySelector('.qap-arrangement-enabled .qap-tile-name')`),
    true,
  );
  await evaluate(
    `(() => {const field=document.querySelector('.qap-grid-fields qap-input');field.value='2';field.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});
    document.querySelector(${JSON.stringify(selector)}).focus();`);
  for (const [name, code] of [
    ["Enter", 13],
    [" ", 32],
  ]) {
    await key(name, code);
    assert.equal(await editing(), "Arrange 0", `${JSON.stringify(name)} edits the focused tile`);
    assert.equal(
      await evaluate(
        `!!document.querySelector('.qap-category-form') && window.profileWrites.length === window.arrangementWrites`,
      ),
      true,
    );
    await closeEditing("arrange-0");
  }
  for (const [name, code] of [
    ["ArrowDown", 40],
    ["ArrowDown", 40],
    ["ArrowRight", 39],
  ])
    await key(name, code, true);
  assert.equal((await ids())[5], "arrange-0");
  assert.equal(
    await evaluate(
      `document.activeElement === document.querySelector(${JSON.stringify(selector)})`,
    ),
    true,
  );
  assert.match(
    await evaluate(`document.querySelector('.qap-arrangement-enabled').parentElement.announcement`),
    /Position 6 of 100/,
  );
  const keyboardOrder = await ids();
  await evaluate(`(() => {const [columns,rows] = document.querySelectorAll('.qap-grid-fields qap-input');
    columns.value='3'; rows.value='1'; for (const field of [columns,rows]) field.dispatchEvent(new Event('input',{bubbles:true}));})();`);
  assert.deepEqual(await ids(), keyboardOrder);
  assert.equal(
    await evaluate(
      `window.arrangementNodes.every(item => document.querySelector('.qap-arrangement-enabled').contains(item))`,
    ),
    true,
  );
  const pages =
    await evaluate(`[...document.querySelector('.qap-arrangement-enabled').children].slice(0,7).map(item => ({
    margin:getComputedStyle(item).marginTop, content:getComputedStyle(item,'::before').content}))`);
  assert.equal(pages[0].margin, "28px");
  assert.equal(pages[3].margin, "28px");
  assert.match(pages[0].content, /Page/);
  assert.equal(pages[1].content, "none");
  assert.match(pages[0].content, /1/);
  assert.match(pages[3].content, /2/);
  assert.match(pages[6].content, /3/);
  assert.deepEqual(
    await evaluate(
      `document.querySelector('.qap-arrangement-disabled qap-select').options.map(option=>[option.value,option.label])`,
    ),
    [
      ["arrange-100", "Arrange 100"],
      ["arrange-101", "Arrange 101"],
    ],
  );
  assert.equal(
    await evaluate(`document.querySelector('.qap-arrangement-disabled qap-select').label`),
    "Disabled shortcuts (2)",
  );
  await evaluate(
    `(() => {const field=document.querySelector('.qap-arrangement-disabled qap-select');field.value='arrange-101';field.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  assert.equal(
    await evaluate(`document.querySelectorAll('.qap-arrangement-disabled .qap-tile').length`),
    0,
  );
  assert.deepEqual(await ids(), keyboardOrder);
  await evaluate(
    `document.querySelector('.qap-arrangement').scrollTop=0; document.querySelector('.qap-arrangement').scrollLeft=0`,
  );
  await pause();
  const firstId = (await ids())[0];
  const grip = `.qap-arrangement-enabled [data-id="${firstId}"]`;
  const start = await point(grip);
  const target = await point(".qap-arrangement-enabled > :nth-child(2)");
  const hold = () => evaluate(`new Promise(resolve => setTimeout(resolve, 450))`);
  if (touch) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const gesture = async (phase, position) => {
    if (touch)
      await send("Input.dispatchTouchEvent", {
        type: { start: "touchStart", move: "touchMove", end: "touchEnd", cancel: "touchCancel" }[
          phase
        ],
        touchPoints: position ? [position] : [],
      });
    else
      await send("Input.dispatchMouseEvent", {
        type: { start: "mousePressed", move: "mouseMoved", end: "mouseReleased" }[phase],
        ...position,
        button: "left",
        buttons: phase === "end" ? 0 : 1,
        clickCount: 1,
      });
  };
  assert.equal(
    await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(grip)})).cursor`),
    "pointer",
    "a resting tile offers editing, not dragging",
  );
  try {
    await gesture("start", start);
    await gesture("end", touch ? undefined : start);
    await hold();
    assert.deepEqual(await ids(), keyboardOrder, "a short tap does not drag or execute");
    assert.equal(await evaluate(`!!document.querySelector('.qap-dragging')`), false);
    assert.equal(
      await editing(),
      await evaluate(`document.querySelector(${JSON.stringify(grip)}).getAttribute('aria-label')`),
      "a short tap edits the tapped shortcut",
    );
    await closeEditing(firstId);
    assert.equal(await evaluate(`window.profileWrites.length===window.arrangementWrites`), true);
    await gesture("start", start);
    await gesture("move", { x: start.x, y: start.y - 35 });
    await pause();
    if (touch) {
      await gesture("move", { x: start.x, y: start.y - 80 });
      await pause();
      assert.ok(
        (await evaluate(`document.querySelector('.qap-arrangement').scrollTop`)) > 0,
        "early movement scrolls normally",
      );
    }
    await hold();
    assert.equal(
      await evaluate(`!!document.querySelector('.qap-dragging')`),
      false,
      "early movement cancels long press",
    );
    await gesture("end", touch ? undefined : start);
    await pause();
    assert.equal(await editing(), null, "a scroll or early movement never edits");
    await evaluate(`document.querySelector('.qap-arrangement').scrollTop=0`);
    await pause();
    await gesture("start", start);
    await hold();
    assert.equal(
      await evaluate(
        `!!document.querySelector('.qap-dragging') && !!document.querySelector('.qap-drag-origin')`,
      ),
      true,
    );
    assert.equal(
      await evaluate(`getComputedStyle(document.querySelector('.qap-dragging')).cursor`),
      "grabbing",
    );
    const beforeDragScroll = await evaluate(`document.querySelector('.qap-arrangement').scrollTop`);
    await gesture("move", { x: start.x, y: start.y - 25 });
    await pause();
    assert.equal(
      await evaluate(`document.querySelector('.qap-arrangement').scrollTop`),
      beforeDragScroll,
      "active touch does not start native scrolling",
    );
    await gesture("move", target);
    await pause();
    assert.equal(
      await evaluate(
        `!!document.querySelector('.qap-dragging') && !!document.querySelector('.qap-drag-preview')`,
      ),
      true,
    );
    const ghost = await point(".qap-drag-preview");
    assert.ok(
      Math.abs(ghost.x - target.x) < 2 && Math.abs(ghost.y - target.y) < 2,
      "the drag preview follows the pointer",
    );
    assert.notDeepEqual(await ids(), keyboardOrder, "both axes take part in grid hit testing");
    if (touch) await gesture("cancel");
    else {
      await key("Escape", 27);
      await gesture("end", target);
    }
    await pause();
    assert.deepEqual(await ids(), keyboardOrder);
    assert.equal(await editing(), null, "a cancelled drag never edits");
    await evaluate(`(() => {const [columns,rows]=document.querySelectorAll('.qap-grid-fields qap-input');
      columns.value='1';rows.value='1';for(const field of [columns,rows])field.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('.qap-arrangement').scrollTop=0;})();`);
    await pause();
    const longStart = await point(grip);
    const edge = await evaluate(
      `(() => {const r=document.querySelector('.qap-arrangement').getBoundingClientRect();return {x:r.left+r.width/2,y:r.bottom-12};})()`,
    );
    await gesture("start", longStart);
    await hold();
    await gesture("move", edge);
    await pause();
    const scroll = await evaluate(`document.querySelector('.qap-arrangement').scrollTop`);
    await pause();
    assert.ok(
      (await evaluate(`document.querySelector('.qap-arrangement').scrollTop`)) > scroll,
      "stationary drag auto-scrolls",
    );
    await gesture("end", touch ? undefined : edge);
    await pause();
    assert.equal(await editing(), null, "a completed drag never edits");
    assert.notDeepEqual(await ids(), keyboardOrder);
    assert.equal(
      await evaluate(
        `window.arrangementNodes.every(item=>document.querySelector('.qap-arrangement-enabled').contains(item))`,
      ),
      true,
    );
    assert.equal(await evaluate(`window.profileWrites.length===window.arrangementWrites`), true);
    assert.equal(
      await evaluate(`document.querySelector('.qap-drop-highlight')?.dataset.id`),
      firstId,
    );
    await evaluate(`new Promise(resolve=>setTimeout(resolve,180))`);
    assert.equal(
      await evaluate(`(() => {const item=document.querySelector('.qap-drop-highlight'),tile=item.querySelector('.qap-tile');
      const accent=document.createElement('span');accent.style.color='var(--qap-blue)';item.append(accent);
      const matches=getComputedStyle(tile).borderTopColor===getComputedStyle(accent).color;accent.remove();return matches;})()`),
      true,
    );
    await evaluate(`new Promise(resolve=>setTimeout(resolve,2250))`);
    assert.equal(await evaluate(`!!document.querySelector('.qap-drop-highlight')`), false);
  } finally {
    if (touch) await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
  const footer =
    await evaluate(`(() => {const form=document.querySelector('.qap-category-form'),actions=form.querySelector('.qap-form-actions').getBoundingClientRect();
    return {reachable:actions.top>=0 && actions.bottom<=innerHeight,scrollHeight:form.querySelector('.qap-arrangement').scrollHeight,
      height:form.querySelector('.qap-arrangement').clientHeight};})()`);
  assert.equal(footer.reachable, true);
  assert.ok(footer.scrollHeight > footer.height);
  const draft = await ids();
  await click(".qap-category-submit");
  assert.deepEqual(
    await evaluate(
      `window.testProfiles.profiles[0].settings.links.filter(link=>!link.hidden).map(link=>link.id)`,
    ),
    draft,
  );
  assert.equal(await evaluate(`window.profileWrites.length===window.arrangementWrites+1`), true);
  await click('[data-id="favorites"] .qap-category-edit');
  await evaluate(
    `document.querySelector('.qap-arrangement-enabled > .qap-arrangement-item').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true,cancelable:true}))`,
  );
  await pause();
  await click(".qap-category-cancel");
  await click(".qap-discard-changes-confirmation .qap-button-danger");
  assert.deepEqual(
    await evaluate(
      `window.testProfiles.profiles[0].settings.links.filter(link=>!link.hidden).map(link=>link.id)`,
    ),
    draft,
  );
  await verifyArrangementAdd({ evaluate, click, ids, key, pause });
  await click(".qap-head-button");
  await evaluate(
    `window.testProfiles.profiles[0]=window.arrangementBackup;delete window.arrangementBackup;window.publishProfiles()`,
  );
  await click(".qap-settings-shortcuts");
}

/** Add from Edit Group: real layout, nested editor stacking and transactional order. */
async function verifyArrangementAdd({ evaluate, click, ids, key, pause }) {
  await click('[data-id="favorites"] .qap-category-edit');
  const setGrid = (columns, rows) =>
    evaluate(`(() => {const [c,r]=document.querySelectorAll('.qap-grid-fields qap-input');
    c.value='${columns}';r.value='${rows}';for(const field of [c,r])field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  // 100 enabled shortcuts: 3 columns leave one tile on the last row, so Add is second.
  await setGrid(3, 2);
  await pause();
  const geometry = () =>
    evaluate(`(() => {
    const list=document.querySelector('.qap-arrangement-enabled'), add=document.querySelector('.qap-arrangement-add');
    add.scrollIntoView({block:'center'});
    const last=list.lastElementChild.querySelector('.qap-tile').getBoundingClientRect(), rect=add.getBoundingClientRect();
    const slot=document.querySelector('.qap-arrangement-placeholders .qap-grid-placeholder')?.getBoundingClientRect();
    const surface=document.querySelector('.qap-arrangement'), style=getComputedStyle(add);
    return {sameRow:Math.abs(rect.top-last.top)<1, after:rect.left>last.right, below:rect.top>last.bottom, width:rect.width, height:rect.height,
      tileWidth:last.width, tileHeight:last.height, border:style.borderTopStyle, overflow:surface.scrollWidth>surface.clientWidth,
      slotAfter:slot ? Math.abs(slot.top-rect.top)<1 && slot.left>rect.right : null, label:getComputedStyle(add,'::before').content,
      inList:list.contains(add), hit:document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.closest('.qap-arrangement-add')===add};
  })()`);
  let add = await geometry();
  assert.equal(add.sameRow, true, "Add continues the partial last row");
  assert.equal(add.after, true);
  assert.ok(
    Math.abs(add.width - add.tileWidth) < 1 && Math.abs(add.height - add.tileHeight) < 1,
    "Add matches tile dimensions: " + JSON.stringify(add),
  );
  assert.equal(add.border, "dashed");
  assert.equal(add.overflow, false);
  assert.equal(add.inList, false);
  assert.equal(add.hit, true);
  assert.equal(add.slotAfter, true, "empty cells follow Add on its row");
  // 100 = 25 full 2 × 2 pages: Add opens page 26 with its own label.
  await setGrid(2, 2);
  await pause();
  add = await geometry();
  assert.equal(add.below, true);
  assert.match(add.label, /Page.*26/);
  const writes = await evaluate(`window.profileWrites.length`);
  // Keyboard activation opens the existing editor above Edit Group; Escape closes only it.
  await evaluate(`document.querySelector('.qap-arrangement-add').focus()`);
  await key("Enter", 13);
  assert.equal(
    await evaluate(`(() => {const editor=document.querySelector('.qap-shortcut-editor'), group=document.querySelector('.qap-category-modal');
    return !!editor && editor.open && group.open && [...document.body.children].indexOf(editor)>[...document.body.children].indexOf(group);})()`),
    true,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.qap-shortcut-editor .qap-category-dropdown qap-select').value`,
    ),
    "category:favorites",
  );
  await key("Escape", 27);
  await pause();
  assert.equal(
    await evaluate(
      `!document.querySelector('.qap-shortcut-editor') && !!document.querySelector('.qap-category-form')`,
    ),
    true,
  );
  assert.equal(
    await evaluate(`document.activeElement === document.querySelector('.qap-arrangement-add')`),
    true,
    "focus returns to Add",
  );
  const order = await ids();
  await click(".qap-arrangement-add");
  await evaluate(`(() => {const fields=[...document.querySelectorAll('.qap-shortcut-form qap-input')];
    fields[0].value='Added in group';fields[0].dispatchEvent(new Event('input',{bubbles:true}));
    fields.at(-1).value='/config/added';fields.at(-1).dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate(
    `[...document.querySelectorAll('.qap-shortcut-form .qap-form-actions qap-button')].find(button=>button.textContent==='Save').click()`,
  );
  await evaluate(`new Promise(resolve=>setTimeout(resolve,400))`);
  const created = await evaluate(
    `window.testProfiles.profiles[0].settings.links.find(link=>link.name==='Added in group')?.id`,
  );
  assert.ok(created, "the shortcut is saved immediately");
  assert.equal(await evaluate(`window.profileWrites.length`), writes + 1);
  assert.equal(
    await evaluate(
      `!!document.querySelector('.qap-category-form') && !document.querySelector('.qap-shortcut-editor')`,
    ),
    true,
  );
  assert.deepEqual(await ids(), [...order, created]);
  const revealed =
    await evaluate(`(() => {const item=document.querySelector('.qap-arrangement-enabled').lastElementChild, surface=document.querySelector('.qap-arrangement');
    const rect=item.getBoundingClientRect(), view=surface.getBoundingClientRect();
    return {highlight:item.classList.contains('qap-drop-highlight'), visible:rect.top>=view.top-1 && rect.bottom<=view.bottom+1, focused:document.activeElement===item};})()`);
  assert.deepEqual(revealed, { highlight: true, visible: true, focused: true });
  add = await geometry();
  assert.equal(add.sameRow, true, "Add moves to the next free cell");
  assert.equal(add.after, true);
  // Saved but never arranged: Cancel closes without a discard prompt and keeps the shortcut.
  await setGrid(1, 1); // the saved dimensions
  await click(".qap-category-cancel");
  assert.equal(
    await evaluate(
      `!document.querySelector('.qap-category-form') && !document.querySelector('.qap-discard-changes-confirmation')`,
    ),
    true,
  );
  assert.equal(await evaluate(`window.profileWrites.length`), writes + 1);
  assert.deepEqual(
    await evaluate(
      `window.testProfiles.profiles[0].settings.links.filter(link=>!link.hidden).map(link=>link.id)`,
    ),
    [...order, created],
  );
}

module.exports = { verifyShortcutArrangement };
