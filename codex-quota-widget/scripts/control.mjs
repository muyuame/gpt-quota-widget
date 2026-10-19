import { ensureService, serviceRequest, runningService, launchDesktop } from '../runtime/process.mjs';
import { DATA_HOME } from '../runtime/paths.mjs';

const command = process.argv[2] || 'open';
try {
  let result;
  if (command === 'open') result = await launchDesktop();
  else if (command === 'desktop') result = await launchDesktop({ mode: 'standalone' });
  else if (command === 'follow') result = await launchDesktop({ mode: 'follow-codex' });
  else if (command === 'reset-position') { await ensureService(); result = await serviceRequest('/api/reset-position', {method:'POST',body:{}}); }
  else if (command === 'balance') result = await serviceRequest('/dsh-whale/balance.json' + (process.argv.includes('--refresh') ? '?refresh=1' : ''));
  else if (command === 'usage') result = await serviceRequest('/dsh-whale/usage-records.json');
  else if (command === 'status') result = await serviceRequest('/api/status');
  else if (command === 'restore') result = await serviceRequest('/api/show', { method: 'POST' });
  else if (command === 'mode-desktop' || command === 'mode-follow') result = await serviceRequest('/api/desktop-mode', { method: 'POST', body: { mode: command === 'mode-desktop' ? 'standalone' : 'follow-codex' } });
  else if (command === 'quota') result = await serviceRequest('/api/quota' + (process.argv.includes('--refresh') ? '?refresh=1' : ''), { timeoutMs: 30000 });
  else if (command === 'stop') { const running = await runningService(DATA_HOME); result = running ? await serviceRequest('/api/stop', { method: 'POST', body: {} }) : { ok: true, stopped: true }; }
  else throw new Error('支持 open、desktop、follow、reset-position、balance、usage、status、stop');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.ok === false) process.exitCode = 1;
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
