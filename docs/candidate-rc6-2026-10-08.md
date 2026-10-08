# rc.6 候选产物与最终检查

2026-10-08 本地准备完成，尚未推送或发布。已公开版本仍为 rc.5，本批未替换其标签、附件或镜像。产品修正基线为 `cbbd542`，本次同步根目录、Windows、Web、MCP 的 package／lockfile 根版本为 `0.1.0-rc.6`。

## 版本范围

- 基础标注与问答说明不再额外限定技术领域，三套技术学习生成方案保留。
- 随记提取合并同一问题的过程与限制，避免孤立待办和重复归纳；问答提示约束相关性及方括号来源格式。
- 实例初始化、Windows 与服务器启动共用旧默认模板升级，精确识别 rc.5 标注及提取模板，备份后替换；定制模板、生成模板、个人方案和凭据保留。
- 鸿蒙源码包含启动窗口监听生命周期修正。本批无鸿蒙设备安装产物。
- 构建入口支持新的候选输出目录，避免覆盖旧产物：`node ops/electron/package.mjs <新的输出目录>`。默认调用方式保留。

产品仍面向愿意使用 Markdown 的技术学习者。Windows 提供本机记录；网页、Windows 服务器模式和鸿蒙连接自部署实例，两处记录不自动同步。未新增模板设置或客户端业务协议。

## 首轮产物（已由下述文案修正版替代）

目录：`D:\BaiduSyncdisk\study-log-workbench-public-rebuild\.local\candidate-rc6-20261008`。

- Windows：`desktop\study-log-desktop-0.1.0-rc.6-x64-setup.exe`。
- 服务器：`study-log-server-0.1.0-rc.6.zip`，只包含 Compose、环境示例、部署说明和版本说明。
- 校验：`SHA256SUMS.txt`。
- 对外版本说明草稿：`release-notes.md`。

最终 SHA-256：Windows `77f4617cd27fbf8514069901b0f97f44f26c602789f7b50168eb7bd3cfecf0de`；服务器 ZIP `880957b7e87d288552c1652768a028e4a77cb517e5fa6465a59cde78d766474a`。

三个 Linux amd64 镜像已在本机构建并标记为公开 ACR 的 rc.6 路径，未推送。部署示例明确候选尚不能公开拉取；README 固定下载链接仍指向 rc.5。当前本地镜像身份见 `.local/rc6-images.json`，不能把本地身份当成 Registry 已发布摘要。

## 实际检查

| 项目 | 结果与证据 |
| --- | --- |
| Web 类型及生产构建 | 通过；`.local/rc6-typecheck.log`、`rc6-build.log` |
| 默认模板及预算协议 | 15 项通过；`.local/rc6-focused-tests.log`。真实模型质量沿用前一批有限样本，本批无付费调用 |
| 最终打包 EXE | 六组独立 Playwright 流程通过：隔离首次使用、重复启动、编辑保存、取消退出保留草稿、正常退出重开、归档恢复，以及受控子进程异常的收尾；`.local/electron-smoke-1791449345989/report.json`，工作台截图已核看 |
| 包内固定 Node 运行时 | 五组通过：无模型写入与检索、精确旧默认模板升级、停止重开、带来源问答期间正常停止、新目录归档恢复；`.local/rc6-payload-smoke/report.json`。升级前后凭据、生成模板与个人方案字节一致 |
| 包内来源核对 | payload 和打包 EXE 资源中的实例生命周期代码及两份模板逐字节匹配当前源码；Web、MCP、package manifest 均为 rc.6 |
| 服务器镜像 | 三个 Linux amd64 构建通过；`.local/rc6-docker-{web,mcp,tools}.log` |
| 预构建 Compose | 使用本轮镜像与 deploy/compose.yaml，六组初始化、认证无模型读写、材料解析、重启、只读 MCP、备份与新目录恢复通过；`.local/public-rebuild-b27-20261008084937061/report.json` |
| Docker 问答与停止 | 三组关键词问答、可选向量替身、流输出期间 SIGTERM 等待结束通过；`.local/public-rebuild-rag-20261008084959675/report.json`。合成模型不作为真实模型质量证据 |
| 部署 ZIP | 四个文件与当前 deploy 源文件逐字节一致，包含隐藏的 `.env.example`；两个附件 SHA-256 已生成 |

Compose 首次检查漏传 IMAGE_PREFIX，后一次检查又发现测试脚本的镜像身份／替身默认值仍指旧 b27；最终同时显式传入部署前缀、版本及三份镜像名后重跑原检查。失败日志保留，没有修改产品来跳过断言。

所有数据来自合成隔离实例。测试没有执行安装器、覆盖日常安装或修改用户日志。最终 EXE 为安装包同批打包程序，不能把它写成已完成系统安装／卸载。测试服务、代理和 Compose 项目均已关闭；异常退出测试按既有机制保留合成实例锁。

## 发布前最后一步

待用户确认本套产物后，推送源码及新 rc.6 镜像、验证匿名拉取，创建草稿 Release 并核对上传摘要，最后公开预发布并更新下载入口。发布时补 Registry digest；不覆写 rc.5。标注密度和个别回答冗长仍作为体验观察，不宣称长期准确率。

## 文案修正版（当前候选）

同日按用户反馈修正 Windows、网页和鸿蒙的可见用词：不再使用“实例”，改为学习记录、保存位置、服务器或具体配置；日常异常提示不要求理解锁机制。维护文档保留运行锁的准确说明和操作边界，文件名、身份字段、协议与保护机制未变。

当前产物目录：`D:\BaiduSyncdisk\study-log-workbench-public-rebuild\.local\candidate-rc6-wording-20261008`；安装包、服务器 ZIP、校验文件和版本草稿在该目录，首轮安装包仅保留为旧构建证据，不再作为发布候选。仍为未发布的 rc.6，rc.5 发布内容未变。

当前 Windows SHA-256：`e8bb06272f7738c45753c25a7b83f7b539b1a150cc8fbcd84f8815b0f89c09ec`；服务器 ZIP：`880957b7e87d288552c1652768a028e4a77cb517e5fa6465a59cde78d766474a`。

修正版实际验证：Web 类型检查及生产构建通过（`.local/wording-{typecheck,build}.log`）；相关 Web 测试 46 项通过（`wording-web-tests.log`）；初始化、归档、运行生命周期与目录选择 38 项通过、1 项 Linux 平台专用测试在 Windows 跳过（`wording-focused-final.log`）；鸿蒙 228 项协议测试和 HAP 构建通过（`wording-harmony-tests-final.log`、`wording-harmony-build.log`），没有安装设备。

独立 Playwright 的浏览器入口四组通过，覆盖目录状态、真实打包服务启停、启动失败及宽窄／浅深色界面（`.local/wording-launcher-browser/report.json`），截图已核对。最终打包 EXE 的更新检查测试覆盖版本、旧服务器、仅手动请求、新版链接、无更新、离线重试及认证远端；最终证据为 `.local/desktop-updates-1791450800927/report.json`（入口日志 `.local/wording-updates-final.log`）。其无更新提示明确只检查 Windows 桌面端，不含“实例”或“当前包含预发布版本”。

Web 与初始化工具镜像已按修正版重新构建，MCP 代码未变；本地 ACR rc.6 标签已更新，身份见 `.local/rc6-wording-images.json`。本次没有重新执行完整 Compose／问答矩阵，先前结果只作为未改动行为的基线，不冒称新镜像复测。包内生命周期及错误提示源码已与当前源码逐字节核对。

首轮测试中旧文案断言随实际提示更新；另一次并行测试的预算代理断言遇到异步记录读取时序问题，使用包内固定 Node 22 单独复核 3 项通过（`wording-proxy-recheck.log`），未修改代理实现或弱化其断言。浏览器脚本首次漏传包路径，补全入口参数后按原要求重跑。所有验证使用隔离合成数据，没有调用真实模型、覆盖日常安装、推送或发布。
