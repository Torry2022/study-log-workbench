# 鸿蒙公开版客户端

此目录是连接自部署实例的公开客户端。核心迁移及列明的本地设备专项已完成；独立分发条件尚未验收，当前不宣称正式发行完成。实例连接、日志阅读与编辑、搜索、收藏、随记、统计、本机设置，以及日志 AI、随记候选与问答界面均已接入。维护者已在合成实例上完成 PC／平板多项读写、来源跳转、主题、宽窄窗口、失败重试与实例隔离验证；平板候选编辑保存、两端日志 AI 草稿显式保存已有证据。手机真机的基础安装、局域网连接、日志／随记／收藏／图片／导出和合成模型替身的候选／日志 AI 流程见[自行试装记录](../docs/self-install-2026-10-02.md)；这些交互证据不等于真实模型质量验收。

PC／平板已通过隔离合成实例的双材料原生导入，PC 候选编辑保存及保存失败后的离开保护也已验证；这些证据不代表真实模型质量。手机自行试装已完成 A→B→A 合成实例切换、显式放弃未保存修改和已保存数据隔离，关闭常亮的候选包也按系统临时超时息屏；手机原生选入合成 TXT 后经本地模型替身完成候选编辑、显式保存和服务端读回，日志生成追加／保存及重点标注对照／应用／保存也已用合成响应完成。手机已通过系统浏览器复制合成图片、编辑器粘贴、实际上传／保存和冷启读回，断连上传时原草稿也保留；这项专项见当前收尾清单 R2。当前关闭常亮候选已在 Pura 手机安装并完成列明事务／键盘专项；手机五模块、抽屉、AI 和备份的指定连续采样已补，不外推为所有显示帧通过。原版／公开版模拟器曾出现首点已聚焦但未弹键盘，根因未定位；现有真机指定路径首点正常。其他使用者自行签名安装及不同网络受信 HTTPS 仍未验收；当前缺少外部条件，保留为发布前待验，不阻止本地源码和文档收尾。普通新建及候选批量保存会核对成功响应的记录身份，未确认时保留草稿和重试 ID。具体通过范围与缺口以[当前收尾清单](../docs/harmony-workspace-recovery.md)和[自行试装记录](../docs/self-install-2026-10-02.md)为准，历史操作记录见[鸿蒙迁移记录](../docs/harmony-migration.md)；当前不宣称正式发行验收完成。

支持 phone、tablet 和 2in1，使用自部署 Web/API 作为权威数据源。提交的源码不包含个人服务器地址、模型密钥或签名材料。实际安装还需开发者使用自己应用身份的包名与匹配签名；仓库默认包名是维护者验收基线，使用自己的包名时仅在本地修改 `AppScope/app.json5` 的 `app.bundleName`。无签名构建成功不代表第三方设备可安装。完整操作与未通过的独立验收门槛见[独立构建与安装清单](../docs/harmony-independent-install.md)。

本机需要 HarmonyOS SDK `6.1.1(24)` 及匹配的 DevEco Studio。在本目录创建不入库的 `local.properties`，设置本机 `sdk.dir`，然后运行：

在客户端目录执行 `npm ci` 准备 Node 测试依赖，并使用 DevEco 自带 OHPM 执行 `ohpm install` 准备工程依赖。运行完整协议测试前，还须在相邻的 `study-log-web` 目录执行 `npm ci`：部分跨端测试会直接导入 Web 的时间和链接实现。然后回到本目录执行 `npm ci` 和 `npm run test:protocol`。当前测试使用 Node.js 的实验性 TypeScript 类型剥离功能；设备验收边界以迁移记录为准。

```powershell
$devEcoStudio = '<DevEco Studio 安装目录>'
& (Join-Path $devEcoStudio 'tools\ohpm\bin\ohpm.bat') install
node (Join-Path $devEcoStudio 'tools\hvigor\bin\hvigorw.js') --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon
```

将安装目录占位符替换为本机实际路径。签名 Profile、证书、私钥、构建产物及设备调试数据均不入库。

登录键盘原生几何专项位于 `entry/src/ohosTest`。先执行 `ohpm install`，再用上述命令将 `module=entry@default` 改为 `module=entry@ohosTest` 构建测试模块。仅向已授权的公开版隔离安装同时安装主包与测试包，手机窄屏专项在已退出连接的登录页运行 `aa test -b org.studylog.workbench.publicedition -m entry_test -s unittest OpenHarmonyTestRunner -s class LoginKeyboardGeometry#keepsPublicConnectionFormInOneTopExtendedViewport -s timeout 240000 -w 300`；PC 宽窄窗口专项使用相同命令，将 class 改为 `LoginKeyboardGeometry#restoresNarrowLoginAfterEnteringTheWideLayout`。按设备分别运行，手机旋转不作为宽屏窗口验收。测试不会清令牌、重置实例或提交连接；它核对布局和命中边界，密码保护画面的实际绘制仍需现场观察。

## 验收与已知限制

本轮新增：日志源码／分屏模式在原生“更多日志操作 → 编辑”中提供正文、三级至六级标题、列表、代码、表格和公式等操作；编辑器仍是同一个 CodeMirror，一次格式变更可独立撤销。宽屏目录按 H3–H6 层级缩进。日志 AI 可选择网页管理的生成方案，个人方案完整管理留在网页；连接旧实例时保留 generation.md 行为。Windows 本机包默认仅监听本机，不能直接作为手机可访问的服务器。

源码编辑器的可维护来源与构建流程已恢复至 [editor-runtime](editor-runtime/README.md)，不手改压缩产物。本轮当前源码通过 224 项协议／实际方法测试、运行时测试和宽窄 WebView bundle 浏览器烟测，以及无签名 HAP 构建。后续相关 10 项测试和签名 HAP 构建通过，已在获授权的平板公开隔离包验证原生菜单、方案 Select 和宽屏目录，覆盖全屏与窄浮窗；Select 展开样式复用既有颜色资源。具体证据与范围见[本轮记录](../docs/product-iteration-acceptance.md)，不外推为全部设备及输入法组合通过。

`EntryAbility.ets` 的 `KEEP_SCREEN_ON_DURING_ACCEPTANCE` 默认 `false`。最新关闭常亮候选已分别在 PC、平板和 Pura 手机按原有系统超时观察：PC 为 TIMEOUT／INACTIVE，平板和手机为 TIMEOUT／SLEEP；PC 的 INACTIVE 不作为深度睡眠证据。此前失败和活动刷新样本保留在恢复清单，不能用成功结果反推旧失败原因。维护者设备上的临时常亮验收包不是发行包。

上一轮迁移收尾的干净归档通过 214 项协议／实际方法测试及签名构建，当时源码与该归档的产品文件已核对一致。指定 rawfile 和 HAP 条目的限定扫描已有记录；依赖、SDK 与维护者签名复用，不等同于其他使用者的独立安装；本轮新增功能以上方最新记录为准。

登录页宽屏背景延伸至顶部系统栏，内容保留安全区；窄屏滚动视口也延伸至顶部，内部内容用实际状态栏高度避让，滚动后允许介绍区进入透明状态栏后方。窄窗版权随表单滚动，宽窗保留底部位置。问答隐藏返回顶部控件的外壳不再阻挡重试点击，保留原布局及动效。对应设备、主题和候选包证据见[工作台恢复清单](../docs/harmony-workspace-recovery.md)，不把有限采样视为每一显示帧通过。

原版／公开版模拟器的首点键盘异常仍未定位，维护者真机指定首点路径已有正常结果。独立签名安装和异网络受信 HTTPS 仍是发布前待验条件，USB 反向端口与维护者调试签名不能替代；当前不宣称正式发行验收完成。两端个人版待核查事项见[反馈索引](../docs/personal-edition-feedback.md)，不将同源源码风险直接当作个人版设备已复现。

当前交付和剩余门槛见[进度总览](../docs/current-status.md)，最近构建与网页/API 互通结果见[2026-10-08 记录](../docs/public-delivery-2026-10-08.md)。原生模拟器安装本轮被自动审批拒绝，未记为通过。
