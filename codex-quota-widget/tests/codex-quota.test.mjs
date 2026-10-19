import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { normalizeRateLimits, createQuotaService } from '../runtime/codex-quota.mjs';

const snapshot = { rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: {
  codex: { primary: { usedPercent: 9, windowDurationMins: 300, resetsAt: 2000 }, secondary: { usedPercent: 1, windowDurationMins: 10080, resetsAt: 3000 } },
  other: { limitName: '独立额度', primary: { usedPercent: 40, windowDurationMins: 60, resetsAt: 2100 } },
} };
test('official multi-bucket windows and reset seconds retain their meaning', () => {
  const data = normalizeRateLimits(snapshot, 1000000);
  assert.deepEqual(data.windows.map(w => w.remainingPercent), [91, 99, 60]);
  assert.equal(data.windows[0].resetsAt, 2000000);
  assert.equal(data.windows[1].label, '每周额度');
  assert.equal(data.windows[2].limitName, '独立额度');
});
test('missing values remain unavailable and over-limit percentages clamp to zero', () => {
  for (const usedPercent of [null, undefined, '2', NaN, Infinity, -1]) assert.equal(normalizeRateLimits({ rateLimits: { primary: { usedPercent } } }).available, false);
  assert.equal(normalizeRateLimits({ rateLimits: { primary: { usedPercent: 105 } } }).windows[0].remainingPercent, 0);
  assert.equal(normalizeRateLimits({ rateLimits: { primary: { usedPercent: 0, resetsAt: 1000 } } }, 1000001).windows[0].stale, true);
});
function rpcMock({ fail = () => false } = {}) {
  let starts = 0, kills = 0;
  const methods = [];
  return { get starts() { return starts; }, get kills() { return kills; }, methods,
    spawn() {
      starts++;
      const p = new EventEmitter(); p.stdin = new PassThrough(); p.stdout = new PassThrough(); p.stderr = new PassThrough();
      p.kill = () => { kills++; queueMicrotask(() => p.emit('exit', 0)); };
      p.stdin.on('data', chunk => {
        for (const line of chunk.toString().trim().split('\n')) {
          const packet = JSON.parse(line); methods.push(packet.method);
          if (packet.method === 'initialize') queueMicrotask(() => p.stdout.write('{"id":1,"result":{}}\n'));
          if (packet.method === 'account/rateLimits/read') queueMicrotask(() => p.stdout.write(JSON.stringify({ id: 2, ...(fail() ? { error: { message: 'private diagnostic' } } : { result: snapshot }) }) + '\n'));
        }
      }); return p;
    },
  };
}
test('parallel UI refreshes share one read-only RPC, then use the TTL cache', async () => {
  const mock = rpcMock(); const service = createQuotaService({ binary: 'test-only', spawnImpl: () => mock.spawn(), clock: () => 1000000 });
  const [a, b] = await Promise.all([service.get(), service.get()]);
  assert.deepEqual(a, b); assert.equal(a.available, true); assert.equal(mock.starts, 1); assert.equal(mock.kills, 1);
  await service.get(); assert.equal(mock.starts, 1);
  assert.deepEqual(mock.methods, ['initialize', 'initialized', 'account/rateLimits/read']); service.close();
});
test('a failed refresh marks the last observation stale and hides diagnostics', async () => {
  let failed = false; const mock = rpcMock({ fail: () => failed });
  const service = createQuotaService({ binary: 'test-only', spawnImpl: () => mock.spawn(), clock: () => 1000000 });
  await service.get(); failed = true;
  const result = await service.get({ force: true });
  assert.equal(result.available, true); assert.ok(result.windows.every(w => w.stale));
  assert.ok(!JSON.stringify(result).includes('private diagnostic')); service.close();
  assert.equal((await service.get()).available, false);
});
