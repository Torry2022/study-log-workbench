# 问答界面发布检查

这份清单检查整个操作过程，不能用某个组件单独可用、一次编译成功或旧截图代替。两版分别执行；Windows 共用网页代码，但实际安装包、鸿蒙原生容器及输入法仍需各自验收。

## 每次涉及问答布局、滚动或会话状态时

| 部分 | 必须组合检查的状态 | 现有检查入口 |
| --- | --- | --- |
| 历史侧栏 | 展开、折叠弹层、手机抽屉；搜索、加载、失败重试；切换会话、整项点击和当前项 | `verify-rag-history-browser.mjs`、`verify-rag-edit-browser.mjs`；个人版另有 `verify-rag-sidebar-controls.mjs` |
| 标题与反馈 | 标题旁无保存状态；错误条贴标题且满宽；读取失败与新会话分开；重试后保留已有内容 | `verify-rag-jump-bottom.mjs`、`verify-rag-edit-browser.mjs` |
| 时间与气泡 | 时间与消息同时加载；相对日期；复制、编辑、取消；输入法组合输入；编辑草稿与底部草稿独立 | `verify-rag-jump-bottom.mjs`、`verify-rag-edit-browser.mjs` |
| 回答与版本 | 生成、完成、停止、失败；旧版本仍可切换；重新生成、刷新、保存冲突及另一端修改 | `verify-rag-jump-bottom.mjs`、`verify-rag-edit-browser.mjs`、`verify-rag-task-browser.mjs` |
| 正文渲染 | 长正文、表格重排、延迟图片及图表；跟随中资源加载；手动阅读后不抢位置 | `verify-rag-reading-anchor.mjs`、`verify-rag-smooth-output.mjs` |
| 来源 | 折叠摘要、编号定位、长摘要、连续定位、打开原日志再返回；具备来源列表收起功能的版本还要验隐藏来源展开和底部保持 | 个人版 `verify-rag-pi-browser.mjs`、`verify-rag-reader-source-boundaries.mjs`；原生入口另验 |
| 输入区 | 空内容、长草稿、焦点、发送/停止；显隐、自动增高；输入区外侧控件仍可点击；前后台与会话切换 | `verify-rag-composer-layout.mjs`、`verify-rag-edit-browser.mjs`、`verify-rag-jump-bottom.mjs` |
| 队列 | 仅在服务支持时展示；收起/展开、菜单、编辑复用输入框、失败恢复；队列消失不丢草稿 | 个人版 `verify-rag-pi-browser.mjs`、`verify-rag-pi-recovery.mjs`；不能把通用版无此能力当作遗漏 |
| 滚动入口 | 输入框出现/隐藏、焦点变化、回答进行中、宽窄切换；回底过程与后续跟随；返回顶部仅避让实际重叠的输入区 | `verify-rag-jump-bottom.mjs` |
| 分批历史 | 20 轮以内全量；超过 20 轮每批 10 轮；首开底部、补载不跳、刻度定向补载；分页会话宽窄入口都隐藏返回顶部 | `verify-rag-history-browser.mjs`、`rag-history.test.mjs` |
| 恢复 | 请求失败、SSE 断开、切换模块、刷新、页面恢复；不重复创建任务、不丢已有回答/草稿 | `verify-rag-edit-browser.mjs`；个人版另有 `verify-rag-pi-recovery.mjs` |

## 执行与结果判定

- 对当前候选先做类型检查和 production build；浏览器脚本必须指向该构建，不得混用旧目录中的脚本或产物。
- `verify-rag-jump-bottom.mjs` 用 `QA_JUMP_APP` 指向构建目录，`QA_JUMP_OUTPUT` 指向仓库外证据目录；分别执行 `QA_JUMP_ENGINE=chromium` 和 `webkit`。线上使用原执行路径时指定 `QA_JUMP_RUNTIME=legacy`；队列候选单独检查，不能因此开启线上 Pi。
- 历史检查：`node scripts/verify-rag-history-browser.mjs <构建目录绝对路径> <证据目录绝对路径>`，脚本内部覆盖两个浏览器。
- 编辑与恢复检查：在隔离源码及依赖目录执行 `node scripts/verify-rag-edit-browser.mjs`。它新建合成实例，不读取日常资料；两个浏览器均须完成。
- 其余组件按本次改动及上表组合补验；未运行的项目明确记录为未验。模型仅使用本机模拟服务，不能为界面检查调用付费模型。
- 遇到失败先保留日志、截图和请求响应，区分产品缺陷、测试入口过时与测试环境缺项；不能只增加等待时间或删掉断言。跨客户端任务的空闲发现周期为 15 秒，其检查允许 20 秒，不按活跃任务的 1 秒周期假设。
- 更新会话快照不能删除后续历史。验证另一端改写导致原编辑目标消失时，通过真实改写任务替换分支；会话删除使用 DELETE 接口。

## 真机与桌面包的独立检查

用授权设备和隔离资料，记录包身份、系统窗口宽度与原配置。至少覆盖短/长会话、来源操作、版本/错误、输入法、输入框显隐、回底、前后台；结束退出测试登录、恢复配置并核对原资料。个人版正式包服务地址固定，不能把它直接接入隔离服务，也不能静默替换登录令牌。需要测试包时先准备候选并获得安装授权。

实际 Windows 包需检查窗口缩放、菜单/焦点及内置页面；普通 Chromium 检查只能证明共享网页实现。鸿蒙 rawfile 在 Chromium/WebKit 通过只能证明阅读器页面，不代表 ArkUI 容器、软键盘和安全区通过。
