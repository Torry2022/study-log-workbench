"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CircleHelp, X } from "lucide-react";
import { lockBodyScroll, useDialogExit } from "@/hooks/use-dialog-exit";
import "@/app/help.css";

const groups = [
  { title: "工作区", items: [["Ctrl + Shift + F", "聚焦顶部搜索（常规工作区）"], ["Ctrl + G", "日志页按日期跳转（常规工作区）"], ["Ctrl + Alt + N", "切到日志并聚焦新建日期"], ["Ctrl + Alt + Q", "新建问答"], ["Alt + ↑", "返回阅读区顶部（未在输入时）"], ["Esc", "关闭当前浮层"]] },
  { title: "阅读与搜索", items: [["← / ↑", "浏览模式打开上一篇（未在操作控件时）"], ["→ / ↓", "浏览模式打开下一篇（未在操作控件时）"], ["↑ / ↓", "在搜索框选择候选"], ["Enter", "执行搜索或打开选中候选"], ["Ctrl + S", "保存日志或正在编辑的随记"]] },
  { title: "源码编辑", items: [["Ctrl + B / I", "加粗／斜体"], ["Ctrl + K", "插入链接"], ["Ctrl + Shift + K", "插入内部链接"], ["Ctrl + `", "行内代码"], ["Ctrl + Alt + 3", "三级标题"], ["Ctrl + F", "查找当前正文"], ["Tab / Shift + Tab", "增加／减少缩进"]] },
  { title: "知识问答", items: [["Enter", "发送问题"], ["Shift + Enter", "输入换行"]] }
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const { backdropRef, requestExit } = useDialogExit(close);
  function close() { requestExit(onClose); }
  useEffect(() => lockBodyScroll(), []);
  return createPortal(<div ref={backdropRef} className="help-dialog-backdrop" onClick={close}>
    <section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-dialog-title" onClick={event => event.stopPropagation()}>
      <header className="help-dialog-header"><div><span className="help-dialog-icon"><CircleHelp size={20} /></span><div><h2 id="help-dialog-title">使用帮助</h2><p>常用操作与快捷键</p></div></div><button type="button" aria-label="关闭帮助" onClick={close}><X size={18} /></button></header>
      <div className="help-dialog-content">
        <section><h3>常用操作</h3><div className="help-action-grid">
          <article><strong>记录与保存</strong><p>点击“今天”或选择日期新建日志，在源码中输入并保存。日期由系统维护，正文使用三级及以下标题，也可以只写普通段落。无需配置模型即可记录和搜索。</p></article>
          <article><strong>阅读与整理</strong><p>使用浏览、源码或分屏切换查看方式。大纲用于定位标题；已保存的三级标题可收藏、分组。随记可以独立记录想法，也可以从材料中提取并审阅。</p></article>
          <article><strong>搜索与问答</strong><p>顶部搜索查找日志标题和正文，H3 按钮切换为只搜小节标题。左栏搜索筛选当前月份的日期。问答需要配置模型，来源条目可返回日志。</p></article>
          <article><strong>历史与备份</strong><p>“日志历史版本”找回某一天之前保存的内容。完整备份另行保存全部学习记录、附件和配置，两者不能互相替代。本地与服务器上的记录不会自动同步。</p></article>
        </div></section>
        <section><h3>内部链接</h3><p>在源码区选中文字，使用“编辑 → 内部链接”或 Ctrl + Shift + K，选择目标日志或小节。打开链接后，可用“返回”回到原位置。</p></section>
        <section><h3>快捷键</h3><div className="help-shortcut-grid">{groups.map(group => <section key={group.title}><h4>{group.title}</h4><dl>{group.items.map(([keys, action]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{action}</dd></div>)}</dl></section>)}</div></section>
      </div>
    </section>
  </div>, document.body);
}
