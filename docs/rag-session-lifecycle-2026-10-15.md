# 问答会话生命周期复核

本批基于 `fc86bcd`，只修改通用版。保留按会话管理请求、消息、草稿和保存快照的实现，不增加服务端任务队列，不改问答协议、模型配置或检索架构。

## 复现与修复

| 行为 | 修复前实际入口结果 | 代码处理 |
| --- | --- | --- |
| B 留有草稿，打开 A 失败后重试 | 读取 B，且询问放弃 B 草稿，目标 A 没有重新读取。 | `use-rag.ts` 区分当前展示会话与尚未加载成功的路由目标，重试 A 时保留 B 草稿。 |
| B 仍在生成，打开 A 失败后重试 | 被 B 的生成状态挡住，没有读取 A。 | 仅在重新读取同一会话时执行原生成／保存保护，不用 B 的忙碌状态阻止 A 的读取。 |
| A 读取失败后重新打开 B | A 的错误留在 B 的会话状态中，B 仍显示错误。 | 导航读取错误单独保存，切换目标时清理，不写入旧会话。 |
| A 加载失败期间，B 的后台回答保存完成 | 地址被改回 B，覆盖用户请求的 A。 | 只有路由仍指向该保存会话时才回写地址。 |
| WebKit 长回答后立即追问 | 聚焦粘性输入框引起滚动，滚动逻辑隐藏输入框并移走焦点，追问输入被打断。 | `RagWorkspace.tsx` 在输入框聚焦时保留输入区；未聚焦时原滚动收起逻辑保留。 |

前四项失败记录分别在 `.local/rag-lifecycle-before.log`、`.local/rag-lifecycle-running-retry-before.log`、`.local/rag-lifecycle-stale-error-before.log` 和 `.local/rag-lifecycle-completion-route-before.log`。长回答输入问题的聚焦／输入断言和页面几何记录保留在 `.local/rag-lifecycle-focused-input.log`、`.local/rag-lifecycle-geometry.log`；最终运行结果见下节。

## 测试落点

新增 `ops/verify-rag-lifecycle.mjs`：全新合成资料、独立生产服务和真实会话 API，只有生成 SSE 使用本机替身。Chromium／WebKit 分别覆盖失败目标重试、旧草稿保留、后台生成时重试、保存不改目标、两个请求独立停止、跨模块完成、断流保留、重新生成保存、已保存会话刷新恢复、登录失效取消和草稿保留。`--legacy` 另复跑原 `ops/browser-rag.mjs` 的完整界面流程。

原浏览器脚本增加输入值与焦点断言，来源跳转先要求过渡状态和快照清理，再执行原正文断言；不删除引用、保存重试或延迟标题断言。原后台脚本同样等待过渡完成后检查手机横向边界，结束时先解除路由拦截，避免关闭页面后仍有 `route.fetch` 回调掩盖测试结果。没有用强制点击、延长原输入断言超时或跳过用例来通过。

## 最终结果

- Web 全量 494 项通过、3 项原权限跳过，其中问答专项 252 项；类型检查和生产构建通过。
- 新增生命周期检查：Chromium／WebKit 各六组，共 12 组通过。
- 原后台检查：两浏览器、浅深色四组通过，覆盖桌面和手机、并发、独立停止、后台保存重试、保存中重新登录、草稿保留及退出保护。
- 原完整浏览器问答流程：Chromium／WebKit 均通过，包括长回答后的追问、延迟标题、来源跳转／返回、保存失败和畸形成功响应、历史搜索、折叠侧栏、手机布局。
- 实际生产入口：真实本机 MCP 和供应商替身 22 组通过，合成源文件不变。
- 已查看新增场景、WebKit 手机和深色后台截图。

最终证据为 `.local/rag-lifecycle-1792031200434/results.json`、同目录 `legacy-chromium.log`／`legacy-webkit.log`；`.local/rag-background-1792031200398/results.json`；`.local/rag-entry-production-1792031200655/results.json`。测试、类型和构建日志均以 `.local/rag-lifecycle-` 开头。

复跑顺序：先在 `study-log-web` 执行 `npm test`、`npm run typecheck` 和 `npm run build`，随后在仓库根目录执行 `node ops/verify-rag-lifecycle.mjs --legacy`、`node ops/verify-rag-background.mjs`、`node ops/verify-rag-entry.mjs`。检查均创建自己的合成目录，不接收真实资料路径。

## 边界

后台是同一个工作台仍打开时的会话状态管理；刷新可以重新读取已保存历史，不会跨刷新或关闭应用续跑未完成生成。停止／断流片段保留在当前页面，不自动当作完整回答保存，重新生成成功后再沿用现有保存流程。

没有调用付费模型、修改个人版仓库、迁移代码、推送、部署、发布或覆盖安装。未重新打包 Windows 或验证鸿蒙设备；真实模型质量、长材料 Agent 收益和跨重启持久任务不属于本批。完成后交主线2独立验收，不能将本机检查表述为个人版兼容验收通过。
