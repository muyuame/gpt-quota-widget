import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, tools } from '../runtime/mcp.mjs';

const message = (method, params) => ({ jsonrpc: '2.0', id: 1, method, params });
test('MCP discovery never launches or reads quota', async () => {
  const forbidden = new Proxy({}, { get() { throw Error('discovery changed state'); } });
  const initialized = await handle(message('initialize', { protocolVersion: '2025-06-18' }), forbidden);
  assert.equal(initialized.result.serverInfo.name, 'gpt-quota-widget');
  const list = await handle(message('tools/list'), forbidden);
  assert.equal(list.result.tools.length, 4);
  assert.equal(tools[0].annotations.readOnlyHint, true);
  assert.equal(tools[2].annotations.readOnlyHint, false);
});
test('tools dispatch exact typed parameters and return observed state', async () => {
  const calls = [];
  const controller = Object.fromEntries(['read', 'status', 'start', 'stop'].map(action => [action, async args => {
    calls.push([action, args]); return { ok: true, running: action === 'start' };
  }]));
  for (const [name, args] of [['quota_read', { refresh: true }], ['quota_widget_status', {}], ['quota_widget_start', { mode: 'standalone' }], ['quota_widget_stop', {}]]) {
    const result = await handle(message('tools/call', { name, arguments: args }), controller);
    assert.equal(result.result.isError, false);
    assert.deepEqual(JSON.parse(result.result.content[0].text), result.result.structuredContent);
  }
  assert.deepEqual(calls, [['read', { refresh: true }], ['status', {}], ['start', { mode: 'standalone' }], ['stop', {}]]);
});
test('invalid parameters cannot reach controller', async () => {
  const forbidden = new Proxy({}, { get() { throw Error('invalid arguments dispatched'); } });
  for (const params of [{ name: 'quota_read', arguments: { refresh: 'true' } }, { name: 'quota_widget_start', arguments: { mode: 'invalid' } }, { name: 'quota_widget_stop', arguments: { force: true } }, { name: 'unknown' }]) {
    const result = await handle(message('tools/call', params), forbidden);
    assert.equal(result.error.code, -32602);
  }
});
test('operational failure is a tool error and notifications have no response', async () => {
  const result = await handle(message('tools/call', { name: 'quota_widget_stop' }), { stop() { throw Error('未完成'); } });
  assert.equal(result.result.isError, true);
  assert.equal(result.result.content[0].text, '未完成');
  assert.equal(await handle({ method: 'notifications/initialized' }, {}), null);
});
