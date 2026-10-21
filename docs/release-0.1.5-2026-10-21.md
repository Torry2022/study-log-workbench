# 0.1.5 发布记录

本版统一生成方案弹窗和鸿蒙移动端导航、刷新与侧栏层级，修复深色日志阅读器首次加载的主题衔接。Windows/Web/MCP 为 0.1.5，鸿蒙为 0.1.5/10500；旧版本不覆盖。

## 实现

手机日志 AI、随记编辑与提取、历史版本使用独立页面及一致返回，宽屏保留现有工作区。修复搜索返回动效、H3/Aa 按钮、手势争抢与切换模块时重复刷新，补齐主动下拉刷新。

阅读器创建时显式设置 ArkWeb darkMode，与应用选择的浅色、深色或系统主题一致。文档开头的媒体查询因此在首次绘制即得到正确主题；保留异步渲染及既有内容就绪控制，没有加入固定延时遮罩。个人版特有 Wiki 的下拉与切换修复不列为通用版功能。

## 验证边界

Web 631 项通过、3 项既有跳过，类型检查和生产构建通过；MCP 60 项通过、1 项既有跳过；运维与桌面 74 项通过、1 项平台跳过；鸿蒙 329 项通过。实际 Windows EXE 隔离实例启动、编辑保存、退出保护、重开、归档恢复和 worker 故障六组通过，安装器 5259 个文件与候选逐项流式哈希一致。生成方案在 Chromium/WebKit、浅深色、桌面与窄屏八组显示检查通过。

精确 Linux amd64 非 root Web/MCP/tools 通过实际 Compose 任务与归档恢复十一组，包括旧版 Web/tools 拒绝新状态、未完成结果恢复、1/15/30 秒后取消及正常停服；模型仅使用项目内替身。自有容器已清理。三镜像已匿名拉取核对身份。

当前签名调试包已在 HBN 原位更新为 0.1.5/10500，并连接独立合成实例检查深色登录后的日志。32 张采样未出现大面积白色画面，不把低频采样说成连续逐帧检查。两版原偏好共 14 份文件已恢复并核对字节；展示令牌通过 401 清除，原连接与主题保留。公开 HAP 为同源 release 未签名构建；其实际安装需要使用者签名，不等同维护者调试包的安装。

本次没有覆盖日常 Windows 安装、写入真实资料或调用付费模型。其他使用者的鸿蒙独立签名及不同网络条件仍未验收。

## 附件

| 文件 | SHA-256 |
| --- | --- |
| study-log-desktop-0.1.5-x64-setup.exe | `414e3ad49188d00c07edeef752214b9baa2adacb53e63fcd3adbedd969a2ab9c` |
| study-log-harmony-0.1.5-unsigned.hap | `dc8fd9496093ce699a9d7b10a8642e870394564cfd97978fde00595ff606e394` |
| study-log-server-0.1.5.zip | `19ebc6377e31b8e944d4b5af652c1d3a6d8e7560911bd8cd1451906128bb2279` |

Windows 安装器未签名；鸿蒙 HAP 需自行签名。版本说明见 [部署附件说明](../deploy/RELEASE-NOTES.md)。Windows 构建 ID `lgqGbOTv-EowRX5unJNQW`。

## Linux amd64 镜像

镜像前缀 `crpi-2sv5e1hzpqiwbovs.cn-qingdao.personal.cr.aliyuncs.com/study-log-public`，各服务标签 `0.1.5`：

- web：`sha256:ae5399419c39fff928892a823cafb6ad02c31100ef2a525f3b741963eda87515`
- mcp：`sha256:41272879bc908f8c79e4c570a811b77d54948dbbe0f93bc9d0979da05c25cd9f`
- tools：`sha256:e5cb5ba0d18ddd1338c1053ece1d9423fabee1539ba7f0dff42a0eeb810fa41f`

完整本机证据位于维护者 0.1.5-20261021 发布目录，公开附件以 [v0.1.5 发布页](https://github.com/Torry2022/study-log-workbench-public/releases/tag/v0.1.5) 与 SHA256SUMS.txt 为准。
