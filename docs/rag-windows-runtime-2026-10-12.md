# 当前问答流程的 Windows 打包启动验收

产品基线 `fd48370`，沿用 rc.9 生成本地隔离候选，不发布或替换已有版本附件，也不覆盖日常安装。

## 产物与身份

- `ops/electron/package.mjs` 生成 Electron 可执行目录与 NSIS 安装器，目录 `.local/rag-windows-1791737014676/`；安装器未执行，应用仍未签名。
- 安装器 SHA-256：`35ff8d66b8bdeed472aba4f6917ef1a3279c7ebc4ef2ffdb6006c37dff9f14e8`。
- 打包问答 route.js 与当前 standalone 构建一致，打包 MCP retrieval.mjs 与源码一致，Electron resources/payload 内同两文件与独立 payload 一致，哈希记录 `code-hashes.json`。
- 包内 Node 实际版本 v22.23.3；验收脚本驱动 Node 为 v23.8.0，报告分别记录，不能把驱动版本误称为包内版本。AI SDK、OpenAI compatible、TypeSafe SDK 的许可证随包存在。

## 执行结果

`ops/rag-package-smoke.mjs` 使用包内 DesktopManager 和 Node 启动 Web/MCP，模型为本机替身，沿完整自定义 URL、Bearer 认证和真实 SSE 接口验证：

| 问题路径 | 生成模型调用 | 结果 |
| --- | --- | --- |
| 九月范围总结 | 1 | done 与真实来源日期 |
| Alpha 初次证据足够 | 1 | finish 携带回答；完整 Alpha 日不在可读日期中 |
| Gamma 同日存在未命中小节 | 3 | read 原文 → finish → 独立生成答案；来源指向实际包含条件的材料 |

问答三组通过后，包内服务上运行 browser-rag：历史标题不阻塞下一次提问、两轮保存、来源跳转返回、草稿、展开/收起历史、会话打开位置、EOF/取消、保存重试、鉴权和迟到响应，以及桌面/手机布局流程均通过。证据在 `rag-smoke-final/package-check.json` 和对应浏览器产物中。替身只证明流程、协议和调用次数，不证明真实模型的回答质量。

首次脚本失败源于把 Alpha 已完整提供误断言成“所有日期不可读”；新实例示例和 Gamma 未命中小节仍合法可读。改为核对 Alpha 本身不在可读日期，再用新的隔离实例重跑，第二次和最终运行均通过；没有改变产品或隐藏实例示例来凑通过。

实际打包 EXE 执行 `ops/electron/smoke.mjs` 六组通过：默认隔离实例与自动认证、渲染隔离、二次启动复用窗口、保存/取消关闭保留草稿、正常退出重开、归档恢复和 Web worker 崩溃反馈/退出处理。记录 `.local/electron-smoke-1791737171414/report.json`，已查看实际 EXE 的 workspace.png。原生确认框由测试替身决定选择，不当作原生弹窗人工视觉验收。

全部资料、配置、归档和故障注入仅作用于新建合成实例；未使用个人版、真实记录或付费模型。本次证明 Windows 打包与启动兼容，未执行安装器迁移，未证明独立使用者验收，也未达到复杂 Agent 默认启用标准。复杂问题跨材料收益及多余语义搜索仍需继续验证。
