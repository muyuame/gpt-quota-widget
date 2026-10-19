import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createController({ root = process.env.GPT_QUOTA_WIDGET_ROOT } = {}) {
  let modules, quota, writes = Promise.resolve();
  const widgetRoot = root ? path.resolve(root) : null;
  const dataDir = widgetRoot && path.join(widgetRoot, 'data');
  async function load() {
    if (!widgetRoot || !fs.existsSync(path.join(widgetRoot, 'scripts', 'start-quota.ps1'))) {
      throw new Error('找不到现有挂件安装，请检查插件的 GPT_QUOTA_WIDGET_ROOT 配置。');
    }
    modules ||= Promise.all(['bridge.mjs', 'codex-quota.mjs'].map(file => import(pathToFileURL(path.join(widgetRoot, 'runtime', file)).href)));
    return modules;
  }
  function monitorRunning() {
    try {
      const state = JSON.parse(fs.readFileSync(path.join(dataDir, 'supervisor-state.json'), 'utf8').replace(/^\uFEFF/, ''));
      if (!Number.isInteger(state.pid) || state.pid <= 0) return false;
      process.kill(state.pid, 0);
      return true;
    } catch { return false; }
  }
  async function snapshot() {
    const [bridge] = await load();
    let status;
    try { status = await bridge.bridgeRequest('/api/status', { dataDir, timeoutMs: 1500 }); } catch {}
    const running = status?.ok === true, monitoring = monitorRunning();
    return {
      ok: true, running, monitoring,
      visible: running && status.visible === true,
      mode: running ? status.desktopMode : null,
      ready: running && status.rendererReady === true,
      message: running ? (status.visible ? '挂件正在显示。' : '挂件正在运行；跟随模式会在 Codex 窗口不可见或最小化时隐藏。')
        : monitoring ? '挂件监控已启动，正在等待可用的 Codex 窗口。' : '挂件已停止。'
    };
  }
  async function powershell(args) {
    if (process.platform !== 'win32') throw new Error('此本地定制插件需要 Windows。');
    await load();
    try {
      await run(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(widgetRoot, 'scripts', 'start-quota.ps1'), ...args],
        { windowsHide: true, cwd: widgetRoot, timeout: 45000, maxBuffer: 256 * 1024 });
    } catch { throw new Error('挂件启动或停止脚本未完成，请检查本机挂件安装。'); }
  }
  function serialize(action) {
    const current = writes.then(action);
    writes = current.catch(() => {});
    return current;
  }
  return {
    status: snapshot,
    async read({ refresh = false } = {}) {
      const [bridge, { createQuotaService }] = await load();
      try {
        const result = await bridge.bridgeRequest('/api/quota' + (refresh ? '?refresh=1' : ''), { dataDir, timeoutMs: 30000 });
        if (result.ok && result.subscription) return result;
      } catch {}
      // Querying quota while the widget is stopped must not open the overlay.
      quota ||= createQuotaService({ codexHome: process.env.CODEX_HOME || path.join(os.homedir(), '.codex') });
      return { ok: true, subscription: await quota.get({ force: refresh }) };
    },
    start({ mode } = {}) {
      return serialize(async () => {
        await powershell(mode === 'standalone' ? ['-Desktop'] : []);
        const [bridge] = await load();
        let status = await snapshot();
        if (mode && status.running) {
          const result = await bridge.bridgeRequest('/api/desktop-mode', { dataDir, method: 'POST', body: { mode } });
          if (!result.ok) throw new Error('挂件显示模式切换失败。');
          status = await snapshot();
        }
        if (!status.running && !status.monitoring) throw new Error('挂件未成功启动。');
        return status;
      });
    },
    stop() {
      return serialize(async () => {
        await powershell(['-Stop']);
        for (let i = 0; i < 50; i++) {
          const status = await snapshot();
          if (!status.running && !status.monitoring) return { ...status, stopped: true };
          await delay(200);
        }
        throw new Error('挂件还未完全退出，请稍后检查状态。');
      });
    },
    close() { quota?.close(); }
  };
}
