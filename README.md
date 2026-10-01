# 学习日志工作台

面向单个使用者的自部署 Markdown 工作台。日志、随记和附件保存在你指定的实例目录中；网页负责阅读、编辑、检索与整理，不要求把个人资料放进源码仓库。网页核心功能及维护者自部署回归已完成，**独立使用者从零试装尚未完成**，当前不标为正式发行版。验收范围见[实施状态](docs/implementation-status.md)。

## 能做什么

- 按月份、日期阅读和编辑日志，预览 Markdown、数学公式、Mermaid 和附件；支持日块版本冲突提示、写前备份与单日恢复。
- 搜索日志，整理随记、收藏和学习统计；导出已保存的内容与附件。
- 按需配置兼容的聊天模型，生成待审阅日志草稿、重点标注和随记候选。AI 结果不会自动写入原日志。
- 按需启用只读 MCP，以原始日志为来源进行带引用的问答；向量与重排服务是独立的可选配置。网页不包含个人版的 Wiki 编译和专用写作 Skill。

未配置 AI 或 MCP 时，日志读写、搜索、随记、收藏、统计和导出仍可使用。项目采用单使用者、单 Web 工作进程；不会从源码父目录自动查找日志，也不提供多用户账号或公共云服务。

## 从空目录开始

推荐先看[Docker 自部署步骤](docs/deployment.md#docker-安装)，其中包含 Linux 目录权限、初始化、启动和停止流程。需要 Docker Engine/Desktop、Docker Compose 2.24 或更新版本；当前实际容器验收目标为 Linux amd64。初始化会在独立实例目录生成访问密码和会话密钥，**不要将实例目录、归档或环境文件提交到 Git**。

不使用 Docker 时，需要 Node.js 22.13 或更新版本。在仓库根目录执行：

```sh
npm --prefix study-log-web ci
node ops/instance.mjs init "/absolute/path/to/new-instance"
npm run build
node ops/run-web.mjs start "/absolute/path/to/new-instance" 3560
```

将示例路径换成尚不存在的实例目录绝对路径；Windows 路径可写为 `"D:\workbench-instance"`。随后从实例根目录的 `.env` 中读取 `APP_PASSWORD`，打开 `http://127.0.0.1:3560/study-log` 登录。首次使用可在页面新建日期并编辑日志；如需导入现有资料，先阅读[实例目录及数据边界](docs/deployment.md#实例目录和挂载)，保留原始文件副本，并使用自己的实例路径。更多 Node 启动细节见[部署文档](docs/deployment.md#不使用-docker)。开发时可运行 `npm run dev -- "/absolute/path/to/new-instance" 3560`；这不是正式服务或维护操作的入口。

## 可选服务与备份

聊天服务需要在实例配置中显式填写地址、模型和密钥；实例内的三个通用模板可自行编辑，见[AI 配置](docs/ai-configuration.md)。日志问答还需独立启用[只读 MCP](docs/deployment.md#启用可选-mcp)。密钥只保存在你的实例配置中，不要写入仓库或反馈截图。

页面“导出”用于取出已保存内容，不能代替灾难恢复。完整搬迁与恢复需停机后归档 `data/`、`backups/` 和实例配置，并恢复到不存在的新目录，见[整实例备份与恢复](docs/backup-restore.md)。目前只验收同版本恢复；跨版本升级、断电恢复和接近归档上限的资源压力不在通过范围。

## 当前验收边界

维护者已用合成资料完成网页生产构建、主要浏览器流程、Linux 容器部署和少量真实模型调用；详细结果在[实施状态](docs/implementation-status.md)、[浏览器回归](docs/web-regression-b28.md)和[模型小样本记录](docs/model-validation.md)。独立使用者安装仍须按[试装清单](docs/independent-install-checklist.md)取得证据，维护者本机测试不能替代。真实向量/重排提供方、复杂材料的模型质量和 Firefox 也未完成相应验收。鸿蒙主要模块已接入，仍在源码对齐和跨端验收中；这不改变网页独立试装的未通过状态。

源码位于 `study-log-web/`、`study-log-mcp/`、`study-log-harmony/` 和 `ops/`；接口与数据约束见[架构](docs/architecture.md)及[API 契约](docs/api-contract.md)。界面修改遵循 [DESIGN.md](DESIGN.md)。项目代码按 MIT 许可发布；第三方依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 鸿蒙客户端

客户端连接你明确配置的自部署 Web/API，支持手机、平板和 PC（2in1）。构建要求和签名边界见[客户端说明](study-log-harmony/README.md)。本阶段面向源码构建及侧载验证，尚未完成独立签名安装与外部网络连接验收，也未完成完整视觉／动效矩阵，不能视为可直接安装的正式发行版。

已完成项目与历史证据见[鸿蒙迁移记录](docs/harmony-migration.md)，当前 R1–R6 收尾范围见[工作台恢复与剩余批次](docs/harmony-workspace-recovery.md)。源码对照及需要交给个人版核查的事项集中在[源码对齐审计](docs/harmony-source-alignment-audit.md)；其中源码风险、公开版复现和原版设备复现是不同证据，不应直接整批回填。

目前还有两项使用限制：同日同名标题的内部文本链接可定位选中的小节，但标题或顺序变化后定位 ID 可能失效并回退到第一个同名标题；随记记录时间按北京时间解释，设备时钟快于服务器时可能被拒绝为未来时间。遇到后者可核对设备时间或手动选择正确的记录时间，服务端不会为通过校验而自动改写记录时间。Wiki、分享、跨设备接续与完整离线能力仍属后续进阶议题。
