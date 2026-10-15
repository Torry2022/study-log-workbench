# 学习日志工作台 0.1.1

这次更新主要修复日志导航和问答中的几个问题。已经使用 0.1.0 的用户可以直接升级，原有记录和配置继续保留。

工作台把每天学到的概念、代码和实践过程保存为 Markdown，支持日志、随记、收藏、搜索和统计。接入 AI 后，可以整理学习材料、提取重点，并围绕已有日志提问，沿着回答中的来源回看原文。Windows 可以本地使用或连接服务器；自部署网页与鸿蒙客户端共用服务器上的资料。本地与服务器资料不会自动同步。

## 这次改了什么

- 比较一个整月和某一天时，会同时读取两边的记录；日期写错时明确提示，不再悄悄忽略无效范围。
- 分页读取期间日志被修改时，会停止这轮问答并提示重试，避免混用修改前后的内容。
- 修复模型调用失败时用量记录丢失，以及后续不完整用量帧抹掉已知计数的问题。
- 改善跨月日期跳转、浏览／源码／分屏连续切换和模块过渡，减少正文残影、标题栏遮挡及旧响应覆盖新选择的问题。

## Windows

下载 `study-log-desktop-0.1.1-x64-setup.exe`。保存编辑内容并正常退出应用后，在原安装目录覆盖安装。学习记录、配置和历史版本保留；安装包仍未签名。

## 网页与服务器

下载 `study-log-server-0.1.1.zip`，按其中说明部署。已有服务器升级前先创建完整备份，再将 `RELEASE_VERSION` 改为 `0.1.1` 并拉取配套镜像。无需在服务器构建源码，详细步骤见[部署指南](https://github.com/Torry2022/study-log-workbench-public/blob/main/deploy/README.md)。

镜像前缀：`crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public`，三个镜像的部署标签均为 `0.1.1`。网页镜像重新构建；MCP 和维护工具实现没有变化，沿用已验证的镜像内容。

## 鸿蒙

这次没有修改鸿蒙客户端，继续使用 [0.1.0 未签名 HAP](https://github.com/Torry2022/study-log-workbench-public/releases/download/v0.1.0/study-log-harmony-0.1.0-unsigned.hap)。连接的服务器升级后即可使用本次问答修复；没有新增客户端安装包或真机验收。安装与签名说明见[鸿蒙客户端文档](https://github.com/Torry2022/study-log-workbench-public/blob/main/study-log-harmony/README.md)。

## 检查范围

问答四项缺陷已通过独立验收。Chromium／WebKit 导航、失败重试和快速切换检查通过；Windows 候选包完成隔离启动、编辑保存、退出重开和备份恢复检查，Linux amd64 镜像完成隔离部署及模型替身问答检查。本次没有调用付费模型，不将这些检查作为真实模型回答质量的保证。Agent 的长材料处理与效果评估仍在继续。
