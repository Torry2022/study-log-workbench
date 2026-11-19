# 远程 AI 设置：鸿蒙本地候选

## 来源与实现

按统筹明确确认的通用线在途接口接入，不修改服务端工作区。来源为 `public-integration/study-log-web/app/api/settings/ai/route.ts`、`models/route.ts`、`test/route.ts`、`deployment-preview/route.ts` 及 `lib/ai-settings-operation.ts`、`ai-settings-probe.ts`，截至本次读取仍为通用线未提交候选，不假称已发布或固定提交。共同约束为 Bearer、目标实例、每次重新输入密码、capabilities决定是否开放；密码确认不创建长期权限票据。

- `AiSettingsController`保留只读摘要与旧服务降级，另按已确认的 writable/reauthRequired开放独立编辑入口。`AiSettingsEditor`拥有本次表单、请求与保存结果身份，`AiSettingsForm`使用原生48vp输入、既有ToolbarAction、设置滚动外壳及共享FormKeyboardContext，不复制网页实现。
- 支持DeepSeek预设／自定义完整生成接口、模型／轻量模型、Key keep/replace/remove。改变服务商／目标使旧Key保留失效；摘要origin绝不回写为完整地址。无旧Key允许keep为空，未配齐仍可保存；实际检查要求完整。容量仅修改时发送字符串（空或大于98304的安全整数），改地址／模型后清除未确认容量，单独换Key不影响容量。thinking仅官方DeepSeek两种受支持模型显示，隐藏／未改省略字段保留服务端原值；验证标记只读。
- 保存使用PUT+expectedInstanceId/expectedRevision/operationId。写前按捕获namespace持久化的记录仅包含实例、修订和操作ID，不包含Key、密码、模型载荷或私密完整地址。持久化失败不发写请求。每次操作前重新读取能力，权限关闭或身份变化立即阻止动作。
- 保存响应或随后确认读取丢失时不自动重写，用户显式GET核对；仅相同operationId且新修订可确认成功。未变修订且同一表单仍在内存时，可重新输入密码并重送同一不可变操作；其他操作已更新则保持本表单，提示核对最新配置。关闭后仅恢复非秘密结果身份，秘密字段不恢复；重新填写生成新操作ID。
- 版本冲突保留当前表单，可读最新摘要后明确放弃旧表单并重填。分区／宽度变化保留编辑状态，密码确认组件离开即清空；关闭／更换工作台先明确提醒秘密字段将清除。关闭或换实例使取消和迟到结果失效，不把A的输入、探测或保存结果应用到B。返回A按A的namespace只读核对。
- 每次操作的密码仅在原生密码框和本次请求局部内存，按确认前即清空UI、确认取消、离开、60秒超时处理；不写Preferences/AssetStore或日志。模型读取与一次生成分别为显式按钮，生成前说明额度；没有本轮实际付费请求。检查期间冻结相关输入，结果绑定实例、修订和本表单；改字段立即清除旧检查。
- 部署恢复先调用实际预览接口（其响应是精简摘要，不伪装为完整GET），展示来源／模型／Key状态，再重验密码提交previewId；改变表单即废弃预览。恢复不携带当前草稿的Key／私密地址。
- 确认保存后读取capabilities刷新客户端缓存，不切换实例或重建会话；刷新失败仍明确“已保存”，单列功能状态待更新。原生功能按钮刷新、真实网络与实际页面返回行为需要设备验证。

## 实际验证

仅合成资料／适配边界，没有供应商、真实工作台或设备操作。

- 默认 `npm test`：协议 **554/554**、editor-runtime **13/13**，无浏览器自动启动。
- 新增实际编辑控制器20项回归：只读／未知协议／权限收回、keep/replace/remove、目标换Key、丢响应只读确认、不可变重试、其他设备更新／409保留草稿、A/B迟到及返回A、模型与生成绑定、取消、实际精简部署预览及恢复、相同ID旧修订不能确认、重新验证／429与本机记录失败、保存后能力刷新与失败语义、未配齐保存、停止等待后迟到及重新检查、容量和thinking可写边界、已接受PUT后核对错误或重试验证失败仍保留未知结果身份；执行真实密码确认方法验证发送前清空、一分钟到期、离开清理。另执行实际InstanceStore的namespace隔离。
- 原生ApiClient专项执行实际绑定PUT/POST序列化、Bearer／实例头及取消，仅发一次且不记录秘密。原只读专项断言保留到只读组件，新增能力门控接线检查；未跳过测试。
- `devecocli build --product default --modules entry@default --build-mode release`：unsigned release构建通过，未签名或安装。保留现有编译警告。
- 证据日志不入Git：`E:/DevData/StudyLogWorkbench/phase1-coordination-20261113/harmony-phase2-remote-default.log`、`harmony-phase2-remote-build.log`。

## 尚未覆盖

统筹尚未完成此候选的原生手机／PC宽窄短窗／真实键盘和实际隔离服务联调。原生安全存储、被系统终止后的重新核对、模板／检索就绪、真实供应商检查及完整阶段B不能因上述合成测试记为通过。容量和thinking已按统筹确认的实际字符串契约接线，仍需与最终服务端候选比对联调。本批不含明确断开连接，后续单独复用已有草稿保护落实契约6；不把稍后连接或更换当作断开。未安装日常应用、推送、发布或修改个人版。

## 统筹补验反馈

统筹在 `b98b444b` 签名候选的鸿蒙PC模拟器，连接真实隔离Next服务，确认首次重连、重启恢复、设置四区、AI摘要、原生编辑、无Key仅保存模型、原生密码确认与已保存提示，私有合成记录revision 2→3且Key为空。证据 `D:/TempCodex/StudyLogPhase2Emulators/verification/pc-remote-ai-saved.{json,jpeg}`。此结果来自统筹现场反馈，不是本开发线设备操作，也不扩展为手机、完整高级参数、断开或真实供应商探测通过；上节待验矩阵以此有限流程为补充。
