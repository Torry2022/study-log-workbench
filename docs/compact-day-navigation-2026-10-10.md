# 长日志的悬浮日期导航

个人版 `StudyLogApp.tsx` 已有紧凑日期导航：展开的日期列表滚出视口后，在左侧提供上一篇、日期选择和下一篇。公开版迁移时遗漏了组件、触发逻辑与样式，并非 Windows 独立界面的问题。

本次在共享 `WorkspaceChrome` 补回，复用个人版样式和现有侧栏日期列表、搜索状态及日期切换入口。浮框跟随实际侧栏宽度；仅在桌面日志页、展开侧栏且日期列表末端滚出视口时出现。返回页面顶部、折叠侧栏、切换模块或进入阅读模式时隐藏，手机沿用原有导航抽屉。

日期切换继续经过已有未保存内容确认，不绕过草稿保护；搜索、标题定位、加载失败及空结果使用同一列表。点击外部或按 Escape 可关闭日期菜单。

验证使用隔离合成记录。专项脚本为 `ops/electron/compact-day-navigation-smoke.mjs`，覆盖独立 Chromium 和源码 Electron 的 1440／1100px、浅深色、滚动触发、搜索、点击层级、相邻日期、折叠侧栏、草稿取消、其他模块和手机界面。类型检查、最终生产构建和全部专项检查通过，无页面异常；证据位于本地 `.local/compact-day-navigation-1791646973873/report.json`，生产构建标识为 `yf-3NzzvKlz9HG4Z2MyzA`。八组宽度／主题／入口检查与两组草稿及其他界面检查通过，截图人工复核确认 1100px 侧栏内完整日期可见。

本批未打包、发布或覆盖日常安装，已发布 rc.9 不变。

## 2026-10-11 rc.9 替换候选

维护者明确要求“将rc.9换成改后的版本”，因此本次沿用同版本并替换发布内容。原标签对象为 `b2443d1dc95e361b622f3e5ad9e6d7618927a69b`，原产品提交为 `f4fc60ecbf308461c28dbc65768c6f008e7f3438`；旧包和旧证据仍保留在 `.local/release-rc9-onboarding-20261010/`。

新候选位于 `.local/release-rc9-navigation-20261011/`，包内 Web 构建为 `yf-3NzzvKlz9HG4Z2MyzA`。最终 EXE 与独立 Chromium 的八组宽度／主题检查及两组草稿、模块和手机检查全部通过，证据 `.local/compact-day-navigation-1791684401379/report.json`。最终 EXE 六组生命周期、保存、取消退出、重开及备份恢复检查通过，证据 `.local/electron-smoke-1791684459797/report.json`。

Linux amd64 Web 镜像重新构建并通过类型检查；配套 Compose 六组基础流程通过，证据 `.local/public-rebuild-b27-20261011020749652/report.json`。Web 镜像已上传并使用空认证配置匿名拉取，摘要为 `sha256:b329fef4199ab5ba1930ea740e6a5f1ec601f7af7fd160fca039be9d313cffd4`；MCP 与 tools 继续使用原 rc.9 镜像，无相关代码变化。

候选安装包 SHA-256 为 `2878c874f76badfe3e231d16b188e1a11c00e342aff5e96664ffce3f40fd1304`；服务器 ZIP 为 `5ac50022a08167cb1e5b005231bcf4457f69f92f7b0906c882be4b724b09c095`，四个部署文件逐字节核对。此次不覆盖日常安装、不修改已有学习记录，也不部署个人版服务器。
