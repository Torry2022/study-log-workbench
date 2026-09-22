# 学习日志工作台

面向单个使用者的自部署 Markdown 工作台。当前处于逐项实现阶段；已完成与未完成能力见 [实施状态](docs/implementation-status.md)。

## 本地工程

需要 Node.js 22 或更新版本。在 `study-log-web` 目录运行 `npm ci`，回到根目录运行 `npm run build`、`npm run typecheck`。

先初始化实例，再运行 `npm run dev -- 实例绝对路径 3560`，访问 `http://127.0.0.1:3560/study-log`。当前支持登录/退出，日志工作区正在接入，不会查找父目录中的日志。

认证API测试可使用已初始化的合成实例启动：`node ops/run-web.mjs dev 实例绝对路径 3561`，访问 `http://127.0.0.1:3561/study-log`。启动器加载所选实例配置，不在终端显示密码；API流程可用 `node ops/auth-smoke.mjs 实例绝对路径` 验证。浏览器验证使用 `node ops/browser-auth.mjs 实例绝对路径 本机URL`，产物写入被忽略的 `artifacts/auth`。

## 初始化实例

运行 `npm run instance -- init 实例绝对路径`，选择一个新目录。命令创建独立的 `data`、`index`、`backups` 目录，并将随机访问密码和会话密钥写入实例 `.env`，不会把凭据打印到终端。`data/.instance.json` 保存实例身份。

重复初始化已识别实例不会覆盖凭据或数据；不接受包含其他文件的未识别目录，以及符号链接/目录联接。实例代码与资料分开保管，禁止把实例提交到Git。
