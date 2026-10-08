# README 界面截图

两张 PNG 均由独立 Playwright 脚本打开实际网页后截图，使用临时隔离实例及合成技术学习记录，不包含个人日志、模型响应或生产资料。

- `learning-log-light.png`：浅色阅读界面。
- `markdown-split-dark.png`：深色分屏编辑界面。

截图尺寸为 1440 × 960；展示网页界面，不作为鸿蒙客户端或真实用户使用效果的证据。

在仓库根目录完成依赖安装与网页生产构建后，使用 Node.js 22.13 或更新版本执行：

```powershell
node ops/readme-screenshots.mjs
```

脚本创建临时合成实例，启动本地服务，截图后正常停止服务；需要已安装 Playwright Chromium。临时实例不进入仓库。
