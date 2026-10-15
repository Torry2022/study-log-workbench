# 0.1.0 修复候选包

源码节点 `0a26488`，沿用 0.1.0 版本号。本轮仅本地打包和隔离验证，没有推送、替换 Release 附件或覆盖已安装应用。

## 候选产物

安装包：`.local/candidate-0.1.0-20261015/desktop/study-log-desktop-0.1.0-x64-setup.exe`。

- 大小：160,307,055 字节，约 152.88 MiB。
- SHA-256：`dd4584b5dd906c8b8f2a71a5e930043340e8f04ed24d16c478a03df7f5dcaa06`。
- Authenticode 状态：NotSigned。
- 网页构建 ID：`xxX3TXHmnLd8lEw15ovPx`；运行时 Node 22.23.3，使用打包器既有官方哈希校验。

本包纳入已通过复核的导航动效、问答范围与来源变化终止、SDK 用量留存修复。产物保持在忽略目录，不纳入 Git。

## 实际验证

1. `ops/rag-package-smoke.mjs` 使用包内 Node／Web／MCP、隔离合成记录和供应商替身，验证真实问答入口、完整模型 URL、SDK、会话保存、来源跳转、后台完成及桌面／手机界面，通过。没有付费调用。
2. `ops/electron/smoke.mjs` 在候选 `win-unpacked` 上通过六项检查：默认实例及隔离渲染、第二次启动、真实编辑保存与取消关闭、退出解锁和重开、备份恢复与菜单打开、专属 Web worker 异常反馈。
3. 用缓存中的 7-Zip 解出安装器内实际载荷，逐文件核对 SHA-256，5233 个文件全部与已测 `win-unpacked` 匹配。7-Zip 返回成功，附带自解压文件尾部数据警告；没有据此执行安装或删改任何现有程序。
4. 对安装器实际载荷再执行完整六项桌面检查，全部通过；使用另一个全新临时配置目录。两轮截图已实际查看，保存的合成内容及草稿反馈正常。
5. 载荷检查未发现 `.env`、运行锁 owner 或桌面实例配置文件。

证据位于 `.local/candidate-0.1.0-20261015-package.log`、`.local/candidate-rag-20261015.log`、`.local/candidate-desktop-20261015.log`、`.local/candidate-payload-hashes-20261015.txt`、`.local/candidate-installer-start-20261015.log`；桌面报告分别在 `.local/electron-smoke-1792025992153/report.json` 和 `.local/electron-smoke-1792026083710/report.json`。

没有执行 NSIS 安装向导、注册表安装／卸载或真实覆盖安装；不能将解包启动检查表述为这些安装流程已通过。既有 `install-smoke.mjs` 要求没有现存安装和应用资料，不适合当前机器，未绕过其保护运行。

## 网页镜像未完成

此节记录 Windows 打包时的阻塞。随后 Docker 引擎恢复，网页候选已构建并通过容器验收，当前结果见[网页候选记录](docker-candidate-2026-10-15.md)。以下保留当时检查结果。

Docker 引擎首次检查缺少 Linux 引擎管道；正常启动命令报告 Docker Desktop 已运行，但随后 `docker info` 持续无响应，已取消这条检查命令。没有重置、删除虚拟磁盘或清理 Docker 数据。本轮未生成新的 Linux amd64 网页镜像，也未更新服务器部署包、镜像标签或线上附件。后续须先恢复引擎，再按 `ops/web.Dockerfile` 构建并完成容器验收；不能用 Windows 包通过代替该验收。
