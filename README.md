# 学习日志工作台

面向单个使用者的自部署 Markdown 工作台。网页核心功能与维护者自部署验收已完成，独立使用者试装尚未完成；具体边界见 [实施状态](docs/implementation-status.md)。

## 本地工程

需要 Node.js 22.13 或更新版本。在 `study-log-web` 目录运行 `npm ci`，回到根目录运行 `npm run build`、`npm run typecheck`。

先初始化实例，再运行 `npm run dev -- 实例绝对路径 3560`，访问 `http://127.0.0.1:3560/study-log`。已接通登录、日志读写、图片与内链、日块恢复、搜索、收藏、随记、统计、导出，以及可选 AI 写作/标注/候选提取和分类建议。日志问答、版本化会话历史、只读 MCP、可选混合检索与整实例归档恢复已接通。不会查找父目录中的日志。

认证API测试可使用已初始化的合成实例启动：`node ops/run-web.mjs dev 实例绝对路径 3561`，访问 `http://127.0.0.1:3561/study-log`。启动器加载所选实例配置，不在终端显示密码；API流程可用 `node ops/auth-smoke.mjs 实例绝对路径` 验证。浏览器验证使用 `node ops/browser-auth.mjs 实例绝对路径 本机URL`，产物写入被忽略的 `artifacts/auth`。

## 初始化实例

运行 `npm run instance -- init 实例绝对路径`，选择一个新目录。命令创建独立的 `data`、`index`、`backups` 目录，并将随机访问密码和会话密钥写入实例 `.env`，不会把凭据打印到终端。`data/.instance.json` 保存实例身份。

重复初始化已识别实例不会覆盖凭据或数据；不接受包含其他文件的未识别目录，以及符号链接/目录联接。实例代码与资料分开保管，禁止把实例提交到Git。

## 部署与验收

实际使用请按[部署文档](docs/deployment.md)选择 Docker 或本地 Node 路径；AI 为可选能力，未配置时仍可使用基本工作台。另见[问答与历史](docs/rag.md)、[归档恢复](docs/backup-restore.md)和[模型验收边界](docs/model-validation.md)。

当前浏览器验收使用独立 Playwright 脚本，详见[完整回归记录](docs/web-regression-b28.md)。首次独立安装请填写[试装清单](docs/independent-install-checklist.md)。鸿蒙实现尚未开始。
