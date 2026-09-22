# Web/API 契约（实施中）

所有路径以 `/study-log` 开头。当前契约版本1尚在逐项实现，未达到完整冻结门槛。

## 认证与身份

- `POST /api/auth/login` 接收 `{password}`；正确返回 `{ok:true}` 并设置 HttpOnly、SameSite=Lax 会话Cookie；错误/畸形密码返回401，不回显输入。
- `POST /api/auth/app-login` 接收同样参数，返回 `{ok:true,token,expiresAt}`；后续用 `Authorization: Bearer …`。Cookie与App Token有不同受众，不互相替用。
- `GET /api/auth/me` 返回认证状态。`POST /api/auth/logout` 清除当前浏览器Cookie，不撤销其他已签发Token。
- `GET /api/capabilities` 需要认证，返回持久 `instanceId`、`apiContractVersion` 和 `features`。当前AI/问答尚未实现，`supported/configured` 都为false；不得将未实现能力报告为可用。
- 认证有效期7天。过期、错误签名、额外分段或错误受众不能访问受保护API。Cookie Secure由实例配置明确指定，本地HTTP初始化默认false；HTTPS部署应设true。

配置及初始化错误不得包含密码、密钥或资料正文。实例身份不随服务重启改变。
