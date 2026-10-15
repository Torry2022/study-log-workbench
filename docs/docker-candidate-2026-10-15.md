# 0.1.0 网页修复候选镜像

Docker 引擎恢复后，使用 `ops/web.Dockerfile` 在本机完成 Linux amd64 构建。网页源码与 Windows 候选包一致；源码节点为 `2bfabaf`，较 Windows 打包节点仅增加交付说明。

- 本地标签：`study-log-public-web:candidate-20261015`。
- 镜像 ID：`sha256:5e6779c971fcd57e95215781d283ed5ab316d5cd82e43cea7b7259cf3f222f81`。
- 平台：`linux/amd64`。
- 构建内的类型检查和生产构建通过。

没有覆盖正式 `0.1.0` 标签，没有推送镜像或修改 Release。MCP 和 tools 源码没有本轮变化，验收复用本机已有公开 0.1.0 镜像：MCP `478b9f28a727`、tools `4fa21fd537b7`，均为 Linux amd64。

## 容器验收

`ops/docker-smoke.mjs` 六项通过：初始化及重复初始化保护、网页鉴权和空模型配置、日志随记保存、PDF／DOCX 资源、UID1000 与重启、MCP 只读和独立环境、备份恢复。使用全新合成实例，没有连接真实资料。

`ops/docker-rag-smoke.mjs` 三项通过：网页→MCP→模型替身的 SSE done 和引用；模拟 Embedding 后的真实 MCP hybrid 检索与独立索引；回答期间 SIGTERM 后流完成、正常退出、释放锁、原日志不变。没有付费模型调用。

验收脚本原先将网页问答诊断字段当作底层检索模式；当前网页统一报告 `bounded_evidence`。本次只适配断言：网页仍检查正常结束及引用，关键词／hybrid 模式改为直接调用容器内真实 MCP 并分别断言，不删掉模式检查。首次新增探测按 JSON 读取时遇到 MCP 的 SSE 响应，随后补齐现有 JSON／SSE 两种传输解析，最终完整脚本通过。产品实现没有因此修改。

证据：

- `.local/candidate-docker-build-20261015.log`。
- `.local/candidate-docker-smoke-20261015.log` 和 `.local/public-rebuild-b27-20261015010922624/report.json`。
- `.local/candidate-docker-rag-20261015.log` 和 `.local/public-rebuild-rag-20261015010951720/report.json`。

每个脚本只清理自身新建 Compose 项目的容器和网络；没有执行全局 Docker 清理或删除镜像。合成记录与验收报告仍留在忽略目录。

## 交付状态

Windows 修复候选包和网页镜像均已完成本机验收，之前 Docker 引擎阻塞已解除。下一步才是镜像推送、Release 更新和覆盖安装；本轮均未执行。没有新增鸿蒙 HAP 或设备验收，也没有真实模型质量对照。
