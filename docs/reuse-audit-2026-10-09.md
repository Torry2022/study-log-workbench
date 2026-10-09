# 公开版复用与个人版入口核查

## 范围与结论

本轮对照本机个人版源码与公开版当前源码、此前迁移边界和现有独立验证脚本；只读取个人版，不运行或修改其服务、配置和学习记录。检查覆盖模块入口与对应实现，不能证明每个交互细节或全部代码路径完全一致。

Windows 工作区仍直接加载公开版 Web。个人版到公开版是独立迁移；公开版 Web 到 Windows 是同一构建的不同运行载体。服务器和已安装桌面包更新时点可以不同，不代表两套主界面源码。鸿蒙复用业务接口和设计规范，保留原生界面。

## 已修复的重复来源

- Web 的 `globals.css`、`login.css`、`workspace.css` 和 Electron `settings.css`、`titlebar.css` 分散定义主题及标准按钮。桌面暗色缺少 `--body` 覆盖，按钮禁用透明度为 .45，网页为 .58；桌面继承 1.55 行高，网页为 1.4。
- 主题变量完整迁到 `study-log-web/public/ui/theme.css`，通用按钮规则迁到同目录 `controls.css`，删除原定义和网页内部的重复按钮规则。Web 根布局导入；Electron 从同一文件读取，打包直接复制该目录，不维护副本。
- 本地 HTML 窗口在显示前加载共享样式和当前系统主题；系统主题变化继续更新设置窗口，标题栏仍跟随工作区选择的主题。窗口布局、标题字号、表单字段布局、原生窗口控制按钮保留各自职责。
- 连接、模型和历史设置的操作按钮使用相同 `.button` 规则。没有改变模型配置、保存位置、密码、历史保留或服务启停协议。
- 原生窗口 API 的初始背景和系统按钮颜色仍是主进程中的显式映射，并非 CSS 页面主题的第二套定义；后续改变主题色时须一起核对该映射。未把所有平台差异都抽成新框架。

## 逐模块对照

| 对照项 | 公开版证据／结果 | 分类及处理 |
| --- | --- | --- |
| 首次使用、登录、主题 | `LoginScreen`、`AuthGate`、`WorkspaceChrome`；Windows 使用方式在服务启动前出现 | 公开版部署方式有意不同；主题基础变量已收敛 |
| 月份、日期、新建、日期跳转、侧栏折叠 | `WorkspaceChrome`、`DateJump`、`use-log-workspace` | 已有；不因组件由个人版大文件拆出而误判缺失 |
| 浏览、源码、分屏、阅读模式、大纲 | `LogReader`、`LogEditor`、`MarkdownPreview`、`markdown-outline` | 已有；三击正文切源码没有对应处理，列为交互差异，不直接绑定新手势 |
| Markdown 格式、图片、内部链接、返回来源 | `MarkdownEditMenu`、`use-editor-attachments`、`InternalLinkDialog`、`LogReader` 的 returnPoint | 已有；编辑器 Ctrl+Shift+K 内部链接快捷键缺失，但菜单入口可用 |
| 保存、未保存保护、并发、历史恢复 | `Workspace`、`use-log-draft`、`BackupDialog` | 已有，业务由 Web/API 持有，桌面不另写保存协议 |
| 生成、个人方案、材料提取、重点标注 | `WritingPanel`、生成方案组件及相应 API、`HighlightPanel` | 已有；公开版默认模板和三套预设是已批准差异 |
| 随记、候选、来源、标签、筛选 | `NotesModule`、`NotesNavigation`、`use-notes`、候选审阅组件 | 已有；来源打开仍调用公共日志导航 |
| 收藏、分组、筛选、失效来源 | `FavoritesModule`、`FavoritesNavigation`、`FavoriteGroupDialog` | 已有；H3 收藏语义保留，未扩展为所有标题级别 |
| 搜索范围、大小写、候选键盘、历史 | `SearchBox`、`use-search-history` | 已有。初查按旧组件名搜索造成“历史缺失”的误判已撤回；实际有最近搜索、删除、清除和再次执行 |
| 问答、历史、引用、知识补充 | `RagWorkspace`、`RagHistorySidebar`、共享 Markdown 渲染、问答服务 | 已有；仅服务端拥有提示词及检索规划 |
| 统计、分类、日历、明细 | `StudyStatsPage`、`StatsOverview`、`TaxonomyManager` | 已有；不把记录次数解释为掌握程度 |
| 导出、完整备份 | 导出组件/API、`ops/archive.mjs`、桌面文件菜单 | 已有；日志导出和完整备份职责不同，桌面原生路径选择是必要适配 |
| 返回顶部 | 个人版 StudyLogApp → 公开版共享 `BackToTop` | 上一批已补按钮与进度；Alt+↑ 快捷键尚未迁入 |
| 使用帮助 | 个人版 `HelpDialog`；公开 Web 无对应组件或入口，桌面帮助菜单只有更新／关于等原生项 | 确认入口缺口，优先补共享 Web 帮助，内容必须只描述实际已有行为 |
| 全局快捷键 | 个人版 StudyLogApp 与公开版 `WorkspaceChrome`、`Workspace`、`LogEditor` | Ctrl+G、保存和常用编辑快捷键已有；Ctrl+Shift+F、Ctrl+Alt+N/Q、Alt+↑、浏览方向键和内部链接快捷键未全迁入。需要连同编辑输入、弹窗和草稿保护一并实现与验收 |
| Wiki、分享、跨设备接续、自动同步、鸿蒙本地存储 | `docs/current-status.md` 已明确排除 | 既定边界，不列为本轮遗漏，不顺带实现 |

API 路径也不能只按文件名比较：个人版 `uploads/extract`、`internal-links`、`taxonomy/classify` 在公开版分别由 `materials/extract`、`links`、`taxonomy/suggest` 承担对应能力。存在入口不代表本轮重新执行了这些业务的全套测试。

## 验证

- Web 生产构建、类型检查通过：`.local/shared-ui-build.log`。
- 独立 Electron Playwright：`.local/settings-boundaries-1791537888677/report.json`，模型／历史窗口取消、未修改保存、配置保留、小窗口及深浅色检查通过；新增断言逐项比较实际网页和弹窗的 9 个主题变量、10 个按钮计算样式。人工核看深色模型窗口。
- `.local/connection-layout-1791537922394/report.json`：系统深浅色、640／420px、本地／远程等高与固定操作区、窄矮窗口、目录选择和确认记忆通过；人工核看窄屏浅色。首轮脚本仍期待旧错误文案，已改为精确断言当前提示；保留原非空目录、文件内容和配置不变断言。
- `.local/app-scrollbar-1791537962023/report.json`：Electron 1230px 五模块两主题、滚动与弹层、编辑器及三个设置窗口；普通 Chromium 五模块、共享资源、侧栏和回顶通过。
- `.local/titlebar-1791537962068/report.json`：主题同步、菜单开关／悬停、键盘、窄窗和最大化恢复通过；原生弹出菜单和光标仍用替身，不冒称所有 OS 菜单人工验收。
- `.local/toolbar-labels-1791538016971/report.json`：13 个宽度 × 两种模式 × 右栏两态，共 52 组标题栏检查通过，通用按钮抽取未破坏分阶段文字显示或方形图标尺寸。
- 首次设置检查错误地与生产构建同时启动，未进入工作区；构建完成后重跑通过。没有修改学习数据规避该失败。

本轮仅源码与入口核查、共享基础样式修正及列明验证。未推送、发布、覆盖安装或重新验证鸿蒙设备。下一行为批次优先补使用帮助和全局快捷键，再核对三击切换是否保留原行为；这几项未实现，不记作已完成迁移。
