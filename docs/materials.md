# 材料解析

材料文件解析为当前写作会话中的文本，不导入整个知识库，不保存上传原件，也不调用模型。支持 UTF-8 TXT、Markdown、PDF、DOCX 和 PPTX。单个文件不超过 20 MiB，提取文本不超过 500,000 字符。

`POST /api/materials/extract` 需要认证，使用 multipart 的单个 `file` 字段；返回 `{document}`，含文件名、类型、大小、文本、带定位的 `sections` 与 `warnings`。定位为 Markdown 标题、段落、PDF 页或幻灯片。前端应显示警告，保留多文件导入顺序。

PDF 仅提取文本，不执行 OCR；扫描件没有可用文本时明确提示。DOCX 的图片和复杂布局、PPTX 的备注和复杂元素不保证提取；公式、表格等需要用户校对。错误输入/损坏文件返回400，资源超限返回413，意外故障不暴露服务器路径。

除上传和文本限制，PDF最多500页；Office ZIP最多2048条目、单条实际解压16 MiB、累计64 MiB。检查实际解压大小，不只相信ZIP声明；拒绝宏、加密、异常路径、重复条目及XML实体声明。

生产构建外置 PDF.js 与 Mammoth，并追踪 PDF worker、字体和字符映射。`ops/materials-smoke.mjs 实例绝对路径 本机URL` 以真实五种格式检查HTTP入口，且核对资料未写入。已在复制到仓库外的独立 standalone 产物中完成验证，避免从开发机父目录借用依赖。浏览器材料区的验收另见实施状态。
