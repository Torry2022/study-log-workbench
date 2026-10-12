# 当前问答实现的隔离 Windows 候选

产品源码基线 `2e139e8`，包含此前工具输出默认设置、明确标题名称排序、首轮可读日期和截断后的继续核对。隔离候选在 `.local/rag-first-decision-current-windows-20261012/`，未替换日常安装或修改产品版本号。

包内 Node 22.23.3、Web 和 MCP 的问答检查通过：完整月份和短题一次生成，命中原文补读，首轮 length 丢弃内部文本后进入现有工具循环并生成完整带来源回答；完整模型 URL、Bearer 与 SSE 沿用原协议。相关浏览器检查覆盖会话、保存、标题任务、来源跳转、侧栏、取消和错误草稿。证据在 `.local/rag-first-decision-package-check-20261012/`。

实际打包 EXE 六组生命周期检查通过：隔离实例与自动认证、第二次启动复用、编辑保存和取消关闭保留草稿、正常退出重开、备份恢复后打开新实例、Web 工作进程异常后的兄弟服务停止及保护状态保留。报告及已查看截图在 `.local/electron-smoke-1791786705140/`。使用的是解包 EXE，没有执行安装器，不将其等同于覆盖安装迁移。

独立 payload 和 EXE 内 payload 的四个 MCP 关键模块均与源码哈希相同；两份 payload 的 150 个服务端 JavaScript 文件与当前 standalone 构建一致，确认首轮 length 处理已进入编译产物。核对在候选的 `code-hashes.json`。

NSIS SHA-256：`B51CF9C4770FE10AD3749D6F786DE2A60A87E6FEA6C3C158BCA136F5670E67BD`。本轮检查全部使用合成实例及模型替身，不能证明真实模型收益或启用门槛；默认 Agent/Jev 关闭，质量目标继续。未推送、发布或覆盖安装，鸿蒙未改。
