import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Official read-only app-server RPC. No credential is read or returned here.
export function normalizeRateLimits(result, now = Date.now()) {
  const buckets = result?.rateLimitsByLimitId;
  const entries = buckets && Object.keys(buckets).length
    ? Object.entries(buckets) : result?.rateLimits ? [[result.rateLimits.limitId || 'codex', result.rateLimits]] : [];
  const windows = [];
  for (const [id, bucket] of entries) {
    for (const slot of ['primary', 'secondary']) {
      const item = bucket?.[slot];
      if (!item || typeof item.usedPercent !== 'number' || !Number.isFinite(item.usedPercent) || item.usedPercent < 0) continue;
      const minutes = typeof item.windowDurationMins === 'number' ? item.windowDurationMins : null;
      const resetsAt = typeof item.resetsAt === 'number' && Number.isFinite(item.resetsAt) ? item.resetsAt * 1000 : null;
      windows.push({ id: `${id}:${slot}`, limitId: id, limitName: bucket.limitName || null,
        label: minutes === 300 ? '5 小时额度' : minutes === 10080 ? '每周额度' : minutes ? `${minutes >= 60 ? minutes / 60 + ' 小时' : minutes + ' 分钟'}额度` : '额度窗口',
        usedPercent: item.usedPercent, remainingPercent: Math.max(0, Math.min(100, 100 - item.usedPercent)),
        windowDurationMins: minutes, resetsAt, observedAt: now, stale: resetsAt !== null && resetsAt <= now });
    }
  }
  return { available: windows.length > 0, windows, observedAt: windows.length ? now : null,
    source: 'app-server', reason: windows.length ? '来自 Codex 官方额度接口' : '当前登录方式未提供订阅额度，请在 Codex 中使用 ChatGPT 账号登录。' };
}

export function createQuotaService({ codexHome, binary = process.env.CODEX_QUOTA_CLI, spawnImpl = spawn,
  clock = Date.now, ttlMs = 60000, timeoutMs = 20000 } = {}) {
  let cache = null, pending = null, child = null, closed = false, identity = '';
  const authStamp = () => {
    try { const stat = fs.statSync(path.join(codexHome, 'auth.json')); return `${stat.mtimeMs}:${stat.size}`; } catch { return ''; }
  };
  async function resolveBinary() {
    if (binary) return binary;
    if (process.platform !== 'win32') return 'codex';
    try {
      const found = await promisify(execFile)('where.exe', ['codex.exe'], { windowsHide: true, timeout: 3000 });
      const candidate = found.stdout.trim().split(/\r?\n/).find(file => fs.existsSync(file));
      if (candidate) return candidate;
    } catch { /* Login tasks do not inherit Codex's process PATH. */ }
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const installDir = path.join(localAppData, 'OpenAI', 'Codex', 'bin');
    try {
      const candidates = fs.readdirSync(installDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(installDir, entry.name, 'codex.exe'))
        .filter(file => fs.existsSync(file))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (candidates.length) return candidates[0];
    } catch { /* No local Codex installation is available. */ }
    throw Error('cli-unavailable');
  }
  async function readRpc() {
    const executable = await resolveBinary();
    if (closed) throw Error('closed');
    return new Promise((resolve, reject) => {
      const proc = child = spawnImpl(executable, ['app-server', '--listen', 'stdio://'], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        env: { ...process.env, ...(codexHome ? { CODEX_HOME: codexHome } : {}) },
      });
      let buffer = '', settled = false;
      const finish = (error, value) => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (child === proc) child = null;
        proc.stdin.end(); proc.kill(); error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(() => finish(Error('rpc-timeout')), timeoutMs);
      const send = packet => proc.stdin.write(JSON.stringify(packet) + '\n');
      proc.on('error', () => finish(Error('cli-unavailable')));
      proc.on('exit', () => finish(Error('rpc-exited')));
      proc.stdin.on('error', () => finish(Error('rpc-unavailable')));
      proc.stderr.resume(); // Never copy diagnostics or credentials into the UI/log.
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', bytes => {
        buffer += bytes.toString('utf8');
        if (buffer.length > 2 * 1024 * 1024) { finish(Error('rpc-oversized')); return; }
        let end;
        while ((end = buffer.indexOf('\n')) >= 0 && !settled) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          let packet; try { packet = JSON.parse(line); } catch { continue; }
          if (packet.id === 1) {
            if (packet.error) { finish(Error('rpc-initialize')); return; }
            send({ method: 'initialized' });
            send({ id: 2, method: 'account/rateLimits/read' });
          } else if (packet.id === 2) {
            finish(packet.error ? Error('quota-unavailable') : null, packet.result);
          }
        }
      });
      send({ id: 1, method: 'initialize', params: {
        clientInfo: { name: 'codex_quota_widget', title: 'Codex 额度挂件', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      } });
    });
  }
  async function get({ force = false } = {}) {
    if (closed) return { available: false, windows: [], reason: '挂件已停止' };
    const stamp = authStamp();
    if (identity !== stamp) { identity = stamp; cache = null; }
    if (!force && cache && clock() - cache.fetchedAt < ttlMs) return cache.value;
    if (pending) return pending;
    pending = (async () => {
      try {
        const result = await readRpc();
        if (closed || authStamp() !== stamp) { cache = null; return { available: false, windows: [], reason: '登录状态已更新，请刷新额度。' }; }
        const value = normalizeRateLimits(result, clock());
        cache = { fetchedAt: clock(), value }; return value;
      } catch {
        const value = cache && authStamp() === stamp && cache.value.available
          ? { ...cache.value, windows: cache.value.windows.map(w => ({ ...w, stale: true })), reason: '暂时无法刷新，显示上次成功读取的额度。' }
          : { available: false, windows: [], observedAt: null, source: 'app-server', reason: '暂时无法读取额度，请确认 Codex 已使用 ChatGPT 账号登录后刷新。' };
        cache = { fetchedAt: clock(), value }; return value;
      }
    })().finally(() => { pending = null; });
    return pending;
  }
  return { get, identity: authStamp,
    peek() { return cache && identity === authStamp() ? cache.value : null; },
    close() { closed = true; child?.kill(); child = null; cache = null; } };
}
