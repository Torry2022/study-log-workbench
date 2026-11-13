# 2026-11-14：阶段 B 候选连接事务（本地候选）

## 范围及根因

基于 `9fec777c`，在独立 `public-phase2-harmony` 工作树实施。只处理通用鸿蒙现有更换连接入口，未实现 AI 设置接口、首次引导或个人版同步；不改通用线正在开发的配置模块。

旧入口先经多次放弃确认、清全局连接和 token，再进入登录；登录又先激活候选地址才能探测。结果是验证失败无法保留原工作台，各确认之间也可能已经丢弃部分草稿。现改为保留常驻工作台，独立探测候选、明确确认、最后提交。不替换页面架构、旧登录视觉、模块或服务器基础协议。

## 实现与存储边界

- `ConnectionProbe` 以候选 origin 和临时 token 执行既有 app-login／capabilities，沿现有地址／能力规则校验；取消只影响它自己的请求，不触发全局401处理。
- `ConnectionController` 绑定来源会话与请求代次；迟到成功／错误／确认无效；重复提交／重复打开不创建第二个有效事务。短本地提交期间禁用户取消，组件卸载仍使后续异步步骤失效。
- 确认会说明目标地址、同址身份变化及未提交问答的放弃后果。确认前不递增 discardRevision、不清业务草稿。未完成分类修改及在途问答／随记／分类操作先阻止切换，不在此批新增分类迁移或后台任务语义。
- 日志切换用严格 snapshot，失败不再拿会话过期的尽力捕获当成功；会话过期仍可保留最后观察值。随记在来源 namespace 暂存，卸载也使用捕获的来源，不会在 B 激活后写入 B 草稿。
- 指针提交后工作台先退出 connected 分支，保留候选表面的提交态；等待原生 postFrameCallback 的卸载帧后才初始化 B、重建模块。期间不挂 LoginPage，避免自动恢复与切换事务竞争；不能仅同步切 false→true 期望 ArkUI 不合并状态更新。帧回调重查提交后的会话绑定，过期或页面离开不再启动 B。
- `InstanceStore.prepare` 只准备 origin＋instanceId 的 namespace，不改 current／active。新凭据写入独立 AssetStore UUID alias，旧凭据在指针成功提交前不删除；失败清理本次暂存凭据。相同 namespace 重登录也不先覆盖旧秘密。
- current 选择改为应用沙箱 `filesDir/public-current-connection.json`，仅 origin／namespace／instanceId／HTTP选择／credentialId；不存 password／token。临时文件在同目录，完整写入并 fsync 后 rename，随后无 await 地激活实例。文件已存在但不可读／无效时不静默回退旧 current。
- 旧 `public-instance-settings.current` 在新指针不存在时仍可恢复；旧 namespace token alias可读。首次登录仍沿原登录流程，不在本批承诺完整初次登录事务。旧版 App 不识别新指针，降级不能视为保留当前新连接的兼容验收。

失败可能留下未引用的非秘密 `.pending` 文件，下一次提交覆盖它。进程被强制结束于 AssetStore 暂存之后／指针提交之前时，可能留下未引用的受保护凭据；它不会成为活动凭据，本批未加入全 AssetStore 扫描或崩溃残留清理。断电下目录元数据持久性也未作承诺。正常返回的错误／取消均有定向清理测试。

## 实际验证

测试全部使用合成实例、内存 AssetStore 适配和临时目录文件，不连接服务器，不读取真实资料。

- `connection-transaction.test.mjs` 执行实际 controller／probe、Index 提交与确认方法、日志捕获／随记收尾方法及真实 ConnectionSelectionStore 源码。覆盖网络失败、取消、迟到成功／401／确认、来源失效、重复提交、卸载失效；候选 URL／临时鉴权；确认提示和不提前丢稿。
- 提交故障覆盖凭据 add 已发生但返回失败、snapshot失败、随记保存失败、日志保存失败、rename失败、暂存后来源绑定失效。每种验证 A token／current／活动状态及 dirty 均保持，候选凭据清理；解除故障后重试 B，同地址新身份隔离，返回 A 重用原 namespace。文件无秘密内容。
- 实际日志严格捕获失败／文档不符会拒绝，原会话过期 fallback不变；实际随记卸载在 B 激活后仍只写 A。
- 现有实例存储、QA pending升级与工作区导航测试补齐新依赖／阶段边界。原“打开更换入口立即放弃／断开”的断言按新契约更新；存储、迟到模块回调、草稿和 busy 的保护断言保留，并在新的实际提交方法测试覆盖。
- 首轮完整测试因隔离树缺少 Web 测试依赖而失败；只在此隔离树执行 `npm ci --ignore-scripts` 补依赖。另有旧测试构造缺新存储依赖及旧 changeServer 方法，已适配。未跳过测试、弱化产品或启动浏览器。
- 首轮 ArkTS 编译发现 catch 的任意类型不能直接 throw，改为 Error 后构建通过。未关闭安全／签名校验。

验证命令：在 `study-log-harmony` 运行 `node --experimental-strip-types --test test/connection-transaction.test.mjs test/workspace-change-server.test.mjs test/workspace-navigation.test.mjs`、`npm test`；构建 `devecocli build --product default --modules entry@default --build-mode release`。

最终结果：专项 **45/45**，完整默认协议 **507/507**＋editor-runtime **13/13**，unsigned release HAP 构建成功。HAP不入Git，不签名，不安装。提交后的模块卸载帧及迟到会话失效另由实际完成回调的源码宿主测试覆盖，不以同步状态翻转替代卸载帧。

本机原始输出（不入Git）位于 `E:/DevData/StudyLogWorkbench/phase1-coordination-20261113/`：`harmony-phase2-focused.log`、`harmony-phase2-default.log`、`harmony-phase2-build.log`。测试命令没有启动浏览器，依赖安装关闭了install scripts。

## 未完成及交接边界

- 未运行原生页面、触摸／键盘／短窗、安全区、系统确认框及焦点复验。连接面板使用原有主题、ToolbarAction、FormKeyboardContext、浮层淡入淡出，但构建不代表视觉通过。
- 真实 AssetStore 的写失败／替换、应用沙箱文件原子替换及杀进程恢复仍需授权原生专项；本机临时文件测试只证明源码顺序和本地适配行为。
- 未作真实 HTTPS、错误证书／网络或用户设备测试；probe使用合成 rcp 适配，不称已真实端到端联调。
- 未提交问答保留现有显式放弃语义，没有新增跨实例持久问答草稿；已有 pending 任务归属不改变。分类草稿需用户先处理后重试切换。
- 未新增 AI 配置、更完整设置导航／首次流程，未修改服务端普通业务写入的实例屏障。不得以此提交宣称整个阶段 B 或全部 H03／主题等历史专项通过。
- 仅交统筹合并候选；不合回主线、不推送、不安装或发布。
