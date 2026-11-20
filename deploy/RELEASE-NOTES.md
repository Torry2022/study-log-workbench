## 新增

- 鸿蒙首次打开即可在首页连接工作台。
- Windows 首次使用时可选择在本机保存学习记录，也可连接已有工作台。
- 工作台支持集中管理 AI 模型。开启远程修改后，可在客户端的「AI 服务」中配置模型。

## 改进

- 网页、Windows 和鸿蒙可在设置中管理工作台连接、AI 服务和外观偏好。
- 从问答等功能进入 AI 设置，保存后可回到原页面继续操作，已输入的内容会保留。
- 鸿蒙更换工作台时先验证新连接。取消或验证失败后仍可使用原工作台，断开连接后本机草稿会保留。

## 修复

- 修复窄窗口下日志日期选择器越出侧栏的问题。标题栏按可用空间逐步收起按钮文字，右侧面板避开标题栏。
- 修复鸿蒙连接地址使用大写 HTTP 或 HTTPS 时无法连接的问题。
- 鸿蒙流式回答结束后可查看全文，切换会话会结束上一条回答的显示任务。
- 鸿蒙宽屏分屏支持双栏一起回到顶部，停止滚动后回顶按钮会自动隐藏。

## 下载与安装

| 平台 | 下载 |
| --- | --- |
| Windows x64 | [安装包（未签名）](https://github.com/Torry2022/study-log-workbench/releases/download/v0.3.0/study-log-desktop-0.3.0-x64-setup.exe) |
| 服务器（Docker） | [部署包](https://github.com/Torry2022/study-log-workbench/releases/download/v0.3.0/study-log-server-0.3.0.zip) |
| 鸿蒙 | [HAP（需自行签名）](https://github.com/Torry2022/study-log-workbench/releases/download/v0.3.0/study-log-harmony-0.3.0-unsigned.hap) |

[SHA-256 校验](https://github.com/Torry2022/study-log-workbench/releases/download/v0.3.0/SHA256SUMS.txt) · [Windows 安装说明](https://github.com/Torry2022/study-log-workbench/blob/v0.3.0/docs/windows-desktop.md) · [服务器部署指南](https://github.com/Torry2022/study-log-workbench/blob/v0.3.0/deploy/README.md) · [鸿蒙安装说明](https://github.com/Torry2022/study-log-workbench/blob/v0.3.0/study-log-harmony/README.md)

## 升级说明

- 服务器升级前请备份资料，并使用 v0.3.0 部署包和配套的 Linux amd64 镜像。

**完整更新** [v0.2.2 → v0.3.0](https://github.com/Torry2022/study-log-workbench/compare/v0.2.2...v0.3.0)
