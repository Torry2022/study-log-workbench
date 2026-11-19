# 通用鸿蒙首次连接与设置原生复核

最新本地候选通过协议测试 572 项、阅读器测试 13 项。以下截图和原生联调结果对应当时的候选。最新手机连接页缺少产品标识，首次引导按欢迎、填写和稍后连接三个状态重新设计，视觉验收待复。

## 范围和实现

本批承接候选连接、远程 AI 设置和显式断开的既有实现，针对实际原生画面重整入口与设置表面。不改变实例隔离、草稿保留、凭据提交、远程写权限、每次密码确认或不确定结果的核对协议。不操作个人版或真实资料，不代表发布验收完成。

- 首次入口只提供“连接工作台”和独立的“稍后连接”；点击连接才展示地址、密码及按需展开的本地 HTTP 选项。移除旧品牌介绍、纹理和版权区，保留应用字体、主题、按钮与 48vp 输入。前景内容统一位于安全区内的单一滚动容器。
- 非秘密的首次入口标记仅记下用户已经进入连接步骤。已配置、401／失败重连和已暂缓用户继续原有恢复／待连接路径，不反复展示首次选择。首次表单返回选择页；已有连接的重新连接返回待连接；探测可以取消，原子提交阶段不可中断。
- 设置按实际面板宽度 840vp 切换双栏／分区列表，桌面最大 960vp、表单最大 600vp。外壳按内容包裹，高度受宿主 84% 约束，固定页头之外的正文独立滚动。桌面导航顶部对齐，保留应用原有图标导航样式；不是固定高度的大空框。
- 外观偏好使用同行标签和 144×44vp 原生选择器，选择菜单也使用应用主题资源。学习记录分区以摘要／操作行呈现；连接详情按需展开。宽窄改变不销毁 AI 编辑控制器。
- AI 选择器沿用原生 Select 的键鼠／触控语义，统一 44vp、8vp 圆角、应用字体和主题菜单。密钥未设置时明确显示“暂不设置 Key”；不再用中点拼接状态。维护和实现细节收在详细状态中。
- 设置范围内的恢复默认、搜索历史、离开编辑、重新填写、连接切换和断开复用应用风格的原生 CustomDialog。最大 440vp、内容可滚动、动作可换行；取消／销毁只拒绝，不执行业务操作。其他工作区既有弹窗不在本批替换范围内。
- 再验证密码放在独立原生确认框，避免在表单末尾插入一整段密码区。取消、超时、离开均清空密码，提交前先取本次局部值并关闭确认；密码不进入偏好或操作身份记录。

## 自动验证

- `study-log-harmony` 默认 `npm test`：协议／逻辑 **567/567**、editor-runtime **13/13**，全部通过。默认入口不启动浏览器。
- 保留既有连接、草稿与凭据失败断言；测试使用真实 SettingsConfirmation 状态类，仅替换原生展示边界。新增确认一次性结算、替换旧确认、离开取消、测量高度约束和布局结构断言。首次入口、旧用户恢复、晚到探测和提交保护仍执行真实页面方法。
- `devecocli build --product default --modules entry@default --build-mode release`：产品配置下 unsigned release 构建通过。隔离镜像相同 UI 的 signed release 构建及覆盖安装通过；保留现有编译告警。
- 产品 `entry/src/main` 共 363 个文件与隔离镜像逐文件比较，规范化换行／末尾空白和下述测试存储名称后无其他差异。没有为截图替换 UI、模型控制器或网络调用。

## 原生实际入口与证据

仅使用分配的手机模拟器 `127.0.0.1:14429`、PC 模拟器 `127.0.0.1:14430`，使用 HDC；没有本轮真机安装、清数据或卸载。原始截图和布局树在本机 `D:/TempCodex/StudyLogPhase2Emulators/verification/`，以下文件各有 `.jpeg` 和 `.json`，不纳入 Git。

| 实际操作 | 证据前缀与结果 |
| --- | --- |
| 新的合成存储首次启动，选择／稍后分离 | `phone-harmony-ui-first-light`、`pc-harmony-ui-first-light`；首屏无表单，两个动作同时可见。`phone-harmony-ui-first-dark-final` 为同一入口的实际深色画面。 |
| 首次进入表单／返回，再冷启动 | `phone-harmony-ui-form-dark-final`、`phone-harmony-ui-first-back`、`phone-harmony-ui-attempted-restart`；返回选择页，已进入过连接步骤的重启直接到表单。 |
| 稍后连接、本机设置及分区返回 | `phone-harmony-ui-pending-v2`、`phone-harmony-ui-settings-list`、`phone-harmony-ui-about-dark-final`、`phone-harmony-ui-pending-dark`；待连接和本机偏好可独立使用。 |
| 阅读偏好浅深、选择器、取消恢复 | `phone-harmony-ui-reading-light`、`phone-harmony-ui-reading-dark-final`、`phone-harmony-ui-theme-menu-final`、`phone-harmony-ui-reset-confirm-dark`；PC 对应 `pc-harmony-ui-reading-v2`、`pc-harmony-ui-reading-dark-v3`、`pc-harmony-ui-reset-app-confirm`。旧 `pc-harmony-ui-reset-confirm` 是发现白底蓝字系统确认的前态，不作为修后画面。 |
| 长正文滚动至操作区，短窗及宽窄重排 | `pc-harmony-ui-reading-end`、`pc-harmony-ui-short-window`、`pc-harmony-ui-short-window-end`、`pc-harmony-ui-narrow-menu`、`pc-harmony-ui-narrow-reading`；重新读取／恢复默认等末尾动作通过正文滚动到达，窄窗使用分区返回。已恢复原 PC 窗口大小。 |
| 实际连接 HTTP 未授权拒绝，再明确启用后连接 | `pc-harmony-ui-http-denied`、`pc-harmony-ui-connected`、`pc-harmony-ui-records-dark`；独立真实 Next 服务，不是 UI 假成功。 |
| 可写 AI 摘要、编辑、原生选择及密码确认 | `pc-harmony-ui-ai-summary-final`、`pc-harmony-ui-ai-editor-final`、`pc-harmony-ui-ai-password-dialog-dark`；表单／密码框是产品入口，未用原型截图代替。 |
| 真实错误密码拒绝，保留填写后正确密码重试 | `pc-harmony-ui-ai-save-failed`、`pc-harmony-ui-ai-saved`；显示本次密码错误，模型填写保留，正确密码后显示已保存。独立合成后端配置 revision 从 1 到 2，hasKey=false；没有调用付费供应商。 |
| 更换连接取消、重试及只读服务 | `pc-harmony-ui-switch-confirm`、`pc-harmony-ui-switch-cancel`、`pc-harmony-ui-ai-readonly-dark`；取消保留 A，再次确认才进入另一独立实例；只读摘要可读且不存在修改入口。 |
| 断开确认取消 | `pc-harmony-ui-disconnect-confirm-light`；使用应用风格确认，取消后保留当前连接。凭据删除成功／失败的完整边界仍由既有专项负责，不据此重复宣称已原生验收。 |

隔离包只改沙箱存储名称（连接偏好、current 文件、凭据前缀、日志／随记／分类草稿、阅读偏好和主题）及本机签名配置，不清旧沙箱。重新拍摄深色首次入口时另换新的合成连接偏好／current 名称，保留测试主题。签名、镜像、测试配置、HAP 和截图均不进 Git。

网络验证自开真实已封存 Next 产物，独立合成实例为 `D:/TempCodex/StudyLogPhase2Emulators/harmony-ui-service/instance`（可写设置）和 `harmony-ui-service-readonly/instance`（部署者维护）。本机端口 34324／34328，仅转发到对应模拟器 34318／34319；不使用其他 Session 的实例。实际错误／保存／切换都通过原网络控制器和服务端接口，没有 UI 测试开关或付费模型请求。

## 尚未覆盖的边界

- 手机模拟器首次聚焦输入触发系统“小艺输入法”隐私同意页（`phone-harmony-ui-phone-state`／`phone-harmony-ui-after-ime-cancel`）。未替用户同意，最终选择退出输入法；没有绕过权限或密码截图保护。手机连接输入、AI 远程表单／密码键盘及键盘下短窗仍待可用输入条件，不把 PC 的成功代替手机验收。
- 深浅样式和常规导航已有模拟器画面，但没有覆盖所有系统字号／辅助功能或逐帧动效矩阵，也没有声称真机性能通过。
- 已有断开、丢响应核对、版本冲突和来源草稿边界的合成回归继续通过；本批实际后端联调只覆盖上述列明路径，不把其余逻辑测试计为实际设备流程通过。
- 仅本地候选。未合回主线、未推送、未部署或发布。后续日志标题栏／侧栏布局是另一独立批次，不与本批混合。
