# 学习日志工作台 0.1.0-rc.7

本次为 Windows x64 与 Linux amd64 服务器配套预发布，保留 rc.6。

## 本次更新

- 日志标题栏的纯图标按钮和“更多”保持方形，保留按宽度逐级显示文字的规则。
- 浏览、源码模式均提供“更多”；选项采用图标与文本，收进菜单的操作不与标题栏重复。
- Markdown 编辑菜单补齐图标，“编辑”按钮上下留出间距。
- 顶部菜单切换时清除旧菜单的残留高亮，保留鼠标悬停切换及键盘导航。
- 移除桌面标题栏右上角的使用方式文字；仍可通过“文件 → 使用方式…”切换。

## 下载与更新

Windows 下载 `study-log-desktop-0.1.0-rc.7-x64-setup.exe`。保存正在编辑的内容并正常退出，再安装到原位置；学习记录和设置保留。安装包尚未签名。

服务器使用 `study-log-server-0.1.0-rc.7.zip` 与配套 ACR 镜像，按包内 README 部署。桌面更新不替代服务器更新，也不会同步本地与服务器的记录。`SHA256SUMS.txt` 提供附件校验值。

## 验证

生产构建与类型检查通过；最终 Windows EXE 通过 52 组标题栏宽度／模式／侧栏组合检查、桌面菜单检查及六组启动、保存、退出重开和归档恢复流程。配套 Compose 六组初始化、认证、记录、材料解析、检索、正常重启及新目录恢复检查通过。原生菜单 popup／光标使用测试替身；未调用付费模型，未部署生产服务器。

产品修正基线：`17e89f9`（包含 `0f0aec8` 菜单切换修正）；构建前统一版本为 rc.7。

## 镜像摘要

| 服务 | 镜像 | Digest |
| --- | --- | --- |
| web | `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public/web:0.1.0-rc.7` | `sha256:dfa79bdab529be7929599d4bf62eff1872f6be8c8ac3f2c1d3c3e713ed91cc0e` |
| mcp | `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public/mcp:0.1.0-rc.7` | `sha256:46822f1b48346b013f821b79d03709bbc233c169538d55cbf08493ad7ad46235` |
| tools | `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public/tools:0.1.0-rc.7` | `sha256:d3c4e2ac0b5d153a5bceee38f71ac31b8101346c0e5e630bdcd5d1be733495ba` |
