# 鸿蒙公开版客户端

此目录是逐批迁移中的公开客户端。实例连接、日志阅读与编辑、搜索、收藏、随记、统计、本机设置，以及日志 AI、随记候选与问答界面均已接入。维护者已在合成实例上验证平板的主要读写、搜索与模块入口，以及 PC 的图片、导出和恢复流程；手机模拟器已完成真实模型的日志生成与重点标注、随记候选审阅与保存、问答引用及历史操作，并以本地假模型验证问答断线重试、流式停止和限流恢复。平板已读回模拟器保存的合成随记。手机、PC 完整视觉对照，手机／PC 真机 AI 全流程、迟到响应与未知结果，以及独立试装仍未完成，不能据此宣称完整发布验收通过。逐项证据与未完成项见[鸿蒙迁移记录](../docs/harmony-migration.md)。

支持 phone、tablet 和 2in1，使用自部署 Web/API 作为权威数据源。客户端不包含个人服务器地址、模型密钥或签名材料。实际安装还需开发者自行配置与公开包名匹配的签名；无签名构建成功不代表第三方设备可安装。

本机需要 HarmonyOS SDK `6.1.1(24)` 及匹配的 DevEco Studio。在本目录创建不入库的 `local.properties`，设置本机 `sdk.dir`，然后运行：

先执行 `npm ci`，再用 `npm run test:protocol` 运行地址、会话与能力契约的纯逻辑测试。当前测试使用 Node.js 的实验性 TypeScript 类型剥离功能；设备验收边界以迁移记录为准。

```powershell
$devEcoStudio = '<DevEco Studio 安装目录>'
node (Join-Path $devEcoStudio 'tools\hvigor\bin\hvigorw.js') --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon
```

将安装目录占位符替换为本机实际路径。签名 Profile、证书、私钥、构建产物及设备调试数据均不入库。
