# 鸿蒙公开版客户端

此目录是公开自部署客户端，仍在迁移收尾与跨端验收中。实例连接、日志阅读与编辑、搜索、收藏、随记、统计、本机设置，以及日志 AI、随记候选与问答界面均已接入。维护者已在合成实例上完成 PC／平板多项读写、来源跳转、主题、宽窄窗口、失败重试与实例隔离验证；平板候选编辑保存、两端日志 AI 草稿显式保存已有证据。手机真机的基础安装、局域网连接、日志／随记／收藏／图片／导出和合成模型替身的候选／日志 AI 流程见[自行试装记录](../docs/self-install-2026-10-02.md)；这些交互证据不等于真实模型质量验收。

PC／平板已通过隔离合成实例的双材料原生导入，PC 候选编辑保存及保存失败后的离开保护也已验证；这些证据不代表真实模型质量。手机自行试装已完成 A→B→A 合成实例切换、显式放弃未保存修改和已保存数据隔离，关闭常亮的候选包也按系统临时超时息屏；手机原生选入合成 TXT 后经本地模型替身完成候选编辑、显式保存和服务端读回，日志生成追加／保存及重点标注对照／应用／保存也已用合成响应完成。手机还缺图片剪贴板粘贴及完整连续动效；其他使用者自行签名安装及不同网络 HTTPS 也未验收。普通新建及候选批量保存会核对成功响应的记录身份，未确认时保留草稿和重试 ID。具体通过范围与缺口以[当前收尾清单](../docs/harmony-workspace-recovery.md)和[自行试装记录](../docs/self-install-2026-10-02.md)为准，历史操作记录见[鸿蒙迁移记录](../docs/harmony-migration.md)；当前不宣称正式发行验收完成。

支持 phone、tablet 和 2in1，使用自部署 Web/API 作为权威数据源。提交的源码不包含个人服务器地址、模型密钥或签名材料。实际安装还需开发者自行配置与公开包名匹配的签名；无签名构建成功不代表第三方设备可安装。完整操作与未通过的独立验收门槛见[独立构建与安装清单](../docs/harmony-independent-install.md)。

本机需要 HarmonyOS SDK `6.1.1(24)` 及匹配的 DevEco Studio。在本目录创建不入库的 `local.properties`，设置本机 `sdk.dir`，然后运行：

只构建客户端时，在本目录执行 `npm ci` 即可。运行完整协议测试前，还须在相邻的 `study-log-web` 目录执行 `npm ci`：部分跨端测试会直接导入 Web 的时间和链接实现。然后回到本目录执行 `npm ci` 和 `npm run test:protocol`。当前测试使用 Node.js 的实验性 TypeScript 类型剥离功能；设备验收边界以迁移记录为准。

```powershell
$devEcoStudio = '<DevEco Studio 安装目录>'
node (Join-Path $devEcoStudio 'tools\hvigor\bin\hvigorw.js') --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon
```

将安装目录占位符替换为本机实际路径。签名 Profile、证书、私钥、构建产物及设备调试数据均不入库。

当前源码中 `EntryAbility.ets` 的 `KEEP_SCREEN_ON_DURING_ACCEPTANCE` 默认为 `false`。维护者已用该源码的本机调试签名包在 PC、平板和手机分别观察到前台闲置按临时系统超时息屏；其他使用者的发行包仍须从当前源码重新构建并自行核对。

当前收尾清单见[工作台恢复记录](../docs/harmony-workspace-recovery.md)，个人版回填核查见[源码对齐审计](../docs/harmony-source-alignment-audit.md)。USB 反向端口测试不能代替外部网络自部署连接；维护者已有调试签名不能代替其他使用者的独立安装。
