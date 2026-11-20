# 鸿蒙客户端

鸿蒙客户端连接自行部署的学习日志工作台，可在手机、平板和鸿蒙 PC 上阅读、编辑和检索记录。日志、随记、收藏、问答和统计与网页共用服务器中的数据。

## 使用前准备

- 按[服务器部署指南](../deploy/README.md)启动工作台，准备可从目标设备访问的地址和访问密码。
- 安装 DevEco Studio 与 HarmonyOS SDK `6.1.1(24)`。
- 使用 DevEco 打开 `study-log-harmony`，为本机生成 `local.properties` 并设置 `sdk.dir`。
- 为目标设备配置自己的应用身份、证书、私钥和 Profile。

首次打开时，在首页填写工作台地址和访问密码。远程访问建议使用受信 HTTPS；局域网 HTTP 可在连接选项中显式开启。

## 依赖与测试

以下 PowerShell 命令从仓库根目录执行，将 DevEco Studio 路径替换为本机路径：

```powershell
$devEcoStudio = 'D:\Software\DevEco Studio'
npm --prefix study-log-web ci
Set-Location study-log-harmony
npm ci
npm --prefix editor-runtime ci
& (Join-Path $devEcoStudio 'tools\ohpm\bin\ohpm.bat') install
npm test
```

`npm test` 运行客户端协议与原生方法测试，以及编辑器运行时的逻辑回归。分屏滚动的浏览器检查可在 `editor-runtime` 中运行 `npm run test:browser:split-scroll`。

协议测试会复用相邻 Web 工程的时间和链接实现，因此需要先安装 Web 依赖。

## 构建与签名

未配置签名时，可以生成供检查的未签名 HAP：

```powershell
node (Join-Path $devEcoStudio 'tools\hvigor\bin\hvigorw.js') --mode module -p product=default -p module=entry@default -p buildMode=release assembleHap --no-daemon
```

输出位于 `entry\build\default\outputs\default\entry-default-unsigned.hap`。

真机安装需要在 DevEco 中配置与应用身份匹配的证书、私钥和 Profile。仓库默认包名为 `org.studylog.workbench.publicedition`；使用自己的应用身份时，将 `AppScope/app.json5` 中的 `app.bundleName` 调整为 Profile 对应的包名。签名材料保存在本机环境。

生成 `entry-default-signed.hap` 后，可通过 DevEco 或 HDC 安装。同一应用的后续更新使用相同包名和匹配签名，即可保留设备上的应用资料。

## 连接与设置

1. 在首页填写工作台地址和访问密码，选择“连接工作台”。
2. 连接后选择日期阅读记录，或新建当天日志并保存。
3. 在“设置 → 工作台连接”中更换或断开当前工作台。
4. 在“设置 → AI 服务”中查看模型能力；服务器开放远程修改时，也可以在客户端完成配置。

模型配置由服务器集中保存。生成内容会在客户端展示，确认后再写入学习记录。

## 编辑器运行时

日志源码编辑器的维护入口位于 [`editor-runtime`](editor-runtime/README.md)。修改 `editor-runtime/src` 后运行构建脚本生成客户端使用的 `editor.js`，依赖许可见 `entry/src/main/resources/rawfile/editor/LICENSES.txt`。
