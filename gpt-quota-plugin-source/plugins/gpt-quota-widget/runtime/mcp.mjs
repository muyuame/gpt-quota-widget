import readline from 'node:readline';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createController } from './controller.mjs';

const version = JSON.parse(fs.readFileSync(new URL('../.codex-plugin/plugin.json', import.meta.url), 'utf8')).version;
const schema = properties => ({ type: 'object', properties, additionalProperties: false });
const annotations = readOnlyHint => ({ readOnlyHint, destructiveHint: false, openWorldHint: false, idempotentHint: true });
export const tools = [
  { name: 'quota_read', description: '读取当前 Codex 官方剩余额度百分比，包含 5 小时和每周窗口及更新时间。不会启动人物窗口，也不会返回登录凭据。', inputSchema: schema({ refresh: { type: 'boolean', description: '立即刷新官方额度；默认可复用近期缓存。' } }), annotations: annotations(true) },
  { name: 'quota_widget_status', description: '查询 GPT 额度挂件是否运行、显示以及是否正在等待 Codex 窗口。', inputSchema: schema({}), annotations: annotations(true) },
  { name: 'quota_widget_start', description: '启动或重新显示本机 GPT 额度挂件，保留现有人物、气泡和设置。省略 mode 时保留当前显示模式。', inputSchema: schema({ mode: { type: 'string', enum: ['follow-codex', 'standalone'], description: '跟随 Codex 窗口或独立桌面显示。' } }), annotations: annotations(false) },
  { name: 'quota_widget_stop', description: '关闭 GPT 额度挂件并停止其后台监控进程，可随时重新启动。', inputSchema: schema({}), annotations: annotations(false) }
];

function validArgs(spec, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  return Object.entries(args).every(([key, value]) => {
    const property = spec.inputSchema.properties[key];
    return property && typeof value === property.type && (!property.enum || property.enum.includes(value));
  });
}
export async function handle(message, controller) {
  const { id, method, params = {} } = message;
  if (id === undefined) return null;
  const reply = result => ({ jsonrpc: '2.0', id, result });
  const error = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (method === 'initialize') return reply({ protocolVersion: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'].includes(params.protocolVersion) ? params.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'gpt-quota-widget', version } });
  if (method === 'ping') return reply({});
  if (method === 'tools/list') return reply({ tools });
  if (method === 'resources/list') return reply({ resources: [] });
  if (method === 'resources/templates/list') return reply({ resourceTemplates: [] });
  if (method !== 'tools/call') return error(-32601, 'Method not found');
  const spec = tools.find(tool => tool.name === params.name), args = params.arguments ?? {};
  if (!spec || !validArgs(spec, args)) return error(-32602, '未知工具或参数无效');
  try {
    const action = { quota_read: 'read', quota_widget_status: 'status', quota_widget_start: 'start', quota_widget_stop: 'stop' }[params.name];
    const output = await controller[action](args);
    return reply({ content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output, isError: output.ok === false });
  } catch (failure) {
    return reply({ content: [{ type: 'text', text: failure.message || '挂件操作失败。' }], isError: true });
  }
}

function serve() {
  const controller = createController();
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const send = value => { if (value) process.stdout.write(JSON.stringify(value) + '\n'); };
  input.on('line', async line => {
    let message;
    try { message = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') { send({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid request' } }); return; }
    try { send(await handle(message, controller)); }
    catch { send({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32603, message: '挂件操作失败。' } }); }
  });
  // Discovery/initialization is side-effect free. Closing Codex's MCP client does
  // not terminate an explicitly started widget.
  input.on('close', () => { controller.close(); process.exit(0); });
  process.on('SIGTERM', () => { controller.close(); process.exit(0); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serve();
