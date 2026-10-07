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
