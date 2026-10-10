"use client";

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { indentLess, indentMore } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, type KeyBinding, type ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { insertMarkdownLink, toggleHeadingLevel, toggleInlineMarkdown } from "@/lib/editor-commands";
import "@/app/editor.css";

interface Props {
  date: string;
  value: string;
  active: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onInternalLink?: () => void;
  onView?: (view: EditorView | null) => void;
  onUpdate?: (update: ViewUpdate) => void;
  tools?: ReactNode;
}

const markdownSyntaxHighlight = HighlightStyle.define([
  {
    tag: [tags.link, tags.url],
    color: "var(--accent-teal)",
    textDecoration: "underline",
    textUnderlineOffset: "2px"
  }
]);

const markdownEditorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      minHeight: "420px",
      backgroundColor: "var(--surface-dark-soft)",
      color: "var(--on-dark)",
      borderRadius: "var(--radius-md)"
    },
    "&.cm-focused": {
      outline: "none"
    },
    ".cm-scroller": {
      minHeight: "420px",
      fontFamily: '"JetBrains Mono", Consolas, monospace',
      fontSize: "14px",
      lineHeight: "1.65"
    },
    ".cm-content": {
      padding: "12px 0",
      caretColor: "var(--on-dark)"
    },
    ".cm-line": {
      padding: "0 12px"
    },
    ".cm-gutters": {
      backgroundColor: "var(--surface-dark-soft)",
      color: "var(--on-dark-soft)",
      borderRight: "1px solid rgba(250, 249, 245, 0.1)"
    },
    ".cm-activeLine, .cm-activeLineGutter": {
      backgroundColor: "rgba(250, 249, 245, 0.06)"
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "rgba(204, 120, 92, 0.34)"
    },
    ".cm-cursor": {
      borderLeftColor: "var(--on-dark)"
    }
  },
  { dark: true }
);

const basicSetup = {
  autocompletion: true,
  bracketMatching: true,
  closeBrackets: true,
  foldGutter: false,
  highlightActiveLine: true,
  highlightSelectionMatches: true,
  lineNumbers: true,
  searchKeymap: false
};

export function LogEditor({ date, value, active, onChange, onSave, onInternalLink, onView, onUpdate, tools }: Props) {
  const editorView = useRef<EditorView | null>(null);
  const callbacks = useRef({ active, onChange, onSave, onInternalLink, onView });
  callbacks.current = { active, onChange, onSave, onInternalLink, onView };

  const editorExtensions = useMemo<Extension[]>(() => {
    const shortcutKeymap: KeyBinding[] = [
      { key: "Mod-Shift-k", run: () => { if (callbacks.current.active) callbacks.current.onInternalLink?.(); return true; } },
      {
        key: "Mod-s",
        run: () => {
          if (callbacks.current.active) callbacks.current.onSave();
          return true;
        }
      },
      {
        key: "Mod-b",
        run: (view) => toggleInlineMarkdown(view, "**", "加粗文本")
      },
      {
        key: "Mod-i",
        run: (view) => toggleInlineMarkdown(view, "*", "斜体文本")
      },
      {
        key: "Mod-k",
        run: insertMarkdownLink
      },
      {
        key: "Mod-`",
        run: (view) => toggleInlineMarkdown(view, "`", "代码")
      },
      ...[3, 4, 5, 6].map((level): KeyBinding => ({
        key: `Ctrl-Alt-${level}`,
        mac: `Mod-Alt-${level}`,
        run: (view) => toggleHeadingLevel(view, level)
      })),
      {
        key: "Tab",
        run: indentMore
      },
      {
        key: "Shift-Tab",
        run: indentLess
      }
    ];

    return [
      markdown(),
      search({ top: true }),
      EditorState.phrases.of({
        Find: "查找",
        Replace: "替换",
        next: "下一个",
        previous: "上一个",
        all: "全选",
        "match case": "区分大小写",
        regexp: "正则表达式",
        "by word": "全字匹配",
        replace: "替换",
        "replace all": "全部替换",
        close: "关闭"
      }),
      indentUnit.of("  "),
      EditorView.lineWrapping,
      markdownEditorTheme,
      syntaxHighlighting(markdownSyntaxHighlight),
      Prec.high(keymap.of(shortcutKeymap)),
      keymap.of(searchKeymap)
    ];
  }, []);

  const handleCreate = useCallback((view: EditorView) => {
    editorView.current = view;
    callbacks.current.onView?.(view);
  }, []);

  useEffect(() => () => {
    editorView.current = null;
    callbacks.current.onView?.(null);
  }, []);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => { editorView.current?.requestMeasure(); editorView.current?.focus(); });
    return () => cancelAnimationFrame(frame);
  }, [active, date]);

  useEffect(() => {
    if (!active) return;
    function handleEditorSearchKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "f") return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']") && !target.closest(".cm-editor")) return;
      const view = editorView.current;
      if (!view) return;
      event.preventDefault();
      view.focus();
      openSearchPanel(view);
      requestAnimationFrame(() => {
        if (view.dom.isConnected) view.dom.querySelector<HTMLInputElement>(".cm-search input[name='search']")?.focus();
      });
    }
    window.addEventListener("keydown", handleEditorSearchKeyDown);
    return () => window.removeEventListener("keydown", handleEditorSearchKeyDown);
  }, [active]);

  const handleChange = useCallback((nextValue: string, update: ViewUpdate) => {
    // uiw excludes ExternalChange transactions from this callback, so a new
    // controlled value (load/discard) does not become a user edit.
    callbacks.current.onChange(nextValue);
    let insertedLength = 0;
    update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
      insertedLength += inserted.length;
    });
    const isPaste = update.transactions.some(transaction => transaction.isUserEvent("input.paste"));
    if (!isPaste && insertedLength < 2000) return;
    const view = update.view;
    const selectionHead = update.state.selection.main.head;
    requestAnimationFrame(() => {
      if (!view.dom.isConnected) return;
      view.requestMeasure();
      view.dispatch({ effects: EditorView.scrollIntoView(selectionHead, { y: "nearest" }) });
    });
  }, []);

  return <div className="editor-shell workspace-editor-shell">
    <div className="editor-date-line" aria-label={`当前日志日期 ${date}，不可编辑`} title="日期由系统维护，不可修改">
      <code><span>##</span> {date}</code>
      {tools}
    </div>
    <CodeMirror
      key={date}
      className="editor-codemirror"
      value={value}
      height="100%"
      theme="none"
      extensions={editorExtensions}
      basicSetup={basicSetup}
      editable={active}
      readOnly={!active}
      onChange={handleChange}
      onCreateEditor={handleCreate}
      onUpdate={onUpdate}
    />
  </div>;
}
