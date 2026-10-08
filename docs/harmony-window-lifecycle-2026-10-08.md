# 鸿蒙窗口监听生命周期修正（2026-10-08）

本轮整体适用性核查中，授权平板模拟器发生一次公开版启动退出。故障日志明确为 `EntryAbility.onWindowStageCreate` 注册窗口监听时抛出 `1300002`（window state abnormal），不能归因于连接失败或模型服务。

修正沿用现有窗口、键盘和避让区机制：加载主页面成功后注册监听；初始主题异步完成和 loadContent 回调均核验窗口身份，已退出的窗口不继续初始化。分别记录两类监听是否注册成功，异常不让启动崩溃，重新进入前台时仅重试未成功的一项。退出先清空窗口引用，分别注销并重置避让／键盘状态；已销毁窗口的注销失败不阻止剩余清理。没有增加布局、键盘专用页面或常亮开关。

验证：

- `test/window-observers.test.mjs` 执行实际 EntryAbility 转译代码，4 项覆盖注册时序、键盘／底部量更新、前台不重复注册、延迟回调与销毁、注册失败重试、销毁失败清理、页面加载失败。
- 鸿蒙协议测试共 228 项通过，`assembleHap` 成功。临时常亮仍为 false。
- 仅 `127.0.0.1:5555` 平板模拟器安装公开版测试 HAP，读取隔离合成实例，连续 3 次启动均加载记录；后两次在确认内容已保存后停止公开版进程再启动。故障目录没有新增同类日志。
- 未操作真机、个人版或生产实例。有限复测不代表所有系统窗口竞态都已穷举。

本机证据：`.local/generality-app-crash.log`、`.local/generality-harmony-protocol-final.log`、`.local/generality-harmony-build-final.log`、`.local/generality-native-20261008/relaunch.json`。本次 HAP 同时包含整体核查中的标注文案修正；不作为对外安装包发布。
