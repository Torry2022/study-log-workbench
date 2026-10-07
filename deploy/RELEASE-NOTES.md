# 服务器候选 0.1.0-rc.1

发布日期：2026-10-07。平台：Linux amd64。镜像应用源码对应公开仓基线 `7ecfcbe`；本候选沿用该批已构建并验证的镜像，不重新编译或修改资料格式。

## 使用

阅读同目录 `README.md`，将 `.env.example` 复制为 `.env`，修改两项资料路径即可开始。镜像地址与配套版本已填写，三个镜像均可匿名拉取，不需要阿里云账号或 Registry 密码。云服务器仍需自己的 Docker、磁盘权限及 HTTPS 接入配置。

## 镜像摘要

以下为 ACR 返回并经匿名拉取核对的 Registry digest；固定版本不覆盖。

| 服务 | 镜像 | Digest |
| --- | --- | --- |
| web | `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public/web:0.1.0-rc.1` | `sha256:da02ec101174f414a6afc33a3f2499d4596d01706cd55a65d868de06fae2cb85` |
| mcp | `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public/mcp:0.1.0-rc.1` | `sha256:10e2c997de081bfbde5e7b91ec98fa78d8939b828b83eae147085fc45f4bc7b9` |
| tools | `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public/tools:0.1.0-rc.1` | `sha256:021b5f77e24913570e16fe746493bf2030c716a26996d38c6689a68166ea4b88` |

## 验证范围

- 匿名客户端拉取三个镜像，摘要与维护者已验收镜像一致；使用同一台 Docker 引擎，复用了本机缓存层，不等于全新主机或不同网络的下载验证。
- 使用公开镜像地址、新的合成实例和无登录凭据客户端，完成初始化、无模型读写、PDF／DOCX 提取、重启保留资料、只读检索和新目录备份恢复；同版本恢复逐字节一致。
- 合成模型验证关键词／可选向量检索、回答引用和流式问答期间正常停止，停止约 18.7 秒后响应完整结束；没有付费模型请求。
- Compose 的运行参数与源码版一致；默认只开放本机 Web 端口，MCP 不直接对外暴露。

## 限制

这是首个服务器公开候选，不代表正式稳定版。当前仅支持 Linux amd64；未完成真实云服务器／外部 HTTPS、跨版本升级回退和外部用户体验验证。恢复保留原凭据，Windows 本机包与服务器间搬迁仍需检查外部地址及目标文件权限，不提供自动同步。升级前必须备份，不能仅靠切换旧镜像标签回滚资料。

本部署包只含部署说明与配置示例，不含用户资料、应用密码、API Key 或维护者登录凭据。
