import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TASKS_DB = path.join(os.homedir(), '.zcode', 'v2', 'tasks-index.sqlite');
const DEFAULT_SESSION_DB = path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite');

const SECRET_PATTERNS = [
  [/(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '$1-***'],
  [/gh[pousr]_[A-Za-z0-9]{8,}/g, 'gh*_***'],
  [/(密钥|口令|密码|token|api[_-]?key)\s*(是|为|[:=：])\s*[A-Za-z0-9_\-+/=]{6,}/gi, '$1$2***'],
  [/[A-Za-z0-9_\-+/=]{40,}/g, (m) => (m.startsWith('session_') || m.startsWith('sess_') ? m : m.slice(0, 4) + '***')],
];

export function maskSecrets(text) {
  if (!text) return '';
  let out = String(text);
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

function openReadOnly(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 2000');
  return db;
}

export function createStore(opts = {}) {
  const tasksPath = opts.tasksDbPath || DEFAULT_TASKS_DB;
  const sessionPath = opts.sessionDbPath || DEFAULT_SESSION_DB;
  let tasksDb = null;
  let sessionDb = null;

  function tasks() {
    if (!tasksDb) tasksDb = openReadOnly(tasksPath);
    return tasksDb;
  }
  function sessions() {
    if (!sessionDb) sessionDb = openReadOnly(sessionPath);
    return sessionDb;
  }

  function close() {
    try { tasksDb?.close(); } catch {}
    try { sessionDb?.close(); } catch {}
    tasksDb = sessionDb = null;
  }

  function cutoff(range) {
    if (!range || range === 'all') return 0;
    const days = range === 'today' ? 1 : range === '3d' ? 3 : range === '7d' ? 7 : range === '30d' ? 30 : 0;
    if (!days) return 0;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime() - (days - 1) * 86400000;
  }

  function statOf(sessionId) {
    const s = sessions();
    const usage = s.prepare(`
      select coalesce(sum(computed_total_tokens),0) tokens, count(*) requests
      from model_usage where session_id = ?`).get(sessionId);
    const tools = s.prepare(`
      select count(*) calls, sum(case when status = 'completed' then 1 else 0 end) ok
      from tool_usage where session_id = ?`).get(sessionId);
    const turns = s.prepare(`
      select count(*) turns, coalesce(sum(duration_ms),0) ms
      from turn_usage where session_id = ?`).get(sessionId);
    const todo = s.prepare(`
      select count(*) total, sum(case when status = 'completed' then 1 else 0 end) done
      from todo where session_id = ?`).get(sessionId);
    return {
      tokens: usage.tokens,
      requests: usage.requests,
      toolCalls: tools.calls || 0,
      toolOk: tools.ok || 0,
      turns: turns.turns || 0,
      activeMs: turns.ms || 0,
      todoTotal: todo.total || 0,
      todoDone: todo.done || 0,
    };
  }

  function statMap(sessionIds) {
    const s = sessions();
    const map = new Map();
    if (!sessionIds.length) return map;
    const marks = sessionIds.map(() => '?').join(',');
    const base = (id) => {
      if (!map.has(id)) map.set(id, {
        tokens: 0, requests: 0, toolCalls: 0, toolOk: 0, turns: 0, activeMs: 0, todoTotal: 0, todoDone: 0,
      });
      return map.get(id);
    };
    for (const id of sessionIds) base(id);
    for (const r of s.prepare(`select session_id,
        coalesce(sum(computed_total_tokens),0) tokens, count(*) requests
        from model_usage where session_id in (${marks}) group by session_id`).all(...sessionIds)) {
      const e = base(r.session_id);
      e.tokens = r.tokens; e.requests = r.requests;
    }
    for (const r of s.prepare(`select session_id, count(*) calls,
        sum(case when status = 'completed' then 1 else 0 end) ok
        from tool_usage where session_id in (${marks}) group by session_id`).all(...sessionIds)) {
      const e = base(r.session_id);
      e.toolCalls = r.calls || 0; e.toolOk = r.ok || 0;
    }
    for (const r of s.prepare(`select session_id, count(*) turns, coalesce(sum(duration_ms),0) ms
        from turn_usage where session_id in (${marks}) group by session_id`).all(...sessionIds)) {
      const e = base(r.session_id);
      e.turns = r.turns || 0; e.activeMs = r.ms || 0;
    }
    for (const r of s.prepare(`select session_id, count(*) total,
        sum(case when status = 'completed' then 1 else 0 end) done
        from todo where session_id in (${marks}) group by session_id`).all(...sessionIds)) {
      const e = base(r.session_id);
      e.todoTotal = r.total || 0; e.todoDone = r.done || 0;
    }
    return map;
  }

  function listTasks({ range = 'all', limit = 40, workspace = '' } = {}) {
    const from = cutoff(range);
    const rows = tasks().prepare(`
      select task_id, title, cli_title, mode, model, workspace_path, task_status,
             created_at, updated_at, pinned
      from tasks
      where deleted = 0 and updated_at >= ?
      order by pinned desc, updated_at desc
      limit ?`).all(from, Math.min(Math.max(limit, 1), 200));

    const wsFilter = workspace.toLowerCase();
    const filtered = rows.filter((r) => !wsFilter || (r.workspace_path || '').toLowerCase().includes(wsFilter));
    const stats = statMap(filtered.map((r) => r.task_id));
    return filtered.map((r) => {
      const stat = stats.get(r.task_id);
      return {
        id: r.task_id,
        title: maskSecrets(r.cli_title || r.title || '(未命名)'),
        workspace: shortWorkspace(r.workspace_path),
        workspacePath: r.workspace_path,
        mode: r.mode || 'build',
        model: r.model || '',
        status: r.task_status || null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        pinned: !!r.pinned,
        ...stat,
      };
    });
  }

  function shortWorkspace(p) {
    if (!p) return '';
    const parts = p.split(/[\\/]/).filter(Boolean);
    return parts.slice(-2).join('/');
  }

  function taskDetail(taskId) {
    const row = tasks().prepare(`
      select task_id, title, cli_title, mode, model, workspace_path, task_status,
             created_at, updated_at
      from tasks where task_id = ? and deleted = 0`).get(taskId);
    if (!row) return null;

    const s = sessions();
    const toolBreakdown = s.prepare(`
      select tool_name, count(*) calls, coalesce(sum(duration_ms),0) ms,
             sum(case when status = 'completed' then 1 else 0 end) ok
      from tool_usage where session_id = ?
      group by tool_name order by calls desc`).all(taskId);
    const todos = s.prepare(`
      select content, status, priority from todo where session_id = ?
      order by position`).all(taskId);
    const daily = s.prepare(`
      select date(started_at/1000,'unixepoch','localtime') day,
             sum(computed_total_tokens) tokens, count(*) requests
      from model_usage where session_id = ?
      group by day order by day`).all(taskId);

    return {
      id: row.task_id,
      title: maskSecrets(row.cli_title || row.title || '(未命名)'),
      workspace: shortWorkspace(row.workspace_path),
      workspacePath: row.workspace_path,
      mode: row.mode || 'build',
      model: row.model || '',
      status: row.task_status || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...statOf(taskId),
      tools: toolBreakdown.map((t) => ({ name: t.tool_name, calls: t.calls, ms: t.ms, ok: t.ok })),
      todos: todos.map((t) => ({ text: maskSecrets(t.content), done: t.status === 'completed', status: t.status })),
      daily: daily.map((d) => ({ day: d.day, tokens: d.tokens || 0, requests: d.requests })),
    };
  }

  function usageTrend(range = 'all') {
    const days = range === 'today' ? 1 : range === '3d' ? 3 : range === '7d' ? 7 : range === '30d' ? 30 : 14;
    const from = Date.now() - days * 86400000;
    const rows = sessions().prepare(`
      select date(started_at/1000,'unixepoch','localtime') day,
             sum(computed_total_tokens) tokens,
             count(*) requests,
             sum(tool_call_count) toolCalls
      from model_usage where started_at >= ?
      group by day order by day`).all(from);
    return rows.map((r) => ({
      day: r.day,
      tokens: r.tokens || 0,
      requests: r.requests || 0,
      toolCalls: r.toolCalls || 0,
    }));
  }

  const cache = new Map();
  function cached(key, ttlMs, fn) {
    const hit = cache.get(key);
    const now = Date.now();
    if (hit && now - hit.at < ttlMs) return hit.value;
    const value = fn();
    cache.set(key, { at: now, value });
    return value;
  }

  function totals(range = 'all') {
    return cached(`totals:${range}`, 30000, () => {
      const from = cutoff(range);
      const t = tasks().prepare(`
        select count(*) c from tasks where deleted = 0 and updated_at >= ?`).get(from);
      const u = sessions().prepare(`
        select coalesce(sum(computed_total_tokens),0) tokens, count(*) requests
        from model_usage where started_at >= ?`).get(from);
      const tu = sessions().prepare(`
        select count(*) calls, sum(case when status = 'completed' then 1 else 0 end) ok
        from tool_usage where started_at >= ?`).get(from);
      return {
        tasks: t.c,
        tokens: u.tokens,
        requests: u.requests,
        toolCalls: tu.calls || 0,
        toolOk: tu.ok || 0,
        successRate: tu.calls ? (tu.ok / tu.calls) * 100 : 0,
      };
    });
  }

  function workspaceRollup(range = 'all', limit = 12) {
    const from = range === 'all' ? 0 : cutoff(range);
    const rows = tasks().prepare(`
      select workspace_path, count(*) tasks,
             max(updated_at) lastUsed
      from tasks where deleted = 0 and updated_at >= ?
      group by workspace_path order by lastUsed desc limit ?`).all(from, limit);
    const allIds = tasks().prepare(`
      select task_id, workspace_path from tasks where deleted = 0`).all();
    const byWs = new Map();
    for (const r of allIds) {
      if (!byWs.has(r.workspace_path)) byWs.set(r.workspace_path, []);
      byWs.get(r.workspace_path).push(r.task_id);
    }
    const stats = statMap(allIds.map((r) => r.task_id));
    return rows.map((r) => {
      let tokens = 0;
      let calls = 0;
      for (const id of byWs.get(r.workspace_path) || []) {
        const s = stats.get(id);
        if (!s) continue;
        tokens += s.tokens;
        calls += s.toolCalls;
      }
      return {
        workspace: shortWorkspace(r.workspace_path),
        path: r.workspace_path,
        tasks: r.tasks,
        tokens,
        toolCalls: calls,
        lastUsed: r.lastUsed,
      };
    });
  }

  function snapshot(range = 'all', limit = 40) {
    return {
      generatedAt: Date.now(),
      range,
      totals: totals(range),
      trend: usageTrend(range),
      tasks: listTasks({ range, limit }),
    };
  }

  return { listTasks, taskDetail, usageTrend, totals, workspaceRollup, snapshot, close, paths: { tasksPath, sessionPath } };
}
