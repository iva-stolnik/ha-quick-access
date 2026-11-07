const assert = require("node:assert/strict");

const entities = [
  ["light", "on", { rgb_color: [255, 40, 10], brightness: 64 }],
  ["light", "on", { brightness: 255 }],
  ["light", "off", {}],
  ["light", "unknown", {}],
  ["light", "unavailable", {}],
  ["switch", "on", {}],
  ["switch", "off", {}],
  ["sensor", "21", { device_class: "temperature" }],
  ["sensor", "20", { device_class: "battery" }],
  ["sensor", "60", { device_class: "battery" }],
  ["sensor", "80", { device_class: "battery" }],
  ["binary_sensor", "on", { device_class: "door" }],
  ["binary_sensor", "off", { device_class: "door" }],
  ["binary_sensor", "on", { device_class: "smoke" }],
  ["cover", "open", {}],
  ["cover", "closed", {}],
  ["climate", "heat", { hvac_action: "heating" }],
  ["climate", "heat", { hvac_action: "idle" }],
  ["climate", "cool", { hvac_action: "cooling" }],
  ["climate", "heat", { hvac_action: "invalid" }],
  ["person", "home", {}],
  ["person", "not_home", {}],
  ["lock", "jammed", {}],
  ["alarm_control_panel", "triggered", {}],
  ["sun", "below_horizon", {}],
  ["weather", "sunny", {}],
  ["vacuum", "docked", {}],
  ["valve", "open", {}],
  ["light", "on", { icon: "mdi:desk-lamp" }],
  ["light", "off", { icon: "fixture:custom" }],
  ["sensor", "unavailable", { icon: "mdi:thermometer-alert" }],
  ["group", "on", { entity_id: ["light.one", "light.two"] }],
  [
    "person",
    "home",
    { entity_picture: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" },
  ],
  ["sensor", "30", { device_class: "integration" }],
].map(([domain, value, attributes], index) => ({
  entity_id: `${domain}.icon_${index}`,
  state: value,
  attributes,
}));

const resources = {
  light: { _: { default: "mdi:lightbulb", state: { off: "mdi:lightbulb-off" } } },
  switch: {
    _: { default: "mdi:toggle-switch-variant", state: { off: "mdi:toggle-switch-variant-off" } },
  },
  sensor: {
    _: { default: "mdi:eye" },
    temperature: { default: "mdi:thermometer" },
    battery: {
      default: "mdi:battery",
      range: { 0: "mdi:battery-alert", 30: "mdi:battery-50", 70: "mdi:battery" },
    },
  },
  binary_sensor: {
    _: { default: "mdi:checkbox-blank-circle-outline" },
    door: { default: "mdi:door-closed", state: { on: "mdi:door-open" } },
    smoke: { default: "mdi:smoke-detector", state: { on: "mdi:smoke-detector-alert" } },
  },
  cover: { _: { default: "mdi:window-shutter", state: { open: "mdi:window-shutter-open" } } },
  climate: { _: { default: "mdi:thermostat" } },
  person: { _: { default: "mdi:account" } },
  lock: { _: { default: "mdi:lock" } },
  alarm_control_panel: { _: { default: "mdi:shield" } },
  weather: { _: { default: "mdi:weather-sunny" } },
  vacuum: { _: { default: "mdi:robot-vacuum" } },
  valve: { _: { default: "mdi:valve" } },
  group: { _: { default: "mdi:google-circles-communities" } },
};

async function verifyStateIcon({ evaluate, send }) {
  // Keep a metadata request pending across repeated list mounting/unmounting.
  // Detached controls must be collectible while HA's connection remains live.
  await evaluate(`(async()=>{
    window.iconLeakContext={connection:{},config:{components:['light']},callWS:()=>new Promise(resolve=>{window.iconLeakResolve=resolve;})};
    window.iconLeakRefs=[];
    for(let i=0;i<20;i++){
      const icon=document.createElement('qap-state-icon');icon.hass=iconLeakContext;
      icon.stateObj={entity_id:'light.leak_'+i,state:'on',attributes:{}};
      document.body.append(icon);await icon.updateComplete;
      iconLeakRefs.push(new WeakRef(icon));icon.remove();
    }
  })()`);
  await send("HeapProfiler.collectGarbage");
  await send("HeapProfiler.collectGarbage");
  assert.equal(
    await evaluate(`iconLeakRefs.filter(reference=>reference.deref()).length`),
    0,
    "pending shared metadata must not retain detached state icons",
  );
  await evaluate(
    `iconLeakResolve({resources:{}});delete window.iconLeakResolve;delete window.iconLeakContext;delete window.iconLeakRefs;`,
  );
  await evaluate(`(async()=>{
    window.iconFixture=document.createElement('section');iconFixture.style.cssText='display:flex;flex-wrap:wrap;gap:8px;width:100%;--state-icon-color:#44739e;--state-unavailable-color:#999;--disabled-text-color:#777;--state-active-color:#f90;--state-light-active-color:#ffc107';
    document.body.append(iconFixture);window.iconStates=${JSON.stringify(entities)};
    for(const state of iconStates){const host=document.createElement('span');host.className='qap-state-icon';
      const icon=document.createElement('qap-state-icon');icon.className='qap-icon';icon.stateObj=state;host.append(icon);iconFixture.append(host);}
    await Promise.all([...iconFixture.querySelectorAll('qap-state-icon')].map(icon=>icon.updateComplete));
    window.iconOriginal=iconFixture.querySelector('qap-state-icon');window.iconNode=iconOriginal.shadowRoot.querySelector('ha-icon');window.iconRenders=0;
    const render=iconOriginal.render.bind(iconOriginal);iconOriginal.render=()=>{iconRenders++;return render();};
  })()`);
  assert.equal(
    await evaluate(`customElements.get('state-badge')===undefined`),
    true,
    "entity icons never load state-badge",
  );
  assert.equal(await evaluate(`iconNode.icon`), "mdi:lightbulb");
  assert.equal(await evaluate(`getComputedStyle(iconNode).filter`), "brightness(0.618)");
  assert.equal(await evaluate(`iconFixture.scrollWidth<=iconFixture.clientWidth`), true);
  assert.equal(await evaluate(`iconOriginal.getBoundingClientRect().width`), 19);
  await evaluate(
    `(async()=>{for(let i=0;i<200;i++){iconOriginal.stateObj={...iconOriginal.stateObj,attributes:{...iconOriginal.stateObj.attributes,friendly_name:'Name '+i}};await iconOriginal.updateComplete;}})()`,
  );
  assert.equal(await evaluate(`iconRenders`), 0, "unrelated attributes skip rendering");
  for (const [value, attributes, color] of [
    ["on", { rgb_color: [0, 0, 255], brightness: 255 }, "rgb(0, 0, 255)"],
    ["off", {}, "rgb(68, 115, 158)"],
    ["unavailable", { rgb_color: [255, 0, 0], brightness: 64 }, "rgb(153, 153, 153)"],
    ["on", { icon: "custom:fixture" }, "rgb(255, 193, 7)"],
  ]) {
    await evaluate(
      `iconOriginal.stateObj={entity_id:'light.test',state:${JSON.stringify(value)},attributes:${JSON.stringify(attributes)}};iconOriginal.updateComplete`,
    );
    await evaluate(`new Promise(resolve=>setTimeout(resolve,350))`);
    assert.equal(
      await evaluate(`iconOriginal.shadowRoot.querySelector('ha-icon')===iconNode`),
      true,
      "the inner icon stays mounted",
    );
    assert.equal(await evaluate(`getComputedStyle(iconNode).color`), color);
    assert.equal(
      await evaluate(`getComputedStyle(iconNode).filter`),
      value === "on" && attributes.brightness ? "brightness(1)" : "none",
    );
  }
  await evaluate(
    `iconOriginal.stateObj={entity_id:'climate.test',state:'unavailable',attributes:{hvac_action:'heating'}};iconOriginal.updateComplete`,
  );
  await evaluate(`new Promise(resolve=>setTimeout(resolve,350))`);
  assert.equal(await evaluate(`getComputedStyle(iconNode).color`), "rgb(153, 153, 153)");
  assert.equal(await evaluate(`getComputedStyle(iconNode).filter`), "none");
  await evaluate(`iconOriginal.disabled=true;iconOriginal.updateComplete`);
  await evaluate(`new Promise(resolve=>setTimeout(resolve,350))`);
  assert.equal(await evaluate(`getComputedStyle(iconNode).color`), "rgb(119, 119, 119)");
  await evaluate(`iconFixture.style.setProperty('--disabled-text-color','#ddd')`);
  await evaluate(`new Promise(resolve=>setTimeout(resolve,350))`);
  assert.equal(
    await evaluate(`getComputedStyle(iconNode).color`),
    "rgb(221, 221, 221)",
    "theme variables update without a render",
  );
  await evaluate(`iconFixture.remove()`);
}

async function verifyStateIconParity(evaluate, darkTheme) {
  await evaluate(`(async()=>{
    if(!customElements.get('state-badge')){const helpers=await window.loadCardHelpers();helpers.createCardElement({type:'entities',entities:[]});}
    await Promise.race([customElements.whenDefined('state-badge'),new Promise((_,reject)=>setTimeout(()=>reject(Error('reference badge did not load')),8000))]);
    window.iconParity=document.createElement('section');iconParity.style.cssText='position:fixed;inset:70px 0 auto;z-index:10050;max-height:calc(100vh - 80px);overflow:auto;box-sizing:border-box;background:var(--card-background-color);display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;padding:12px';
    document.body.append(iconParity);window.iconSamples=${JSON.stringify(entities)};
    const componentResources=${JSON.stringify(resources)};
    window.iconRequests=[];
    const request=async message=>{iconRequests.push(message);return {resources:message.category==='entity_component'?componentResources:{fixture:{sensor:{demo:{default:'mdi:thermometer',range:{0:'mdi:snowflake',25:'mdi:fire'}}}}}};};
    const connection={haVersion:'2026.9.4',sendMessagePromise:request};
    window.iconContext={connection,config:{components:[...Object.keys(componentResources),'fixture']},entities:{},callWS:request,hassUrl:url=>url};
    iconContext.entities[iconSamples.at(-1).entity_id]={platform:'fixture',translation_key:'demo'};
    iconParity.addEventListener('context-request',event=>{
      const values={hassConfig:iconContext,hassConnection:iconContext,entities:iconContext.entities};
      if(event.context in values){event.stopPropagation();event.callback(values[event.context]);}
    });
    for(const state of iconSamples){const pair=document.createElement('div');pair.className='qap-state-icon';pair.style.cssText='display:flex;gap:12px;width:auto;justify-content:center';
      const reference=document.createElement('state-badge');reference.className='qap-icon';reference.stateColor=true;reference.stateObj=state;
      const owned=document.createElement('qap-state-icon');owned.className='qap-icon';owned.hass=iconContext;owned.stateObj=state;
      pair.append(reference,owned);iconParity.append(pair);}
    await Promise.all([...iconParity.querySelectorAll('state-badge,qap-state-icon')].map(icon=>icon.updateComplete));
    await new Promise(resolve=>setTimeout(resolve,400));
  })()`);
  const original = await evaluate(`document.documentElement.style.cssText`);
  try {
    for (const [themeName, theme] of [
      ["light", {}],
      ["dark", darkTheme],
      [
        "custom",
        {
          "state-icon-color": "#123456",
          "state-active-color": "#f23456",
          "state-light-on-color": "#abc123",
          "state-binary_sensor-door-on-color": "#456789",
          "state-climate-heat-color": "#bc1234",
          "state-unavailable-color": "#556677",
          "state-inactive-color": "#ff0000",
        },
      ],
    ]) {
      await evaluate(
        `document.documentElement.style.cssText=${JSON.stringify(original)};for(const [key,value]of Object.entries(${JSON.stringify(theme)}))document.documentElement.style.setProperty('--'+key,value);`,
      );
      const samples = await evaluate(`(async()=>{
        await new Promise(resolve=>setTimeout(resolve,350));
        return [...iconParity.children].map((pair,index)=>{
          const [reference,owned]=pair.children,refIcon=reference.shadowRoot.querySelector('ha-state-icon'),ownIcon=owned.shadowRoot.querySelector('ha-icon');
          const measure=(host,icon)=>{const css=getComputedStyle(icon),rect=host.getBoundingClientRect();return {color:css.color,filter:css.filter,width:rect.width,height:rect.height,pulse:css.animationName!=='none'};};
          return {state:iconSamples[index],reference:refIcon?measure(reference,refIcon):null,owned:ownIcon.hidden?null:measure(owned,ownIcon),
            referenceIcon:refIcon?.shadowRoot.querySelector('ha-icon')?.icon,ownedIcon:ownIcon.icon,
            picture:reference.style.backgroundImage,ownedPicture:owned.shadowRoot.querySelector('.picture')?.style.backgroundImage};
        });
      })()`);
      for (const sample of samples) {
        assert.deepEqual(
          sample.owned,
          sample.reference,
          `HA state icon appearance ${JSON.stringify(sample)}`,
        );
        if (sample.reference)
          assert.equal(
            sample.ownedIcon,
            sample.referenceIcon,
            `HA icon resolution ${JSON.stringify(sample)}`,
          );
        else assert.equal(sample.ownedPicture, sample.picture, "entity picture parity");
      }
    }
    await evaluate(`(async()=>{
      const pair=iconParity.firstElementChild;window.originalParityIcon=pair.lastElementChild.shadowRoot.querySelector('ha-icon');
      for(const state of [{entity_id:'light.icon_0',state:'on',attributes:{rgb_color:[0,255,0],brightness:1}},
        {entity_id:'light.icon_0',state:'unavailable',attributes:{}},{entity_id:'light.icon_0',state:'off',attributes:{icon:'mdi:desk-lamp'}}]){
        pair.firstElementChild.stateObj=pair.lastElementChild.stateObj=state;
        await Promise.all([...pair.children].map(icon=>icon.updateComplete));
      }
    })()`);
    assert.equal(
      await evaluate(
        `iconParity.firstElementChild.lastElementChild.shadowRoot.querySelector('ha-icon')===originalParityIcon`,
      ),
      true,
    );
  } finally {
    await evaluate(
      `document.documentElement.style.cssText=${JSON.stringify(original)};iconParity.remove();`,
    );
  }
}

module.exports = { verifyStateIcon, verifyStateIconParity };
