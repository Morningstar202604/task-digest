---
description: 汇总当前时间范围内的 ZCode 任务用量，输出可读摘要
argument-hint: "[today|3d|7d|30d|all]"
---

用 task-digest 插件的 `digest_snapshot` 工具取数，然后按 `task-digest` 技能的骨架写一份中文摘要。

参数（若为空则用 `all`）：`$ARGUMENTS`

步骤：
1. 调 `digest_snapshot`，`range` 取上面参数（取值 today / 3d / 7d / 30d / all），`limit` 用 20。
2. 若结果里存在 `todoTotal > todoDone` 的任务，单独列出，标明剩余项数。
3. 若存在 `status` 为 `error` 或 `interrupted` 的任务，单独指出并说明该任务最后的活动时间。
4. 输出摘要，不要粘贴原始 JSON，不要列出全部 20 条任务的逐条明细。
