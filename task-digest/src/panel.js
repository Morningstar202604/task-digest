import { App, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';

async function boot() {
const app = new App({ name: 'task-digest-panel', version: '0.1.0' }, {});
const root = document.getElementById('tdigest-root');
const panel = document.getElementById('tdigest-panel');

const state = {
  range: 'all',
  data: null,
  detail: null,
  view: 'overview',
  loading: true,
  error: '',
};

function fmtTok(v) {
  if (!v) return '0';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e8 ? 0 : 1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(v);
}
function fmtMinor(v) {
  if (!v) return '0';
  return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v);
}
function fmtDur(ms) {
  if (!ms) return '—';
  if (ms < 1000) return Math.round(ms) + 'ms';
  if (ms < 60000) return Math.round(ms / 1000) + 's';
  const h = ms / 3600000;
  if (h >= 1) return Math.round(h) + 'h';
  return Math.round(ms / 60000) + 'm';
}
function fmtDay(d) {
  if (!d) return '';
  const parts = String(d).split('-');
  return parts.length === 3 ? parts[1] + '-' + parts[2] : d;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function statusOf(t) {
  if (t.status === 'completed') return 's-ok';
  if (t.status === 'error' || t.status === 'failed' || t.status === 'interrupted') return 's-warn';
  return 's-idle';
}
function statusText(t) {
  if (t.status === 'completed') return '已完成';
  if (t.status === 'error') return '出错或中断';
  if (t.status === 'interrupted') return '已中断';
  return '状态未知';
}

function render() {
  panel.dataset.view = state.view;
  if (state.view === 'detail') return renderDetail();

  if (state.loading && !state.data) {
    root.querySelector('#tdigest-body').innerHTML = '<div class="empty"><div class="skeleton" style="height:11px;width:42%;margin:0 auto 10px"></div><div class="skeleton" style="height:11px;width:62%;margin:0 auto"></div></div>';
    return;
  }
  if (state.error) {
    root.querySelector('#tdigest-body').innerHTML = '<div class="banner">' + esc(state.error) + '</div>';
    return;
  }

  const d = state.data;
  const t = d.totals;
  root.querySelector('#tdigest-metrics').innerHTML = [
    ['任务', t.tasks, ''],
    ['Token', fmtTok(t.tokens).replace(/[A-Z]/g, ''), fmtTok(t.tokens).slice(-1)],
    ['工具', fmtMinor(t.toolCalls).replace(/k$/, ''), t.toolCalls >= 1000 ? 'k' : ''],
    ['成功率', t.successRate.toFixed(1), '%'],
  ].map((x) => '<div class="metric"><div class="k">' + x[0] + '</div><div class="v">' + x[1] + (x[2] ? '<small>' + x[2] + '</small>' : '') + '</div></div>').join('');

  const trend = d.trend || [];
  const max = Math.max(1, ...trend.map((x) => x.tokens));
  root.querySelector('#tdigest-bars').innerHTML = trend.map((x, i) => {
    const h = Math.max(3, Math.round((x.tokens / max) * 52));
    const on = i === trend.length - 1 ? ' is-on' : '';
    return '<div class="bar' + on + '" style="height:' + h + 'px" data-tooltip="' + esc(fmtDay(x.day)) + ' · ' + fmtTok(x.tokens) + ' · ' + x.requests + ' 次请求"></div>';
  }).join('');
  const peak = trend.length ? trend.reduce((a, b) => (b.tokens > a.tokens ? b : a)) : { tokens: 0 };
  root.querySelector('#tdigest-peak').textContent = '峰值 ' + fmtTok(peak.tokens) + ' / 日';
  root.querySelector('#tdigest-from').textContent = trend.length ? fmtDay(trend[0].day) : '';
  root.querySelector('#tdigest-to').textContent = trend.length ? fmtDay(trend[trend.length - 1].day) : '';

  const tasks = d.tasks || [];
  root.querySelector('#tdigest-count').textContent = tasks.length + ' / ' + t.tasks + ' 条';
  root.querySelector('#tdigest-rows').innerHTML = tasks.length
    ? tasks.map((x, i) => {
        const todo = x.todoTotal
          ? '<span class="todo"><span class="track"><i style="width:' + Math.round(x.todoDone / x.todoTotal * 100) + '%"></i></span><span>' + x.todoDone + '/' + x.todoTotal + '</span></span>'
          : '';
        return '<button type="button" class="row" data-idx="' + i + '">' +
          '<span class="r1"><span class="dot ' + statusOf(x) + '" data-tooltip="' + esc(statusText(x)) + '"></span><span class="t">' + esc(x.title) + '</span>' +
          '<span class="tok">' + fmtTok(x.tokens) + '</span></span>' +
          '<span class="r2"><span class="ws">' + esc(x.workspace) + '</span><span class="sep">·</span>' +
          '<span class="mode">' + esc(x.mode) + '</span><span>' + fmtMinor(x.toolCalls) + ' 工具</span>' +
          '<span class="sep">·</span><span>' + fmtDur(x.activeMs) + '</span>' + todo + '</span></button>';
      }).join('')
    : '<div class="empty">该时间范围内没有任务</div>';

  root.querySelectorAll('#tdigest-rows .row').forEach((btn) => {
    btn.addEventListener('click', () => openDetail(tasks[Number(btn.dataset.idx)].id));
  });

  root.querySelector('.foot .muted').textContent = 'tasks-index · session · 只读';
  root.querySelector('.foot code').textContent = new Date(d.generatedAt).toLocaleTimeString('zh-CN', { hour12: false });
}

function renderDetail() {
  const d = state.detail;
  if (!d) return;
  root.querySelector('#tdigest-dtitle').textContent = d.title;
  root.querySelector('#tdigest-dsub').textContent = d.workspace + ' · ' + d.mode + ' · ' + fmtDay(new Date(d.createdAt).toISOString().slice(0, 10)) + ' → ' + fmtDay(new Date(d.updatedAt).toISOString().slice(0, 10));
  root.querySelector('#tdigest-kv').innerHTML = [
    ['耗时', fmtDur(d.activeMs)],
    ['Token', fmtTok(d.tokens)],
    ['请求', String(d.requests)],
    ['工具', String(d.toolCalls)],
    ['成功率', d.toolCalls ? ((d.toolOk / d.toolCalls) * 100).toFixed(1) + '%' : '—'],
    ['待办', d.todoDone + ' / ' + d.todoTotal],
  ].map((p) => '<div><div class="k">' + p[0] + '</div><div class="v">' + p[1] + '</div></div>').join('');

  const tools = d.tools || [];
  root.querySelector('#tdigest-tools').innerHTML = tools.length
    ? tools.slice(0, 8).map((t) => '<div class="tl-row"><span class="tl-rail"><i></i><s></s></span><span class="tl-body">' +
        '<span class="tl-txt">' + esc(t.name) + '</span><span class="tl-meta">' + t.calls + ' 次 · ' + fmtDur(t.ms) + '</span></span></div>').join('')
    : '<div class="empty" style="padding:8px 0">无工具调用记录</div>';

  const todos = d.todos || [];
  root.querySelector('#tdigest-todos').innerHTML = todos.length
    ? todos.slice(0, 10).map((t) => '<label class="' + (t.done ? 'done' : '') + '"><span class="chk">' + (t.done ? '✓' : '') + '</span><span>' + esc(t.text) + '</span></label>').join('')
    : '<div class="empty" style="padding:8px 0">无待办记录</div>';
}

async function load(range) {
  state.range = range;
  state.loading = true;
  state.error = '';
  render();
  try {
    const res = await app.callServerTool({ name: 'digest_snapshot', arguments: { range } });
    const payload = res.structuredContent || JSON.parse(res.content?.[0]?.text || '{}');
    if (!payload || !payload.totals) throw new Error('返回数据为空');
    state.data = payload;
  } catch (err) {
    state.error = '读取失败：' + (err && err.message ? err.message : String(err));
  } finally {
    state.loading = false;
    render();
  }
}

async function openDetail(taskId) {
  state.view = 'detail';
  state.detail = null;
  render();
  root.querySelector('#tdigest-dtitle').textContent = '正在读取…';
  try {
    const res = await app.callServerTool({ name: 'digest_task_detail', arguments: { task_id: taskId } });
    state.detail = res.structuredContent || JSON.parse(res.content?.[0]?.text || '{}');
  } catch (err) {
    state.detail = { title: '读取失败', workspace: '', mode: '', createdAt: 0, updatedAt: 0, activeMs: 0, tokens: 0, requests: 0, toolCalls: 0, toolOk: 0, todoTotal: 0, todoDone: 0, tools: [], todos: [] };
  }
  render();
}

root.querySelectorAll('.seg button').forEach((b) => {
  b.addEventListener('click', () => {
    root.querySelectorAll('.seg button').forEach((o) => {
      if (o === b) o.setAttribute('aria-pressed', 'true');
      else o.removeAttribute('aria-pressed');
    });
    if (state.view === 'detail') state.view = 'overview';
    load(b.dataset.range);
  });
});

root.querySelector('#tdigest-back').addEventListener('click', () => {
  state.view = 'overview';
  render();
});

app.onhostcontextchanged = (ctx) => {
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
};
app.ontoolresult = () => {};

await app.connect();
const ctx = app.getHostContext();
if (ctx?.theme) applyDocumentTheme(ctx.theme);
await load(state.range);
}

boot().catch((err) => {
  state.loading = false;
  state.error = '面板初始化失败：' + (err && err.message ? err.message : String(err));
  render();
});
