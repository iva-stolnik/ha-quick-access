const assert = require("node:assert/strict");

async function verifyItemFeedback({ evaluate }) {
  const waitFor = (expression) =>
    evaluate(`new Promise((resolve,reject)=>{const start=performance.now();function check(){
    if(${expression})return resolve();if(performance.now()-start>3000)return reject(new Error('Feedback destination did not render'));requestAnimationFrame(check);}check();})`);
  const click = async (selector) => {
    await waitFor(`document.querySelector(${JSON.stringify(selector)})`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const check = async (id, scroller) => {
    await waitFor(
      `document.querySelector('.qap-drop-highlight')?.dataset.id===${JSON.stringify(id)}`,
    );
    const result =
      await evaluate(`(async()=>{const row=document.querySelector('.qap-drop-highlight'),scroller=document.querySelector(${JSON.stringify(scroller)});
      await Promise.allSettled(row.getAnimations().map(animation=>animation.finished));
      const r=row.getBoundingClientRect(),b=scroller.getBoundingClientRect(),probe=document.createElement('span');probe.style.color='var(--qap-blue)';row.append(probe);
      const accent=getComputedStyle(probe).color;probe.remove();return {visible:r.top>=b.top-1&&r.bottom<=b.bottom+1,
        accent:getComputedStyle(row).borderTopColor===accent,scroll:window.scrollY,role:row.getAttribute('role')};})()`);
    assert.equal(result.visible, true, id + " is inside its Quick Access scroller");
    assert.equal(result.accent, true, id + " uses the theme accent border");
    assert.equal(result.scroll, originalScroll, "reveal must preserve the HA document scroll");
    assert.equal(result.role, null, "management rows retain independent actions");
  };
  const originalScroll = await evaluate("window.scrollY");
  await click(".qap-head-button");
  await evaluate(`window.feedbackProfiles=structuredClone(window.testProfiles.profiles);
    (()=>{const p=window.testProfiles.profiles[0];p.categories=[{id:'favorites',name:'Favorites'},{id:'feedback-tools',name:'Tools'}];
      p.settings.links=Array.from({length:50},(_,i)=>({...p.settings.links[0],id:'feedback-'+i,name:'Shortcut '+i,group:'feedback-tools'}));window.publishProfiles();})()`);
  await click(".qap-settings-shortcuts");
  try {
    await click(".qap-shortcut-overflow");
    await click(".qap-duplicate-shortcut");
    await waitFor("window.testProfiles.profiles[0].settings.links.length===51");
    const shortcutId = await evaluate("window.testProfiles.profiles[0].settings.links.at(-1).id");
    await check(shortcutId, ".qap-body");
    assert.equal(
      await evaluate("document.querySelector('.qap-pagination .qap-count').textContent"),
      "Page 2 of 2",
    );
    await click(".qap-head-button");
    await click(".qap-settings-categories");
    await click(".qap-create-category");
    await evaluate(
      `(()=>{const field=document.querySelector('.qap-category-form qap-input');field.value='Feedback group';field.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await click(".qap-category-submit");
    await waitFor(
      "window.testProfiles.profiles[0].categories.some(category=>category.name==='Feedback group')",
    );
    await check(
      await evaluate(
        "window.testProfiles.profiles[0].categories.find(category=>category.name==='Feedback group').id",
      ),
      ".qap-category-browser",
    );
    await click(".qap-head-button");
    await click(".qap-settings-profiles");
    await click(".qap-create-profile");
    await evaluate(
      `(()=>{const field=document.querySelector('.qap-profile-form qap-input');field.value='Feedback profile';field.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await click(".qap-profile-submit");
    await waitFor(
      "document.querySelector('.qap-current-profile strong')?.textContent==='Feedback profile'",
    );
    const profileId = await evaluate(
      "window.testProfiles.profiles.find(profile=>profile.name==='Feedback profile').id",
    );
    await check(profileId, ".qap-body");
    assert.equal(
      await evaluate(
        "document.querySelector('.qap-drop-highlight').classList.contains('qap-edit-item')",
      ),
      true,
    );
    const originalId = await evaluate("window.feedbackProfiles[0].id");
    await click(`.qap-profile-list [data-id="${originalId}"] .qap-profile-activate`);
    assert.equal(await evaluate("!!document.querySelector('.qap-drop-highlight')"), false);
    await click(".qap-head-button");
  } finally {
    await evaluate(
      "window.testProfiles.profiles=window.feedbackProfiles;delete window.feedbackProfiles;window.publishProfiles()",
    );
    await click(".qap-settings-shortcuts");
  }
}

module.exports = { verifyItemFeedback };
