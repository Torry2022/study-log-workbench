# 服务器镜像构建与发布准备

使用者入口是 `deploy/`，不含构建步骤或个人云资源。镜像命名统一为 `<IMAGE_PREFIX>/web:<RELEASE_VERSION>`、`mcp`、`tools`，同一版本必须来自同一份已验证源码。不要覆写已发布版本标签。Compose 不绑定 ACR，阿里云内网拉取地址只在使用者自己的 `.env` 中配置。

## 本地构建

在干净公开仓执行；示例变量是占位符，维护者需填写已授权仓库和新版本。首次目标已由维护者确定为 ACR 的 study-log-public 专用命名空间；后续变更仓库或公开范围须另行确认。

```powershell
$releasePrefix = 'registry.example.com/team/study-log'
$releaseVersion = 'replace-with-approved-version'
docker build --platform linux/amd64 -f ops/web.Dockerfile -t "${releasePrefix}/web:${releaseVersion}" .
docker build --platform linux/amd64 -f study-log-mcp/Dockerfile -t "${releasePrefix}/mcp:${releaseVersion}" study-log-mcp
docker build --platform linux/amd64 -f ops/tools.Dockerfile -t "${releasePrefix}/tools:${releaseVersion}" .
node ops/server-compose-check.mjs
$env:IMAGE_PREFIX = $releasePrefix
$env:RELEASE_VERSION = $releaseVersion
$env:TEST_COMPOSE_FILE = 'deploy/compose.yaml'
$env:WEB_IMAGE = "${releasePrefix}/web:${releaseVersion}"
$env:MCP_IMAGE = "${releasePrefix}/mcp:${releaseVersion}"
$env:TOOLS_IMAGE = "${releasePrefix}/tools:${releaseVersion}"
node ops/docker-smoke.mjs
node ops/docker-rag-smoke.mjs
```

后三个 IMAGE 变量供旧源码烟测入口和内部模型替身使用；使用者部署仅填写一个前缀及版本。烟测会创建具名隔离实例，使用本机 3580／3581，结束时只关闭自己的 Compose 项目；保留合成资料及证据，不触碰生产实例。

Web Dockerfile 运行生产构建及框架类型检查；正式发布前另执行 `npm run typecheck`。构建记录保留源码提交、基础镜像摘要、三个镜像 ID／推送后的 digest、目标架构和测试报告。不能用同名旧镜像的测试替代新构建。

## 后续版本发布步骤

1. 登录所选 Registry，检查命名空间与公开／私有权限。构建推送使用维护者权限，使用者只需公开拉取或自己的只读权限。
2. 推送上述三个固定版本镜像，记录仓库返回的 digest。ACR 公网推送与同网络 VPC 拉取地址按自己的实例配置，不复制个人版的仓库／凭据。
3. 将 `deploy/compose.yaml`、填写真实镜像前缀及版本的 `.env.example`、`deploy/README.md` 作为同一发布附件；删除“尚未发布”的说明必须以实际推送和清洁环境拉取成功为依据。
4. 在新的环境只使用这三个部署文件，拉取并核对 digest，执行初始化、登录、写入、停止重开及恢复。此前本地镜像成功不代表 Registry 登录和跨网络拉取成功。
5. 公布版本说明、资料兼容范围及升级前备份要求。只有同版本恢复已验证时，不宣称任意版本可升级／降级。

不自动配置 ECS、购买 ACR、开放防火墙、替换 Nginx 或清理用户容器。公开版发布独立于个人版 ACR/ECS 流程。

## 当前候选

2026-10-07 已按维护者提供的 ACR 目标发布 `0.1.0-rc.1`，三个公有仓库可匿名拉取。具体地址、digest 与限制见 [候选说明](../deploy/RELEASE-NOTES.md)。原个人版命名空间、镜像标签和 ECS 未改动；未建立 Git 远端或推送源码。
