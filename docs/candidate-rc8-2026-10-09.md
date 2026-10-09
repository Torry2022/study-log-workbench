# rc.8 本地候选准备

2026-10-09 接续操作衔接走查，统一 root、Web、MCP 与 Electron 为 `0.1.0-rc.8`。产品修正基线 `76f0f9b`，包含按钮居中、全 App 滚动稳定、侧栏标题及短记录统计说明。公开 rc.7 标签、附件和镜像未修改；未推送、发布、部署或覆盖日常应用。

## 本地产物

目录：`D:\BaiduSyncdisk\study-log-workbench-public-rebuild\.local\candidate-rc8-20261009`。

```text
f01144710c0cb9773f3b028a84451101366f156342cb5795e6d5ef49a87fd362  study-log-desktop-0.1.0-rc.8-x64-setup.exe
1d914b04d44d6d8d0d7093be25ff5630544f1a767e3b237c7d407d79747f8c02  study-log-server-0.1.0-rc.8.zip
```

Windows 安装候选已生成；服务器 ZIP 已整理四个部署文件，但配套镜像还未构建，不作为可用服务器发行包。README 的公开下载保持 rc.7，源码部署入口标明 rc.8 尚未发布。

## 已验证

- Web 生产构建、类型检查通过：`.local/rc8-build.log`、`.local/rc8-typecheck.log`。
- 最终 EXE 的短记录保存与重开、全文／标题范围切换、上月比较及代表性宽窄统计通过：`.local/record-review-electron-1791514032797/report.json`。无付费模型调用。
- 最终 EXE 六组启动、第二次启动复用、编辑保存、取消退出保留草稿、正常退出及重开、归档恢复和 worker 异常恢复保护通过：`.local/electron-smoke-1791514096144/`。首次固定窗口断言遇到原生 DPI 一像素取整，烟测按实际内容宽度补偿后完整重跑；原 1280px 断言和全部业务检查保留。
- 更新解析四项单元测试及最终 EXE 七项更新入口检查通过：`.local/rc8-updates-unit.log`、`.local/desktop-updates-1791514126011/report.json`。接口为测试替身，不表示 GitHub 已发布 rc.8。
- 两个 Compose 入口的服务对应、预构建镜像版本、运行配置和本机监听检查通过：`.local/rc8-compose-config.log`。此项只解析配置，没有启动 Docker 容器。
- Windows payload 的三份模板逐字节匹配源码，四个源码组件和包清单版本一致：`source-parity.json`；内嵌网页 BUILD_ID 与本轮生产构建一致（`ZR2-m-zk5mpRzTwlF_KEF`）。
- 其余本轮网页、Electron 和中断流程证据见[操作走查](operation-review-2026-10-09.md)，此前完整适用性和四类真实材料结论仍保留。

## 唯一阻挡候选收口的环境问题

Docker Desktop 4.66.1 启动报 Inference manager 无法处理 `dockerInference` 本地套接字。只读检查确认该文件为重解析点，日志与截图一致，Docker Engine 未能提供服务；没有恢复出厂设置、删除镜像／容器或修改模型设置。

公开 Docker 问题报告记录了同类故障，关闭全部 Docker 进程后仍可能无法访问套接字，重启系统可作为下一项恢复尝试：[Docker Desktop issue #460](https://github.com/docker/desktop-feedback/issues/460)。这是对报告和本机证据的判断，尚未完成本机恢复验证。

环境恢复后继续构建 Linux amd64 的 web/mcp/tools 候选镜像，并运行隔离 Compose 流程、核对版本及网页／模板一致性。成功前不标记服务器候选通过，也不发布任何 rc.8 产物。
