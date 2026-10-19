import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionMonitor } from '../runtime/session-monitor.mjs';
import { createQuotaTurnTracker } from '../runtime/quota-turns.mjs';

test('a live session worker start/end drives the quota completion tracker', async t => {
  const codexHome=fs.mkdtempSync(path.join(os.tmpdir(),'quota-worker-'));
  const sessions=path.join(codexHome,'sessions');fs.mkdirSync(sessions);
  const file=path.join(sessions,'rollout-fixture.jsonl');
  fs.writeFileSync(file,JSON.stringify({type:'session_meta',payload:{id:'quota-root',source:'vscode'}})+'\n');
  let used=10;
  const sample=()=>({available:true,observedAt:Date.now(),windows:[{id:'codex:primary',usedPercent:used,remainingPercent:100-used,windowDurationMins:300,resetsAt:Date.now()+3600000}]});
  const tracker=createQuotaTurnTracker({peek:sample,get:async()=>sample()});
  const service={config:{codexHome,resolve:()=>({model:'fixture',setting:{monitorSessions:true}})},turns:new Map(),
    beginTurn(meta){this.turns.set(meta.id,meta);},updateTurn(){},async finishTurn(meta){this.turns.delete(meta.id);}};
  const monitor=new SessionMonitor(service,{intervalMs:25,discoverMs:25,onStart:meta=>tracker.begin(meta),onEnd:meta=>tracker.end(meta)});
  t.after(async()=>{await monitor.stop();tracker.close();fs.rmSync(codexHome,{recursive:true,force:true});});
  const wait=async condition=>{const at=Date.now();while(Date.now()-at<5000){if(condition())return;await new Promise(r=>setTimeout(r,20));}throw Error('worker timeout');};
  monitor.start();await wait(()=>monitor.snapshot.initializing===false);
  const write=(type)=>fs.appendFileSync(file,JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload:{type,turn_id:'round-A'}})+'\n');
  write('task_started');await wait(()=>service.turns.size===1);
  used=13;write('task_complete');
  await wait(()=>tracker.read().records.some(r=>r.phase==='complete'));
  const record=tracker.read().records[0];
  assert.equal(record.id,'quota-root:round-A');assert.equal(record.windows[0].percentagePoints,3);
  write('task_complete');await new Promise(r=>setTimeout(r,70));
  assert.equal(tracker.read().records.length,1);
});
