# task-digest

ZCode 任务摘要插件。读取本机 ZCode 的任务索引与会话数据库（只读），输出任务量、token 用量、工具调用、成功率与待办进度，并提供侧栏可视化面板。

## 组成

```
marketplace.json              本地开发市场清单
task-digest/
  .zcode-plugin/plugin.json   插件清单（mcpServers + ui.surfaces + skills + commands）
  src/db.mjs                  数据层：只读打开两个 SQLite，聚合查询，标题脱敏
  src/server.mjs              MCP server：4 个工具 + 1 个 ui:// 资源
  src/panel.js / .css / .tpl.html   面板前端源码
  dist/server.mjs             构建产物（打包后，含 SDK 依赖）
  dist/panel.html             构建产物（单文件，全部内联）
  skills/task-digest/SKILL.md 摘要写作规范
  commands/digest.md          /digest 斜杠命令
  scripts/build.mjs           esbuild 构建
  scripts/smoke.mjs           MCP 协议层冒烟测试（13 项）
  scripts/harness.mjs         面板 UI 验收（模拟宿主 + Playwright 截图）
```

## 数据来源

| 库 | 表 | 用途 |
|---|---|---|
| `~/.zcode/v2/tasks-index.sqlite` | `tasks` | 任务标题、工作区、模式、状态、时间 |
| `~/.zcode/cli/db/db.sqlite` | `session` | 会话元数据 |
| 同上 | `model_usage` | 每次模型请求的 token 与耗时 |
| 同上 | `tool_usage` | 每次工具调用的状态与耗时 |
| 同上 | `turn_usage` | 每轮对话的时长 |
| 同上 | `todo` | 待办清单 |

两个库都以 `readOnly: true` 打开，代码中不存在任何写语句。

## 构建与验证

```bash
cd ~/.zcode/plugin-workspace
npm install          # 依赖装在 workspace 根，不进插件目录
npm run build        # → task-digest/dist/{server.mjs,panel.html}
npm run smoke        # MCP 协议层 13 项断言
npm test             # 面板 UI：模拟宿主 → 渲染 → 截图（需要 Chrome）
```

构建需要 `esbuild`；运行只需要 Node 20+（`node:sqlite` 内置，无原生模块）。

## 安装

```bash
zcode plugins marketplace add ~/.zcode/plugin-workspace
zcode plugins install task-digest@local-task-digest
```

或在客户端「插件市场 → 添加插件市场」粘贴 `C:\Users\X1882\.zcode\plugin-workspace`，然后在「个人 → 本地插件（task-digest 开发市场）」安装。

## 使用

- 面板：会话侧栏「任务摘要」，可切今日 / 近 3 天 / 全部，点任务行下钻详情。
- 对话：`/digest [today|3d|7d|30d|all]`，或直接问「这个项目花了多少 token」。
- 工具：`digest_snapshot`、`digest_task_detail`、`digest_workspaces`、`open_digest`。

## 已知限制

- 面板每次切换范围都要调一次 `digest_snapshot`，`totals` 有 30s 内存缓存。
- `part` 表是 JSON blob，全表扫描 3.4s，因此实现里完全不碰它，只用预聚合的 `*_usage` 表。
- 数据库 schema 属于 ZCode 内部实现，客户端升级后字段可能变化；升级后先跑 `npm run smoke`。
- 面板不支持搜索与分页，最多展示 40 条任务。

## 安全

- 任务标题在 `db.mjs:maskSecrets()` 统一脱敏（密钥、token、长随机串）。
- 不复制、不导出、不上传任何数据库文件或对话正文。
- 插件进程以当前用户身份运行，只读访问上述两个库。
