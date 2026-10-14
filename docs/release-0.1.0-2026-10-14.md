# 0.1.0 正式版发布记录

0.1.0 是 Windows x64 与 Linux amd64 自部署服务器的首个正式版本。版本内容以 `v0.1.0` 标签为准，rc.9 及更早预发布保持不变。

## 验证范围

- Web 类型检查和生产构建通过。
- 网页动效与加载反馈在 Chromium、WebKit 的浅色、深色、桌面和手机布局下完成检查，覆盖正常动效、减少动效、连续切换、慢请求、失败重试和稳定内容保留。
- Windows 最终包通过本地实例、二次启动、编辑保存、草稿关闭保护、正常重开、完整备份恢复和服务异常收尾检查。
- 三份 Linux amd64 镜像通过隔离 Compose 初始化、认证、日志与随记读写、材料资源、维护锁、只读 MCP、停止和同版本归档恢复检查。
- 全部检查使用隔离合成资料，没有写入真实日志或调用付费模型。

## 交付范围

- Windows：`study-log-desktop-0.1.0-x64-setup.exe`
- 服务器：`study-log-server-0.1.0.zip`
- 校验：`SHA256SUMS.txt`
- 镜像：`web:0.1.0`、`mcp:0.1.0`、`tools:0.1.0`

## 发布与安装结果

- 源码提交 `af518dc` 已推送，正式标签为 `v0.1.0`，公开发布页为 <https://github.com/Torry2022/study-log-workbench-public/releases/tag/v0.1.0>。
- Windows 安装包 SHA-256：`c58bc597caf81a4557ea4a472e130559d450abd1041e17188cd23763290c9a9b`。
- 服务器部署包 SHA-256：`949ba620ecf5b3339987e65eb908ee38d9be454e47e40cb4bdbf854ad32b5381`。
- `SHA256SUMS.txt` SHA-256：`ca60357d7016c2f18e90b1d6eade5ec0dce23de55f73d6f398cd43340dc58012`。三个附件从公开地址重新下载后与本地发布文件一致。
- web 镜像摘要：`sha256:4d10b0d56f9f40035cc83de53cc2c1cb9901879227bc34e1e9b7687125b9a758`。
- mcp 镜像摘要：`sha256:478b9f28a727b057f51fb9f4bf0edc3f39b877256e3416a657c8146b7fbe69d7`。
- tools 镜像摘要：`sha256:4fa21fd537b77d1465cf066578c80089bd73b4e4a7e5d69e9c1940c69adf3275`。三个镜像均通过空凭据 Docker 配置匿名拉取复核。
- 已在 `D:\Software\study-log-desktop` 覆盖安装。安装前备份并核对的 15 个记录、配置和历史文件全部未变，安装目录 5233 个候选文件与最终包一致。
- 安装后的独立实例报告版本 `0.1.0`，工作台地址返回 HTTP 200。rc.9 可检测到 0.1.0 更新，0.1.0 不再提示更新。
