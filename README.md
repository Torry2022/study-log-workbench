# 学习日志工作台

面向单个使用者的自部署 Markdown 工作台。当前处于逐项实现阶段；已完成与未完成能力见 [实施状态](docs/implementation-status.md)。

## 本地工程

需要 Node.js 22 或更新版本。在 `study-log-web` 目录运行 `npm ci`，回到根目录运行 `npm run build`、`npm run typecheck`。运行 `npm run dev` 后访问 `http://127.0.0.1:3560/study-log`。

当前入口仅用于验证工程启动，不提供资料读写。未配置数据目录，不会查找父目录中的日志。
