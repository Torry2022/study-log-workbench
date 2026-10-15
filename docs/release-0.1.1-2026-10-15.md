# 0.1.1 发布记录

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

覆盖安装前已备份并核对原实例的 15 个记录、配置与历史文件，备份保存在忽略目录并限制访问。实际安装后的逐文件核对和启动结果在完成后补记，不能以隔离检查替代真实安装结果。本轮没有新增鸿蒙构建或真机验收，Agent 长材料效果评估仍未完成。
