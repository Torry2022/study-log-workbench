"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { MarkdownEdit } from "@/lib/markdown-edit";
import "@/app/markdown-edit.css";

const groups: [MarkdownEdit, string][][] = [
  [["paragraph", "正文"], ["h3", "三级标题"], ["h4", "四级标题"], ["h5", "五级标题"], ["h6", "六级标题"]],
  [["bold", "加粗"], ["italic", "斜体"], ["code", "行内代码"], ["codeBlock", "代码块"]],
  [["unordered", "无序列表"], ["ordered", "有序列表"], ["quote", "引用"], ["table", "表格"]],
  [["math", "行内公式"], ["mathBlock", "块公式"], ["link", "链接"]]
];

export function MarkdownEditMenu({ disabled, onCommand, onInternalLink, onImage }: {
  disabled?: boolean; onCommand: (command: MarkdownEdit) => void; onInternalLink: () => void; onImage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const action = (run: () => void) => { setOpen(false); run(); };
  return <div className="markdown-edit-menu" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>(".markdown-edit-options button") || []);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  }}>
    <button ref={trigger} type="button" className="markdown-edit-trigger" disabled={disabled} aria-label="编辑 Markdown" aria-expanded={open} aria-controls={id}
      onMouseDown={event => event.preventDefault()} onClick={() => setOpen(value => !value)}>编辑<ChevronDown size={14} /></button>
    {open && <div id={id} className="markdown-edit-options" role="group" aria-label="Markdown 格式">
      {groups.map((group, index) => <div className="markdown-edit-group" key={index}>
        {group.map(([command, label]) => <button key={command} type="button" onMouseDown={event => event.preventDefault()} onClick={() => action(() => onCommand(command))}>{label}</button>)}
      </div>)}
      <div className="markdown-edit-group">
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => action(onInternalLink)}>内部链接</button>
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => action(onImage)}>图片</button>
      </div>
    </div>}
  </div>;
}
