# 日志原生布局复核：逐项分配工具栏宽度

## 范围与来源

本批独立于首次连接／设置修改，仅调整通用版 `LogsReaderPage` 的工具栏分配与对应测试。个人版对照工作区为 `personal-integration`，核对时 HEAD 为 `cca50fe8`；其 `LogsPage` 已有等效逐项分配，来源为 `cd9f7cb1`，本批不重复修改个人版。

复用个人版 `iconHeaderWidth`、`toolbarActionPriority`、`toolbarLabelCost`、`updateToolbarWidth` 的核心规则：先容纳图标，全部动作图标可见后，按导航、模式、保存及动作的顺序恢复文字；增加展示保留 12vp 余量，空间不足立即收缩。必要适配仅涉及通用版日期字段、始终显示的前后篇箭头、34vp 模式图标及返回统计入口的实际宽度。保留原生按钮尺寸、操作顺序、面板运动的目标宽度预留和业务回调。

## 已证实与未证实

- 已证实：中等宽度源码／分屏时，原 `toolbarStage` 将四个编辑动作整组收入更多，留下足够显示部分图标的空位。改为逐项决策；菜单按同一动作身份取反，不重复展示。
- 未复现：网页浮动日期越出左栏的问题。原生日期列表和阅读区由受限的原生容器分别布局，不使用网页浮动日期定位逻辑。本轮最大化滚动、普通窗口和左栏收展观察未出现同类越界，未改日期或右栏架构。
- 不把全部图标状态判为缺陷：空间不足时仍需紧凑；浏览态中等宽度保留前后篇文字，但剩余宽度不足以恢复整组模式文字时，模式保持图标。

## 验证

1. 通用版 `npm test`：567 项协议／逻辑测试、13 项编辑运行时测试全部通过；无浏览器启动。工具栏测试从实际 ArkTS 方法构造执行对象，独立累加真实嵌套行宽，覆盖浏览／源码／分屏、四种日期宽度、有无返回统计、连续缩窄、升级余量及面板目标宽度。断言顶部与更多逐项互斥。
2. 个人版只读核对：在 `study-log-harmony/editor-runtime` 运行 `node --test test/log-toolbar-priority.test.mjs test/log-toolbar-motion.test.mjs`，9/9 通过。不代表个人版设备验收。
3. 通用版正式 release 无签名构建、同源码隔离签名副本构建均成功。构建日志在 `E:/DevData/StudyLogWorkbench/phase2-harmony-tmp/harmony-log-budget-{production-build,signed-build}.log`，测试日志为同目录 `harmony-log-budget-tests.log`。
4. PC 模拟器 `127.0.0.1:14430`：仅安装隔离签名包并读取本机合成欢迎日志。普通窗口源码和分屏显示内部链接、插入图片，放弃修改和查找替换留在更多；实际菜单树检查四项互斥通过。AI 栏开关、左栏收展及最大化后布局保持边界，未输入、保存或调用模型。

截图及原生树位于 Git 外 `D:/TempCodex/StudyLogPhase2Emulators/verification/`：

- `pc-harmony-log-normal-settled`：修改前普通窗口的整组折叠。
- `pc-harmony-log-budget-source-fixed`、`pc-harmony-log-budget-split-fixed`：修改后部分编辑动作显示。
- `pc-harmony-log-budget-more-fixed`：更多中的其余动作，无重复。
- `pc-harmony-log-budget-ai-open-fixed`、`pc-harmony-log-budget-ai-closed-fixed`：AI 栏开关。
- `pc-pc-harmony-log-budget-nav-collapsed`：左栏收起。
- `pc-pc-harmony-log-budget-maximized-final`、`pc-harmony-log-budget-maximized-source-final`：最大化浏览／源码。

每个名称对应 `.jpeg` 和 `.json`。普通窗口约 1100vp 宽、最大化约 1640vp 宽；截图与树为稳定布局检查，不称逐帧动画或所有系统缩放验收。手机未安装本批包：紧凑触屏菜单未改，有源码回归，但不冒称本批手机视觉通过。未操作个人真机、真实资料、主线或发布。
