# 学习日志工作台 0.1.0-rc.8

本次为 Windows x64 与 Linux amd64 服务器配套预发布。此前 rc.7 的附件与镜像保留。

## 本次更新

- 修正部分按钮文字的垂直居中，统计导航补齐图标。
- 页面和已有滚动区域保持稳定宽度，避免内容增长或打开弹窗时挤动界面。
- 统计、收藏和随记侧栏导航标题保持单行，保留原有图标和操作。
- 短记录仍计入记录天数；小节统计明确按三级标题计数，有上月比较时也保留说明。

## 安装与部署

Windows 候选为 `study-log-desktop-0.1.0-rc.8-x64-setup.exe`。安装前保存内容并正常退出应用，沿用原位置和已有学习记录。

服务器附件为 `study-log-server-0.1.0-rc.8.zip`；web、mcp、tools 必须使用同版本配套镜像。本地镜像构建、隔离部署及空登录配置匿名拉取检查已通过。桌面更新不会更新服务器，也不会同步本地与服务器的记录。

验证范围见 `docs/candidate-rc8-2026-10-09.md`；附件摘要见发布页的 `SHA256SUMS.txt`。

## 配套镜像

镜像前缀：`crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public`，标签均为 `0.1.0-rc.8`。

| 镜像 | Registry digest |
| --- | --- |
| web | `sha256:75d54cd65d15917047122fec25703a06125f3ee261dc255e551db5369f835864` |
| mcp | `sha256:fa1030daf89490450a33c0a6090b7127ffd9f528769814e01943043d0dcd6f74` |
| tools | `sha256:68c10f0e1ccaf69155d9ce7e584aebad49379a480da25d6fcc4fea10b2b191fa` |
