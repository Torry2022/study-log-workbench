# 右侧栏滚动后的底部空缺

## 原因与修正

右侧栏使用 `position: sticky; top: 0`，但高度固定为视口减 64px。初始页面顶部的导航占 64px，这个尺寸合适；导航滚出窗口后，右栏贴到窗口顶部，仍扣除 64px，于是底部留下空缺。旧生产构建在合成示例日志上复现：只滚动 32px，底部就缺 32px，独立断言失败，证据 `.local/inspector-scroll-before.log`。

共享 `WorkspaceChrome` 按顶部导航实际可见高度更新右栏 CSS 变量，初始只占剩余视口，导航滚出后占满视口；滚动与窗口变化均更新，不改变正文滚动位置或文档内容。展开和收起共用此规则，中等宽度的下方展开布局与手机固定抽屉继续使用已有响应式覆盖。没有桌面专用样式注入，没有用背景填充掩盖空缺。

## 验证与交付范围

- Web 类型检查、生产构建通过：`.local/inspector-typecheck.log`、`.local/inspector-build.log`。
- 独立 `ops/electron/inspector-scroll-smoke.mjs` 使用新建合成工作台，普通 Chromium 与源码 Electron 各检查 1440／1280 宽度、浅／深色、展开／收起、顶部／32px／中间／底部共 64 组，断言右栏底边与视口底边误差不超过 1px。
- 删除合成示例后确认空状态未增加根页面溢出，420px 手机抽屉保持视口高度；无页面异常。代表性的 Electron 深色收起与 Chromium 浅色展开截图已核看。证据 `.local/inspector-scroll-1791546527876/report.json`。

本批仅修正共享网页的右栏尺寸；未打包、推送、发布、部署或覆盖日常安装。当前已安装包仍是本修正前的本地包，重新打包安装后才能获得修正。

## 后续授权覆盖安装

维护者随后授权覆盖安装。从 `2c49051` 重新生成 Windows 包，沿用本地 rc.8 版本，不改公开附件。安装包位于 `.local/inspector-install-20261009/desktop/study-log-desktop-0.1.0-rc.8-x64-setup.exe`，SHA-256 为 `f33fcd3446eeacec764669e4b3de9ed9765c40cabe96732bb13c563cb4bfb3c6`。

独立脚本支持传入打包 EXE，最终程序的 64 组滚动检查、空状态和手机抽屉通过，证据 `.local/inspector-scroll-1791546717281/report.json`；包内 Web BUILD_ID 与本次生产构建一致。

确认维护者正常退出后，NSIS 覆盖 `D:\Software\study-log-desktop` 返回 0。安装前后 12 个学习记录与配置文件哈希全部一致；安装后的 `app.asar` 与候选一致，Web BUILD_ID 与本次构建一致。没有推送、公开发布或操作服务器。
