# 源码编辑器运行时

在本目录运行 `npm ci`、`npm run build`，生成客户端使用的 `editor.js`。`src/` 是编辑器运行时的维护来源，生成结果写入鸿蒙客户端的 rawfile 目录。

编辑器功能从 `src/` 修改并经相同的 esbuild 版本生成。HTML、CSS、备份预览和许可清单由客户端目录维护；功能改动保留这些文件的职责边界。

依赖许可见客户端 `rawfile/editor/LICENSES.txt`。
