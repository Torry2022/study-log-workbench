# 问答回迁前的四项修复

本轮从通用版 `d8897d2` 开始，核对基于 `54f5a64` 的回迁报告及后续源码。四个问题仍存在，已有其他修复保留。本轮只修改通用版问答实现、测试和相关文档；未改个人版，未推送、发布或安装，也没有调用付费服务。

## 复现与修改

| 问题 | 修复前复现 | 修复与回归 |
| --- | --- | --- |
| 月份与单日混合比较 | 日期计划只选择十月一日，九月范围丢失。 | `rag-retrieval-plan.ts` 使用原解析规则统一收集日／月范围；真实 MCP 请求分别为九月一日至三十日、十月一日，回答来源保留两边。 |
| 非法第二个月份 | 十三月未使问题无效，只保留九月。 | 明确范围的任一成员无效时设置 invalidDate；实际问答入口提示日期错误，没有 MCP 或模型请求。 |
| 游标来源变化 | 本机 MCP 先读完九月，再读取十月长日块第一页，修改十月文件后第二页返回 SOURCE_CHANGED；旧逻辑仍尝试生成回答。 | `mcp-client.ts` 只映射允许的来源变化代码且不透出远程消息；`rag-evidence.ts` 保留终止分类。修复后共三次 MCP 请求、零模型生成，返回 MCP_SOURCE_CHANGED，没有 delta、sources 或 done。普通读取失败仍保留既有部分回答规则。 |
| SDK 失败用量 | 替身返回 123 输入／45 输出 token 后过滤，错误诊断用量为空。 | `rag-agent.ts` 在供应商响应进入 SDK 时观察 usage，`rag-query.ts` 按请求身份更新并累计；过滤失败保留 123／45，多步为 10／5 加 123／未知，重复帧不重复计数。取消、传输失败、无用量与失败尾部停滞均有回归。 |

日期修复没有增加模型规划。来源变化只映射明确允许的错误代码，未知或格式错误的远程错误继续返回通用错误，不透出路径或消息。SDK 继续负责模型调用和工具循环；用量观察不向页面输出工具文本，不以缺失字段代表零，也不等待失败流的尾部。

## 验证

- 问答专项：250 项通过，原 240 项全部保留，新增 10 项回归。
- MCP：60 项通过、1 项跳过；跳过项需要 Windows 文件符号链接权限，没有新增跳过项。
- Web 类型检查与生产构建通过。
- `ops/verify-rag-entry.mjs` 使用生产 Next.js 入口、真实本机 MCP 与模型替身，检查四个问题及原有流程；Chromium／WebKit、浅深色、桌面／手机共八组界面流程保持通过，总计 22 组入口与界面检查。
- 截图已实际查看；合成分页文件按测试计划修改并恢复，其他合成源文件保持不变。没有访问真实日志或生产实例。

本机证据位于忽略目录：`.local/rag-audit-web-tests.log`、`.local/rag-audit-mcp-tests.log`、`.local/rag-audit-build.log` 及 `.local/rag-entry-production-1791969344454/results.json`。截图和运行资料只用于这轮隔离检查，不纳入 Git。

复跑命令：

```powershell
cd study-log-web
node --experimental-strip-types --test scripts/rag-*.test.mjs
npm run typecheck
npm run build
cd ../study-log-mcp
node --test test/*.test.mjs
cd ..
node ops/verify-rag-entry.mjs
```

## 独立验收后的用量补修

个人版对 `0b4e453` 独立验收时，前三项通过，但发现同请求先收到 29 输入／11 输出，后续只收到 13 输出时输入变为 null；后续收到空 usage 时两项都变为 null。因此原批未通过整体验收，尚未迁移。

本次先新增两项 `createRagQueryStream` 级回归，经真实本机 MCP 和 SDK、17 字节 CRLF 分片及过滤后停滞尾流，均复现上述错误。只修改 `rag-query.ts` 的同 callId 合并：新非空计数更新对应字段，其余保留已知值；从未收到的仍为 null，不补零、不逐帧相加，不改变 SDK 循环。修复后分别保留 29／13 和 29／11，且失败取消上游、没有正文或 done。

补修验证：问答 252 项通过（包含原有多步累计、重复帧、失败和取消），MCP 60 项通过／1 项原 Windows 权限跳过，类型检查和生产构建通过，实际生产入口及 Chromium／WebKit 22 组检查通过，合成源文件保持不变。证据在 `.local/rag-usage-followup-tests.log`、`.local/rag-usage-followup-mcp.log`、`.local/rag-usage-followup-typecheck.log`、`.local/rag-usage-followup-build.log` 和 `.local/rag-entry-production-1791986564680/results.json`。补修等待独立复验，不代表整体验收已通过。

## 独立复验结果

主线2已对 `0b4e453` 与补修 `a1dc8dc` 完成独立验收：原始独立脚本未改断言，14／14 通过；两项原失败正确保留 29／13 和 29／11，多步累计、重复帧、失败与取消、范围和来源变化规则均保持通过。另独立复跑问答 252 项、类型检查、生产构建及该构建的实际入口 22 组检查通过，并查看浅色桌面及深色手机截图。MCP 未改，沿用上一轮独立 60 通过／1 项原权限跳过；本轮独立用例继续使用真实本机 MCP。

正式报告位于个人版忽略目录 `.backups/rag-public-sync-audit-2026-10-14/acceptance-a1dc8dc.md`；首次未通过报告仍保留。此结论仅覆盖四项缺陷，不包括导航动效或个人版整体兼容验收，没有迁移、推送或发布。

## 文档与交付边界

Agent 对所有供应商均需要 `RAG_AGENT_ENABLED=true` 和 `RAG_AGENT_TOOL_CALLING_VERIFIED=true`。引用上限为 160；旧文档中的官方 Flash 自动启用、30 条最终引用上限说明已修正。历史样本的质量、费用和设备结果保留其原有时间范围。

本批四项缺陷已通过个人版 Session 独立验收。独立验收仅使用隔离合成资料，没有修改个人版业务代码或生产配置。个人版迁移尚未执行；Windows 打包、鸿蒙安装和真实模型质量不在本批验证范围。
