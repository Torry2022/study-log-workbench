# 0.1.1 发布记录

## 同版本补发：问答会话修复

按用户要求，保留版本号 0.1.1，将 `88a03d0` 的五项会话生命周期修复纳入本次补发。原标签、附件与镜像哈希的记录仍保留在下方；以下是新版产物，不应继续使用下方首次发布的校验值。

- Windows 安装包 SHA-256：`dd9bfdf856abd91a5e807e53f6f70e5ab7bce116c5669ef6428d764548ce9994`。
- 服务器 ZIP SHA-256：`e03722bd1e3a382828fd4585ac5c16161ef7444d8b7f470e1ae41e43114a2cb3`。
- 网页镜像 `web:0.1.1` digest：`sha256:4ce05f7d7197f11192cb836c3ab9152d489e8f7f20095be4bfca52ab1c34e53c`，已推送并以空凭据配置匿名拉取核对。MCP、维护工具镜像未变。
- 沿用本批全量 Web 494 项、Chromium／WebKit 生命周期、后台会话、原完整界面和实际后端入口检查结果，详见[生命周期复核](rag-session-lifecycle-2026-10-15.md)。Windows 新候选的六项隔离检查通过，截图已查看；Linux 新镜像的六项部署和三项问答检查通过。
- 产物与资料备份在 `.local/release-0.1.1-refresh-20261015/`，日志前缀为 `.local/release-0.1.1-refresh-`。桌面报告在 `.local/electron-smoke-1792034540347/report.json`，容器报告在 `.local/public-rebuild-b27-20261015032518734/report.json` 和 `.local/public-rebuild-rag-20261015032430112/report.json`。
- 本机覆盖安装退出码 0；15 个原记录、配置与历史文件保持不变，5233 个安装文件与候选一致，网页构建 ID 为 `CCH4GYEXM4YB18_EsCxLZ`。
- 从实际安装目录启动，工作区可见，桌面与服务版本均为 0.1.1，capabilities 返回 200，随后正常退出。安装与启动报告在本次产物目录内。

Windows 仍未签名；本次不新增鸿蒙构建，不代表个人版兼容验收或真实模型效果验收。后台生成仍限于工作台页面存续期间，不跨刷新或关闭续跑。已使用 0.1.1 的服务器须重新拉取镜像并重建容器；Windows 须重新下载此次安装包。

## 首次发布记录

本次为 0.1.0 之后的问答与日志导航修复版本。项目、网页和 Windows 版本更新至 0.1.1；MCP、维护工具与鸿蒙实现未改，服务器三个镜像使用配套 0.1.1 标签，鸿蒙继续使用原 0.1.0 HAP。旧版 Release 和附件保留。

## 验证与产物

- 全量 Web 494 项通过、3 项原权限跳过；类型检查及生产构建通过。
- 桌面更新逻辑四项测试通过；重新打包后的 Windows 程序六项隔离桌面检查通过，截图已查看。
- 使用发布用 `deploy/compose.yaml` 和实际 0.1.1 镜像完成六项部署及三项问答检查。合成实例、模型和 Embedding 替身，不调用付费服务。
- 三个镜像已推送，空凭据 Docker 配置匿名拉取成功，Digest 与本机候选一致。
- Windows 安装器未签名。服务器 ZIP 的四个文件逐项与 `deploy/` 内容一致。

| 附件 | SHA-256 |
| --- | --- |
| study-log-desktop-0.1.1-x64-setup.exe | `528f80dfeb7aab3a66fbe6b44c1c57fc8708f7cdac2524e5972ab06e2c3d7e82` |
| study-log-server-0.1.1.zip | `ce6fd4e2b8d7fed9c1da69545fa67e519dae40e0b369153a80d1fb581d89592a` |

镜像前缀 `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public`：

| 镜像 :0.1.1 | Registry digest |
| --- | --- |
| web | `sha256:a8f5b6a020d25f17d95c022208b425634d1d23907f7a51d33e435215021e3785` |
| mcp | `sha256:478b9f28a727b057f51fb9f4bf0edc3f39b877256e3416a657c8146b7fbe69d7` |
| tools | `sha256:4fa21fd537b77d1465cf066578c80089bd73b4e4a7e5d69e9c1940c69adf3275` |

## 本机证据

产物在 `.local/release-0.1.1-20261015/`。构建、测试、推送和匿名拉取日志使用 `.local/release-0.1.1-*.log`；桌面报告在 `.local/electron-smoke-1792027128497/report.json`，发布 Compose 验收报告在 `.local/public-rebuild-b27-20261015011803739/report.json` 与 `.local/public-rebuild-rag-20261015011803696/report.json`。

覆盖安装前已备份并核对原实例的 15 个记录、配置与历史文件，备份保存在忽略目录并限制访问。

## 已完成的发布和安装

源码及 `v0.1.1` 标签已推送，标签指向 `77707a0`。[GitHub Release](https://github.com/Torry2022/study-log-workbench-public/releases/tag/v0.1.1)已公开，Windows、服务器 ZIP 和 SHA256SUMS 均已上传；GitHub 附件 digest 与本机哈希一致，重新下载的服务器 ZIP 也一致。v0.1.0 标签和原附件保留。

已在 `D:\Software\study-log-desktop` 覆盖安装，安装器退出码 0；15 个原资料文件未变，5233 个候选文件与安装目录一致，网页构建 ID 为 `MEiOW-sSDclOvUjfqN0QP`。从实际安装目录启动，桌面和本地服务版本均为 0.1.1，工作区正常出现、capabilities 返回 200；随后正常退出。没有编辑真实记录或调用模型。

安装报告位于 `.local/release-0.1.1-20261015/install-report.json`，实际启动报告为同目录 `real-start-report.json`。本轮没有新增鸿蒙构建或真机验收，Agent 长材料效果评估仍未完成。
