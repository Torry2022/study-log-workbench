## 改进

- 鸿蒙首次打开时可直接在首页连接工作台。宽屏左侧显示应用介绍，右侧填写连接信息。
- 鸿蒙、网页和 Windows 将工作台、AI 服务与外观偏好放入设置。Windows 首次使用时可选择在本机保存记录，或连接已有工作台。
- 工作台可集中管理 AI 模型。管理员开启远程修改后，可在客户端确认访问密码并保存设置。从具体功能进入设置时，保存后返回原页面并保留输入。

## 修复

- 窄窗口下，日志日期选择器留在边栏内，标题栏按优先级收起按钮文字，右侧面板避开标题栏。
- 鸿蒙更换连接时先验证新工作台。连接失败或取消后继续使用原工作台，主动断开也会保留本机草稿。
- 鸿蒙连接地址支持大写或混合大小写的 HTTP、HTTPS 协议名。

## 下载与安装

| 平台 | 下载 |
| --- | --- |
| Windows x64 | [安装包](https://github.com/Torry2022/study-log-workbench/releases/download/v0.3.0/study-log-desktop-0.3.0-x64-setup.exe)，安装包尚未签名 |
| 服务器（Docker） | [部署包](https://github.com/Torry2022/study-log-workbench/releases/download/v0.3.0/study-log-server-0.3.0.zip)，配套 v0.3.0 Linux amd64 镜像 |
| 鸿蒙 | [未签名 HAP](https://github.com/Torry2022/study-log-workbench/releases/download/v0.3.0/study-log-harmony-0.3.0-unsigned.hap)，使用自己的证书和 Profile 签名 |

[SHA-256 校验](https://github.com/Torry2022/study-log-workbench/releases/download/v0.3.0/SHA256SUMS.txt) · [鸿蒙安装说明](https://github.com/Torry2022/study-log-workbench/blob/v0.3.0/study-log-harmony/README.md)

服务器升级前，请按[部署指南](README.md)备份资料，并使用同版本部署包和镜像。

**完整更新** [v0.2.2 → v0.3.0](https://github.com/Torry2022/study-log-workbench/compare/v0.2.2...v0.3.0)
