# 鸿蒙公开版客户端

连接自己部署的服务器，在手机、平板和鸿蒙 PC 上阅读、编辑和找回学习记录。日志、随记、收藏、问答和统计与网页共用服务器上的学习记录；模型在服务端配置，未配置时仍可使用基础记录功能。客户端不提供独立本地存储或离线同步。

当前提供源码构建方式，尚无面向所有设备的通用安装包。维护者已验证本地设备和模拟器的列明流程；其他使用者的独立签名安装、外部受信 HTTPS 连接仍待验证，详见[当前进度](../docs/current-status.md)。

## 准备

- 已按[服务器部署指南](../deploy/README.md)启动服务，并取得服务器地址和访问密码。先在目标设备浏览器确认能够打开 `https://你的域名/study-log`。
- 安装匹配的 DevEco Studio 和 HarmonyOS SDK `6.1.1(24)`；工程支持 `phone`、`tablet`、`2in1`，设备系统须满足工程兼容版本。
- 获取本仓库源码，用 DevEco 打开 `study-log-harmony`。按本机环境生成或创建不入库的 `local.properties`，设置 `sdk.dir`。命令行测试需要 Node.js 22.13 或更新版本。

Windows 桌面端的本地服务默认只供本机访问，不能直接作为手机的服务器。手机上的 `127.0.0.1` 指向手机自身；USB 反向端口仅用于开发测试。

## 依赖与构建

以下 PowerShell 命令从仓库根目录执行，将 DevEco 安装目录替换为自己的实际路径：

```powershell
$devEcoStudio = 'D:\Software\DevEco Studio'
npm --prefix study-log-web ci
Set-Location study-log-harmony
npm ci
& (Join-Path $devEcoStudio 'tools\ohpm\bin\ohpm.bat') install
npm run test:protocol
node (Join-Path $devEcoStudio 'tools\hvigor\bin\hvigorw.js') --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon
```

协议测试会导入相邻 Web 工程的时间和链接实现，因此需要 Web 依赖，不需要先启动 Web 服务。默认 `signingConfigs` 为空，输出为 `entry\build\default\outputs\default\entry-default-unsigned.hap`；构建成功不表示它可以直接安装到真机。

编辑器已包含可用的构建产物。修改编辑器源码时，另按 [editor-runtime 说明](editor-runtime/README.md)安装依赖并重新构建，不手改压缩产物。

## 签名与安装

在 DevEco 中使用自己的应用身份、证书、私钥和匹配设备的 Profile 配置本地签名。仓库默认包名 `org.studylog.workbench.publicedition` 是维护者验收基线；使用自己的应用身份时，本地 `AppScope/app.json5` 的 `app.bundleName` 必须与 Profile 一致。签名文件和配置不提交到仓库。

签名构建后安装本次生成的 `entry-default-signed.hap`。同一应用后续更新须保持包名和匹配签名；不要为解决签名错误先卸载已有应用。完整步骤、HDC 安装命令和独立试装清单见[独立构建与安装](../docs/harmony-independent-install.md)。维护者调试包绑定的设备范围不能替代使用者自己的签名。

## 连接与首次记录

1. 打开客户端，填写自己的服务器地址（例如 `https://你的域名`）及访问密码；客户端使用 `/study-log` 路径。模型 API Key 不填在登录页。
2. 连接后选择日期阅读已有记录，或新建当天日志，编辑后点击保存。网页连接同一实例时可以读到保存结果。
3. 日志 AI 可选择网页管理的生成方案，鸿蒙端保留本次补充要求；个人方案的完整管理在网页进行。生成结果需要审阅并显式保存。

局域网 HTTP 只用于明确启用的测试连接。日常远程使用应配置受信 HTTPS；切换服务器不复制或合并两处学习记录。

## 当前验证范围

2026-10-08：224 项协议测试、编辑器 2 项测试及 clean HAP 构建通过；可见平板模拟器完成网页记录读取、原生编辑保存、网页重新登录读回。该链路使用合成实例和本机反向端口，不能代替外部 HTTPS 或其他使用者的独立签名安装。证据见[本轮交付记录](../docs/public-delivery-2026-10-08.md)。

`EntryAbility.ets` 中 `KEEP_SCREEN_ON_DURING_ACCEPTANCE` 默认 `false`，不将维护者临时常亮包作为发行包。剩余条件统一记录在[进度总览](../docs/current-status.md)，不要求使用者先阅读下方历史记录才能开始构建。

## 专项测试与历史证据

登录键盘测试位于 `entry/src/ohosTest`。将构建命令中的 `module=entry@default` 改为 `module=entry@ohosTest`，在授权测试设备同时安装主包与测试包后运行：

```powershell
$hdc = Join-Path $devEcoStudio 'sdk\default\openharmony\toolchains\hdc.exe'
$deviceId = '<目标测试设备标识>'
$bundleName = '<本地 app.bundleName>'
& $hdc -t $deviceId shell aa test -b $bundleName -m entry_test -s unittest OpenHarmonyTestRunner -s class LoginKeyboardGeometry#keepsPublicConnectionFormInOneTopExtendedViewport -s timeout 240000 -w 300
```

测试在已退出连接的登录页运行，不清令牌、重置实例或提交连接；PC 宽窄窗口专项将 class 改为 `LoginKeyboardGeometry#restoresNarrowLoginAfterEnteringTheWideLayout`。布局坐标与命中边界不代替密码保护画面的现场观察。

以下保留历次验证范围，未发布、候选和当时缺项等描述不替代上方当前状态。

此目录是连接自部署实例的公开客户端。核心迁移及列明的本地设备专项已完成；独立分发条件尚未验收，当前不宣称正式发行完成。实例连接、日志阅读与编辑、搜索、收藏、随记、统计、本机设置，以及日志 AI、随记候选与问答界面均已接入。维护者已在合成实例上完成 PC／平板多项读写、来源跳转、主题、宽窄窗口、失败重试与实例隔离验证；平板候选编辑保存、两端日志 AI 草稿显式保存已有证据。手机真机的基础安装、局域网连接、日志／随记／收藏／图片／导出和合成模型替身的候选／日志 AI 流程见[自行试装记录](../docs/self-install-2026-10-02.md)；这些交互证据不等于真实模型质量验收。

PC／平板已通过隔离合成实例的双材料原生导入，PC 候选编辑保存及保存失败后的离开保护也已验证；这些证据不代表真实模型质量。手机自行试装已完成 A→B→A 合成实例切换、显式放弃未保存修改和已保存数据隔离，关闭常亮的候选包也按系统临时超时息屏；手机原生选入合成 TXT 后经本地模型替身完成候选编辑、显式保存和服务端读回，日志生成追加／保存及重点标注对照／应用／保存也已用合成响应完成。手机已通过系统浏览器复制合成图片、编辑器粘贴、实际上传／保存和冷启读回，断连上传时原草稿也保留；这项专项见当前收尾清单 R2。当前关闭常亮候选已在 Pura 手机安装并完成列明事务／键盘专项；手机五模块、抽屉、AI 和备份的指定连续采样已补，不外推为所有显示帧通过。原版／公开版模拟器曾出现首点已聚焦但未弹键盘，根因未定位；现有真机指定路径首点正常。其他使用者自行签名安装及不同网络受信 HTTPS 仍未验收；当前缺少外部条件，保留为发布前待验，不阻止本地源码和文档收尾。普通新建及候选批量保存会核对成功响应的记录身份，未确认时保留草稿和重试 ID。具体通过范围与缺口以[当前收尾清单](../docs/harmony-workspace-recovery.md)和[自行试装记录](../docs/self-install-2026-10-02.md)为准，历史操作记录见[鸿蒙迁移记录](../docs/harmony-migration.md)；当前不宣称正式发行验收完成。

### 历次专项

本轮新增：日志源码／分屏模式在原生“更多日志操作 → 编辑”中提供正文、三级至六级标题、列表、代码、表格和公式等操作；编辑器仍是同一个 CodeMirror，一次格式变更可独立撤销。宽屏目录按 H3–H6 层级缩进。日志 AI 可选择网页管理的生成方案，个人方案完整管理留在网页；连接旧实例时保留 generation.md 行为。Windows 本机包默认仅监听本机，不能直接作为手机可访问的服务器。

源码编辑器的可维护来源与构建流程已恢复至 [editor-runtime](editor-runtime/README.md)，不手改压缩产物。本轮当前源码通过 224 项协议／实际方法测试、运行时测试和宽窄 WebView bundle 浏览器烟测，以及无签名 HAP 构建。后续相关 10 项测试和签名 HAP 构建通过，已在获授权的平板公开隔离包验证原生菜单、方案 Select 和宽屏目录，覆盖全屏与窄浮窗；Select 展开样式复用既有颜色资源。具体证据与范围见[本轮记录](../docs/product-iteration-acceptance.md)，不外推为全部设备及输入法组合通过。

`EntryAbility.ets` 的 `KEEP_SCREEN_ON_DURING_ACCEPTANCE` 默认 `false`。最新关闭常亮候选已分别在 PC、平板和 Pura 手机按原有系统超时观察：PC 为 TIMEOUT／INACTIVE，平板和手机为 TIMEOUT／SLEEP；PC 的 INACTIVE 不作为深度睡眠证据。此前失败和活动刷新样本保留在恢复清单，不能用成功结果反推旧失败原因。维护者设备上的临时常亮验收包不是发行包。

上一轮迁移收尾的干净归档通过 214 项协议／实际方法测试及签名构建，当时源码与该归档的产品文件已核对一致。指定 rawfile 和 HAP 条目的限定扫描已有记录；依赖、SDK 与维护者签名复用，不等同于其他使用者的独立安装；本轮新增功能以上方最新记录为准。

登录页宽屏背景延伸至顶部系统栏，内容保留安全区；窄屏滚动视口也延伸至顶部，内部内容用实际状态栏高度避让，滚动后允许介绍区进入透明状态栏后方。窄窗版权随表单滚动，宽窗保留底部位置。问答隐藏返回顶部控件的外壳不再阻挡重试点击，保留原布局及动效。对应设备、主题和候选包证据见[工作台恢复清单](../docs/harmony-workspace-recovery.md)，不把有限采样视为每一显示帧通过。

原版／公开版模拟器的首点键盘异常仍未定位，维护者真机指定首点路径已有正常结果。独立签名安装和异网络受信 HTTPS 仍是发布前待验条件，USB 反向端口与维护者调试签名不能替代；当前不宣称正式发行验收完成。两端个人版待核查事项见[反馈索引](../docs/personal-edition-feedback.md)，不将同源源码风险直接当作个人版设备已复现。

当前交付和剩余门槛见[进度总览](../docs/current-status.md)，最近构建与网页/API 互通结果见[2026-10-08 记录](../docs/public-delivery-2026-10-08.md)。此前原生模拟器安装被自动审批拒绝；用户打开可见模拟器并重新要求安装验证后，安装和原生读写已通过，详见该记录后续补验。
