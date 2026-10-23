# task-digest

ZCode 任务摘要插件。读取本机 ZCode 的任务索引与会话数据库（**只读**），输出任务量、token 用量、工具调用量、成功率与待办进度，并提供侧栏可视化面板。

![面板](https://img.shields.io/badge/ZCode-0.17.0-blue) ![node](https://img.shields.io/badge/node-%E2%89%A520-green)

## 能力

| 形态 | 说明 |
|---|---|
| 侧栏面板 | `ui.surfaces` 声明的持久面板，切今日 / 近 3 天 / 全部，点任务行下钻详情 |
| MCP 工具 | `digest_snapshot`、`digest_task_detail`、`digest_workspaces`、`open_digest` |
| 斜杠命令 | `/digest [today\|3d\|7d\|30d\|all]` |
| Skill | `task-digest`：把数据组织成中文摘要的写作规范 |

## 数据来源（全部只读）

- `~/.zcode/v2/tasks-index.sqlite` → `tasks`
- `~/.zcode/cli/db/db.sqlite` → `session`、`model_usage`、`tool_usage`、`turn_usage`、`todo`

不读取 `part`（对话正文 JSON blob）：全表扫描 3.4 秒，且属于隐私内容。只用预聚合的 `*_usage` 表。

## 安装

```bash
git clone https://github.com/Morningstar202604/task-digest.git
cd task-digest
npm install
npm run build

zcode plugins marketplace add "$PWD"
zcode plugins install task-digest@local-task-digest
```

或在客户端「插件市场 → 添加 → 添加插件市场」粘贴本目录，然后在「个人」里安装。

## 开发

```bash
npm run build    # esbuild 打包 → task-digest/dist/{server.mjs,panel.html}
npm run smoke    # MCP 协议层 13 项断言（真读本机数据库）
npm test         # 面板 UI：模拟宿主 + Playwright 截图（需要 Chrome）
```

`npm test` 会为 light / dark 各出一张 overview 与 detail 截图，并断言指标、行数、柱数、console 无报错。

## 设计约束

- **单文件面板**：无 CDN、无外链字体、无图标库，606 KB 全内联；宿主对 HTML 资源限制 4 MiB。
- **主题跟随**：全部颜色走 `light-dark()` + `data-theme`，切换零 JS 重绘。
- **零原生依赖**：用 Node 内置 `node:sqlite`，不需要 better-sqlite3 编译。
- **脱敏**：任务标题统一过 `maskSecrets()`，密钥 / token / 40 位以上随机串替换为 `***`。

## 已知限制

- 面板最多展示 40 条任务，无搜索与分页。
- `totals` 有 30 秒内存缓存。
- 数据库 schema 是 ZCode 内部实现，客户端升级后字段可能变化——升级后请先跑 `npm run smoke`。

## License

MIT
