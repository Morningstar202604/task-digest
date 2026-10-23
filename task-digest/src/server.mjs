import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from './db.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const PANEL_URI = 'ui://task-digest/panel.html';
const PANEL_HTML = path.join(HERE, 'panel.html');

function manifestVersion() {
  try {
    const raw = fs.readFileSync(path.join(HERE, '..', '.zcode-plugin', 'plugin.json'), 'utf8');
    return JSON.parse(raw).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}
const VERSION = manifestVersion();

const store = createStore({
  tasksDbPath: process.env.TASK_DIGEST_TASKS_DB || undefined,
  sessionDbPath: process.env.TASK_DIGEST_SESSION_DB || undefined,
});

const RANGE = z.enum(['today', '3d', '7d', '30d', 'all']).default('all');

function text(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload };
}

const server = new McpServer({ name: 'task-digest', version: VERSION });

registerAppTool(
  server,
  'open_digest',
  {
    title: '打开任务摘要面板',
    description: '打开 ZCode 任务摘要面板：任务量、token 用量、工具调用、成功率、待办进度，可按时间范围切换并查看单个任务详情。',
    inputSchema: z.object({ range: RANGE }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: PANEL_URI } },
  },
  async ({ range }) => text(store.snapshot(range, 40)),
);

server.registerTool(
  'digest_snapshot',
  {
    title: '任务摘要数据',
    description: '读取指定时间范围内的任务摘要数据：总量指标、每日 token 趋势、任务列表（含 token、工具调用、待办进度）。只读。',
    inputSchema: z.object({
      range: RANGE,
      limit: z.number().int().min(1).max(200).default(40),
      workspace: z.string().default(''),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ range, limit, workspace }) => {
    const totals = store.totals(range);
    const trend = store.usageTrend(range);
    const tasks = store.listTasks({ range, limit, workspace });
    return text({ range, generatedAt: Date.now(), totals, trend, tasks });
  },
);

server.registerTool(
  'digest_task_detail',
  {
    title: '任务详情',
    description: '读取单个 ZCode 任务的详情：耗时、token、请求数、工具调用明细、待办清单、每日用量。只读。',
    inputSchema: z.object({ task_id: z.string().min(1) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ task_id }) => {
    const detail = store.taskDetail(task_id);
    if (!detail) return { content: [{ type: 'text', text: `未找到任务：${task_id}` }], isError: true };
    return text(detail);
  },
);

server.registerTool(
  'digest_workspaces',
  {
    title: '工作区汇总',
    description: '按工作区聚合任务数、token 用量、工具调用次数与最近使用时间。只读。',
    inputSchema: z.object({ range: RANGE, limit: z.number().int().min(1).max(50).default(12) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ range, limit }) => text({ range, workspaces: store.workspaceRollup(range, limit) }),
);

registerAppResource(
  server,
  '任务摘要面板',
  PANEL_URI,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => ({
    contents: [
      {
        uri: PANEL_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: fs.readFileSync(PANEL_HTML, 'utf8'),
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
