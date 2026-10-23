import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(import.meta.dirname, '..');
const serverPath = path.join(root, 'dist', 'server.mjs');

const child = spawn(process.execPath, [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env },
});

let buf = '';
const pending = new Map();
let id = 0;

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  }
});

let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (c) => { stderr += c; });

function send(method, params) {
  const msgId = ++id;
  const payload = { jsonrpc: '2.0', id: msgId, method, params };
  child.stdin.write(JSON.stringify(payload) + '\n');
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject });
    setTimeout(() => {
      if (pending.has(msgId)) {
        pending.delete(msgId);
        reject(new Error(`timeout: ${method}`));
      }
    }, 30000);
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

try {
  const init = await send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: { experimental: { 'zcode/widgetState': {} } },
    clientInfo: { name: 'task-digest-smoke', version: '0.1.0' },
  });
  check('initialize', !!init.serverInfo, init.serverInfo?.name + ' ' + init.serverInfo?.version);
  notify('notifications/initialized', {});

  const tools = await send('tools/list', {});
  const names = (tools.tools || []).map((t) => t.name);
  check('tools/list', names.includes('open_digest') && names.includes('digest_snapshot') && names.includes('digest_task_detail') && names.includes('digest_workspaces'), names.join(', '));

  const openMeta = (tools.tools || []).find((t) => t.name === 'open_digest');
  check('open_digest ui meta', !!openMeta?._meta?.ui?.resourceUri, openMeta?._meta?.ui?.resourceUri);

  const snap = await send('tools/call', { name: 'digest_snapshot', arguments: { range: 'all', limit: 5 } });
  const snapData = snap.structuredContent || JSON.parse(snap.content?.[0]?.text || '{}');
  check('digest_snapshot', !!snapData.totals && Array.isArray(snapData.tasks),
    `tasks=${snapData.totals?.tasks} tokens=${snapData.totals?.tokens} rows=${snapData.tasks?.length}`);
  check('snapshot 有真实数据', (snapData.totals?.toolCalls || 0) > 0 && (snapData.trend || []).length > 0,
    `trend=${snapData.trend?.length}天 tools=${snapData.totals?.toolCalls}`);
  const titles = (snapData.tasks || []).map((t) => t.title || '').join('\n');
  const leaked = /(fc[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{8,}|sk-[A-Za-z0-9_-]{16,})/.test(titles);
  check('标题脱敏', !leaked, leaked ? '发现疑似明文凭据' : '无明文密钥');

  const firstId = snapData.tasks?.[0]?.id;
  const detail = await send('tools/call', { name: 'digest_task_detail', arguments: { task_id: firstId } });
  const detailData = detail.structuredContent || JSON.parse(detail.content?.[0]?.text || '{}');
  check('digest_task_detail', !!detailData.title, `${detailData.title?.slice(0, 20)}… tools=${detailData.tools?.length} todo=${detailData.todoTotal}`);

  const roll = await send('tools/call', { name: 'digest_workspaces', arguments: { range: 'all', limit: 3 } });
  const rollData = roll.structuredContent || JSON.parse(roll.content?.[0]?.text || '{}');
  check('digest_workspaces', Array.isArray(rollData.workspaces) && rollData.workspaces.length > 0, `${rollData.workspaces?.length} 个工作区`);

  const resList = await send('resources/list', {});
  const uris = (resList.resources || []).map((r) => r.uri);
  check('resources/list', uris.includes('ui://task-digest/panel.html'), uris.join(', '));

  const resRead = await send('resources/read', { uri: 'ui://task-digest/panel.html' });
  const html = resRead.contents?.[0]?.text || '';
  check('resources/read', html.length > 1000, `${(html.length / 1024).toFixed(0)} KB`);
  check('panel 无外链资源', !/<script[^>]+src=|<link[^>]+href=/.test(html), '全部内联');
  check('panel 体积 < 4MiB', html.length < 4 * 1024 * 1024, (html.length / 1024).toFixed(0) + ' KB');

  const bad = await send('tools/call', { name: 'digest_task_detail', arguments: { task_id: 'nope' } });
  check('未知任务返回错误', bad.isError === true, JSON.stringify(bad.content?.[0]?.text));
} catch (err) {
  check('smoke run', false, err.message);
} finally {
  child.stdin.end();
  child.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (stderr.trim()) console.log('stderr:', stderr.slice(0, 400));
process.exit(failed.length ? 1 : 0);
