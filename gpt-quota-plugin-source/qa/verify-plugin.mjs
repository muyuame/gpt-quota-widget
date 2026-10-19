import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginVersion = JSON.parse(fs.readFileSync(path.join(root, 'plugins/gpt-quota-widget/.codex-plugin/plugin.json'), 'utf8')).version;
const installed = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'plugins', 'cache', 'gpt-quota-local', 'gpt-quota-widget', pluginVersion);
function rpc(executable, args, env = process.env, cwd = root) {
  const proc = spawn(executable, args, { cwd, windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let counter = 0;
  proc.stderr.resume();
  const lines = readline.createInterface({ input: proc.stdout });
  lines.on('line', line => {
    let packet; try { packet = JSON.parse(line); } catch { return; }
    const entry = pending.get(packet.id); if (!entry) return;
    pending.delete(packet.id); clearTimeout(entry.timer);
    packet.error ? entry.reject(Error(JSON.stringify(packet.error))) : entry.resolve(packet.result);
  });
  proc.on('error', failure => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(failure); } pending.clear(); });
  return {
    request(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++counter;
        const timer = setTimeout(() => { pending.delete(id); reject(Error('Timeout: ' + method)); }, 60000);
        pending.set(id, { resolve, reject, timer });
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }) + '\n');
      });
    },
    notify(method) { proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'); },
    close() { proc.stdin.end(); proc.kill(); lines.close(); for (const entry of pending.values()) clearTimeout(entry.timer); }
  };
}
const report = {};
if (process.argv.includes('--host')) {
  const executable = execFileSync('where.exe', ['codex.exe'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).find(file => fs.existsSync(file));
  const host = rpc(executable, ['app-server', '--listen', 'stdio://']);
  try {
    await host.request('initialize', { clientInfo: { name: 'gpt_quota_plugin_verify', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    host.notify('initialized');
    const skills = await host.request('skills/list', { cwds: [path.dirname(root)], forceReload: true });
    report.skills = skills.data.flatMap(entry => entry.skills || []).filter(skill => (skill.path || '').includes('gpt-quota-widget') || skill.name.includes('quota-widget'));
    assert.equal(report.skills.length, 1, 'Codex must discover the installed skill');
    const servers = await host.request('mcpServerStatus/list', {});
    report.servers = servers.data.filter(server => server.name.includes('gpt') || Object.keys(server.tools || {}).some(name => name.includes('quota_widget')));
    assert.equal(report.servers.length, 1, 'Codex must connect to plugin MCP');
    const names = Object.keys(report.servers[0].tools || {});
    assert.equal(names.length, 4, 'Codex must load all four tools');
    report.servers = report.servers.map(server => ({ name: server.name, tools: Object.keys(server.tools), authStatus: server.authStatus }));
    console.log('Codex host discovered skill and four MCP tools.');
  } finally { host.close(); }
} else {
  const config = JSON.parse(fs.readFileSync(path.join(installed, '.mcp.json'), 'utf8')).mcpServers.gpt_quota_widget;
  const client = rpc(config.command, config.args, { ...process.env, ...config.env }, path.resolve(installed, config.cwd || '.'));
  const call = async (name, args = {}) => {
    const result = await client.request('tools/call', { name, arguments: args });
    assert.equal(result.isError, false, result.content?.[0]?.text);
    return result.structuredContent;
  };
  try {
    await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verify', version: '1' } });
    client.notify('notifications/initialized');
    assert.equal((await client.request('tools/list')).tools.length, 4);
    report.before = await call('quota_widget_status');
    console.log('Installed MCP initialized and status read.');
    if (process.argv.includes('--controls')) {
      report.stop = await call('quota_widget_stop');
      assert.equal(report.stop.running, false); assert.equal(report.stop.monitoring, false);
      console.log('Stop verified.');
      report.quotaWhileStopped = await call('quota_read', { refresh: true });
      assert.equal(report.quotaWhileStopped.subscription.available, true, 'Official quota query must work');
      const stillStopped = await call('quota_widget_status');
      assert.equal(stillStopped.running, false); assert.equal(stillStopped.monitoring, false);
      console.log('Quota query while stopped verified without opening window.');
      report.start = await call('quota_widget_start', report.before.mode ? { mode: report.before.mode } : {});
      assert.equal(report.start.running || report.start.monitoring, true);
      console.log('Start verified; existing display mode restored.');
    }
    report.quota = await call('quota_read', { refresh: true });
    assert.equal(report.quota.subscription.available, true, 'Official quota query must work');
    console.log('Official quota read verified.');
  } finally { client.close(); }
}
fs.writeFileSync(path.join(root, 'qa', process.argv.includes('--host') ? 'host-result.json' : 'controls-result.json'), JSON.stringify(report, null, 2));
