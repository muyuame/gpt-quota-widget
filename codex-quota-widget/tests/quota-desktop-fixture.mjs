import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { makeFixture as baseFixture } from './desktop-fixture.mjs';
import { assertHeadUnobstructed } from './head-hit-regression.mjs';
const pause = ms => new Promise(r => setTimeout(r, ms));
const quotaFixture = { delay: 0, usedPercent: 12, fail: false };
let lastQuota = null;
export async function makeFixture(dataDir) {
  const options = await baseFixture(dataDir);
  fs.writeFileSync(path.join(dataDir, 'display-mode.json'), JSON.stringify({ mode: 'subscription' }));
  fs.writeFileSync(path.join(dataDir, 'ui-state.json'), JSON.stringify({ 'dshw-account-view': 'subscription' }));
  options.quotaService = {
    peek() { return lastQuota; },
    async get() {
      const { delay, usedPercent, fail } = quotaFixture;
      if (delay) await pause(delay);
      if (fail) throw Error('simulated offline');
      return lastQuota = { available: true, source: 'fixture', observedAt: Date.now(), windows: [
      { id: 'codex:primary', limitId: 'codex', usedPercent, windowDurationMins: 300, resetsAt: Date.now() + 3600000 },
      { id: 'codex:secondary', limitId: 'codex', usedPercent: 2, windowDurationMins: 10080, resetsAt: Date.now() + 86400000 },
    ] }; }, close() {},
  };
  return options;
}
export async function verifyDesktop({ app, window, screen, setHost, setTestCursor, dispatcher, dataDir, errors, renderInfo }) {
  const output = process.env.WHALE_DESKTOP_VERIFY_DIR;
  fs.mkdirSync(output, { recursive: true });
  const ev = code => window.webContents.executeJavaScript(code);
  const checks = [];
  const wait = async (code, title, timeout = 8000) => {
    const at = Date.now();
    while (Date.now() - at < timeout) { if (await ev(code)) return; await pause(60); }
    throw Error('Timed out: ' + title);
  };
  const area = screen.getPrimaryDisplay().workArea;
  await setHost({ hostAlive: true, hostPid: 123456, window: '0', visible: true, attached: true,
    bounds: screen.dipToScreenRect(null, { x: area.x + 30, y: area.y + 30, width: 950, height: 700 }) });
  const ignore = window.setIgnoreMouseEvents.bind(window);
  window.setIgnoreMouseEvents = () => ignore(true, { forward: false });
  ignore(true, { forward: false });
  const click = async (x, y) => {
    window.focus(); setTestCursor({ x, y });
    window.webContents.sendInputEvent({ type: 'mouseMove', x, y }); await pause(80);
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x, y }); await pause(100);
    const transform = await ev("document.querySelector('.dshwv-body').style.transform");
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x, y }); await pause(300);
    return transform;
  };
  const clickBubble = async () => {
    const p = await ev("(()=>{const r=document.querySelector('.quota-inside').getBoundingClientRect();return {x:Math.round(r.x+r.width*.5),y:Math.round(r.y+r.height*.5)}})()");
    await click(p.x,p.y);
  };
  try {
    await wait("document.querySelector('.dshwv-img')?.naturalWidth === 1052", 'user image'); checks.push('user AVIF rendered with original alpha as PNG');
    await wait("document.querySelectorAll('.quota-value').length === 2", 'quota bubble');
    assert.deepEqual(await ev("[...document.querySelectorAll('.quota-value')].map(e=>e.textContent)"), ['88%', '98%']); checks.push('remaining quota in both windows');
    assert.equal(await ev("WhaleAccountView.mode"), 'subscription'); checks.push('subscription selected on first launch');
    const initialScale = await ev("document.querySelector('.dshwv-range').value");
    const scaling = [];
    for (const scale of [.6, 1, 1.8, 2.5]) {
      await ev(`(()=>{const input=document.querySelector('.dshwv-range');input.value='${scale}';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await pause(450);
      const layout = await ev("(()=>{const r=document.querySelector('.dshwv-root').getBoundingClientRect(),b=document.querySelector('.whale-account-card').getBoundingClientRect(),p=document.querySelector('.dshwv-pop').getBoundingClientRect(),a=document.querySelector('.dshwv-img').getBoundingClientRect();return {root:r.toJSON(),bubble:b.toJSON(),original:p.toJSON(),image:a.toJSON(),heading:parseFloat(getComputedStyle(document.querySelector('.whale-account-header strong')).fontSize),label:parseFloat(getComputedStyle(document.querySelector('.quota-row span')).fontSize),number:parseFloat(getComputedStyle(document.querySelector('.quota-value')).fontSize)}})()");
      for (const key of ['left','top','width','height']) assert.ok(Math.abs(layout.bubble[key]-layout.original[key])<1, `scale ${scale} ${key}: ${JSON.stringify(layout)}`);
      assert.ok(Math.abs(layout.heading-layout.root.width*66/1026)<.1);
      assert.ok(Math.abs(layout.label-layout.root.width*52/1026)<.1);
      assert.ok(Math.abs(layout.number-layout.root.width*128/1026)<.1);
      await assertHeadUnobstructed(ev,click,'scale '+scale);
      scaling.push({scale,...layout});
      const viewport = {x:Math.max(0,Math.floor(layout.root.left-16)),y:Math.max(0,Math.floor(layout.root.top-16)),width:Math.ceil(layout.root.width+32),height:Math.ceil(layout.root.height+32)};
      fs.writeFileSync(path.join(output,`widget-scale-${scale}.png`),(await window.webContents.capturePage(viewport)).toPNG());
    }
    await ev(`(()=>{const input=document.querySelector('.dshwv-range');input.value='${initialScale}';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await pause(450);
    checks.push('bubble silhouette, origin, labels and numbers scale with the original pet stage at 0.6 / 1 / 1.8 / 2.5');
    const effect = await ev("(()=>{const s=getComputedStyle(document.querySelector('.quota-value'));return {animation:s.animationName,background:s.backgroundImage,position:s.backgroundPosition}})()");
    assert.equal(effect.animation,'quota-number-flow');
    assert.match(effect.background,/linear-gradient/);
    await pause(400);
    assert.notEqual(await ev("getComputedStyle(document.querySelector('.quota-value')).backgroundPosition"),effect.position);
    assert.equal(await ev("getComputedStyle(document.querySelectorAll('.quota-value')[1]).animationName"),'none');
    checks.push('only the main remaining percentage has a moving purple gradient');
    const point = await ev("(()=>{const r=document.querySelector('.dshwv-img').getBoundingClientRect();return {x:Math.round(r.x+r.width*.5),y:Math.round(r.y+r.height*.62)}})()");
    const pressed = await click(point.x, point.y);
    assert.ok(pressed.includes('scale'), pressed); checks.push('original press squash');
    assert.equal(await ev("!!document.querySelector('.whale-account-card')"), true);
    assert.deepEqual(await ev("[...document.querySelectorAll('.quota-value')].map(e=>e.textContent)"), ['88%', '98%']);
    await clickBubble();
    assert.ok((await ev("document.querySelector('.quota-random-content')?.textContent"))?.trim());
    await click(point.x, point.y);
    assert.equal(await ev("!!document.querySelector('.quota-random-content')"), true);
    await clickBubble();
    assert.equal(await ev("!!document.querySelector('.whale-account-card')"), false); checks.push('character keeps quota open; first bubble click shows phrase; second bubble click closes');
    quotaFixture.delay = 1300; quotaFixture.usedPercent = 10;
    await ev("WhaleAccountView.toggleBubble(document)");
    assert.deepEqual(await ev("[...document.querySelectorAll('.quota-value')].map(e=>e.textContent)"), ['88%', '98%']);
    assert.equal(await ev("document.querySelector('.quota-update-status').textContent"), '更新中');
    checks.push('slow refresh immediately displays cached percentages and updating indicator');
    await wait("document.querySelector('.quota-value')?.textContent === '90%'", 'fresh quota replaces cache');
    assert.equal(await ev("document.querySelector('.quota-update-status').textContent"), '');
    checks.push('new snapshot replaces old values and removes updating indicator');
    quotaFixture.delay = 100; quotaFixture.fail = true;
    await ev("WhaleAccountView.refresh(true)");
    assert.deepEqual(await ev("[...document.querySelectorAll('.quota-value')].map(e=>e.textContent)"), ['90%', '98%']);
    assert.equal(await ev("document.querySelector('.quota-update-status').textContent"), '更新失败');
    checks.push('failed refresh preserves the last percentages');
    quotaFixture.delay = 0; quotaFixture.fail = false; quotaFixture.usedPercent = 12;
    await ev("WhaleAccountView.refresh(true)");
    // Hover the painted body, then click the real refresh control in its visible area.
    const bodyPoint=await ev("(()=>{const r=document.querySelector('.quota-inside').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
    setTestCursor(bodyPoint);window.webContents.sendInputEvent({type:'mouseMove',...bodyPoint});await pause(100);
    const refreshPoint=await ev("(()=>{const e=document.querySelector('.quota-actions button'),r=e.getBoundingClientRect(),p={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};return {...p,isButton:document.elementFromPoint(p.x,p.y)===e,nativeHit:__whaleInputTest.hit(p)}})()");
    assert.equal(refreshPoint.isButton,true,'visible refresh button remains clickable');assert.equal(refreshPoint.nativeHit,true);
    quotaFixture.usedPercent=14;await click(refreshPoint.x,refreshPoint.y);
    await wait("document.querySelector('.quota-value')?.textContent==='86%'",'refresh control fetches the next snapshot');
    quotaFixture.usedPercent=12;await ev("WhaleAccountView.refresh(true)");
    checks.push('manual refresh button remains clickable inside the painted bubble');
    quotaFixture.delay = 1100;
    await ev("window.__randomRefresh=WhaleAccountView.refresh(true); true");
    await clickBubble();
    const firstPhrase = await ev("document.querySelector('.quota-random-content').textContent");
    assert.ok(firstPhrase.trim());
    assert.ok(!/鲸|大肥鱼|DeepSleep|dsh/i.test(firstPhrase),firstPhrase);
    assert.equal(await ev("!!document.querySelector('.quota-random-content .dshwv-trow')"),true);
    await ev("window.__randomRefresh");
    assert.equal(await ev("document.querySelector('.quota-random-content').textContent"),firstPhrase);
    await assertHeadUnobstructed(ev,click,'random phrase');
    checks.push('head clicks through transparent bubble bounds without advancing or closing a phrase');
    const randomViewport = await ev("(()=>{const a=document.querySelector('.dshwv-img').getBoundingClientRect(),b=document.querySelector('.whale-account-card').getBoundingClientRect();return {x:Math.max(0,Math.floor(Math.min(a.left,b.left)-16)),y:Math.max(0,Math.floor(Math.min(a.top,b.top)-16)),width:Math.ceil(Math.max(a.right,b.right)-Math.min(a.left,b.left)+16),height:Math.ceil(Math.max(a.bottom,b.bottom)-Math.min(a.top,b.top)+16)}})()");
    window.webContents.invalidate();await pause(60);
    fs.writeFileSync(path.join(output,'random-bubble-preview.png'),(await window.webContents.capturePage(randomViewport)).toPNG());
    await click(point.x, point.y);
    assert.equal(await ev("document.querySelector('.quota-random-content').textContent"),firstPhrase);
    await clickBubble(); assert.equal(await ev("!!document.querySelector('.whale-account-card')"),false);
    checks.push('bubble opens a stable random phrase, late quota refresh does not replace it, second bubble click closes');
    quotaFixture.delay = 0;
    await click(point.x,point.y);
    assert.deepEqual(await ev("[...document.querySelectorAll('.quota-value')].map(e=>e.textContent)"), ['88%', '98%']);
    await clickBubble();
    const secondPhrase = await ev("document.querySelector('.quota-random-content').textContent");
    assert.notEqual(secondPhrase,firstPhrase);
    await clickBubble();await ev("WhaleAccountView.toggleBubble(document)");
    await wait("document.querySelector('.quota-value')?.textContent === '88%'",'normal quota restored after random');
    checks.push('new character opening shows quota and first bubble click picks a different phrase');
    await pause(450);
    const nearby = await ev("(()=>{const a=document.querySelector('.dshwv-img').getBoundingClientRect(),b=document.querySelector('.whale-account-card').getBoundingClientRect(),r=document.querySelector('.dshwv-root').getBoundingClientRect();return {overlap:b.bottom-a.top,target:r.width*(700/1026-.4055)}})()");
    assert.ok(Math.abs(nearby.overlap-nearby.target)<1, JSON.stringify(nearby));
    checks.push('thought bubble sits beside the top of the character');
    await ev("WhaleDashboard.refresh(true)");
    assert.deepEqual(await ev("[...document.querySelectorAll('.whale-quota-box strong')].map(e=>e.textContent)"), ['剩余 88.0%', '剩余 98.0%']); checks.push('dashboard quota and reset detail');
    assert.deepEqual(await ev("[...document.querySelectorAll('.whale-quota-box strong')].map(e=>getComputedStyle(e).color)"), ['rgb(52, 75, 148)','rgb(52, 75, 148)']);
    window.focus(); setTestCursor(point);
    window.webContents.sendInputEvent({type:'mouseMove', ...point}); await pause(80);
    window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    for(let n=1;n<=15;n++) {
      const x=Math.round(point.x+(25-point.x)*n/15);setTestCursor({x,y:point.y});
      window.webContents.sendInputEvent({type:'mouseMove',x,y:point.y});await pause(16);
    }
    window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:25,y:point.y});
    await wait("document.querySelector('.dshwv-root').classList.contains('dshwv-left')", 'left snap');
    await wait("document.querySelector('.whale-account-card').classList.contains('quota-left')", 'mirrored bubble');
    const mirrored = await ev("(()=>{const r=document.querySelector('.dshwv-root').getBoundingClientRect(),b=document.querySelector('.whale-account-card').getBoundingClientRect(),i=document.querySelector('.quota-inside').getBoundingClientRect();return {root:r.toJSON(),bubble:b.toJSON(),inside:i.toJSON()}})()");
    assert.ok(Math.abs(mirrored.bubble.left-mirrored.root.left)<1);
    assert.ok(Math.abs(mirrored.bubble.width-mirrored.root.width)<1);
    assert.ok(Math.abs((mirrored.inside.left+mirrored.inside.width/2-mirrored.bubble.left)/mirrored.bubble.width-.5575)<.01);
    await pause(450); // Let the drag-release squash settle before sampling head pixels.
    await assertHeadUnobstructed(ev,click,'left mirror');
    checks.push('drag snaps left and mirrors character and thought bubble; mirrored head remains clickable');
    await ev("window.dispatchEvent(new Event('whale-reset-position'))");await pause(600);
    // Exercise the real backend tracker -> local route -> automatic UI poll.
    const settingsFile = path.join(dataDir, '.dshw-size.json');
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    fs.writeFileSync(settingsFile, JSON.stringify({ ...settings, turnCostOn: true, turnCostCloseMs: 300 }));
    await ev("WhaleAccountView.close()");
    const meta = { id: 'fixture:quota-round', outcome: 'completed', notify: true, ts: Date.now() };
    dispatcher.quotaTurns.begin(meta);
    quotaFixture.usedPercent = 16; quotaFixture.delay = 850;
    const complete = dispatcher.quotaTurns.end(meta);
    await ev("WhaleAccountView.pollQuotaTurns()");
    await wait("!!document.querySelector('.whale-account-card')", 'auto bubble');
    assert.equal(await ev("document.querySelector('.quota-update-status').textContent"), '更新中');
    await pause(350);
    assert.equal(await ev("!!document.querySelector('.whale-account-card')"), true);
    checks.push('completion automatically opens a bubble and waits for the fresh reading');
    await complete; await ev("WhaleAccountView.pollQuotaTurns()");
    assert.deepEqual(await ev("[...document.querySelectorAll('.quota-turn-value')].map(e=>e.textContent)"), ['4%','0%']);
    assert.deepEqual(await ev("[...document.querySelectorAll('.quota-turn-value')].map(e=>getComputedStyle(e).color)"), ['rgb(158, 75, 80)','rgb(158, 75, 80)']);
    assert.deepEqual(await ev("[...document.querySelectorAll('.quota-turn-value')].map(e=>getComputedStyle(e).animationName)"), ['none','none']);
    assert.equal(await ev("document.querySelector('.whale-account-header strong').textContent"), '本轮消耗（观测）');
    window.webContents.invalidate();
    await ev("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await pause(60);
    const turnViewport = await ev("(()=>{const a=document.querySelector('.dshwv-img').getBoundingClientRect(),b=document.querySelector('.whale-account-card').getBoundingClientRect();return {x:Math.max(0,Math.floor(Math.min(a.left,b.left)-16)),y:Math.max(0,Math.floor(Math.min(a.top,b.top)-16)),width:Math.ceil(Math.max(a.right,b.right)-Math.min(a.left,b.left)+16),height:Math.ceil(Math.max(a.bottom,b.bottom)-Math.min(a.top,b.top)+16)}})()");
    fs.writeFileSync(path.join(output, 'quota-turn-preview.png'), (await window.webContents.capturePage(turnViewport)).toPNG());
    await wait("!document.querySelector('.whale-account-card')", 'auto close after the final reading');
    checks.push('measured percentage-point consumption replaces updating and automatically closes');
    await ev("WhaleAccountView.pollQuotaTurns()");
    assert.equal(await ev("!!document.querySelector('.whale-account-card')"), false);
    checks.push('the completed round never replays on subsequent polls');
    await ev("WhaleAccountView.showTurn({id:'fixture:clicked-turn',phase:'updating',completedAt:Date.now(),windows:[]},300)");
    await clickBubble();
    const turnPhrase = await ev("document.querySelector('.quota-random-content').textContent");
    await ev("WhaleAccountView.showTurn({id:'fixture:clicked-turn',phase:'complete',windows:[{percentagePoints:4,windowDurationMins:300}]},300)");
    await pause(400);
    assert.equal(await ev("document.querySelector('.quota-random-content').textContent"),turnPhrase);
    await clickBubble();
    assert.equal(await ev("!!document.querySelector('.whale-account-card')"),false);
    checks.push('consumption bubble switches to phrase, then closes on the next bubble click');
    await ev("WhaleAccountView.showTurn({id:'fixture:head-outline',phase:'complete',windows:[{percentagePoints:4,windowDurationMins:300},{percentagePoints:0,windowDurationMins:10080}]},0)");
    await pause(450); await assertHeadUnobstructed(ev,click,'consumption');
    await clickBubble(); await clickBubble();
    checks.push('consumption head clicks leave the current bubble unchanged');
    quotaFixture.usedPercent = 12; quotaFixture.delay = 0;
    fs.writeFileSync(settingsFile, JSON.stringify(settings));
    await ev("WhaleAccountView.toggleBubble(document)");
    await wait("document.querySelector('.quota-value')?.textContent === '88%'", 'normal quota restored');
    assert.equal(await ev("getComputedStyle(document.querySelector('.quota-value')).animationName"), 'quota-number-flow');
    assert.equal(await ev("getComputedStyle(document.querySelectorAll('.quota-value')[1]).color"), 'rgb(103, 65, 140)');
    await pause(500);
    const viewport = await ev("(()=>{const a=document.querySelector('.dshwv-img').getBoundingClientRect(),b=document.querySelector('.whale-account-card').getBoundingClientRect();return {x:Math.floor(Math.min(a.left,b.left)-20),y:Math.floor(Math.min(a.top,b.top)-20),width:Math.ceil(Math.max(a.right,b.right)-Math.min(a.left,b.left)+40),height:Math.ceil(Math.max(a.bottom,b.bottom)-Math.min(a.top,b.top)+40)}})()");
    fs.writeFileSync(path.join(output, 'widget-preview.png'), (await window.webContents.capturePage(viewport)).toPNG());
    const snapshot = await ev("({body:document.body.innerText,card:document.querySelector('.whale-account-card').getBoundingClientRect().toJSON(),image:document.querySelector('.dshwv-img').getBoundingClientRect().toJSON()})");
    assert.equal(errors.length, 0, errors.join('\n'));
    fs.writeFileSync(path.join(output, 'quota-desktop.json'), JSON.stringify({ ok: true, checks, errors, snapshot, scaling, rendering: renderInfo() }, null, 2));
    app.quit();
  } catch (error) {
    fs.writeFileSync(path.join(output, 'quota-desktop.json'), JSON.stringify({ ok: false, checks, error: error.stack, errors }, null, 2));
    app.exit(1);
  }
}
