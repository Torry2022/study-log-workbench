# 鸿蒙内部链接读取取消补修（2026-10-16）

本批复用个人版已经验证的请求所属取消方式，保留公开版 `/links` 接口、实例隔离与 401 处理。选择器关闭或更换条件时会取消自己的首批及续页 GET；取消后的响应不会改状态，也不会因迟到的 401 退出新实例。日期面板关闭后的回调不再发起查询。续页失败后，列表到底不会反复自动请求；用户点“重试”才从失败前的服务端偏移继续。

分页去重保留 `headingId`，同名但身份不同的小节不会被合并。空条件底部改回“最近的日志与小节”，日期标签与查询控件归入同一搜索区域。网页窄屏候选保留标题与日期同一行，长标题省略，不再在 320px 下把日期拆到下一行。

## 验证

- Node.js `v23.8.0`。首次直接运行因 `study-log-harmony/node_modules/typescript` 安装不完整，在加载测试文件前报 `ERR_MODULE_NOT_FOUND`；执行 `npm ci --ignore-scripts` 按锁文件恢复 TypeScript 5.9.3 后可复跑。该失败属于本地依赖状态，不计作产品失败。
- `cd study-log-harmony && npm run test:protocol`：249 项通过，0 项失败。
- `cd study-log-web && npm run typecheck`：通过。
- `cd study-log-web && npm run build`：Next.js 生产构建通过。
- `cd study-log-web && node scripts/verify-internal-link-dialog.mjs`：Chromium、WebKit 共 24 组浅深色与宽度组合通过；新增 320px 短／长标题和日期同一行的几何断言，长标题确实被省略。证据暂存于 `.local/internal-link-dialog-1792134876935/`。
- `cd study-log-harmony && node 'D:\Software\DevEco Studio\tools\hvigor\bin\hvigorw.js' --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon`：`BUILD SUCCESSFUL`，生成未签名 debug HAP；既有 SDK／弃用警告保留。

本批未安装到设备，因此原生日期标签位置及取消时序仍待设备入口复核；构建和协议测试不代替真机验收。
