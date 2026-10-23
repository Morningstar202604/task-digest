import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function loadPlaywright() {
  const roots = [];
  try {
    roots.push(execSync('npm root -g', { encoding: 'utf8' }).trim() + '/@playwright/mcp/');
  } catch {}
  roots.push(new URL('.', import.meta.url).pathname);
  for (const root of roots) {
    try {
      return createRequire(root)('playwright');
    } catch {}
  }
  throw new Error('未找到 playwright：请先 npm i -g @playwright/mcp（或本地安装 playwright）');
}
const { chromium } = loadPlaywright();

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'dist', 'panel.html'), 'utf8');
const outDir = process.argv[2] || path.join(root, '..', '.preview');
fs.mkdirSync(outDir, { recursive: true });

const child = spawn(process.execPath, [path.join(root, 'dist', 'server.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map();
let rpcId = 0;
child.stdout.setEncoding('utf8');
child.stdout.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.id != null && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  }
});
function rpc(method, params) {
  const id = ++rpcId;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((res, rej) => {
    pending.set(id, { resolve: res, reject: rej });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('rpc timeout ' + method)); } }, 20000);
  });
}
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'host-sim', version: '1' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

const log = [];
for (const theme of ['light', 'dark']) {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 560, height: 900 }, deviceScaleFactor: 2, colorScheme: theme });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.exposeFunction('__hostRpc', async (method, params) => {
    if (method === 'tools/call') {
      const r = await rpc('tools/call', params);
      return r;
    }
    if (method === 'resources/read') return rpc('resources/read', params);
    if (method === 'resources/list') return rpc('resources/list', params);
    throw new Error('unsupported ' + method);
  });

  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:${theme === 'dark' ? '#0d0e10' : '#f6f6f8'}}</style></head><body></body></html>`);

  await page.evaluate(({ html, theme }) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
    document.body.appendChild(frame);
    frame.srcdoc = html;

    window.addEventListener('message', async (ev) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return;
      const reply = (result) => frame.contentWindow.postMessage({ jsonrpc: '2.0', id: msg.id, result }, '*');
      const fail = (message) => frame.contentWindow.postMessage({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message } }, '*');

      if (msg.method === 'ui/initialize') {
        reply({
          protocolVersion: msg.params?.protocolVersion || '2025-11-21',
          hostInfo: { name: 'ZCode-HostSim', version: '0.17.0' },
          hostCapabilities: { serverTools: { listChanged: false }, serverResources: { listChanged: false } },
          hostContext: { theme, locale: 'zh-CN', platform: 'desktop', displayMode: 'inline' },
        });
        return;
      }
      if (msg.method === 'ui/notifications/initialized' || msg.method === 'ui/notifications/size-changed') return;
      if (msg.id != null && msg.method) {
        try {
          const result = await window.__hostRpc(msg.method, msg.params);
          reply(result);
        } catch (err) {
          fail(String(err && err.message ? err.message : err));
        }
      }
    });
  }, { html, theme });

  const frameHandle = page.frames()[1];
  await page.waitForTimeout(4000);

  const metrics = await frameHandle.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const rows = [...document.querySelectorAll('#tdigest-rows .row')];
    return {
      metricValues: [...document.querySelectorAll('#tdigest-metrics .v')].map((e) => e.textContent.trim()),
      bars: document.querySelectorAll('#tdigest-bars .bar').length,
      barHeights: [...document.querySelectorAll('#tdigest-bars .bar')].map((b) => b.style.height),
      rows: rows.length,
      firstRow: rows[0] ? rows[0].innerText.replace(/\n/g, ' | ') : null,
      peak: q('#tdigest-peak')?.textContent,
      range: q('#tdigest-from')?.textContent + ' → ' + q('#tdigest-to')?.textContent,
      error: q('.err')?.textContent || null,
      dotStyle: (() => { const d = document.querySelector('.dot'); if (!d) return null; const cs = getComputedStyle(d); return { cls: d.className, w: cs.width, h: cs.height, bg: cs.backgroundColor, flex: cs.flex }; })(),
      theme: document.documentElement.getAttribute('data-theme'),
      bodyH: Math.ceil(document.body.scrollHeight),
    };
  });
  log.push({ theme, ...metrics, errors });

  await page.screenshot({ path: path.join(outDir, `panel-${theme}.png`), fullPage: true });

  await frameHandle.evaluate(() => document.querySelector('#tdigest-rows .row')?.click());
  await page.waitForTimeout(1800);
  const detail = await frameHandle.evaluate(() => {
    const q = (s) => document.querySelector(s);
    return {
      view: q('#tdigest-panel')?.dataset.view,
      title: q('#tdigest-dtitle')?.textContent,
      kv: [...document.querySelectorAll('#tdigest-kv .v')].map((e) => e.textContent),
      tools: document.querySelectorAll('#tdigest-tools .tl-row').length,
      todos: document.querySelectorAll('#tdigest-todos label').length,
    };
  });
  log.push({ theme, detail });
  await page.screenshot({ path: path.join(outDir, `panel-${theme}-detail.png`), fullPage: true });

  await frameHandle.evaluate(() => document.querySelector('.seg button[data-range="today"]')?.click());
  await page.waitForTimeout(2000);
  const today = await frameHandle.evaluate(() => ({
    metrics: [...document.querySelectorAll('#tdigest-metrics .v')].map((e) => e.textContent.trim()),
    rows: document.querySelectorAll('#tdigest-rows .row').length,
    pressed: document.querySelector('.seg button[aria-pressed="true"]')?.dataset.range,
  }));
  log.push({ theme, today });

  await browser.close();
}

child.stdin.end();
child.kill();
console.log(JSON.stringify(log, null, 1));
