# 服务器候选 0.1.0-rc.2

发布日期：2026-10-07。平台：Linux amd64。三个镜像由公开仓 `0173f6b` 构建；固定版本不覆盖。此次只修正日志摘要对未编号三级标题的遗漏，已有资料无需转换；编号标题仍按原方式显示，侧栏定位与所有三级标题的源顺序一致。

## 使用与摘要

按同目录 `README.md` 使用，`.env.example` 已更新为 rc.2。三个仓库支持匿名拉取；以下摘要已使用空 Docker 登录配置拉取核对，镜像 ID 与本轮烟测一致。

| 服务 | 镜像 | Digest |
| --- | --- | --- |
| web | `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public/web:0.1.0-rc.2` | `sha256:1392cb5f28640ab1aac49e9911320fa4e20e95c1832b3e61e9edba62a81a5344` |
| mcp | `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public/mcp:0.1.0-rc.2` | `sha256:e9f5aa94ec17e3181397f6a62dec05e524de1f63820b0ec86e0ffa7b93ea1557` |
| tools | `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public/tools:0.1.0-rc.2` | `sha256:9a1a991d5e6dfb3e987a4143f3e1afa982f737e683e7e04f7ecf5d37fb2157d3` |

## 验证与限制

- 类型检查、生产构建、相关 33 项测试通过，1 项既有 Windows 文件符号链接权限测试跳过。
- 独立 Playwright 验证侧栏／顶栏、混合标题跳转、目录收藏和搜索；核看宽窄窗口截图，原始资料未被改写。
- 新镜像经预构建 Compose 完成六组基础流程及三组合成问答流程；容器认证接口确认未编号 H3 返回正常，归档新目录恢复逐字节一致，问答输出期间正常停止并完成响应。
- 匿名拉取复用本机 Docker 缓存，不代表全新主机下载；ECS 隔离测试通过的是 rc.1，rc.2 尚未在 ECS 更新复测。外部 HTTPS、鸿蒙远程连接及跨版本升级／回退仍待验，不能将同版本恢复等同于升级验收。
- 未调用付费模型，未更改个人版生产实例；没有推送 Git 源码。部署附件不含用户资料和凭据。

## rc.1 历史记录

以下保留首个候选发布时的说明；其后完成的 ECS 隔离验收见源码仓 `docs/server-deployment-acceptance.md`。

### 服务器候选 0.1.0-rc.1

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
