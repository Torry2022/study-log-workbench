# 鸿蒙公开版客户端

此目录是逐批迁移中的工程基线，当前只验证公开包名、权限边界和无签名构建；实例连接及业务页面尚未接入，不能作为可试用版本。进度与验收边界见上级仓库的 `docs/harmony-migration.md`。

支持 phone、tablet 和 2in1，使用自部署 Web/API 作为权威数据源。客户端不包含个人服务器地址、模型密钥或签名材料。实际安装还需开发者自行配置与公开包名匹配的签名；无签名构建成功不代表第三方设备可安装。

本机需要 HarmonyOS SDK `6.1.1(24)` 及匹配的 DevEco Studio。在本目录创建不入库的 `local.properties`，设置本机 `sdk.dir`，然后运行：

```powershell
$devEcoStudio = '<DevEco Studio 安装目录>'
node (Join-Path $devEcoStudio 'tools\hvigor\bin\hvigorw.js') --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon
```

将安装目录占位符替换为本机实际路径。签名 Profile、证书、私钥、构建产物及设备调试数据均不入库。
