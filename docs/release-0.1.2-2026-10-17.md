# 0.1.2 发布记录

本次包含按需日志问答 Agent、问答布局调整，以及网页和鸿蒙内部链接选择器的同步。产品版本统一为 0.1.2；鸿蒙构建号为 10200。原 v0.1.0、v0.1.1 标签和附件保留。

## 代码与检查

- 按维护者授权，将 16 个未推送提交整理为四组，整理前后 Git tree 均为 `393d03ea638b613a648a627c1213006d0b897147`；随后统一版本。问答行为与当前边界见[架构文档](rag-architecture.md)。
- Web 548 项通过、3 项既有 Windows 权限跳过；MCP 60 项通过、1 项权限跳过；运维 44 项通过、1 项平台跳过；鸿蒙 249 项通过。类型检查、Windows 所用 Web 生产构建及 Linux amd64 镜像构建通过。
- 实际生产问答入口 23 组检查通过；Chromium／WebKit 的链接选择器 24 组浅深色、桌面与手机组合通过，已查看截图。Windows 分发程序六项隔离检查通过，包内 Node／Web／MCP 问答检查通过。
- 发布 Compose 六项部署检查和三项问答检查通过，包括关键词、模拟向量检索、停止、备份恢复及来源资料保持不变。全部使用隔离合成资料和本机模型替身，本次未调用付费模型。
- 包内问答脚本首次仍使用旧 `assess` 入口和“充分材料需要两次调用”的断言，按现有 `reply`／`read_more` 协议修正后通过；非法来源、必要补读和失败用量检查保留。容器脚本首次报告阶段引用旧 b27 默认标签，显式传入本次三个镜像后完整重跑通过。

## 鸿蒙

Release 提供当前源码构建的 release 未签名 HAP。独立源码副本的本地签名 debug 包已在手机模拟器覆盖安装，连接隔离合成服务器，读回记录并完成链接候选显示、无匹配搜索及关闭检查。

补验发现窄屏搜索区 Flex 占满剩余高度，修正为自然高度的 Column／Row 后，候选列表恢复；已查看前后截图，协议测试和 release 构建再次通过。见[设备补验记录](harmony-internal-link-cancellation-2026-10-16.md#012-发布前补验2026-10-17)。

这只覆盖模拟器与反向端口。物理设备、独立使用者签名、外部 HTTPS，以及原生设备上的慢请求取消／迟到 401 尚未补验；原[独立安装清单](harmony-independent-install.md)继续保留。未签名附件不冒充可直接安装到所有设备的发行包，维护者调试签名包不公开。

## 附件

| 文件 | SHA-256 |
| --- | --- |
| study-log-desktop-0.1.2-x64-setup.exe | `5bb79a565b4001d5114f1acb32d3cc1cb230787a4d3907357cf9d4c931bfb97d` |
| study-log-server-0.1.2.zip | `727c7525bc024aea56c268291f1f5fedefafb8b06411e7f0a3210fbf868dc2ee` |
| study-log-harmony-0.1.2-unsigned.hap | `597d90932e9f3641944759d5983e1de2397fccd2e9104d8fda8aaacf36de32d2` |

Windows 安装器尚未签名。服务器 ZIP 四个文件逐项与 `deploy/` 内容核对。HAP 内版本、构建号与包名核对通过，并检查已知密钥模式和签名文件类型。

## 镜像

镜像前缀 `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public`，平台均为 Linux amd64。三个新标签已推送，使用空凭据 Docker 配置匿名拉取，镜像身份与本机候选一致。

| 镜像 :0.1.2 | Registry digest |
| --- | --- |
| web | `sha256:13228a77ee1f16b1aaaf22aff56bef08b705c7c9345dd1b9f62c52a2dc120caf` |
| mcp | `sha256:58268dcb98103fd5bdfae9ec2a6c0caec0e99b2abf3d6f60dfbe7a7c89d0ad21` |
| tools | `sha256:d7f97f9f20e276bc91d0e2804f4544764a6af2f73ab3d21ad864eb7906f1bf60` |

## 本机证据

产物在 `.local/release-0.1.2-20261017/`，日志前缀 `.local/release-0.1.2-`。桌面报告在 `.local/electron-smoke-1792205814692/`；网页入口报告在 `.local/rag-entry-production-1792205757247/`；链接截图在 `.local/internal-link-dialog-1792205767740/`；容器报告在 `.local/public-rebuild-b27-20261017030112676/` 和 `.local/public-rebuild-rag-20261017030017930/`。

本机覆盖安装前已确认桌面及其本地服务退出，并备份校验 15 个原资料和配置文件，备份限制访问。安装到原目录 `D:\Software\study-log-desktop`，安装器退出码 0，15 个受保护文件哈希不变，5233 个安装文件与候选一致。实际启动后工作区可见，桌面和本地服务均为 0.1.2，capabilities 返回 200，随后正常退出。报告为产物目录内的 `install-report.json` 与 `real-start-report.json`。

发布页为 [v0.1.2](https://github.com/Torry2022/study-log-workbench-public/releases/tag/v0.1.2)，附件包括上表三项及 SHA256SUMS。源码、标签和附件以该发布页为准；本轮没有操作个人版或生产服务器，也没有在真实实例里发起模型请求。
