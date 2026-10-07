# 服务器预构建部署验收（2026-10-07）

## 交付范围

新增 `deploy/compose.yaml`、`.env.example`、`README.md`，服务器仅拉取镜像，不需源码或现场构建。`IMAGE_PREFIX` 可选 ACR 或其他 Registry；`RELEASE_VERSION` 同时控制 Web、MCP、tools。实例父目录与根目录显式填写，默认 Web 只监听宿主 loopback，MCP 不映射端口。源码版 Compose 和现有 Dockerfile 保留。

`ops/server-compose-check.mjs` 用 Docker 实际解析两个 Compose，验证服务集合、镜像配套版本、无 build、运行配置一致、网络暴露及四项必填配置。部署文档包含初始化、权限、可选问答、HTTPS 参考、停止、备份、新目录恢复和升级边界。维护者构建／发布准备见 [镜像发布说明](server-image-release.md)。

## 实际结果

- 三个镜像从当前公开源码本机构建，均为 Linux amd64、Node 22，未推送。Web 首次依赖下载出现 ECONNRESET；重试官方 npm Registry 成功，没有更换依赖或 Registry。
- Web 生产构建（含框架类型检查）通过，独立 `npm run typecheck` 通过；日志 `.local\server-build-web-retry.log`、`.local\server-typecheck.log`。
- Compose 结构／运行配置对照通过。
- 三份部署文件复制至独立 `.local\server-deployment-bundle-20261007`；以下烟测实际使用该目录的预构建 Compose，不使用源码版构建段。
- 基础六组通过：初始化及重复初始化保留身份／凭据／模板；认证与未配 AI 的日志随记保存；PDF／DOCX 资源；UID 1000、在线归档拒绝及重启持久化；只读关键词检索／环境隔离／无主机 MCP 端口；同版本归档逐字节恢复、拒绝覆盖及恢复后身份／资料可用。报告 `.local\public-rebuild-b27-20261007082012164\report.json`。
- 问答三组通过：关键词检索到合成模型的引用与 SSE done；可选向量替身与独立缓存；收到 delta 后 SIGTERM 等待约 18.7 秒，流完整结束、Web 正常退出、源日志不变、Web 与索引锁释放。报告 `.local\public-rebuild-rag-20261007082012124\report.json`。
- 两个具名 Compose 项目均正常关闭，保留隔离合成资料和报告；未操作其他容器、用户实例、个人版 ACR/ECS 或防火墙。

本地镜像记录（非 Registry 发布 digest）：

| 镜像 | 本地 ID |
| --- | --- |
| `study-log-server-test/web:20261007` | `sha256:da02ec101174f414a6afc33a3f2499d4596d01706cd55a65d868de06fae2cb85` |
| `study-log-server-test/mcp:20261007` | `sha256:10e2c997de081bfbde5e7b91ec98fa78d8939b828b83eae147085fc45f4bc7b9` |
| `study-log-server-test/tools:20261007` | `sha256:021b5f77e24913570e16fe746493bf2030c716a26996d38c6689a68166ea4b88` |

## 尚未执行

没有公开镜像、Registry 登录／清洁环境拉取、外部 HTTPS 或真实云网络验证；示例镜像地址明确为占位符。未运行真实模型请求，没有新增费用；没有将维护者脚本称为外部用户反馈。仅同版本重建／恢复通过，跨版本数据迁移与回退仍需随具体版本验证。


## ACR 公开候选发布与复核（2026-10-07）

上述“尚未执行”描述为发布前状态。本次按维护者选择并提供的 ACR `study-log-public` 专用命名空间，发布 `web`、`mcp`、`tools` 三个 `0.1.0-rc.1` 公有镜像。推送前确认版本不存在；推送结果与匿名拉取摘要见 [候选说明](../deploy/RELEASE-NOTES.md)。没有修改个人版命名空间或其标签。

推送前对 /app 中非 node_modules 产品文件作环境文件、签名／归档、凭据模式及个人版部署地址限定扫描；MCP、tools 无匹配，Web 唯一私钥标记匹配是依赖库 PKCS#8 输入格式验证字符串，核查不是密钥材料。不将这一限定扫描当作依赖全面安全审计。

使用独立空 Docker 客户端配置匿名拉取三个公开引用，并核对镜像 ID 与已验收镜像一致；证据 `.local\acr-anonymous-rc1\report.json`。底层复用了本机已有镜像层，未宣称全新服务器下载验证。

公开地址下重新运行基础六组、问答三组，全部通过，关闭具名测试项目：`.local\public-rebuild-b27-20261007084611906\report.json` 与 `.local\public-rebuild-rag-20261007084611848\report.json`。本次问答流在 SIGTERM 后约 18.7 秒完整结束。使用新的合成实例、空登录配置，无真实模型费用。

部署示例已填写真实公网地址与候选版本，保留用户自选 Registry 的能力。源码未推送 Git 远端；外部 HTTPS、真实云网络和跨版本升级仍待验。

本地可分发附件：`.local\server-release-0.1.0-rc.1\study-log-server-0.1.0-rc.1.zip`，SHA-256 `21805c217d453031c4faf859cd8231899640e9d1a2f436d898ecbf1473dafab4`。五个文件为 Compose、配置示例、使用说明、版本说明、逐文件校验表；ZIP 与源码部署文件逐字节核对，解压目录的 Compose 解析确认使用三个公开候选引用且无构建步骤。附件尚未上传 GitHub 或下载站。


## 既有 ECS 的独立实例验收（2026-10-07）

本轮按维护者授权，在既有 ECS 新建专用测试项目及目录，仅使用合成资料。不是第二台空白服务器，也不代表外部使用者试装。目录 `/opt/study-log-public-acceptance-20261007`，Compose 项目同名；使用 `127.0.0.1:3560`，不改生产域名、Nginx、防火墙或个人版配置。

开始时可用内存约 906 MiB；Web 限额 384 MiB、MCP 192 MiB、一次性 tools 256 MiB，各限 0.5 CPU，禁止额外 swap 使用，关闭测试容器自动重启。tools 在服务停止时执行初始化／归档。采样期间最低可用内存 741 MiB；一组运行时样本 Web 约 99.22 MiB、MCP 31.6 MiB，无测试 OOM。仅代表本次低负载，不能外推容量。

实际通过：

1. 使用独立空 Docker 登录配置，按 ACR VPC 地址拉取三个已发布候选，Registry 摘要一致；ECS 未执行依赖安装或源码构建。
2. tools 初始化独立资料；未配模型时登录、日志／随记保存、搜索及重启读回通过。
3. 独立 Playwright 通过 SSH 本机端口转发登录，读取云端合成日志、代码预览及随记。核看代表性截图，未验证公开 HTTPS 或鸿蒙连接。
4. MCP 认证、只读挂载、关键词检索通过；没有配置／读取任何生产模型凭据，也没有真实模型调用。
5. 停止服务后归档、校验、恢复到新目录逐文件字节一致；恢复后身份、密码、日志和随记可读。

结束时两个测试容器均正常 Exited (0)，3560 不再监听；原实例和恢复实例锁均释放，保留合成资料、归档和测试报告。个人版两个容器的 ID、启动时间和重启次数不变；个人版网页返回 200、未认证 MCP 返回 401。主机可用内存约 879 MiB，swap 未使用。没有清理其他镜像、容器或卷。

证据：`.local\ecs-candidate-report-20261007.json`、`.local\ecs-candidate-postcheck-20261007.json`、`.local\ecs-browser-20261007\report.json`；服务器专用目录保留 `report.json`。公开 HTTPS、新域名接入、鸿蒙远程连接及跨版本迁移仍待验。

### 当次发现的已有界面缺陷（rc.1）

合成日志使用 `### ECS 隔离验证`：正文与目录显示该标题，但侧栏显示“未命名”、顶栏显示“未命名日志”。源码 `study-log-web/lib/log-store.ts` 的 `getHeadings` 仍过滤掉不以数字加点开头的 H3；正文大纲则识别普通 H3。这是已复现的提取规则不一致，不是服务器部署失败，也不能记为完整视觉通过。尚无资料丢失迹象，原文保存和恢复一致。

后续应统一 H3 识别规则，保留旧编号标题显示，并核对侧栏标签跳转、搜索、大纲、统计和收藏引用的位置语义；不能靠给用户正文强制补编号或仅替换“未命名”文案掩盖问题。本轮只记录，不修改或覆盖已发布候选镜像。

### 未编号 H3 摘要修复（2026-10-07）

后续源码仅移除 `getHeadings` 的编号过滤，保留原编号前缀清理和 AST 根级判断。未编号标题、编号标题及 `3D 与 HTTP/2` 按源顺序进入日期摘要；代码、引用、列表内部标题及 H4 不成为日期标签。源文件没有重写，收藏和大纲仍使用既有身份与定位规则。

新增存储回归在修复前失败、修复后通过，验证摘要与搜索、大纲 H3 序号及统计一致。相关 34 项测试中 33 通过、1 项既有 Windows 文件符号链接权限测试跳过；类型检查、生产构建通过。

独立脚本 `node ops/browser-heading-summary.mjs` 创建独立合成实例、启动本次生产构建并正常关闭服务，实测侧栏／顶栏名称、三个混合 H3 的点击定位、目录收藏和搜索；原文逐字节不变，无页面异常。已核看 1440×900、900×900 截图，证据在 `.local\heading-summary-1791364311293`。本轮未安装鸿蒙或更新 ECS，不以本机验证代替新镜像云端验证；已发布 rc.1 不覆盖。

### rc.2 镜像与本机验证

三个 `0.1.0-rc.2` 镜像由 `0173f6b` 构建并发布到相同公开版 ACR 仓库，rc.1 未覆盖。空登录配置匿名拉取后 ID 与已测镜像一致，均为 Linux amd64；摘要见 `deploy/RELEASE-NOTES.md`。

六组基础流程证据：`.local\public-rebuild-b27-20261007091505707\report.json`；该次运行使用 `.local\docker-heading-smoke.mjs`，在现有 smoke 流程中追加已认证日期列表的 `DockerAlpha` 未编号 H3 断言，实际通过。三组问答协议证据：`.local\public-rebuild-rag-20261007091505689\report.json`；使用本地模型替身，停止约 18.6 秒，响应完整结束，没有付费调用。两组测试正常关闭所属容器，未操作 ECS；本机缓存匿名拉取不代表空白主机下载。

配套部署 ZIP 已生成并逐项核对五个文件：`.local\server-release-0.1.0-rc.2\study-log-server-0.1.0-rc.2.zip`，SHA-256 `db2883ea5ce1f1f306018864d3ede5a385a7db60b0b6653b3617e46b0badf189`。只包含 Compose、配置示例、部署说明、版本说明及校验清单；未对外托管该 ZIP。

### rc.2 ECS 隔离更新验证（2026-10-07）

沿用获授权的 `/opt/study-log-public-acceptance-20261007` 与同名 Compose 项目，将已停止的 rc.1 合成恢复实例更新到 rc.2。开始时可用内存约 902 MiB；先使用原工具创建并校验 `instances/pre-rc2.slwb`，随后使用独立空 Docker 配置从 VPC 地址拉取三个镜像并核对公开摘要。没有在 ECS 构建，也没有修改生产配置。

通过结果：旧日块、随记和实例身份可读；旧未编号 H3 在日期列表及顶栏正确显示；另一个合成日期混合未编号／编号 H3，保存、搜索、重启读回一致，旧日块内容未变。独立 Playwright 经 SSH 转发访问真实云端服务，断言侧栏与顶栏标题并检查日志／代码预览及随记，已核看日志截图。

结束时测试容器正常退出，未 OOM，实例锁释放；最低可用内存 761 MiB。个人版容器 ID、启动时间和重启次数未变，生产网页 HTTP 200，未认证 MCP HTTP 401。保留预更新归档、合成资料及证据；不清其他容器／镜像。

证据：`.local\ecs-rc2-report-20261007.json`、`.local\ecs-browser-rc2-20261007\report.json` 和截图；服务器隔离目录内 `rc2-report.json`。此为维护者执行的一次 rc.1→rc.2 合成实例更新验证，不代表任意版本迁移／回退。没有模型费用、公开 HTTPS、新域名或鸿蒙远程连接验证。随 rc.2 ZIP 保留的版本说明记录发布时状态，以本段后续验证补充。
