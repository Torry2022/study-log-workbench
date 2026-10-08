# 服务器部署：预构建镜像

此目录是服务器使用者的部署入口，部署附件包含 `compose.yaml`、`.env.example`、本说明和 `RELEASE-NOTES.md`，不需要源码、Node 或 npm。需要 Docker Engine 与 Docker Compose 2.24 或以上；当前支持 Linux amd64。三个镜像共用同一发布版本。

当前公开候选为 **`0.1.0-rc.5`（Linux amd64）**，`.env.example` 已填写配套 ACR 公网地址及版本，可以匿名拉取，无需阿里云账号。版本摘要及验收边界见随包 [版本说明](RELEASE-NOTES.md)。镜像前缀也可换成自己的兼容镜像仓库。

## 获取部署文件

下载 [0.1.0-rc.5 服务器部署附件](https://github.com/Torry2022/study-log-workbench-public/releases/download/v0.1.0-rc.5/study-log-server-0.1.0-rc.5.zip)，在[预发布页面](https://github.com/Torry2022/study-log-workbench-public/releases/tag/v0.1.0-rc.5)取得 SHA-256 校验文件；也可从源码仓同版本 `deploy/` 目录取得上述四个文件。附件与同版本 ACR 镜像配套。无需下载 Windows 安装包、鸿蒙调试包或源码依赖，也无需创建自己的 ACR 仓库。

本文命令在你自己的 Linux 服务器上执行。准备 Docker Engine、Docker Compose 2.24 或以上及一个专用保存文件夹；使用已有服务器即可，无需为本项目另买服务器。先完成下面的本机检查，再配置公网访问，不接管其他网站或服务。

## 首次使用

将本目录四个文件放入一个专用部署目录，在该目录执行后续 Compose 命令。不同实例使用不同目录和 Compose 项目名，不在其他应用目录运行。

1. 复制 `.env.example` 为 `.env`。首次使用保留已填写的 `IMAGE_PREFIX` 和 `RELEASE_VERSION`；以后更新时使用发布说明指定的配套版本，不建议使用 `latest`。填写专用实例父目录和实例目录的绝对路径，实例目录须位于父目录内。该文件不放应用密码或 API Key。
2. 准备新的实例父目录。以下 `/srv/study-log` 必须是本项目新建的专用目录；若已存在，先核对用途及权限，不直接更改现有文件的所有权：

```sh
sudo mkdir /srv/study-log
sudo chown 1000:1000 /srv/study-log
sudo chmod 700 /srv/study-log
cp .env.example .env
# 用编辑器填写 .env 后再继续
```

服务和维护容器使用 UID/GID 1000。工具只挂载指定的实例父目录，Web 只读写实例内的 `data` 和 `backups`，检索只读日志。若有权限错误，应修正这个专用目录的授权，不用 root 运行应用，不递归改动其他目录。

3. 默认 ACR 镜像公开，可直接拉取，无需登录。仅当你主动换成自己的私有镜像仓库时才需要相应只读凭据。检查配置后拉取镜像：

```sh
docker compose config --quiet
docker compose --profile retrieval --profile tools pull
```

4. 初始化并启动：

```sh
docker compose run --rm --no-deps tools ops/instance.mjs init /instances/instance
docker compose up -d web
docker compose ps
```

示例中的 `/instances/instance` 映射到 `INSTANCE_PARENT` 下的 `instance`；自定义实例目录名时必须同步修改命令。初始化生成密码及会话密钥，只打印文件位置。用服务器上的私密编辑器查看 `INSTANCE_ROOT/.env` 中的 `APP_PASSWORD`，不要将配置发到对话或工单。已有有效实例直接挂载，不重新初始化或修改密码。

本机访问 `http://127.0.0.1:3560/study-log`（端口以 `WEB_PORT` 为准）。远程初次检查可从自己的电脑建立 SSH 转发：`ssh -L 3560:127.0.0.1:3560 user@server`，再访问同一地址。未配置模型也可保存日志、随记、收藏、搜索和查看统计。

## 可选模型和日志问答

聊天配置在实例 `.env` 中填写 `CHAT_API_URL`、`CHAT_MODEL`、`CHAT_API_KEY`；接口地址须按提供方填写完整地址。不用 AI 可保持空值。

日志问答还需要检索服务。生成独立随机 token，将同一个值分别存入实例文件（不写入部署目录 `.env`）：

- 实例 `.env.mcp`：`MCP_HTTP_TOKEN=<随机长token>`。
- 实例 `.env`：`STUDY_LOG_MCP_URL=http://study-log-mcp:3020/mcp`、`STUDY_LOG_MCP_TOKEN=<相同token>`。

两份凭据文件只授予实例维护者和运行所需账户访问，Linux 通常使用所有者 UID 1000、模式 0600。不要把 token 放入命令历史。可选向量／重排配置沿用源码文档；不配置时使用关键词检索。

```sh
docker compose --profile retrieval up -d --force-recreate
docker compose --profile retrieval ps
```

改变实例环境配置后需要重建容器；仅 `restart` 不会重新加载环境文件。检索不暴露宿主端口，不应单独公开 3020。

## HTTPS 和多设备访问

默认只绑定服务器的 `127.0.0.1`，不会自动修改防火墙、系统代理、其他容器或已有网站。公网／鸿蒙访问需自行接入 HTTPS 反向代理，并在实例 `.env` 设置 `COOKIE_SECURE=true`，随后重建 Web 容器。服务器本机的 Nginx 可在你已有、证书已配置的站点中参考：

```nginx
location /study-log {
    proxy_pass http://127.0.0.1:3560;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_read_timeout 240s;
    client_max_body_size 201m; # 与应用最多 10 张、每张 20 MiB 的图片请求上限配套
}
```

不要整体覆盖已有站点配置。此片段不负责申请证书，也不替代站点其他安全配置；代理若运行在容器内，其 `127.0.0.1` 不是宿主机，应按自己的网络部署调整。外部 HTTPS 和各家云网络不在本轮本机 Docker 验收范围内。

## 连接 Windows 和鸿蒙

浏览器使用完整地址 `https://你的域名/study-log`。Windows 在“文件 → 使用方式…”选择“连接服务器”；鸿蒙在登录页填写服务器地址和实例访问密码。地址填写规则以客户端提示为准，通常填写 `https://你的域名`，客户端使用固定的 `/study-log` 路径。

三个入口连接同一实例时共用学习记录；Windows 的“本地使用”仍是另一份学习记录，切换不会上传或同步。`127.0.0.1` 在手机上表示手机本身，不能用服务器的回环地址连接。没有域名时可先通过 SSH 转发试用浏览器，不因此开放明文公网服务；局域网 HTTP 仅用于明确启用的测试连接。

## 日志历史版本

日志历史版本默认开启、不限制保留期限。在实例 `.env` 中可设置 `LOG_HISTORY_ENABLED=false` 停止后续记录，或设置 `LOG_HISTORY_DAYS=30`；期限仅支持 `0`（不限）、`30`、`90`、`180`、`365`。修改后重建 Web 容器以加载配置。

关闭不会删除已有版本；设置期限后，仅在成功保存对应日志时清理其过期历史版本。随记事务恢复文件不受此开关影响。历史版本与原有学习记录在同一实例内，不代替下面的独立归档。

## 停止、备份和恢复

```sh
docker compose --profile retrieval stop
docker compose run --rm --no-deps tools ops/archive-cli.mjs backup /instances/instance /instances/backup-20261007.slarchive
docker compose run --rm --no-deps tools ops/archive-cli.mjs verify /instances/backup-20261007.slarchive
```

先关闭外部 Markdown 编辑器。每次备份使用新文件名；归档须位于实例目录之外。归档和同名 `.sha256` 文件包含密码、模型密钥及学习记录，未加密，须私密保存并另存到其他磁盘。版本记录保留，派生索引不归档。命令失败时不删除实例锁，保留现场排查。

恢复到**尚不存在**的新目录，不覆盖旧实例：

```sh
docker compose run --rm --no-deps tools ops/archive-cli.mjs restore /instances/backup-20261007.slarchive /instances/restored
```

将部署 `.env` 的 `INSTANCE_ROOT` 改为 `/srv/study-log/restored`，保持使用与归档匹配的镜像版本，再启动。已有密码、学习记录和模板保持不变，外部服务地址需按目标环境核对。Windows 本地包使用相同归档格式；两边搬迁不会自动同步。

## 更新与故障处理

1. 记录当前 `RELEASE_VERSION`，阅读目标版本的数据兼容说明。
2. 停止服务，备份并校验；保留当前镜像和归档。
3. 修改一个 `RELEASE_VERSION`，拉取三个配套镜像，再启动原先使用的服务组合。
4. 登录检查学习记录读写和问答；失败时先停止并保留现场。涉及数据格式变更时不能只改回镜像标签，须按版本说明以旧版和升级前归档恢复到新目录。

当前仅验证同版本重建和恢复，不承诺跨版本升级／降级。正常停止会等待在途操作；不要用强杀或删除锁来替代。端口冲突时调整 `WEB_PORT`，目录错误时核对两个实例路径。查看项目状态和日志可用 `docker compose --profile retrieval ps`、`docker compose logs --tail 100 web`；日志分享前自行检查敏感内容。

不使用 `down -v`、全局 prune 或批量清理其他项目来排查。本目录没有接管服务器的一键安装脚本。
