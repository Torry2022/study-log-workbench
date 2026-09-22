"use client";

import { Bold, Check, ChevronLeft, FileImage, Italic, Link2, Plus, RefreshCw, Save, Search, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MarkdownPreview, type InternalLinkTarget } from "./MarkdownPreview";
import { InternalLinkDialog } from "./InternalLinkDialog";
import type { NotesController } from "@/hooks/use-notes";
import type { StudyNote, StudyNoteFacet } from "@/lib/notes-types";
import { formatNoteTime, localDateTimeInput, parseTags } from "@/lib/notes-view";
import { IMAGE_ACCEPT, imageExtension } from "@/lib/asset-upload-rules";
import "@/app/notes.css";

interface Props { exportAction?: ReactNode; extractAction?: ReactNode; extraction?: ReactNode; notes: NotesController; themeMode: "light" | "dark"; onOpenLogTarget: (target: InternalLinkTarget, noteId: string) => void | Promise<unknown> }

const keyOf = (value: string) => value.replace(/\s+/g, "").toLocaleLowerCase();

function NoteTagPicker({ value, options, onChange }: {
  value: string[];
  options: StudyNoteFacet[];
  onChange: (tags: string[]) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = new Set(value.map(keyOf));
  const known = new Map<string, StudyNoteFacet>();
  for (const item of [...options].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "zh-CN"))) {
    if (!known.has(keyOf(item.value))) known.set(keyOf(item.value), item);
  }
  for (const tag of value) if (!known.has(keyOf(tag))) known.set(keyOf(tag), { value: tag, count: 0 });
  const text = query.trim().replace(/\s+/g, " ");
  const choices = [...known.values()].filter((tag) => keyOf(tag.value).includes(keyOf(query)))
    .map((tag) => ({ ...tag, create: false }));
  if (text && !/[,，、\n]/.test(text) && !known.has(keyOf(text))) choices.push({ value: text, count: 0, create: true });
  const activeIndex = Math.min(active, choices.length - 1);
  useEffect(() => {
    if (open) document.getElementById(`${id}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, id, open]);

  function choose(tag: string) {
    if (selected.has(keyOf(tag))) onChange(value.filter((item) => keyOf(item) !== keyOf(tag)));
    else if (value.length < 20) onChange([...value, tag]);
    setQuery("");
    setActive(0);
    input.current?.focus();
  }

  return <div className="note-tag-picker" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label htmlFor={id}>标签</label>
    <div className="note-tag-selection">
      {value.map((tag) => <span className="note-tag-chip" key={tag}>
        <span>{tag}</span><button type="button" title={`移除标签：${tag}`} aria-label={`移除标签：${tag}`}
          onClick={() => onChange(value.filter((item) => item !== tag))}><X size={13} /></button>
      </span>)}
      <input ref={input} id={id} role="combobox" aria-label="搜索或创建标签" autoComplete="off"
        aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? `${id}-${activeIndex}` : undefined}
        placeholder="搜索或创建标签" value={query}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            setActive(Math.max(0, Math.min(choices.length - 1, activeIndex + (event.key === "ArrowDown" ? 1 : -1))));
          }
          if (event.key === "Enter") {
            event.preventDefault();
            if (open && choices[activeIndex]) choose(choices[activeIndex].value);
            else setOpen(true);
          }
        }} />
    </div>
    {open && <div className="note-tag-options" role="listbox" id={`${id}-list`} aria-label="标签候选" aria-multiselectable="true">
      {choices.map((tag, index) => <button key={tag.value} type="button" role="option" id={`${id}-${index}`}
        aria-selected={selected.has(keyOf(tag.value))} disabled={!selected.has(keyOf(tag.value)) && value.length >= 20}
        className={index === activeIndex ? "active" : ""}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(tag.value)}>
        {tag.create ? <Plus size={14} /> : <Check size={14} style={{ visibility: selected.has(keyOf(tag.value)) ? "visible" : "hidden" }} />}
        <span>{tag.create ? `创建标签：${tag.value}` : tag.value}</span>
        {tag.count > 0 && <small>{tag.count}</small>}
      </button>)}
      {choices.length === 0 && <span className="note-tag-empty">暂无匹配标签</span>}
    </div>}
  </div>;
}

function NoteEditor({ notes }: { notes: NotesController }) {
  const { tags, busy, draft, updateDraft, saveDraft, closeEditor, insertions, conflict } = notes;
  const { bodyRef, insightRef, applyInline, insertLink, openInternalLink, uploadFiles, setActiveField } = insertions;
  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>, field: "body" | "insight") {
    const files = Array.from(event.clipboardData.files).filter(file => imageExtension(file));
    if (files.length) { event.preventDefault(); void uploadFiles(files, field); }
  }
  function handleDrop(event: DragEvent<HTMLTextAreaElement>, field: "body" | "insight") {
    const files = Array.from(event.dataTransfer.files).filter(file => imageExtension(file));
    if (files.length) { event.preventDefault(); void uploadFiles(files, field); }
  }
  function handleDragOver(event: DragEvent<HTMLTextAreaElement>) {
    if (Array.from(event.dataTransfer.items).some(item => item.type.startsWith("image/"))) event.preventDefault();
  }
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <section className="notes-composer" aria-label={draft.id ? "编辑随记" : "新建随记"}>
      <div className="notes-composer-heading">
        <div className="notes-composer-identity">
          <button type="button" onClick={() => void closeEditor()} aria-label="返回随记列表" title="返回随记列表">
            <ChevronLeft size={18} />
          </button>
          <div>
            <span>{draft.id ? "编辑随记" : "新建随记"}</span>
            <small>{draft.id ? "修改已记录的内容" : "记录值得反复回看的观点、经验或判断"}</small>
          </div>
        </div>
        <label>
          <span>记录时间</span>
          <input
            type="datetime-local"
            value={draft.recordedAt}
            max={localDateTimeInput()}
            onChange={(event) => updateDraft({ recordedAt: event.target.value })}
          />
        </label>
      </div>

      <input
        className="notes-title-input"
        value={draft.title}
        onChange={(event) => updateDraft({ title: event.target.value })}
        placeholder="标题（可选，留空时显示正文首句）"
        maxLength={120}
      />

      <div className="notes-markdown-toolbar" aria-label="随记 Markdown 工具">
        <button type="button" disabled={busy} onClick={() => applyInline("**", "重点内容")} title="加粗" aria-label="加粗"><Bold size={15} /></button>
        <button type="button" disabled={busy} onClick={() => applyInline("*", "强调内容")} title="斜体" aria-label="斜体"><Italic size={15} /></button>
        <button type="button" disabled={busy} onClick={insertLink} title="插入链接" aria-label="插入链接"><Link2 size={15} /></button>
        <button type="button" disabled={busy} onClick={openInternalLink} title="插入内部链接" aria-label="插入内部链接">
          <span className="notes-internal-link-icon">[[]]</span>
        </button>
        <button type="button" disabled={busy} onClick={() => fileInputRef.current?.click()} title="插入图片" aria-label="插入图片"><FileImage size={16} /></button>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          accept={IMAGE_ACCEPT}
          onChange={(event) => {
            const files = Array.from(event.target.files || []);
            event.target.value = "";
            void uploadFiles(files);
          }}
        />
      </div>

      <textarea
        ref={bodyRef}
        className="notes-body-input" aria-label="随记正文"
        value={draft.body}
        onChange={(event) => updateDraft({ body: event.target.value })}
        onFocus={() => setActiveField("body")}
        onPaste={(event) => handlePaste(event, "body")}
        onDrop={(event) => handleDrop(event, "body")}
        onDragOver={handleDragOver}
        placeholder="记录一个值得长期保留的观点、经验或判断…"
        rows={9}
      />

      <div className="notes-composer-fields">
        <label className="notes-field-wide">
          <span>个人理解</span>
          <textarea
            ref={insightRef} aria-label="个人理解"
            value={draft.insight}
            onChange={(event) => updateDraft({ insight: event.target.value })}
            onFocus={() => setActiveField("insight")}
            onPaste={(event) => handlePaste(event, "insight")}
            onDrop={(event) => handleDrop(event, "insight")}
            onDragOver={handleDragOver}
            placeholder="可选：写下自己的判断、适用边界或行动启发"
            rows={4}
          />
        </label>
        <label>
          <span>来源</span>
          <textarea aria-label="来源"
            value={draft.sourcesText}
            onChange={(event) => updateDraft({ sourcesText: event.target.value })}
            placeholder={"每行一项，可填写链接或来源名称"}
            rows={3}
          />
        </label>
        <NoteTagPicker value={parseTags(draft.tagsText)} options={tags}
          onChange={(selected) => updateDraft({ tagsText: selected.join("、") })} />
      </div>

      <div className="notes-composer-actions">
        <button className="button secondary" type="button" onClick={() => void closeEditor()}>取消</button>
        <button className="button primary notes-save-button" type="button" onClick={() => void saveDraft()} disabled={busy || conflict || !draft.body.trim()}>
          <Save size={15} />
          {notes.saving ? "保存中" : "保存随记"}
        </button>
      </div>
    </section>
  );
}


function NoteItem({ note, notes, themeMode, onOpenLogTarget }: { note: StudyNote } & Props) {
  const { expandedIds, focusedNoteId, focusRevision, toggleExpanded, openEdit, deleteNote, busy } = notes;
  const navigateInternalLink = (target: InternalLinkTarget) => onOpenLogTarget(target, note.id);
  const long = note.body.length > 700 || note.body.split(/\r?\n/).length > 14;
  const expanded = expandedIds.has(note.id);
  const entryRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!notes.active || !notes.visible || focusedNoteId !== note.id) return;
    const frame = window.requestAnimationFrame(() => {
      entryRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
      entryRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedNoteId, focusRevision, note.id, notes.active, notes.visible]);

  return (
    <article className="note-entry" id={`note-${note.id}`} ref={entryRef} tabIndex={-1}>
      <header className="note-entry-header">
        <div>
          <h3>{note.displayTitle}</h3>
          <time dateTime={note.recordedAt}>{formatNoteTime(note.recordedAt)}</time>
        </div>
        <div className="note-entry-actions">
          <button type="button" disabled={busy} onClick={() => void openEdit(note)}>编辑</button>
          <button className="danger note-delete-desktop" type="button" disabled={busy} onClick={() => void deleteNote(note)} aria-label={`删除随记：${note.displayTitle}`}>
            <Trash2 size={15} />
          </button>
          <details className="note-more" onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
            <summary aria-label={`更多随记操作：${note.displayTitle}`}>···</summary>
            <button className="danger" type="button" disabled={busy} onClick={(event) => { const menu = event.currentTarget.closest("details"); menu?.removeAttribute("open"); menu?.querySelector("summary")?.focus(); void deleteNote(note); }}>删除随记</button>
          </details>
        </div>
      </header>

      <div className={`note-entry-body${long && !expanded ? " collapsed" : ""}`}>
        <MarkdownPreview active={notes.active && notes.visible} content={note.body} themeMode={themeMode} onInternalLink={navigateInternalLink} />
        {note.insight && (
          <section className="note-insight">
            <h4>个人理解</h4>
            <MarkdownPreview active={notes.active && notes.visible} content={note.insight} themeMode={themeMode} onInternalLink={navigateInternalLink} />
          </section>
        )}
      </div>
      {long && (
        <button className="note-expand-button" type="button" onClick={() => toggleExpanded(note.id)}>
          {expanded ? "收起" : "展开全文"}
        </button>
      )}

      {(note.sources.length > 0 || note.tags.length > 0) && (
        <footer className="note-entry-footer">
          {note.sources.length > 0 && (
            <div className="note-sources">
              <span>来源</span>
              <MarkdownPreview
                active={notes.active && notes.visible}
                content={note.sources.map((source) => `- ${source}`).join("\n")}
                themeMode={themeMode}
                onInternalLink={navigateInternalLink}
              />
            </div>
          )}
          {note.tags.length > 0 && (
            <div className="note-tags">
              {note.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
          )}
        </footer>
      )}
    </article>
  );
}


export function NotesModule({ notes, themeMode, onOpenLogTarget, exportAction, extractAction, extraction }: Props) {
  if (!notes.active || !notes.visible) return null;
  return <>
    <div className="reader-toolbar-container"><div className="reader-toolbar notes-toolbar">
      <div className="notes-title-block module-title-block"><div className="reader-heading-row"><h2>随记</h2></div></div>
      <div className="reader-controls notes-header-actions">
        <form className="notes-search" onSubmit={event => { event.preventDefault(); notes.submitSearch(); }}>
          <Search size={15} /><input value={notes.query} onChange={event => notes.setQuery(event.target.value)} placeholder="搜索随记内容、来源或标签" aria-label="搜索随记" />
          <button className="search-submit" type="submit" disabled={!notes.query.trim()} aria-label="搜索随记内容"><Search size={14} /></button>
          {(notes.query || notes.submittedQuery) && <button className="search-clear" type="button" onClick={notes.clearSearch} aria-label="清空随记搜索"><X size={14} /></button>}
        </form>
        <button className="button secondary" type="button" disabled={notes.loading || notes.saving} onClick={() => void notes.reload()} aria-label="刷新随记" title="刷新随记"><RefreshCw size={15} /></button>
        {exportAction && <div className="notes-export-slot">{exportAction}</div>}
        {extractAction}
        <button className="button secondary notes-new-mobile" type="button" disabled={notes.saving} onClick={() => void notes.openNew()} aria-label="新建随记"><Plus size={20} /></button>
      </div>
    </div></div>
    <div className="reader-content reader-content-notes"><div className={`notes-workspace${notes.editorOpen ? " notes-workspace-editor" : ""}`}>
      {notes.loadError && <div className="notes-error" role="alert">{notes.loadError}<button className="button secondary" type="button" disabled={notes.loading} onClick={() => void notes.reload()}>重试</button></div>}
      {notes.error && <div className="notes-error" role="alert">{notes.error}{notes.conflict && <button className="button secondary" type="button" disabled={notes.busy} onClick={() => void notes.reloadDraft()}>重新读取服务器版本</button>}</div>}
      {notes.message && <div className="notes-feedback" role="status">{notes.message}</div>}
      {notes.insertions.status && <div className={notes.insertions.failed ? "notes-error" : "notes-feedback"} role={notes.insertions.failed ? "alert" : "status"}>{notes.insertions.status}</div>}
      {extraction || (notes.editorOpen ? <NoteEditor notes={notes} /> : !notes.loaded ? <div className="workspace-state notes-state" role="status">{notes.loading ? "正在加载随记" : "随记加载失败"}</div> : notes.visibleNotes.length ? <div className="notes-feed">{notes.visibleNotes.map(note => <NoteItem key={note.id} note={note} notes={notes} themeMode={themeMode} onOpenLogTarget={onOpenLogTarget} />)}</div> : <div className="workspace-state notes-state notes-empty-state" role="status">
        <div className="workspace-state-body"><span className="workspace-state-title">{notes.notes.length ? "没有匹配的随记" : "还没有随记"}</span><span className="workspace-state-description">{notes.notes.length ? "调整搜索词、年份或标签后重试。" : "记录一个值得长期保留的观点、经验或判断。"}</span></div>
        {!notes.notes.length && <button className="button primary" type="button" onClick={() => void notes.openNew()}><Plus size={15} />新建随记</button>}
      </div>)}
    </div></div>
    {notes.insertions.link && createPortal(<InternalLinkDialog initialAlias={notes.insertions.link.alias} onClose={notes.insertions.closeLink} onInsert={notes.insertions.insertInternalLink} />, document.body)}
  </>;
}
