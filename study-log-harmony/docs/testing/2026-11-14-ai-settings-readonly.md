# 2026-11-14：鸿蒙只读 AI 设置接入

## 来源及范围

父候选 `36c28ea2`，继续在独立 `public-phase2-harmony` 实施。服务协议来自 `ac099b70` 的实际 `app/api/settings/ai/route.ts`、`app/api/capabilities/route.ts`、`lib/ai-settings-reader.ts` 及对应 smoke／snapshot 测试；通过 `git show` 只读核对，没有将服务端整提交或整文件搬入鸿蒙树。

原生“设置”仍默认原阅读／编辑偏好；用既有字体、色资源、SegmentIndicator与按钮反馈增加“AI 服务”只读分区，保留原偏好项、自动保存及恢复默认范围。此批沿现有600vp上限设置表面，不提前实现阶段二完整四区设置导航／840双栏或首次引导。没有新输入框、服务器写入、Key编辑、密码重验、模型列表和付费生成入口。

## 请求与状态

- 基础 capabilities 继续按原协议校验；settings扩展可选且局部判断。缺扩展显示旧服务维护指引；未知／畸形设置协议仅禁该分区的读取，不使原日志／问答登录失败；readable=false不请求新端点。
- 支持时调用现有 Bearer GET `/study-log/api/settings/ai` 并带 `X-Study-Log-Instance`。为已有 `ApiClient.getForInstance` 增加可选取消参数，既有调用兼容；该设置路径的503留给用户显式重试，不自动循环读取。
- 摘要持有捕获的会话binding和请求代次。关闭设置／切回阅读页使请求取消并废弃迟到成功／错误；切换工作台提交时关闭旧设置，避免保留A已读摘要。重新读取先检查新的capabilities，支持从config_unavailable恢复，不修改全局认证或业务capabilities。
- `AI_SETTINGS_INSTANCE_CHANGED` 409明确要求重新连接；`AI_CONFIGURATION_INVALID` 503明确是读取错误，不显示为“尚未配置”。重试保留各自语义，不清业务草稿或自动退出工作台。
- summary仅保留已知非秘密字段：实例、revision、provider、origin形式endpointDisplay、hasEndpoint／hasKey、主／轻量模型、容量／推理参数、两项标记及source。拒绝含用户信息、完整路径／查询的display地址；不持有额外endpoint／Key字段，不将摘要回写。
- source=instance显示工作台配置来源及维护流程，提醒旧环境变量不会替换已提交配置；source=deployment明确沿用部署配置。密钥“已设置”使用中性文字；高级验证标记不冒充当前功能已验证或模板／检索已就绪。

## 实际复验

测试只使用合成响应、受控native传输适配和源码宿主；没有访问真实资料或服务器。

1. `ai-settings-readonly.test.mjs`：8项，涵盖可选扩展／未知协议、实际 `ac099b7` 摘要函数在instance／deployment两来源的输出兼容及脱敏、畸形响应和跨实例拒绝、旧服务零新增请求、绑定GET、刷新／取消／迟到／重复读取、503与409、不可读服务恢复及实际原生入口／卸载接线。该来源函数测试依赖仓库保留 `ac099b7` Git对象，与既有历史升级测试相同；打包源码快照不等于可脱离Git运行该历史兼容测试。
2. `read-recovery.test.mjs`：保留原断言，新增实际ApiClient的绑定Bearer GET／实例头／原生取消及配置503不自动重试检查；未模拟掉被测请求实现。
3. 专项命令 `node --experimental-strip-types --test test/ai-settings-readonly.test.mjs test/read-recovery.test.mjs`：**30/30**。
4. 默认 `npm test`：协议 **516/516**，editor-runtime **13/13**；没有默认启动浏览器。
5. `devecocli build --product default --modules entry@default --build-mode release`：unsigned release构建通过；没有签名或安装。

本机日志位于 `E:/DevData/StudyLogWorkbench/phase1-coordination-20261113/`：`harmony-phase2-ai-readonly-focused.log`、`harmony-phase2-ai-readonly-default.log`、`harmony-phase2-ai-readonly-build.log`。日志和HAP不入Git。

## 尚未验收

- 原生宽窄／短窗／键盘／焦点与实际设置分区交互，设备未安装。
- 实际 HDC 客户端到包含 `ac099b7` 服务端的网络联调，包括409／503真实响应和页面观察；合成适配／来源函数兼容不替代这项。
- 远程写入、Key操作、重鉴权、配置保存结果恢复、模型列表／付费探测、完整设置分区及首次引导均不在本批。
- 个人版未改；不合回主线、不推送或发布。第一笔连接事务的原生存储／卸载边界继续保留，不因本批测试通过而关闭。
