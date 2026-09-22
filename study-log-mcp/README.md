# 原始日志 MCP

Node.js 22 及以上。服务只读取一个实例根目录内符合年月命名规则的 Markdown 原始日志，不检索随记或 Wiki，也没有修改日志的工具。支持 MCP stdio 和 Streamable HTTP，使用官方 SDK v2，同时兼容 `2025-11-25` 与 `2026-07-28` 协议。

## 配置和启动

在本目录执行 `npm ci`。复制 `.env.example` 为忽略的 `.env`，填写 `LOG_ROOT` 和 `INDEX_ROOT`：两者必须为互不包含的绝对目录，不能省略或从当前目录推断。来源目录只需读权限；启用向量时索引目录需要当前进程写权限。

```sh
# 本地 stdio，不需要 HTTP token。stdout 只传 MCP，诊断写 stderr。
node --env-file=.env src/server.mjs

# HTTP 必须先填写 MCP_HTTP_TOKEN；空值或含空白会拒绝启动。
node --env-file=.env src/http-server.mjs
```

MCP 客户端也可将环境变量直接交给子进程：`node src/server.mjs`。显式路径参数 `--log-root`、`--index-root` 会覆盖对应环境变量。`npm start` / `npm run start:http` 使用进程已有环境，不自动读取 `.env`。

HTTP 默认监听 `127.0.0.1:3020`，端点为 `/mcp`。所有 HTTP 入口（包括 `/health`）都要求 `Authorization: Bearer <MCP_HTTP_TOKEN>`。Web 配置中的 `STUDY_LOG_MCP_URL` 应填写完整 `/mcp` URL，`STUDY_LOG_MCP_TOKEN` 填写相同 token。浏览器不应持有此服务 token。

`MCP_HTTP_ALLOWED_HOSTS`、`MCP_HTTP_ALLOWED_ORIGINS` 是独立的主机名白名单，以逗号分隔，不带协议或端口；默认仅本机及容器服务名。原生客户端可不发送 Origin，发送时必须是合法 HTTP(S) Origin 且命中白名单。通过反向代理使用其他域名时，管理员必须显式加入相应白名单，并配置 HTTPS。请求体最多 1 MiB，不接受压缩体或 JSON-RPC 批量请求；请求体读取限时 10 秒。

两代 HTTP 均采用无持久会话模式，不返回 session ID；GET/DELETE `/mcp` 返回 405。客户端请求结束后关闭 transport。2026 协议可直接取消请求流；2025 协议的跨请求取消通知无法在无会话模式关联，客户端取消时必须关闭 transport 才会中断服务端请求。服务正常关闭会中止进行中的提供方请求并释放索引锁。

## 工具与检索

| 工具 | 返回内容 |
| --- | --- |
| `list_months` | 月份与日块数量 |
| `list_days` | 指定月份日块摘要 |
| `get_day` | 指定日期原文 |
| `search_logs` | 字面文本命中与上下文 |
| `find_related` | 相关小节，按日期聚合 |
| `retrieve_contexts` | 有预算上限、可定位的原始日志证据 |
| `get_recent_context` | 最近有效日块摘要 |
| `get_style_examples` | 指定日期或最近有效日块，不预设个人日期 |

基础检索保留 BM25F 标题权重、H3 切片、相邻片段合并和去重；可使用日期范围、字面连续文本匹配，以及 `relevance`、`timeline_summary`、`comparison` 策略。`retrieve_contexts` 返回 `{contexts,retrieval,context}`，其中来源含日期、真实文件名、标题位置及内容哈希；`retrieval.mode` 区分字面、关键词回退和混合检索，`reason` 说明回退原因。

向量检索可选，必须同时填写 `EMBEDDING_API_KEY`、完整 `EMBEDDING_API_URL`、`EMBEDDING_MODEL`，并按模型填写 `EMBEDDING_DIMENSIONS`（默认 1024）。使用 OpenAI 兼容 embeddings JSON 协议，最多每批 10 个切片；语义 top 100 与关键词结果通过 RRF 合并。URL、模型不设供应商默认值，不读取聊天 key 或其他历史配置。

重排独立配置 `RERANK_API_KEY`、完整 `RERANK_API_URL`、`RERANK_MODEL`，通过 `RERANK_ENABLED=true` 或工具参数 `rerank:true` 启用。接口接收 `{model,query,documents,top_n,instruct}`，返回 `{results:[{index,relevance_score}]}`；只处理相关度策略的前 30 个候选，失败保留初次排序。提供方超时默认 30 秒，可分别配置 `EMBEDDING_TIMEOUT_MS`、`RERANK_TIMEOUT_MS`（1–120000）。响应上限 16 MiB，禁止重定向，错误不返回 key、URL 或原始提供方响应。管理员启用提供方后，查询及对应原始日志切片会发送至配置的端点。

## 缓存和进程边界

未配置有效向量模型时，关键词检索不读取实例身份文件，也不创建索引目录或锁；未启用重排时完全不访问模型网络。向量检索需要 `LOG_ROOT/.instance.json` 中的有效实例 UUID；缺失或损坏会返回 `instance_identity_unavailable` 并回退关键词，不进行嵌入或索引更新。

缓存身份包含实例 UUID、来源路径、端点哈希、模型、维度和切片版本。同路径更换 UUID，或恢复到新路径，都会重建缓存。缓存只保存内容哈希及向量，不保存原文、key 或完整端点；写入通过同目录临时文件及原子 rename 替换，失败保留旧索引。

向量配置有效时，服务启动即以独占创建方式取得 `INDEX_ROOT/.mcp-index.lock`，因此即使尚未调用检索，索引目录及锁也可能已经存在。一个索引目录只允许一个运行中的 MCP 进程；进程内更新另外串行化。正常退出释放自己的锁；强制终止可能留下锁，服务不会按 PID 或时间自动删锁。遇到残留时，先确认拥有它的进程及其他实例均已停止，再由管理员检查该指定目录的锁。不要让其他程序绕过锁共享写入此索引。

## 容器与验证

本目录可运行 `docker build -t study-log-mcp .`。镜像默认官方 `node:22-bookworm-slim`，可用 `NODE_IMAGE` 构建参数替换；以 `node` 用户运行，容器内监听 `0.0.0.0:3020`。来源目录应只读挂载，索引目录单独读写挂载并赋予 UID 1000 访问权限。实例路径和 token 均由运行环境提供；镜像不包含 `.env` 或数据。`EXPOSE` 不会发布主机端口，部署时优先仅供 Web 在内部网络访问。

`npm test` 运行全部合成测试；`npm run smoke` 使用真实 SDK 客户端分别验证两代 stdio/HTTP 协议、8 个工具、鉴权、请求限制、取消、关闭及进程锁。提供方均为本机 HTTP 替身，不访问付费模型或真实日志；这些测试不证明实际模型质量或已完成容器部署验收。

协议依据：[官方 SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/main/packages/server)、[Streamable HTTP 规范](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)。
