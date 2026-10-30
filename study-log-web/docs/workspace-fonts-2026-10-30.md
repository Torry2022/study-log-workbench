# 工作台跨平台字体统一（2026-10-30）

## 问题与调整

宽屏原样式依赖未随网页提供的 Inter、Georgia、Times New Roman 等系统字体；同一CSS在鸿蒙浏览器可能回退到不同字形，中文标题甚至变为无衬线。已有Gelasio和Noto Serif资源主要用于窄屏，宽屏日期仍走系统回退。源码编辑器另有独立写死的字体入口。

网页统一使用app/fonts.css定义的字体角色：

| 角色 | 网页随包字体 |
| --- | --- |
| 界面及正文 | Inter + Noto Sans SC |
| 标题、日期及数字展示 | Gelasio + Noto Serif SC |
| 行内代码和源码编辑器 | JetBrains Mono + Noto Sans SC |
| 正文代码块 | 保留已有Paper Mono |

日期直接复用鸿蒙gelasio_variable.ttf对应的Gelasio.ttf，既有字号/字重/断点层级不改。鸿蒙原生客户端和官网独立样式不在本次改动范围。Windows客户端使用同一网页实现，随下一次构建取得相同字体，不在本轮安装。

字体资源全部随应用提供，无运行时Google Fonts/CDN依赖；新增资源为Google Fonts官方仓库的OFL字体，许可证与哈希随资源保存。中文变量字体按既有常用字集合（补齐拉丁字符）拆出Common文件；与完整字体采用互不重叠的unicode-range，常规页面只请求Common，生僻字再请求完整补充。完整字体保留，以免将生僻字重新交给系统回退。构建来源及哈希见public/fonts/workspace-fonts.json；子集仅删除无关字形，不改变字形轮廓。

## 复核

两版均完成生产构建（含类型检查）。verify-workspace-fonts.mjs从生产入口取得实际CSS，在独立字体样张中使用真实页面选择器，检查Chromium/WebKit、1440/390、浅深色共每版8组；另查实际渲染字体、无横向溢出、移动日期、Common/补充请求、字体请求失败时仍可读。Chromium rendered-font检查显示日期/中文标题/正文/界面/行内代码/Paper Mono均使用custom font，无宿主系统字体泄漏。已查看宽屏浅色和窄屏深色样张。

该专项验证生产样式及字体，不冒充所有模块真实业务流程或鸿蒙PC浏览器实机验证。当前Edge连接报Debugger unattached，未取得线上当前页字体面板；截图与代码作为问题线索，实际修复由隔离构建验证。操作系统抗锯齿仍可能造成细微显示差异。

通用版首轮跨盘junction构建触发Next路径解析错误；改用同盘隔离目录后构建通过，没有修改产品构建配置。字体测试夹具的DOM生命周期、编码及布局等待问题已修正，不按产品缺陷处理。两版最终验证日志、截图位于仓库外font-alignment/20261030目录。

本轮仅本地提交，未推送、部署或安装。
