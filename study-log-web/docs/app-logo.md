# 通用版 Logo 资源

参考个人版提交 `6cef742`，沿用当前鸿蒙的透明前景图形。唯一手工维护的图形源为 `public/app-logo-light.svg`；深色前景、favicon 和鸿蒙资源均由它派生，不分别维护造型。

在仓库根目录执行：

```powershell
node study-log-web/scripts/generate-app-logo.mjs
```

生成脚本使用现有 Playwright Chromium，输出：

- 网页深色前景 `public/app-logo-dark.svg`。
- 浅色 favicon `app/icon.svg`、深色 favicon `public/icon-dark.svg`；页面 metadata 按系统浅深色选择。浅色 PNG `app/icon.png` 作为兼容资源。
- 鸿蒙 base/dark 的 `app_icon_foreground.svg`、`app_icon_background.svg`，旧深色完整图标 `dark/media/app_icon.svg`，以及兼容 `base/media/app_icon.png`。

SVG 使用 1024×1024 坐标，兼容 PNG 为 512×512。网页登录页和工作台、桌面本机管理和连接窗口、鸿蒙 `AppLogo` 的浅色底为 `#FAF9F5`，深色底为 `#1C1A17`。组件的尺寸、圆角和边框沿用现有样式。完整 favicon 的外框按参考版本派生；Windows 打包脚本继续从同一透明图形源生成图标，保留现有 256px 尺寸和 48px 圆角，仅统一底色。

鸿蒙应用及 Ability 仍引用既有 `app_icon_layered`，其背景和前景改由脚本派生。启动窗口的 `transparent_start_window_icon.png` 仍保持透明，启动窗口底色保持既有浅深色配置；不改变启动行为。通用版没有个人版官网和开发历程资源，也没有 AppScope 中的兼容 PNG，因此不新增这些无引用的副本。

资源检查：`node --test study-log-web/scripts/app-logo.test.mjs`。独立浏览器检查：`node ops/browser-app-logo.mjs <合成数据目录绝对路径> <本机工作台URL> <截图目录绝对路径>`，检查登录页和工作台的宽窄窗口、浅深色底、尺寸、圆角、边框、图片加载及 favicon 链接，并保存截图和结果 JSON。使用已构建的隔离服务包，不操作日常应用或真实记录。

2026-10-11：资源检查、Web 类型及生产构建、鸿蒙 242 项协议测试和无签名 HAP 构建通过。独立 Chromium 在隔离服务包中检查登录页和工作台的 1440/390px 浅深色界面，八组截图及图片加载、底色、尺寸、圆角、边框和 favicon 链接检查通过；窄工作台沿用隐藏品牌标识的布局。证据位于 `.local/logo-screenshots-20261011/`，仅包含合成记录。鸿蒙本批未在模拟器或真机现场验证，资源一致性及构建不代表应用内、桌面启动图标或系统深色切换的视觉验收。
