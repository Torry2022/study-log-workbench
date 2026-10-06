# AI 配置与模板

日志生成、重点标注和随记候选已接入，均需审阅后显式保存。`/api/capabilities` 需要认证，`aiConfiguration` 仅报告本地配置和模板检查结果；不会探测供应商、消耗费用或返回配置值，也不保证供应商当前可用。`features` 的 `supported` 另行表示功能是否实现。

实例 `.env` 中显式填写以下变量，保存后重启该实例：

```dotenv
CHAT_API_URL=https://your-provider.example/v1/chat/completions
CHAT_MODEL=your-model
CHAT_API_KEY=replace-with-your-key
```

地址是完整的 OpenAI 兼容聊天接口地址，不会自动追加路径。可显式使用 HTTP 代理；是否加密取决于管理员填写的地址。不得在地址中嵌入用户名、密码或片段。可选 `CHAT_LIGHT_MODEL` 指定轻量任务模型，空值使用 `CHAT_MODEL`。没有内置供应商、模型或个人环境变量回退。

初始化会将仓库 `prompts` 中三个通用模板复制到实例的 `data/prompts`：`generation.md`、`highlighting.md`、`extraction.md`。模板强调材料依据、结果预览和用户决定，不规定个人领域、文风、括号或中英文空格习惯。每次请求重新读取模板，修改后无需重启；文件须为非空 UTF-8 普通文件，最大 64 KiB，路径不能包含链接。

升级已有实例时，停止该实例后重新运行初始化即可补充缺失模板；已有模板、密码和环境文件不会被覆盖。旧环境文件中的 AI 变量需自行添加。缺少或无效模板会给出具体模板名和原因，不读取其他实例或个人 Skill。

默认重点标注模板选择完整、简短的语义短语，并保留否定、条件和状态限定；定位起止需覆盖完整词语。更新已有实例的偏好时，可对照仓库模板自行合并至该实例的 data/prompts/highlighting.md；重新初始化只补缺失文件，保留已有自定义内容。结果仍须在预览中审阅。
