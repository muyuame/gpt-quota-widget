import test from 'node:test';
import assert from 'node:assert/strict';
import { quotaDifference, createQuotaTurnTracker } from '../runtime/quota-turns.mjs';
const now = 1000000;
const snapshot = (used, extra = {}) => ({ available: true, observedAt: now,
  windows: [{ id: 'codex:primary', label: '5 小时额度', windowDurationMins: 300,
    usedPercent: used, remainingPercent: 100 - used, resetsAt: now + 3600000, ...extra }] });
test('round quota is measured in percentage points and unchanged is not invented consumption', () => {
  assert.equal(quotaDifference(snapshot(10), snapshot(13))[0].percentagePoints, 3);
  assert.equal(quotaDifference(snapshot(10), snapshot(10))[0].state, 'unchanged');
  assert.equal(quotaDifference(snapshot(10), snapshot(10))[0].percentagePoints, 0);
  assert.equal(quotaDifference(snapshot(10.2), snapshot(10.5))[0].percentagePoints, .3);
});
test('unknown, stale, reset and changed counters never become a spurious round cost', () => {
  for (const [a,b] of [[null,snapshot(12)], [snapshot(10),snapshot(12,{stale:true})],
    [snapshot(10),snapshot(2)], [snapshot(10),snapshot(12,{resetsAt:now+7200000})],
    [snapshot(10),{available:false,windows:[]}]]) {
    assert.equal(quotaDifference(a,b)[0].percentagePoints,null);
  }
});
test('successful turn publishes updating immediately then its measured change, once', async () => {
  let resolve, calls = 0;
  const quota = { peek:()=>snapshot(10), identity:()=> 'same', get() { calls++; return new Promise(r=>{resolve=r;}); } };
  const tracker=createQuotaTurnTracker(quota,{clock:()=>now});
  const meta={id:'session:turn',outcome:'completed',notify:true,ts:now};
  tracker.begin(meta); const job=tracker.end(meta);
  assert.equal(tracker.read().records[0].phase,'updating');
  await new Promise(r=>setImmediate(r)); resolve(snapshot(12)); await job;
  const record=tracker.read().records[0];
  assert.equal(record.phase,'complete'); assert.equal(record.windows[0].percentagePoints,2);
  await tracker.end(meta); assert.equal(calls,1); assert.equal(tracker.read(record.seq).records.length,0);
  tracker.close();
});
test('subagent/history/cancelled turns do not show a successful-round quota bubble', async () => {
  const tracker=createQuotaTurnTracker({get:async()=>snapshot(1)},{clock:()=>now});
  for (const meta of [{id:'child',isSubagent:true,outcome:'completed'}, {id:'history',historical:true,outcome:'completed'},
    {id:'cancel',outcome:'aborted'}, {id:'fail',outcome:'failed'}]) { tracker.begin(meta); await tracker.end(meta); }
  assert.equal(tracker.read().records.length,0); tracker.close();
});
test('short turns use a second fresh RPC after the start snapshot settles', async () => {
  let resolveStart; const calls=[];
  const tracker=createQuotaTurnTracker({get(){calls.push(1);return calls.length===1?new Promise(r=>{resolveStart=r;}):Promise.resolve(snapshot(14));}},{clock:()=>now});
  const meta={id:'short',outcome:'completed',notify:true,ts:now};tracker.begin(meta);const job=tracker.end(meta);
  await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);
  resolveStart(snapshot(10));await job;assert.equal(calls.length,2);
  assert.equal(tracker.read().records[0].windows[0].percentagePoints,4);tracker.close();
});
test('account changes invalidate the baseline, and parallel work is labelled as interval change', async () => {
  let identity='first';const quota={peek:()=>snapshot(10),identity:()=>identity,get:async()=>snapshot(12)};
  const tracker=createQuotaTurnTracker(quota,{clock:()=>now});
  tracker.begin({id:'A'});tracker.begin({id:'B'});await tracker.end({id:'A',outcome:'completed',ts:now});
  assert.equal(tracker.read().records[0].concurrent,true);
  identity='second';await tracker.end({id:'B',outcome:'completed',ts:now});
  assert.equal(tracker.read().records[1].windows[0].percentagePoints,null);tracker.close();
});
