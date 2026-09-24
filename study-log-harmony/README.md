# 鸿蒙公开版客户端

此目录正在逐批迁移。实例地址、登录、能力读取、日志阅读、源码编辑保存、日块备份恢复、内部链接和图片插入已接入客户端入口并通过无签名编译；尚未完成设备上的连接、阅读、写入及恢复验收。其他模块、完整日志操作和正式工作区导航仍在迁移，当前不能作为完整可试用版本。进度与验收边界见上级仓库的 `docs/harmony-migration.md`。

支持 phone、tablet 和 2in1，使用自部署 Web/API 作为权威数据源。客户端不包含个人服务器地址、模型密钥或签名材料。实际安装还需开发者自行配置与公开包名匹配的签名；无签名构建成功不代表第三方设备可安装。

本机需要 HarmonyOS SDK `6.1.1(24)` 及匹配的 DevEco Studio。在本目录创建不入库的 `local.properties`，设置本机 `sdk.dir`，然后运行：

先执行 `npm ci`，再用 `npm run test:protocol` 运行地址、会话与能力契约的纯逻辑测试。当前测试使用 Node.js 的实验性 TypeScript 类型剥离功能，测试通过不代表真机网络链路通过。

```powershell
$devEcoStudio = '<DevEco Studio 安装目录>'
node (Join-Path $devEcoStudio 'tools\hvigor\bin\hvigorw.js') --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon
```

将安装目录占位符替换为本机实际路径。签名 Profile、证书、私钥、构建产物及设备调试数据均不入库。
