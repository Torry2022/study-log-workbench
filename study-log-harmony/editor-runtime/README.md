# 源码编辑器运行时

在本目录运行 `npm ci`、`npm run build`，生成客户端使用的 editor.js。保留 rawfile 中既有 HTML、CSS、备份预览和 LICENSES.txt，不将其随编辑命令改动重写。

源码从个人版固定节点 bcce2b631075ffcb366dfb28e3b673140c173e88 的 editor-runtime/src 提取。公开版既有 a80ab19 修复会保留图片插入目标的 text，故未带入个人版的 `target.text = ''`。新增命令前，使用相同 esbuild 0.25.12 与依赖构建、忽略换行及 legal-comment 文件名后，与公开版现有 editor.js 全文一致。保留已有接续运行时代码是为了不改变编辑器基线，不代表公开端增加接续入口。

依赖许可继续见客户端 rawfile/editor/LICENSES.txt。新增命令经源码构建，不手工修改压缩文件。
