# 公开交付验证（2026-10-08）

当前结论：rc.5 公开部署附件、网页/API 互通和后续可见平板模拟器的原生读写已通过列明检查；独立签名、外部 HTTPS 和跨版本迁移仍待验。下文按发生顺序保留首轮受阻及后续补验记录。

## 公开附件与隔离服务

从 GitHub rc.5 发布地址下载服务器 ZIP，SHA-256 为 `5fb2552e9dbdb61bf72f800b9a11c51598fdb245621159f7bec4eb993099ddba`，与发布附件一致。使用解压后的 compose.yaml 和三个 rc.5 公共镜像执行初始化、认证及无模型写入、材料提取、重启、只读检索、完整备份及新目录恢复检查，六组通过。使用本机 Docker 缓存，不声明全新主机网络下载体验。

证据：仓库忽略目录 .local/public-delivery-20261008/docker-smoke.log，以及 .local/public-rebuild-b27-20261008054454474/report.json。

另用该 Compose 建立独立实例。Playwright 从网页登录、新建并保存合成日志；随后通过鸿蒙使用的 app-login 获取令牌，核对 apiContractVersion=1、serverVersion=0.1.0-rc.5，读取网页内容并携带版本修改。用旧版本再次保存返回 409；重新登录网页可见两次内容，截图已核对。证据为 .local/public-delivery-20261008/web-app-api-report.json 和同目录截图。这里执行的是 API，不是鸿蒙原生界面。

## 鸿蒙构建与边界

首轮协议测试因本机未安装 TypeScript 依赖失败；按照 README 执行 npm ci 后 224/224 通过，无跳过。运行时依赖安装、2/2 测试及构建通过，生成 editor.js 未形成 Git 差异。客户端 clean assembleHap 成功，33 个任务执行、1 个 up-to-date；无签名配置，KEEP_SCREEN_ON_DURING_ACCEPTANCE=false。本机 SDK 和已有 OHPM 依赖复用，未宣称完全空白开发环境构建通过。

证据：.local/delivery-harmony-protocol-final.log、delivery-harmony-clean-build.log、delivery-editor-tests.log、delivery-editor-build.log。未提交 HAP、签名材料、实例或测试图片。

用户授权仅向当前平板模拟器安装无签名公开版测试包。实际安装调用被自动审批拒绝，未返回具体原因；未绕过，未操作已连接真机或个人版。该次原生跨端读写未完成，保留为待验。

## 清理与结论

所属 Compose 服务正常停止并移除，合成实例锁已释放，实例和证据保留。仅移除本轮模拟器 tcp:3592 反向映射，既有转发不变。未使用真实模型、未产生模型费用、未部署生产服务器。

首轮当时仅支持公开附件本机部署和网页/API 互通，不支持宣称鸿蒙原生链路、独立签名或异网络 HTTPS 已通过。当前不新增产品版本。

## 可见平板模拟器原生补验

用户要求将无窗口模拟器正常停止后以可见窗口启动，随后再次明确要求安装验证。本次 HDC 无签名公开版安装成功，使用上述构建产物及同一独立合成实例。原生登录页填写本机地址、允许测试 HTTP 并使用合成密码连接；日志界面显示网页创建的正文及之前 API 追加内容。点击源码模式，在现有正文末尾输入 HarmonyNativeSaved，再点击原生保存。服务端源文件保留原文并包含该标记；独立 Playwright 重新登录网页也读到全部内容。

设备布局树与截图位于 .local/public-delivery-20261008，workspace.json、source-ready.json 和 harmony-preview.jpeg 为原生证据（截图实际处于源码模式，文件名不作为模式证据），web-native-readback.png 为网页读回。未修改真机或个人版，未调用模型。

随后尝试停止并重启该测试应用的调用被自动审批拒绝，未给出具体原因；未绕过，本轮冷启动读回不计通过。上述实际保存与跨端读回已完成，不以冷启动待验否定已有结果。独立签名及外部 HTTPS 仍待验。
