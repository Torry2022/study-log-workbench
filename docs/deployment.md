# 本地运行与 Docker 自部署

当前产品为单使用者、单 Web 工作进程的工作台，固定入口 `/study-log`。Windows 本机使用优先按[桌面端说明](windows-desktop.md)操作，无需安装 Node 或 Docker。下文面向源码运行和 Docker 自部署；Docker 的 Web、MCP、维护工具默认使用官方 Node 22 镜像，不需要个人域名、Registry 或云账号。以下流程只支持同版本归档恢复；跨版本升级与回退尚未验收。

## Docker 安装

服务器使用者优先选择 [预构建镜像部署入口](../deploy/README.md)，只需部署文件，不在服务器执行源码构建；当前候选版本由部署目录的版本说明维护，镜像提供匿名拉取，默认地址见部署目录 `.env.example`，版本限制见随包说明。下文保留维护者／源码使用者的构建方式。两套 Compose 共享同样的运行边界，并通过实际解析后的配置对照检查。

需要 Docker Engine/Desktop 与支持可选 `env_file` 的 Docker Compose 2.24 或以上。当前构建验收目标是 Linux amd64。首次构建需要能访问 npm 官方 Registry 和 Node 基础镜像；本地缓存成功不能证明所有地区的网络可安装性。

在仓库根目录操作。默认实例位于 `.local/instance`，父目录为 `.local`。可复制根 `.env.example` 为根 `.env`，设置 `INSTANCE_PARENT`、`INSTANCE_ROOT`、`WEB_PORT`；根 `.env` 只配置 Compose，不放应用密钥。实例根必须位于供 tools 挂载的父目录内。

Linux 首次创建全新父目录：

```sh
mkdir -p .local
sudo chown 1000:1000 .local
```

所有镜像使用 `USER node`，UID/GID 为 1000。数据目录和备份目录必须可被该 UID 写入，MCP 来源目录只需读取。这里只更改新父目录的所有者，不递归修改现有资料。宿主用户不是 UID 1000 时，应由管理员提供专用目录并管理其权限；不要直接将未知权限的旧实例交给容器。Windows Docker Desktop 可在 PowerShell 使用 `New-Item -ItemType Directory -Force .local`；NTFS 映射不代表已验证 Linux 文件所有权迁移。

```sh
docker compose build tools
docker compose run --rm tools ops/instance.mjs init /instances/instance
docker compose build web
docker compose up -d web
```

tools 初始化不要求任何 `.env` 已存在。它生成实例 UUID、随机密码、会话密钥和公共提示模板；输出只有凭据文件位置，不输出密钥。重复初始化仅补缺，不覆盖原凭据、身份或模板。Web 的环境文件虽然允许 Compose 在初始化前解析，但缺少有效凭据时服务会拒绝启动。

用本机编辑器打开 `.local/instance/.env`，查看 `APP_PASSWORD` 后在 `http://127.0.0.1:3560/study-log` 登录。不要分享该文件。默认没有 AI 提供方配置，仍可编辑日志、随记和导入材料。聊天配置见 [AI 配置](ai-configuration.md)。修改实例环境后执行 `docker compose up -d --force-recreate web`；仅 `restart` 不会重新装载环境文件。

Compose 仅把 Web 映射到主机 loopback。网络访问者需要自行配置 HTTPS 反向代理，并将实例 `.env` 中 `COOKIE_SECURE=true`；保持 `/study-log` 路径及流式响应。文档不附带未经验证的证书、域名或公网发布自动化。

## 实例目录和挂载

| 路径 | 用途 | 容器权限 |
| --- | --- | --- |
| 实例根 `.env` | Web 密码、会话密钥、聊天配置、MCP 客户端配置 | 作为环境加载，不挂载给 Web |
| 实例根 `.env.mcp`（可选） | MCP token、向量与重排配置 | 只加载给 MCP |
| `data/` | UUID、月/年原始日志、随记、附件、模板、会话等权威资料 | Web 读写，MCP 只读 |
| `backups/` | 写入前备份等用户恢复资料 | Web 读写，不挂载给 MCP |
| `index/` | 可重建向量缓存和独占锁 | 只挂载给 MCP 读写 |

Compose 要求这些挂载源已经存在，拒绝自动创建拼错的数据目录。源码、运行数据和环境配置不会被 Docker 构建上下文一起打入镜像。Web standalone 镜像包含 Markdown/AI 运行依赖、PDF worker/字体资源、维护锁入口和公共模板；它不依赖开发机的 `node_modules`。

## 启用可选 MCP

基础写作不依赖 MCP。原始日志问答需要聊天提供方与 MCP 都配置完成。先创建私密的实例 `.env.mcp`，其中填写本地生成的随机 token：

```dotenv
MCP_HTTP_TOKEN=<随机长token>
```

在实例 `.env` 加入：

```dotenv
STUDY_LOG_MCP_URL=http://study-log-mcp:3020/mcp
STUDY_LOG_MCP_TOKEN=<与MCP_HTTP_TOKEN完全相同的token>
```

Linux 上为 `.env.mcp` 设置 UID 1000 所有、权限 0600。可从 [MCP 环境示例](../study-log-mcp/.env.example) 复制可选 embedding/rerank 字段；无需复制其路径，Compose 会设置容器内绝对路径。聊天、向量、重排分别配置 key、完整 URL 和模型，不会自动借用其他提供方凭据。

```sh
docker compose --profile retrieval build web study-log-mcp
docker compose --profile retrieval up -d
```

MCP 不发布任何主机端口，只供 Compose 网络中的 Web 使用。默认白名单允许服务名 `study-log-mcp`；健康检查也必须携带 token。没有向量配置时使用关键词检索，不创建索引或索引锁；向量配置有效时启动会独占 `index/.mcp-index.lock`。来源是只读原始日志，不包含随记或 Wiki。具体协议、取消限制、配置和缓存边界见 [MCP README](../study-log-mcp/README.md)。

## 停机、备份与恢复

Docker 的正式 Web 入口是 `node ops/serve.mjs study-log-web/server.js`，源码运行使用 `ops/run-web.mjs`；两者在服务整个生命周期持有与维护工具共享的数据锁。Windows 包由启动入口管理同一实例锁及 Web／MCP 子进程。不要绕过这些入口直接运行 standalone、叠加多个 Web 副本或做在线归档。MCP 使用独立索引锁；维护前仍须停止 Web、MCP 和外部编辑器。

Compose 启用 init 转发信号，Web 设置 240 秒停止宽限期，MCP 设置 120 秒。Web 的宽限期覆盖完整问答链路：上下文理解最多 20 秒、检索规划 20 秒、MCP 调用总限时 60 秒、回答生成 90 秒，合计约 190 秒，另留收尾空间。不能只按单次模型请求的 90 秒计算。正常子进程退出才释放数据锁；超过宽限期被强杀或异常退出会保留遗留锁，不会自动按时间/PID 删除。遇到遗留锁按 [维护说明](maintenance.md) 核查，不能以重新 init 作为解锁方法。

同版本停机归档：

```sh
docker compose --profile retrieval stop
docker compose run --rm tools ops/archive-cli.mjs backup /instances/instance /instances/instance-backup.slarchive
docker compose run --rm tools ops/archive-cli.mjs verify /instances/instance-backup.slarchive
```

归档包含秘密配置及资料，应与生成的同名 `.sha256` 摘要文件一起私密保存。向量 index 不纳入归档，可重建。不能将归档放入实例自身数据或备份目录，也不能覆盖已有归档；每次使用新名称。

恢复到不存在的新目录：

```sh
docker compose run --rm tools ops/archive-cli.mjs restore /instances/instance-backup.slarchive /instances/restored
```

恢复完成后，把根 Compose 配置中的 `INSTANCE_ROOT` 改为对应宿主路径 `.local/restored`，再 `docker compose --profile retrieval up -d`。原 UUID、凭据、模板及资料保留；新文件的修改时间可能变化，因此并发写入版本号不保证与恢复前相同，应重新加载后再编辑。已经存在的恢复目标不会被覆盖；失败目标须保留检查，选择另一个新目录重试。推荐使用相同 UID 的 tools 容器完成备份和恢复；用不同宿主用户恢复后再交给 Docker 的权限转换不能自动保证。归档格式和限制见 [完整备份恢复说明](backup-restore.md)。

## 不使用 Docker

安装 Node.js 22.13 或以上；在仓库根目录执行：

```sh
npm --prefix study-log-web ci
node ops/instance.mjs init <新实例绝对路径>
npm run build
node ops/run-web.mjs start <实例绝对路径> 3560
```

`run-web` 从指定实例读取 `.env`，设置数据/备份路径并持有维护锁。可选 MCP 需要另外在其目录 `npm ci`，按 MCP README 显式传入根目录、token 和模型设置。停机后可用同一组 `node ops/archive-cli.mjs` 命令维护。不要让宿主 Web 和 Docker Web 同时连接同一实例。

## 验证范围

维护者可构建独立测试镜像：

```sh
docker build --platform linux/amd64 -f ops/web.Dockerfile -t study-log-public-rebuild-web:b27 .
docker build --platform linux/amd64 -f ops/tools.Dockerfile -t study-log-public-rebuild-tools:b27 .
docker build --platform linux/amd64 -t study-log-public-rebuild-mcp:b27 study-log-mcp
node ops/docker-smoke.mjs
node ops/docker-rag-smoke.mjs
```

基础脚本只创建新的 `.local/public-rebuild-b27-*` 合成实例，以 `127.0.0.1:3580` 验证初始化、登录、未配 AI 时写入、PDF/DOCX 提取、重启、MCP 只读检索、离线恢复与字节一致性。RAG 脚本使用 `127.0.0.1:3581`，模型替身仅位于项目内部 Docker 网络，验证关键词与向量两模式的问答引用和 SSE 完成事件，以及收到 delta 后 SIGTERM 停机；不调用外部模型。两个脚本结束后只关闭自己的 Compose 项目，保留报告和合成资料供检查。使用已批准的基础镜像来源时，可给构建命令加 `--build-arg NODE_IMAGE=<镜像引用>`，不必修改全局镜像标签。

若要验收其他标签的当前构建，可在运行脚本前设置 `WEB_IMAGE`、`MCP_IMAGE` 和 `TOOLS_IMAGE`；未设置时仍使用上方的 `b27` 标签。三个变量都应指向同一源码版本构建的镜像，避免把旧标签的测试结果当作当前提交的结果。Windows PowerShell 示例：`$env:WEB_IMAGE='study-log-workbench-web:local'; $env:MCP_IMAGE='study-log-workbench-mcp:local'; $env:TOOLS_IMAGE='study-log-workbench-tools:local'`，然后分别运行 `node ops/docker-smoke.mjs` 和 `node ops/docker-rag-smoke.mjs`。

2026-09-22 维护者在 Docker Desktop 的 Linux amd64 / Node 22 环境运行上述闭环通过：同版本恢复后所覆盖文件字节一致；长问答停机等待约 19 秒，流正常完成、Web 退出码为 0、原日志未变且 Web/MCP 锁释放。MCP 的 Linux 非 root、禁外网合成测试 49/49 通过，包含 Windows 下不能执行的文件符号链接用例。

2026-10-06 的[独立目录自行试装](self-install-2026-10-06.md)已覆盖新凭据、浏览器记录与附件、冲突、断网及恢复后读回；操作者为维护者，未要求另一个人执行。Windows 本地包另通过 24 项桌面／归档专项、解压包四流程及 VBS 启动检查，界面一致性调整后已复测解压包流程，见[本轮实施记录](product-iteration-acceptance.md)。这些结果不代表第三方用户反馈、真实模型总体质量或跨版本升级保证；鸿蒙独立签名和异网络受信 HTTPS 仍分别待验。

Windows 检查使用解压包内的 `runtime\node.exe`：`--test ops/desktop/desktop.test.mjs ops/archive.test.mjs` 共 24 项无跳过；`ops/desktop/smoke-package.mjs` 的四流程报告在仓库忽略目录 `.local\windows-package-design-final-smoke\report.json`，`ops/desktop/smoke-vbs.mjs` 的三项入口检查报告在 `.local\windows-vbs-complete-final-report.json`。原生目录／保存对话框未实际点击确认；页面自动化仅模拟其取消返回，不能据此宣称系统选择器已验收。

Windows 首次使用还通过 `ops/desktop/browser-first-record.mjs` 的全浏览器串联：设置资料目录／密码、登录、写入、退出、重开读回，包含实际随包子进程及两类锁释放核查。当前包与曾出现控制连接等待的旧候选分别记录，见[本轮实施记录](product-iteration-acceptance.md)。
