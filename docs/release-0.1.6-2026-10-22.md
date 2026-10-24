# 0.1.6 发布记录

本版新增问题编辑和任务库版本 3，并统一应用图标、月份导航与日历显示。2026-10-24 交付的产品源码与 `v0.1.6` 标签均指向 `2f8e072`。根工程、Web、MCP、Windows 及鸿蒙保持 0.1.6，鸿蒙版本码为 10600；0.1.5 的标签、镜像和附件保留。

## 交付状态

Windows 安装包、Linux amd64 Web 镜像和鸿蒙未签名 HAP 已完成对应源码、打包内容及独立验收，并在 [v0.1.6 发布页](https://github.com/Torry2022/study-log-workbench-public/releases/tag/v0.1.6) 提供。各端实际入口与独立验收均使用隔离合成资料，未调用付费模型。

Linux Web 使用 Node 22.23.4，补验了原生 SQLite 事务、完整性检查、版本 3 任务库及问答任务/会话读取接口。

MCP、tools 和服务器部署 ZIP 的内容未变，继续使用此前的 0.1.6 交付。公开鸿蒙包不含维护者的签名证书或 Profile，使用者需自行签名；Windows 安装包未签名。

## 交付标识

| 文件 | SHA-256 |
| --- | --- |
| `study-log-desktop-0.1.6-x64-setup.exe` | `4dc482c92734bf0eca21d48ac76144d807c61bf01eb5b9dae0a491b1d4d64a33` |
| `study-log-harmony-0.1.6-unsigned.hap` | `ea657ef4a30e64ddcd9c80e8707b166e3ddebd838861fe096bf05634b9015c04` |
| `study-log-server-0.1.6.zip` | `cddb3e9a7c19be3aeb649b4225f8b9729da0337f7dbd8fad8016ad5341f64c8a` |

配套镜像前缀见[部署配置](../deploy/.env.example)，以下为公开 Registry 的 manifest digest：

| 镜像 | Digest |
| --- | --- |
| `web:0.1.6` | `sha256:d3909421b9799b9e067ddfc7511e6dd434491c348938e1b2fb89a952253bd96f` |
| `mcp:0.1.6` | `sha256:e3627307f8d9f99c9b324882f80debb6deaf4d000c7d9934664c1201df3a7026` |
| `tools:0.1.6` | `sha256:caf68f81c92acaa362890ca2c6aca4397bc09829e4d39f38116b44db6215ab5b` |

Web 镜像已用空 Docker 凭据配置完成匿名拉取并核对摘要。完整附件校验表随发布页的 `SHA256SUMS.txt` 提供。

## 兼容范围

受理首个编辑任务时，SQLite 任务库与任务写入在同一事务内升级到版本 3。0.1.6 tools 的完整归档与恢复已用实际容器和 Windows 打包工具核对；任务各列和 JSON 收据保留。归档内原始 SQLite 文件与源文件摘要一致；恢复事务会更新 SQLite 头部计数，不将整文件摘要变化误判为内容丢失。

0.1.5 tools 明确拒绝恢复该任务库，旧 Web 在启动时明确要求更新，源数据不变；换回新 Web 后不重放模型。服务器须配套升级 Web 和 tools，MCP 同批使用 0.1.6。更新前正常停止并备份，降级需恢复升级前的完整备份。

使用方式与安装说明见[版本说明](../deploy/RELEASE-NOTES.md)。
