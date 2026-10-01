# 鸿蒙独立构建与安装验收

当前状态：未完成。本文是操作清单，不是通过记录。维护者已有 PC／平板调试签名和 USB 连接测试不能代替本清单。

## 准备工程和实例

1. 使用自己的全新检出，记录提交号。不要复制维护者的 `.local`、`local.properties`、签名目录、应用沙箱或构建产物。
2. 准备已初始化的自部署 Web 实例，先在设备浏览器中确认 `/study-log` 可以访问。`localhost` 和 `127.0.0.1` 指向当前设备，不能直接代表另一台电脑上的服务。
3. 使用独立的合成日志、随记和测试密码；不要把真实资料导入待验收实例。模型密钥只在服务端配置，基础安装与日志操作不要求启用 AI。
4. 安装工程要求的 HarmonyOS SDK `6.1.1(24)` 和匹配的 DevEco Studio，打开仓库中的 `study-log-harmony` 目录。当前工程支持 `phone`、`tablet`、`2in1`，兼容 SDK 版本见 `build-profile.json5`。

## 构建和签名

先按[客户端 README](../study-log-harmony/README.md)完成依赖准备、协议测试和构建。工程提交的 `signingConfigs` 为空；无签名 HAP 编译成功只证明构建成功。

在 DevEco 中为 `org.studylog.workbench.publicedition` 配置本地调试签名，使用匹配的证书、私钥和 Profile，并覆盖实际测试设备。已有调试证书与私钥可按开发者自己的配置复用，但另一个包名的 Profile 不能直接作为公开版 Profile。不要把私钥、密码、证书、Profile 或本机路径提交到仓库，也不要提交修改后的签名配置。

完成签名构建后，在输出目录确认存在本次生成的 `entry-default-signed.hap`。维护者的调试 HAP 不是公共发行包；不要将绑定维护者设备的包当作其他使用者可直接侧载的 Release 附件。

当前源码为维护者真机验收临时开启 `EntryAbility.ets` 的 `KEEP_SCREEN_ON_DURING_ACCEPTANCE`。正式发行构建前必须关闭该开关并重新构建、安装、验证；验收用的常亮包不作为发行包。

下面是 PowerShell 安装示例，运行前替换三个占位值：

```powershell
$hdc = 'D:\你的DevEco安装目录\sdk\default\openharmony\toolchains\hdc.exe'
$deviceId = '<hdc list targets 中的目标设备标识>'
$hap = 'D:\你的仓库目录\study-log-harmony\entry\build\default\outputs\default\entry-default-signed.hap'
& $hdc list targets
& $hdc -t $deviceId install -r $hap
& $hdc -t $deviceId shell aa start -a EntryAbility -b org.studylog.workbench.publicedition
```

若签名或安装失败，先核对包名、Profile、设备范围、SDK 兼容版本及证书／私钥是否匹配。不要为了试装直接卸载已有应用；卸载可能丢失本地草稿和连接配置。诊断记录只保留错误码和脱敏信息。

## 独立验收记录

记录操作者、提交号、设备类型与系统版本、构建／签名／安装结果。不要记录设备唯一标识、账号、口令、证书内容或服务器密钥。

- [ ] 全新检出不依赖维护者的缓存、签名或实例文件，构建并安装成功。
- [ ] 正式发行包已关闭临时常亮开关，前台闲置时按系统设置正常息屏。
- [ ] 从设备实际网络连接自己的实例，完成登录及应用重启后的连接恢复。若用了 USB 反向端口，单独标注，不能据此勾选外部网络连接通过。
- [ ] 合成日志的读取、编辑、显式保存及重新打开一致；断开网络后的失败没有丢失编辑内容。
- [ ] 随记、收藏、统计和已有问答历史可打开；未配置 AI 时普通功能仍可使用，模型调用入口明确反映未配置状态。
- [ ] 更换到另一独立合成实例后，不出现前一个实例的资料或草稿；再切回时状态符合各实例自己的记录。
- [ ] 同包名、同签名更新安装后，已保存资料仍可读取，本地连接与未保存草稿按既定恢复流程处理。

每项填写实际结果和证据路径；未执行、失败和缺少条件分别记录。设备类型分别记账，不以平板代替手机或 PC。此清单也不替代[剩余迁移验收](harmony-workspace-recovery.md)中的完整界面、动效、异常并发及 AI 链路检查。
