# 学习日志工作台

面向愿意使用 Markdown 的技术学习者，按日期记录学习内容，保存当时的理解，并在需要时找回“那天学了什么”。可以写完整的技术笔记，也可以先留下几句话。

**记录 → 整理 → 找回与回顾。** 未配置 AI，也能开始使用。

## 能做什么

- **每日记录**：按月份和日期组织 Markdown，支持代码、公式、表格、Mermaid 和图片；提供常用格式操作、日志历史版本与单日恢复。
- **整理知识**：用随记保存零散想法，用收藏标记值得回顾的小节；导出已保存的内容与附件。
- **找回经历**：搜索日志、术语和代码；统计记录日期、数量与主题分布，不评价知识掌握程度。
- **按需使用 AI**：从材料生成待审阅草稿、重点标注和随记候选；三套技术学习写作预设可复制为个人方案。结果不会自动保存为日志。
- **带来源的问答**：配置聊天模型和检索服务后，从已有日志中查找答案。引用仍需核对，不保证模型理解正确。

## 选择使用方式

| 方式 | 适合谁 | 从哪里开始 |
| --- | --- | --- |
| Windows 本地使用 | 希望在一台电脑记录，不部署服务器 | [桌面端使用说明](docs/windows-desktop.md) |
| 自部署服务器 | 希望浏览器、Windows 和鸿蒙访问同一份资料 | [预构建镜像 + Docker Compose 部署指南](deploy/README.md) |
| 鸿蒙客户端 | 已有可连接的服务器实例 | [鸿蒙构建、签名与连接说明](study-log-harmony/README.md) |

Windows 桌面端既可本地使用，也可连接服务器。本地资料与服务器资料**各自保存，不会自动同步**；多个客户端连接同一服务器时才共用同一份资料。Windows 本地服务默认只供这台电脑访问。

这是单使用者工作台，不提供多用户账号、公共云服务或自动跨设备同步。源码按 MIT 许可开放；当前仍为试用阶段。

### Windows：安装后开始记录

1. 安装桌面试用包，首次打开选择“本地使用”，确认资料位置。
2. 点击“今天”，写下学习内容并保存；关闭应用会正常停止本地服务。
3. 需要 AI 时再到“文件 → 模型设置…”配置。需要独立备份时使用“文件 → 备份全部资料…”。

无需安装 Node、Docker 或另开浏览器。下载 [Windows x64 安装包](https://github.com/Torry2022/study-log-workbench-public/releases/download/v0.1.0-rc.3/study-log-desktop-0.1.0-x64-setup.exe)，或查看[预发布说明与 SHA-256 校验文件](https://github.com/Torry2022/study-log-workbench-public/releases/tag/v0.1.0-rc.3)。安装包尚未签名；也可按[桌面构建说明](docs/windows-desktop.md#开发与验收)自行构建。此前的[浏览器本地包](docs/windows-portable.md)仍保留，但不是首选入口。

### 服务器：使用预构建镜像

准备自己的 Linux amd64 主机及 Docker Compose，下载[服务器部署配置包](https://github.com/Torry2022/study-log-workbench-public/releases/download/v0.1.0-rc.3/study-log-server-0.1.0-rc.3.zip)（或使用 `deploy/` 中的文件），按[部署指南](deploy/README.md)完成初始化和启动。使用公开 ACR 镜像无需阿里云账号，也无需在服务器安装 Node 或构建源码。

镜像、Compose 示例和[版本说明](deploy/RELEASE-NOTES.md)配套使用；不要混用版本。首次先验证本机访问，再按需配置模型、HTTPS 和其他客户端。域名及服务器由部署者自行准备，本项目不提供公共服务地址，也不修改其他应用的配置。

## 资料、历史版本与备份

资料保存在明确指定的实例目录中，保留月／年 Markdown 文件组织方式。项目不会自动从源码父目录查找日志。

- **日志历史版本**用于恢复误改的某一天，默认保留；Windows 可设置开关和保留期限。它与原资料同处一个实例，不能代替独立备份。
- **整份资料备份**由用户主动创建，包含资料及实例配置，应另存到其他磁盘或设备；恢复写入新目录，不覆盖原实例。
- **导出**用于取出已保存内容，不等同于完整备份。归档包含密钥且未加密，请私密保存。

详见[备份与恢复](docs/backup-restore.md)。本地与服务器间搬迁不建立自动同步。

## 配置与开发

AI 接口、个人写作方案及只读检索配置见[AI 配置](docs/ai-configuration.md)和[部署说明](docs/deployment.md)。不配置向量或重排服务时，可使用关键词检索。

从源码运行需要 Node.js 22.13 或更新版本。以下为 Windows PowerShell 示例，在仓库根目录执行：

```powershell
npm --prefix study-log-web ci
node ops/instance.mjs init "D:\workbench-instance"
npm run build
node ops/run-web.mjs start "D:\workbench-instance" 3560
```

示例实例路径应尚不存在，或使用已初始化的有效实例。初始化不会在终端打印密码；在实例 `.env` 中查看 `APP_PASSWORD`，访问 `http://127.0.0.1:3560/study-log`。不要提交实例、环境文件、归档或签名材料。其他系统及 Docker 源码构建见[开发部署说明](docs/deployment.md)。

源码按 `study-log-web/`、`study-log-mcp/`、`study-log-harmony/` 和 `ops/` 组织。参考[架构](docs/architecture.md)、[接口契约](docs/api-contract.md)、[配套发布流程](docs/releasing.md)和[设计规范](DESIGN.md)；许可证见 [LICENSE](LICENSE)，依赖声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 当前边界

- Windows 安装、同版本覆盖安装、保留资料及归档恢复已有维护者测试；安装包未签名，跨版本数据迁移未完成验证。
- 服务器镜像当前支持 Linux amd64。部署版本及验证范围以[版本说明](deploy/RELEASE-NOTES.md)为准。
- 鸿蒙支持手机、平板和 PC，当前以源码构建和侧载为主。使用者需自行配置签名；维护者调试包不适用于所有设备。独立签名及异网络 HTTPS 连接仍待验。
- 保存时拒绝同一天的重名小节。重命名或调整小节顺序可能使已有内部链接失效。Wiki、分享、跨设备接续和鸿蒙独立离线存储暂未提供。

这些结果来自维护者及自动化验收，不代表外部用户反馈。详细记录保留在[实施状态](docs/implementation-status.md)、[桌面端说明](docs/windows-desktop.md)、[服务器验收](docs/server-deployment-acceptance.md)和[鸿蒙迁移记录](docs/harmony-migration.md)，不必先读这些记录才能开始使用。
