# 服务器候选 0.1.0-rc.6

发布日期：2026-10-08。平台：Linux amd64。产品源码基线为 `346eedb`；Windows、Web、MCP 及部署文件统一为 rc.6。rc.5 的标签、附件和镜像保持不变。

本次按维护者明确要求，用当前源码替换原 rc.6 产物，版本号保持不变。已有 rc.6 使用者需重新下载覆盖安装；服务器需重新拉取同名镜像，不能只依靠本机缓存。以本说明中的新摘要及附件校验文件区分构建。

## 本次变化

- 大纲定位当前预览正文，未保存的新标题不再被误报为不存在；导航提示不再撑高正文，窄屏标题定位避开工具栏。
- Windows 顶部菜单关闭后清除悬停高亮与按钮焦点，保留再次悬停反馈及键盘导航。

- 重点标注及基础问答采用与材料相关的中性表述，保留来源约束；技术学习日志生成预设继续保留。
- 随记提取合并相关过程、结论与限制，保留条件和否定，不虚构个人经历；没有合适候选可正常结束。
- 仅升级与已发布默认版本逐字节匹配的标注／提取模板，先备份再替换；自定义模板、生成方案、凭据和已有记录保留。
- Windows、网页与鸿蒙统一日常提示，简化异常退出及设置说明，移除用户无需理解的内部术语。
- 鸿蒙源码修复启动窗口监听生命周期；本次不附设备调试包。
- 日志正文的一级、二级标题统一识别井号及下划线写法；拒绝保存时保留草稿，代码示例与缩进不受影响，旧日志不自动改写。

## 验证范围

本次最终 EXE 菜单检查、六组生命周期、包内网页宽窄大纲定位及配套 Compose 六组通过；原生菜单 popup／光标使用测试替身。网页镜像已重建及匿名拉取验证，MCP、tools 代码未变，沿用原摘要。其余下文检查保留既有证据，不冒称本轮重新执行。

最终 Windows 打包 EXE 六组流程、七项更新入口检查及包内 Node 运行时五组流程通过；配套 Compose 六组基础流程及三组模拟模型问答／停止检查通过。覆盖无模型记录、保存重开、检索、材料解析、备份和新目录恢复、旧默认模板更新与流式请求期间正常停止。本次发布验证未调用付费模型，先前有限真实模型样本另有记录。

三个镜像已用空登录配置匿名拉取并核对身份，复用了本机缓存。Windows 安装包未签名；打包 EXE 验证不等同于覆盖安装或任意跨版本迁移，本轮未覆盖日常应用、未部署生产服务器。详见源码仓 `docs/release-rc6-2026-10-08.md`。

本次替换新增最终 EXE 六组生命周期流程、包内固定 Node 的宽窄窗口标题校验和六组 Compose 检查，全部通过；上一构建的更新入口及模拟问答证据保留为历史范围，不冒称本次重复执行。

## 镜像摘要

| 服务 | 镜像 | Digest |
| --- | --- | --- |
| web | `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public/web:0.1.0-rc.6` | `sha256:d5ef4a1114dc1aa937b8a1da78cfe9dce265bad8664b55c2a69ff48027b5f49b` |
| mcp | `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public/mcp:0.1.0-rc.6` | `sha256:8dcef700745838eecd40abf45858f934a3f81e95218921dabd85a8ba950b940b` |
| tools | `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public/tools:0.1.0-rc.6` | `sha256:0a6d8af6a031a759a469632c54ab5df553b27019fbec5354cff49a6c2ff31796` |

## 历史版本

# 服务器候选 0.1.0-rc.5

发布日期：2026-10-08。平台：Linux amd64。产品逻辑基线为 `8a9cebd`，构建前将产品版本统一为 `0.1.0-rc.5`；最终发布提交包含本说明与版本配置。旧版固定标签保留，不覆盖。

## 本次变化

- Web 增加当前服务版本信息，供桌面端“关于”显示；保留旧客户端兼容性。
- 日志标题栏按可用宽度和优先级逐级显示文字，移除页面右侧多余滚动条占位。
- 统一保存位置、学习记录与学习材料等提示用词，更新浅色图标。
- Windows 配套安装包还包含设置窗口、退出重开、菜单与检查更新修正，具体见 GitHub 发布说明。

## 镜像摘要

三个服务使用同一配套版本，按本目录 README 部署；无需 Registry 账号。

| 服务 | 镜像 | Digest |
| --- | --- | --- |
| web | `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public/web:0.1.0-rc.5` | `sha256:7c94a1fba6699adcd83dd2a614f01353505a83bd6c4ef9482f6ea9b4e1c454bb` |
| mcp | `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public/mcp:0.1.0-rc.5` | `sha256:c16e7919be814d3a1539e024eeb7be899cc3331c7134d9156c4742bf8129c68f` |
| tools | `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public/tools:0.1.0-rc.5` | `sha256:d04b07dcd4c8304e4b3e7a57696886feed5ea2a32473dd283af9162e7443f832` |

## 验证范围

本机构建与类型检查通过；预构建 Compose 配置对照通过。使用本版镜像完成初始化、认证及无模型记录、PDF/DOCX 提取、正常重启、只读检索、整实例归档与新目录恢复六组检查，恢复内容逐字节一致。三组模拟模型检查覆盖带来源问答、可选向量协议及流式输出途中正常停止；未调用真实模型。

三个镜像用空 Docker 登录配置匿名拉取，身份与已测试镜像一致；复用本机缓存，不代表全新服务器下载体验。本次未部署生产服务器，未验证外部 HTTPS 或完整跨版本迁移／回退。升级前请备份；同版本恢复不等同于跨版本迁移。

## 历史候选

以下为原始发布记录，新部署使用上面的当前版本。

# 服务器候选 0.1.0-rc.3

发布日期：2026-10-07。平台：Linux amd64。三个镜像的产品源码基线为 `3f6a9f7`；配套部署说明在随附文件中。固定标签不覆盖，旧版 rc.2 保留。

## 本次变化

- 同步网页右栏、滚动布局、新版图标及相关交互修正。
- 增加日志历史版本开关和保留期限，默认开启、不限期限；已有月／年 Markdown 资料无需转换。
- 历史恢复提示与可关闭记录的设置保持一致；整实例备份仍需用户主动执行。
- README 按 Windows 本地、服务器和鸿蒙连接组织入口，部署指南补齐多设备连接和历史版本配置。桌面应用外壳本身不包含在服务器镜像中。

## 使用与镜像摘要

同目录 `.env.example` 已指定本版。按 `README.md` 下载镜像、初始化专用实例后启动；无需阿里云账号或 Registry 密码。三个服务必须使用同一配套版本。

| 服务 | 镜像 | Digest |
| --- | --- | --- |
| web | `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public/web:0.1.0-rc.3` | `sha256:d32c80e807741f4cf725aa287f48de89a6ff88b699593c0f712c226289ec28f8` |
| mcp | `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public/mcp:0.1.0-rc.3` | `sha256:6349b1cf4ad5b9b546d979bd1699f4860b7273a844ba9d7d8ea45601e48bc72c` |
| tools | `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public/tools:0.1.0-rc.3` | `sha256:f8b49f5d43fd7cba81c02f1054496316753f4a130cc1f59c09377a1314e28461` |

## 验证范围

- 本机 Linux amd64 镜像构建通过，Web 构建包含编译及类型检查；预构建 Compose 与源码 Compose 的运行配置一致性检查通过。
- 使用 `deploy/compose.yaml` 及新建合成实例完成六组流程：初始化及重复初始化保护、认证与无模型记录、PDF/DOCX 提取、正常重启、只读检索、整实例归档及新目录恢复。恢复内容逐字节一致，重新登录后资料可读。
- 三组模拟模型流程通过：关键词问答带来源、可选向量协议、问答输出途中正常停止；最后一项响应完整结束、源日志未变。
- 三个 ACR 镜像使用空 Docker 登录配置匿名拉取，镜像 ID 与已验收本地镜像逐一一致。复用了本机 Docker 缓存，不代表全新主机或所有网络的下载体验。
- 未使用真实模型、未增加费用，未改动个人版服务器。此次未重跑 ECS、外部 HTTPS、鸿蒙远程连接或跨版本升级／回退；同版本恢复不等同于升级验收。

## 历史候选

以下为原始发布记录，描述各自对应版本；新部署使用上面的当前版本。

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
