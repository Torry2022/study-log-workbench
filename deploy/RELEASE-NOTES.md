## 改进

- 网页、Windows 和鸿蒙在宽屏分屏时左侧显示预览，右侧显示源码。鸿蒙支持从任一栏滚动时同步另一栏。
- 鸿蒙日志标题栏收窄时，浏览、源码和分屏使用方形图标按钮。

## 修复

- 修复鸿蒙快速切换日志模式时，旧的读取结果可能覆盖当前画面的问题。
- 鸿蒙问答完成后显示完整回答。切换会话时，目标会话加载成功后才清除已确认放弃的输入。
- 鸿蒙统计切月失败时，标题与图表继续显示同一个月，重试成功后切换。

## 下载与安装

| 平台 | 下载 |
| --- | --- |
| Windows x64 | [安装包](https://github.com/Torry2022/study-log-workbench/releases/download/v0.2.2/study-log-desktop-0.2.2-x64-setup.exe)，安装包尚未签名 |
| 服务器（Docker） | [部署包](https://github.com/Torry2022/study-log-workbench/releases/download/v0.2.2/study-log-server-0.2.2.zip)，配套 v0.2.2 Linux amd64 镜像 |
| 鸿蒙 | [未签名 HAP](https://github.com/Torry2022/study-log-workbench/releases/download/v0.2.2/study-log-harmony-0.2.2-unsigned.hap)，使用自己的证书和 Profile 签名 |

[SHA-256 校验](https://github.com/Torry2022/study-log-workbench/releases/download/v0.2.2/SHA256SUMS.txt) · [鸿蒙安装说明](https://github.com/Torry2022/study-log-workbench/blob/v0.2.2/study-log-harmony/README.md)

服务器升级前，请按[部署指南](README.md)备份资料，并使用同版本部署包和镜像。

**完整更新** [v0.2.1 → v0.2.2](https://github.com/Torry2022/study-log-workbench/compare/v0.2.1...v0.2.2)
