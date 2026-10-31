## 新增

- 长对话分批读取：超过 20 轮时先打开最近 10 轮，向上阅读时每批补充 10 轮，并保持当前阅读位置。
- 宽屏鼠标操作支持近期消息刻度导航，悬停预览问题和回答摘要，点击后平滑定位到对应消息。
- 问答增加回到底部入口；阅读历史时可随时回到最新内容，并恢复回答跟随。
- Windows 增加启动窗口，显示打开工作台的进度；启动动效与鸿蒙保持一致。

## 改进

- 统计页统一日期明细、领域环图、图例及高频标签的布局。日期明细独立打开，查看小节后可返回原来的统计位置。
- 月份连续倒序显示，去掉年份分组标题。月份不超过 12 个时全部显示；更多月份按当年折叠，同时保留选中的往年月份。
- 网页和 Windows 内置界面及阅读字体，日期使用与鸿蒙一致的字体；调整日志小节标签、导航标题和应用内 Logo 的显示。
- 问答时间按今天、昨天及日期显示，缩小时间分隔的留白；回答生成、版本切换和来源定位保持阅读位置。
- Windows 减少启动时重复的系统查询；鸿蒙保存、刷新和恢复连接时保留已有列表与内容。

## 修复

- 修复鸿蒙宽屏设备触控板下拉刷新无法触发、部分加载反馈遮挡内容，以及侧栏底部小节被安全区截断的问题。
- 修复空问答输入框超出首屏、回到底部按钮在输入框收起后悬空，以及刷新后时间和状态提示挤动内容的问题。
- 修复失败回答无法切换版本、重新生成后未继续跟随，以及连接恢复后旧请求影响当前页面的问题。
- 修复统计环图点击出现大边框、提示溢出及明细跳转缺少返回入口的问题。
- 修复消息刻度定位后的多余外框，以及时间行贴近顶部遮挡边缘的问题。

## 下载与安装

| 平台 | 下载 |
| --- | --- |
| Windows x64 | [安装包](https://github.com/Torry2022/study-log-workbench/releases/download/v0.2.0/study-log-desktop-0.2.0-x64-setup.exe)，安装包未签名 |
| 服务器（Docker） | [部署包](https://github.com/Torry2022/study-log-workbench/releases/download/v0.2.0/study-log-server-0.2.0.zip)，配套 Linux amd64 Web、MCP、tools 镜像 |
| 鸿蒙 | [未签名 HAP](https://github.com/Torry2022/study-log-workbench/releases/download/v0.2.0/study-log-harmony-0.2.0-unsigned.hap)，使用自己的应用身份、证书和 Profile 签名 |

文件校验：[SHA256SUMS.txt](https://github.com/Torry2022/study-log-workbench/releases/download/v0.2.0/SHA256SUMS.txt)。使用说明：[Windows](https://github.com/Torry2022/study-log-workbench/blob/v0.2.0/docs/windows-desktop.md)、[服务器](https://github.com/Torry2022/study-log-workbench/blob/v0.2.0/deploy/README.md)、[鸿蒙](https://github.com/Torry2022/study-log-workbench/blob/v0.2.0/study-log-harmony/README.md)。

## 升级说明

- Windows 更新前保存草稿并正常退出。服务器更新前停止服务、创建完整备份，再使用配套的 `0.2.0` 部署文件与三个镜像。
- 从 0.1.5 或更早版本升级时，首次编辑已保存问题会将任务库升级到版本 3；降级应恢复升级前的完整备份。已使用 0.1.6 的实例沿用现有任务库格式。

**完整更新**：[v0.1.6 首发 → v0.2.0](https://github.com/Torry2022/study-log-workbench/compare/1bdf1fb36d203ebfa12926226cfe78f88b9e2e84...v0.2.0)。
