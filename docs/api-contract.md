# Web/API 契约（实施中）

所有路径以 `/study-log` 开头。当前契约版本1尚在逐项实现，未达到完整冻结门槛。

## 认证与身份

- `POST /api/auth/login` 接收 `{password}`；正确返回 `{ok:true}` 并设置 HttpOnly、SameSite=Lax 会话Cookie；错误/畸形密码返回401，不回显输入。
- `POST /api/auth/app-login` 接收同样参数，返回 `{ok:true,token,expiresAt}`；后续用 `Authorization: Bearer …`。Cookie与App Token有不同受众，不互相替用。
- `GET /api/auth/me` 返回认证状态。`POST /api/auth/logout` 清除当前浏览器Cookie，不撤销其他已签发Token。
- `GET /api/capabilities` 需要认证，返回持久 `instanceId`、`apiContractVersion` 和 `features`。当前AI/问答尚未实现，`supported/configured` 都为false；不得将未实现能力报告为可用。
- 认证有效期7天。过期、错误签名、额外分段或错误受众不能访问受保护API。Cookie Secure由实例配置明确指定，本地HTTP初始化默认false；HTTPS部署应设true。

配置及初始化错误不得包含密码、密钥或资料正文。实例身份不随服务重启改变。

## 只读日块

- `GET /api/logs/months` 返回 `{months:[{id,label,dayCount,firstDate,lastDate}]}`，按月倒序。
- `GET /api/logs?month=YYYY-MM` 返回 `{days:[{date,month,fileName,headings,preview}]}`，按日期倒序；空月为空数组。
- `GET /api/logs/day?date=YYYY-MM-DD` 返回 `{day:{...summary,exists,content,version,updatedAt}}`；不存在的日块返回 `exists:false`、日期标题及 `version:null`，不创建文件。
- 所有读取需要认证，响应禁止缓存；无效日历日期或月份返回400。源文件日块必须属于文件名的年/月，日期不能重复；不合规资料明确读取失败，不猜测应选哪份。
- 日块和版本哈希来自同一原文快照。源文件采用 `YYYY_学习日志.md` 或 `YYYY-MM_学习日志.md`；只识别根级ATX日期标题，代码、列表和引用中的示例不会分割日块，目录小节同样忽略代码示例。

当前尚未接入写入API。

## 附件读取边界

`GET /api/assets/...` 先认证，再解析显式实例下的附件路径。拒绝目录联接、符号链接、路径越界和Windows备用数据流；打开后复核路径与文件身份。图片返回对应MIME及`nosniff`，SVG使用禁止脚本的sandbox；不缓存认证资料。此阶段仅支持读取，上传在附件写入批次实现。
