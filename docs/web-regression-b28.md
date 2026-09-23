# B28 本地 Web 浏览器回归记录

2026-09-22，在全新合成实例 `.local/web-gate-20260922-232501` 上执行 21 个既有独立 Playwright 脚本，最终全部通过。生产构建 ID 为 `mOHTGJjUoidZWMjRtLKec`，Next.js 15.5.25，Node.js 23.8.0，Windows 本机 Chromium。每个脚本前后均核对构建 ID 未改变。未操作个人实例或真实资料。

实例使用 `ops/seed-fixture.mjs` 初始化，正式 `ops/run-web.mjs start` 入口在 3574 端口持有实例锁。启动时清除继承的模型与检索相关环境变量，实例 CHAT 配置为空。AI 生成、标注、提取和分类建议使用 Playwright 本机 API mock；材料解析、保存、附件、收藏、随记等仍通过真实本地 HTTP 与文件存储验证，没有付费调用。

## 结果

下表脚本名均位于 `ops/`，按实际依赖顺序执行。结果保存在合成实例内 `artifacts/web-gate/results.json`，每次执行另有独立日志；搜索首次失败记录仍保留，不以重试成功覆盖。

| 脚本 | 最终结果 | 秒 |
| --- | --- | ---: |
| browser-auth.mjs | 通过 | 3.385 |
| browser-reader.mjs | 通过 | 5.295 |
| browser-reader-lifecycle.mjs | 通过 | 2.694 |
| browser-reader-overlays.mjs | 通过 | 3.244 |
| browser-calendar.mjs | 通过 | 3.327 |
| browser-editor.mjs | 通过 | 6.224 |
| browser-editor-lifecycle.mjs | 通过 | 35.237 |
| browser-reading-position.mjs | 通过 | 2.299 |
| browser-attachments.mjs | 通过 | 6.189 |
| browser-internal-links.mjs | 通过 | 4.447 |
| browser-backups.mjs | 通过 | 17.513 |
| browser-search.mjs | 修正测试点击目标后通过 | 6.032 |
| browser-favorites.mjs | 通过 | 19.595 |
| browser-favorites-navigation.mjs | 通过 | 3.624 |
| browser-notes.mjs | 通过 | 11.476 |
| browser-stats.mjs | 通过 | 5.981 |
| browser-export.mjs | 通过 | 7.394 |
| browser-writing.mjs | 通过 | 10.999 |
| browser-highlighting.mjs | 通过 | 6.790 |
| browser-note-candidates.mjs | 通过 | 8.385 |
| browser-taxonomy-ai.mjs | 通过 | 5.546 |

覆盖范围包括桌面与 390px 手机入口、阅读渲染、重复标题、日期跳转、弹层焦点与认证过期收尾、编辑与跨页草稿保护、保存时继续输入、双窗口版本冲突、图片上传和迟到回调、内部链接、写前备份预览恢复、搜索键盘与历史、收藏分组和来源跳转、随记、统计下钻与分类草稿、真实 ZIP 导出、材料解析、AI 结果审核后应用、候选幂等批量保存及失败重试。具体断言以各脚本与日志为准，不代表所有浏览器或任意数据规模都已覆盖。

## 发现与处理

1. 初次启动时其他任务恰好重建共享 `.next-build-cache`，旧服务出现缺少 `required-server-files.json`，匿名登录页未能加载。停止该服务，确认构建完成后另建上述新实例并重跑。初次实例 `.local/web-gate-20260922-231801` 留存诊断，无业务资料写入。编排器加入逐项构建 ID 校验。
2. 搜索脚本原先点击日期标题验证“点击弹层外关闭”，在当前完整界面中该位置实际被搜索结果遮挡。改为真实点击可见正文第九段，保留弹层关闭断言，不使用强制点击或直接调用 DOM 事件。修正后搜索完整流程通过；没有修改产品代码。
3. 本轮未发现需要产品修改的 B04–B20 回归问题。

## 截图与复现

合成实例 `artifacts/` 共 41 张截图，包含 40 张各场景结果和 1 张上述搜索测试首次失败截图。分类目录为 `auth`、`reader`、`editor`、`attachments`、`links`、`backups`、`search`、`favorites`、`notes`、`export`、`writing`、`highlighting`、`note-candidates`；统计与分类建议为该目录下 `stats-*.png`、`taxonomy-ai-*.png`。另外目视检查了手机阅读、收藏、统计和 AI 草稿预览截图。截图及包含随机实例凭据的资料均留在 ignored 本地实例，不进入 Git。

在一个新的合成实例中复现：

```text
node ops/seed-fixture.mjs <新建合成实例绝对路径，目录名以 web-gate- 开头>
node ops/run-web.mjs start <该实例绝对路径> 3574
node ops/browser-web-gate.mjs <该实例绝对路径> http://127.0.0.1:3574/study-log
```

启动前确保没有通过父进程注入真实模型或检索配置。编排器每项上限 150 秒，失败立即停止，保留日志。仅在调查并修正失败之后，可用第四个参数（如 `search`）从指定脚本续跑；继续使用相同实例和相同构建。阅读脚本必须先于修改一月资料的编辑脚本，`editor` → `editor-lifecycle` → `reading-position` 顺序不能调换。完整重新验收需新建实例，不能把修改过的一月资料当初始阅读样本。

本轮 `next start` 输出 standalone 使用提示，但确实通过生产构建处理上述请求；此记录不替代独立 Docker/standalone 验证。RAG B23/B24、MCP、离线归档和 Docker 安装由各自验收记录覆盖。真实第三方用户从零安装试用仍待完成，此处没有将其标记通过。
