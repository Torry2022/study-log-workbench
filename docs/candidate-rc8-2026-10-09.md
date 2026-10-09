# rc.8 本地候选准备

2026-10-09 接续操作衔接走查，统一 root、Web、MCP 与 Electron 为 `0.1.0-rc.8`。产品修正基线 `76f0f9b`，包含按钮居中、全 App 滚动稳定、侧栏标题及短记录统计说明。公开 rc.7 标签、附件和镜像未修改；未推送、发布、部署或覆盖日常应用。

## 本地产物

目录：`D:\BaiduSyncdisk\study-log-workbench-public-rebuild\.local\candidate-rc8-20261009`。

```text
f01144710c0cb9773f3b028a84451101366f156342cb5795e6d5ef49a87fd362  study-log-desktop-0.1.0-rc.8-x64-setup.exe
9048d38cf92e86e295a7cee0c7975cecda6fd66af198b02066b61fe58a53f75d  study-log-server-0.1.0-rc.8.zip
```

Windows 安装候选已生成；服务器 ZIP 的四个部署文件和配套本地镜像已完成验证。README 的公开下载保持 rc.7，源码部署入口标明 rc.8 尚未发布；镜像未上传，不能从 Registry 拉取此版本。

## 已验证

- Web 生产构建、类型检查通过：`.local/rc8-build.log`、`.local/rc8-typecheck.log`。
- 最终 EXE 的短记录保存与重开、全文／标题范围切换、上月比较及代表性宽窄统计通过：`.local/record-review-electron-1791514032797/report.json`。无付费模型调用。
- 最终 EXE 六组启动、第二次启动复用、编辑保存、取消退出保留草稿、正常退出及重开、归档恢复和 worker 异常恢复保护通过：`.local/electron-smoke-1791514096144/`。首次固定窗口断言遇到原生 DPI 一像素取整，烟测按实际内容宽度补偿后完整重跑；原 1280px 断言和全部业务检查保留。
- 更新解析四项单元测试及最终 EXE 七项更新入口检查通过：`.local/rc8-updates-unit.log`、`.local/desktop-updates-1791514126011/report.json`。接口为测试替身，不表示 GitHub 已发布 rc.8。
- 两个 Compose 入口的服务对应、预构建镜像版本、运行配置和本机监听检查通过：`.local/rc8-compose-config.log`。此项只解析配置，没有启动 Docker 容器。
- Windows payload 的三份模板逐字节匹配源码，四个源码组件和包清单版本一致：`source-parity.json`；内嵌网页 BUILD_ID 与本轮生产构建一致（`ZR2-m-zk5mpRzTwlF_KEF`）。
- 其余本轮网页、Electron 和中断流程证据见[操作走查](operation-review-2026-10-09.md)，此前完整适用性和四类真实材料结论仍保留。

## 服务器候选验证

源码基线为 `349be54`；以下三张镜像由该源码重新构建，目标均为 Linux amd64。基础镜像为 `node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392`。日志：`.local/rc8-web-image.log`、`.local/rc8-mcp-image.log`、`.local/rc8-tools-image.log`。Web 镜像内生产编译和类型检查通过。

镜像前缀为已选定的公开版 ACR 命名空间，各标签均为 `0.1.0-rc.8`；以下是本地镜像 ID，不是上传结果：

| 镜像 | 本地 ID |
| --- | --- |
| web | `sha256:75d54cd65d15917047122fec25703a06125f3ee261dc255e551db5369f835864` |
| mcp | `sha256:fa1030daf89490450a33c0a6090b7127ffd9f528769814e01943043d0dcd6f74` |
| tools | `sha256:68c10f0e1ccaf69155d9ce7e584aebad49379a480da25d6fcc4fea10b2b191fa` |

- 从候选 ZIP 解压 Compose，运行 `ops/docker-smoke.mjs`，六组通过：初始化及重复初始化、无模型登录和日志／随记持久化、PDF／DOCX、普通用户运行及重启、MCP 只读检索与环境隔离、归档恢复后逐字节一致和登录读写。证据：`.local/public-rebuild-b27-20261009060403672/report.json`。
- 同一 Compose 运行 `ops/docker-rag-smoke.mjs`，三组通过：关键词问答来源与 SSE 完成、可选向量检索、收到回答后 SIGTERM 正常收尾（20.118 秒，源文不变，流完成）。证据：`.local/public-rebuild-rag-20261009060403663/report.json`。模型为隔离替身，没有付费调用，不代替真实回答质量。
- 实际镜像架构、Web／MCP 版本及 Web／tools 三份模板逐字节核对通过：`.local/rc8-image-parity.json`。镜像与 Windows 分别从同一源码构建，不要求跨平台 BUILD_ID 相同。
- 两组测试正常关闭各自 Compose 项目，结束后没有残留容器。更新 ZIP 中的候选说明后重新计算摘要；运行配置与已测试 ZIP 相同。尚未推送源码、上传镜像、发布附件或覆盖日常应用。

## Docker 环境恢复及占用核查

Docker Desktop 4.66.1 原先启动报 Inference manager 无法处理 `dockerInference` 本地套接字；系统重启后仍失败。正常退出后，将故障运行目录改名保留，随后发现 Secrets Engine 的 `engine.sock` 同类错误；再次正常退出，保留两个套接字运行目录后启动成功，Engine 为 29.3.1。没有恢复出厂设置、清理镜像／数据卷或修改模型设置。

公开问题报告记录了同类故障：[Docker Desktop issue #460](https://github.com/docker/desktop-feedback/issues/460)。本机恢复已验证，但没有据此确认 Docker 已永久修复。原运行目录仍保留在本机，恢复记录在 `.local/docker-runtime-preservation-20261009.json` 与 `.local/docker-runtime-preservation-second-20261009.json`，不包含用户正文或凭据。

构建前只读盘点：35 张镜像，Docker 报告镜像占用 18.56 GB、构建缓存 16.79 GB（其中独占 14.5 GB），没有容器和数据卷。镜像与缓存共享层，不能将两项直接相加或等同虚拟磁盘大小。缓存时间与近期反复构建相符，是本次占用增长的主要已知来源。证据：`.local/docker-disk-inventory-20261009.txt`、`.local/docker-build-cache-20261009.txt`。

维护者确认继续后，重新盘点并执行 `docker buildx prune --filter 'until=24h' --force`，只清理超过 24 小时未使用的构建缓存，报告回收 4.899 GB。清理前缓存为 18.44 GB，清理后为 13.55 GB；所有镜像标签与 ID 核对一致，当前发布、候选和个人版镜像均保留。没有删除容器或数据卷，也未压缩 WSL 虚拟磁盘，不将缓存回收量描述为 Windows 磁盘立即缩小。证据：`.local/docker-cache-cleanup-20261009.log`、清理前后的镜像清单。
